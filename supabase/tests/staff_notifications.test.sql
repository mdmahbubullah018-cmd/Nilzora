-- The staff inbox contract, as the database actually enforces it.
--
-- The API mirrors `public.staff_notification_kind` and the `entity_type` check in
-- packages/contracts/src/staff-notifications.ts, and validates every row it returns. A
-- value added by a migration but missing from the contract makes the whole inbox answer
-- 500, so the enum's contents are pinned here: when a migration adds a kind, this test
-- fails until the contract is extended with it.
--
-- Reads only. Runs inside a transaction that is rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

-- ---------------------------------------------------------------------------
-- The values the API must know about
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(k::text order by k::text)
     from unnest(enum_range(null::public.staff_notification_kind)) as k),
  array['chat_escalation', 'chat_message', 'moderation_pending', 'order_new',
        'refund_action', 'return_new', 'stock_low'],
  'the kind enum carries exactly the values STAFF_NOTIFICATION_KINDS mirrors'
);

select ok(
  (select pg_get_constraintdef(oid)
     from pg_constraint
    where conrelid = 'public.staff_notifications'::regclass
      and conname = 'staff_notifications_entity_type_check') like '%conversation%',
  'entity_type allows a conversation, which the contract also accepts'
);

-- ---------------------------------------------------------------------------
-- Reachable only through the inbox functions
-- ---------------------------------------------------------------------------

select ok((select relrowsecurity from pg_class where oid = 'public.staff_notifications'::regclass),
  'row level security is enabled on the table');

select is((select count(*)::int from pg_policy where polrelid = 'public.staff_notifications'::regclass), 0,
  'no policy exists: the table is deny-by-default for every role, as designed');

select ok(
  not has_table_privilege('anon', 'public.staff_notifications', 'select')
  and not has_table_privilege('anon', 'public.staff_notifications', 'insert')
  and not has_table_privilege('anon', 'public.staff_notifications', 'update')
  and not has_table_privilege('anon', 'public.staff_notifications', 'delete')
  and not has_table_privilege('authenticated', 'public.staff_notifications', 'select')
  and not has_table_privilege('authenticated', 'public.staff_notifications', 'insert')
  and not has_table_privilege('authenticated', 'public.staff_notifications', 'update')
  and not has_table_privilege('authenticated', 'public.staff_notifications', 'delete'),
  'end users hold no row-level privilege on the table itself'
);

select ok((
  select bool_and(p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=""'])
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('my_staff_notifications', 'my_unread_notification_count',
                       'mark_staff_notification_read', 'mark_all_staff_notifications_read')
), 'every inbox function is security definer with a pinned search_path');

-- ---------------------------------------------------------------------------
-- One row per business event, and exactly one audience
-- ---------------------------------------------------------------------------

select ok(exists (
  select 1 from pg_constraint
   where conrelid = 'public.staff_notifications'::regclass
     and conname = 'staff_notifications_dedupe_key_key'
     and contype = 'u'
), 'a unique dedupe key makes a replayed business event a no-op');

select ok(exists (
  select 1 from pg_constraint
   where conrelid = 'public.staff_notifications'::regclass
     and conname = 'staff_notifications_one_audience'
     and contype = 'c'
), 'a notification is addressed either to a person or to a permission, never both or neither');

select ok(exists (
  select 1 from pg_constraint
   where conrelid = 'public.staff_notifications'::regclass
     and conname = 'staff_notifications_recipient_id_fkey'
     and contype = 'f'
     and confdeltype = 'c'
), 'a named recipient is a real profile, and its notifications go with it');

select * from finish();
rollback;
