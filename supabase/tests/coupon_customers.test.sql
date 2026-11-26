-- Coupons for chosen customers (20261204200000): only a recipient sees, collects, previews
-- or redeems a targeted coupon or voucher, and another customer is refused on every path;
-- recipients must be customer accounts; a redeemed coupon keeps its code and discount while
-- its other settings stay editable, and its redemption rows never change; staff read the
-- coupon of an order; invalid order transitions are refused.
-- Runs inside a transaction that is rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(34);

create temporary table t (key text primary key, value text) on commit drop;
grant select, insert, update on t to authenticated;

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000e1', 'cc-admin@example.com', now()),
  ('00000000-0000-4000-8000-0000000000e4', 'cc-recipient@example.com', now()),
  ('00000000-0000-4000-8000-0000000000e5', 'cc-other@example.com', now());
update public.user_roles set role = 'admin' where user_id = '00000000-0000-4000-8000-0000000000e1';

insert into public.delivery_charges (zone, amount_minor) values ('inside_dhaka', 6000)
  on conflict (zone) do update set amount_minor = excluded.amount_minor;
insert into public.addresses (id, user_id, recipient_name, phone, division, district, area, address_line) values
  ('ad000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000e4',
   'CC Recipient', '+8801712345681', 'Dhaka', 'Dhaka', 'Dhanmondi', 'House 4, Road 4'),
  ('ad000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000e5',
   'CC Other', '+8801712345682', 'Dhaka', 'Dhaka', 'Gulshan', 'House 5, Road 5');
insert into public.categories (id, slug, name, is_active) values
  ('ca000000-0000-4000-8000-0000000000e1', 'cc-shirts', 'CC Shirts', true);
insert into public.products (id, category_id, slug, sku, name, price_minor, stock_quantity, status, moderation_status) values
  ('0d000000-0000-4000-8000-0000000000e1', 'ca000000-0000-4000-8000-0000000000e1', 'cc-shirt', 'CC-SHIRT', 'CC Shirt', 100000, 50, 'active', 'approved');

-- A ৳50 code and a ৳30 voucher, both for chosen customers once targeting is saved.
insert into public.coupons (id, code, kind, value, per_customer_limit, is_active) values
  ('c0000000-0000-4000-8000-0000000000e1', 'CC-FORYOU', 'fixed', 5000, 5, true);
insert into public.coupons (id, code, kind, value, per_customer_limit, is_active, is_voucher, title) values
  ('c0000000-0000-4000-8000-0000000000e2', 'CC-VOUCH', 'fixed', 3000, 1, true, true, 'Just for you');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e1", "role": "authenticated"}';

-- Targeting: recipients must be named, and must be customers.
select throws_ok($$ select public.admin_save_coupon_targeting('c0000000-0000-4000-8000-0000000000e1',
    false, null, 'storewide', '{}', '{}', 'selected_customers', null, '{}') $$,
  'NZ412', null, 'a targeted coupon needs at least one recipient');
select throws_ok($$ select public.admin_save_coupon_targeting('c0000000-0000-4000-8000-0000000000e1',
    false, null, 'storewide', '{}', '{}', 'selected_customers', null,
    array['00000000-0000-4000-8000-0000000000e1']::uuid[]) $$,
  'NZ412', null, 'a staff account cannot be a recipient');
select lives_ok($$ select public.admin_save_coupon_targeting('c0000000-0000-4000-8000-0000000000e1',
    false, null, 'storewide', '{}', '{}', 'selected_customers', null,
    array['00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000e4']::uuid[]) $$,
  'an admin targets the code at one customer');
select lives_ok($$ select public.admin_save_coupon_targeting('c0000000-0000-4000-8000-0000000000e2',
    true, 'Just for you', 'storewide', '{}', '{}', 'selected_customers', null,
    array['00000000-0000-4000-8000-0000000000e4']::uuid[]) $$,
  'and the voucher too');
