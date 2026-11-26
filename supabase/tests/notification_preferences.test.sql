-- Notification preferences: one row per account, written only by its owner, and the writer
-- that honours it.
--
-- The screen in the app and the PATCH route both go through these two functions, so this
-- pins the rules the API relies on: defaults when nothing was chosen, a partial save that
-- keeps the rest, an unknown field refused rather than stored, anonymous refused, and one
-- account's choice never reachable from another's session. It also proves the enforcement
-- point: a category switched off stops the notification being recorded, while the history
-- already kept stays readable.
--
-- Writes, but only inside a transaction that is rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(32);

-- Fixtures: two customers. Inserting into auth.users fires the signup trigger, exactly as a
-- real signup does.
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) values
  ('a1000000-0000-4000-8000-00000000000a', 'prefs-a@example.com', now(), '{"full_name": "Prefs A"}', '{}'),
  ('b2000000-0000-4000-8000-00000000000b', 'prefs-b@example.com', now(), '{"full_name": "Prefs B"}', '{}');

-- ---------------------------------------------------------------------------
-- Shape: one row per account
-- ---------------------------------------------------------------------------

select has_table('public', 'notification_preferences', 'the table exists');

select col_type_is('public', 'notification_preferences', 'user_id', 'uuid',
  'the row is keyed by the account');
select col_not_null('public', 'notification_preferences', 'in_app', 'the record switch is never null');
select col_default_is('public', 'notification_preferences', 'order_updates', 'true',
  'an order update is on until the account says otherwise');

select ok(exists (
  select 1 from pg_constraint
   where conrelid = 'public.notification_preferences'::regclass
     and contype = 'p'
), 'one row per account is enforced by the primary key');

select ok(exists (
  select 1 from pg_constraint
   where conrelid = 'public.notification_preferences'::regclass
     and conname = 'notification_preferences_user_id_fkey'
     and confdeltype = 'c'
), 'the row belongs to a real account and leaves with it');

-- ---------------------------------------------------------------------------
-- Closed to direct access, open only through the owner-scoped functions
-- ---------------------------------------------------------------------------

select ok((select relrowsecurity from pg_class where oid = 'public.notification_preferences'::regclass),
  'row level security is enabled');

select is((select count(*)::int from pg_policy
            where polrelid = 'public.notification_preferences'::regclass), 0,
  'no policy exists: the table is deny-by-default, so only the functions reach it');

select ok(
  not has_table_privilege('anon', 'public.notification_preferences', 'select')
  and not has_table_privilege('authenticated', 'public.notification_preferences', 'select')
  and not has_table_privilege('authenticated', 'public.notification_preferences', 'insert')
  and not has_table_privilege('authenticated', 'public.notification_preferences', 'update'),
  'end users hold no table privilege at all'
);

select ok(
  has_function_privilege('authenticated', 'public.my_notification_preferences()', 'execute')
  and has_function_privilege('authenticated', 'public.save_my_notification_preferences(jsonb)', 'execute'),
  'a signed-in customer may read and save their own choices'
);

select ok(
  not has_function_privilege('anon', 'public.my_notification_preferences()', 'execute')
  and not has_function_privilege('anon', 'public.save_my_notification_preferences(jsonb)', 'execute'),
  'an anonymous visitor may do neither'
);

select ok((
  select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_notification_preferences'
) and (
  select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_my_notification_preferences'
), 'both functions are security definer, so they answer for the caller without table rights');

select ok((
  select bool_and(exists (
    select 1 from unnest(p.proconfig) c where c in ('search_path=', 'search_path=""')
  ))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('my_notification_preferences', 'save_my_notification_preferences')
), 'both pin an empty search_path');

-- ---------------------------------------------------------------------------
-- Defaults, partial saves, and what a save refuses
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "a1000000-0000-4000-8000-00000000000a", "role": "authenticated"}';

select is(
  (select (order_updates, payment_updates, return_updates, refund_updates, promotions, in_app)
     from public.my_notification_preferences()),
  (true, true, true, true, true, true),
  'an account that never opened Settings is told everything'
);

select is(
  (select (order_updates, promotions, in_app) from public.save_my_notification_preferences('{"promotions": false}')),
  (true, false, true),
  'saving one switch keeps every other choice as it was'
);

select is(
  (select (order_updates, promotions) from public.my_notification_preferences()),
  (true, false),
  'the saved value is the value read back'
);

select is(
  (select (promotions, refund_updates) from public.save_my_notification_preferences('{"refundUpdates": false}')),
  (false, false),
  'a second partial save layers on the first instead of resetting it'
);

select throws_ok(
  $$ select public.save_my_notification_preferences('{"marketing": true}') $$,
  'NZ412', null, 'an unknown switch is refused rather than stored'
);

