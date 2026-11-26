-- Database-level checks for the order-notification outbox: a status change queues one row
-- for the customer in the same transaction (and not when it is rolled back, nor for the
-- customer's own actions), the table and worker functions are closed to end users, the
-- worker's claim leases rows and skips suspended accounts, outcomes move rows through
-- pending / sent / failed with backoff and a retry limit, and dead device tokens can be
-- marked. Runs inside a transaction that is rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(73);

-- ---------------------------------------------------------------------------
-- Fixtures (as the database owner)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000c1', 'ntf-a@example.com', now()),
  ('00000000-0000-4000-8000-0000000000c2', 'ntf-held@example.com', now()),
  ('00000000-0000-4000-8000-0000000000c3', 'ntf-b@example.com', now());

update public.profiles set status = 'suspended' where id = '00000000-0000-4000-8000-0000000000c2';

insert into public.orders (id, order_number, user_id, item_count, subtotal_minor, shipping_fee_minor, total_minor,
  delivery_zone, ship_recipient_name, ship_phone, ship_division, ship_district, ship_area, ship_address_line,
  idempotency_key, request_fingerprint) values
  ('0d000000-0000-4000-8000-0000000000a1', 'NZ900001', '00000000-0000-4000-8000-0000000000c1', 1, 1000, 0, 1000,
    'inside_dhaka', 'Test', '01700000000', 'Dhaka', 'Dhaka', 'Area', 'Line', gen_random_uuid(), 'fp'),
  ('0d000000-0000-4000-8000-0000000000a2', 'NZ900002', '00000000-0000-4000-8000-0000000000c2', 1, 1000, 0, 1000,
    'inside_dhaka', 'Test', '01700000000', 'Dhaka', 'Dhaka', 'Area', 'Line', gen_random_uuid(), 'fp'),
  ('0d000000-0000-4000-8000-0000000000a3', 'NZ900003', '00000000-0000-4000-8000-0000000000c3', 1, 1000, 0, 1000,
    'inside_dhaka', 'Test', '01700000000', 'Dhaka', 'Dhaka', 'Area', 'Line', gen_random_uuid(), 'fp');

create temporary table t (key text primary key, value text) on commit drop;
grant select, insert, update on t to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privileges: closed to end users, open to the service role
-- ---------------------------------------------------------------------------

select ok((select relrowsecurity from pg_class where oid = 'public.notification_outbox'::regclass),
  'RLS is enabled on notification_outbox');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'notification_outbox'), 0,
  'no end-user policy exists');
select ok(not exists (
  select 1 from unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete']) p
  where has_table_privilege(r, 'public.notification_outbox', p)
), 'anon and authenticated hold no privilege on the table');
select ok((select bool_and(has_table_privilege('service_role', 'public.notification_outbox', p))
  from unnest(array['select', 'insert', 'update', 'delete']) p), 'the service role reads and writes the table');
select ok(not exists (
  select 1 from unnest(array['anon', 'authenticated']) r,
    unnest(array['public.claim_notifications(integer, integer)', 'public.finish_notification(uuid, text, integer, text)',
      'public.invalidate_device_tokens(uuid[])']) f
  where has_function_privilege(r, f, 'execute')
), 'neither anon nor signed-in accounts can call the worker functions');
select ok(not exists (
  select 1 from unnest(array['public.claim_notifications(integer, integer)', 'public.finish_notification(uuid, text, integer, text)',
    'public.invalidate_device_tokens(uuid[])']) f
  where coalesce((select proacl::text from pg_proc where oid = f::regprocedure), '') ~ '(^\{|,)=X'
), 'no worker function is executable by PUBLIC');
select ok((select bool_and(has_function_privilege('service_role', f, 'execute'))
  from unnest(array['public.claim_notifications(integer, integer)', 'public.finish_notification(uuid, text, integer, text)',
    'public.invalidate_device_tokens(uuid[])']) f), 'the service role can call the worker functions');

