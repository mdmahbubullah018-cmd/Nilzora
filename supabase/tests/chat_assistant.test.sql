-- Database-level checks for the support assistant's two functions: that only the server may
-- call them, that they answer for the thread's own customer alone, and that the reply function
-- refuses a thread a person is involved in. Runs inside a transaction that is rolled back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(35);

-- Fixtures ------------------------------------------------------------------
insert into public.profiles (id, email, full_name, status) values
  ('aaaaaaaa-1111-4000-8000-000000000001', 'assist-cust1@example.com', 'Assistant One', 'active'),
  ('aaaaaaaa-1111-4000-8000-000000000002', 'assist-cust2@example.com', 'Assistant Two', 'active'),
  ('bbbbbbbb-1111-4000-8000-000000000001', 'assist-staff@example.com', 'Assistant Staff', 'active');

insert into public.user_roles (user_id, role) values
  ('aaaaaaaa-1111-4000-8000-000000000001', 'customer'),
  ('aaaaaaaa-1111-4000-8000-000000000002', 'customer'),
  ('bbbbbbbb-1111-4000-8000-000000000001', 'staff');

insert into public.orders (
  id, order_number, user_id, item_count, subtotal_minor, shipping_fee_minor, total_minor,
  delivery_zone, ship_recipient_name, ship_phone, ship_division, ship_district, ship_area,
  ship_address_line, idempotency_key, request_fingerprint
) values (
  'ffffffff-1111-4000-8000-000000000001', 'NZ900001', 'aaaaaaaa-1111-4000-8000-000000000001',
  1, 250000, 6000, 256000, 'inside_dhaka',
  'Assistant One', '+8801712345678', 'Dhaka', 'Dhaka', 'Gulshan', 'Road 1',
  'ffffffff-1111-4000-8000-00000000b001', 'assistant-test'
);

-- As the customer: open a thread and send the first message.
set local role authenticated;
set local request.jwt.claims to '{"sub": "aaaaaaaa-1111-4000-8000-000000000001", "role": "authenticated"}';

select public.start_chat_conversation(
  'customer_support'::public.chat_conversation_type, null, null, null, 'Where is my order NZ900001?'
);

create temporary table assist_probe on commit drop as
  select id as conv from public.my_chat_conversations('all', null, null, 20, 0);
grant select on assist_probe to authenticated;

-- The functions ------------------------------------------------------------------
reset role;

select has_function(
  'public', 'chat_assistant_facts', array['uuid', 'uuid', 'text'],
  'the facts function exists'
);
select has_function(
  'public', 'chat_assistant_reply', array['uuid', 'uuid', 'text', 'jsonb'],
  'the reply function exists'
);

select ok(
  not has_function_privilege('authenticated', 'public.chat_assistant_facts(uuid, uuid, text)', 'execute'),
  'a signed-in customer cannot read the assistant facts'
);
select ok(
  not has_function_privilege('anon', 'public.chat_assistant_reply(uuid, uuid, text, jsonb)', 'execute'),
  'a visitor cannot write an automatic answer'
);
select ok(
  has_function_privilege('service_role', 'public.chat_assistant_facts(uuid, uuid, text)', 'execute'),
  'the server may read the facts'
);
select ok(
  has_function_privilege('service_role', 'public.chat_assistant_reply(uuid, uuid, text, jsonb)', 'execute'),
  'the server may write the answer'
);

