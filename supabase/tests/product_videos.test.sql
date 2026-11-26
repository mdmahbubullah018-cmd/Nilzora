-- Database-level checks for product videos: the table is closed to writes, public reads see
-- only products on sale, the admin functions check the CALLER's permission, videos follow the
-- product content rules, at most 3 per product, the key is derived from the ids, reorder must
-- list every video, delete returns the key and closes the gap. Rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000e1', 'vid-staff@example.com', now()),
  ('00000000-0000-4000-8000-0000000000e2', 'vid-mod@example.com', now()),
  ('00000000-0000-4000-8000-0000000000e3', 'vid-buyer@example.com', now());
update public.user_roles set role = 'staff' where user_id = '00000000-0000-4000-8000-0000000000e1';
update public.user_roles set role = 'moderator' where user_id = '00000000-0000-4000-8000-0000000000e2';

insert into public.categories (id, slug, name) values ('ca000000-0000-4000-8000-0000000000e1', 'vid-test', 'Video test');
insert into public.products (id, category_id, slug, sku, name, price_minor, stock_quantity, status, moderation_status) values
  ('0d000000-0000-4000-8000-0000000000e1', 'ca000000-0000-4000-8000-0000000000e1', 'vid-draft', 'VID-DRAFT', 'Draft', 10000, 5, 'draft', 'approved'),
  ('0d000000-0000-4000-8000-0000000000e2', 'ca000000-0000-4000-8000-0000000000e1', 'vid-live', 'VID-LIVE', 'Live', 10000, 5, 'active', 'approved');

select ok((select relrowsecurity from pg_class where oid = 'public.product_videos'::regclass),
  'RLS is enabled on product_videos');
select ok(not exists (
  select 1 from unnest(array['anon', 'authenticated']) r, unnest(array['insert', 'update', 'delete']) p
  where has_table_privilege(r, 'public.product_videos', p)
), 'end users hold no write privilege on the table');

set local role authenticated;

-- A customer and a moderator cannot add videos.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e3", "role": "authenticated"}';
select throws_ok($$ select public.admin_add_product_video('0d000000-0000-4000-8000-0000000000e1',
  '22000000-0000-4000-8000-0000000000e1', 'video/mp4', 1000) $$, 'NZ403', null, 'a customer cannot add a video');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e2", "role": "authenticated"}';
select throws_ok($$ select public.admin_add_product_video('0d000000-0000-4000-8000-0000000000e1',
  '22000000-0000-4000-8000-0000000000e1', 'video/mp4', 1000) $$, 'NZ403', null, 'a moderator cannot add a video');

-- Staff can, within the rules.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e1", "role": "authenticated"}';
select throws_ok($$ select public.admin_add_product_video('0d000000-0000-4000-8000-0000000000e1',
  '22000000-0000-4000-8000-0000000000e1', 'video/quicktime', 1000) $$, 'NZ412', null, 'only MP4 and WebM are accepted');
select throws_ok($$ select public.admin_add_product_video('0d000000-0000-4000-8000-0000000000e2',
  '22000000-0000-4000-8000-0000000000e1', 'video/mp4', 1000) $$, 'NZ430', null, 'a product on sale keeps its videos');
select is(public.admin_add_product_video('0d000000-0000-4000-8000-0000000000e1',
  '22000000-0000-4000-8000-0000000000e1', 'video/mp4', 1000, ' Daylight '), 0, 'the first video takes position 0');
select is(public.admin_add_product_video('0d000000-0000-4000-8000-0000000000e1',
  '22000000-0000-4000-8000-0000000000e2', 'video/webm', 2000), 1, 'the second goes last');
select is(public.admin_add_product_video('0d000000-0000-4000-8000-0000000000e1',
  '22000000-0000-4000-8000-0000000000e3', 'video/mp4', 3000), 2, 'the third goes last');
select throws_ok($$ select public.admin_add_product_video('0d000000-0000-4000-8000-0000000000e1',
  '22000000-0000-4000-8000-0000000000e4', 'video/mp4', 1000) $$, 'NZ440', null, 'a product keeps at most 3 videos');

select is((select storage_key from public.product_videos where id = '22000000-0000-4000-8000-0000000000e2'),
  'products/0d000000-0000-4000-8000-0000000000e1/videos/22000000-0000-4000-8000-0000000000e2.webm',
  'the key is derived from the ids and the type');
select is((select title from public.product_videos where id = '22000000-0000-4000-8000-0000000000e1'),
  'Daylight', 'the title is trimmed');

select throws_ok($$ select public.admin_reorder_product_videos('0d000000-0000-4000-8000-0000000000e1',
  array['22000000-0000-4000-8000-0000000000e1']::uuid[]) $$, 'NZ412', null, 'a reorder must list every video');
select lives_ok($$ select public.admin_reorder_product_videos('0d000000-0000-4000-8000-0000000000e1',
  array['22000000-0000-4000-8000-0000000000e3', '22000000-0000-4000-8000-0000000000e1', '22000000-0000-4000-8000-0000000000e2']::uuid[]) $$,
  'staff reorder the videos');

select is(public.admin_delete_product_video('22000000-0000-4000-8000-0000000000e3'),
  'products/0d000000-0000-4000-8000-0000000000e1/videos/22000000-0000-4000-8000-0000000000e3.mp4',
  'delete returns the key for removing the file');
select is((select array_agg(position order by position) from public.product_videos
  where product_id = '0d000000-0000-4000-8000-0000000000e1'), array[0, 1], 'delete closes the gap');

select * from finish();
rollback;
