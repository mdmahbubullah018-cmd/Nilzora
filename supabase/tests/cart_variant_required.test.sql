-- Database-level checks for saved carts and required variants: a product that has variants
-- can only be added with one of its own active variants (a variant is a complete attribute
-- combination), for a signed-in customer and for an anonymous guest alike; products that are
-- not on sale are refused; removing a legacy line always works; merging a guest cart keeps the
-- valid lines and leaves the refused ones behind. Rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(34);

-- ---------------------------------------------------------------------------
-- Fixtures (as the database owner)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000c1', 'cart-var-a@example.com', now()),
  ('00000000-0000-4000-8000-0000000000c2', 'cart-var-b@example.com', now());

insert into public.categories (id, slug, name, is_active) values
  ('ca000000-0000-4000-8000-0000000000c1', 'cvr-open', 'Cart variant open', true),
  ('ca000000-0000-4000-8000-0000000000c2', 'cvr-hidden', 'Cart variant hidden', false);

insert into public.products (id, category_id, slug, sku, name, price_minor, stock_quantity, max_order_quantity, status) values
  ('0d000000-0000-4000-8000-0000000000c1', 'ca000000-0000-4000-8000-0000000000c1', 'cvr-mug', 'CVR-MUG', 'Mug', 25000, 10, 10, 'active'),
  ('0d000000-0000-4000-8000-0000000000c2', 'ca000000-0000-4000-8000-0000000000c1', 'cvr-shirt', 'CVR-SHIRT', 'Shirt', 100000, 0, 10, 'active'),
  ('0d000000-0000-4000-8000-0000000000c3', 'ca000000-0000-4000-8000-0000000000c1', 'cvr-hoodie', 'CVR-HOODIE', 'Hoodie', 150000, 0, 10, 'active'),
  ('0d000000-0000-4000-8000-0000000000c4', 'ca000000-0000-4000-8000-0000000000c1', 'cvr-draft', 'CVR-DRAFT', 'Draft', 9900, 9, 10, 'draft'),
  ('0d000000-0000-4000-8000-0000000000c5', 'ca000000-0000-4000-8000-0000000000c2', 'cvr-hidden-item', 'CVR-HIDDEN', 'Hidden', 9900, 9, 10, 'active'),
  ('0d000000-0000-4000-8000-0000000000c6', 'ca000000-0000-4000-8000-0000000000c1', 'cvr-late', 'CVR-LATE', 'Late variants', 5000, 10, 10, 'active');

insert into public.product_attributes (id, slug, name, position) values
  ('a5000000-0000-4000-8000-0000000000c1', 'cvr-size', 'Size', 0),
  ('a5000000-0000-4000-8000-0000000000c2', 'cvr-colour', 'Colour', 1);
insert into public.product_attribute_values (id, attribute_id, slug, value, position) values
  ('a6000000-0000-4000-8000-0000000000c1', 'a5000000-0000-4000-8000-0000000000c1', 'm', 'M', 0),
  ('a6000000-0000-4000-8000-0000000000c2', 'a5000000-0000-4000-8000-0000000000c1', 'l', 'L', 1),
  ('a6000000-0000-4000-8000-0000000000c3', 'a5000000-0000-4000-8000-0000000000c2', 'red', 'Red', 0),
  ('a6000000-0000-4000-8000-0000000000c4', 'a5000000-0000-4000-8000-0000000000c2', 'blue', 'Blue', 1);

-- Shirt (Size and Colour): M/Red in stock with its own price, L/Blue sold out, M/Blue switched off.
-- Hoodie (Size only): one variant, used as "a variant of another product".
insert into public.product_variants (id, product_id, sku, price_minor, stock_quantity, is_active) values
  ('0e100000-0000-4000-8000-0000000000c1', '0d000000-0000-4000-8000-0000000000c2', 'CVR-SHIRT-M-RED', 120000, 5, true),
  ('0e100000-0000-4000-8000-0000000000c2', '0d000000-0000-4000-8000-0000000000c2', 'CVR-SHIRT-L-BLUE', null, 0, true),
  ('0e100000-0000-4000-8000-0000000000c3', '0d000000-0000-4000-8000-0000000000c2', 'CVR-SHIRT-M-BLUE', null, 5, false),
  ('0e100000-0000-4000-8000-0000000000c4', '0d000000-0000-4000-8000-0000000000c3', 'CVR-HOODIE-M', null, 5, true);
