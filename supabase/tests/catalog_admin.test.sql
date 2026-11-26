-- Database-level checks for the Batch 3 catalog administration: slug availability, the
-- media library (permissions, audit, in-use refusal, key checks), brand deletion,
-- product tags and size charts (normal form, content and publish rules, privacy), and
-- the customer-insight role fix. Fixtures use a `zq-` namespace and fixed ids so rows
-- a local database already holds never collide. Runs inside a transaction that is
-- rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(83);

-- ---------------------------------------------------------------------------
-- Fixtures (as the database owner)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000c0', 'zq-owner@example.com', now()),
  ('00000000-0000-4000-8000-0000000000c1', 'zq-admin@example.com', now()),
  ('00000000-0000-4000-8000-0000000000c2', 'zq-staff@example.com', now()),
  ('00000000-0000-4000-8000-0000000000c3', 'zq-moderator@example.com', now()),
  ('00000000-0000-4000-8000-0000000000c5', 'zq-buyer@example.com', now());

update public.user_roles set role = 'super_admin' where user_id = '00000000-0000-4000-8000-0000000000c0';
update public.user_roles set role = 'admin' where user_id = '00000000-0000-4000-8000-0000000000c1';
update public.user_roles set role = 'staff' where user_id = '00000000-0000-4000-8000-0000000000c2';
update public.user_roles set role = 'moderator' where user_id = '00000000-0000-4000-8000-0000000000c3';

insert into public.categories (id, slug, name) values
  ('ca000000-0000-4000-8000-0000000000e1', 'zq-lamps', 'ZQ Lamps');
insert into public.products (id, category_id, slug, sku, name, price_minor, stock_quantity, status) values
  ('0d000000-0000-4000-8000-0000000000e1', 'ca000000-0000-4000-8000-0000000000e1', 'zq-lamp', 'ZQ-LAMP', 'ZQ Lamp', 10000, 5, 'active'),
  ('0d000000-0000-4000-8000-0000000000e2', 'ca000000-0000-4000-8000-0000000000e1', 'zq-lamp-2', 'ZQ-LAMP-2', 'ZQ Lamp 2', 10000, 5, 'draft'),
  ('0d000000-0000-4000-8000-0000000000e3', 'ca000000-0000-4000-8000-0000000000e1',
    repeat('a', 117) || '-zq', 'ZQ-LONG', 'ZQ Long', 10000, 5, 'draft');
insert into public.brands (id, slug, name, logo_key) values
  ('b4000000-0000-4000-8000-0000000000e1', 'zq-north', 'ZQ North', null),
  ('b4000000-0000-4000-8000-0000000000e2', 'zq-empty', 'ZQ Empty',
    'brands/b4000000-0000-4000-8000-0000000000e2/0c000000-0000-4000-8000-0000000000e9');
-- The first brand moves to a new address; its old one stays as a redirect.
update public.brands set slug = 'zq-north-star' where id = 'b4000000-0000-4000-8000-0000000000e1';
update public.products set brand_id = 'b4000000-0000-4000-8000-0000000000e1'
  where id = '0d000000-0000-4000-8000-0000000000e1';

create temporary table t (key text primary key, value text) on commit drop;
grant select, insert, update on t to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Slug availability
-- ---------------------------------------------------------------------------

set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select throws_ok($$ select public.admin_slug_availability('product', 'zq-lamp') $$, '42501', null,
  'the public cannot check addresses');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c5", "role": "authenticated"}';
select throws_ok($$ select public.admin_slug_availability('product', 'zq-lamp') $$, 'NZ403', null,
  'customers cannot check addresses');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c3", "role": "authenticated"}';
select throws_ok($$ select public.admin_slug_availability('page', 'zq-lamp') $$, 'NZ412', null,
  'an unknown kind is refused');
select is(public.admin_slug_availability('product', 'zq-free-address'),
  '{"available": true, "reason": null, "suggestion": null}'::jsonb, 'a free product address is available');
select is(public.admin_slug_availability('product', 'zq-lamp'),
  '{"available": false, "reason": "taken", "suggestion": "zq-lamp-3"}'::jsonb,
  'a taken address suggests the first free numbered one (zq-lamp-2 is taken too)');
select is(public.admin_slug_availability('product', 'zq-lamp', '0d000000-0000-4000-8000-0000000000e1')->'available',
  'true'::jsonb, 'a product''s own address counts as free while editing it');
select is(public.admin_slug_availability('product', 'Desk Lamp'),
  '{"available": false, "reason": "invalid", "suggestion": null}'::jsonb, 'capitals and spaces are invalid');
