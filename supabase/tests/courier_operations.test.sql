-- Courier operations settings, Vault credentials and the live-activation gates
-- (20261224090000_courier_operations_and_credentials.sql). Runs inside a transaction that
-- is rolled back: no Vault secret or setting outlives the test.
begin;

create extension if not exists pgtap with schema extensions;

select plan(41);

-- ---------------------------------------------------------------------------
-- Fixtures (as the database owner)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000e0', 'ops-owner@example.test', now()),
  ('00000000-0000-4000-8000-0000000000e1', 'ops-admin@example.test', now()),
  ('00000000-0000-4000-8000-0000000000e2', 'ops-staff@example.test', now()),
  ('00000000-0000-4000-8000-0000000000e5', 'ops-buyer@example.test', now());
update public.user_roles set role = 'super_admin' where user_id = '00000000-0000-4000-8000-0000000000e0';
update public.user_roles set role = 'admin' where user_id = '00000000-0000-4000-8000-0000000000e1';
update public.user_roles set role = 'staff' where user_id = '00000000-0000-4000-8000-0000000000e2';

insert into public.delivery_charges (zone, amount_minor) values ('inside_dhaka', 6000), ('outside_dhaka', 12000)
  on conflict (zone) do update set amount_minor = excluded.amount_minor;
insert into public.categories (id, slug, name) values ('ca000000-0000-4000-8000-0000000000e1', 'ops-test', 'Ops test');
insert into public.products (id, category_id, slug, sku, name, price_minor, stock_quantity, status) values
  ('0d000000-0000-4000-8000-0000000000e1', 'ca000000-0000-4000-8000-0000000000e1', 'ops-parcel', 'OPS-PARCEL', 'Ops parcel', 10000, 20, 'active');
insert into public.addresses (id, user_id, recipient_name, phone, division, district, area, address_line) values
  ('ad000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000e5', 'Buyer', '+8801712345678', 'Dhaka', 'Dhaka', 'Mirpur', 'House 1, Road 1');

create temporary table t (key text primary key, value text) on commit drop;
grant select, insert, update on t to authenticated, service_role;

-- Safe defaults.
select is((select mode from public.courier_settings where id), 'off', 'couriers start switched off');
select ok((select not booking_enabled and not tracking_sync_enabled from public.courier_settings where id),
  'with real bookings and tracking sync off');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e5", "role": "authenticated"}';
insert into t select 'o1', (public.place_cod_order(gen_random_uuid(), 'ad000000-0000-4000-8000-0000000000e5',
  '[{"productId": "0d000000-0000-4000-8000-0000000000e1", "quantity": 1}]'))->>'orderNumber';

-- ---------------------------------------------------------------------------
-- Operations settings
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e1", "role": "authenticated"}';
select is(public.admin_update_order_status((select value from t where key = 'o1'), 'confirmed')::text, 'confirmed',
  'the order is confirmed');
select throws_ok($$ select public.admin_save_courier_operations('mock', false, false, 300, 15000, null) $$,
  'NZ403', null, 'an admin cannot change courier operations');
select throws_ok($$ select public.admin_set_courier_credential('steadfast', 'api_key', 'x') $$,
  'NZ403', null, 'an admin cannot set courier credentials');
select throws_ok($$ select public.admin_begin_shipment_booking((select value from t where key = 'o1'),
  gen_random_uuid(), 'steadfast', null, 500, null, null, null, '{}', true) $$,
  'NZ600', null, 'no test booking while couriers are off');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e0", "role": "authenticated"}';
select throws_ok($$ select public.admin_save_courier_operations('mock', false, false, 30, 15000, null) $$,
  'NZ412', null, 'a sync interval under a minute is refused');
select throws_ok($$ select public.admin_save_courier_operations('live', false, false, 300, 15000, null) $$,
  'NZ611', null, 'live mode needs the typed confirmation');
select throws_ok($$ select public.admin_save_courier_operations('live', true, false, 300, 15000, 'yes') $$,
  'NZ611', null, 'a wrong confirmation is refused');
select lives_ok($$ select public.admin_save_courier_operations('live', false, true, 600, 20000, 'ENABLE LIVE COURIERS') $$,
  'the owner turns on live mode with the confirmation');
select throws_ok($$ select public.admin_save_courier_operations('live', true, true, 600, 20000, null) $$,
  'NZ611', null, 'turning on real bookings needs the confirmation again');
select lives_ok($$ select public.admin_save_courier_operations('live', true, true, 600, 20000, 'ENABLE LIVE COURIERS') $$,
  'real bookings are turned on with the confirmation');
select lives_ok($$ select public.admin_save_courier_operations('live', true, false, 900, 20000, null) $$,
  'other changes while live need no new confirmation');
select is((public.admin_courier_config())->'operations'->>'trackingSyncIntervalSeconds', '900',
  'the admin sees the saved operations settings');
