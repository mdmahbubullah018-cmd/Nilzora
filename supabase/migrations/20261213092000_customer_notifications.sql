-- ---------------------------------------------------------------------------
-- Customer notifications: the account's own history of what happened to its orders
--
-- Until now a customer was told about an order only by a push that may never arrive (no
-- device, permission refused, a token that expired). Nothing was kept, so there was no way
-- to read back what had happened. This adds exactly that: one row per business fact, owned
-- by one account, written by the same events that already queue the push.
--
-- Design, matching the staff inbox that already exists:
--   * the row is written by a trigger on the authoritative business event, never by a UI;
--   * `dedupe_key` is unique, so a replayed or retried event cannot notify twice;
--   * row level security is on with **no policy**, and no end-user role holds a table
--     privilege: the only way in is the four security-definer functions below, which answer
--     `auth.uid()` — a client can never name another account's id;
--   * `mark_my_notification_read` refuses a row the caller does not own (NZ496, the same
--     refusal the staff inbox uses), so ownership is enforced in SQL, not in the app.
--
-- Event coverage is deliberately limited to what exists today: order status changes (the
-- same five statuses the push worker sends), a COD payment recorded, a return decision, and
-- a refund decision. No new business event is invented, and nothing internal (chat with
-- staff aside from the existing support thread, staff notes, other customers) is exposed.
--
-- Additive only: one enum, one table, four functions and their grants. No existing table,
-- column, policy or row is touched.
--
-- Rollback (drops only what this migration created)
--   drop function public.mark_all_customer_notifications_read();
--   drop function public.mark_customer_notification_read(uuid);
--   drop function public.customer_unread_notification_count();
--   drop function public.my_customer_notifications(text, integer, integer);
--   drop trigger  order_status_history_notify_customer on public.order_status_history;
--   drop trigger  order_payment_notify_customer        on public.orders;
--   drop trigger  return_requests_notify_customer      on public.return_requests;
--   drop trigger  refunds_notify_customer              on public.refunds;
--   drop function private.notify_customer(uuid, public.customer_notification_kind, text, text, text, text, text);
--   drop function private.notify_order_status_customer();
--   drop function private.notify_order_payment_customer();
--   drop function private.notify_return_customer();
--   drop function private.notify_refund_customer();
--   drop table public.customer_notifications;
--   drop type public.customer_notification_kind;
-- ---------------------------------------------------------------------------

create type public.customer_notification_kind as enum (
  'order_update',
  'payment_update',
  'return_update',
  'refund_update'
);