insert into public.product_variant_values (variant_id, attribute_id, attribute_value_id) values
  ('0e100000-0000-4000-8000-0000000000c1', 'a5000000-0000-4000-8000-0000000000c1', 'a6000000-0000-4000-8000-0000000000c1'),
  ('0e100000-0000-4000-8000-0000000000c1', 'a5000000-0000-4000-8000-0000000000c2', 'a6000000-0000-4000-8000-0000000000c3'),
  ('0e100000-0000-4000-8000-0000000000c2', 'a5000000-0000-4000-8000-0000000000c1', 'a6000000-0000-4000-8000-0000000000c2'),
  ('0e100000-0000-4000-8000-0000000000c2', 'a5000000-0000-4000-8000-0000000000c2', 'a6000000-0000-4000-8000-0000000000c4'),
  ('0e100000-0000-4000-8000-0000000000c3', 'a5000000-0000-4000-8000-0000000000c1', 'a6000000-0000-4000-8000-0000000000c1'),
  ('0e100000-0000-4000-8000-0000000000c3', 'a5000000-0000-4000-8000-0000000000c2', 'a6000000-0000-4000-8000-0000000000c4'),
  ('0e100000-0000-4000-8000-0000000000c4', 'a5000000-0000-4000-8000-0000000000c1', 'a6000000-0000-4000-8000-0000000000c1');

-- ---------------------------------------------------------------------------
-- Signed-in customer
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated"}';

select lives_ok($$ select public.cart_set_item('0d000000-0000-4000-8000-0000000000c1', null, 2) $$,
  'a product without variants is added without one');
select throws_ok($$ select public.cart_set_item('0d000000-0000-4000-8000-0000000000c2', null, 1) $$,
  'NZ471', null, 'a product with variants cannot be added without choosing one');
select throws_ok($$ select public.cart_set_item('0d000000-0000-4000-8000-0000000000c2',
  '0e100000-0000-4000-8000-0000000000c4', 1) $$,
  'NZ490', null, 'a variant of another product is refused');
select throws_ok($$ select public.cart_set_item('0d000000-0000-4000-8000-0000000000c2',
  '0e100000-0000-4000-8000-0000000000c3', 1) $$,
  'NZ470', null, 'a switched-off variant is refused');
select throws_ok($$ select public.cart_set_item('0d000000-0000-4000-8000-0000000000c2',
  'a6000000-0000-4000-8000-0000000000c1', 1) $$,
  'NZ490', null, 'a single attribute value is not a variant: only a full combination is accepted');
select throws_ok($$ select public.cart_set_item('0d000000-0000-4000-8000-0000000000c4', null, 1) $$,
  'NZ490', null, 'a draft product is refused');
select throws_ok($$ select public.cart_set_item('0d000000-0000-4000-8000-0000000000c5', null, 1) $$,
  'NZ490', null, 'a product in a hidden category is refused');
select throws_ok($$ select public.cart_set_item('0d000000-0000-4000-8000-0000000000ff', null, 1) $$,
  'NZ490', null, 'an unknown product is refused');
select throws_ok($$ select public.cart_set_item('0d000000-0000-4000-8000-0000000000c1', null, 101) $$,
  'NZ412', null, 'the quantity limit still applies');

select lives_ok($$ select public.cart_set_item('0d000000-0000-4000-8000-0000000000c2',
  '0e100000-0000-4000-8000-0000000000c1', 2) $$,
  'a complete, active variant is added');
select lives_ok($$ select public.cart_set_item('0d000000-0000-4000-8000-0000000000c2',
  '0e100000-0000-4000-8000-0000000000c2', 1) $$,
  'a sold-out variant is still stored (the quote decides stock)');