select is(public.admin_slug_availability('product', repeat('a', 121))->>'reason', 'invalid',
  'a product address is at most 120 characters');
select is(public.admin_slug_availability('product', repeat('a', 117) || '-zq')->>'suggestion',
  repeat('a', 117) || '-2', 'a suggestion is shortened to fit the length limit');
select is(public.admin_slug_availability('category', 'zq-lamps')->>'suggestion', 'zq-lamps-2',
  'a taken category address has a suggestion');
select is(public.admin_slug_availability('category', repeat('b', 81))->>'reason', 'invalid',
  'a category address is at most 80 characters');
select is(public.admin_slug_availability('category', 'zq-lamp')->'available', 'true'::jsonb,
  'kinds do not share addresses');
select is(public.admin_slug_availability('brand', 'shop'),
  '{"available": false, "reason": "reserved", "suggestion": "shop-2"}'::jsonb,
  'storefront paths are reserved for brands');
select is(public.admin_slug_availability('product', 'shop')->'available', 'true'::jsonb,
  'but not for products');
select is(public.admin_slug_availability('brand', 'z')->>'reason', 'invalid', 'a brand address needs 2 characters');
select is(public.admin_slug_availability('brand', 'zq-north')->>'reason', 'taken',
  'another brand''s old address (a redirect) is taken');
select is(public.admin_slug_availability('brand', 'zq-north', 'b4000000-0000-4000-8000-0000000000e1')->'available',
  'true'::jsonb, 'a brand may take back its own old address');
select is(public.admin_slug_availability('brand', 'zq-north-star')->>'reason', 'taken', 'a live brand address is taken');

-- ---------------------------------------------------------------------------
-- 2. Media library
-- ---------------------------------------------------------------------------

select ok((select relrowsecurity from pg_class where oid = 'public.media_assets'::regclass),
  'the library table has row level security');
select throws_ok($$ select id from public.media_assets $$, '42501', null,
  'signed-in accounts cannot read the table directly');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated"}';
select throws_ok($$ select public.admin_record_media('0f000000-0000-4000-8000-0000000000e1', 'image/webp', 800, 600, 1000, null, null) $$,
  'NZ403', null, 'staff cannot add library pictures');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c0", "role": "authenticated"}';
insert into t select 'asset1', public.admin_record_media('0f000000-0000-4000-8000-0000000000e1', 'image/webp',
  1600, 1200, 123456, '  Storefront banner  ', 'banner (final).jpg')::text;
insert into t select 'asset2', public.admin_record_media('0f000000-0000-4000-8000-0000000000e2', 'image/webp',
  800, 800, 2000, 'ZQ 100% cotton', null)::text;
select is((select value::jsonb - 'createdAt' - 'uploadedBy' from t where key = 'asset1'),
  '{"id": "0f000000-0000-4000-8000-0000000000e1", "key": "library/0f000000-0000-4000-8000-0000000000e1",
    "fullKey": "library/0f000000-0000-4000-8000-0000000000e1/full.webp",
    "thumbKey": "library/0f000000-0000-4000-8000-0000000000e1/thumb.webp",
    "contentType": "image/webp", "width": 1600, "height": 1200, "bytes": 123456,
    "alt": "Storefront banner", "originalName": "banner (final).jpg"}'::jsonb,
  'the owner records an upload under keys derived from its id');
select is((select value::jsonb -> 'uploadedBy' ->> 'id' from t where key = 'asset1'),
  '00000000-0000-4000-8000-0000000000c0', 'with the uploader');
select throws_ok($$ select public.admin_record_media('0f000000-0000-4000-8000-0000000000e3', 'image/webp', 10, 10, 10, repeat('x', 251), null) $$,
  'NZ412', null, 'a description is at most 250 characters');
select throws_ok($$ select public.admin_record_media('0f000000-0000-4000-8000-0000000000e3', 'image/webp', 10, 10, 10, null, '../etc/passwd') $$,
  'NZ412', null, 'a file name cannot hold a folder');
select throws_ok($$ select public.admin_record_media('0f000000-0000-4000-8000-0000000000e3', 'image/gif', 10, 10, 10, null, null) $$,
  '23514', null, 'only image types are stored');
select throws_ok($$ select public.admin_record_media('0f000000-0000-4000-8000-0000000000e3', 'image/webp', 10, 10, 6000000, null, null) $$,
  '23514', null, 'an upload is at most 5 MB');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated"}';
