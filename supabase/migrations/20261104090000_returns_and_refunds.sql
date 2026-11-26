-- ---------------------------------------------------------------------------
-- Returns and refunds
--
-- A customer asks to return items of a delivered order; staff decide, then — only once
-- the goods are back — the items are restocked and money is refunded. Cash on Delivery
-- means a refund is money paid back by hand: it is recorded with a reference and an
-- approver, never triggered by a payment gateway.
--
-- Money is in poisha (integers). Past orders are never rewritten: a return and a refund
-- are separate records that point at the order.
--
-- SQLSTATEs: NZ480 return_not_eligible, NZ481 return_quantity, NZ482 return_closed,
-- NZ483 refund_exceeds_balance, NZ484 refund_not_decidable, NZ485 refund_not_completable.
-- ---------------------------------------------------------------------------

create type public.return_status as enum (
  'requested', 'approved', 'rejected', 'received', 'completed', 'cancelled'
);

/** How the money goes back. Only cash is real today; a gateway can be added later. */
create type public.refund_method as enum ('cod_manual', 'bank_transfer');

create type public.refund_status as enum (
  'requested', 'approved', 'completed', 'rejected', 'cancelled'
);

-- ---------------------------------------------------------------------------
-- Store settings: the small, reviewed values operations may change without a deploy.
-- ---------------------------------------------------------------------------

create table public.store_settings (
  id boolean primary key default true check (id),
  /** How long after delivery a customer may ask to return items. */
  return_window_days integer not null default 7 check (return_window_days between 1 and 90),
  /** Inactivity after which a cart is no longer counted as an open checkout. */
  cart_inactivity_minutes integer not null default 120
    check (cart_inactivity_minutes between 15 and 10080),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

insert into public.store_settings (id) values (true);

alter table public.store_settings enable row level security;

create trigger store_settings_set_updated_at
before update on public.store_settings
for each row execute function public.set_updated_at();

create function private.return_window_days()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select return_window_days from public.store_settings where id;
$$;

-- ---------------------------------------------------------------------------
-- Return requests
-- ---------------------------------------------------------------------------

create table public.return_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  status public.return_status not null default 'requested',
  reason text not null check (char_length(btrim(reason)) between 3 and 120),
  description text check (description is null or char_length(description) <= 1000),
  item_count integer not null check (item_count > 0),
  /** The most that could be refunded for the returned items, at the time of asking. */
  refundable_minor bigint not null default 0 check (refundable_minor >= 0),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  decision_note text check (decision_note is null or char_length(decision_note) <= 300),
  received_at timestamptz,
  restocked_at timestamptz,
  restocked_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.return_requests is
  'A customer asking to send items of a delivered order back. Written only by the functions below.';
comment on column public.return_requests.refundable_minor is
  'Cash actually collected for these items; a refund never exceeds it.';

create index return_requests_user_idx on public.return_requests (user_id, requested_at desc);
create index return_requests_status_idx on public.return_requests (status, requested_at desc);
create index return_requests_order_idx on public.return_requests (order_id);

create trigger return_requests_set_updated_at
before update on public.return_requests
for each row execute function public.set_updated_at();

create table public.return_items (
  id bigint generated always as identity primary key,
  return_request_id uuid not null references public.return_requests (id) on delete cascade,
  order_item_id bigint not null references public.order_items (id) on delete restrict,
  quantity integer not null check (quantity between 1 and 100),
  line_total_minor bigint not null check (line_total_minor >= 0),
  constraint return_items_once_per_line unique (return_request_id, order_item_id)
);

create index return_items_request_idx on public.return_items (return_request_id);
create index return_items_order_item_idx on public.return_items (order_item_id);

create table public.return_status_history (
  id bigint generated always as identity primary key,
  return_request_id uuid not null references public.return_requests (id) on delete cascade,
  from_status public.return_status,
  to_status public.return_status not null,
  actor_kind public.order_actor not null,
  actor_id uuid references public.profiles (id) on delete set null,
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now()
);

create index return_status_history_request_idx
  on public.return_status_history (return_request_id, created_at);

alter table public.return_requests enable row level security;
alter table public.return_items enable row level security;
alter table public.return_status_history enable row level security;

-- ---------------------------------------------------------------------------
-- Refunds
-- ---------------------------------------------------------------------------

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  return_request_id uuid references public.return_requests (id) on delete restrict,
  amount_minor bigint not null check (amount_minor between 1 and 1000000000),
  reason text not null check (char_length(btrim(reason)) between 3 and 200),
  method public.refund_method not null default 'cod_manual',
  status public.refund_status not null default 'requested',
  /** The bank/transaction reference or receipt number that proves the money moved. */
  reference text check (reference is null or char_length(btrim(reference)) between 3 and 120),
  note text check (note is null or char_length(note) <= 500),
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  completed_by uuid references public.profiles (id) on delete set null,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  -- A completed refund always says who paid it out and what proves it.
  constraint refunds_completion_recorded check (
    (status = 'completed') = (completed_at is not null)
    and (status <> 'completed' or (completed_by is not null and reference is not null))
  )
);