select is(jsonb_array_length(public.admin_coupon_targeting('c0000000-0000-4000-8000-0000000000e1') -> 'customers'), 1,
  'the admin sees one recipient (duplicates collapse)');
select is(public.admin_coupon_targeting('c0000000-0000-4000-8000-0000000000e1') -> 'customers' -> 0 ->> 'email',
  'cc-recipient@example.com', 'with the contact details customers.read allows');

-- Another customer: refused everywhere, and the voucher is not even listed.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e5", "role": "authenticated"}';
select ok(not exists (select 1 from jsonb_array_elements(public.voucher_center()) v
           where v ->> 'id' = 'c0000000-0000-4000-8000-0000000000e2'),
  'the Voucher Center hides a targeted voucher from other customers');
select throws_ok($$ select public.collect_voucher('c0000000-0000-4000-8000-0000000000e2') $$,
  'NZ459', 'this voucher is not available', 'another customer cannot collect it');
select is(public.quote_cart_with_coupon(
    '[{"productId":"0d000000-0000-4000-8000-0000000000e1","quantity":1}]'::jsonb,
    'ad000000-0000-4000-8000-0000000000e5', 'CC-FORYOU') ->> 'couponProblem',
  'this offer is not available on your account', 'the checkout preview refuses the code');
select throws_ok($$ select public.place_cod_order(
    '33333333-3333-4333-8333-3333333333e5', 'ad000000-0000-4000-8000-0000000000e5',
    '[{"productId":"0d000000-0000-4000-8000-0000000000e1","quantity":1}]'::jsonb,
    null, null, 'CC-FORYOU') $$,
  'NZ459', null, 'and placing an order with it is refused');
select throws_ok($$ select public.place_cod_order(
    '33333333-3333-4333-8333-3333333333e6', 'ad000000-0000-4000-8000-0000000000e5',
    '[{"productId":"0d000000-0000-4000-8000-0000000000e1","quantity":1}]'::jsonb,
    null, null, 'CC-VOUCH') $$,
  'NZ459', null, 'as is redeeming the voucher code');
select throws_ok($$ select count(*) from public.coupon_customers $$,
  '42501', null, 'customers cannot read the recipient list');
select throws_ok($$ select public.admin_coupon_targeting('c0000000-0000-4000-8000-0000000000e1') $$,
  'NZ403', null, 'nor the targeting');
select throws_ok($$ select public.admin_order_coupons(array['NZ000000']) $$,
  'NZ403', null, 'nor any order''s coupon');

-- The recipient: sees, collects, previews and redeems.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e4", "role": "authenticated"}';
select ok(exists (select 1 from jsonb_array_elements(public.voucher_center()) v
           where v ->> 'id' = 'c0000000-0000-4000-8000-0000000000e2'),
  'the recipient sees the targeted voucher');
select is(public.collect_voucher('c0000000-0000-4000-8000-0000000000e2') ->> 'state', 'collected',
  'and collects it');
select is((public.quote_cart_with_coupon(
    '[{"productId":"0d000000-0000-4000-8000-0000000000e1","quantity":1}]'::jsonb,
    'ad000000-0000-4000-8000-0000000000e4', 'CC-FORYOU') ->> 'discountMinor')::bigint, 5000::bigint,
  'the checkout preview gives the recipient the discount');
insert into t select 'order', public.place_cod_order(
    '33333333-3333-4333-8333-3333333333e4', 'ad000000-0000-4000-8000-0000000000e4',
    '[{"productId":"0d000000-0000-4000-8000-0000000000e1","quantity":1}]'::jsonb,
    null, null, 'CC-FORYOU') ->> 'orderNumber';
select isnt((select value from t where key = 'order'), null, 'the recipient places an order with the code');
select is(jsonb_array_length(public.my_vouchers()), 1, 'My Vouchers lists the targeted voucher');