set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select throws_ok($$ select * from public.claim_notifications() $$, '42501', null, 'anon cannot claim notifications');
select throws_ok($$ select public.finish_notification(gen_random_uuid(), 'sent') $$, '42501', null, 'anon cannot finish a notification');
select throws_ok($$ select public.invalidate_device_tokens(array[gen_random_uuid()]) $$, '42501', null, 'anon cannot mark tokens dead');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated"}';
select throws_ok($$ select * from public.notification_outbox $$, '42501', null, 'a customer cannot read the outbox, not even their own');
select throws_ok($$ insert into public.notification_outbox (user_id, order_id, order_number, to_status, history_id)
  values ('00000000-0000-4000-8000-0000000000c1', '0d000000-0000-4000-8000-0000000000a1', 'NZ900001', 'shipped', 1) $$,
  '42501', null, 'a customer cannot queue a notification');
select throws_ok($$ update public.notification_outbox set status = 'sent' $$, '42501', null, 'a customer cannot change the outbox');
select throws_ok($$ delete from public.notification_outbox $$, '42501', null, 'a customer cannot delete from the outbox');
select throws_ok($$ select * from public.claim_notifications() $$, '42501', null, 'a customer cannot claim notifications');
select throws_ok($$ select public.finish_notification(gen_random_uuid(), 'sent') $$, '42501', null, 'a customer cannot finish a notification');
select throws_ok($$ select public.invalidate_device_tokens(array[gen_random_uuid()]) $$, '42501', null, 'a customer cannot mark tokens dead');
reset role;

-- ---------------------------------------------------------------------------
-- Enqueue
-- ---------------------------------------------------------------------------

-- The counts below are of this test's own notifications. A database that has been used
-- (local orders moved through their steps) already holds queued rows, so they are set
-- aside first; the whole test runs in a transaction that is rolled back, so nothing real
-- is removed.
delete from public.notification_outbox;

insert into public.order_status_history (order_id, from_status, to_status, actor_kind, actor_id) values
  ('0d000000-0000-4000-8000-0000000000a1', null, 'pending', 'customer', '00000000-0000-4000-8000-0000000000c1');
select is((select count(*)::int from public.notification_outbox), 0, 'placing an order queues nothing');

insert into public.order_status_history (order_id, from_status, to_status, actor_kind, actor_id) values
  ('0d000000-0000-4000-8000-0000000000a1', 'pending', 'cancelled', 'customer', '00000000-0000-4000-8000-0000000000c1');
select is((select count(*)::int from public.notification_outbox), 0, 'the customer cancelling their own order queues nothing');

insert into public.order_status_history (order_id, from_status, to_status, actor_kind) values
  ('0d000000-0000-4000-8000-0000000000a1', 'pending', 'pending', 'staff');
select is((select count(*)::int from public.notification_outbox), 0, 'a pending status queues nothing');

savepoint rolled_back;
insert into public.order_status_history (order_id, from_status, to_status, actor_kind) values
  ('0d000000-0000-4000-8000-0000000000a1', 'pending', 'confirmed', 'staff');
select is((select count(*)::int from public.notification_outbox), 1, 'a staff confirmation queues a notification');
rollback to savepoint rolled_back;
select is((select count(*)::int from public.notification_outbox), 0, 'rolling the status change back also removes the notification');

insert into public.order_status_history (order_id, from_status, to_status, actor_kind) values
  ('0d000000-0000-4000-8000-0000000000a1', 'pending', 'confirmed', 'staff'),
  ('0d000000-0000-4000-8000-0000000000a1', 'confirmed', 'processing', 'staff'),
  ('0d000000-0000-4000-8000-0000000000a1', 'processing', 'shipped', 'staff'),
  ('0d000000-0000-4000-8000-0000000000a1', 'shipped', 'delivered', 'staff');
insert into public.order_status_history (order_id, from_status, to_status, actor_kind) values
  ('0d000000-0000-4000-8000-0000000000a3', 'pending', 'cancelled', 'system');

select results_eq($$ select to_status::text from public.notification_outbox where order_id = '0d000000-0000-4000-8000-0000000000a1' order by history_id $$,
  $$ values ('confirmed'), ('processing'), ('shipped'), ('delivered') $$,
  'each customer-facing status change queues one notification, in order');
