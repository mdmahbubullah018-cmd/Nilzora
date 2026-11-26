-- Database-level checks for colour kinds and absolute stock: an attribute kind and a swatch
-- are validated rather than stored blindly, setting stock stores the counted number and
-- records the ledger entry behind it. Rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000e1', 'colour-staff@example.com', now()),
  ('00000000-0000-4000-8000-0000000000e2', 'colour-buyer@example.com', now());
update public.user_roles set role = 'staff' where user_id = '00000000-0000-4000-8000-0000000000e1';

insert into public.categories (id, slug, name) values
  ('cb000000-0000-4000-8000-0000000000e1', 'colour-test', 'Colour test');
insert into public.products (id, category_id, slug, sku, name, price_minor, stock_quantity, status, moderation_status) values
  ('0e000000-0000-4000-8000-0000000000e1', 'cb000000-0000-4000-8000-0000000000e1', 'colour-shirt', 'COL-SHIRT', 'Shirt', 100000, 0, 'draft', 'not_submitted');

-- Seeded with fixed ids: staff cannot read these tables directly under RLS.
insert into public.product_attributes (id, slug, name, position) values
  ('a3000000-0000-4000-8000-0000000000e1', 'colour', 'Colour', 0),
  ('a3000000-0000-4000-8000-0000000000e2', 'size', 'Size', 1);
insert into public.product_attribute_values (id, attribute_id, slug, value, position) values
  ('a4000000-0000-4000-8000-0000000000e1', 'a3000000-0000-4000-8000-0000000000e1', 'black', 'Black', 0);
insert into public.product_variants (id, product_id, sku, price_minor, stock_quantity) values
  ('0e100000-0000-4000-8000-0000000000e1', '0e000000-0000-4000-8000-0000000000e1', 'COL-SHIRT-BLACK', 100000, 0);
insert into public.product_variant_values (variant_id, attribute_id, attribute_value_id) values
  ('0e100000-0000-4000-8000-0000000000e1', 'a3000000-0000-4000-8000-0000000000e1',
   'a4000000-0000-4000-8000-0000000000e1');

set local role authenticated;

-- A customer may change neither the attribute kind nor a variant's stock.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e2", "role": "authenticated"}';
select throws_ok($$ select public.admin_save_attribute('a3000000-0000-4000-8000-0000000000e1',
  'colour', 'Colour', 0, true, 'color') $$,
  'NZ403', null, 'a customer cannot save an attribute');
select throws_ok($$ select public.admin_set_variant_stock('0e100000-0000-4000-8000-0000000000e1', 3, 'stock take') $$,
  'NZ403', null, 'a customer cannot set variant stock');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e1", "role": "authenticated"}';

-- Kind and swatch are validated, not stored blindly.
select throws_ok($$ select public.admin_save_attribute('a3000000-0000-4000-8000-0000000000e1',
  'colour', 'Colour', 0, true, 'colourful') $$,
  'NZ412', null, 'an unknown attribute kind is refused');
select lives_ok($$ select public.admin_save_attribute('a3000000-0000-4000-8000-0000000000e1',
  'colour', 'Colour', 0, true, 'color') $$,
  'staff save a colour attribute');
select throws_ok($$ select public.admin_save_attribute_value('a4000000-0000-4000-8000-0000000000e1',
  'a3000000-0000-4000-8000-0000000000e1', 'black', 'Black', 0, 'not-a-colour') $$,
  'NZ412', null, 'a swatch that is not a colour is refused');
select lives_ok($$ select public.admin_save_attribute_value('a4000000-0000-4000-8000-0000000000e1',
  'a3000000-0000-4000-8000-0000000000e1', 'black', 'Black', 0, '#0F172A') $$,
  'staff save a colour value with its swatch');
select lives_ok($$ select public.admin_save_attribute('a3000000-0000-4000-8000-0000000000e2',
  'size', 'Size', 1, true) $$,
  'an attribute saved without a kind is accepted');

select lives_ok($$ select public.admin_set_variant_stock('0e100000-0000-4000-8000-0000000000e1', 4,
  'stock take from zero') $$,
  'staff set the stock to a counted number');
select throws_ok($$ select public.admin_set_variant_stock('0e100000-0000-4000-8000-0000000000e1', -1,
  'stock take from zero') $$,
  'NZ412', null, 'a negative count is refused');
select throws_ok($$ select public.admin_set_variant_stock('0e100000-0000-4000-8000-0000000000e1', 5, 'no') $$,
  'NZ412', null, 'a reason too short to audit is refused');

reset role;

select is(
  (select swatch_hex from public.product_attribute_values where id = 'a4000000-0000-4000-8000-0000000000e1'),
  '#0F172A',
  'the swatch is stored');
select is(
  (select kind from public.product_attributes where id = 'a3000000-0000-4000-8000-0000000000e2'),
  'other',
  'an attribute saved without a kind stays the other kind');
select is(
  (select stock_quantity from public.product_variants where id = '0e100000-0000-4000-8000-0000000000e1'),
  4,
  'the count is absolute, not a change');
select is(
  (select change || '/' || stock_after || '/' || reason::text from public.inventory_movements
    where variant_id = '0e100000-0000-4000-8000-0000000000e1' order by created_at desc limit 1),
  '4/4/stock_set',
  'the ledger records the counted number it set');

select * from finish();
rollback;
