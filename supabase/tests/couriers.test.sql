-- Courier integration: permissions, booking idempotency and uncertain-booking recovery,
-- shipment transitions, append-only history, customer ownership, the COD ledger, mock
-- exclusion and shipment notifications. Runs inside a transaction that is rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(100);

-- ---------------------------------------------------------------------------
-- Fixtures (as the database owner)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000f0', 'courier-owner@example.test', now()),
  ('00000000-0000-4000-8000-0000000000f1', 'courier-admin@example.test', now()),
  ('00000000-0000-4000-8000-0000000000f2', 'courier-staff@example.test', now()),
  ('00000000-0000-4000-8000-0000000000f3', 'courier-mod@example.test', now()),
  ('00000000-0000-4000-8000-0000000000f5', 'courier-buyer@example.test', now()),
  ('00000000-0000-4000-8000-0000000000f6', 'courier-other@example.test', now()),
  ('00000000-0000-4000-8000-0000000000f7', 'courier-reader@example.test', now());

update public.user_roles set role = 'super_admin' where user_id = '00000000-0000-4000-8000-0000000000f0';
update public.user_roles set role = 'admin' where user_id = '00000000-0000-4000-8000-0000000000f1';
update public.user_roles set role = 'staff' where user_id in ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f7');
update public.user_roles set role = 'moderator' where user_id = '00000000-0000-4000-8000-0000000000f3';
-- A staff account an admin gave read access to shipments, and nothing about money.
insert into public.user_permissions (user_id, permission, effect) values
  ('00000000-0000-4000-8000-0000000000f7', 'shipments.read', 'grant');

insert into public.delivery_charges (zone, amount_minor) values ('inside_dhaka', 6000), ('outside_dhaka', 12000)
  on conflict (zone) do update set amount_minor = excluded.amount_minor;
insert into public.categories (id, slug, name) values ('ca000000-0000-4000-8000-0000000000f1', 'courier-test', 'Courier test');
insert into public.products (id, category_id, slug, sku, name, price_minor, stock_quantity, status) values
  ('0d000000-0000-4000-8000-0000000000f1', 'ca000000-0000-4000-8000-0000000000f1', 'courier-parcel', 'CRR-PARCEL', 'Parcel product', 10000, 20, 'active');
insert into public.addresses (id, user_id, recipient_name, phone, division, district, area, address_line) values
  ('ad000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-0000000000f5', 'Buyer', '+8801712345678', 'Dhaka', 'Dhaka', 'Mirpur', 'House 1, Road 1');

create temporary table t (key text primary key, value text) on commit drop;
grant select, insert, update on t to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Structure and defaults
-- ---------------------------------------------------------------------------

select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'public.courier_accounts'::regclass, 'public.courier_settings'::regclass, 'public.courier_rate_cards'::regclass,
  'public.courier_location_mappings'::regclass, 'public.courier_quotes'::regclass, 'public.shipments'::regclass,
  'public.shipment_events'::regclass, 'public.courier_webhook_events'::regclass,
  'public.courier_settlements'::regclass, 'public.courier_cod_ledger'::regclass
)), 'RLS is enabled on every courier table');
select is((select count(*)::int from public.courier_accounts where is_enabled), 0,
  'both couriers start disabled');
select is((select count(*)::int from public.role_permissions
           where role = 'staff' and (permission like 'shipments.%' or permission like 'couriers.%')), 0,
  'staff get no courier permission by default');
select ok(not exists (select 1 from public.role_permissions where role = 'admin' and permission = 'couriers.configure'),
  'enabling a courier is not an admin default');
select ok('couriers.configure' in (select private.permissions_of('00000000-0000-4000-8000-0000000000f0')),
  'the owner can configure couriers');
select ok(not has_function_privilege('authenticated', 'public.service_shipment_booking_payload(uuid)', 'execute'),
  'signed-in accounts cannot read the booking payload (recipient details)');
