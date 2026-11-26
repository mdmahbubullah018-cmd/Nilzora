-- Database-level checks for product images: the table is closed to writes, public reads
-- see only products on sale, the admin functions check the CALLER's permission, images
-- follow the product content rules (locked while on sale or under review, a change sends
-- the product back for review), at most 8 per product, reorder must list every image,
-- delete returns the key and closes the gap, and every change is audited.
-- Runs inside a transaction that is rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(52);

-- ---------------------------------------------------------------------------
-- Fixtures (as the database owner)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000f1', 'img-staff@example.com', now()),
  ('00000000-0000-4000-8000-0000000000f2', 'img-mod@example.com', now()),
  ('00000000-0000-4000-8000-0000000000f3', 'img-buyer@example.com', now()),
  ('00000000-0000-4000-8000-0000000000f4', 'img-staff-denied@example.com', now()),
  ('00000000-0000-4000-8000-0000000000f5', 'img-admin@example.com', now());

update public.user_roles set role = 'staff' where user_id in
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f4');
update public.user_roles set role = 'moderator' where user_id = '00000000-0000-4000-8000-0000000000f2';
update public.user_roles set role = 'admin' where user_id = '00000000-0000-4000-8000-0000000000f5';
insert into public.user_permissions (user_id, permission, effect)
  values ('00000000-0000-4000-8000-0000000000f4', 'products.update', 'deny');

insert into public.categories (id, slug, name) values ('ca000000-0000-4000-8000-0000000000f1', 'img-test', 'Image test');
insert into public.products (id, category_id, slug, sku, name, price_minor, stock_quantity, status, moderation_status) values
  ('0d000000-0000-4000-8000-0000000000f1', 'ca000000-0000-4000-8000-0000000000f1', 'img-draft', 'IMG-DRAFT', 'Draft', 10000, 5, 'draft', 'approved'),
  ('0d000000-0000-4000-8000-0000000000f2', 'ca000000-0000-4000-8000-0000000000f1', 'img-live', 'IMG-LIVE', 'Live', 10000, 5, 'active', 'approved'),
  ('0d000000-0000-4000-8000-0000000000f3', 'ca000000-0000-4000-8000-0000000000f1', 'img-pending', 'IMG-PENDING', 'Pending', 10000, 5, 'draft', 'pending');
-- A product on sale already holds an image (trusted write by the owner of the data).
insert into public.product_images (id, product_id, storage_key, width, height, bytes, position) values
  ('11000000-0000-4000-8000-0000000000f2', '0d000000-0000-4000-8000-0000000000f2',
   'products/0d000000-0000-4000-8000-0000000000f2/11000000-0000-4000-8000-0000000000f2', 1200, 1200, 40000, 0);

create temporary table t (key text primary key, value text) on commit drop;
grant select, insert, update on t to authenticated;
insert into t select 'audit-before', count(*)::text from public.audit_log;
-- The audit log is append-only, so rows from earlier runs stay: assertions count changes since here.
insert into t select 'before-' || u.action, (select count(*) from public.audit_log a where a.action = u.action)::text
from unnest(array['product.image_added', 'product.image_updated', 'product.images_reordered', 'product.image_removed']) as u(action);

-- ---------------------------------------------------------------------------
-- Structure and privileges
-- ---------------------------------------------------------------------------

select ok((select relrowsecurity from pg_class where oid = 'public.product_images'::regclass),
  'RLS is enabled on product_images');
select ok(not exists (
  select 1 from unnest(array['anon', 'authenticated']) r, unnest(array['insert', 'update', 'delete']) p
  where has_table_privilege(r, 'public.product_images', p)
), 'anon and signed-in accounts hold no write privilege on the table');
select ok(not has_column_privilege('anon', 'public.product_images', 'created_by', 'select')
  and not has_column_privilege('authenticated', 'public.product_images', 'created_by', 'select'),
  'the author of an image is not readable by end users');
select ok(not has_function_privilege('anon', 'public.admin_add_product_image(uuid, uuid, integer, integer, integer, text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_delete_product_image(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.admin_reorder_product_images(uuid, uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.admin_update_product_image(uuid, text)', 'execute'),
  'anon cannot call the image functions');
