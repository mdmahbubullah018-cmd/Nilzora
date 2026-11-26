-- Delivery across a session rotation. Refreshing an access token replaces the session
-- (rotate_session), so the session a device was registered on becomes revoked while the
-- login continues. A device must stay deliverable for that, and must stop being
-- deliverable for everything that really ends the login: a sign-out, an expired refresh
-- window, or a family revoked because a spent refresh token came back. Runs inside a
-- transaction that is rolled back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

-- ---------------------------------------------------------------------------
-- Fixtures (as the database owner)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000c1', 'rotated@example.com', now()),
  ('00000000-0000-4000-8000-0000000000c2', 'other-rotated@example.com', now());

insert into public.auth_sessions
  (id, user_id, secret_hash, refresh_hash, family_id, expires_at, refresh_expires_at)
values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c1',
   decode(repeat('11', 32), 'hex'), decode(repeat('21', 32), 'hex'),
   '00000000-0000-4000-8000-0000000000e1', now() + interval '15 minutes', now() + interval '30 days');

insert into public.device_tokens (user_id, token, platform, session_id) values
  ('00000000-0000-4000-8000-0000000000c1', 'rotated-device-token-0001', 'android',
   '00000000-0000-4000-8000-0000000000d1');

-- ---------------------------------------------------------------------------
-- What the sender may do
-- ---------------------------------------------------------------------------

select ok(has_function_privilege('service_role', 'public.deliverable_device_tokens(uuid)', 'execute'),
  'the service role can still call the sender function');
select ok(not has_function_privilege('anon', 'public.deliverable_device_tokens(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.deliverable_device_tokens(uuid)', 'execute'),
  'neither anon nor signed-in accounts can call it');

-- ---------------------------------------------------------------------------
-- A rotation keeps the device deliverable
-- ---------------------------------------------------------------------------

set local role service_role;
select results_eq($$ select token from public.deliverable_device_tokens() $$,
  $$ values ('rotated-device-token-0001') $$, 'a device is deliverable while its session lives');
reset role;

insert into public.auth_sessions
  (id, user_id, secret_hash, refresh_hash, family_id, expires_at, refresh_expires_at)
values
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000c1',
   decode(repeat('12', 32), 'hex'), decode(repeat('22', 32), 'hex'),
   '00000000-0000-4000-8000-0000000000e1', now() + interval '15 minutes', now() + interval '30 days');
update public.auth_sessions
   set revoked_at = now(), replaced_by = '00000000-0000-4000-8000-0000000000d2'
 where id = '00000000-0000-4000-8000-0000000000d1';

set local role service_role;
select results_eq($$ select token from public.deliverable_device_tokens() $$,
  $$ values ('rotated-device-token-0001') $$,
  'a normal session rotation keeps the device deliverable');
reset role;
select is((select session_id from public.device_tokens where token = 'rotated-device-token-0001'),
  '00000000-0000-4000-8000-0000000000d1'::uuid,
  'the registration still records the session that made it: the session id is metadata');

-- A second rotation in the same login is the same story.
insert into public.auth_sessions
  (id, user_id, secret_hash, refresh_hash, family_id, expires_at, refresh_expires_at)
values
  ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000c1',
   decode(repeat('13', 32), 'hex'), decode(repeat('23', 32), 'hex'),
   '00000000-0000-4000-8000-0000000000e1', now() + interval '15 minutes', now() + interval '30 days');
update public.auth_sessions
   set revoked_at = now(), replaced_by = '00000000-0000-4000-8000-0000000000d3'
 where id = '00000000-0000-4000-8000-0000000000d2';
set local role service_role;
select is((select count(*)::int from public.deliverable_device_tokens()), 1,
  'a second rotation keeps it too, however long the login has been refreshing');
reset role;

-- The replacement itself has to be alive.
update public.auth_sessions set refresh_expires_at = now() - interval '1 minute'
 where id = '00000000-0000-4000-8000-0000000000d3';
set local role service_role;
select is((select count(*)::int from public.deliverable_device_tokens()), 0,
  'a login whose refresh window has closed delivers nothing');
reset role;
update public.auth_sessions set refresh_expires_at = now() + interval '30 days'
 where id = '00000000-0000-4000-8000-0000000000d3';
set local role service_role;
select is((select count(*)::int from public.deliverable_device_tokens()), 1,
  'and delivers again when it is open');
reset role;

-- A spent refresh token revokes the whole family: no live session is left to deliver through.
update public.auth_sessions set revoked_at = now()
 where family_id = '00000000-0000-4000-8000-0000000000e1' and revoked_at is null;
set local role service_role;
select is((select count(*)::int from public.deliverable_device_tokens()), 0,
  'a family revoked for a reused refresh token delivers nothing');