select is((select count(*)::int from public.admin_list_media(null, 1, 100) l
  where l.asset->>'id' like '0f000000-0000-4000-8000-0000000000e%'), 2, 'product editors list the library');
select is((select (l.asset->>'id') from public.admin_list_media('cotton', 1, 25) l), '0f000000-0000-4000-8000-0000000000e2',
  'the search matches the description');
select is((select (l.asset->>'id') from public.admin_list_media('final', 1, 25) l), '0f000000-0000-4000-8000-0000000000e1',
  'and the file name');
select is((select count(*)::int from public.admin_list_media('100%', 1, 25) l), 1,
  'a percent sign in the search is literal');
select is((select l.total_count::int >= 2 from public.admin_list_media(null, 1, 1) l), true,
  'every row carries the total');
select throws_ok($$ select * from public.admin_list_media(null, 0, 25) $$, 'NZ412', null, 'pages start at 1');
select throws_ok($$ select * from public.admin_list_media(null, 1, 101) $$, 'NZ412', null, 'a page holds at most 100');
select throws_ok($$ select public.admin_update_media_alt('0f000000-0000-4000-8000-0000000000e1', 'x') $$,
  'NZ403', null, 'product editors cannot change descriptions');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c3", "role": "authenticated"}';
select throws_ok($$ select * from public.admin_list_media() $$, 'NZ403', null, 'moderators cannot list the library');

set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select throws_ok($$ select * from public.admin_list_media() $$, '42501', null, 'the public cannot list the library');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c0", "role": "authenticated"}';
select is(public.admin_update_media_alt('0f000000-0000-4000-8000-0000000000e1', ' Lamp shelf ')->>'alt', 'Lamp shelf',
  'the owner changes a description');
select is(public.admin_update_media_alt('0f000000-0000-4000-8000-0000000000e1', '')->'alt', 'null'::jsonb,
  'an empty description removes it');
select throws_ok($$ select public.admin_update_media_alt('0f000000-0000-4000-8000-0000000000ff', 'x') $$,
  'NZ404', null, 'an unknown picture is not found');

-- A picture in use cannot be deleted.
reset role;
update public.store_profile set logo_key = 'library/0f000000-0000-4000-8000-0000000000e1' where id;
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c0", "role": "authenticated"}';
select throws_ok($$ select public.admin_delete_media('0f000000-0000-4000-8000-0000000000e1') $$,
  'NZ442', null, 'the store logo keeps its picture');
reset role;
update public.store_profile set logo_key = null where id;
update public.products set og_image_key = 'library/0f000000-0000-4000-8000-0000000000e1'
  where id = '0d000000-0000-4000-8000-0000000000e2';
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c0", "role": "authenticated"}';
select throws_ok($$ select public.admin_delete_media('0f000000-0000-4000-8000-0000000000e1') $$,
  'NZ442', null, 'so does a product sharing image');
reset role;
update public.products set og_image_key = null where id = '0d000000-0000-4000-8000-0000000000e2';
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated"}';
select throws_ok($$ select public.admin_delete_media('0f000000-0000-4000-8000-0000000000e1') $$,
  'NZ403', null, 'staff cannot delete library pictures');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c0", "role": "authenticated"}';
select is(public.admin_delete_media('0f000000-0000-4000-8000-0000000000e1'),
  array['library/0f000000-0000-4000-8000-0000000000e1/full.webp', 'library/0f000000-0000-4000-8000-0000000000e1/thumb.webp'],
  'an unused picture is deleted, answering with its object keys');
select throws_ok($$ select public.admin_delete_media('0f000000-0000-4000-8000-0000000000e1') $$,
  'NZ404', null, 'and is gone');

reset role;
select results_eq($$ select action from public.audit_log
    where target_type = 'media_asset' and target_id = '0f000000-0000-4000-8000-0000000000e1' order by id $$,
  $$ values ('media.uploaded'), ('media.alt_changed'), ('media.alt_changed'), ('media.deleted') $$,
  'every library change is audited');

-- Image fields accept library keys, and still refuse anything else.
select lives_ok($$ update public.store_profile set og_image_key = 'library/0f000000-0000-4000-8000-0000000000e2' where id $$,
  'the store sharing image accepts a library key');
select lives_ok($$ update public.categories set og_image_key = 'library/0f000000-0000-4000-8000-0000000000e2'
    where id = 'ca000000-0000-4000-8000-0000000000e1' $$, 'so does a category sharing image');