reset role;
select is((select discount_minor from public.coupon_redemptions
           where coupon_id = 'c0000000-0000-4000-8000-0000000000e1'), 5000::bigint,
  'one ৳50 redemption is recorded');
set local role authenticated;

-- Staff read the coupon of the order.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e1", "role": "authenticated"}';
select is(public.admin_order_coupons(array[(select value from t where key = 'order')]) -> 0 ->> 'code',
  'CC-FORYOU', 'staff see which coupon priced the order');

-- A redeemed coupon keeps its code and discount; everything else stays editable.
select throws_ok($$ select public.admin_save_coupon('c0000000-0000-4000-8000-0000000000e1',
    'CC-RENAMED', 'fixed', 5000, 0, null, null, null, null, 5, true, null) $$,
  'NZ442', null, 'the code of a redeemed coupon cannot change');
select throws_ok($$ select public.admin_save_coupon('c0000000-0000-4000-8000-0000000000e1',
    'CC-FORYOU', 'fixed', 9000, 0, null, null, null, null, 5, true, null) $$,
  'NZ442', null, 'nor its discount');
select throws_ok($$ select public.admin_save_coupon('c0000000-0000-4000-8000-0000000000e1',
    'CC-FORYOU', 'percent', 10, 0, null, null, null, null, 5, true, null) $$,
  'NZ442', null, 'nor its discount type');
select lives_ok($$ select public.admin_save_coupon('c0000000-0000-4000-8000-0000000000e1',
    'CC-FORYOU', 'fixed', 5000, 20000, null, null, now() + interval '30 days', 100, 2, false, 'Now with an end date') $$,
  'its dates, limits, minimum spend, note and switch can change');
select lives_ok($$ select public.admin_save_coupon('c0000000-0000-4000-8000-0000000000e2',
    'CC-VOUCH2', 'fixed', 4000, 0, null, null, null, null, 1, true, null) $$,
  'an unredeemed coupon can still change its code and discount');

reset role;
select is((select discount_minor from public.coupon_redemptions
           where coupon_id = 'c0000000-0000-4000-8000-0000000000e1'), 5000::bigint,
  'editing never rewrites the recorded redemption');
select is((select discount_minor from public.orders where order_number = (select value from t where key = 'order')),
  5000::bigint, 'nor the order''s discount');
set local role authenticated;

-- Removing the recipient: the voucher disappears for them and can no longer be redeemed.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e1", "role": "authenticated"}';
select lives_ok($$ select public.admin_save_coupon_targeting('c0000000-0000-4000-8000-0000000000e2',
    true, 'Just for you', 'storewide', '{}', '{}', 'selected_customers', null,
    array['00000000-0000-4000-8000-0000000000e5']::uuid[]) $$,
  'an admin swaps the voucher''s recipient');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e4", "role": "authenticated"}';
select is(jsonb_array_length(public.my_vouchers()), 0, 'the former recipient no longer sees it');
select is(public.quote_cart_with_coupon(
    '[{"productId":"0d000000-0000-4000-8000-0000000000e1","quantity":1}]'::jsonb,
    'ad000000-0000-4000-8000-0000000000e4', 'CC-VOUCH2') ->> 'couponProblem',
  'this offer is not available on your account', 'nor redeem it');

-- Order transitions the server refuses.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e1", "role": "authenticated"}';
select throws_ok($$ select public.admin_update_order_status((select value from t where key = 'order'), 'shipped') $$,
  'NZ434', null, 'a pending order cannot jump to shipped');
select lives_ok($$ select public.admin_update_order_status((select value from t where key = 'order'), s)
  from unnest(array['confirmed', 'processing', 'shipped']::public.order_status[]) as s $$,
  'the order moves through fulfilment step by step');
select throws_ok($$ select public.admin_update_order_status((select value from t where key = 'order'), 'cancelled', 'Customer changed mind') $$,
  'NZ434', null, 'a shipped order cannot be cancelled');

select * from finish();
rollback;