-- Facts are answered for the thread's own customer and for nobody else.
select is(
  public.chat_assistant_facts(
    (select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000002', null
  ),
  null::jsonb,
  'another customer learns nothing about this thread'
);
select is(
  public.chat_assistant_facts(
    (select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', 'NZ900001'
  ) -> 'order' ->> 'orderNumber',
  'NZ900001',
  'the customer''s own order is found for the assistant'
);
select is(
  public.chat_assistant_facts(
    (select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', 'NZ999999'
  ) ->> 'order',
  null::text,
  'an order the customer does not own is not found'
);

-- The v2 facts ----------------------------------------------------------------------
-- More fixtures (as the owner): a second order per case, addresses, shipments and products.
insert into public.addresses (user_id, recipient_name, phone, division, district, area, address_line, is_default) values
  ('aaaaaaaa-1111-4000-8000-000000000001', 'Assistant One', '+8801712345678', 'Dhaka', 'Dhaka', 'Gulshan', 'Road 1 House 2', true),
  ('aaaaaaaa-1111-4000-8000-000000000002', 'Assistant Two', '+8801712345679', 'Sylhet', 'Sylhet', 'Zindabazar', 'Road 5 House 6', true);

-- NZ900002 belongs to the OTHER customer; NZ900003 was delivered just now, NZ900004 long ago;
-- NZ900005 has a real shipment, NZ900006 only a test shipment. All of one customer's are older
-- than NZ900001 so the newest-first order is predictable.
insert into public.orders (
  id, order_number, user_id, status, item_count, subtotal_minor, shipping_fee_minor, total_minor,
  delivery_zone, ship_recipient_name, ship_phone, ship_division, ship_district, ship_area,
  ship_address_line, idempotency_key, request_fingerprint, placed_at
) values
  ('ffffffff-1111-4000-8000-000000000002', 'NZ900002', 'aaaaaaaa-1111-4000-8000-000000000002', 'shipped',
   1, 100000, 6000, 106000, 'inside_dhaka', 'Assistant Two', '+8801712345679', 'Dhaka', 'Dhaka', 'Gulshan', 'Road 2',
   'ffffffff-1111-4000-8000-00000000b002', 'assistant-test', now() - interval '1 day'),
  ('ffffffff-1111-4000-8000-000000000003', 'NZ900003', 'aaaaaaaa-1111-4000-8000-000000000001', 'delivered',
   1, 100000, 6000, 106000, 'inside_dhaka', 'Assistant One', '+8801712345678', 'Dhaka', 'Dhaka', 'Gulshan', 'Road 1',
   'ffffffff-1111-4000-8000-00000000b003', 'assistant-test', now() - interval '2 days'),
  ('ffffffff-1111-4000-8000-000000000004', 'NZ900004', 'aaaaaaaa-1111-4000-8000-000000000001', 'delivered',
   1, 100000, 6000, 106000, 'inside_dhaka', 'Assistant One', '+8801712345678', 'Dhaka', 'Dhaka', 'Gulshan', 'Road 1',
   'ffffffff-1111-4000-8000-00000000b004', 'assistant-test', now() - interval '3 days'),
  ('ffffffff-1111-4000-8000-000000000005', 'NZ900005', 'aaaaaaaa-1111-4000-8000-000000000001', 'shipped',
   1, 100000, 6000, 106000, 'inside_dhaka', 'Assistant One', '+8801712345678', 'Dhaka', 'Dhaka', 'Gulshan', 'Road 1',
   'ffffffff-1111-4000-8000-00000000b005', 'assistant-test', now() - interval '4 days'),
  ('ffffffff-1111-4000-8000-000000000006', 'NZ900006', 'aaaaaaaa-1111-4000-8000-000000000001', 'shipped',
   1, 100000, 6000, 106000, 'inside_dhaka', 'Assistant One', '+8801712345678', 'Dhaka', 'Dhaka', 'Gulshan', 'Road 1',
   'ffffffff-1111-4000-8000-00000000b006', 'assistant-test', now() - interval '5 days');

insert into public.order_status_history (order_id, from_status, to_status, actor_kind, created_at) values
  ('ffffffff-1111-4000-8000-000000000003', 'shipped', 'delivered', 'system', now()),
  ('ffffffff-1111-4000-8000-000000000004', 'shipped', 'delivered', 'system', now() - interval '30 days');

insert into public.shipments (
  order_id, provider, status, is_mock, booking_key, merchant_ref, consignment_id, tracking_code,
  weight_grams, cod_amount_minor, delivery_zone, expected_charge_minor
) values
  ('ffffffff-1111-4000-8000-000000000005', 'pathao', 'in_transit', false, gen_random_uuid(), 'NZ900005-F',
   'CONS-REAL', 'TRK-REAL', 500, 106000, 'inside_dhaka', 9900),
  ('ffffffff-1111-4000-8000-000000000006', 'pathao', 'in_transit', true, gen_random_uuid(), 'NZ900006-F',
   'CONS-MOCK', 'TRK-MOCK', 500, 106000, 'inside_dhaka', 9900);

insert into public.categories (id, slug, name, is_active) values
  ('ca000000-0000-4000-8000-0000000a5a01', 'assist-cat', 'Assistant category', true);
insert into public.products (id, category_id, slug, sku, name, price_minor, stock_quantity, max_order_quantity, status) values
  ('0d000000-0000-4000-8000-0000000a5a01', 'ca000000-0000-4000-8000-0000000a5a01', 'assist-shirt', 'AST-SHIRT', 'Assistant shirt', 100000, 5, 10, 'active'),
  ('0d000000-0000-4000-8000-0000000a5a02', 'ca000000-0000-4000-8000-0000000a5a01', 'assist-draft', 'AST-DRAFT', 'Assistant draft', 9900, 9, 10, 'draft');
insert into public.product_attributes (id, slug, name, position) values
  ('a5000000-0000-4000-8000-0000000a5a01', 'ast-size', 'Size', 0),
  ('a5000000-0000-4000-8000-0000000a5a02', 'ast-colour', 'Colour', 1);
insert into public.product_attribute_values (id, attribute_id, slug, value, position) values
  ('a6000000-0000-4000-8000-0000000a5a01', 'a5000000-0000-4000-8000-0000000a5a01', 'm', 'M', 0),
  ('a6000000-0000-4000-8000-0000000a5a02', 'a5000000-0000-4000-8000-0000000a5a01', 'l', 'L', 1),
  ('a6000000-0000-4000-8000-0000000a5a03', 'a5000000-0000-4000-8000-0000000a5a02', 'red', 'Red', 0),
  ('a6000000-0000-4000-8000-0000000a5a04', 'a5000000-0000-4000-8000-0000000a5a02', 'blue', 'Blue', 1);
insert into public.product_variants (id, product_id, sku, stock_quantity, is_active, position) values
  ('0e100000-0000-4000-8000-0000000a5a01', '0d000000-0000-4000-8000-0000000a5a01', 'AST-SHIRT-M-RED', 5, true, 0),
  ('0e100000-0000-4000-8000-0000000a5a02', '0d000000-0000-4000-8000-0000000a5a01', 'AST-SHIRT-L-BLUE', 0, true, 1),
  ('0e100000-0000-4000-8000-0000000a5a03', '0d000000-0000-4000-8000-0000000a5a01', 'AST-SHIRT-M-BLUE', 5, false, 2);
insert into public.product_variant_values (variant_id, attribute_id, attribute_value_id) values
  ('0e100000-0000-4000-8000-0000000a5a01', 'a5000000-0000-4000-8000-0000000a5a01', 'a6000000-0000-4000-8000-0000000a5a01'),
  ('0e100000-0000-4000-8000-0000000a5a01', 'a5000000-0000-4000-8000-0000000a5a02', 'a6000000-0000-4000-8000-0000000a5a03'),
  ('0e100000-0000-4000-8000-0000000a5a02', 'a5000000-0000-4000-8000-0000000a5a01', 'a6000000-0000-4000-8000-0000000a5a02'),
  ('0e100000-0000-4000-8000-0000000a5a02', 'a5000000-0000-4000-8000-0000000a5a02', 'a6000000-0000-4000-8000-0000000a5a04'),
  ('0e100000-0000-4000-8000-0000000a5a03', 'a5000000-0000-4000-8000-0000000a5a01', 'a6000000-0000-4000-8000-0000000a5a01'),
  ('0e100000-0000-4000-8000-0000000a5a03', 'a5000000-0000-4000-8000-0000000a5a02', 'a6000000-0000-4000-8000-0000000a5a04');

-- Delivery charges: none set -> null for both zones; both set -> the amounts; one set -> the other null.
delete from public.delivery_charges;
select is(
  public.chat_assistant_facts((select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', null)
    -> 'deliveryCharges',
  '{"insideDhaka": null, "outsideDhaka": null}'::jsonb,
  'with no delivery charge set, both zones are null'
);
insert into public.delivery_charges (zone, amount_minor) values ('inside_dhaka', 6000), ('outside_dhaka', 12000);
select is(
  public.chat_assistant_facts((select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', null)
    -> 'deliveryCharges',
  '{"insideDhaka": 6000, "outsideDhaka": 12000}'::jsonb,
  'both zone amounts are handed over in poisha'
);
delete from public.delivery_charges where zone = 'outside_dhaka';
select is(
  public.chat_assistant_facts((select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', null)
    -> 'deliveryCharges' ->> 'outsideDhaka',
  null::text,
  'a zone without a charge stays null even when the other is set'
);

-- The customer's own default address zone, and nobody else's.
select is(
  public.chat_assistant_facts((select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', null)
    ->> 'defaultZone',
  'inside_dhaka',
  'the zone comes from the customer''s own default address, not the other customer''s Sylhet one'
);
delete from public.addresses where user_id = 'aaaaaaaa-1111-4000-8000-000000000001';
select is(
  public.chat_assistant_facts((select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', null)
    ->> 'defaultZone',
  null::text,
  'without a default address of their own there is no zone'
);

-- Order facts: shape, ownership and the linked order.
select is(
  public.chat_assistant_facts(
    (select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', 'NZ900001'
  ) -> 'order' ->> 'paymentStatus',
  'pending',
  'the order carries its payment status'
);
select is(
  public.chat_assistant_facts(
    (select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', 'NZ900001'
  ) -> 'order' -> 'returnEligible',
  'false'::jsonb,
  'an order that is not delivered is not return-eligible'
);
select is(
  public.chat_assistant_facts(
    (select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', 'NZ900001'
  ) -> 'order' -> 'shipment',
  'null'::jsonb,
  'an order with no shipment has none'
);

select is(
  (
    select count(*)
    from jsonb_array_elements(
      public.chat_assistant_facts((select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', null)
        -> 'recentOrders'
    ) as e (o)
    where e.o ->> 'orderNumber' = 'NZ900002'
  ),
  0::bigint,
  'another customer''s order is never among the recent orders'
);
select is(
  public.chat_assistant_facts((select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', null)
    -> 'recentOrders' -> 0 ->> 'orderNumber',
  'NZ900001',
  'the recent orders are the customer''s own, newest first (and at most three)'
);

update public.chat_conversations set kind = 'order_support', order_id = 'ffffffff-1111-4000-8000-000000000001'
  where id = (select conv from assist_probe);
select is(
  public.chat_assistant_facts(
    (select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', 'NZ900002'
  ) ->> 'order',
  null::text,
  'naming another customer''s order returns nothing - not even the linked order in its place'
);
select is(
  public.chat_assistant_facts((select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', null)
    -> 'order' ->> 'orderNumber',
  'NZ900001',
  'with no number named, the order the thread is about is returned'
);

-- Return eligibility follows request_return: delivered, inside the window from delivery.
select is(
  public.chat_assistant_facts(
    (select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', 'NZ900003'
  ) -> 'order' -> 'returnEligible',
  'true'::jsonb,
  'an order delivered just now is inside the return window'
);
select is(
  public.chat_assistant_facts(
    (select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', 'NZ900004'
  ) -> 'order' -> 'returnEligible',
  'false'::jsonb,
  'an order delivered 30 days ago is outside the return window'
);
select isnt(
  public.chat_assistant_facts(
    (select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', 'NZ900004'
  ) -> 'order' ->> 'deliveredAt',
  null::text,
  'the delivery time comes from the order''s own history'
);

-- Shipments: a real one is reported without costs; a test one is not reported at all.
select is(
  public.chat_assistant_facts(
    (select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', 'NZ900005'
  ) -> 'order' -> 'shipment' ->> 'trackingCode',
  'TRK-REAL',
  'the tracking code of a real shipment is available'
);
select is(
  public.chat_assistant_facts(
    (select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', 'NZ900005'
  ) -> 'order' -> 'shipment' ->> 'providerName',
  (select display_name from public.courier_accounts where provider = 'pathao'),
  'the courier''s display name is available'
);
select is(
  array(
    select k from jsonb_object_keys(
      public.chat_assistant_facts(
        (select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', 'NZ900005'
      ) -> 'order' -> 'shipment'
    ) as k order by k
  ),
  array['providerName', 'status', 'trackingCode'],
  'a shipment fact carries no costs, ids or provider data'
);
select is(
  public.chat_assistant_facts(
    (select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', 'NZ900006'
  ) -> 'order' -> 'shipment',
  'null'::jsonb,
  'a test shipment is never reported'
);

-- Products: active options with their own stock; a product that is not active has no name.
update public.chat_conversations set kind = 'customer_support', order_id = null, product_id = '0d000000-0000-4000-8000-0000000a5a01'
  where id = (select conv from assist_probe);
select is(
  public.chat_assistant_facts((select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', null)
    -> 'product' -> 'variants',
  '[{"options": ["M", "Red"], "stock": 5}, {"options": ["L", "Blue"], "stock": 0}]'::jsonb,
  'the active options are listed with their own stock; the switched-off one is not'
);
select is(
  public.chat_assistant_facts((select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', null)
    -> 'product' ->> 'name',
  'Assistant shirt',
  'an active product is named'
);
update public.chat_conversations set product_id = '0d000000-0000-4000-8000-0000000a5a02'
  where id = (select conv from assist_probe);
select is(
  public.chat_assistant_facts((select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', null)
    -> 'product' ->> 'name',
  null::text,
  'the name of a draft product is never handed over'
);
select is(
  public.chat_assistant_facts((select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001', null)
    -> 'product' ->> 'status',
  'draft',
  'but its status is, so the assistant can say it is not on sale'
);

select ok(
  not has_function_privilege('authenticated', 'private.chat_assistant_order_fact(uuid)', 'execute')
    and not has_function_privilege('anon', 'private.chat_assistant_order_fact(uuid)', 'execute'),
  'the per-order helper is not callable by a signed-in customer or a visitor'
);

-- The reply ------------------------------------------------------------------
select is(
  public.chat_assistant_reply(
    (select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001',
    'Order NZ900001 is waiting to be confirmed.', '{"assistant":"order_status"}'::jsonb
  ) ->> 'kind',
  'automated',
  'the store answers once, as an automatic message'
);
select is(
  public.chat_assistant_reply(
    (select conv from assist_probe), 'aaaaaaaa-1111-4000-8000-000000000001',
    'A second answer for the same message.', '{}'::jsonb
  ),
  null::jsonb,
  'one message never earns two automatic answers'
);

select * from finish();
rollback;