-- The quote prices the stored lines from the server's own data.
create temporary table cvr_quote on commit drop as
  select public.quote_cart((select lines from public.cart_snapshot(public.my_cart()))) as q;
grant select on cvr_quote to authenticated;

select is(
  (select l ->> 'variantLabel' from cvr_quote, jsonb_array_elements(q -> 'lines') l
   where l ->> 'variantId' = '0e100000-0000-4000-8000-0000000000c1'),
  'Size: M / Colour: Red', 'the quote labels the chosen combination');
select is(
  (select (l ->> 'unitPriceMinor')::bigint from cvr_quote, jsonb_array_elements(q -> 'lines') l
   where l ->> 'variantId' = '0e100000-0000-4000-8000-0000000000c1'),
  120000::bigint, 'the quote uses the variant price');
select is(
  (select l ->> 'problem' from cvr_quote, jsonb_array_elements(q -> 'lines') l
   where l ->> 'variantId' = '0e100000-0000-4000-8000-0000000000c1'),
  null, 'the in-stock variant line has no problem');
select is(
  (select l ->> 'problem' from cvr_quote, jsonb_array_elements(q -> 'lines') l
   where l ->> 'variantId' = '0e100000-0000-4000-8000-0000000000c2'),
  'insufficient_stock', 'the sold-out variant line is flagged by the quote');

-- A line stored before the rule (variant-less line, variants added later) can still be removed.
select lives_ok($$ select public.cart_set_item('0d000000-0000-4000-8000-0000000000c6', null, 3) $$,
  'a product without variants is added (before it gains variants)');
reset role;
insert into public.product_variants (id, product_id, sku, stock_quantity) values
  ('0e100000-0000-4000-8000-0000000000c5', '0d000000-0000-4000-8000-0000000000c6', 'CVR-LATE-M', 4);
insert into public.product_variant_values (variant_id, attribute_id, attribute_value_id) values
  ('0e100000-0000-4000-8000-0000000000c5', 'a5000000-0000-4000-8000-0000000000c1', 'a6000000-0000-4000-8000-0000000000c1');
select is((select count(*)::int from public.cart_items
  where product_id = '0d000000-0000-4000-8000-0000000000c6' and variant_id is null), 1,
  'the legacy variant-less line is in the cart');
set local role authenticated;
select throws_ok($$ select public.cart_set_item('0d000000-0000-4000-8000-0000000000c6', null, 5) $$,
  'NZ471', null, 'the legacy line cannot be raised any more');
select lives_ok($$ select public.cart_set_item('0d000000-0000-4000-8000-0000000000c6', null, 0) $$,
  'removing the legacy variant-less line works');
select lives_ok($$ select public.cart_remove_item('0d000000-0000-4000-8000-0000000000c6') $$,
  'cart_remove_item of an absent legacy line is harmless');
reset role;
select is((select count(*)::int from public.cart_items
  where product_id = '0d000000-0000-4000-8000-0000000000c6'), 0,
  'the legacy line is gone');
select is((select count(*)::int from public.cart_items i join public.carts c on c.id = i.cart_id
  where c.user_id = '00000000-0000-4000-8000-0000000000c1'), 3,
  'refused lines were never stored: only the mug and the two shirt lines remain');

-- ---------------------------------------------------------------------------
-- Anonymous guest (callable straight through the API as the anon role)
-- ---------------------------------------------------------------------------

set local role anon;
set local request.jwt.claims to '{"role": "anon"}';

select lives_ok($$ select public.start_guest_cart('99999999-0000-4000-8000-0000000000c1') $$,
  'a guest starts a cart');
select lives_ok($$ select public.guest_cart_set_item('99999999-0000-4000-8000-0000000000c1',
  '0d000000-0000-4000-8000-0000000000c1', null, 1) $$,
  'a guest adds a product without variants');