comment on table public.refunds is
  'Money going back to a customer. Computed amounts and state live in the functions below; rows are never deleted.';
comment on column public.refunds.reference is
  'Evidence of the payout (a receipt, a bank transfer reference). Required before a refund counts as paid.';

create index refunds_order_idx on public.refunds (order_id, requested_at desc);
create index refunds_status_idx on public.refunds (status, requested_at desc);
create index refunds_return_idx on public.refunds (return_request_id);

create trigger refunds_set_updated_at
before update on public.refunds
for each row execute function public.set_updated_at();

create table public.refund_status_history (
  id bigint generated always as identity primary key,
  refund_id uuid not null references public.refunds (id) on delete cascade,
  from_status public.refund_status,
  to_status public.refund_status not null,
  actor_id uuid references public.profiles (id) on delete set null,
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now()
);

create index refund_status_history_refund_idx
  on public.refund_status_history (refund_id, created_at);

alter table public.refunds enable row level security;
alter table public.refund_status_history enable row level security;

-- ---------------------------------------------------------------------------
-- How much of an order can still be refunded: the cash collected, less everything
-- already approved or paid out. A pending refund does not reserve the balance.
-- ---------------------------------------------------------------------------

create function private.refundable_minor(p_order public.orders)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_order.payment_status <> 'collected' then 0
    else greatest(
      p_order.total_minor - coalesce((
        select sum(r.amount_minor)
        from public.refunds r
        where r.order_id = p_order.id and r.status in ('approved', 'completed')
      ), 0),
      0
    )
  end;
$$;

/** When the order was delivered, from its own status history; null if it never was. */
create function private.delivered_at(p_order_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select max(h.created_at)
  from public.order_status_history h
  where h.order_id = p_order_id and h.to_status = 'delivered';
$$;

/** How many units of an order line are already in a live (undecided or accepted) return. */
create function private.quantity_in_returns(p_order_item_id bigint)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(ri.quantity), 0)::integer
  from public.return_items ri
  join public.return_requests rr on rr.id = ri.return_request_id
  where ri.order_item_id = p_order_item_id
    and rr.status in ('requested', 'approved', 'received', 'completed');
$$;

-- ---------------------------------------------------------------------------
-- Customer: ask to return items of a delivered order.
-- ---------------------------------------------------------------------------

