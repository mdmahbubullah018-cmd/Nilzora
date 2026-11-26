-- Database-level checks for the catalog, addresses and Cash-on-Delivery orders:
-- Row Level Security, privileges, server-side pricing, stock movement, idempotency
-- and cancellation. Runs inside a transaction that is rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(58);

-- ---------------------------------------------------------------------------
-- Fixtures (as the database owner)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('a1a1a1a1-0000-4000-8000-000000000001', 'buyer-a@example.com', now(), '{"full_name": "Buyer A"}'),
  ('b2b2b2b2-0000-4000-8000-000000000002', 'buyer-b@example.com', now(), '{"full_name": "Buyer B"}'),
  ('c3c3c3c3-0000-4000-8000-000000000003', 'held@example.com', now(), '{}');
update public.profiles set status = 'suspended' where id = 'c3c3c3c3-0000-4000-8000-000000000003';

insert into public.delivery_charges (zone, amount_minor) values ('inside_dhaka', 6000), ('outside_dhaka', 12000)
  on conflict (zone) do update set amount_minor = excluded.amount_minor;

insert into public.categories (id, slug, name, is_active) values
  ('ca000000-0000-4000-8000-000000000001', 'tst-open', 'Test open', true),
  ('ca000000-0000-4000-8000-000000000002', 'tst-hidden', 'Test hidden', false);

insert into public.products (id, category_id, slug, sku, name, price_minor, stock_quantity, max_order_quantity, status) values
  ('0d000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'tst-lamp', 'TST-LAMP', 'Testable desk lamp', 10000, 5, 3, 'active'),
  ('0d000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000001', 'tst-mug', 'TST-MUG', 'Testable mug', 2500, 1, 10, 'active'),
  ('0d000000-0000-4000-8000-000000000003', 'ca000000-0000-4000-8000-000000000001', 'tst-draft', 'TST-DRAFT', 'Testable draft', 9900, 9, 10, 'draft'),
  ('0d000000-0000-4000-8000-000000000004', 'ca000000-0000-4000-8000-000000000002', 'tst-hidden-item', 'TST-HIDDEN', 'Testable hidden', 9900, 9, 10, 'active'),
  ('0d000000-0000-4000-8000-000000000005', 'ca000000-0000-4000-8000-000000000001', 'tst-pen', 'TST-PEN', 'Testable pen', 1000, 100, 10, 'active');

-- Buyer B's address (inserted by the owner; B's own session is not needed for it).
insert into public.addresses (id, user_id, recipient_name, phone, division, district, area, address_line) values
  ('ad000000-0000-4000-8000-0000000000b1', 'b2b2b2b2-0000-4000-8000-000000000002', 'Buyer B', '+8801812345678',
   'Chattogram', 'Chattogram', 'Agrabad', 'House 2, Road 3'),
  ('ad000000-0000-4000-8000-0000000000c1', 'c3c3c3c3-0000-4000-8000-000000000003', 'Held', '+8801912345678',
   'Dhaka', 'Dhaka', 'Mirpur', 'House 9, Road 9');

select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'public.categories'::regclass, 'public.products'::regclass, 'public.addresses'::regclass,
  'public.orders'::regclass, 'public.order_items'::regclass, 'public.order_status_history'::regclass,
  'public.inventory_movements'::regclass, 'public.delivery_charges'::regclass, 'public.bd_districts'::regclass
)), 'RLS is enabled on every commerce table');
select is((select count(*)::int from public.bd_districts), 64, 'all 64 districts are listed');
select is((select count(distinct division)::int from public.bd_districts), 8, 'in 8 divisions');

-- ---------------------------------------------------------------------------
-- Anonymous visitor
-- ---------------------------------------------------------------------------

set local role anon;
set local request.jwt.claims to '{"role": "anon"}';

select is((select count(*)::int from public.categories where slug like 'tst-%'), 1,
  'visitors see active categories only');
select results_eq(
  $$ select slug from public.products where slug like 'tst-%' order by slug $$,
  $$ values ('tst-lamp'), ('tst-mug'), ('tst-pen') $$,
  'visitors see only active products in active categories (no drafts, no hidden categories)');
select is(
  (select count(*)::int from public.catalog_products('tst-open', null, 'price_asc', 60, 0)), 3,
  'the catalog listing shows the same products');