select results_eq($$ select user_id::text, order_number, status::text, attempts, last_error is null, sent_at is null
  from public.notification_outbox where order_id = '0d000000-0000-4000-8000-0000000000a3' $$,
  $$ values ('00000000-0000-4000-8000-0000000000c3', 'NZ900003', 'pending', 0, true, true) $$,
  'a system cancellation is queued for the order''s customer, pending with no attempts');

select throws_ok($$ insert into public.notification_outbox (user_id, order_id, order_number, to_status, history_id)
  select user_id, order_id, order_number, to_status, history_id from public.notification_outbox limit 1 $$,
  '23505', null, 'a status change cannot be queued twice');
select is((select count(*)::int from public.notification_outbox), 5, 'the failed duplicate added nothing');

-- the suspended account's order is queued too; the claim skips it
insert into public.order_status_history (order_id, from_status, to_status, actor_kind) values
  ('0d000000-0000-4000-8000-0000000000a2', 'pending', 'confirmed', 'staff');
select is((select count(*)::int from public.notification_outbox), 6, 'a suspended account''s notification is queued');

-- ---------------------------------------------------------------------------
-- Claiming
-- ---------------------------------------------------------------------------

-- Older rows go first, so the limit below is not spent on the suspended account's row
update public.notification_outbox set next_attempt_at = now() - interval '1 hour'
  where user_id <> '00000000-0000-4000-8000-0000000000c2';

set local role service_role;
select throws_ok($$ select * from public.claim_notifications(0) $$, 'NZ412', null, 'a claim of zero rows is refused');
select throws_ok($$ select * from public.claim_notifications(101) $$, 'NZ412', null, 'a claim above 100 rows is refused');
select throws_ok($$ select * from public.claim_notifications(10, 4) $$, 'NZ412', null, 'a lease under 5 seconds is refused');
select throws_ok($$ select * from public.claim_notifications(10, 3601) $$, 'NZ412', null, 'a lease over an hour is refused');
select throws_ok($$ select * from public.claim_notifications(null, 60) $$, 'NZ412', null, 'a missing limit is refused');

insert into t select 'claim-1', string_agg(id::text, ',' order by id) from public.claim_notifications(2, 60);
reset role;
select is((select array_length(string_to_array(value, ','), 1) from t where key = 'claim-1'), 2, 'a claim returns at most the limit');
select results_eq($$ select status::text, attempts, locked_until = now() + interval '60 seconds'
  from public.notification_outbox where id = any (string_to_array((select value from t where key = 'claim-1'), ',')::uuid[]) $$,
  $$ values ('sending', 1, true), ('sending', 1, true) $$, 'claimed rows are leased and count an attempt');

set local role service_role;
insert into t select 'claim-2', string_agg(id::text, ',' order by id) from public.claim_notifications(100, 60);
reset role;
select is((select array_length(string_to_array(value, ','), 1) from t where key = 'claim-2'), 3,
  'a second claim returns only the remaining rows of active accounts (3 of 4; the suspended one is skipped)');
select ok(not exists (select 1 from unnest(string_to_array((select value from t where key = 'claim-2'), ',')) a(id)
  where a.id = any (string_to_array((select value from t where key = 'claim-1'), ','))),
  'rows already leased are not claimed again');
select results_eq($$ select status::text, attempts, last_error from public.notification_outbox
  where order_id = '0d000000-0000-4000-8000-0000000000a2' $$,
  $$ values ('skipped', 0, 'account_inactive') $$, 'a suspended account''s notification is skipped without an attempt');

set local role service_role;
select is((select count(*)::int from public.claim_notifications(100, 60)), 0, 'with every row leased, skipped or finished, a claim returns nothing');
reset role;

-- A crashed worker: the lease runs out and the row is taken again
update public.notification_outbox set locked_until = now() - interval '1 second'
  where id = (select (string_to_array(value, ','))[1]::uuid from t where key = 'claim-1');
set local role service_role;
select results_eq($$ select attempts from public.claim_notifications(100, 60) $$, $$ values (2) $$,
  'a row whose lease expired is reclaimed, with a second attempt');
reset role;

-- Rows scheduled for later are not due
update public.notification_outbox set status = 'pending', locked_until = null, next_attempt_at = now() + interval '1 hour'
  where id = (select (string_to_array(value, ','))[2]::uuid from t where key = 'claim-1');
