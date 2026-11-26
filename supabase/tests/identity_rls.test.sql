-- Database-level checks for the identity foundation: signup trigger, RLS, column
-- privileges and the privileged role functions. Runs inside a transaction that is
-- rolled back, so it leaves no data behind.
begin;

create extension if not exists pgtap with schema extensions;

select plan(43);

-- Fixtures. Inserting into auth.users fires the signup trigger, exactly as a real
-- signup does. Customer A tries to smuggle privileged roles in through metadata.
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'a@example.com', now(),
   '{"full_name": "Customer A", "phone": "+8801712345678", "role": "super_admin"}',
   '{"role": "admin"}'),
  ('22222222-2222-4222-8222-222222222222', 'b@example.com', now(), '{"full_name": "Customer B"}', '{}'),
  ('33333333-3333-4333-8333-333333333333', 'owner@example.com', now(), '{}', '{}'),
  ('44444444-4444-4444-8444-444444444444', 'admin@example.com', now(), '{}', '{}'),
  ('55555555-5555-4555-8555-555555555555', 'unconfirmed@example.com', null,
   jsonb_build_object('full_name', repeat('x', 121), 'phone', '01712345678'), '{}');

-- ---------------------------------------------------------------------------
-- Schema and signup trigger
-- ---------------------------------------------------------------------------

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'user_roles', 'user_roles table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), 'RLS is enabled on profiles');
select ok((select relrowsecurity from pg_class where oid = 'public.user_roles'::regclass), 'RLS is enabled on user_roles');

create temporary table fixture_ids on commit drop as
  select unnest(array[
    '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555'
  ]::uuid[]) as id;
grant select on fixture_ids to authenticated, anon;

select is((select count(*)::int from public.profiles where id in (select id from fixture_ids)), 5,
  'every auth user gets a profile');
select is((select count(*)::int from public.user_roles where role = 'customer' and user_id in (select id from fixture_ids)), 5,
  'every new account starts as a customer');
select is((select role::text from public.user_roles where user_id = '11111111-1111-4111-8111-111111111111'),
  'customer', 'role claims in signup metadata are ignored');
select is((select phone from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  '+8801712345678', 'a well-formed phone number is kept');
select ok((select full_name is null and phone is null from public.profiles where id = '55555555-5555-4555-8555-555555555555'),
  'over-long names and malformed phone numbers from metadata are dropped');

-- ---------------------------------------------------------------------------
-- As customer A (authenticated)
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}';

select is((select count(*)::int from public.profiles), 1, 'a customer sees only their own profile');
select is_empty($$ select id from public.profiles where id = '22222222-2222-4222-8222-222222222222' $$,
  'a customer cannot read another profile');
select lives_ok($$ update public.profiles set full_name = 'A Renamed' where id = '11111111-1111-4111-8111-111111111111' $$,
  'a customer can edit their own name');
select lives_ok($$ update public.profiles set full_name = 'Hijacked' where id = '22222222-2222-4222-8222-222222222222' $$,
  'updating another profile silently matches no rows');
select throws_ok($$ update public.profiles set status = 'suspended' where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null, 'a customer cannot change their account status');
select throws_ok($$ insert into public.profiles (id) values ('66666666-6666-4666-8666-666666666666') $$,
  '42501', null, 'a customer cannot create profiles');
select throws_ok($$ delete from public.profiles where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null, 'a customer cannot delete profiles');

select is((select role::text from public.user_roles), 'customer', 'a customer can read their own role');
select is_empty($$ select role from public.user_roles where user_id = '22222222-2222-4222-8222-222222222222' $$,
  'a customer cannot read another account''s role');
select throws_ok($$ select granted_by from public.user_roles $$,
  '42501', null, 'who granted a role is not visible to the account holder');
select throws_ok($$ update public.user_roles set role = 'super_admin' where user_id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null, 'a customer cannot raise their own role');
select throws_ok($$ insert into public.user_roles (user_id, role) values ('11111111-1111-4111-8111-111111111111', 'admin') $$,
  '42501', null, 'a customer cannot insert role rows');