select is(
  (select slug from public.catalog_products(null, '''testable'':* & ''lam'':*', 'relevance', 10, 0)), 'tst-lamp',
  'prefix search finds a product by the start of its words');
select is(
  (select count(*)::int from public.catalog_products('tst-hidden', null, 'featured', 60, 0)), 0,
  'a hidden category lists nothing');
select throws_ok($$ select * from public.catalog_products(null, null, 'random()', 10, 0) $$,
  '22023', null, 'unknown sort orders are refused');
select throws_ok($$ select id from public.addresses $$, '42501', null, 'visitors cannot read addresses');
select throws_ok($$ select id from public.orders $$, '42501', null, 'visitors cannot read orders');
select throws_ok($$ select id from public.inventory_movements $$, '42501', null, 'visitors cannot read the stock ledger');
select throws_ok($$ update public.products set price_minor = 1 where slug = 'tst-lamp' $$,
  '42501', null, 'visitors cannot change prices');

select is(
  (public.quote_cart('[{"productId": "0d000000-0000-4000-8000-000000000001", "quantity": 2}]'))->>'subtotalMinor',
  '20000', 'a quote prices the cart from the catalog');
select is(
  (public.quote_cart('[{"productId": "0d000000-0000-4000-8000-000000000003", "quantity": 1}]'))->'lines'->0,
  '{"productId": "0d000000-0000-4000-8000-000000000003", "slug": null, "name": null, "sku": null, "variantId": null, "variantLabel": null, "unitPriceMinor": null, "compareAtPriceMinor": null, "listPriceMinor": null, "campaignDiscountMinor": 0, "campaign": null, "quantity": 1, "lineTotalMinor": null, "availableQuantity": null, "problem": "unavailable"}'::jsonb,
  'a draft product is reported unavailable without revealing its details');
select is(
  (public.quote_cart('[{"productId": "0d000000-0000-4000-8000-000000000002", "quantity": 2}]'))->'lines'->0->>'problem',
  'insufficient_stock', 'a quote flags quantities above the stock');
select is(
  (public.quote_cart('[{"productId": "0d000000-0000-4000-8000-000000000001", "quantity": 4}]'))->'lines'->0->>'problem',
  'quantity_limit', 'a quote flags quantities above the per-order limit');
select throws_ok(
  $$ select public.quote_cart('[{"productId": "0d000000-0000-4000-8000-000000000001", "quantity": 1, "priceMinor": 1}, {"productId": "0d000000-0000-4000-8000-000000000001", "quantity": 1}]') $$,
  'NZ412', null, 'a cart naming a product twice is refused');
select throws_ok($$ select public.quote_cart('[{"productId": "0d000000-0000-4000-8000-000000000001", "quantity": 0}]') $$,
  'NZ412', null, 'a zero quantity is refused');
select throws_ok(
  $$ select public.place_cod_order(gen_random_uuid(), 'ad000000-0000-4000-8000-0000000000b1', '[{"productId": "0d000000-0000-4000-8000-000000000001", "quantity": 1}]') $$,
  '42501', null, 'visitors cannot place orders');

-- ---------------------------------------------------------------------------
-- Customer A
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "a1a1a1a1-0000-4000-8000-000000000001", "role": "authenticated"}';

select lives_ok($$
  insert into public.addresses (recipient_name, phone, division, district, area, address_line)
  values ('Buyer A', '+8801712345678', 'Dhaka', 'Dhaka', 'Dhanmondi', 'House 1, Road 1')
$$, 'a customer adds an address');
select is((select is_default from public.addresses where area = 'Dhanmondi'), true,
  'the first address becomes the default');
select lives_ok($$
  insert into public.addresses (recipient_name, phone, division, district, area, address_line, is_default)
  values ('Buyer A', '+8801712345678', 'Khulna', 'Khulna', 'Sonadanga', 'House 5, Road 5', true)
$$, 'a second address can become the default');
select is((select count(*)::int from public.addresses where is_default), 1, 'there is only ever one default');
select throws_ok($$
  insert into public.addresses (recipient_name, phone, division, district, area, address_line)
  values ('Buyer A', '+8801712345678', 'Sylhet', 'Dhaka', 'Somewhere', 'House 1, Road 1')
$$, '23503', null, 'a district must belong to the named division');
select throws_ok($$
  insert into public.addresses (user_id, recipient_name, phone, division, district, area, address_line)
  values ('b2b2b2b2-0000-4000-8000-000000000002', 'Planted', '+8801712345678', 'Dhaka', 'Dhaka', 'Gulshan', 'House 7, Road 7')
$$, '42501', null, 'a customer cannot add an address to another account');
select is((select count(*)::int from public.addresses), 2, 'a customer sees only their own addresses');

create temporary table placed on commit drop as
  select public.place_cod_order(
    'e1000000-0000-4000-8000-000000000001',
    (select id from public.addresses where area = 'Dhanmondi'),
    '[{"productId": "0d000000-0000-4000-8000-000000000001", "quantity": 2}, {"productId": "0d000000-0000-4000-8000-000000000002", "quantity": 1}]',
    'Please call before delivery'
  ) as result;

select is((select result->>'created' from placed), 'true', 'a customer places a COD order');
select results_eq(
  $$ select subtotal_minor, shipping_fee_minor, total_minor, item_count, status::text, payment_status::text
     from public.orders where order_number = (select result->>'orderNumber' from placed) $$,
  $$ values (22500::bigint, 6000::bigint, 28500::bigint, 3, 'pending', 'pending') $$,
  'totals come from the catalog and the inside-Dhaka delivery charge; payment stays pending');
select is(
  (select array_agg(product_name || ' x' || quantity || ' @' || unit_price_minor order by product_name)
   from public.order_items where order_id = (select (result->>'orderId')::uuid from placed)),
  array['Testable desk lamp x2 @10000', 'Testable mug x1 @2500'],
  'order items keep a snapshot of the products as sold');
select is(
  (public.place_cod_order(
    'e1000000-0000-4000-8000-000000000001',
    (select id from public.addresses where area = 'Dhanmondi'),
    '[{"productId": "0d000000-0000-4000-8000-000000000002", "quantity": 1}, {"productId": "0d000000-0000-4000-8000-000000000001", "quantity": 2}]',
    'Please call before delivery'
  ))->>'orderNumber',
  (select result->>'orderNumber' from placed),
  'repeating the request with the same key returns the same order');
select throws_ok($$
  select public.place_cod_order(
    'e1000000-0000-4000-8000-000000000001',
    (select id from public.addresses where area = 'Dhanmondi'),
    '[{"productId": "0d000000-0000-4000-8000-000000000005", "quantity": 1}]')
$$, 'NZ416', null, 'reusing a key for a different cart is refused');
select throws_ok($$
  select public.place_cod_order(gen_random_uuid(), (select id from public.addresses where area = 'Dhanmondi'),
    '[{"productId": "0d000000-0000-4000-8000-000000000002", "quantity": 1}]')
$$, 'NZ414', null, 'an out-of-stock product cannot be ordered');
select throws_ok($$
  select public.place_cod_order(gen_random_uuid(), (select id from public.addresses where area = 'Dhanmondi'),
    '[{"productId": "0d000000-0000-4000-8000-000000000003", "quantity": 1}]')
$$, 'NZ413', null, 'a draft product cannot be ordered');
select throws_ok($$
  select public.place_cod_order(gen_random_uuid(), (select id from public.addresses where area = 'Dhanmondi'),
    '[{"productId": "0d000000-0000-4000-8000-000000000004", "quantity": 1}]')
$$, 'NZ413', null, 'a product in a hidden category cannot be ordered');
select throws_ok($$
  select public.place_cod_order(gen_random_uuid(), (select id from public.addresses where area = 'Dhanmondi'),
    '[{"productId": "0d000000-0000-4000-8000-000000000001", "quantity": 4}]')
$$, 'NZ415', null, 'the per-order quantity limit is enforced');
select throws_ok($$
  select public.place_cod_order(gen_random_uuid(), (select id from public.addresses where area = 'Dhanmondi'),
    '[{"productId": "0d000000-0000-4000-8000-000000000005", "quantity": 1}]', null, 1)
$$, 'NZ418', null, 'an order whose total changed since the customer saw it is refused');
select throws_ok($$
  select public.place_cod_order(gen_random_uuid(), 'ad000000-0000-4000-8000-0000000000b1',
    '[{"productId": "0d000000-0000-4000-8000-000000000005", "quantity": 1}]')
$$, 'NZ411', null, 'another customer''s address cannot be used');
select throws_ok($$ insert into public.orders (user_id, item_count, subtotal_minor, shipping_fee_minor, total_minor, delivery_zone,
    ship_recipient_name, ship_phone, ship_division, ship_district, ship_area, ship_address_line, idempotency_key, request_fingerprint)
  values ('a1a1a1a1-0000-4000-8000-000000000001', 1, 1, 0, 1, 'inside_dhaka', 'x', 'x', 'x', 'x', 'x', 'x', gen_random_uuid(), 'x') $$,
  '42501', null, 'customers cannot write orders directly');
select throws_ok($$ update public.orders set status = 'delivered' $$, '42501', null,
  'customers cannot change an order''s status directly');
select throws_ok($$ update public.products set stock_quantity = 999 $$, '42501', null,
  'customers cannot change stock');
select is(
  (public.quote_cart('[{"productId": "0d000000-0000-4000-8000-000000000005", "quantity": 3}]',
    (select id from public.addresses where area = 'Sonadanga')))->>'totalMinor',
  '15000', 'a checkout quote adds the outside-Dhaka delivery charge for the chosen address');

-- ---------------------------------------------------------------------------
-- Customer B: someone else's order is invisible and untouchable
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub": "b2b2b2b2-0000-4000-8000-000000000002", "role": "authenticated"}';

select is_empty($$ select id from public.orders where order_number = (select result->>'orderNumber' from placed) $$,
  'a customer cannot see another customer''s order');
select is_empty($$ select id from public.order_items where order_id = (select (result->>'orderId')::uuid from placed) $$,
  'or its items');
select throws_ok($$ select public.cancel_my_order((select result->>'orderNumber' from placed)) $$,
  'NZ404', null, 'or cancel it');

-- ---------------------------------------------------------------------------
-- Customer A cancels while pending; stock comes back
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub": "a1a1a1a1-0000-4000-8000-000000000001", "role": "authenticated"}';

select is((public.cancel_my_order((select result->>'orderNumber' from placed), 'Ordered by mistake'))->>'status',
  'cancelled', 'a customer cancels their own pending order');
select throws_ok($$ select public.cancel_my_order((select result->>'orderNumber' from placed)) $$,
  'NZ419', null, 'a cancelled order cannot be cancelled again');

reset role;

select results_eq(
  $$ select slug, stock_quantity from public.products where slug in ('tst-lamp', 'tst-mug') order by slug $$,
  $$ values ('tst-lamp', 5), ('tst-mug', 1) $$,
  'cancelling returns the stock');
select results_eq(
  $$ select reason::text, change from public.inventory_movements
     where order_id = (select (result->>'orderId')::uuid from placed) order by reason::text, change $$,
  $$ values ('order_cancelled', 1), ('order_cancelled', 2), ('order_placed', -2), ('order_placed', -1) $$,
  'every stock change is in the ledger');
select results_eq(
  $$ select coalesce(from_status::text, '-'), to_status::text, actor_kind::text from public.order_status_history
     where order_id = (select (result->>'orderId')::uuid from placed) order by id $$,
  $$ values ('-', 'pending', 'customer'), ('pending', 'cancelled', 'customer') $$,
  'the status history records placement and cancellation');
select is((select payment_status::text from public.orders where id = (select (result->>'orderId')::uuid from placed)),
  'cancelled', 'no cash is due on a cancelled order');

-- ---------------------------------------------------------------------------
-- Account and configuration guards
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "c3c3c3c3-0000-4000-8000-000000000003", "role": "authenticated"}';
select throws_ok($$
  select public.place_cod_order(gen_random_uuid(), 'ad000000-0000-4000-8000-0000000000c1',
    '[{"productId": "0d000000-0000-4000-8000-000000000005", "quantity": 1}]')
$$, 'NZ410', null, 'a suspended account cannot place orders');
select throws_ok($$
  insert into public.addresses (recipient_name, phone, division, district, area, address_line)
  values ('Held', '+8801912345678', 'Dhaka', 'Dhaka', 'Uttara', 'House 3, Road 3')
$$, '42501', null, 'a suspended account cannot add addresses');

set local request.jwt.claims to '{"sub": "a1a1a1a1-0000-4000-8000-000000000001", "role": "authenticated"}';
select lives_ok($$
  select public.place_cod_order(('e2000000-0000-4000-8000-00000000000' || n)::uuid,
    (select id from public.addresses where area = 'Dhanmondi'),
    '[{"productId": "0d000000-0000-4000-8000-000000000005", "quantity": 1}]')
  from generate_series(1, 5) as n
$$, 'five orders can wait for confirmation at once');
select throws_ok($$
  select public.place_cod_order(gen_random_uuid(), (select id from public.addresses where area = 'Dhanmondi'),
    '[{"productId": "0d000000-0000-4000-8000-000000000005", "quantity": 1}]')
$$, 'NZ420', null, 'a sixth pending order is refused');

reset role;
delete from public.delivery_charges where zone = 'outside_dhaka';
update public.orders set status = 'confirmed' where user_id = 'a1a1a1a1-0000-4000-8000-000000000001' and status = 'pending';
set local role authenticated;
select throws_ok($$
  select public.place_cod_order(gen_random_uuid(), (select id from public.addresses where area = 'Sonadanga'),
    '[{"productId": "0d000000-0000-4000-8000-000000000005", "quantity": 1}]')
$$, 'NZ417', null, 'without a delivery charge for the zone, orders are refused');

-- Account deletion runs as the Auth service's role, which has no rights on addresses;
-- the cascade's trigger must therefore run as its owner (live check: API integration tests).
reset role;
select ok((select prosecdef from pg_proc where oid = 'private.addresses_after_delete()'::regprocedure),
  'the address-delete trigger runs as its owner, so account deletion can cascade');
delete from auth.users where id = 'b2b2b2b2-0000-4000-8000-000000000002';
select is((select count(*)::int from public.addresses where user_id = 'b2b2b2b2-0000-4000-8000-000000000002'), 0,
  'an account''s addresses are deleted with it');

select * from finish();
rollback;
