-- Durable domain events (transactional outbox) for realtime delivery and future consumers.
--
-- Nilzora already writes each side effect into its own outbox inside the business transaction
-- (notification_outbox for push, email_outbox for email, customer_notifications and
-- staff_notifications for in-app). This adds the missing piece: one ordered, durable log of what
-- happened, written by triggers in the SAME transaction as the change, so
--   * nothing is announced for a change that did not commit (a rolled-back order writes no event),
--   * nothing is lost if the API stops after the commit (the row waits for the worker),
--   * a client that was offline can ask "what happened after event N?" (per-account cursor), and
--   * every consumer can be made idempotent with processed_events (at-least-once delivery).
--
-- Events are derived from the tables that already carry the business rules, so no rule is
-- duplicated here:
--   order.placed                      orders insert
--   order.confirmed|processing|shipped|delivered|cancelled
--                                     order_status_history insert (the transition already validated)
--   payment.collected                 orders.payment_status -> collected
--   return.requested                  return_requests insert
--   staff_notification.created        staff_notifications insert (new orders, low stock, returns,
--                                     moderation, assignments: whatever the existing rules decide)
--   customer_notification.created     customer_notifications insert
--
-- Payloads are deliberately small and carry no address, phone, email or message text: they say
-- WHAT changed; a client reads details through the authorised REST endpoints.
-- Additive only: two new tables, new functions and new AFTER triggers.

create table public.domain_events (
  id uuid primary key default gen_random_uuid(),
  -- The order events happened in, across the whole store; clients resume after the last one seen.
  seq bigint generated always as identity unique,
  event_type text not null check (event_type ~ '^[a-z_]+\.[a-z_]+$'),
  event_version smallint not null default 1 check (event_version >= 1),
  aggregate_type text not null check (char_length(aggregate_type) between 1 and 40),
  aggregate_id text not null check (char_length(aggregate_id) between 1 and 80),
  -- Who may see it: one account, and/or every account holding one permission.
  recipient_user_id uuid references public.profiles (id) on delete cascade,
  -- No foreign key on purpose: these rows are written inside business transactions, and an
  -- event must never be able to make an order (or a notification) fail.
  audience_permission text check (char_length(audience_permission) <= 80),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) < 4096),
  occurred_at timestamptz not null default now(),
  -- Delivery bookkeeping for the outbox worker.
  published_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text check (char_length(last_error) <= 300),
  dead_lettered_at timestamptz,
  constraint domain_events_has_audience check (recipient_user_id is not null or audience_permission is not null)
);
create index domain_events_pending_idx on public.domain_events (next_attempt_at)
  where published_at is null and dead_lettered_at is null;
create index domain_events_recipient_idx on public.domain_events (recipient_user_id, seq)
  where recipient_user_id is not null;
create index domain_events_audience_idx on public.domain_events (audience_permission, seq)
  where audience_permission is not null;
create index domain_events_dead_idx on public.domain_events (dead_lettered_at) where dead_lettered_at is not null;

create table public.processed_events (
  consumer text not null check (consumer ~ '^[a-z_.-]{1,60}$'),
  event_id uuid not null references public.domain_events (id) on delete cascade,
  processed_at timestamptz not null default now(),
  primary key (consumer, event_id)
);

alter table public.domain_events enable row level security;
alter table public.processed_events enable row level security;
revoke all on table public.domain_events, public.processed_events from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Emission (called only by the triggers below, inside the business transaction)

