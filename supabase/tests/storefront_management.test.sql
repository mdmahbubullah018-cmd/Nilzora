-- Database-level checks for storefront management: store-profile extras, static pages,
-- navigation menus, homepage sections and banner images/order. Every change needs
-- settings.manage (NZ403) and validates its input (NZ412 / NZ495); visitors read only
-- published or active content. Runs inside a transaction that is rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(55);

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000e0', 'sm-owner@example.com', now()),
  ('00000000-0000-4000-8000-0000000000e2', 'sm-staff@example.com', now());
update public.user_roles set role = 'super_admin' where user_id = '00000000-0000-4000-8000-0000000000e0';
update public.user_roles set role = 'staff' where user_id = '00000000-0000-4000-8000-0000000000e2';
insert into public.categories (id, slug, name) values ('ca000000-0000-4000-8000-0000000000e9', 'sm-cat', 'SM Category');
insert into public.banners (id, placement, category_id, title, is_active, sort_order) values
  ('0b000000-0000-4000-8000-0000000000e1', 'category', 'ca000000-0000-4000-8000-0000000000e9', 'SM one', true, 0),
  ('0b000000-0000-4000-8000-0000000000e2', 'category', 'ca000000-0000-4000-8000-0000000000e9', 'SM two', true, 10);
-- Menus start empty in this test, whatever a local database holds.
delete from public.site_menu_items;
delete from public.site_pages;

create temporary table t (key text primary key, value text) on commit drop;
grant select, insert on t to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Store profile extras
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e2", "role": "authenticated"}';
select throws_ok($$ select public.admin_save_store_profile(p_display_name => 'X', p_extras => '{}') $$,
  'NZ403', null, 'staff cannot save the store profile');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e0", "role": "authenticated"}';
select lives_ok($$ select public.admin_save_store_profile(p_display_name => 'Nilzora', p_extras =>
    '{"whatsappNumber": "+8801712345678", "playStoreUrl": "https://play.google.com/store/apps/details?id=com.nilzora.app",
      "socialTiktok": "https://www.tiktok.com/@nilzora", "socialX": "https://x.com/nilzora"}') $$,
  'the owner saves the WhatsApp number, the Play Store link and social profiles');
select is(public.public_store_profile() ->> 'whatsappNumber', '+8801712345678', 'the public profile shows WhatsApp');
select is(public.public_store_profile() ->> 'playStoreUrl',
  'https://play.google.com/store/apps/details?id=com.nilzora.app', 'and the Play Store link');
select is(public.public_store_profile() -> 'social' ->> 'tiktok', 'https://www.tiktok.com/@nilzora', 'and TikTok');
select is(public.public_store_profile() ->> 'appStoreUrl', null, 'an unset App Store link stays empty');
select throws_ok($$ select public.admin_save_store_profile(p_display_name => 'Nilzora', p_extras => '{"whatsappNumber": "01712345678"}') $$,
  'NZ495', null, 'WhatsApp needs the +880 form');
select throws_ok($$ select public.admin_save_store_profile(p_display_name => 'Nilzora', p_extras => '{"playStoreUrl": "https://evil.example/app"}') $$,
  'NZ495', null, 'only a Google Play link is accepted');
select throws_ok($$ select public.admin_save_store_profile(p_display_name => 'Nilzora', p_extras => '{"appStoreUrl": "http://apps.apple.com/app/x"}') $$,
  'NZ495', null, 'App Store links are https');
select throws_ok($$ select public.admin_save_store_profile(p_display_name => 'Nilzora', p_extras => '{"secret": "x"}') $$,
  'NZ495', null, 'an unknown field is refused');
select lives_ok($$ select public.admin_save_store_profile(p_display_name => 'Nilzora', p_tagline => 'Hello') $$,
  'the original signature still saves');
select is(public.public_store_profile() ->> 'whatsappNumber', '+8801712345678', 'and keeps the extras');
select lives_ok($$ select public.admin_save_store_profile(p_display_name => 'Nilzora', p_extras => '{"whatsappNumber": null}') $$,
  'null clears one extra');
select is(public.public_store_profile() ->> 'whatsappNumber', null, 'which is then gone');

-- ---------------------------------------------------------------------------
-- 2. Static pages
-- ---------------------------------------------------------------------------

select is(jsonb_array_length(public.admin_list_site_pages()), 6, 'staff see all six pages, written or not');
select throws_ok($$ select public.admin_save_site_page('careers', 'Careers', 'x', true) $$, 'NZ404', null,
  'only the known pages exist');