set local role service_role;
select is((select count(*)::int from public.claim_notifications(100, 60)), 0, 'a row scheduled for later is not claimed');
reset role;

-- ---------------------------------------------------------------------------
-- Finishing
-- ---------------------------------------------------------------------------

-- the three rows of claim-2 are in the sending state with attempts = 1
insert into t select 'f1', (string_to_array(value, ','))[1] from t where key = 'claim-2';
insert into t select 'f2', (string_to_array(value, ','))[2] from t where key = 'claim-2';
insert into t select 'f3', (string_to_array(value, ','))[3] from t where key = 'claim-2';

set local role service_role;
select is(public.finish_notification((select value from t where key = 'f1')::uuid, 'sent'), 'sent', 'a sent outcome finishes the row');
select is(public.finish_notification((select value from t where key = 'f1')::uuid, 'sent'), null,
  'finishing a row that is no longer being sent does nothing');
select is(public.finish_notification((select value from t where key = 'f1')::uuid, 'failed', 60, 'late'), null,
  'a finished row cannot be failed afterwards');
select is(public.finish_notification(gen_random_uuid(), 'sent'), null, 'an unknown row does nothing');
select throws_ok($$ select public.finish_notification(gen_random_uuid(), 'bogus') $$, 'NZ412', null, 'an unknown outcome is refused');
select throws_ok($$ select public.finish_notification(gen_random_uuid(), null) $$, 'NZ412', null, 'a missing outcome is refused');
reset role;
select results_eq($$ select status::text, sent_at is not null, locked_until is null, last_error is null
  from public.notification_outbox where id = (select value from t where key = 'f1')::uuid $$,
  $$ values ('sent', true, true, true) $$, 'a sent row records its time and releases its lease');

set local role service_role;
select is(public.finish_notification((select value from t where key = 'f2')::uuid, 'retry', 120, 'fcm_unavailable'), 'pending',
  'a retry puts the row back to pending');
reset role;
select results_eq($$ select status::text, next_attempt_at = now() + interval '120 seconds', locked_until is null, last_error
  from public.notification_outbox where id = (select value from t where key = 'f2')::uuid $$,
  $$ values ('pending', true, true, 'fcm_unavailable') $$, 'the retry is scheduled after the delay and remembers the error code');
set local role service_role;
select is((select count(*)::int from public.claim_notifications(100, 60) where id = (select value from t where key = 'f2')::uuid), 0,
  'a row waiting for its retry is not claimed early');
reset role;
update public.notification_outbox set next_attempt_at = now() where id = (select value from t where key = 'f2')::uuid;
set local role service_role;
select results_eq($$ select attempts from public.claim_notifications(100, 60) where id = (select value from t where key = 'f2')::uuid $$,
  $$ values (2) $$, 'after the delay the row is claimed again with a second attempt');
reset role;

-- giving up
update public.notification_outbox set attempts = 5 where id = (select value from t where key = 'f2')::uuid;
set local role service_role;
select is(public.finish_notification((select value from t where key = 'f2')::uuid, 'retry', 60, null), 'failed',
  'a retry on the fifth attempt gives up');
reset role;
select results_eq($$ select status::text, last_error, next_attempt_at <= now() from public.notification_outbox
  where id = (select value from t where key = 'f2')::uuid $$,
  $$ values ('failed', 'retries_exhausted', true) $$, 'a row that ran out of attempts is failed with a reason');

set local role service_role;
select is(public.finish_notification((select value from t where key = 'f3')::uuid, 'failed', 60, 'Bad Code With Spaces <b>'), 'failed',
  'a permanent failure is never retried');
reset role;
select is((select last_error from public.notification_outbox where id = (select value from t where key = 'f3')::uuid), 'error',
  'an error that is not a short machine code is replaced by a generic one');
select is((select count(*)::int from public.notification_outbox where status = 'sending'), 1,
  'only the row reclaimed earlier is still being sent');

-- nothing to deliver to
update public.notification_outbox set status = 'sending', attempts = 1, locked_until = now() + interval '1 minute'
  where id = (select value from t where key = 'f3')::uuid;