select ok(not has_function_privilege('authenticated',
  'public.service_record_shipment_event(uuid, public.shipment_status, text, timestamptz, text, text)', 'execute'),
  'signed-in accounts cannot post courier events as the webhook processor');
select ok(not has_function_privilege('anon',
  'public.admin_begin_shipment_booking(text, uuid, text, uuid, integer, text, text, text, jsonb, boolean)', 'execute'),
  'visitors cannot start a booking');
select ok(has_function_privilege('service_role', 'public.claim_notifications(integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_notifications(integer, integer)', 'execute'),
  'only the server claims push notifications');

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f5", "role": "authenticated"}';
insert into t select 'o1', (public.place_cod_order(gen_random_uuid(), 'ad000000-0000-4000-8000-0000000000f5',
  '[{"productId": "0d000000-0000-4000-8000-0000000000f1", "quantity": 2}]'))->>'orderNumber';
insert into t select 'o2', (public.place_cod_order(gen_random_uuid(), 'ad000000-0000-4000-8000-0000000000f5',
  '[{"productId": "0d000000-0000-4000-8000-0000000000f1", "quantity": 1}]'))->>'orderNumber';
select throws_ok($$ select id from public.shipments $$, '42501', null, 'customers cannot read the shipments table');
select throws_ok($$ select public.admin_order_courier_context((select value from t where key = 'o1')) $$,
  'NZ403', null, 'customers cannot open the booking screen');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f3", "role": "authenticated"}';
select throws_ok($$ select public.admin_courier_config() $$, 'NZ403', null, 'moderators cannot see courier settings');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f2", "role": "authenticated"}';
select throws_ok($$ select public.admin_begin_shipment_booking((select value from t where key = 'o1'),
  gen_random_uuid(), 'steadfast', null, 500, null, null, null, '{}', true) $$,
  'NZ403', null, 'staff without shipments.create cannot book');

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}';
select throws_ok($$ select public.admin_save_courier_provider('steadfast', true, '{}', 100, null) $$,
  'NZ403', null, 'an admin cannot enable a courier');
select lives_ok($$ select public.admin_save_courier_rate_card(null, 'steadfast', 'inside_dhaka', 1000, 6000, true) $$,
  'an admin adds a negotiated rate');
select throws_ok($$ select public.admin_save_courier_rate_card(null, 'steadfast', 'inside_dhaka', 1000, 7000, true) $$,
  'NZ412', null, 'the same bracket cannot be added twice');
select is(public.admin_update_order_status((select value from t where key = 'o1'), 'confirmed')::text, 'confirmed',
  'the order is confirmed');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f0", "role": "authenticated"}';
select throws_ok($$ select public.admin_save_courier_provider('pathao', false, '{"apiKey": "x"}', null, null) $$,
  'NZ412', null, 'a credential-looking setting is refused');
select throws_ok($$ select public.admin_save_courier_provider('pathao', false, '{"clientSecret": "x"}', null, null) $$,
  'NZ412', null, 'a secret-looking setting is refused');
select lives_ok($$ select public.admin_save_courier_provider('pathao', false, '{"storeId": "1234"}', 100, 5000) $$,
  'the owner saves non-secret courier settings');
select lives_ok($$ select public.admin_save_courier_operations('mock', false, false, 300, 15000, null) $$,
  'the owner turns on courier test mode');

-- ---------------------------------------------------------------------------
-- Booking
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}';
select is((public.admin_order_courier_context((select value from t where key = 'o1')))->>'bookable', 'true',
  'a confirmed order is bookable');
select is(((public.admin_order_courier_context((select value from t where key = 'o1')))->'order'->>'codDueMinor')::bigint,
  (select total_minor from public.orders where order_number = (select value from t where key = 'o1')),
  'the cash to collect is the order total while payment is pending');
select ok((public.admin_order_courier_context((select value from t where key = 'o1')))->'order' ? 'district'
  and not ((public.admin_order_courier_context((select value from t where key = 'o1')))->'order' ? 'phone'),
  'the booking screen gets the destination, not the phone number');