select throws_ok($$ select public.guest_cart_set_item('99999999-0000-4000-8000-0000000000c1',
  '0d000000-0000-4000-8000-0000000000c2', null, 1) $$,
  'NZ471', null, 'a guest cannot add a variant product without choosing one');
select throws_ok($$ select public.guest_cart_set_item('99999999-0000-4000-8000-0000000000c1',
  '0d000000-0000-4000-8000-0000000000c2', '0e100000-0000-4000-8000-0000000000c3', 1) $$,
  'NZ470', null, 'a guest cannot add a switched-off variant');
select throws_ok($$ select public.guest_cart_set_item('99999999-0000-4000-8000-0000000000c1',
  '0d000000-0000-4000-8000-0000000000c2', '0e100000-0000-4000-8000-0000000000c4', 1) $$,
  'NZ490', null, 'a guest cannot use a variant of another product');
select throws_ok($$ select public.guest_cart_set_item('99999999-0000-4000-8000-0000000000c1',
  '0d000000-0000-4000-8000-0000000000c4', null, 1) $$,
  'NZ490', null, 'a guest cannot add a draft product');
select throws_ok($$ select public.guest_cart_set_item('99999999-0000-4000-8000-0000000000ff',
  '0d000000-0000-4000-8000-0000000000c1', null, 1) $$,
  'NZ491', null, 'an unknown guest handle is still refused first');
select lives_ok($$ select public.guest_cart_set_item('99999999-0000-4000-8000-0000000000c1',
  '0d000000-0000-4000-8000-0000000000c2', '0e100000-0000-4000-8000-0000000000c1', 1) $$,
  'a guest adds a complete, active variant');

-- ---------------------------------------------------------------------------
-- Merge: valid lines are kept, refused lines are left behind, nothing fails
-- ---------------------------------------------------------------------------

reset role;
insert into public.carts (id, guest_token) values
  ('ca5a0000-0000-4000-8000-0000000000c2', '99999999-0000-4000-8000-0000000000c2');
insert into public.cart_items (cart_id, product_id, variant_id, quantity) values
  ('ca5a0000-0000-4000-8000-0000000000c2', '0d000000-0000-4000-8000-0000000000c1', null, 2),
  ('ca5a0000-0000-4000-8000-0000000000c2', '0d000000-0000-4000-8000-0000000000c2', '0e100000-0000-4000-8000-0000000000c1', 1),
  ('ca5a0000-0000-4000-8000-0000000000c2', '0d000000-0000-4000-8000-0000000000c2', null, 1),
  ('ca5a0000-0000-4000-8000-0000000000c2', '0d000000-0000-4000-8000-0000000000c2', '0e100000-0000-4000-8000-0000000000c3', 1),
  ('ca5a0000-0000-4000-8000-0000000000c2', '0d000000-0000-4000-8000-0000000000c4', null, 1);

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated"}';
select lives_ok($$ select public.cart_set_item('0d000000-0000-4000-8000-0000000000c2',
  '0e100000-0000-4000-8000-0000000000c1', 1) $$,
  'the second customer already holds one of the guest lines');
select lives_ok($$ select public.merge_guest_cart('99999999-0000-4000-8000-0000000000c2') $$,
  'merging a guest cart that holds refused lines does not fail');

reset role;
select results_eq(
  $$ select i.product_id::text, i.variant_id::text, i.quantity
     from public.cart_items i join public.carts c on c.id = i.cart_id
     where c.user_id = '00000000-0000-4000-8000-0000000000c2'
     order by i.product_id, i.variant_id $$,
  $$ values
     ('0d000000-0000-4000-8000-0000000000c1', null::text, 2),
     ('0d000000-0000-4000-8000-0000000000c2', '0e100000-0000-4000-8000-0000000000c1', 2) $$,
  'only valid lines are merged (and quantities add up); the variant-less, switched-off and draft lines are skipped');
select is((select count(*)::int from public.carts where guest_token = '99999999-0000-4000-8000-0000000000c2'), 0,
  'the guest cart is consumed');

select * from finish();
rollback;