set local role service_role;
select is(public.finish_notification((select value from t where key = 'f3')::uuid, 'skipped', 60, 'no_device'), 'skipped',
  'a notification with nowhere to go is skipped, not failed');
reset role;
select results_eq($$ select status::text, last_error, locked_until is null, sent_at is null from public.notification_outbox
  where id = (select value from t where key = 'f3')::uuid $$,
  $$ values ('skipped', 'no_device', true, true) $$, 'a skipped row keeps the reason and is not retried');

-- retry delays are clamped
update public.notification_outbox set status = 'sending', attempts = 1, locked_until = now() + interval '1 minute'
  where id = (select value from t where key = 'f3')::uuid;
set local role service_role;
select is(public.finish_notification((select value from t where key = 'f3')::uuid, 'retry', 0, 'x'), 'pending', 'a zero delay still retries');
reset role;
select ok((select next_attempt_at = now() + interval '1 second' from public.notification_outbox where id = (select value from t where key = 'f3')::uuid),
  'a delay under a second is raised to one second');
update public.notification_outbox set status = 'sending', locked_until = now() + interval '1 minute'
  where id = (select value from t where key = 'f3')::uuid;
set local role service_role;
select is(public.finish_notification((select value from t where key = 'f3')::uuid, 'retry', 99999999, 'x'), 'pending', 'a huge delay still retries');
reset role;
select ok((select next_attempt_at = now() + interval '86400 seconds' from public.notification_outbox where id = (select value from t where key = 'f3')::uuid),
  'a delay over a day is capped at a day');

-- ---------------------------------------------------------------------------
-- Dead device tokens
-- ---------------------------------------------------------------------------

insert into auth.sessions (id, user_id) values
  ('5e000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c1'),
  ('5e000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000c3');
insert into public.device_tokens (id, user_id, token, platform, session_id) values
  ('de000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c1', 'ntf-token-a1-0123456789ab', 'android', '5e000000-0000-4000-8000-0000000000c1'),
  ('de000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000c1', 'ntf-token-a2-0123456789ab', 'android', '5e000000-0000-4000-8000-0000000000c1'),
  ('de000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000c3', 'ntf-token-b1-0123456789ab', 'ios', '5e000000-0000-4000-8000-0000000000c3');

set local role service_role;
select is((select count(*)::int from public.deliverable_device_tokens('00000000-0000-4000-8000-0000000000c1')), 2,
  'the account has two deliverable tokens');
select is(public.invalidate_device_tokens(array['de000000-0000-4000-8000-0000000000d1']::uuid[]), 1, 'marking one dead token reports one');
select is(public.invalidate_device_tokens(array['de000000-0000-4000-8000-0000000000d1']::uuid[]), 0, 'marking it again changes nothing');
select is(public.invalidate_device_tokens(array[]::uuid[]), 0, 'an empty list changes nothing');
select is((select count(*)::int from public.deliverable_device_tokens('00000000-0000-4000-8000-0000000000c1')), 1,
  'a dead token is no longer deliverable');
select is((select count(*)::int from public.deliverable_device_tokens('00000000-0000-4000-8000-0000000000c3')), 1,
  'other accounts'' tokens are untouched');
select throws_ok($$ select public.invalidate_device_tokens(null) $$, 'NZ412', null, 'a missing list is refused');
select throws_ok($$ select public.invalidate_device_tokens(array(select gen_random_uuid() from generate_series(1, 1001))) $$,
  'NZ412', null, 'a list over 1,000 ids is refused');
reset role;
select is((select invalidated_at is not null from public.device_tokens where id = 'de000000-0000-4000-8000-0000000000d1'), true,
  'the token row records when it was marked dead');

-- ---------------------------------------------------------------------------
-- Cascades
-- ---------------------------------------------------------------------------

select lives_ok($$ delete from public.order_status_history where order_id = '0d000000-0000-4000-8000-0000000000a3' $$,
  'removing a status history row is allowed');
select is((select count(*)::int from public.notification_outbox where order_id = '0d000000-0000-4000-8000-0000000000a3'), 0,
  'and removes its notification with it');

select * from finish();
rollback;