select throws_ok($$ update public.products set og_image_key = 'avatars/x' where id = '0d000000-0000-4000-8000-0000000000e2' $$,
  '23514', null, 'other folders are still refused');
select throws_ok($$ update public.store_profile set logo_key = 'library/../secret' where id $$,
  '23514', null, 'and so are dots');

-- ---------------------------------------------------------------------------
-- 3. Deleting a brand
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated"}';
select throws_ok($$ select public.admin_delete_brand('b4000000-0000-4000-8000-0000000000e2') $$,
  'NZ403', null, 'staff cannot delete brands');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated"}';
select throws_ok($$ select public.admin_delete_brand('b4000000-0000-4000-8000-0000000000e1') $$,
  'NZ442', null, 'a brand with products is kept');
select throws_ok($$ select public.admin_delete_brand('b4000000-0000-4000-8000-0000000000ff') $$,
  'NZ404', null, 'an unknown brand is not found');
select is(public.admin_delete_brand('b4000000-0000-4000-8000-0000000000e2'),
  'brands/b4000000-0000-4000-8000-0000000000e2/0c000000-0000-4000-8000-0000000000e9',
  'a publisher deletes an unused brand, answering with its logo key');
reset role;
select is((select count(*)::int from public.brands where id = 'b4000000-0000-4000-8000-0000000000e2'), 0, 'the brand is gone');
select is((select actor_id from public.audit_log where action = 'brand.deleted' order by id desc limit 1),
  '00000000-0000-4000-8000-0000000000c1'::uuid, 'and the deletion is audited');
delete from public.products where id = '0d000000-0000-4000-8000-0000000000e1';
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated"}';
select lives_ok($$ select public.admin_delete_brand('b4000000-0000-4000-8000-0000000000e1') $$,
  'once no product belongs to it, a brand can be deleted');
reset role;
select is((select count(*)::int from public.brand_slug_redirects where old_slug = 'zq-north'), 0,
  'and its old addresses go with it');

-- ---------------------------------------------------------------------------
-- 4. Product tags and size charts
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated"}';
insert into t select 'tagged', public.admin_create_product('ca000000-0000-4000-8000-0000000000e1', 'zq-shirt', 'ZQ-SHIRT',
  'ZQ Shirt', null, null, 50000, null, 5, false, 0,
  array['  Summer   Sale ', 'summer sale', 'EID-2026', ''],
  '{"columns": ["Size", "Chest (cm)"], "rows": [["M", "96"], ["L", "102"]]}'::jsonb)::text;
reset role;
select is((select tags from public.products where slug = 'zq-shirt'), array['summer sale', 'eid-2026'],
  'tags are trimmed, lower-cased, collapsed and de-duplicated in order');
select is((select size_chart from public.products where slug = 'zq-shirt'),
  '{"columns": ["Size", "Chest (cm)"], "rows": [["M", "96"], ["L", "102"]]}'::jsonb, 'the size chart is stored');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated"}';
select throws_ok($$ select public.admin_create_product('ca000000-0000-4000-8000-0000000000e1', 'zq-x1', 'ZQ-X1', 'X', null, null,
    100, null, 5, false, 0, array(select 'tag ' || g from generate_series(1, 16) g), null) $$,
  'NZ412', null, 'at most 15 tags');
select throws_ok($$ select public.admin_create_product('ca000000-0000-4000-8000-0000000000e1', 'zq-x1', 'ZQ-X1', 'X', null, null,
    100, null, 5, false, 0, array['half_price'], null) $$,
  'NZ412', null, 'tags use letters, digits, spaces and hyphens only');
select throws_ok($$ select public.admin_create_product('ca000000-0000-4000-8000-0000000000e1', 'zq-x1', 'ZQ-X1', 'X', null, null,
    100, null, 5, false, 0, '{}', '{"columns": ["Size"], "rows": [["M", "L"]]}') $$,
  'NZ412', null, 'every size chart row has one entry per column');
select throws_ok($$ select public.admin_create_product('ca000000-0000-4000-8000-0000000000e1', 'zq-x1', 'ZQ-X1', 'X', null, null,
    100, null, 5, false, 0, '{}', '{"columns": [], "rows": [[]]}') $$,
  'NZ412', null, 'a size chart has at least one column');
select throws_ok($$ select public.admin_create_product('ca000000-0000-4000-8000-0000000000e1', 'zq-x1', 'ZQ-X1', 'X', null, null,
    100, null, 5, false, 0, '{}', jsonb_build_object('columns', array['Size'], 'rows', jsonb_build_array(jsonb_build_array(repeat('x', 41))))) $$,
  'NZ412', null, 'size chart entries are at most 40 characters');