create function private.emit_domain_event(
  p_type text,
  p_aggregate_type text,
  p_aggregate_id text,
  p_recipient uuid,
  p_audience text,
  p_payload jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.domain_events (event_type, aggregate_type, aggregate_id, recipient_user_id, audience_permission, payload)
  values (p_type, p_aggregate_type, p_aggregate_id, p_recipient, p_audience, coalesce(p_payload, '{}'::jsonb));
$$;

create function private.domain_event_order_placed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.emit_domain_event('order.placed', 'order', new.order_number, new.user_id, 'orders.read',
    jsonb_build_object('orderNumber', new.order_number, 'status', new.status, 'paymentStatus', new.payment_status,
                       'itemCount', new.item_count, 'totalMinor', new.total_minor));
  return null;
end;
$$;

create function private.domain_event_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  -- The first history row of a new order repeats order.placed.
  if new.to_status = 'pending' then return null; end if;
  select * into v_order from public.orders where id = new.order_id;
  if not found then return null; end if;
  perform private.emit_domain_event('order.' || new.to_status::text, 'order', v_order.order_number,
    v_order.user_id, 'orders.read',
    jsonb_build_object('orderNumber', v_order.order_number, 'status', new.to_status,
                       'previousStatus', new.from_status, 'paymentStatus', v_order.payment_status));
  return null;
end;
$$;

create function private.domain_event_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payment_status = 'collected' and old.payment_status is distinct from 'collected' then
    perform private.emit_domain_event('payment.collected', 'order', new.order_number, new.user_id, 'orders.read',
      jsonb_build_object('orderNumber', new.order_number, 'status', new.status, 'paymentStatus', new.payment_status));
  end if;
  return null;
end;
$$;

create function private.domain_event_return_requested()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.emit_domain_event('return.requested', 'return_request', new.id::text, new.user_id, 'orders.read',
    jsonb_build_object('returnId', new.id, 'status', new.status, 'itemCount', new.item_count));
  return null;
end;
$$;

create function private.domain_event_staff_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.emit_domain_event('staff_notification.created', 'staff_notification', new.id::text,
    new.recipient_id, new.audience_permission,
    jsonb_build_object('notificationId', new.id, 'kind', new.kind, 'title', left(new.title, 120),
                       'actionPath', new.action_path));
  return null;
end;
$$;

create function private.domain_event_customer_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.emit_domain_event('customer_notification.created', 'customer_notification', new.id::text,
    new.user_id, null,
    jsonb_build_object('notificationId', new.id, 'kind', new.kind, 'title', left(new.title, 120),
                       'entityType', new.entity_type, 'entityId', new.entity_id));
  return null;
end;
$$;

create trigger orders_domain_event_placed after insert on public.orders
  for each row execute function private.domain_event_order_placed();
create trigger order_status_history_domain_event after insert on public.order_status_history
  for each row execute function private.domain_event_order_status();
create trigger orders_domain_event_payment after update of payment_status on public.orders
  for each row execute function private.domain_event_payment();
create trigger return_requests_domain_event after insert on public.return_requests
  for each row execute function private.domain_event_return_requested();
create trigger staff_notifications_domain_event after insert on public.staff_notifications
  for each row execute function private.domain_event_staff_notification();
create trigger customer_notifications_domain_event after insert on public.customer_notifications
  for each row execute function private.domain_event_customer_notification();

-- ---------------------------------------------------------------------------------------------
-- The outbox worker (service role only)

/**
 * Leases up to p_limit due events. SKIP LOCKED lets several API instances share the work without
 * taking the same row; the lease (next_attempt_at moved forward) means a worker that dies
 * mid-batch only delays those events until the lease ends.
 */
create function public.claim_domain_events(p_limit integer, p_lease_seconds integer)
returns setof public.domain_events
language sql
security definer
set search_path = ''
as $$
  with due as (
    select id from public.domain_events
     where published_at is null and dead_lettered_at is null and next_attempt_at <= now()
     order by seq
     limit greatest(1, least(coalesce(p_limit, 50), 500))
     for update skip locked
  )
  update public.domain_events e
     set attempts = e.attempts + 1,
         next_attempt_at = now() + make_interval(secs => greatest(5, least(coalesce(p_lease_seconds, 30), 600)))
    from due where e.id = due.id
  returning e.*;
$$;

create function public.complete_domain_event(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.domain_events set published_at = now(), last_error = null where id = p_id and published_at is null;
$$;

/** A failed delivery: retried with exponential backoff (capped), dead-lettered after p_max_attempts. */
create function public.fail_domain_event(p_id uuid, p_error text, p_max_attempts integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
begin
  select attempts into v_attempts from public.domain_events where id = p_id for update;
  if not found then return false; end if;
  if v_attempts >= greatest(1, coalesce(p_max_attempts, 8)) then
    update public.domain_events
       set dead_lettered_at = now(), last_error = left(coalesce(p_error, 'failed'), 300)
     where id = p_id;
    return true;
  end if;
  update public.domain_events
     set next_attempt_at = now() + make_interval(secs => least(3600, (2 ^ least(v_attempts, 12))::integer * 5)),
         last_error = left(coalesce(p_error, 'failed'), 300)
   where id = p_id;
  return false;
end;
$$;

/** Records that a consumer handled an event; false when it already had (a duplicate delivery). */
create function public.record_processed_event(p_consumer text, p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.processed_events (consumer, event_id) values (p_consumer, p_event_id);
  return true;
exception when unique_violation then
  return false;
end;
$$;

/** The consumers that already handled an event, so a retry runs only the ones that did not. */
create function public.processed_consumers(p_event_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(consumer order by consumer), '{}') from public.processed_events where event_id = p_event_id;
$$;

/** Queue health for monitoring: counts and the age of the oldest undelivered event. */
create function public.domain_event_stats()
returns table (pending bigint, dead_lettered bigint, oldest_pending_seconds integer, published_last_hour bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.domain_events where published_at is null and dead_lettered_at is null),
    (select count(*) from public.domain_events where dead_lettered_at is not null),
    (select extract(epoch from now() - min(occurred_at))::integer from public.domain_events
      where published_at is null and dead_lettered_at is null),
    (select count(*) from public.domain_events where published_at > now() - interval '1 hour');
$$;

/** Retention: published events older than the cutoff are removed (consumers are done with them). */
create function public.prune_domain_events(p_older_than_days integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.domain_events
   where published_at is not null and occurred_at < now() - make_interval(days => greatest(7, coalesce(p_older_than_days, 30)));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Missed-event recovery for signed-in clients

/**
 * The caller's events after a cursor, oldest first: their own (recipient) plus those addressed to
 * a permission they hold (computed once per call). This is what a client calls after reconnecting,
 * so a dropped socket never loses an update. Undelivered events are included: the database, not
 * the socket, is the record.
 */
create function public.my_domain_events(p_after bigint, p_limit integer)
returns table (seq bigint, event_id uuid, event_type text, event_version smallint, aggregate_type text,
               aggregate_id text, payload jsonb, occurred_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_permissions text[];
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  v_permissions := array(select x.name from private.permissions_of(v_user) as x (name));
  return query
  select e.seq, e.id, e.event_type, e.event_version, e.aggregate_type, e.aggregate_id, e.payload, e.occurred_at
    from public.domain_events e
   where e.seq > coalesce(p_after, 0)
     and e.dead_lettered_at is null
     and (e.recipient_user_id = v_user or e.audience_permission = any (v_permissions))
   order by e.seq
   limit greatest(1, least(coalesce(p_limit, 100), 200));
end;
$$;

/** The newest event seq, so a fresh client can start from "now" instead of replaying history. */
create function public.domain_event_cursor()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(seq), 0) from public.domain_events;
$$;

revoke all on function private.emit_domain_event(text, text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.claim_domain_events(integer, integer) from public, anon, authenticated;
revoke all on function public.complete_domain_event(uuid) from public, anon, authenticated;
revoke all on function public.fail_domain_event(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.record_processed_event(text, uuid) from public, anon, authenticated;
revoke all on function public.domain_event_stats() from public, anon, authenticated;
revoke all on function public.prune_domain_events(integer) from public, anon, authenticated;
revoke all on function public.my_domain_events(bigint, integer) from public, anon;
revoke all on function public.domain_event_cursor() from public, anon;

grant execute on function public.claim_domain_events(integer, integer) to service_role;
grant execute on function public.complete_domain_event(uuid) to service_role;
grant execute on function public.fail_domain_event(uuid, text, integer) to service_role;
grant execute on function public.record_processed_event(text, uuid) to service_role;
revoke all on function public.processed_consumers(uuid) from public, anon, authenticated;
grant execute on function public.processed_consumers(uuid) to service_role;
grant execute on function public.domain_event_stats() to service_role;
grant execute on function public.prune_domain_events(integer) to service_role;
grant execute on function public.my_domain_events(bigint, integer) to authenticated;
grant execute on function public.domain_event_cursor() to authenticated, service_role;