insert into t select 'q1', (public.admin_record_courier_quotes((select value from t where key = 'o1'),
  '[{"provider": "steadfast", "kind": "internal_estimate", "available": true, "deliveryChargeMinor": 6000,
     "codFeeMinor": 260, "weightGrams": 800, "zone": "inside_dhaka", "isMock": true},
    {"provider": "pathao", "kind": "unavailable", "available": false, "unavailableReason": "no rate card",
     "weightGrams": 800, "isMock": true}]'))->0->>'id';
select is(jsonb_array_length((public.admin_order_courier_context((select value from t where key = 'o1')))->'quotes'), 2,
  'both quotes are stored');

select throws_ok($$ select public.admin_begin_shipment_booking((select value from t where key = 'o2'),
  gen_random_uuid(), 'steadfast', null, 500, null, null, null, '{}', true) $$,
  'NZ601', null, 'a pending order cannot be booked');
select throws_ok($$ select public.admin_begin_shipment_booking((select value from t where key = 'o1'),
  gen_random_uuid(), 'steadfast', null, 500, null, null, null, '{}', false) $$,
  'NZ600', null, 'a real booking with a disabled courier is refused');
select throws_ok($$ select public.admin_begin_shipment_booking((select value from t where key = 'o1'),
  gen_random_uuid(), 'steadfast', null, 500, null, 'pathao', null, '{}', true) $$,
  'NZ606', null, 'overriding the recommendation needs a reason');
select throws_ok($$ select public.admin_begin_shipment_booking((select value from t where key = 'o1'),
  gen_random_uuid(), 'pathao', (select value from t where key = 'q1')::uuid, 500, null, null, null, '{}', true) $$,
  'NZ603', null, 'a quote from another courier is refused');
select throws_ok($$ select public.admin_begin_shipment_booking((select value from t where key = 'o1'),
  gen_random_uuid(), 'steadfast', null, 500, null, null, null, '{"recipient phone": "x"}', true) $$,
  'NZ412', null, 'a destination with free-form keys is refused');

insert into t values ('k1', gen_random_uuid()::text);
insert into t select 'b1', public.admin_begin_shipment_booking((select value from t where key = 'o1'),
  (select value from t where key = 'k1')::uuid, 'steadfast', (select value from t where key = 'q1')::uuid, 800,
  'Fragile', 'steadfast', null, '{}', true)::text;
select is((select value::jsonb ->> 'shouldCall' from t where key = 'b1'), 'true', 'the first request may call the courier');
insert into t select 's1', (select value::jsonb -> 'shipment' ->> 'id' from t where key = 'b1');
select is((select value::jsonb -> 'shipment' ->> 'status' from t where key = 'b1'), 'booking_pending',
  'the shipment waits for the courier''s answer');
select ok((select value::jsonb -> 'shipment' ->> 'merchantRef' from t where key = 'b1')
          = (select value from t where key = 'o1') || '-F1', 'the courier reference is the order number and F1');
select is((select x ->> 'shouldCall' from public.admin_begin_shipment_booking((select value from t where key = 'o1'),
  (select value from t where key = 'k1')::uuid, 'steadfast', (select value from t where key = 'q1')::uuid, 800,
  'Fragile', 'steadfast', null, '{}', true) as x), 'false',
  'the same booking key never calls the courier twice');
select throws_ok($$ select public.admin_begin_shipment_booking((select value from t where key = 'o1'),
  gen_random_uuid(), 'steadfast', null, 500, null, null, null, '{}', true) $$,
  'NZ602', null, 'an order with an active shipment cannot be booked again');

-- The courier did not answer clearly: the booking is uncertain and is never retried blindly.
select is((public.admin_finish_shipment_booking((select value from t where key = 's1')::uuid, 'uncertain',
  null, null, null, null, null, 'timeout'))->>'bookingUncertain', 'true', 'a timeout leaves the booking uncertain');
