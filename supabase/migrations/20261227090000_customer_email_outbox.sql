-- Customer order emails, and dismissable review prompts.
--
-- 1. email_outbox: one row per customer email an order event calls for, written by triggers
--    in the same transaction as the event itself, so an email can never be queued for a change
--    that rolled back, and never twice for the same event:
--
--      order placed              order_status_history row with from_status null
--                                  -> 'order_confirmation'   key order_placed:<order>
--      out for delivery          a forward, non-mock shipment moving to out_for_delivery
--                                  -> 'out_for_delivery'     key out_for_delivery:<shipment>
--      return request changed    return_status_history row
--                                  -> 'return_update'        key return_history:<row>
--      refund changed            refund_status_history row (approved/completed/rejected)
--                                  -> 'refund_update'        key refund_history:<row>
--
--    The dedupe key is unique, so a retried webhook, a repeated tracking event or a replayed
--    status write cannot queue a second email. There is no "arrived at the destination hub"
--    email: no courier status says that reliably (in_transit covers the whole journey), and
--    the brief forbids inventing it. Mock shipments (test bookings) never email a customer.
--
--    The API's email worker claims due rows (claim_customer_emails, with a lease and SKIP
--    LOCKED), builds each message from the order as the database holds it now, and records
--    the outcome (finish_customer_email): `sent` only once the mail server accepted it,
--    `pending` again with bounded backoff for a temporary failure, `failed` when out of
--    attempts, `skipped` when the email no longer applies (the order was cancelled, the
--    account is not active). The table holds no message text and no address.
--
-- 2. review_prompt_dismissals: a customer who closes the "review your delivered product"
--    prompt is not shown it again for that product. Their own rows only (RLS); the API
--    writes them through its user-scoped connection.
--
-- Additive only: no existing table, row or policy is changed.

-- ---------------------------------------------------------------------------
-- 1. Email outbox
-- ---------------------------------------------------------------------------

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique check (char_length(dedupe_key) between 3 and 120),
  kind text not null
    check (kind in ('order_confirmation', 'out_for_delivery', 'return_update', 'refund_update')),
  user_id uuid not null references public.profiles (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  order_number text not null,
  shipment_id uuid references public.shipments (id) on delete cascade,
  return_request_id uuid references public.return_requests (id) on delete cascade,
  refund_id uuid references public.refunds (id) on delete cascade,
  /** The status the event moved to (return or refund emails). */
  event_status text check (event_status is null or event_status ~ '^[a-z_]{1,32}$'),
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text check (last_error is null or last_error ~ '^[a-z0-9_]{1,64}$'),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  check (
    (kind = 'order_confirmation' and shipment_id is null and return_request_id is null and refund_id is null)
    or (kind = 'out_for_delivery' and shipment_id is not null)
    or (kind = 'return_update' and return_request_id is not null and event_status is not null)
    or (kind = 'refund_update' and refund_id is not null and event_status is not null)
  )
);

comment on table public.email_outbox is
  'Customer order emails waiting to be sent. Filled by triggers on order, shipment, return and refund history; claimed and finished only by the service role. `sent` means the mail server accepted the message.';
comment on column public.email_outbox.last_error is
  'A short machine code for the last failure; never an address, a message or a provider reply.';

create index email_outbox_due_idx on public.email_outbox (next_attempt_at)
  where status in ('pending', 'sending');
create index email_outbox_user_idx on public.email_outbox (user_id);
create index email_outbox_order_idx on public.email_outbox (order_id);

alter table public.email_outbox enable row level security;
revoke all on table public.email_outbox from public, anon, authenticated;
grant select, insert, update, delete on table public.email_outbox to service_role;