create function public.request_return(
  p_order_number text,
  p_items jsonb,
  p_reason text,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_order public.orders;
  v_delivered timestamptz;
  v_request_id uuid;
  v_item_count integer := 0;
  v_value bigint := 0;
  v_line record;
  v_already integer;
begin
  if v_user is null then
    raise exception 'sign in to return an item' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = v_user and status = 'active') then
    raise exception 'this account cannot request returns' using errcode = 'NZ410';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 120 then
    raise exception 'choose a reason' using errcode = 'NZ412';
  end if;
  if v_description is not null and char_length(v_description) > 1000 then
    raise exception 'the description is too long' using errcode = 'NZ412';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'choose at least one item to return' using errcode = 'NZ412';
  end if;

  select * into v_order
  from public.orders
  where order_number = p_order_number and user_id = v_user
  for update;
  if not found then
    raise exception 'order not found' using errcode = 'NZ404';
  end if;
  if v_order.status <> 'delivered' then
    raise exception 'only delivered orders can be returned' using errcode = 'NZ480';
  end if;

  v_delivered := private.delivered_at(v_order.id);
  if v_delivered is null
     or v_delivered < now() - make_interval(days => private.return_window_days()) then
    raise exception 'the return window for this order has closed' using errcode = 'NZ480';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) as e (item)
    where jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item -> 'orderItemId') is distinct from 'number'
      or jsonb_typeof(item -> 'quantity') is distinct from 'number'
  ) then
    raise exception 'every returned item needs its order line and a quantity'
      using errcode = 'NZ412';
  end if;

  if (select count(distinct (e.item ->> 'orderItemId')) from jsonb_array_elements(p_items) as e (item))
     <> jsonb_array_length(p_items) then
    raise exception 'each order line may appear only once' using errcode = 'NZ412';
  end if;

  insert into public.return_requests (order_id, user_id, reason, description)
  values (v_order.id, v_user, btrim(p_reason), v_description)
  returning id into v_request_id;

  for v_line in
    select
      (e.item ->> 'orderItemId')::bigint as order_item_id,
      (e.item ->> 'quantity')::integer as quantity
    from jsonb_array_elements(p_items) as e (item)
  loop
    if v_line.quantity is null or v_line.quantity < 1 or v_line.quantity > 100 then
      raise exception 'each quantity must be from 1 to 100' using errcode = 'NZ412';
    end if;

    -- The line must be this order's, and the quantity must still be returnable.
    perform 1 from public.order_items
    where id = v_line.order_item_id and order_id = v_order.id;
    if not found then
      raise exception 'that line is not part of this order' using errcode = 'NZ412';
    end if;

    v_already := private.quantity_in_returns(v_line.order_item_id);
    if v_line.quantity + v_already > (
      select oi.quantity from public.order_items oi where oi.id = v_line.order_item_id
    ) then
      raise exception 'more units were asked for than can still be returned'
        using errcode = 'NZ481';
    end if;

    insert into public.return_items (return_request_id, order_item_id, quantity, line_total_minor)
    select v_request_id, oi.id, v_line.quantity, oi.unit_price_minor * v_line.quantity
    from public.order_items oi
    where oi.id = v_line.order_item_id;

    v_item_count := v_item_count + v_line.quantity;
    v_value := v_value + (
      select oi.unit_price_minor * v_line.quantity
      from public.order_items oi where oi.id = v_line.order_item_id
    );
  end loop;

  update public.return_requests
  set item_count = v_item_count,
      refundable_minor = least(v_value, private.refundable_minor(v_order))
  where id = v_request_id;

  insert into public.return_status_history (return_request_id, from_status, to_status, actor_kind, actor_id)
  values (v_request_id, null, 'requested', 'customer', v_user);

  return v_request_id;
end;
$$;

create function public.cancel_my_return(p_return_id uuid)
returns public.return_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_request public.return_requests;
begin
  if v_user is null then
    raise exception 'sign in to manage returns' using errcode = '42501';
  end if;

  select * into v_request
  from public.return_requests
  where id = p_return_id and user_id = v_user
  for update;
  if not found then
    raise exception 'return not found' using errcode = 'NZ404';
  end if;
  if v_request.status not in ('requested', 'approved') then
    raise exception 'this return can no longer be cancelled' using errcode = 'NZ482';
  end if;

  update public.return_requests set status = 'cancelled' where id = v_request.id;
  insert into public.return_status_history (return_request_id, from_status, to_status, actor_kind, actor_id)
  values (v_request.id, v_request.status, 'cancelled', 'customer', v_user);
  return 'cancelled';
end;
$$;

/** The signed-in customer's returns, newest first. */
create function public.my_returns()
returns table (
  id uuid,
  order_number text,
  status public.return_status,
  item_count integer,
  refundable_minor bigint,
  reason text,
  requested_at timestamptz,
  decided_at timestamptz,
  decision_note text
)
language sql
stable
security definer
set search_path = ''
as $$
  select rr.id, o.order_number, rr.status, rr.item_count, rr.refundable_minor, rr.reason,
         rr.requested_at, rr.decided_at, rr.decision_note
  from public.return_requests rr
  join public.orders o on o.id = rr.order_id
  where rr.user_id = (select auth.uid())
  order by rr.requested_at desc;
$$;