select throws_ok($$ select public.admin_cancel_shipment((select value from t where key = 's1')::uuid, 'Changed my mind', false) $$,
  'NZ605', null, 'an uncertain booking cannot simply be cancelled');
select is((select x ->> 'shouldCall' from public.admin_begin_shipment_booking((select value from t where key = 'o1'),
  (select value from t where key = 'k1')::uuid, 'steadfast', (select value from t where key = 'q1')::uuid, 800,
  'Fragile', 'steadfast', null, '{}', true) as x), 'false', 'repeating the request does not call again either');
select throws_ok($$ select public.admin_resolve_shipment_booking((select value from t where key = 's1')::uuid,
  'booked', 'MOCK-1001', null, null) $$, 'NZ412', null, 'resolving needs a note on how it was checked');
select is((public.admin_resolve_shipment_booking((select value from t where key = 's1')::uuid,
  'booked', 'MOCK-1001', 'TRK-1001', 'Found in the courier portal'))->>'status', 'booked',
  'the uncertain booking is resolved as booked');
select is(((public.admin_get_shipment((select value from t where key = 's1')::uuid))->'codPosition'->>'expectedMinor')::bigint,
  (select total_minor from public.orders where order_number = (select value from t where key = 'o1')),
  'booking records the cash the courier should collect');

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f5", "role": "authenticated"}';
select is(jsonb_array_length(public.my_order_shipments((select value from t where key = 'o1'))), 1,
  'the customer sees their booked shipment');
select is((public.my_order_shipments((select value from t where key = 'o1')))->0->>'trackingCode', 'TRK-1001',
  'with its tracking code');
select ok(not ((public.my_order_shipments((select value from t where key = 'o1')))->0 ? 'expectedChargeMinor')
  and not ((public.my_order_shipments((select value from t where key = 'o1')))->0 ? 'codAmountMinor'),
  'and never the courier''s charges');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f6", "role": "authenticated"}';
select throws_ok($$ select public.my_order_shipments((select value from t where key = 'o1')) $$,
  'NZ404', null, 'another customer cannot see the shipment');

-- ---------------------------------------------------------------------------
-- Tracking events (the webhook processor and the sync worker)
-- ---------------------------------------------------------------------------

set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';
select is((public.service_record_shipment_event((select value from t where key = 's1')::uuid, 'picked_up', 'picked',
  now() + interval '1 minute', 'test:wh-1', 'webhook'))->>'applied', 'true', 'a pickup event moves the shipment');
select is((public.service_record_shipment_event((select value from t where key = 's1')::uuid, 'picked_up', 'picked',
  now() + interval '1 minute', 'test:wh-1', 'webhook'))->>'duplicate', 'true', 'a replayed event is recognised');
reset role;
select is((select count(*)::int from public.shipment_events where dedupe_key = 'test:wh-1'), 1,
  'and recorded once');
set local role service_role;
select is((public.service_record_shipment_event((select value from t where key = 's1')::uuid, 'in_transit', null,
  now() - interval '1 hour', 'test:wh-old', 'webhook'))->>'applied', 'false', 'an older event is recorded, not applied');
reset role;
select is((select status::text from public.shipments where id = (select value from t where key = 's1')::uuid), 'picked_up',
  'so the shipment never moves backwards');
set local role service_role;
select throws_ok($$ select public.service_record_shipment_event((select value from t where key = 's1')::uuid, 'booked', null,
  now() + interval '2 minutes', 'test:wh-bad', 'webhook') $$, 'NZ604', null, 'events cannot set booking statuses');
select is((public.service_record_shipment_event((select value from t where key = 's1')::uuid, 'delivered', 'delivered',
  now() + interval '3 minutes', 'test:wh-2', 'webhook'))->>'applied', 'true', 'the delivery is applied');
select is((public.service_record_shipment_event((select value from t where key = 's1')::uuid, 'in_transit', null,
  now() + interval '4 minutes', 'test:wh-3', 'webhook'))->>'applied', 'false', 'a delivered shipment never moves again');