select throws_ok(
  $$ select public.save_my_notification_preferences('{"orderUpdates": "yes"}') $$,
  'NZ412', null, 'a preference must be true or false'
);

select throws_ok(
  $$ select public.save_my_notification_preferences('[]') $$,
  'NZ412', null, 'the body must be an object'
);

-- ---------------------------------------------------------------------------
-- Enforcement: a switched-off category is not recorded, and history stays readable
-- ---------------------------------------------------------------------------

reset role;

-- Written here as the service role, exactly as the owner's own save would write it. Every
-- switch is set explicitly, so the section does not depend on what an earlier save left.
insert into public.notification_preferences (user_id, in_app, promotions)
values ('a1000000-0000-4000-8000-00000000000a', false, false)
on conflict (user_id) do update set
  in_app = false, promotions = false,
  order_updates = true, payment_updates = true, return_updates = true, refund_updates = true;

select private.notify_customer(
  'a1000000-0000-4000-8000-00000000000a', 'order_update', 'Order confirmed',
  'Order NZ100001 has been confirmed.', 'order', 'NZ100001', '/account/orders/NZ100001',
  'prefs-test-order-1'
);

select is(
  (select count(*)::int from public.customer_notifications
    where user_id = 'a1000000-0000-4000-8000-00000000000a' and dedupe_key = 'prefs-test-order-1'),
  0,
  'the account switched the record off, so nothing was recorded'
);

update public.notification_preferences set in_app = true, order_updates = false
 where user_id = 'a1000000-0000-4000-8000-00000000000a';

select private.notify_customer(
  'a1000000-0000-4000-8000-00000000000a', 'order_update', 'Order shipped',
  'Order NZ100001 has been shipped.', 'order', 'NZ100001', '/account/orders/NZ100001',
  'prefs-test-order-2'
);

select is(
  (select count(*)::int from public.customer_notifications
    where user_id = 'a1000000-0000-4000-8000-00000000000a' and dedupe_key = 'prefs-test-order-2'),
  0,
  'order updates switched off stops that category even with the record on'
);

select private.notify_customer(
  'a1000000-0000-4000-8000-00000000000a', 'refund_update', 'Refund paid',
  'Your refund has been paid.', 'refund', 'NZ100001', '/account/returns',
  'prefs-test-refund-1'
);

select is(
  (select count(*)::int from public.customer_notifications
    where user_id = 'a1000000-0000-4000-8000-00000000000a' and dedupe_key = 'prefs-test-refund-1'),
  1,
  'a category the account left on is recorded as before'
);

select private.notify_customer(
  'b2000000-0000-4000-8000-00000000000b', 'order_update', 'Order confirmed',
  'Order NZ100002 has been confirmed.', 'order', 'NZ100002', '/account/orders/NZ100002',
  'prefs-test-order-3'
);

select is(
  (select count(*)::int from public.customer_notifications
    where user_id = 'b2000000-0000-4000-8000-00000000000b' and dedupe_key = 'prefs-test-order-3'),
  1,
  'another account with no row at all is treated as all-on, exactly as before'
);

-- An account's own history is still readable after switching a category off.
set local role authenticated;
set local request.jwt.claims to '{"sub": "a1000000-0000-4000-8000-00000000000a", "role": "authenticated"}';

select is(
  (select count(*)::int from public.my_customer_notifications(null::text, 20, 0)),
  1,
  'the history already kept stays readable while a category is switched off'
);

-- ---------------------------------------------------------------------------
-- One account cannot reach another's choices
-- ---------------------------------------------------------------------------

select is(
  (select (promotions, refund_updates) from public.my_notification_preferences()),
  (false, true),
  'a signed-in customer is answered with their own row only'
);

select lives_ok(
  $$ select public.save_my_notification_preferences('{"refundUpdates": false}') $$,
  'a save succeeds without naming any account'
);

select is(
  (select refund_updates from public.my_notification_preferences()),
  false,
  'the save landed on the caller''s own row'
);

set local request.jwt.claims to '{"sub": "b2000000-0000-4000-8000-00000000000b", "role": "authenticated"}';

select is(
  (select (promotions, refund_updates) from public.my_notification_preferences()),
  (true, true),
  'the other account still reads its own defaults, never the first account''s choices'
);

reset role;

select is(
  (select count(*)::int from public.notification_preferences
    where user_id = 'b2000000-0000-4000-8000-00000000000b'),
  0,
  'and no row was written for it'
);

set local role anon;
set local request.jwt.claims to '{"role": "anon"}';

select throws_ok(
  $$ select public.my_notification_preferences() $$,
  '42501', null, 'an anonymous visitor cannot read preferences'
);

select throws_ok(
  $$ select public.save_my_notification_preferences('{"inApp": true}') $$,
  '42501', null, 'an anonymous visitor cannot save preferences'
);

select * from finish();
rollback;