create table public.customer_notifications (
  id uuid primary key default gen_random_uuid(),
  /** The account that owns the row. Never a value taken from a request. */
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.customer_notification_kind not null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text check (body is null or char_length(body) <= 500),
  entity_type text not null check (entity_type in ('order', 'return', 'refund')),
  entity_id text not null check (char_length(entity_id) between 1 and 80),
  /** A path inside the storefront account area; the API checks it again before rendering. */
  action_path text check (
    action_path is null
    or action_path ~ '^/account/[A-Za-z0-9/_?=&%.-]{0,159}$'
  ),
  /** Stable per business fact, so a retried trigger cannot write a second notification. */
  dedupe_key text not null unique check (char_length(dedupe_key) between 1 and 160),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.customer_notifications is
  'One account''s own notification history. Read and written only through the definer functions below; no end-user role holds a table privilege.';

-- Newest first for one account, with the id as the tie-breaker so paging is total.
create index customer_notifications_inbox_idx
  on public.customer_notifications (user_id, created_at desc, id);
create index customer_notifications_unread_idx
  on public.customer_notifications (user_id, created_at desc)
  where read_at is null;

alter table public.customer_notifications enable row level security;

/** One notification for one account, written by the triggers below. Duplicates are dropped. */
create function private.notify_customer(
  p_user uuid,
  p_kind public.customer_notification_kind,
  p_title text,
  p_body text,
  p_entity_type text,
  p_entity_id text,
  p_action_path text,
  p_dedupe_key text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_user is null then
    return;
  end if;
  insert into public.customer_notifications (
    user_id, kind, title, body, entity_type, entity_id, action_path, dedupe_key
  )
  values (
    p_user, p_kind, left(p_title, 120), left(p_body, 500),
    p_entity_type, p_entity_id, p_action_path, left(p_dedupe_key, 160)
  )
  on conflict (dedupe_key) do nothing;
end;
$$;

revoke execute on function private.notify_customer(
  uuid, public.customer_notification_kind, text, text, text, text, text, text
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The events
-- ---------------------------------------------------------------------------

/** An order reached a status the customer cares about. Mirrors the push worker's set. */
create function private.notify_order_status_customer()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_title text;
  v_body text;
begin
  if new.to_status not in ('confirmed', 'processing', 'shipped', 'delivered', 'cancelled') then
    return new;
  end if;

  select * into v_order from public.orders o where o.id = new.order_id;
  if v_order.id is null then
    return new;
  end if;

  v_title := case new.to_status
    when 'confirmed' then 'Order confirmed'
    when 'processing' then 'Order being prepared'
    when 'shipped' then 'Order on its way'
    when 'delivered' then 'Order delivered'
    else 'Order cancelled'
  end;
  v_body := case new.to_status
    when 'confirmed' then 'Order ' || v_order.order_number || ' has been confirmed.'
    when 'processing' then 'Order ' || v_order.order_number || ' is being prepared.'
    when 'shipped' then 'Order ' || v_order.order_number || ' has been shipped.'
    when 'delivered' then 'Order ' || v_order.order_number || ' has been delivered.'
    else 'Order ' || v_order.order_number || ' has been cancelled.'
  end;

  perform private.notify_customer(
    v_order.user_id,
    'order_update',
    v_title,
    v_body,
    'order',
    v_order.id::text,
    '/account/orders/' || v_order.order_number,
    -- One per status change, so re-running the history write adds nothing.
    'order_status:' || new.id::text
  );
  return new;
end;
$$;

create trigger order_status_history_notify_customer
after insert on public.order_status_history
for each row execute function private.notify_order_status_customer();

/** Cash was recorded as collected for an order. */
create function private.notify_order_payment_customer()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.payment_status <> 'collected' or old.payment_status = 'collected' then
    return new;
  end if;
  perform private.notify_customer(
    new.user_id,
    'payment_update',
    'Payment recorded',
    'We received ' || to_char(new.total_minor / 100.0, 'FM9999999990.00')
      || ' BDT for order ' || new.order_number || '.',
    'order',
    new.id::text,
    '/account/orders/' || new.order_number,
    'order_payment:' || new.id::text || ':collected'
  );
  return new;
end;
$$;

create trigger order_payment_notify_customer
after update of payment_status on public.orders
for each row execute function private.notify_order_payment_customer();

/** A return request was decided. Its own request is not announced: the customer just made it. */
create function private.notify_return_customer()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_title text;
begin
  if new.status = 'requested' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status = old.status then
    return new;
  end if;

  v_title := case new.status
    when 'approved' then 'Return approved'
    when 'rejected' then 'Return declined'
    when 'received' then 'Return received'
    when 'completed' then 'Return completed'
    else 'Return updated'
  end;

  perform private.notify_customer(
    new.user_id,
    'return_update',
    v_title,
    'Your return request has been updated.',
    'return',
    new.id::text,
    '/account/returns/' || new.id::text,
    'return_status:' || new.id::text || ':' || new.status::text
  );
  return new;
end;
$$;

create trigger return_requests_notify_customer
after insert or update of status on public.return_requests
for each row execute function private.notify_return_customer();

/** A refund moved to a state the customer is told about. */
create function private.notify_refund_customer()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_title text;
  v_body text;
begin
  if new.status not in ('approved', 'completed', 'rejected') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status = old.status then
    return new;
  end if;

  select * into v_order from public.orders o where o.id = new.order_id;
  if v_order.id is null then
    return new;
  end if;

  v_title := case new.status
    when 'approved' then 'Refund approved'
    when 'completed' then 'Refund paid'
    else 'Refund declined'
  end;
  v_body := 'Order ' || v_order.order_number || ' — '
    || to_char(new.amount_minor / 100.0, 'FM9999999990.00') || ' BDT.';

  perform private.notify_customer(
    v_order.user_id,
    'refund_update',
    v_title,
    v_body,
    'refund',
    new.id::text,
    '/account/orders/' || v_order.order_number,
    'refund_status:' || new.id::text || ':' || new.status::text
  );
  return new;
end;
$$;

create trigger refunds_notify_customer
after insert or update of status on public.refunds
for each row execute function private.notify_refund_customer();

-- ---------------------------------------------------------------------------
-- The account's own reads
-- ---------------------------------------------------------------------------

/** One page of the caller's notifications, newest first, optionally of one kind. */
create function public.my_customer_notifications(
  p_kind text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  kind public.customer_notification_kind,
  title text,
  body text,
  entity_type text,
  entity_id text,
  action_path text,
  read_at timestamptz,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_kind public.customer_notification_kind;
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_kind, '')), '') is not null then
    if p_kind not in (select unnest(enum_range(null::public.customer_notification_kind))::text) then
      raise exception 'unsupported kind' using errcode = 'NZ412';
    end if;
    v_kind := p_kind::public.customer_notification_kind;
  end if;

  return query
  select n.id, n.kind, n.title, n.body, n.entity_type, n.entity_id, n.action_path,
         n.read_at, n.created_at, count(*) over () as total_count
  from public.customer_notifications n
  where n.user_id = v_user
    and (v_kind is null or n.kind = v_kind)
  order by n.created_at desc, n.id
  limit greatest(1, least(coalesce(p_limit, 20), 50))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

create function public.customer_unread_notification_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.customer_notifications n
  where n.user_id = (select auth.uid()) and n.read_at is null;
$$;

/** Marks one of the caller's own notifications read; anything else is refused. */
create function public.mark_customer_notification_read(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;

  update public.customer_notifications n
  set read_at = now()
  where n.id = p_id and n.user_id = v_user and n.read_at is null;

  if not found and not exists (
    select 1 from public.customer_notifications n
    where n.id = p_id and n.user_id = v_user
  ) then
    raise exception 'that notification is not yours' using errcode = 'NZ496';
  end if;
end;
$$;

/** Marks every unread notification of the caller read; answers how many changed. */
create function public.mark_all_customer_notifications_read()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_count integer;
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;

  update public.customer_notifications n
  set read_at = now()
  where n.user_id = v_user and n.read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Signed-in accounts only; anon and PUBLIC are revoked explicitly because functions are
-- executable by PUBLIC by default. The table itself stays closed to every end-user role.
revoke execute on function public.my_customer_notifications(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.customer_unread_notification_count() from public, anon, authenticated;
revoke execute on function public.mark_customer_notification_read(uuid) from public, anon, authenticated;
revoke execute on function public.mark_all_customer_notifications_read() from public, anon, authenticated;

grant execute on function public.my_customer_notifications(text, integer, integer) to authenticated;
grant execute on function public.customer_unread_notification_count() to authenticated;
grant execute on function public.mark_customer_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_customer_notifications_read() to authenticated;
