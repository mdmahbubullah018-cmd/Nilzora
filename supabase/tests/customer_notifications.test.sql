-- The customer notification table, as the API's contract mirrors it.
--
-- packages/contracts/src/customer-notifications.ts validates every row of
-- `GET /me/notifications`; a value the database can store but the contract does not know
-- would make the whole page unreadable. This pins the enum and the entity types to the
-- contract's lists, and checks the ownership rules the API relies on.
--
-- Reads only. Runs inside a transaction that is rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

-- ---------------------------------------------------------------------------
-- The values the contract must know about
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(k::text order by k::text)
     from unnest(enum_range(null::public.customer_notification_kind)) as k),
  array['order_update', 'payment_update', 'refund_update', 'return_update', 'shipment_update'],
  'the kind enum carries exactly the values CUSTOMER_NOTIFICATION_KINDS mirrors'
);

select ok(
  (select pg_get_constraintdef(oid)
     from pg_constraint
    where conrelid = 'public.customer_notifications'::regclass
      and conname = 'customer_notifications_entity_type_check')
  like '%order%return%refund%',
  'entity_type allows the three entity kinds the contract accepts'
);

select ok(
  (select pg_get_constraintdef(oid)
     from pg_constraint
    where conrelid = 'public.customer_notifications'::regclass
      and conname = 'customer_notifications_action_path_check')
  like '%/account/%',
  'a deep link is constrained to the storefront account area'
);

select ok(exists (
  select 1 from pg_constraint
   where conrelid = 'public.customer_notifications'::regclass
     and conname = 'customer_notifications_dedupe_key_key'
     and contype = 'u'
), 'a unique dedupe key stops a replayed business event notifying twice');

select ok(exists (
  select 1 from pg_constraint
   where conrelid = 'public.customer_notifications'::regclass
     and conname = 'customer_notifications_user_id_fkey'
     and contype = 'f'
     and confdeltype = 'c'
), 'a notification belongs to a real account and leaves with it');

-- ---------------------------------------------------------------------------
-- Closed to direct access, open only through the owner's functions
-- ---------------------------------------------------------------------------

select ok((select relrowsecurity from pg_class where oid = 'public.customer_notifications'::regclass),
  'row level security is enabled');

select is((select count(*)::int from pg_policy where polrelid = 'public.customer_notifications'::regclass), 0,
  'no policy exists: the table is deny-by-default for every role, as designed');

select ok(
  not has_table_privilege('anon', 'public.customer_notifications', 'select')
  and not has_table_privilege('authenticated', 'public.customer_notifications', 'select')
  and not has_table_privilege('authenticated', 'public.customer_notifications', 'insert')
  and not has_table_privilege('authenticated', 'public.customer_notifications', 'update')
  and not has_table_privilege('authenticated', 'public.customer_notifications', 'delete')
  and has_function_privilege('authenticated', 'public.my_customer_notifications(text, integer, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.mark_customer_notification_read(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.my_customer_notifications(text, integer, integer)', 'execute'),
  'end users hold no table privilege, only the owner-scoped functions, and anon holds none'
);

select * from finish();
rollback;