/** One return with its lines and history; null when it is not the caller's. */
create function public.my_return(p_return_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_request public.return_requests;
begin
  if v_user is null then
    return null;
  end if;
  select * into v_request
  from public.return_requests
  where id = p_return_id and user_id = v_user;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_request.id,
    'orderNumber', (select order_number from public.orders where id = v_request.order_id),
    'status', v_request.status,
    'reason', v_request.reason,
    'description', v_request.description,
    'refundableMinor', v_request.refundable_minor,
    'requestedAt', v_request.requested_at,
    'decidedAt', v_request.decided_at,
    'decisionNote', v_request.decision_note,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'orderItemId', ri.order_item_id,
               'productName', oi.product_name,
               'variantLabel', oi.variant_label,
               'sku', oi.sku,
               'quantity', ri.quantity,
               'lineTotalMinor', ri.line_total_minor
             ) order by ri.id)
      from public.return_items ri
      join public.order_items oi on oi.id = ri.order_item_id
      where ri.return_request_id = v_request.id
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'fromStatus', h.from_status,
               'toStatus', h.to_status,
               'actorKind', h.actor_kind,
               'note', h.note,
               'at', h.created_at
             ) order by h.created_at, h.id)
      from public.return_status_history h
      where h.return_request_id = v_request.id
    ), '[]'::jsonb)
  );
end;
$$;

/** The refunds recorded against one of the caller's own orders. */
create function public.my_order_refunds(p_order_number text)
returns table (
  id uuid,
  amount_minor bigint,
  method public.refund_method,
  status public.refund_status,
  reason text,
  reference text,
  requested_at timestamptz,
  completed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.amount_minor, r.method, r.status, r.reason, r.reference,
         r.requested_at, r.completed_at
  from public.refunds r
  join public.orders o on o.id = r.order_id
  where o.order_number = p_order_number and o.user_id = (select auth.uid())
  order by r.requested_at desc;
$$;

revoke execute on function public.request_return(text, jsonb, text, text)
  from public, anon, authenticated;
revoke execute on function public.cancel_my_return(uuid) from public, anon, authenticated;
revoke execute on function public.my_returns() from public, anon, authenticated;
revoke execute on function public.my_return(uuid) from public, anon, authenticated;
revoke execute on function public.my_order_refunds(text) from public, anon, authenticated;

grant execute on function public.request_return(text, jsonb, text, text) to authenticated;
grant execute on function public.cancel_my_return(uuid) to authenticated;
grant execute on function public.my_returns() to authenticated;
grant execute on function public.my_return(uuid) to authenticated;
grant execute on function public.my_order_refunds(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Staff: the return queue and its decisions.
-- ---------------------------------------------------------------------------

create function public.admin_list_returns(
  p_status text default null,
  p_query text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  order_number text,
  customer_name text,
  status public.return_status,
  item_count integer,
  refundable_minor bigint,
  reason text,
  requested_at timestamptz,
  decided_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('orders.read');
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
begin
  return query
  select rr.id, o.order_number, pr.full_name, rr.status, rr.item_count, rr.refundable_minor,
         rr.reason, rr.requested_at, rr.decided_at, count(*) over () as total_count
  from public.return_requests rr
  join public.orders o on o.id = rr.order_id
  join public.profiles pr on pr.id = rr.user_id
  where (p_status is null or rr.status::text = p_status)
    and (
      v_query is null
      or o.order_number ilike '%' || v_query || '%'
      or pr.full_name ilike '%' || v_query || '%'
    )
  order by rr.requested_at desc
  limit least(coalesce(p_limit, 25), 100) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create function public.admin_get_return(p_return_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('orders.read');
  v_request public.return_requests;
begin
  select * into v_request from public.return_requests where id = p_return_id;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_request.id,
    'status', v_request.status,
    'reason', v_request.reason,
    'description', v_request.description,
    'itemCount', v_request.item_count,
    'refundableMinor', v_request.refundable_minor,
    'requestedAt', v_request.requested_at,
    'decidedAt', v_request.decided_at,
    'decisionNote', v_request.decision_note,
    'receivedAt', v_request.received_at,
    'restockedAt', v_request.restocked_at,
    'order', (
      select jsonb_build_object(
               'number', o.order_number,
               'totalMinor', o.total_minor,
               'status', o.status,
               'paymentStatus', o.payment_status,
               'placedAt', o.placed_at,
               'deliveredAt', private.delivered_at(o.id)
             )
      from public.orders o where o.id = v_request.order_id
    ),
    'customer', (
      select jsonb_build_object('id', pr.id, 'name', pr.full_name, 'phone', pr.phone)
      from public.profiles pr where pr.id = v_request.user_id
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'orderItemId', ri.order_item_id,
               'productName', oi.product_name,
               'productSlug', oi.product_slug,
               'variantLabel', oi.variant_label,
               'sku', oi.sku,
               'quantity', ri.quantity,
               'orderedQuantity', oi.quantity,
               'lineTotalMinor', ri.line_total_minor
             ) order by ri.id)
      from public.return_items ri
      join public.order_items oi on oi.id = ri.order_item_id
      where ri.return_request_id = v_request.id
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'fromStatus', h.from_status,
               'toStatus', h.to_status,
               'actorKind', h.actor_kind,
               'note', h.note,
               'at', h.created_at
             ) order by h.created_at, h.id)
      from public.return_status_history h
      where h.return_request_id = v_request.id
    ), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'amountMinor', r.amount_minor, 'status', r.status,
               'method', r.method, 'requestedAt', r.requested_at, 'completedAt', r.completed_at
             ) order by r.requested_at desc)
      from public.refunds r
      where r.return_request_id = v_request.id
    ), '[]'::jsonb)
  );