reset role;
select is((select count(*)::int from public.notification_outbox
           where kind = 'shipment' and order_number = (select value from t where key = 'o1')), 3,
  'booked, picked up and delivered each queue one push');
set local role service_role;
select ok(exists (select 1 from public.claim_notifications(100, 60) c where c.kind = 'shipment' and c.shipment_status = 'delivered'),
  'the push worker claims shipment notifications with their status');

reset role;
select is((select status::text from public.orders where order_number = (select value from t where key = 'o1')), 'confirmed',
  'the order status is untouched by courier events');
select is((select payment_status::text from public.orders where order_number = (select value from t where key = 'o1')), 'pending',
  'a delivery never marks the cash as collected');
select ok((select next_sync_at is null from public.shipments where id = (select value from t where key = 's1')::uuid),
  'a delivered shipment stops syncing');
select results_eq($$ select title from public.customer_notifications
  where user_id = '00000000-0000-4000-8000-0000000000f5' and kind = 'shipment_update' order by created_at, title $$,
  $$ values ('Parcel delivered'), ('Parcel picked up'), ('Shipment booked') $$,
  'the customer is told once per applied step, never for the replay or the older event');
select ok(exists (select 1 from public.audit_log where action = 'courier.provider_saved' and target_id = 'pathao'),
  'saving a courier is audited');
select ok(exists (select 1 from public.audit_log where action = 'shipment.booked'
                  and target_id = (select value from t where key = 's1')),
  'the booking is audited');
select ok(not exists (select 1 from public.audit_log where action like 'shipment.%' and details::text ~ '\+880'),
  'no phone number reaches the audit log');
insert into t select 'cod', cod_amount_minor::text from public.shipments where id = (select value from t where key = 's1')::uuid;
select throws_ok($$ update public.shipment_events set note = 'x' where dedupe_key = 'test:wh-1' $$,
  'NZ609', null, 'shipment events cannot be changed');
select throws_ok($$ delete from public.courier_cod_ledger where shipment_id = (select value from t where key = 's1')::uuid $$,
  'NZ609', null, 'COD ledger rows cannot be deleted');

-- ---------------------------------------------------------------------------
-- Staff with read access only
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f7", "role": "authenticated"}';
select is((public.admin_get_shipment((select value from t where key = 's1')::uuid))->'shipment'->>'status', 'delivered',
  'a staff account with shipments.read sees the shipment');
select ok((public.admin_get_shipment((select value from t where key = 's1')::uuid))->'ledger' = 'null'::jsonb
  and (public.admin_get_shipment((select value from t where key = 's1')::uuid))->'shipment'->'expectedChargeMinor' = 'null'::jsonb,
  'but not its money');
select throws_ok($$ select public.admin_cancel_shipment((select value from t where key = 's1')::uuid, 'No reason', true) $$,
  'NZ403', null, 'and cannot cancel it');

-- ---------------------------------------------------------------------------
-- Cash on delivery
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}';
select throws_ok($$ select public.admin_cancel_shipment((select value from t where key = 's1')::uuid, 'Too late', true) $$,
  'NZ610', null, 'a delivered shipment cannot be cancelled');
select throws_ok($$ select public.admin_record_cod_collected((select value from t where key = 's1')::uuid, 99999999, 'INV-1', null) $$,
  'NZ608', null, 'more cash than the COD amount is refused');
select lives_ok($$ select public.admin_record_cod_collected((select value from t where key = 's1')::uuid,
  (select value from t where key = 'cod')::bigint, 'INV-1', null) $$,
  'the courier''s collection is recorded with its report reference');
select throws_ok($$ select public.admin_record_cod_collected((select value from t where key = 's1')::uuid, 100, 'INV-1', null) $$,
  'NZ608', null, 'the same report line is not recorded twice');

