-- The wishlist: one list per account, invisible to everyone else, idempotent writes, and a
-- guest merge that never duplicates or overwrites. Fixtures use the `zw-` namespace and fixed
-- ids; everything runs in a transaction that is rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

-- ---------------------------------------------------------------------------
-- Fixtures (as the database owner)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000e1', 'zw-one@example.com', now()),
  ('00000000-0000-4000-8000-0000000000e2', 'zw-two@example.com', now());

update public.user_roles set role = 'customer'
 where user_id in ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e2');

insert into public.categories (id, slug, name, is_active) values
  ('ca000000-0000-4000-8000-0000000000f1', 'zw-shirts', 'ZW Shirts', true),
  ('ca000000-0000-4000-8000-0000000000f2', 'zw-hidden', 'ZW Hidden', false);

insert into public.products
  (id, category_id, slug, sku, name, price_minor, stock_quantity, status)
values
  ('0d000000-0000-4000-8000-0000000000f1', 'ca000000-0000-4000-8000-0000000000f1',
   'zw-shirt', 'ZW-SHIRT', 'ZW Shirt', 10000, 5, 'active'),
  ('0d000000-0000-4000-8000-0000000000f2', 'ca000000-0000-4000-8000-0000000000f1',
   'zw-draft', 'ZW-DRAFT', 'ZW Draft', 10000, 5, 'draft'),
  ('0d000000-0000-4000-8000-0000000000f3', 'ca000000-0000-4000-8000-0000000000f2',
   'zw-in-hidden-category', 'ZW-HIDDEN', 'ZW Hidden', 10000, 5, 'active');

-- ---------------------------------------------------------------------------
-- 1. Only the owner can see a row, and nobody can write one directly
-- ---------------------------------------------------------------------------

insert into public.wishlist_items (user_id, product_id)
values ('00000000-0000-4000-8000-0000000000e1', '0d000000-0000-4000-8000-0000000000f1');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e1", "role": "authenticated"}';
select is((select count(*)::int from public.wishlist_items), 1, 'the owner sees their own saved product');
select is(
  jsonb_array_length(public.my_wishlist()), 1, 'my_wishlist() answers the one saved product'
);
select is(
  (public.my_wishlist() -> 0 ->> 'productId')::uuid,
  '0d000000-0000-4000-8000-0000000000f1'::uuid,
  'the saved product is the one that was saved'
);
select isnt(
  public.my_wishlist() -> 0 -> 'product' ->> 'name', null, 'a product on sale comes back with its details'
);

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e2", "role": "authenticated"}';
select is(
  (select count(*)::int from public.wishlist_items), 0, 'a second customer sees none of the first list'
);
select is(jsonb_array_length(public.my_wishlist()), 0, 'and their own list is empty');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e1", "role": "authenticated"}';
select throws_ok(
  $$ insert into public.wishlist_items (user_id, product_id)
     values ('00000000-0000-4000-8000-0000000000e1', '0d000000-0000-4000-8000-0000000000f2') $$,
  '42501', null, 'a client cannot insert a row directly'
);
select throws_ok(
  $$ delete from public.wishlist_items where user_id = '00000000-0000-4000-8000-0000000000e1' $$,
  '42501', null, 'a client cannot delete a row directly'
);

-- ---------------------------------------------------------------------------
-- 2. Saving is idempotent and only what is on sale can be saved
-- ---------------------------------------------------------------------------

select is(jsonb_array_length(public.wishlist_add('0d000000-0000-4000-8000-0000000000f1')), 1,
  'saving a product already saved changes nothing');
select throws_ok(
  $$ select public.wishlist_add('0d000000-0000-4000-8000-0000000000f2') $$,
  'NZ404', null, 'a draft product cannot be saved'
);
select throws_ok(
  $$ select public.wishlist_add('0d000000-0000-4000-8000-0000000000f3') $$,
  'NZ404', null, 'a product in a hidden category cannot be saved'
);
select throws_ok(
  $$ select public.wishlist_add('00000000-0000-4000-8000-0000000000ff') $$,
  'NZ404', null, 'an unknown product cannot be saved'
);

select is(
  (select count(*)::int from public.wishlist_items where user_id = '00000000-0000-4000-8000-0000000000e1'),
  1, 'no duplicate row appeared'
);

-- ---------------------------------------------------------------------------
-- 3. A hidden product stays in the list, without its details
-- ---------------------------------------------------------------------------

reset role;
update public.products set status = 'draft' where id = '0d000000-0000-4000-8000-0000000000f1';

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e1", "role": "authenticated"}';
select is(jsonb_array_length(public.my_wishlist()), 1, 'a product taken off sale stays in the list');
select is(public.my_wishlist() -> 0 -> 'product', 'null'::jsonb,
  'its name, price and picture are not disclosed once it is no longer public');

reset role;
update public.products set status = 'active' where id = '0d000000-0000-4000-8000-0000000000f1';

-- ---------------------------------------------------------------------------
-- 4. The guest merge is idempotent and never overwrites
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e2", "role": "authenticated"}';
select is(
  jsonb_array_length(public.wishlist_merge(array['zw-shirt', 'zw-draft', 'zw-in-hidden-category', 'not-a-product'])),
  1, 'only products on sale are merged in'
);
select is(
  jsonb_array_length(public.wishlist_merge(array['zw-shirt', 'zw-shirt'])),
  1, 'merging again, with repeats, adds nothing'
);
select is(
  (select count(*)::int from public.wishlist_items where user_id = '00000000-0000-4000-8000-0000000000e2'),
  1, 'the account holds exactly one row after two merges'
);

select is(jsonb_array_length(public.wishlist_remove('0d000000-0000-4000-8000-0000000000f1')), 0,
  'removing a saved product empties the list');
select is(jsonb_array_length(public.wishlist_remove('0d000000-0000-4000-8000-0000000000f1')), 0,
  'removing it again succeeds and changes nothing');

-- ---------------------------------------------------------------------------
-- 5. Guests hold nothing, and the merge cannot touch someone else's list
-- ---------------------------------------------------------------------------

reset role;
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select throws_ok($$ select public.my_wishlist() $$, '42501', null, 'a guest has no wishlist');
select throws_ok(
  $$ select public.wishlist_merge(array['zw-shirt']) $$, '42501', null,
  'a guest cannot merge into an account'
);
select throws_ok(
  $$ select public.wishlist_add('0d000000-0000-4000-8000-0000000000f1') $$, '42501', null,
  'a guest cannot save a product'
);

select * from finish();
rollback;
