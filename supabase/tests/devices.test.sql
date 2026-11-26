-- Database-level checks for push-device registration: end users never read or write
-- device_tokens directly, register_device_token / unregister_device_token act for the
-- caller only, a token belongs to one account at a time, and an account keeps at most
-- 10 devices. Each token is bound to the Auth session that registered it, and the
-- sender reads tokens only while that session lives. Runs inside a transaction that
-- is rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(84);

-- ---------------------------------------------------------------------------
-- Fixtures (as the database owner)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000b1', 'dev-a@example.com', now()),
  ('00000000-0000-4000-8000-0000000000b2', 'dev-b@example.com', now()),
  ('00000000-0000-4000-8000-0000000000b3', 'dev-staff@example.com', now()),
  ('00000000-0000-4000-8000-0000000000b4', 'dev-admin@example.com', now()),
  ('00000000-0000-4000-8000-0000000000b5', 'dev-held@example.com', now()),
  ('00000000-0000-4000-8000-0000000000b6', 'dev-owner@example.com', now()),
  ('00000000-0000-4000-8000-0000000000b7', 'dev-cap@example.com', now());

update public.user_roles set role = 'staff' where user_id = '00000000-0000-4000-8000-0000000000b3';
update public.user_roles set role = 'admin' where user_id = '00000000-0000-4000-8000-0000000000b4';
update public.user_roles set role = 'super_admin' where user_id = '00000000-0000-4000-8000-0000000000b6';
update public.profiles set status = 'suspended' where id = '00000000-0000-4000-8000-0000000000b5';

create temporary table t (key text primary key, value text) on commit drop;
grant select, insert, update on t to authenticated;
insert into t select 'audit-before', count(*)::text from public.audit_log;

-- ---------------------------------------------------------------------------
-- Privileges: the table is closed to end users, the functions are the way in
-- ---------------------------------------------------------------------------

select ok((select relrowsecurity from pg_class where oid = 'public.device_tokens'::regclass),
  'RLS is enabled on device_tokens');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'device_tokens'), 0,
  'no end-user policy exists');
select ok(not exists (
  select 1 from unnest(array['anon', 'authenticated', 'public']) r, unnest(array['select', 'insert', 'update', 'delete']) p
  where r <> 'public' and has_table_privilege(r, 'public.device_tokens', p)
), 'anon and authenticated hold no privilege on the table');
select ok((select bool_and(has_table_privilege('service_role', 'public.device_tokens', p))
  from unnest(array['select', 'insert', 'update', 'delete']) p), 'the service role reads and writes the table');
select ok(not has_function_privilege('anon', 'public.register_device_token(text, public.device_platform, text)', 'execute')
  and not has_function_privilege('anon', 'public.unregister_device_token(text)', 'execute'),
  'anon cannot call the device functions');
select ok(has_function_privilege('authenticated', 'public.register_device_token(text, public.device_platform, text)', 'execute')
  and has_function_privilege('authenticated', 'public.unregister_device_token(text)', 'execute'),
  'signed-in accounts can call the device functions');
select ok(not has_function_privilege('anon', 'public.deliverable_device_tokens(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.deliverable_device_tokens(uuid)', 'execute')
  and not has_function_privilege('public', 'public.deliverable_device_tokens(uuid)', 'execute'),
  'neither anon nor signed-in accounts can call the sender function');
select ok(has_function_privilege('service_role', 'public.deliverable_device_tokens(uuid)', 'execute'),
  'the service role can call the sender function');

set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select throws_ok($$ select * from public.deliverable_device_tokens() $$,
  '42501', null, 'anon cannot read deliverable tokens');
select throws_ok($$ select public.register_device_token('anon-token-0000000000000000', 'android') $$,
  '42501', null, 'anon cannot register a device');
select throws_ok($$ select public.unregister_device_token('anon-token-0000000000000000') $$,
  '42501', null, 'anon cannot remove a device');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b1", "session_id": "5e000000-0000-4000-8000-0000000000b1", "role": "authenticated"}';