select ok(has_function_privilege('authenticated', 'public.admin_add_product_image(uuid, uuid, integer, integer, integer, text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_delete_product_image(uuid)', 'execute'),
  'signed-in accounts can call the image functions (the functions check permissions)');
select throws_ok($$ insert into public.product_images (id, product_id, storage_key, width, height, bytes, position)
  values ('11000000-0000-4000-8000-0000000000aa', '0d000000-0000-4000-8000-0000000000f1', 'products/elsewhere/key', 800, 800, 100, 0) $$,
  '23514', null, 'a key that does not follow the ids is refused by the table');

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

set local role anon;
-- Counted over this test's own products: other images in a developer's database must not matter.
select is((select count(*)::int from public.product_images where product_id in ('0d000000-0000-4000-8000-0000000000f1', '0d000000-0000-4000-8000-0000000000f2', '0d000000-0000-4000-8000-0000000000f3')), 1, 'anon sees the image of the product on sale only');
select throws_ok($$ select created_by from public.product_images $$, '42501', null, 'anon cannot select created_by');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f3", "role": "authenticated"}';
select is((select count(*)::int from public.product_images where product_id in ('0d000000-0000-4000-8000-0000000000f1', '0d000000-0000-4000-8000-0000000000f2', '0d000000-0000-4000-8000-0000000000f3')), 1, 'a customer sees the image of the product on sale only');
select throws_ok($$ insert into public.product_images (id, product_id, storage_key, width, height, bytes, position)
  values ('11000000-0000-4000-8000-0000000000ab', '0d000000-0000-4000-8000-0000000000f1',
  'products/0d000000-0000-4000-8000-0000000000f1/11000000-0000-4000-8000-0000000000ab', 800, 800, 100, 0) $$,
  '42501', null, 'a customer cannot write the table');
select throws_ok($$ select public.admin_add_product_image('0d000000-0000-4000-8000-0000000000f1',
  '11000000-0000-4000-8000-0000000000b1', 800, 800, 1000, null) $$,
  'NZ403', null, 'a customer cannot add images');

-- ---------------------------------------------------------------------------
-- Permissions of the writers
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f2", "role": "authenticated"}';
select throws_ok($$ select public.admin_add_product_image('0d000000-0000-4000-8000-0000000000f1',
  '11000000-0000-4000-8000-0000000000b1', 800, 800, 1000, null) $$,
  'NZ403', null, 'a moderator (products.read only) cannot add images');
select throws_ok($$ select public.admin_delete_product_image('11000000-0000-4000-8000-0000000000f2') $$,
  'NZ403', null, 'a moderator cannot delete images');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f4", "role": "authenticated"}';
select throws_ok($$ select public.admin_add_product_image('0d000000-0000-4000-8000-0000000000f1',
  '11000000-0000-4000-8000-0000000000b1', 800, 800, 1000, null) $$,
  'NZ403', null, 'an explicit deny of products.update blocks adding images');
select throws_ok($$ select public.admin_reorder_product_images('0d000000-0000-4000-8000-0000000000f1', '{}') $$,
  'NZ403', null, 'and reordering');

-- ---------------------------------------------------------------------------
-- Adding images
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}';
select is(public.admin_add_product_image('0d000000-0000-4000-8000-0000000000f1',
  '11000000-0000-4000-8000-0000000000b1', 1200, 900, 52000, '  Front view  '), 0, 'the first image takes position 0');
select is(public.admin_add_product_image('0d000000-0000-4000-8000-0000000000f1',
  '11000000-0000-4000-8000-0000000000b2', 1000, 1000, 48000, null), 1, 'the next image goes last');
select results_eq($$ select storage_key, alt_text from public.product_images where id = '11000000-0000-4000-8000-0000000000b1' $$,
  $$ values ('products/0d000000-0000-4000-8000-0000000000f1/11000000-0000-4000-8000-0000000000b1'::text, 'Front view'::text) $$,
  'the key is derived from the ids and the description is trimmed');
select is((select count(*)::int from public.product_images where product_id = '0d000000-0000-4000-8000-0000000000f1'), 2,
  'staff with products.read see the images of a draft');
select throws_ok($$ select public.admin_add_product_image('0d000000-0000-4000-8000-0000000000f1',
  '11000000-0000-4000-8000-0000000000b1', 800, 800, 1000, null) $$,
  '23505', null, 'an image id cannot be registered twice');