end;
$$;

/**
 * Moves a return along: requested → approved | rejected, approved → received,
 * received → completed (only once the stock is back), anything open → cancelled.
 */
create function public.admin_decide_return(
  p_return_id uuid,
  p_status public.return_status,
  p_note text default null
)
returns public.return_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('orders.update_status');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_request public.return_requests;
  v_allowed boolean;
begin
  if p_status is null then
    raise exception 'a status is required' using errcode = 'NZ412';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'the note is too long' using errcode = 'NZ412';
  end if;
  if p_status = 'rejected' and (v_note is null or char_length(v_note) < 5) then
    raise exception 'a reason is required to reject a return' using errcode = 'NZ412';
  end if;

  select * into v_request from public.return_requests where id = p_return_id for update;
  if not found then
    raise exception 'return not found' using errcode = 'NZ404';
  end if;

  v_allowed := case v_request.status
    when 'requested' then p_status in ('approved', 'rejected')
    when 'approved' then p_status in ('received', 'cancelled')
    when 'received' then p_status = 'completed'
    else false
  end;
  if not v_allowed then
    raise exception 'a return that is % cannot become %', v_request.status, p_status
      using errcode = 'NZ482';
  end if;

  -- Goods cannot be "completed" before they are back and restocked.
  if p_status = 'completed' and v_request.restocked_at is null then
    raise exception 'restock the returned items before completing the return'
      using errcode = 'NZ482';
  end if;

  update public.return_requests
  set status = p_status,
      decided_at = case when p_status in ('approved', 'rejected') then now() else decided_at end,
      decided_by = case when p_status in ('approved', 'rejected') then v_actor else decided_by end,
      decision_note = case when p_status in ('approved', 'rejected') then v_note else decision_note end,
      received_at = case when p_status = 'received' then now() else received_at end
  where id = v_request.id;

  insert into public.return_status_history (return_request_id, from_status, to_status, actor_kind, actor_id, note)
  values (v_request.id, v_request.status, p_status, 'staff', v_actor, v_note);

  perform private.audit(v_actor, 'return.status_changed', 'return_request', v_request.id::text,
    jsonb_build_object('from', v_request.status, 'to', p_status));
  return p_status;
end;
$$;

/**
 * Puts the returned units back into stock — and only the units, for the exact product or
 * variant sold. Stock never moves because a return was merely requested.
 */