insert into t select 'net', ((select value from t where key = 'cod')::bigint - 6000 - 260)::text;
select throws_ok($$ select public.admin_record_courier_settlement('steadfast', 'PAY-1', 1, current_date, null,
  jsonb_build_array(jsonb_build_object('shipmentId', (select value from t where key = 's1'),
    'settledMinor', (select value from t where key = 'net')::bigint, 'deliveryChargeMinor', 6000, 'codFeeMinor', 260)), true) $$,
  'NZ608', null, 'a payout whose lines do not add up is refused');
select lives_ok($$ select public.admin_record_courier_settlement('steadfast', 'PAY-1', (select value from t where key = 'net')::bigint,
  current_date, null,
  jsonb_build_array(jsonb_build_object('shipmentId', (select value from t where key = 's1'),
    'settledMinor', (select value from t where key = 'net')::bigint, 'deliveryChargeMinor', 6000, 'codFeeMinor', 260)), true) $$,
  'a payout is recorded line by line');
select throws_ok($$ select public.admin_record_courier_settlement('steadfast', 'PAY-1', 0, current_date, null,
  jsonb_build_array(jsonb_build_object('shipmentId', (select value from t where key = 's1'), 'settledMinor', 0)), true) $$,
  'NZ608', null, 'the same payout reference is accepted once');
select is((public.admin_get_shipment((select value from t where key = 's1')::uuid))->'codPosition'->>'status', 'settled',
  'the shipment''s cash is settled');
select is(((public.admin_get_shipment((select value from t where key = 's1')::uuid))->'codPosition'->>'differenceMinor')::bigint, 0::bigint,
  'with no difference');
select throws_ok($$ select public.admin_record_cod_adjustment((select value from t where key = 's1')::uuid, 100, null) $$,
  'NZ608', null, 'an adjustment needs a reason');
select lives_ok($$ select public.admin_set_cod_state((select value from t where key = 's1')::uuid, 'reconciled', null) $$,
  'a matching shipment is reconciled');
select is((public.admin_cod_positions(null, null, false, 50, 0))->>'total', '0',
  'test shipments are left out of the COD positions');
select is((public.admin_cod_positions(null, null, true, 50, 0))->>'total', '1',
  'unless asked for');
select is((public.admin_courier_overview(false))->>'total', '0', 'and out of the overview');
select is((public.admin_list_courier_settlements(null, false, 50, 0))->>'total', '0', 'and out of the settlements');

-- ---------------------------------------------------------------------------
-- Return pickups
-- ---------------------------------------------------------------------------

reset role;
insert into public.return_requests (id, order_id, user_id, status, reason) values
  ('5e000000-0000-4000-8000-0000000000f1', (select id from public.orders where order_number = (select value from t where key = 'o1')),
   '00000000-0000-4000-8000-0000000000f5', 'approved', 'Wrong size'),
  ('5e000000-0000-4000-8000-0000000000f2', (select id from public.orders where order_number = (select value from t where key = 'o1')),
   '00000000-0000-4000-8000-0000000000f5', 'requested', 'Changed mind');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}';
select throws_ok($$ select public.admin_begin_return_pickup('5e000000-0000-4000-8000-0000000000f2', gen_random_uuid(),
  'steadfast', 500, null, '{}', true) $$, 'NZ607', null, 'a pickup needs an approved return');
select is((select x -> 'shipment' ->> 'codAmountMinor' from public.admin_begin_return_pickup('5e000000-0000-4000-8000-0000000000f1',
  gen_random_uuid(), 'steadfast', 500, null, '{}', true) as x), '0', 'a return pickup collects no cash');
select throws_ok($$ select public.admin_begin_return_pickup('5e000000-0000-4000-8000-0000000000f1', gen_random_uuid(),
  'steadfast', 500, null, '{}', true) $$, 'NZ602', null, 'one active pickup per return');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f7", "role": "authenticated"}';
select throws_ok($$ select public.admin_begin_exchange_shipment('5e000000-0000-4000-8000-0000000000f1', gen_random_uuid(),
  'steadfast', 500, 0, null, '{}', true) $$, 'NZ403', null, 'read-only staff cannot ship an exchange');