select throws_ok($$ delete from public.user_roles where user_id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null, 'a customer cannot delete role rows');
select throws_ok($$ select public.assign_user_role('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'admin') $$,
  '42501', null, 'end users cannot call the role assignment function');
select throws_ok($$ select public.bootstrap_owner('a@example.com') $$,
  '42501', null, 'end users cannot call the owner bootstrap function');

-- ---------------------------------------------------------------------------
-- As an anonymous visitor
-- ---------------------------------------------------------------------------

set local role anon;
set local request.jwt.claims to '{"role": "anon"}';

select throws_ok($$ select id from public.profiles $$, '42501', null, 'anonymous visitors cannot read profiles');
select throws_ok($$ select role from public.user_roles $$, '42501', null, 'anonymous visitors cannot read roles');

-- ---------------------------------------------------------------------------
-- Suspended accounts (status set by the trusted path)
-- ---------------------------------------------------------------------------

reset role;
update public.profiles set status = 'suspended' where id = '22222222-2222-4222-8222-222222222222';

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}';
select lives_ok($$ update public.profiles set full_name = 'Changed While Suspended' where id = '22222222-2222-4222-8222-222222222222' $$,
  'a suspended account''s profile update matches no rows');

reset role;
select is((select full_name from public.profiles where id = '22222222-2222-4222-8222-222222222222'),
  'Customer B', 'other customers and suspended accounts keep their data');
update public.profiles set status = 'active' where id = '22222222-2222-4222-8222-222222222222';

-- ---------------------------------------------------------------------------
-- Owner bootstrap and role assignment (the trusted server path)
-- ---------------------------------------------------------------------------

-- The local database persists between runs; set aside any existing owner so bootstrap
-- can be exercised. This happens inside the rolled-back test transaction only.
update public.user_roles set role = 'customer' where role = 'super_admin' and user_id not in (select id from fixture_ids);

select throws_ok($$ select public.bootstrap_owner('unconfirmed@example.com') $$,
  'NZ404', null, 'an unconfirmed account cannot become the owner');
select is(public.bootstrap_owner(' Owner@Example.com '), '33333333-3333-4333-8333-333333333333'::uuid,
  'the first confirmed account can be bootstrapped as owner');
select throws_ok($$ select public.bootstrap_owner('a@example.com') $$,
  'NZ005', null, 'owner bootstrap works only once');

select is((public.assign_user_role('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', 'admin')).role::text,
  'admin', 'an owner can appoint an admin');
select is((select granted_by from public.user_roles where user_id = '44444444-4444-4444-8444-444444444444'),
  '33333333-3333-4333-8333-333333333333'::uuid, 'the granting account is recorded');
select throws_ok($$ select public.assign_user_role('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'staff') $$,
  'NZ003', null, 'an admin cannot appoint staff: only the owner assigns roles');
select is((public.assign_user_role('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'staff')).role::text,
  'staff', 'the owner can appoint staff');
select throws_ok($$ select public.assign_user_role('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'super_admin') $$,
  'NZ005', null, 'nobody can hand out the owner role');
select throws_ok($$ select public.assign_user_role('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 'admin') $$,
  'NZ003', null, 'an admin cannot appoint another admin');
select throws_ok($$ select public.assign_user_role('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', 'customer') $$,
  'NZ003', null, 'an admin cannot change the owner''s role');
select throws_ok($$ select public.assign_user_role('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'moderator') $$,
  'NZ002', null, 'staff cannot assign roles');
select throws_ok($$ select public.assign_user_role('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'customer') $$,
  'NZ002', null, 'customers cannot assign roles');
select throws_ok($$ select public.assign_user_role('33333333-3333-4333-8333-333333333333', '33333333-3333-4333-8333-333333333333', 'admin') $$,
  'NZ001', null, 'nobody can change their own role');
select throws_ok($$ select public.assign_user_role('33333333-3333-4333-8333-333333333333', '99999999-9999-4999-8999-999999999999', 'staff') $$,
  'NZ404', null, 'assigning a role to an unknown account fails');

update public.profiles set status = 'suspended' where id = '44444444-4444-4444-8444-444444444444';
select throws_ok($$ select public.assign_user_role('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 'moderator') $$,
  'NZ002', null, 'a suspended admin cannot assign roles');

select * from finish();
rollback;