select throws_ok($$ select public.admin_begin_shipment_booking((select value from t where key = 'o1'),
  gen_random_uuid(), 'steadfast', null, 500, null, null, null, '{}', true) $$,
  'NZ600', null, 'no test booking in live mode');
select throws_ok($$ select public.admin_begin_shipment_booking((select value from t where key = 'o1'),
  gen_random_uuid(), 'steadfast', null, 500, null, null, null, '{}', false) $$,
  'NZ600', null, 'no real booking with a courier that is not enabled and verified');

-- ---------------------------------------------------------------------------
-- Credentials
-- ---------------------------------------------------------------------------

select throws_ok($$ select public.admin_set_courier_credential('steadfast', 'password', 'x') $$,
  'NZ412', null, 'a field the courier does not use is refused');
select throws_ok($$ select public.admin_set_courier_credential('steadfast', 'api_key', '   ') $$,
  'NZ412', null, 'an empty credential is refused');
select lives_ok($$ select public.admin_set_courier_credential('steadfast', 'api_key', 'sf-test-key-123') $$,
  'the owner stores an API key');
select lives_ok($$ select public.admin_set_courier_credential('steadfast', 'api_key', 'sf-test-key-456') $$,
  'and replaces it');
select is(jsonb_array_length((select p -> 'credentials' from jsonb_array_elements((public.admin_courier_config())->'providers') p
  where p ->> 'provider' = 'steadfast')), 1, 'the admin sees one field set');
select ok(position('sf-test-key' in (public.admin_courier_config())::text) = 0,
  'the configuration never contains a credential value');
select throws_ok($$ select public.admin_save_courier_api_base_url('steadfast', 'http://example.com') $$,
  'NZ412', null, 'a base URL must be https');
select lives_ok($$ select public.admin_save_courier_api_base_url('steadfast', 'https://portal.packzy.com/api/v1') $$,
  'the owner saves the base URL');

set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';
select is((public.service_courier_credentials('steadfast'))->>'api_key', 'sf-test-key-456',
  'the server reads the latest value');
select is((public.service_courier_runtime())->>'mode', 'live', 'the server reads the operations settings');

reset role;
select ok(not has_function_privilege('authenticated', 'public.service_courier_credentials(text)', 'execute'),
  'signed-in accounts cannot read credentials');
select is((select count(*)::int from vault.secrets where name = 'nilzora/courier/steadfast/api_key'), 1,
  'the credential is one encrypted Vault secret');
select ok((select bool_and(details::text !~ 'sf-test-key') from public.audit_log where action like 'courier.%'),
  'no credential value reaches the audit log');
select ok(exists (select 1 from public.audit_log where action = 'courier.operations_saved'
                  and (details ->> 'liveConfirmed')::boolean),
  'turning on live operations is audited as confirmed');

-- ---------------------------------------------------------------------------
-- Live verification
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e0", "role": "authenticated"}';
select throws_ok($$ select public.admin_set_courier_live_verified('steadfast', true, 'VERIFY STEADFAST') $$,
  'NZ612', null, 'a courier cannot be verified without a successful live check');
select lives_ok($$ select public.admin_record_courier_check('steadfast', true, 'live', 'ok') $$,
  'a successful live check is recorded');
select throws_ok($$ select public.admin_set_courier_live_verified('steadfast', true, 'verify') $$,
  'NZ611', null, 'verifying needs the typed confirmation');
select lives_ok($$ select public.admin_set_courier_live_verified('steadfast', true, 'VERIFY STEADFAST') $$,
  'the owner verifies the courier');
select lives_ok($$ select public.admin_save_courier_provider('steadfast', true, '{}', 100, null) $$,
  'and enables it');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e1", "role": "authenticated"}';
select is((select x ->> 'shouldCall' from public.admin_begin_shipment_booking((select value from t where key = 'o1'),
  gen_random_uuid(), 'steadfast', null, 500, null, null, null, '{}', false) as x), 'true',
  'a verified, enabled courier may be booked for real');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e0", "role": "authenticated"}';
select lives_ok($$ select public.admin_set_courier_credential('steadfast', 'secret_key', 'sf-test-secret') $$,
  'a new credential is stored');
select ok((select (p ->> 'liveVerifiedAt') is null from jsonb_array_elements((public.admin_courier_config())->'providers') p
  where p ->> 'provider' = 'steadfast'), 'which clears the live verification');
select lives_ok($$ select public.admin_clear_courier_credential('steadfast', 'secret_key') $$,
  'a credential can be cleared');

-- ---------------------------------------------------------------------------
-- The order list's parcel column
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e2", "role": "authenticated"}';
select is(public.admin_order_shipment_states(array[(select value from t where key = 'o1')]), '[]'::jsonb,
  'staff without shipments.read see no parcels (and no error)');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e1", "role": "authenticated"}';
select is((public.admin_order_shipment_states(array[(select value from t where key = 'o1')]))->0->>'status',
  'booking_pending', 'an admin sees the order''s parcel');

select * from finish();
rollback;