/** Queues one email; a second row for the same event is silently ignored. */
create function private.queue_customer_email(
  p_key text,
  p_kind text,
  p_order uuid,
  p_shipment uuid default null,
  p_return uuid default null,
  p_refund uuid default null,
  p_event_status text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_number text;
begin
  select o.user_id, o.order_number into v_user, v_number
    from public.orders o where o.id = p_order;
  if not found or v_user is null then
    return;
  end if;
  insert into public.email_outbox
    (dedupe_key, kind, user_id, order_id, order_number, shipment_id, return_request_id,
     refund_id, event_status)
  values (p_key, p_kind, v_user, p_order, v_number, p_shipment, p_return, p_refund,
          p_event_status)
  on conflict (dedupe_key) do nothing;
end;
$$;

create function private.email_on_order_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only the creation of the order: its later states are told by push and in-app news.
  if new.from_status is null then
    perform private.queue_customer_email('order_placed:' || new.order_id::text,
                                         'order_confirmation', new.order_id);
  end if;
  return null;
end;
$$;

create trigger order_status_history_queue_email
  after insert on public.order_status_history
  for each row execute function private.email_on_order_history();

create function private.email_on_shipment_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A real parcel to the customer (not a return pickup, exchange or test booking) that the
  -- courier now reports as out for delivery. Once per shipment, however often it is reported.
  if new.status = 'out_for_delivery'
     and old.status is distinct from 'out_for_delivery'
     and new.kind = 'forward'
     and not new.is_mock then
    perform private.queue_customer_email('out_for_delivery:' || new.id::text,
                                         'out_for_delivery', new.order_id, new.id);
  end if;
  return null;
end;
$$;

create trigger shipments_queue_out_for_delivery_email
  after update of status on public.shipments
  for each row execute function private.email_on_shipment_status();

create function private.email_on_return_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
begin
  select r.order_id into v_order from public.return_requests r where r.id = new.return_request_id;
  if v_order is not null then
    perform private.queue_customer_email('return_history:' || new.id::text, 'return_update',
                                         v_order, null, new.return_request_id, null,
                                         new.to_status::text);
  end if;
  return null;
end;
$$;

create trigger return_status_history_queue_email
  after insert on public.return_status_history
  for each row execute function private.email_on_return_history();

create function private.email_on_refund_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  v_return uuid;
begin
  -- Only decisions the customer needs to hear about; `requested` is part of the approval.
  if new.to_status not in ('approved', 'completed', 'rejected') then
    return null;
  end if;
  select f.order_id, f.return_request_id into v_order, v_return
    from public.refunds f where f.id = new.refund_id;
  if v_order is not null then
    perform private.queue_customer_email('refund_history:' || new.id::text, 'refund_update',
                                         v_order, null, v_return, new.refund_id,
                                         new.to_status::text);
  end if;
  return null;
end;
$$;

create trigger refund_status_history_queue_email
  after insert on public.refund_status_history
  for each row execute function private.email_on_refund_history();

-- ---------------------------------------------------------------------------
-- Worker interface (service role only)
-- ---------------------------------------------------------------------------

/**
 * Takes up to p_limit due emails: pending rows whose time has come, and rows another worker
 * claimed but never finished once their lease ran out. Each taken row counts an attempt and
 * is leased for p_lease_seconds. Emails of accounts that are not active are skipped.
 */
create function public.claim_customer_emails(
  p_limit integer default 20,
  p_lease_seconds integer default 120
)
returns table (
  id uuid, kind text, user_id uuid, order_id uuid, order_number text, shipment_id uuid,
  return_request_id uuid, refund_id uuid, event_status text, attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.email_outbox e
     set status = 'skipped', locked_until = null, last_error = 'account_inactive'
   where e.status in ('pending', 'sending')
     and e.next_attempt_at <= now()
     and exists (select 1 from public.profiles p where p.id = e.user_id and p.status <> 'active');

  return query
  with due as (
    select e.id from public.email_outbox e
     where (e.status = 'pending' and e.next_attempt_at <= now())
        or (e.status = 'sending' and e.locked_until < now())
     order by e.next_attempt_at
     limit greatest(1, least(p_limit, 100))
     for update skip locked
  )
  update public.email_outbox e
     set status = 'sending',
         attempts = e.attempts + 1,
         locked_until = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 600)))
    from due
   where e.id = due.id
  returning e.id, e.kind, e.user_id, e.order_id, e.order_number, e.shipment_id,
            e.return_request_id, e.refund_id, e.event_status, e.attempts;
end;
$$;

/**
 * Records the outcome of a claimed email. `sent` only when the mail server accepted it;
 * `retry` puts it back in the queue after p_retry_seconds; `failed` and `skipped` end it.
 */
create function public.finish_customer_email(
  p_id uuid,
  p_outcome text,
  p_retry_seconds integer default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_outcome not in ('sent', 'retry', 'failed', 'skipped') then
    raise exception 'unknown outcome' using errcode = 'NZ422';
  end if;
  update public.email_outbox
     set status = case p_outcome when 'retry' then 'pending' else p_outcome end,
         sent_at = case when p_outcome = 'sent' then now() else sent_at end,
         next_attempt_at = case when p_outcome = 'retry'
                                then now() + make_interval(secs => greatest(1, least(coalesce(p_retry_seconds, 60), 3600)))
                                else next_attempt_at end,
         locked_until = null,
         last_error = case when p_outcome = 'sent' then null
                           when p_error ~ '^[a-z0-9_]{1,64}$' then p_error
                           else coalesce(last_error, 'send_failed') end
   where id = p_id and status = 'sending';
end;
$$;

revoke execute on function private.queue_customer_email(text, text, uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.claim_customer_emails(integer, integer) from public, anon, authenticated;
revoke execute on function public.finish_customer_email(uuid, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.claim_customer_emails(integer, integer) to service_role;
grant execute on function public.finish_customer_email(uuid, text, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Review prompt dismissals
-- ---------------------------------------------------------------------------

create table public.review_prompt_dismissals (
  user_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

comment on table public.review_prompt_dismissals is
  'Delivered products whose "write a review" prompt the customer closed; the prompt is not shown again for them. The My Orders list is unaffected.';

alter table public.review_prompt_dismissals enable row level security;

create policy review_prompt_dismissals_own_select on public.review_prompt_dismissals
  for select to authenticated using (user_id = (select auth.uid()));
create policy review_prompt_dismissals_own_insert on public.review_prompt_dismissals
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy review_prompt_dismissals_own_update on public.review_prompt_dismissals
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on table public.review_prompt_dismissals from public, anon;
grant select, insert, update on table public.review_prompt_dismissals to authenticated;
grant select, insert, update, delete on table public.review_prompt_dismissals to service_role;