reset role;

-- ---------------------------------------------------------------------------
-- Signing out is not a rotation
-- ---------------------------------------------------------------------------

insert into public.auth_sessions
  (id, user_id, secret_hash, refresh_hash, family_id, expires_at, refresh_expires_at)
values
  ('00000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000c1',
   decode(repeat('14', 32), 'hex'), decode(repeat('24', 32), 'hex'),
   '00000000-0000-4000-8000-0000000000e2', now() + interval '15 minutes', now() + interval '30 days');
insert into public.device_tokens (user_id, token, platform, session_id) values
  ('00000000-0000-4000-8000-0000000000c1', 'signed-out-device-token-01', 'android',
   '00000000-0000-4000-8000-0000000000d4');
update public.auth_sessions set revoked_at = now() where id = '00000000-0000-4000-8000-0000000000d4';

set local role service_role;
select is((select count(*)::int from public.deliverable_device_tokens()
  where token = 'signed-out-device-token-01'), 0,
  'a signed-out session has no successor, so its device delivers nothing');
reset role;
select is((select count(*)::int from public.device_tokens where token = 'signed-out-device-token-01'), 1,
  'the row of a signed-out session remains, undeliverable');

-- ---------------------------------------------------------------------------
-- Ownership, dead tokens, and the Supabase Auth sessions that are not rotated
-- ---------------------------------------------------------------------------

update public.auth_sessions set user_id = '00000000-0000-4000-8000-0000000000c2'
 where family_id = '00000000-0000-4000-8000-0000000000e2';
insert into public.auth_sessions
  (id, user_id, secret_hash, refresh_hash, family_id, expires_at, refresh_expires_at)
values
  ('00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000c1',
   decode(repeat('15', 32), 'hex'), decode(repeat('25', 32), 'hex'),
   '00000000-0000-4000-8000-0000000000e3', now() + interval '15 minutes', now() + interval '30 days');
insert into public.device_tokens (user_id, token, platform, session_id) values
  ('00000000-0000-4000-8000-0000000000c1', 'ownership-device-token-0001', 'android',
   '00000000-0000-4000-8000-0000000000d5');
-- A replacement that belongs to another account: the chain is only followed to a session of
-- the device's own account, so this can never make another account's login deliver it.
insert into public.auth_sessions
  (id, user_id, secret_hash, refresh_hash, family_id, expires_at, refresh_expires_at)
values
  ('00000000-0000-4000-8000-0000000000d6', '00000000-0000-4000-8000-0000000000c2',
   decode(repeat('16', 32), 'hex'), decode(repeat('26', 32), 'hex'),
   '00000000-0000-4000-8000-0000000000e3', now() + interval '15 minutes', now() + interval '30 days');
update public.auth_sessions
   set revoked_at = now(), replaced_by = '00000000-0000-4000-8000-0000000000d6'
 where id = '00000000-0000-4000-8000-0000000000d5';
set local role service_role;
select is((select count(*)::int from public.deliverable_device_tokens()
  where token = 'ownership-device-token-0001'), 0,
  'a session replaced by one of another account never delivers the token');
reset role;
update public.auth_sessions
   set revoked_at = null, replaced_by = null
 where id = '00000000-0000-4000-8000-0000000000d5';
set local role service_role;
select is((select count(*)::int from public.deliverable_device_tokens()
  where token = 'ownership-device-token-0001'), 1,
  'and delivers again once its own login is the live one');
reset role;

update public.device_tokens set invalidated_at = now()
 where token = 'ownership-device-token-0001';
set local role service_role;
select is((select count(*)::int from public.deliverable_device_tokens()
  where token = 'ownership-device-token-0001'), 0,
  'a token the push service reported dead stays dead');
reset role;

insert into auth.sessions (id, user_id) values
  ('5e000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c2');
insert into public.device_tokens (user_id, token, platform, session_id) values
  ('00000000-0000-4000-8000-0000000000c2', 'supabase-session-token-0001', 'android',
   '5e000000-0000-4000-8000-0000000000c2');
set local role service_role;
select results_eq($$ select token from public.deliverable_device_tokens('00000000-0000-4000-8000-0000000000c2') $$,
  $$ values ('supabase-session-token-0001') $$,
  'a Supabase Auth session still delivers while it has not ended');
reset role;
update auth.sessions set not_after = now() - interval '1 minute'
 where id = '5e000000-0000-4000-8000-0000000000c2';
set local role service_role;
select is((select count(*)::int from public.deliverable_device_tokens('00000000-0000-4000-8000-0000000000c2')), 0,
  'and stops when it ends');
reset role;

select * from finish();
rollback;