-- ---------------------------------------------------------------------------
-- Bookings made in the courier's own portal (the hybrid path)
-- ---------------------------------------------------------------------------

select throws_ok($$ select public.admin_record_portal_booking((select value from t where key = 'o2'), null, gen_random_uuid(),
  'steadfast', 500, 'SF-PORTAL-1', null, null, 'Booked in the portal', null, null, false) $$,
  'NZ403', null, 'read-only staff cannot record a portal booking');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f0", "role": "authenticated"}';
select lives_ok($$ select public.admin_save_courier_provider('steadfast', true, '{}', 100, null) $$,
  'the owner enables Steadfast for real parcels');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}';
select throws_ok($$ select public.admin_record_portal_booking((select value from t where key = 'o2'), null, gen_random_uuid(),
  'steadfast', 500, 'SF-PORTAL-1', null, null, 'Booked in the portal', null, null, false) $$,
  'NZ601', null, 'a pending order cannot be recorded as booked');
select is(public.admin_update_order_status((select value from t where key = 'o2'), 'confirmed')::text, 'confirmed',
  'the second order is confirmed');
select throws_ok($$ select public.admin_record_portal_booking((select value from t where key = 'o2'), null, gen_random_uuid(),
  'pathao', 500, 'PT-PORTAL-1', null, null, 'Booked in the portal', null, null, false) $$,
  'NZ600', null, 'a disabled courier cannot be recorded for a real parcel');
select throws_ok($$ select public.admin_record_portal_booking((select value from t where key = 'o2'), null, gen_random_uuid(),
  'steadfast', 500, 'SF-PORTAL-1', null, null, null, null, null, false) $$,
  'NZ412', null, 'a portal booking needs a note on where it was booked');
select throws_ok($$ select public.admin_record_portal_booking((select value from t where key = 'o2'), null, gen_random_uuid(),
  'steadfast', 500, null, null, null, 'Booked in the portal', null, null, false) $$,
  'NZ412', null, 'a portal booking needs the consignment id');

insert into t values ('k3', gen_random_uuid()::text);
insert into t select 'p3', public.admin_record_portal_booking((select value from t where key = 'o2'), null,
  (select value from t where key = 'k3')::uuid, 'steadfast', 700, 'SF-PORTAL-1', 'SF-TRK-1', 6000,
  'Booked in the Steadfast portal by phone order', null, null, false)::text;
select is((select value::jsonb ->> 'status' from t where key = 'p3'), 'booked', 'the portal booking is recorded as booked');
select is((select value::jsonb ->> 'isMock' from t where key = 'p3'), 'false', 'as a real parcel');
select is((select value::jsonb ->> 'expectedChargeMinor' from t where key = 'p3'), '6000', 'with the charge the portal quoted');
select is((public.admin_record_portal_booking((select value from t where key = 'o2'), null,
  (select value from t where key = 'k3')::uuid, 'steadfast', 700, 'SF-PORTAL-1', 'SF-TRK-1', 6000,
  'Booked in the Steadfast portal by phone order', null, null, false)) ->> 'id',
  (select value::jsonb ->> 'id' from t where key = 'p3'), 'recording it again changes nothing');
select is(((public.admin_get_shipment((select value::jsonb ->> 'id' from t where key = 'p3')::uuid))->'codPosition'->>'expectedMinor')::bigint,
  (select total_minor from public.orders where order_number = (select value from t where key = 'o2')),
  'the cash the courier should collect is in the ledger');
select throws_ok($$ select public.admin_record_portal_booking((select value from t where key = 'o2'), null, gen_random_uuid(),
  'steadfast', 500, 'SF-PORTAL-2', null, null, 'Booked in the portal', null, null, false) $$,
  'NZ602', null, 'the order already has its parcel');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f5", "role": "authenticated"}';
select is((public.my_order_shipments((select value from t where key = 'o2')))->0->>'trackingCode', 'SF-TRK-1',
  'the customer sees the portal booking''s tracking code');

select * from finish();
rollback;