select throws_ok($$ select public.admin_save_site_page('about', 'About', '   ', true) $$, 'NZ412', null,
  'a published page needs text');
select throws_ok($$ select public.admin_save_site_page('about', 'About', E'Bad \u0001 text', false) $$, 'NZ412', null,
  'control characters are refused');
select is(public.admin_save_site_page('about', ' About us ', E'# Who we are\n\nWe sell lamps.', true, 'About Nilzora', null) ->> 'title',
  'About us', 'the owner publishes a page');
select lives_ok($$ select public.admin_save_site_page('terms', 'Terms', 'Draft terms', false) $$, 'and keeps another as a draft');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e2", "role": "authenticated"}';
select throws_ok($$ select public.admin_save_site_page('about', 'About', 'x', true) $$, 'NZ403', null,
  'staff cannot change pages');
select throws_ok($$ select public.admin_list_site_pages() $$, 'NZ403', null, 'or list them');

set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select is(public.public_site_page('about') ->> 'seoTitle', 'About Nilzora', 'visitors read a published page');
select is(public.public_site_page('terms'), null, 'but not a draft');
select is(public.public_site_page('privacy'), null, 'or one never written');
select throws_ok($$ select slug from public.site_pages $$, '42501', null, 'the table is not readable directly');

reset role;
select is((select count(*)::int from public.audit_log
  where action = 'site_page.saved' and actor_id = '00000000-0000-4000-8000-0000000000e0'), 2, 'page saves are audited');

-- ---------------------------------------------------------------------------
-- 3. Navigation
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e0", "role": "authenticated"}';
insert into t select 'sale', public.admin_save_menu_item(null, 'header', 'Eid sale', '/categories/eid?sort=newest', true) ->> 'id';
insert into t select 'blog', public.admin_save_menu_item(null, 'header', 'Blog', 'https://blog.nilzora.example/latest', true) ->> 'id';
insert into t select 'hidden', public.admin_save_menu_item(null, 'header', 'Hidden', '/brands', false) ->> 'id';
select throws_ok($$ select public.admin_save_menu_item(null, 'header', 'Bad', 'javascript:alert(1)', true) $$, 'NZ412', null,
  'script links are refused');
select throws_ok($$ select public.admin_save_menu_item(null, 'header', 'Bad', '//evil.example', true) $$, 'NZ412', null,
  'protocol-relative links are refused');
select throws_ok($$ select public.admin_save_menu_item(null, 'header', 'Bad', 'http://plain.example', true) $$, 'NZ412', null,
  'plain http links are refused');
select throws_ok($$ select public.admin_save_menu_item(null, 'sidebar', 'Bad', '/x', true) $$, 'NZ412', null,
  'only the three menus exist');
select throws_ok($$ select public.admin_save_menu_item(null, 'header', repeat('x', 41), '/x', true) $$, 'NZ412', null,
  'labels are at most 40 characters');

set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select is(public.public_navigation() -> 'menus' -> 'header',
  '[{"label": "Eid sale", "href": "/categories/eid?sort=newest"}, {"label": "Blog", "href": "https://blog.nilzora.example/latest"}]'::jsonb,
  'visitors see the active links in order');
select is(public.public_navigation() -> 'pages', '[{"slug": "about", "title": "About us"}]'::jsonb,
  'and the published pages');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e0", "role": "authenticated"}';
select throws_ok($$ select public.admin_reorder_menu('header', array[(select value::uuid from t where key = 'sale')]) $$,
  'NZ412', null, 'a reorder must list every link');
select lives_ok($$ select public.admin_reorder_menu('header', array[
    (select value::uuid from t where key = 'blog'), (select value::uuid from t where key = 'hidden'),
    (select value::uuid from t where key = 'sale')]) $$, 'the owner reorders the header');
select is(public.public_navigation() -> 'menus' -> 'header' -> 0 ->> 'label', 'Blog', 'which visitors then see');
select lives_ok($$ select public.admin_delete_menu_item((select value::uuid from t where key = 'hidden')) $$, 'a link is deleted');
select throws_ok($$ select public.admin_delete_menu_item((select value::uuid from t where key = 'hidden')) $$,
  'NZ404', null, 'only once');
select lives_ok($$ select public.admin_save_menu_item(null, 'footer_help', 'Link ' || g, '/help', true) from generate_series(1, 12) g $$,
  'a menu holds twelve links');