select throws_ok($$ select token from public.device_tokens $$, '42501', null, 'a signed-in account cannot read tokens');
select throws_ok($$ insert into public.device_tokens (user_id, token, platform)
  values ('00000000-0000-4000-8000-0000000000b1', 'direct-insert-token-0000000', 'android') $$,
  '42501', null, 'a signed-in account cannot insert tokens directly');
select throws_ok($$ update public.device_tokens set platform = 'ios' $$, '42501', null,
  'a signed-in account cannot update tokens directly');
select throws_ok($$ delete from public.device_tokens $$, '42501', null,
  'a signed-in account cannot delete tokens directly');
select throws_ok($$ select * from public.deliverable_device_tokens() $$,
  '42501', null, 'a signed-in account cannot read deliverable tokens');

set local request.jwt.claims to '{"role": "authenticated"}';
select throws_ok($$ select public.register_device_token('no-subject-token-00000000', 'android') $$,
  '42501', 'sign in to register a device', 'a token without a subject cannot register');
select throws_ok($$ select public.unregister_device_token('no-subject-token-00000000') $$,
  '42501', 'sign in to remove a device', 'a token without a subject cannot remove');

-- ---------------------------------------------------------------------------
-- Registering and re-registering
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b1", "session_id": "5e000000-0000-4000-8000-0000000000b1", "role": "authenticated"}';
select lives_ok($$ insert into t select 'device-a', public.register_device_token('token-A-0123456789abcdefghij', 'android', '1.0.0')::text $$,
  'an account registers its device token');

reset role;
select results_eq($$ select user_id::text, platform::text, app_version, invalidated_at is null
  from public.device_tokens where token = 'token-A-0123456789abcdefghij' $$,
  $$ values ('00000000-0000-4000-8000-0000000000b1', 'android', '1.0.0', true) $$,
  'the token is stored for the caller with its platform and version');
select is((select id::text from public.device_tokens where token = 'token-A-0123456789abcdefghij'),
  (select value from t where key = 'device-a'), 'the function returns the row id');
select is((select session_id::text from public.device_tokens where token = 'token-A-0123456789abcdefghij'),
  '5e000000-0000-4000-8000-0000000000b1', 'the session of the access token is stored with the token');
insert into t select 'seen-1', last_seen_at::text from public.device_tokens where token = 'token-A-0123456789abcdefghij';

update public.device_tokens set invalidated_at = now() where token = 'token-A-0123456789abcdefghij';
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b1", "session_id": "5e000000-0000-4000-8000-0000000000b1", "role": "authenticated"}';
select is((select public.register_device_token('token-A-0123456789abcdefghij', 'ios', '1.1.0')::text),
  (select value from t where key = 'device-a'), 'registering the same token again returns the same device (idempotent)');

reset role;
select is((select count(*)::int from public.device_tokens where token = 'token-A-0123456789abcdefghij'), 1,
  'no duplicate row is created');
select results_eq($$ select platform::text, app_version, invalidated_at is null
  from public.device_tokens where token = 'token-A-0123456789abcdefghij' $$,
  $$ values ('ios', '1.1.0', true) $$, 're-registering updates platform and version and revives a dead token');
select ok((select last_seen_at > (select value::timestamptz from t where key = 'seen-1')
  from public.device_tokens where token = 'token-A-0123456789abcdefghij'), 're-registering refreshes last_seen_at');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b1", "session_id": "5e000000-0000-4000-8000-0000000000b1", "role": "authenticated"}';
select lives_ok($$ select public.register_device_token('token-A-0123456789abcdefghij', 'android', '  ') $$,
  'a blank app version is accepted');
reset role;
select is((select app_version from public.device_tokens where token = 'token-A-0123456789abcdefghij'), null,
  'a blank app version is stored as null');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b1", "session_id": "5e000000-0000-4000-8000-0000000000f1", "role": "authenticated"}';
select lives_ok($$ select public.register_device_token('token-A-0123456789abcdefghij', 'android') $$,
  'the same account registers the token again from a new session');
reset role;
select is((select session_id::text from public.device_tokens where token = 'token-A-0123456789abcdefghij'),
  '5e000000-0000-4000-8000-0000000000f1', 'the token follows the newest session');

