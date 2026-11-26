-- Vouchers and coupon targeting: collecting (once, by the caller, within the window and
-- caps), redeeming only after collecting, scope measured on the qualifying lines, the
-- Voucher Center hiding a voucher 4 days after it ends (and showing it again with new
-- dates), one voucher or one code per order, and deleting only unredeemed coupons.
-- Runs inside a transaction that is rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000d1', 'vc-admin@example.com', now()),
  ('00000000-0000-4000-8000-0000000000d4', 'vc-buyer@example.com', now()),
  ('00000000-0000-4000-8000-0000000000d5', 'vc-other@example.com', now());
update public.user_roles set role = 'admin' where user_id = '00000000-0000-4000-8000-0000000000d1';

insert into public.delivery_charges (zone, amount_minor) values ('inside_dhaka', 6000)
  on conflict (zone) do update set amount_minor = excluded.amount_minor;
insert into public.addresses (id, user_id, recipient_name, phone, division, district, area, address_line)
values ('ad000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000d4',
        'VC Buyer', '+8801712345679', 'Dhaka', 'Dhaka', 'Dhanmondi', 'House 2, Road 2');
insert into public.categories (id, slug, name, is_active) values
  ('ca000000-0000-4000-8000-0000000000d1', 'vc-shoes', 'VC Shoes', true),
  ('ca000000-0000-4000-8000-0000000000d2', 'vc-bags', 'VC Bags', true);
insert into public.products (id, category_id, slug, sku, name, price_minor, stock_quantity, status, moderation_status) values
  ('0d000000-0000-4000-8000-0000000000d1', 'ca000000-0000-4000-8000-0000000000d1', 'vc-shoe', 'VC-SHOE', 'VC Shoe', 200000, 20, 'active', 'approved'),
  ('0d000000-0000-4000-8000-0000000000d2', 'ca000000-0000-4000-8000-0000000000d2', 'vc-bag', 'VC-BAG', 'VC Bag', 100000, 20, 'active', 'approved');

-- A 10% shoes voucher (min spend 1500, at most 2 collections), a code, and a voucher that
-- ended 5 days ago.
insert into public.coupons (id, code, kind, value, min_order_minor, per_customer_limit, is_active,
                            is_voucher, title, scope, category_ids, collect_limit) values
  ('c0000000-0000-4000-8000-0000000000d1', 'VC-SHOES10', 'percent', 10, 150000, 1, true,
   true, 'Shoes 10% off', 'categories', array['ca000000-0000-4000-8000-0000000000d1']::uuid[], 2);
insert into public.coupons (id, code, kind, value, per_customer_limit, is_active) values
  ('c0000000-0000-4000-8000-0000000000d2', 'VCCODE', 'fixed', 5000, 1, true);
insert into public.coupons (id, code, kind, value, per_customer_limit, is_active, is_voucher, starts_at, ends_at) values
  ('c0000000-0000-4000-8000-0000000000d3', 'VC-OLD', 'fixed', 5000, 1, true, true,
   now() - interval '20 days', now() - interval '5 days');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d4", "role": "authenticated"}';

-- Before collecting.
select is((select v ->> 'state' from jsonb_array_elements(public.voucher_center()) v
           where v ->> 'id' = 'c0000000-0000-4000-8000-0000000000d1'), 'available',
  'the voucher shows as available before it is collected');
select is((select v ->> 'code' from jsonb_array_elements(public.voucher_center()) v
           where v ->> 'id' = 'c0000000-0000-4000-8000-0000000000d1'), null,
  'its code is not revealed before it is collected');
select ok(not exists (select 1 from jsonb_array_elements(public.voucher_center()) v
           where v ->> 'id' = 'c0000000-0000-4000-8000-0000000000d3'),
  'a voucher that ended more than 4 days ago is hidden');
select is(public.quote_cart_with_coupon(
    '[{"productId":"0d000000-0000-4000-8000-0000000000d1","quantity":1}]'::jsonb,
    'ad000000-0000-4000-8000-0000000000d4', 'VC-SHOES10') ->> 'couponProblem',
  'collect this voucher before using it', 'a voucher cannot be used before it is collected');

