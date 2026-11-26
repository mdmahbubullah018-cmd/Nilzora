-- notification_allowed(): the one question the sender may ask about an account
--
-- The notification worker runs as the service role and must know whether the account still
-- wants order updates. The table itself stays closed to that role - opening it would expose
-- every account's choices to whoever holds the server key - so the answer comes from a
-- security-definer function that returns a single boolean and nothing else. This pins:
-- the shape of the function, who may execute it (service role only), the all-on default for
-- an account with no row, an explicit "no" when the category is off, and that a bad argument
-- raises instead of answering "yes".
--
-- Writes, but only inside a transaction that is rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

-- Fixtures: two customers. Inserting into auth.users fires the signup trigger, exactly as a
-- real signup does.
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) values
  ('c3000000-0000-4000-8000-00000000000c', 'allowed-c@example.com', now(), '{"full_name": "Allowed C"}', '{}'),
  ('d4000000-0000-4000-8000-00000000000d', 'allowed-d@example.com', now(), '{"full_name": "Allowed D"}', '{}');

-- ---------------------------------------------------------------------------
-- Shape: one boolean, security definer, pinned search_path
-- ---------------------------------------------------------------------------

select has_function('public', 'notification_allowed', array['uuid'], 'the sender has a function to ask');

select is(
  pg_get_function_result('public.notification_allowed(uuid)'::regprocedure),
  'boolean',
  'it answers a single boolean and never a row'
);

select ok((
  select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'notification_allowed'
), 'it is security definer, so the sender reads the table without holding rights on it');

select ok((
  select exists (
    select 1 from unnest(p.proconfig) c where c in ('search_path=', 'search_path=""')
  )
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'notification_allowed'
), 'it pins an empty search_path');

select ok((
  select pg_get_userbyid(p.proowner) = 'postgres'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'notification_allowed'
), 'it runs as a privileged owner, not as the caller');

-- ---------------------------------------------------------------------------
-- Who may ask
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('service_role', 'public.notification_allowed(uuid)', 'execute'),
  'the backend key may ask'
);

select ok(
  not has_function_privilege('anon', 'public.notification_allowed(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.notification_allowed(uuid)', 'execute'),
  'a visitor and a customer may not ask about an account'
);

select ok(
  not has_table_privilege('service_role', 'public.notification_preferences', 'select'),
  'the service role still cannot read the table itself: only the answer is reachable'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.notification_preferences'::regclass)
  and (select count(*)::int from pg_policy where polrelid = 'public.notification_preferences'::regclass) = 0,
  'the table keeps its deny-by-default policy state'
);

-- ---------------------------------------------------------------------------
-- What it answers
-- ---------------------------------------------------------------------------

set local role service_role;

select is(
  public.notification_allowed('c3000000-0000-4000-8000-00000000000c'),
  true,
  'an account that never opened Settings is told about orders'
);

select is(
  public.notification_allowed('e5000000-0000-4000-8000-00000000000e'),
  true,
  'an unknown account gets the same all-on default rather than an error'
);

-- The customer switches order updates off through the function the app uses.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "c3000000-0000-4000-8000-00000000000c", "role": "authenticated"}';
select public.save_my_notification_preferences('{"orderUpdates": false}');
reset role;

set local role service_role;
select is(
  public.notification_allowed('c3000000-0000-4000-8000-00000000000c'),
  false,
  'a category switched off is answered "no"'
);

select is(
  public.notification_allowed('d4000000-0000-4000-8000-00000000000d'),
  true,
  'one account switching off does not silence another'
);

-- Other categories never leak into this answer: turning returns off leaves it "yes".
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "d4000000-0000-4000-8000-00000000000d", "role": "authenticated"}';
select public.save_my_notification_preferences('{"returnUpdates": false, "promotions": false}');
reset role;

set local role service_role;
select is(
  public.notification_allowed('d4000000-0000-4000-8000-00000000000d'),
  true,
  'only the order-update choice decides the answer'
);

select throws_ok(
  $$ select public.notification_allowed(null) $$,
  'NZ412', null, 'a missing account is refused rather than answered "yes"'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "c3000000-0000-4000-8000-00000000000c", "role": "authenticated"}';

select throws_ok(
  $$ select public.notification_allowed('d4000000-0000-4000-8000-00000000000d') $$,
  '42501', null, 'a signed-in customer cannot reach the sender''s question at all'
);

select * from finish();
rollback;