-- ---------------------------------------------------------------------------
-- Invalid input
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b1", "session_id": "5e000000-0000-4000-8000-0000000000b1", "role": "authenticated"}';
select throws_ok($$ select public.register_device_token('short-token', 'android') $$, 'NZ412', null, 'a token under 20 characters is refused');
select throws_ok($$ select public.register_device_token(repeat('a', 1025), 'android') $$, 'NZ412', null, 'a token over 1,024 characters is refused');
select lives_ok($$ select public.register_device_token(repeat('b', 1024), 'android') $$, 'a token of exactly 1,024 characters is accepted');
select lives_ok($$ select public.unregister_device_token(repeat('b', 1024)) $$, 'and can be removed again');
select throws_ok($$ select public.register_device_token('token with spaces 0123456789', 'android') $$, 'NZ412', null, 'a token with whitespace is refused');
select throws_ok($$ select public.register_device_token(E'token-with-newline-0123\n4567', 'android') $$, 'NZ412', null, 'a token with a newline is refused');
select throws_ok($$ select public.register_device_token('token-with-quote-0123456789''', 'android') $$, 'NZ412', null, 'a token with a quote is refused');
select throws_ok($$ select public.register_device_token('token-with-<tags>-0123456789', 'android') $$, 'NZ412', null, 'a token with markup characters is refused');
select throws_ok($$ select public.register_device_token(null, 'android') $$, 'NZ412', null, 'a missing token is refused');
select throws_ok($$ select public.register_device_token('token-A-0123456789abcdefghij', null) $$, 'NZ412', null, 'a missing platform is refused');
select throws_ok($$ select public.register_device_token('token-A-0123456789abcdefghij', 'android', repeat('1', 33)) $$, 'NZ412', null, 'an app version over 32 characters is refused');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b1", "role": "authenticated"}';
select throws_ok($$ select public.register_device_token('token-nosession-0123456789', 'android') $$,
  'NZ412', null, 'an access token without a session claim cannot register a device');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b1", "session_id": "not-a-uuid", "role": "authenticated"}';
select throws_ok($$ select public.register_device_token('token-nosession-0123456789', 'android') $$,
  'NZ412', null, 'a session claim that is not a uuid is refused');
reset role;
select is((select count(*)::int from public.device_tokens), 1, 'refused registrations stored nothing');

-- ---------------------------------------------------------------------------
-- Another account takes the device over; removal is the caller's own token only
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b2", "session_id": "5e000000-0000-4000-8000-0000000000b2", "role": "authenticated"}';
select is((select public.register_device_token('token-A-0123456789abcdefghij', 'android', '2.0.0')::text),
  (select value from t where key = 'device-a'), 'a second account registering the same token takes the device over');

reset role;
select results_eq($$ select count(*)::int, min(user_id::text) from public.device_tokens where token = 'token-A-0123456789abcdefghij' $$,
  $$ values (1, '00000000-0000-4000-8000-0000000000b2') $$, 'the token now belongs to the second account only');
select is((select session_id::text from public.device_tokens where token = 'token-A-0123456789abcdefghij'),
  '5e000000-0000-4000-8000-0000000000b2', 'a takeover binds the token to the new account''s session');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b1", "session_id": "5e000000-0000-4000-8000-0000000000b1", "role": "authenticated"}';
select is((select public.unregister_device_token('token-A-0123456789abcdefghij')), false,
  'the first account can no longer remove the token');
select is((select public.unregister_device_token('token-never-registered-000000')), false,
  'removing an unknown token answers the same, revealing nothing about other accounts');

reset role;
select is((select count(*)::int from public.device_tokens where token = 'token-A-0123456789abcdefghij'), 1,
  'the other account''s token was not removed');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b2", "session_id": "5e000000-0000-4000-8000-0000000000b2", "role": "authenticated"}';
select is((select public.unregister_device_token('token-A-0123456789abcdefghij')), true, 'an account removes its own token');
select is((select public.unregister_device_token('token-A-0123456789abcdefghij')), false, 'removing it again is harmless');
reset role;
select is((select count(*)::int from public.device_tokens), 0, 'the table is empty again');

