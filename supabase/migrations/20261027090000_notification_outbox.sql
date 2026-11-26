-- Order-update push notifications: a transactional outbox.
--
-- A status change writes an order_status_history row; an AFTER INSERT trigger queues one
-- outbox row for the order's customer in the same transaction. Nothing is sent from the
-- database: the API's notification worker claims due rows, sends them through FCM, and
-- reports the outcome. A rolled-back status change therefore never notifies anyone, and a
-- failed or slow push never affects an order.
--
-- The table and its functions are closed to end users; only the service role (the worker)
-- reaches them. Tokens are read through deliverable_device_tokens, never from device_tokens.

create type public.notification_status as enum ('pending', 'sending', 'sent', 'failed', 'skipped');

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  order_number text not null,
  to_status public.order_status not null,
  -- One notification per status change: enqueueing is idempotent.
  history_id bigint not null unique references public.order_status_history (id) on delete cascade,
  status public.notification_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text check (last_error is null or last_error ~ '^[a-z0-9_]{1,64}$'),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

comment on table public.notification_outbox is 'Push notifications waiting to be sent. Filled by a trigger on order_status_history; claimed and finished only by the service role (claim_notifications / finish_notification).';
comment on column public.notification_outbox.last_error is 'A short machine code for the last failure; never a token, message or personal data.';
comment on column public.notification_outbox.locked_until is 'While status = sending: when the worker''s claim expires and another worker may take the row.';

create index notification_outbox_due_idx on public.notification_outbox (next_attempt_at)
  where status in ('pending', 'sending');
create index notification_outbox_user_idx on public.notification_outbox (user_id);
create index notification_outbox_order_idx on public.notification_outbox (order_id);

alter table public.notification_outbox enable row level security;

-- ---------------------------------------------------------------------------
-- Enqueue: customer-facing status changes made by staff or the system
-- ---------------------------------------------------------------------------

create function private.enqueue_order_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_number text;
begin
  -- The customer's own actions (placing, cancelling) need no notification.
  if new.actor_kind = 'customer'
     or new.to_status not in ('confirmed', 'processing', 'shipped', 'delivered', 'cancelled') then
    return null;
  end if;

  select o.user_id, o.order_number into v_user, v_number
  from public.orders o
  where o.id = new.order_id;
  if not found then
    return null;
  end if;

  insert into public.notification_outbox (user_id, order_id, order_number, to_status, history_id)
  values (v_user, new.order_id, v_number, new.to_status, new.id)
  on conflict (history_id) do nothing;
  return null;
end;
$$;

create trigger order_status_history_enqueue_notification
  after insert on public.order_status_history
  for each row execute function private.enqueue_order_notification();

-- ---------------------------------------------------------------------------
-- Worker interface (service role only)
-- ---------------------------------------------------------------------------

/**
 * Takes up to p_limit due notifications for the caller: pending rows whose time has come,
 * and rows another worker claimed but never finished once their lease ran out. Each taken
 * row counts an attempt and is leased for p_lease_seconds. Rows of accounts that are not
 * active are marked skipped instead of being returned. SKIP LOCKED lets several workers
 * poll at once without taking the same row.
 */
create function public.claim_notifications(p_limit integer default 20, p_lease_seconds integer default 60)
returns table (id uuid, user_id uuid, order_number text, to_status public.order_status, attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit not between 1 and 100
     or p_lease_seconds is null or p_lease_seconds not between 5 and 3600 then
    raise exception 'limit must be 1-100 and lease 5-3600 seconds' using errcode = 'NZ412';
  end if;

  return query
  with due as (
    select o.id, o.user_id
    from public.notification_outbox o
    where o.next_attempt_at <= now()
      and (o.status = 'pending' or (o.status = 'sending' and o.locked_until <= now()))
    order by o.next_attempt_at, o.created_at, o.id
    limit p_limit
    for update of o skip locked
  ),
  claimed as (
    update public.notification_outbox o
    set status = case when p.status = 'active' then 'sending'::public.notification_status
                      else 'skipped'::public.notification_status end,
        locked_until = case when p.status = 'active' then now() + make_interval(secs => p_lease_seconds) end,
        attempts = o.attempts + case when p.status = 'active' then 1 else 0 end,
        last_error = case when p.status = 'active' then o.last_error else 'account_inactive' end
    from due
    join public.profiles p on p.id = due.user_id
    where o.id = due.id
    returning o.id, o.user_id, o.order_number, o.to_status, o.attempts, o.status
  )
  select c.id, c.user_id, c.order_number, c.to_status, c.attempts
  from claimed c
  where c.status = 'sending'
  order by c.id;
end;
$$;

/**
 * Records what happened to a claimed notification. p_outcome is 'sent', 'retry' (try again
 * after p_retry_seconds, giving up as failed once 5 attempts are used), 'failed' (never
 * retry) or 'skipped' (nothing to deliver to, such as an account with no device). Answers the resulting status, or null when the row is not in the sending state
 * (finished already, or its lease was lost): the worker then does nothing more.
 * p_error is a short machine code; anything else is stored as 'error'.
 */
create function public.finish_notification(
  p_id uuid,
  p_outcome text,
  p_retry_seconds integer default 60,
  p_error text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.notification_outbox%rowtype;
  v_error text := case when p_error ~ '^[a-z0-9_]{1,64}$' then p_error when p_error is null then null else 'error' end;
  v_status public.notification_status;
begin
  if p_outcome is null or p_outcome not in ('sent', 'retry', 'failed', 'skipped') then
    raise exception 'outcome must be sent, retry, failed or skipped' using errcode = 'NZ412';
  end if;

  select * into v_row from public.notification_outbox where id = p_id for update;
  if not found or v_row.status <> 'sending' then
    return null;
  end if;

  if p_outcome = 'sent' then
    v_status := 'sent';
  elsif p_outcome = 'skipped' then
    v_status := 'skipped';
  elsif p_outcome = 'failed' or v_row.attempts >= 5 then
    v_status := 'failed';
    if p_outcome = 'retry' then
      v_error := coalesce(v_error, 'retries_exhausted');
    end if;
  else
    v_status := 'pending';
  end if;

  update public.notification_outbox
  set status = v_status,
      locked_until = null,
      sent_at = case when v_status = 'sent' then now() end,
      last_error = case when v_status = 'sent' then null else v_error end,
      next_attempt_at = case when v_status = 'pending'
        then now() + make_interval(secs => greatest(1, least(coalesce(p_retry_seconds, 60), 86400)))
        else next_attempt_at end
  where id = p_id;

  return v_status::text;
end;
$$;

/** Marks device tokens the push service reported as dead, so they are not tried again. Answers how many were marked. */
create function public.invalidate_device_tokens(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_ids is null or cardinality(p_ids) > 1000 then
    raise exception 'between 0 and 1000 device ids are required' using errcode = 'NZ412';
  end if;

  update public.device_tokens
  set invalidated_at = now()
  where id = any (p_ids) and invalidated_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: the service role only
-- ---------------------------------------------------------------------------

revoke all on table public.notification_outbox from public, anon, authenticated;
grant select, insert, update, delete on table public.notification_outbox to service_role;

revoke execute on function public.claim_notifications(integer, integer) from public, anon, authenticated;
revoke execute on function public.finish_notification(uuid, text, integer, text) from public, anon, authenticated;
revoke execute on function public.invalidate_device_tokens(uuid[]) from public, anon, authenticated;
grant execute on function public.claim_notifications(integer, integer) to service_role;
grant execute on function public.finish_notification(uuid, text, integer, text) to service_role;
grant execute on function public.invalidate_device_tokens(uuid[]) to service_role;
