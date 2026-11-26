-- Banners with optional words (20261204300000): a banner may have no heading, no supporting
-- text and no button, but it always needs a heading or a picture description for screen
-- readers. Runs inside a transaction that is rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000b0', 'bot-owner@example.com', now()),
  ('00000000-0000-4000-8000-0000000000b2', 'bot-staff@example.com', now());
update public.user_roles set role = 'super_admin' where user_id = '00000000-0000-4000-8000-0000000000b0';
update public.user_roles set role = 'staff' where user_id = '00000000-0000-4000-8000-0000000000b2';

create temporary table t (key text primary key, value uuid) on commit drop;
grant select, insert on t to authenticated;

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b0", "role": "authenticated"}';

-- An image-only banner: no heading, no text, no button, only a picture description.
insert into t values ('image_only', public.admin_save_banner(
  null, 'home_secondary', null, '', null, null, null, 0, true, null, null,
  'Two cotton sarees on a light background'
));
select ok((select value from t where key = 'image_only') is not null,
  'an admin can save a banner with no heading when the picture is described');

-- The original eleven-argument call still works (the description defaults to null).
insert into t values ('legacy', public.admin_save_banner(
  null, 'home_secondary', null, 'Winter sale', 'Up to 30% off', 'Shop now', '/products', 1, true, null, null
));
select ok((select value from t where key = 'legacy') is not null,
  'existing callers that pass eleven arguments keep working');

select throws_ok(
  $$select public.admin_save_banner(null, 'home_secondary', null, '   ', null, null, null, 0, true, null, null, null)$$,
  'NZ412', 'add a heading or describe the picture',
  'a banner with neither a heading nor a picture description is refused'
);
select throws_ok(
  $$select public.admin_save_banner(null, 'home_secondary', null, '', null, null, null, 0, true, null, null, '   ')$$,
  'NZ412', 'add a heading or describe the picture',
  'a blank picture description does not count'
);

reset role;
select is((select title from public.banners where id = (select value from t where key = 'image_only')), '',
  'the missing heading is stored as an empty string');
select is((select image_alt from public.banners where id = (select value from t where key = 'image_only')),
  'Two cotton sarees on a light background', 'the picture description is stored');
select is((select subtitle from public.banners where id = (select value from t where key = 'image_only')), null,
  'no supporting text is stored as null');

select throws_ok(
  $$update public.banners set title = '  padded  ' where id = (select value from t where key = 'legacy')$$,
  '23514', null, 'a heading with surrounding spaces is refused by the table'
);
select throws_ok(
  $$update public.banners set image_alt = repeat('x', 161) where id = (select value from t where key = 'legacy')$$,
  '23514', null, 'a picture description over 160 characters is refused'
);

-- Changing banners still needs settings.manage.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b2", "role": "authenticated"}';
select throws_ok(
  $$select public.admin_save_banner(null, 'home_secondary', null, '', null, null, null, 0, true, null, null, 'A picture')$$,
  'NZ403', null, 'staff without settings.manage cannot save banners'
);

select * from finish();
rollback;