-- ---------------------------------------------------------------------------
-- Who may register
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b5", "session_id": "5e000000-0000-4000-8000-0000000000b5", "role": "authenticated"}';
select throws_ok($$ select public.register_device_token('token-held-0123456789abcdef', 'android') $$,
  'NZ403', null, 'a suspended account cannot register a device');
select lives_ok($$ select public.unregister_device_token('token-held-0123456789abcdef') $$,
  'a suspended account can still remove its own token');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b3", "session_id": "5e000000-0000-4000-8000-0000000000b3", "role": "authenticated"}';
select lives_ok($$ select public.register_device_token('token-staff-0123456789abcde', 'android') $$, 'staff may register a device');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b4", "session_id": "5e000000-0000-4000-8000-0000000000b4", "role": "authenticated"}';
select lives_ok($$ select public.register_device_token('token-admin-0123456789abcde', 'android') $$, 'an admin may register a device');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b6", "session_id": "5e000000-0000-4000-8000-0000000000b6", "role": "authenticated"}';
select lives_ok($$ select public.register_device_token('token-owner-0123456789abcde', 'ios') $$, 'an owner may register a device');
reset role;
select is((select count(*)::int from public.device_tokens), 3, 'only the three active accounts have devices');

-- ---------------------------------------------------------------------------
-- The per-account cap keeps the 10 most recently seen devices
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b7", "session_id": "5e000000-0000-4000-8000-0000000000b7", "role": "authenticated"}';
select lives_ok($$ select public.register_device_token('cap-token-' || lpad(i::text, 10, '0'), 'android')
  from generate_series(1, 12) i $$, 'twelve registrations succeed');

reset role;
select is((select count(*)::int from public.device_tokens where user_id = '00000000-0000-4000-8000-0000000000b7'), 10,
  'an account keeps at most 10 devices');
select results_eq($$ select min(token), max(token) from public.device_tokens where user_id = '00000000-0000-4000-8000-0000000000b7' $$,
  $$ values ('cap-token-0000000003', 'cap-token-0000000012') $$, 'the two least recently seen were forgotten');
select is((select count(*)::int from public.device_tokens where user_id <> '00000000-0000-4000-8000-0000000000b7'), 3,
  'other accounts'' devices are untouched');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b7", "session_id": "5e000000-0000-4000-8000-0000000000b7", "role": "authenticated"}';
select lives_ok($$ select public.register_device_token('cap-token-0000000003', 'android') $$, 'an old device is seen again');
select lives_ok($$ select public.register_device_token('cap-token-0000000013', 'android') $$, 'a new device is registered');
reset role;
select results_eq($$ select token from public.device_tokens where user_id = '00000000-0000-4000-8000-0000000000b7'
  and token in ('cap-token-0000000003', 'cap-token-0000000004', 'cap-token-0000000013') order by token $$,
  $$ values ('cap-token-0000000003'), ('cap-token-0000000013') $$,
  'the refreshed device survived, the next least recently seen did not, and the new one is kept');

-- The table itself holds the same limit as the function (the old 4,096 limit is gone).
select throws_ok($$ insert into public.device_tokens (user_id, token, platform)
  values ('00000000-0000-4000-8000-0000000000b1', repeat('c', 1025), 'android') $$,
  '23514', null, 'the table refuses a token over 1,024 characters');
select is((select count(*)::int from pg_constraint where conrelid = 'public.device_tokens'::regclass
  and contype = 'c' and pg_get_constraintdef(oid) like '%char_length(token)%'), 1,
  'one token-format constraint remains after the old one was replaced');

-- ---------------------------------------------------------------------------
-- The sender's view: a token is deliverable only while its session lives
-- ---------------------------------------------------------------------------

set local role service_role;
select is((select count(*)::int from public.deliverable_device_tokens()), 0,
  'no token is deliverable while none of the sessions exists');
reset role;

insert into auth.sessions (id, user_id) values
  ('5e000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000b3'),
  ('5e000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000b4');