select throws_ok($$ select public.admin_save_menu_item(null, 'footer_help', 'Thirteenth', '/help', true) $$,
  'NZ412', null, 'but not thirteen');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e2", "role": "authenticated"}';
select throws_ok($$ select public.admin_save_menu_item(null, 'header', 'Staff', '/x', true) $$, 'NZ403', null,
  'staff cannot change menus');

-- ---------------------------------------------------------------------------
-- 4. Homepage sections
-- ---------------------------------------------------------------------------

set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select is((select jsonb_agg(s ->> 'key') from jsonb_array_elements(public.public_homepage() -> 'sections') s),
  '["hero", "services", "categories", "new_arrivals", "featured", "promotions", "brands"]'::jsonb,
  'the homepage starts in today''s order');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e2", "role": "authenticated"}';
select throws_ok($$ select public.admin_homepage() $$, 'NZ403', null, 'staff cannot read the homepage settings');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e0", "role": "authenticated"}';
select throws_ok($$ select public.admin_save_homepage('[{"key": "hero", "isEnabled": true}]') $$, 'NZ412', null,
  'every section must be listed');
select throws_ok($$ select public.admin_save_homepage((select jsonb_agg(jsonb_build_object('key', k, 'isEnabled', true,
    'itemLimit', case when k = 'featured' then 25 end))
    from unnest(array['hero', 'services', 'categories', 'new_arrivals', 'featured', 'promotions', 'brands']) k)) $$,
  'NZ412', null, 'item limits are at most 24');
select throws_ok($$ select public.admin_save_homepage((select jsonb_agg(jsonb_build_object('key', k, 'isEnabled', true,
    'config', case when k = 'brands' then '{"brandSlug": "acme"}'::jsonb else '{}'::jsonb end))
    from unnest(array['hero', 'services', 'categories', 'new_arrivals', 'featured', 'promotions', 'brands']) k)) $$,
  'NZ412', null, 'only product rows take a category or brand');
select lives_ok($$ select public.admin_save_homepage('[
    {"key": "hero", "isEnabled": true},
    {"key": "featured", "isEnabled": true, "title": "Eid picks", "itemLimit": 8, "config": {"categorySlug": "eid"}},
    {"key": "categories", "isEnabled": true},
    {"key": "new_arrivals", "isEnabled": false},
    {"key": "services", "isEnabled": true},
    {"key": "promotions", "isEnabled": true},
    {"key": "brands", "isEnabled": false}]') $$, 'the owner rearranges the homepage');

set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select is(public.public_homepage() -> 'sections' -> 1,
  '{"key": "featured", "title": "Eid picks", "itemLimit": 8, "config": {"categorySlug": "eid"}}'::jsonb,
  'visitors get the new order, title, limit and curated category');
select is(jsonb_array_length(public.public_homepage() -> 'sections'), 5, 'without the disabled sections');

-- ---------------------------------------------------------------------------
-- 5. Banners
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000e0", "role": "authenticated"}';
select throws_ok($$ select public.admin_set_banner_mobile_image('0b000000-0000-4000-8000-0000000000e1',
    'banners/0b000000-0000-4000-8000-0000000000e2/0c000000-0000-4000-8000-000000000001') $$,
  'NZ412', null, 'a mobile image key must belong to its banner');
select lives_ok($$ select public.admin_set_banner_mobile_image('0b000000-0000-4000-8000-0000000000e1',
    'banners/0b000000-0000-4000-8000-0000000000e1/0c000000-0000-4000-8000-000000000001') $$,
  'the owner adds a small-screen image');
select throws_ok($$ select public.admin_reorder_banners('category', 'ca000000-0000-4000-8000-0000000000e9',
    array['0b000000-0000-4000-8000-0000000000e1'::uuid]) $$, 'NZ412', null, 'a reorder must list every banner of the placement');
select lives_ok($$ select public.admin_reorder_banners('category', 'ca000000-0000-4000-8000-0000000000e9',
    array['0b000000-0000-4000-8000-0000000000e2'::uuid, '0b000000-0000-4000-8000-0000000000e1'::uuid]) $$,
  'the owner reorders the category banners');
select is(public.admin_delete_banner_files('0b000000-0000-4000-8000-0000000000e1'),
  array['banners/0b000000-0000-4000-8000-0000000000e1/0c000000-0000-4000-8000-000000000001'],
  'deleting a banner answers every image key it held');

select * from finish();
rollback;
