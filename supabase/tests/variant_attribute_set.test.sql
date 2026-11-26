-- Database-level checks for product variants: only accounts with products.update save them,
-- every variant of one product names the same attributes (so shoppers can always choose it),
-- a variant needs at least one value, combinations stay unique, and the product's stock is
-- the total of its active variants. Rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000f1', 'var-staff@example.com', now()),
  ('00000000-0000-4000-8000-0000000000f2', 'var-buyer@example.com', now());
update public.user_roles set role = 'staff' where user_id = '00000000-0000-4000-8000-0000000000f1';

insert into public.categories (id, slug, name) values
  ('ca000000-0000-4000-8000-0000000000f1', 'var-test', 'Variant test');
insert into public.products (id, category_id, slug, sku, name, price_minor, stock_quantity, status, moderation_status) values
  ('0d000000-0000-4000-8000-0000000000f1', 'ca000000-0000-4000-8000-0000000000f1', 'var-shirt', 'VAR-SHIRT', 'Shirt', 100000, 0, 'draft', 'not_submitted');

insert into public.product_attributes (id, slug, name, position) values
  ('a1000000-0000-4000-8000-0000000000f1', 'var-size', 'Size', 0),
  ('a1000000-0000-4000-8000-0000000000f2', 'var-colour', 'Colour', 1);
insert into public.product_attribute_values (id, attribute_id, slug, value, position) values
  ('a2000000-0000-4000-8000-0000000000f1', 'a1000000-0000-4000-8000-0000000000f1', 'm', 'M', 0),
  ('a2000000-0000-4000-8000-0000000000f2', 'a1000000-0000-4000-8000-0000000000f1', 'l', 'L', 1),
  ('a2000000-0000-4000-8000-0000000000f3', 'a1000000-0000-4000-8000-0000000000f2', 'navy', 'Navy', 0),
  ('a2000000-0000-4000-8000-0000000000f4', 'a1000000-0000-4000-8000-0000000000f2', 'white', 'White', 1);

set local role authenticated;

-- A customer cannot save variants at all.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f2", "role": "authenticated"}';
select throws_ok($$ select public.admin_save_variant(null, '0d000000-0000-4000-8000-0000000000f1',
  'VAR-SHIRT-M-NAVY', null, null, null, 0, true,
  array['a2000000-0000-4000-8000-0000000000f1', 'a2000000-0000-4000-8000-0000000000f3']::uuid[]) $$,
  'NZ403', null, 'a customer cannot save a variant');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}';

select throws_ok($$ select public.admin_save_variant(null, '0d000000-0000-4000-8000-0000000000f1',
  'VAR-SHIRT-NONE', null, null, null, 0, true, '{}'::uuid[]) $$,
  'NZ471', null, 'a variant needs at least one value');

select lives_ok($$ select public.admin_save_variant(null, '0d000000-0000-4000-8000-0000000000f1',
  'VAR-SHIRT-M-NAVY', null, null, null, 0, true,
  array['a2000000-0000-4000-8000-0000000000f1', 'a2000000-0000-4000-8000-0000000000f3']::uuid[]) $$,
  'staff save the first variant (Size and Colour)');

select throws_ok($$ select public.admin_save_variant(null, '0d000000-0000-4000-8000-0000000000f1',
  'VAR-SHIRT-L', null, null, null, 1, true,
  array['a2000000-0000-4000-8000-0000000000f2']::uuid[]) $$,
  'NZ471', null, 'a sibling naming fewer attributes is refused');

select throws_ok($$ select public.admin_save_variant(null, '0d000000-0000-4000-8000-0000000000f1',
  'VAR-SHIRT-WHITE', null, null, null, 1, true,
  array['a2000000-0000-4000-8000-0000000000f4']::uuid[]) $$,
  'NZ471', null, 'a sibling naming other attributes is refused');

select lives_ok($$ select public.admin_save_variant(null, '0d000000-0000-4000-8000-0000000000f1',
  'VAR-SHIRT-L-WHITE', 120000, 150000, null, 1, true,
  array['a2000000-0000-4000-8000-0000000000f2', 'a2000000-0000-4000-8000-0000000000f4']::uuid[]) $$,
  'a sibling naming the same attributes is saved, with its own price');

select throws_ok($$ select public.admin_save_variant(null, '0d000000-0000-4000-8000-0000000000f1',
  'VAR-SHIRT-L-WHITE-2', null, null, null, 2, true,
  array['a2000000-0000-4000-8000-0000000000f2', 'a2000000-0000-4000-8000-0000000000f4']::uuid[]) $$,
  'NZ472', null, 'the same combination cannot be sold twice');

-- Editing a variant is checked against its siblings, not against itself. The variant's id is
-- looked up as the table owner (end users cannot read the table); the call still acts as the
-- staff account named by the claims.
reset role;
select lives_ok($$ select public.admin_save_variant(
  (select id from public.product_variants where sku = 'VAR-SHIRT-M-NAVY'),
  '0d000000-0000-4000-8000-0000000000f1', 'VAR-SHIRT-M-NAVY', 99000, null, null, 0, true,
  array['a2000000-0000-4000-8000-0000000000f1', 'a2000000-0000-4000-8000-0000000000f3']::uuid[]) $$,
  'an existing variant can be edited with the same attributes');
select throws_ok($$ select public.admin_save_variant(
  (select id from public.product_variants where sku = 'VAR-SHIRT-M-NAVY'),
  '0d000000-0000-4000-8000-0000000000f1', 'VAR-SHIRT-M-NAVY', null, null, null, 0, true,
  array['a2000000-0000-4000-8000-0000000000f1']::uuid[]) $$,
  'NZ471', null, 'an edit cannot drop an attribute its siblings name');

select is((select price_minor from public.product_variants where sku = 'VAR-SHIRT-M-NAVY'), 99000::bigint,
  'the edit kept its new price');

-- Stock lives on the variants; the product shows their total.
update public.product_variants set stock_quantity = 4 where sku = 'VAR-SHIRT-M-NAVY';
update public.product_variants set stock_quantity = 3 where sku = 'VAR-SHIRT-L-WHITE';
select is((select stock_quantity from public.products where id = '0d000000-0000-4000-8000-0000000000f1'), 7,
  'the product stock is the total of its variants');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}';
select throws_ok($$ select public.admin_adjust_stock('0d000000-0000-4000-8000-0000000000f1', 2, 'Received') $$,
  'NZ412', 'adjust the stock of each option instead',
  'a product with variants takes no stock change of its own (staff hold inventory.adjust)');

select * from finish();
rollback;