set local role service_role;
select results_eq($$ select token from public.deliverable_device_tokens() order by token $$,
  $$ values ('token-admin-0123456789abcde'), ('token-staff-0123456789abcde') $$,
  'a token is deliverable once its session exists');
select results_eq($$ select token from public.deliverable_device_tokens('00000000-0000-4000-8000-0000000000b3') $$,
  $$ values ('token-staff-0123456789abcde') $$, 'one account''s deliverable tokens can be asked for');
reset role;

delete from auth.sessions where id = '5e000000-0000-4000-8000-0000000000b3';
set local role service_role;
select results_eq($$ select token from public.deliverable_device_tokens() order by token $$,
  $$ values ('token-admin-0123456789abcde') $$, 'a token disappears when its session ends');
reset role;
select is((select count(*)::int from public.device_tokens where token = 'token-staff-0123456789abcde'), 1,
  'the row of an ended session remains, undeliverable');

update auth.sessions set not_after = now() - interval '1 minute' where id = '5e000000-0000-4000-8000-0000000000b4';
set local role service_role;
select is((select count(*)::int from public.deliverable_device_tokens()), 0, 'a session that has run out delivers nothing');
reset role;
update auth.sessions set not_after = now() + interval '1 hour' where id = '5e000000-0000-4000-8000-0000000000b4';
set local role service_role;
select is((select count(*)::int from public.deliverable_device_tokens()), 1, 'a session that has not run out yet delivers');
reset role;
update auth.sessions set not_after = null where id = '5e000000-0000-4000-8000-0000000000b4';
set local role service_role;
select is((select count(*)::int from public.deliverable_device_tokens()), 1, 'a session without an end delivers');
reset role;

update auth.sessions set user_id = '00000000-0000-4000-8000-0000000000b6' where id = '5e000000-0000-4000-8000-0000000000b4';
set local role service_role;
select is((select count(*)::int from public.deliverable_device_tokens()), 0, 'a session of another account never delivers the token');
reset role;
update auth.sessions set user_id = '00000000-0000-4000-8000-0000000000b4' where id = '5e000000-0000-4000-8000-0000000000b4';

update public.device_tokens set invalidated_at = now() where token = 'token-admin-0123456789abcde';
set local role service_role;
select is((select count(*)::int from public.deliverable_device_tokens()), 0, 'a token marked dead is not deliverable');
reset role;
update public.device_tokens set invalidated_at = null where token = 'token-admin-0123456789abcde';

-- Rows from before sessions were recorded have no session: undeliverable even though
-- the account has a live session.
insert into public.device_tokens (user_id, token, platform, session_id)
values ('00000000-0000-4000-8000-0000000000b4', 'legacy-token-without-session-0', 'android', null);
set local role service_role;
select results_eq($$ select token from public.deliverable_device_tokens('00000000-0000-4000-8000-0000000000b4') $$,
  $$ values ('token-admin-0123456789abcde') $$, 'a row without a session is never deliverable');
reset role;
select is((select count(*)::int from public.device_tokens where session_id is null), 1,
  'only that legacy row has no session');
delete from public.device_tokens where token = 'legacy-token-without-session-0';
delete from auth.sessions where id = '5e000000-0000-4000-8000-0000000000b4';

-- ---------------------------------------------------------------------------
-- The sender's access, cascades and the audit log
-- ---------------------------------------------------------------------------

set local role service_role;
select lives_ok($$ select user_id, token, platform, invalidated_at from public.device_tokens $$,
  'the service role reads tokens for the sender');
select lives_ok($$ update public.device_tokens set invalidated_at = now() where token = 'token-staff-0123456789abcde' $$,
  'the service role marks a token dead');
reset role;

select is((select count(*)::int from public.audit_log), (select value::int from t where key = 'audit-before'),
  'registering and removing devices writes no audit entries');

delete from auth.users where id = '00000000-0000-4000-8000-0000000000b7';
select is((select count(*)::int from public.device_tokens where user_id = '00000000-0000-4000-8000-0000000000b7'), 0,
  'deleting an account deletes its tokens');

select * from finish();
rollback;