select throws_ok($$ select public.admin_add_product_image('0d000000-0000-4000-8000-0000000000f1',
  '11000000-0000-4000-8000-0000000000b9', 99999, 800, 1000, null) $$,
  'NZ412', null, 'out-of-range dimensions are refused');
select throws_ok($$ select public.admin_add_product_image('0d000000-0000-4000-8000-0000000000f1',
  '11000000-0000-4000-8000-0000000000b9', 800, 800, 1000, repeat('x', 161)) $$,
  'NZ412', null, 'a description over 160 characters is refused');
select throws_ok($$ select public.admin_add_product_image('0d000000-0000-4000-8000-0000000000aa',
  '11000000-0000-4000-8000-0000000000b9', 800, 800, 1000, null) $$,
  'NZ404', null, 'an unknown product is not found');
select throws_ok($$ select public.admin_add_product_image('0d000000-0000-4000-8000-0000000000f2',
  '11000000-0000-4000-8000-0000000000b9', 800, 800, 1000, null) $$,
  'NZ430', null, 'a product on sale must be unpublished first');
select throws_ok($$ select public.admin_add_product_image('0d000000-0000-4000-8000-0000000000f3',
  '11000000-0000-4000-8000-0000000000b9', 800, 800, 1000, null) $$,
  'NZ431', null, 'a product under review cannot change');
select is((select moderation_status::text from public.products where id = '0d000000-0000-4000-8000-0000000000f1'), 'not_submitted',
  'adding an image sends the product back for review');

-- ---------------------------------------------------------------------------
-- Description, reorder
-- ---------------------------------------------------------------------------

select lives_ok($$ select public.admin_update_product_image('11000000-0000-4000-8000-0000000000b2', 'Side view') $$,
  'staff change a description');
select is((select alt_text from public.product_images where id = '11000000-0000-4000-8000-0000000000b2'), 'Side view', 'the description is saved');
select lives_ok($$ select public.admin_update_product_image('11000000-0000-4000-8000-0000000000b2', '   ') $$,
  'a blank description clears it');
select is((select alt_text from public.product_images where id = '11000000-0000-4000-8000-0000000000b2'), null, 'cleared');
select throws_ok($$ select public.admin_update_product_image('11000000-0000-4000-8000-0000000000f2', 'x') $$,
  'NZ430', null, 'the description of an image on a product on sale is locked');
select throws_ok($$ select public.admin_update_product_image('11000000-0000-4000-8000-0000000000ee', 'x') $$,
  'NZ404', null, 'an unknown image is not found');

select lives_ok($$ select public.admin_reorder_product_images('0d000000-0000-4000-8000-0000000000f1',
  array['11000000-0000-4000-8000-0000000000b2', '11000000-0000-4000-8000-0000000000b1']::uuid[]) $$,
  'staff reorder the images (positions swap within one statement)');
select results_eq($$ select id, position from public.product_images where product_id = '0d000000-0000-4000-8000-0000000000f1' order by position $$,
  $$ values ('11000000-0000-4000-8000-0000000000b2'::uuid, 0), ('11000000-0000-4000-8000-0000000000b1'::uuid, 1) $$,
  'the new order is stored');
select throws_ok($$ select public.admin_reorder_product_images('0d000000-0000-4000-8000-0000000000f1',
  array['11000000-0000-4000-8000-0000000000b2']::uuid[]) $$,
  'NZ412', null, 'a reorder that leaves an image out is refused');
select throws_ok($$ select public.admin_reorder_product_images('0d000000-0000-4000-8000-0000000000f1',
  array['11000000-0000-4000-8000-0000000000b2', '11000000-0000-4000-8000-0000000000b2']::uuid[]) $$,
  'NZ412', null, 'a reorder that repeats an image is refused');
select throws_ok($$ select public.admin_reorder_product_images('0d000000-0000-4000-8000-0000000000f1',
  array['11000000-0000-4000-8000-0000000000b2', '11000000-0000-4000-8000-0000000000f2']::uuid[]) $$,
  'NZ412', null, 'a reorder naming another product''s image is refused');