-- Collecting.
select is(public.collect_voucher('c0000000-0000-4000-8000-0000000000d1') ->> 'state', 'collected',
  'collecting answers the voucher as collected');
select is(public.collect_voucher('c0000000-0000-4000-8000-0000000000d1') ->> 'state', 'collected',
  'collecting again is harmless');
reset role;
select is((select count(*)::int from public.voucher_collections
           where coupon_id = 'c0000000-0000-4000-8000-0000000000d1'), 1, 'and records one collection only');
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d4", "role": "authenticated"}';
select is(jsonb_array_length(public.my_vouchers()), 1, 'My Vouchers lists it');
select throws_ok($$ select public.collect_voucher('c0000000-0000-4000-8000-0000000000d2') $$,
  'NZ459', null, 'a plain code cannot be collected');
select throws_ok($$ select public.collect_voucher('c0000000-0000-4000-8000-0000000000d3') $$,
  'NZ459', null, 'an expired voucher cannot be collected');

-- Redeeming: scope and minimum spend measured on the shoes only.
select is(public.quote_cart_with_coupon(
    '[{"productId":"0d000000-0000-4000-8000-0000000000d2","quantity":2}]'::jsonb,
    'ad000000-0000-4000-8000-0000000000d4', 'VC-SHOES10') ->> 'couponProblem',
  'nothing in your cart qualifies for this offer', 'a cart without shoes does not qualify');
select is((public.quote_cart_with_coupon(
    '[{"productId":"0d000000-0000-4000-8000-0000000000d1","quantity":1},{"productId":"0d000000-0000-4000-8000-0000000000d2","quantity":1}]'::jsonb,
    'ad000000-0000-4000-8000-0000000000d4', 'VC-SHOES10') ->> 'discountMinor')::bigint, 20000::bigint,
  '10% is taken off the shoes only (2000 of the 3000 subtotal)');

select lives_ok($$ select public.place_cod_order(
    '22222222-2222-4222-8222-2222222222d4', 'ad000000-0000-4000-8000-0000000000d4',
    '[{"productId":"0d000000-0000-4000-8000-0000000000d1","quantity":1}]'::jsonb,
    null, null, 'VC-SHOES10') $$, 'an order redeems the collected voucher');
reset role;
select is((select count(*)::int from public.coupon_redemptions
           where coupon_id = 'c0000000-0000-4000-8000-0000000000d1'), 1, 'one redemption is recorded');
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d4", "role": "authenticated"}';
select is((select v ->> 'state' from jsonb_array_elements(public.my_vouchers()) v
           where v ->> 'id' = 'c0000000-0000-4000-8000-0000000000d1'), 'used',
  'the voucher then shows as used');

-- Another customer: the collection cap.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d5", "role": "authenticated"}';
select lives_ok($$ select public.collect_voucher('c0000000-0000-4000-8000-0000000000d1') $$,
  'a second customer collects the voucher');

-- An admin re-dates the old voucher: it shows again.
reset role;
update public.coupons set ends_at = now() + interval '10 days' where id = 'c0000000-0000-4000-8000-0000000000d3';
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d4", "role": "authenticated"}';
select ok(exists (select 1 from jsonb_array_elements(public.voucher_center()) v
           where v ->> 'id' = 'c0000000-0000-4000-8000-0000000000d3'),
  'a voucher given new dates shows again');

-- Deleting.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d1", "role": "authenticated"}';
select throws_ok($$ select public.admin_delete_coupon('c0000000-0000-4000-8000-0000000000d1') $$,
  'NZ442', null, 'a redeemed voucher cannot be deleted');
select lives_ok($$ select public.admin_delete_coupon('c0000000-0000-4000-8000-0000000000d2') $$,
  'an unused code can be deleted');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d4", "role": "authenticated"}';
select throws_ok($$ select public.admin_delete_coupon('c0000000-0000-4000-8000-0000000000d3') $$,
  'NZ403', null, 'a customer cannot delete coupons');

select * from finish();
rollback;