create function public.admin_restock_return(p_return_id uuid, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('inventory.adjust');
  v_note text := coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Returned items restocked');
  v_request public.return_requests;
  v_units integer := 0;
  v_line record;
begin
  select * into v_request from public.return_requests where id = p_return_id for update;
  if not found then
    raise exception 'return not found' using errcode = 'NZ404';
  end if;
  if v_request.status <> 'received' then
    raise exception 'only a received return can be restocked' using errcode = 'NZ482';
  end if;
  if v_request.restocked_at is not null then
    raise exception 'these items were already restocked' using errcode = 'NZ482';
  end if;

  for v_line in
    select oi.product_id, oi.variant_id, ri.quantity
    from public.return_items ri
    join public.order_items oi on oi.id = ri.order_item_id
    where ri.return_request_id = v_request.id
    order by oi.product_id, oi.variant_id
  loop
    perform 1 from public.products where id = v_line.product_id for update;

    if v_line.variant_id is not null then
      perform 1 from public.product_variants where id = v_line.variant_id for update;
      update public.product_variants
      set stock_quantity = stock_quantity + v_line.quantity
      where id = v_line.variant_id;
      insert into public.inventory_movements
        (product_id, variant_id, change, stock_after, reason, actor_id, note)
      select v_line.product_id, v_line.variant_id, v_line.quantity, v.stock_quantity,
             'adjustment', v_actor, v_note
      from public.product_variants v where v.id = v_line.variant_id;
    else
      update public.products
      set stock_quantity = stock_quantity + v_line.quantity
      where id = v_line.product_id;
      insert into public.inventory_movements (product_id, change, stock_after, reason, actor_id, note)
      select v_line.product_id, v_line.quantity, p.stock_quantity, 'adjustment', v_actor, v_note
      from public.products p where p.id = v_line.product_id;
    end if;

    v_units := v_units + v_line.quantity;
  end loop;

  update public.return_requests
  set restocked_at = now(), restocked_by = v_actor
  where id = v_request.id;

  perform private.audit(v_actor, 'return.restocked', 'return_request', v_request.id::text,
    jsonb_build_object('units', v_units));
  return v_units;
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff: refunds.
-- ---------------------------------------------------------------------------

create function public.admin_list_refunds(
  p_status text default null,
  p_query text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  order_number text,
  customer_name text,
  amount_minor bigint,
  method public.refund_method,
  status public.refund_status,
  reason text,
  requested_at timestamptz,
  completed_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('orders.read');
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
begin
  return query
  select r.id, o.order_number, pr.full_name, r.amount_minor, r.method, r.status, r.reason,
         r.requested_at, r.completed_at, count(*) over () as total_count
  from public.refunds r
  join public.orders o on o.id = r.order_id
  join public.profiles pr on pr.id = o.user_id
  where (p_status is null or r.status::text = p_status)
    and (
      v_query is null
      or o.order_number ilike '%' || v_query || '%'
      or pr.full_name ilike '%' || v_query || '%'
      or r.reference ilike '%' || v_query || '%'
    )
  order by r.requested_at desc
  limit least(coalesce(p_limit, 25), 100) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create function public.admin_get_refund(p_refund_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('orders.read');
  v_refund public.refunds;
  v_order public.orders;
begin
  select * into v_refund from public.refunds where id = p_refund_id;
  if not found then
    return null;
  end if;
  select * into v_order from public.orders where id = v_refund.order_id;

  return jsonb_build_object(
    'id', v_refund.id,
    'amountMinor', v_refund.amount_minor,
    'method', v_refund.method,
    'status', v_refund.status,
    'reason', v_refund.reason,
    'reference', v_refund.reference,
    'note', v_refund.note,
    'requestedAt', v_refund.requested_at,
    'decidedAt', v_refund.decided_at,
    'completedAt', v_refund.completed_at,
    'returnRequestId', v_refund.return_request_id,
    'order', jsonb_build_object(
      'number', v_order.order_number,
      'totalMinor', v_order.total_minor,
      'status', v_order.status,
      'paymentStatus', v_order.payment_status,
      'placedAt', v_order.placed_at
    ),
    'customer', (
      select jsonb_build_object('id', pr.id, 'name', pr.full_name, 'phone', pr.phone)
      from public.profiles pr where pr.id = v_order.user_id
    ),
    'refundableMinor', private.refundable_minor(v_order),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'fromStatus', h.from_status, 'toStatus', h.to_status, 'note', h.note, 'at', h.created_at
             ) order by h.created_at, h.id)
      from public.refund_status_history h where h.refund_id = v_refund.id
    ), '[]'::jsonb)
  );
end;
$$;