insert into t select 'plain', public.admin_create_product('ca000000-0000-4000-8000-0000000000e1', 'zq-plain', 'ZQ-PLAIN',
  'ZQ Plain', null, null, 100, null, 5, false, 0)::text;
reset role;
select is((select tags = '{}' and size_chart is null from public.products where slug = 'zq-plain'), true,
  'the original create signature makes a product without tags or chart');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated"}';
select lives_ok($$ select public.admin_update_product((select value::uuid from t where key = 'tagged'),
    'ca000000-0000-4000-8000-0000000000e1', 'zq-shirt', 'ZQ Shirt', null, null, 50000, null, 5, false) $$,
  'the original update signature still works');
select lives_ok($$ select public.admin_update_product((select value::uuid from t where key = 'tagged'),
    'ca000000-0000-4000-8000-0000000000e1', 'zq-shirt', 'ZQ Shirt', null, null, 50000, null, 5, false,
    null, null, false) $$, 'and so does keeping both fields explicitly');
reset role;
select is((select array_length(tags, 1) || ':' || (size_chart is not null)::text from public.products where slug = 'zq-shirt'),
  '2:true', 'both keep the tags and the size chart');
select is((select count(*)::int from public.audit_log
  where action = 'product.updated' and target_id = (select value from t where key = 'tagged')
    and details->>'tagsChanged' = 'false' and details->>'sizeChartChanged' = 'false'), 2,
  'updates record whether tags or the chart changed');

-- On sale: the chart is locked content; tags need publish permission.
update public.products set moderation_status = 'approved' where slug = 'zq-shirt';
update public.products set status = 'active' where slug = 'zq-shirt';
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated"}';
select throws_ok($$ select public.admin_update_product((select value::uuid from t where key = 'tagged'),
    'ca000000-0000-4000-8000-0000000000e1', 'zq-shirt', 'ZQ Shirt', null, null, 50000, null, 5, false,
    null, null, true) $$, 'NZ430', null, 'the size chart of a product on sale cannot change');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated"}';
select throws_ok($$ select public.admin_update_product((select value::uuid from t where key = 'tagged'),
    'ca000000-0000-4000-8000-0000000000e1', 'zq-shirt', 'ZQ Shirt', null, null, 50000, null, 5, false,
    array['clearance'], null, false) $$, 'NZ403', null, 'staff cannot retag a product on sale');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated"}';
select lives_ok($$ select public.admin_update_product((select value::uuid from t where key = 'tagged'),
    'ca000000-0000-4000-8000-0000000000e1', 'zq-shirt', 'ZQ Shirt', null, null, 50000, null, 5, false,
    array['Clearance'], null, false) $$, 'a publisher retags it');
select is(public.admin_product_tags((select value::uuid from t where key = 'tagged')), array['clearance'],
  'staff who read products read the tags');
reset role;
select is((select status::text || '/' || moderation_status::text from public.products where slug = 'zq-shirt'),
  'active/approved', 'retagging does not send the product back for review');
select throws_ok($$ update public.products set tags = array['Upper'] where slug = 'zq-shirt' $$, '23514', null,
  'the table refuses tags not in normal form');
select throws_ok($$ update public.products set size_chart = '{"columns": ["A"], "rows": [[1]]}' where slug = 'zq-shirt' $$,
  '23514', null, 'and size chart entries that are not text');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c5", "role": "authenticated"}';
select is(public.admin_product_tags((select value::uuid from t where key = 'tagged')), null::text[],
  'customers get no tags');

set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select is((select size_chart->'rows'->0->>0 from public.products where slug = 'zq-shirt'), 'M',
  'shoppers read the size chart of a product on sale');
select throws_ok($$ select tags from public.products where slug = 'zq-shirt' $$, '42501', null,
  'but never its tags');

-- ---------------------------------------------------------------------------
-- 5. Customer insight reads the customer role from user_roles
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c0", "role": "authenticated"}';
select lives_ok($$ select * from public.admin_customer_insights() $$, 'customer insight runs');
select is((select count(*)::int from public.admin_customer_insights(null, 'zq-buyer@', 25, 0)), 1,
  'and lists the customer');
select is((select count(*)::int from public.admin_customer_insights(null, 'zq-staff@', 25, 0)), 0,
  'but never a staff account');

select * from finish();
rollback;