select throws_ok($$ select public.admin_reorder_product_images('0d000000-0000-4000-8000-0000000000f1', null) $$,
  'NZ412', null, 'a null list is refused');

-- ---------------------------------------------------------------------------
-- The limit of 8
-- ---------------------------------------------------------------------------

select lives_ok($$ select public.admin_add_product_image('0d000000-0000-4000-8000-0000000000f1', gen_random_uuid(), 800, 800, 1000, null)
  from generate_series(1, 6) $$, 'staff fill the product up to 8 images');
select is((select count(*)::int from public.product_images where product_id = '0d000000-0000-4000-8000-0000000000f1'), 8, 'eight images are stored');
select throws_ok($$ select public.admin_add_product_image('0d000000-0000-4000-8000-0000000000f1', gen_random_uuid(), 800, 800, 1000, null) $$,
  'NZ440', null, 'a ninth image is refused');

-- ---------------------------------------------------------------------------
-- Deleting
-- ---------------------------------------------------------------------------

select is(public.admin_delete_product_image('11000000-0000-4000-8000-0000000000b2'),
  'products/0d000000-0000-4000-8000-0000000000f1/11000000-0000-4000-8000-0000000000b2',
  'delete returns the base key for the R2 cleanup');
select results_eq($$ select array_agg(position order by position) from public.product_images where product_id = '0d000000-0000-4000-8000-0000000000f1' $$,
  $$ values (array[0,1,2,3,4,5,6]) $$, 'the gap is closed');
select is((select id from public.product_images where product_id = '0d000000-0000-4000-8000-0000000000f1' and position = 0),
  '11000000-0000-4000-8000-0000000000b1'::uuid, 'the next image becomes the primary one');
select throws_ok($$ select public.admin_delete_product_image('11000000-0000-4000-8000-0000000000b2') $$,
  'NZ404', null, 'a deleted image is not found again');
select throws_ok($$ select public.admin_delete_product_image('11000000-0000-4000-8000-0000000000f2') $$,
  'NZ430', null, 'an image of a product on sale cannot be deleted');

-- ---------------------------------------------------------------------------
-- Visibility once the product is on sale, and the audit trail
-- ---------------------------------------------------------------------------

reset role;
update public.products set status = 'active', moderation_status = 'approved' where id = '0d000000-0000-4000-8000-0000000000f1';
set local role anon;
select is((select count(*)::int from public.product_images where product_id = '0d000000-0000-4000-8000-0000000000f1'), 7,
  'anon sees the images once the product is on sale');
reset role;
update public.categories set is_active = false where id = 'ca000000-0000-4000-8000-0000000000f1';
set local role anon;
select is((select count(*)::int from public.product_images where product_id in ('0d000000-0000-4000-8000-0000000000f1', '0d000000-0000-4000-8000-0000000000f2', '0d000000-0000-4000-8000-0000000000f3')), 0, 'and none while its category is hidden');
reset role;

select is(((select count(*)::int from public.audit_log where action = 'product.image_added') - (select value::int from t where key = 'before-product.image_added'))
  + ((select count(*)::int from public.audit_log where action = 'product.image_updated') - (select value::int from t where key = 'before-product.image_updated'))
  + ((select count(*)::int from public.audit_log where action = 'product.images_reordered') - (select value::int from t where key = 'before-product.images_reordered'))
  + ((select count(*)::int from public.audit_log where action = 'product.image_removed') - (select value::int from t where key = 'before-product.image_removed')), 12,
  'every image change was audited (8 adds, 2 description changes, 1 reorder, 1 removal)');
select is((select content_updated_by from public.products where id = '0d000000-0000-4000-8000-0000000000f1'), '00000000-0000-4000-8000-0000000000f1'::uuid,
  'the staff member who changed the images is recorded as the content editor');
select ok(not exists (select 1 from public.audit_log where action like 'product.image%' and details::text ~* '(storage|key|token|secret|password)'),
  'audit rows hold ids and counts only');
select ok(((select count(*)::int from public.audit_log where action = 'product.image_removed') - (select value::int from t where key = 'before-product.image_removed')) = 1
  and ((select count(*)::int from public.audit_log where action = 'product.image_added') - (select value::int from t where key = 'before-product.image_added')) = 8,
  'the audit trail counts adds and removals');

select * from finish();
rollback;