create function public.admin_request_refund(
  p_order_number text,
  p_amount_minor bigint,
  p_reason text,
  p_method public.refund_method default 'cod_manual',
  p_return_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('refunds.request');
  v_order public.orders;
  v_refund_id uuid;
  v_balance bigint;
begin
  if p_amount_minor is null or p_amount_minor < 1 then
    raise exception 'enter the amount to refund' using errcode = 'NZ412';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 200 then
    raise exception 'say why the money goes back' using errcode = 'NZ412';
  end if;

  select * into v_order from public.orders where order_number = p_order_number for update;
  if not found then
    raise exception 'order not found' using errcode = 'NZ404';
  end if;
  if p_return_id is not null then
    perform 1 from public.return_requests
    where id = p_return_id and order_id = v_order.id;
    if not found then
      raise exception 'that return is not for this order' using errcode = 'NZ412';
    end if;
  end if;

  v_balance := private.refundable_minor(v_order);
  if p_amount_minor > v_balance then
    raise exception 'only % poisha is left to refund on this order', v_balance
      using errcode = 'NZ483';
  end if;

  insert into public.refunds
    (order_id, return_request_id, amount_minor, reason, method, requested_by)
  values (v_order.id, p_return_id, p_amount_minor, btrim(p_reason), coalesce(p_method, 'cod_manual'), v_actor)
  returning id into v_refund_id;

  insert into public.refund_status_history (refund_id, from_status, to_status, actor_id)
  values (v_refund_id, null, 'requested', v_actor);

  perform private.audit(v_actor, 'refund.requested', 'refund', v_refund_id::text,
    jsonb_build_object('order', p_order_number, 'amountMinor', p_amount_minor));
  return v_refund_id;
end;
$$;

create function public.admin_decide_refund(
  p_refund_id uuid,
  p_approve boolean,
  p_note text default null
)
returns public.refund_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('refunds.approve');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_refund public.refunds;
  v_order public.orders;
  v_status public.refund_status;
begin
  select * into v_refund from public.refunds where id = p_refund_id for update;
  if not found then
    raise exception 'refund not found' using errcode = 'NZ404';
  end if;
  if v_refund.status <> 'requested' then
    raise exception 'this refund is already %', v_refund.status using errcode = 'NZ484';
  end if;
  if p_approve is not true and (v_note is null or char_length(v_note) < 5) then
    raise exception 'a reason is required to reject a refund' using errcode = 'NZ412';
  end if;

  v_status := case when p_approve then 'approved' else 'rejected' end;

  -- Approving must still fit the balance: another refund may have completed meanwhile.
  if p_approve then
    select * into v_order from public.orders where id = v_refund.order_id;
    if v_refund.amount_minor > private.refundable_minor(v_order) then
      raise exception 'the refundable balance of this order has changed' using errcode = 'NZ483';
    end if;
  end if;

  update public.refunds
  set status = v_status, decided_by = v_actor, decided_at = now(),
      note = coalesce(v_note, note)
  where id = v_refund.id;

  insert into public.refund_status_history (refund_id, from_status, to_status, actor_id, note)
  values (v_refund.id, v_refund.status, v_status, v_actor, v_note);

  perform private.audit(v_actor, 'refund.' || v_status::text, 'refund', v_refund.id::text,
    jsonb_build_object('amountMinor', v_refund.amount_minor));
  return v_status;
end;
$$;

/**
 * Records that the money actually went back. A reference is required: no refund counts as
 * paid because a button was clicked.
 */
create function public.admin_complete_refund(
  p_refund_id uuid,
  p_reference text,
  p_note text default null
)
returns public.refund_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('refunds.approve');
  v_reference text := nullif(btrim(coalesce(p_reference, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_refund public.refunds;
begin
  select * into v_refund from public.refunds where id = p_refund_id for update;
  if not found then
    raise exception 'refund not found' using errcode = 'NZ404';
  end if;
  if v_refund.status <> 'approved' then
    raise exception 'approve the refund before recording the payout' using errcode = 'NZ485';
  end if;
  if v_reference is null or char_length(v_reference) < 3 or char_length(v_reference) > 120 then
    raise exception 'a receipt or transfer reference is required' using errcode = 'NZ412';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'the note is too long' using errcode = 'NZ412';
  end if;

  update public.refunds
  set status = 'completed', completed_by = v_actor, completed_at = now(),
      reference = v_reference, note = coalesce(v_note, note)
  where id = v_refund.id;

  insert into public.refund_status_history (refund_id, from_status, to_status, actor_id, note)
  values (v_refund.id, v_refund.status, 'completed', v_actor, v_reference);

  perform private.audit(v_actor, 'refund.completed', 'refund', v_refund.id::text,
    jsonb_build_object('amountMinor', v_refund.amount_minor, 'reference', v_reference));
  return 'completed';
end;
$$;

create function public.admin_cancel_refund(p_refund_id uuid, p_note text)
returns public.refund_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('refunds.approve');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_refund public.refunds;
begin
  select * into v_refund from public.refunds where id = p_refund_id for update;
  if not found then
    raise exception 'refund not found' using errcode = 'NZ404';
  end if;
  if v_refund.status not in ('requested', 'approved') then
    raise exception 'this refund is already %', v_refund.status using errcode = 'NZ484';
  end if;
  if v_note is null or char_length(v_note) < 5 then
    raise exception 'a reason is required to cancel a refund' using errcode = 'NZ412';
  end if;

  update public.refunds set status = 'cancelled', decided_by = v_actor, decided_at = now(),
    note = v_note
  where id = v_refund.id;

  insert into public.refund_status_history (refund_id, from_status, to_status, actor_id, note)
  values (v_refund.id, v_refund.status, 'cancelled', v_actor, v_note);

  perform private.audit(v_actor, 'refund.cancelled', 'refund', v_refund.id::text,
    jsonb_build_object('amountMinor', v_refund.amount_minor));
  return 'cancelled';
end;
$$;

-- ---------------------------------------------------------------------------
-- Store settings: read for staff, written by the owner.
-- ---------------------------------------------------------------------------

create function public.admin_store_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
begin
  return (
    select jsonb_build_object(
             'returnWindowDays', return_window_days,
             'cartInactivityMinutes', cart_inactivity_minutes,
             'updatedAt', updated_at
           )
    from public.store_settings where id
  );
end;
$$;

create function public.admin_save_store_settings(
  p_return_window_days integer,
  p_cart_inactivity_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
begin
  if p_return_window_days is null or p_return_window_days not between 1 and 90 then
    raise exception 'the return window must be 1 to 90 days' using errcode = 'NZ412';
  end if;
  if p_cart_inactivity_minutes is null or p_cart_inactivity_minutes not between 15 and 10080 then
    raise exception 'cart inactivity must be 15 to 10080 minutes' using errcode = 'NZ412';
  end if;

  update public.store_settings
  set return_window_days = p_return_window_days,
      cart_inactivity_minutes = p_cart_inactivity_minutes,
      updated_by = v_actor
  where id;

  perform private.audit(v_actor, 'settings.saved', 'store_settings', 'settings',
    jsonb_build_object(
      'returnWindowDays', p_return_window_days,
      'cartInactivityMinutes', p_cart_inactivity_minutes
    ));
  return public.admin_store_settings();
end;
$$;

revoke execute on function public.admin_list_returns(text, text, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.admin_get_return(uuid) from public, anon, authenticated;
revoke execute on function public.admin_decide_return(uuid, public.return_status, text)
  from public, anon, authenticated;
revoke execute on function public.admin_restock_return(uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_list_refunds(text, text, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.admin_get_refund(uuid) from public, anon, authenticated;
revoke execute on function public.admin_request_refund(text, bigint, text, public.refund_method, uuid)
  from public, anon, authenticated;
revoke execute on function public.admin_decide_refund(uuid, boolean, text)
  from public, anon, authenticated;
revoke execute on function public.admin_complete_refund(uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.admin_cancel_refund(uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_store_settings() from public, anon, authenticated;
revoke execute on function public.admin_save_store_settings(integer, integer)
  from public, anon, authenticated;

grant execute on function public.admin_list_returns(text, text, integer, integer) to authenticated;
grant execute on function public.admin_get_return(uuid) to authenticated;
grant execute on function public.admin_decide_return(uuid, public.return_status, text) to authenticated;
grant execute on function public.admin_restock_return(uuid, text) to authenticated;
grant execute on function public.admin_list_refunds(text, text, integer, integer) to authenticated;
grant execute on function public.admin_get_refund(uuid) to authenticated;
grant execute on function public.admin_request_refund(text, bigint, text, public.refund_method, uuid)
  to authenticated;
grant execute on function public.admin_decide_refund(uuid, boolean, text) to authenticated;
grant execute on function public.admin_complete_refund(uuid, text, text) to authenticated;
grant execute on function public.admin_cancel_refund(uuid, text) to authenticated;
grant execute on function public.admin_store_settings() to authenticated;
grant execute on function public.admin_save_store_settings(integer, integer) to authenticated;
