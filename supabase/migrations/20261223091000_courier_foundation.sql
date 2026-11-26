-- ---------------------------------------------------------------------------
-- Courier integration (2 of 2): shipments, tracking, pricing, COD ledger
--
-- The database side of the Steadfast + Pathao hybrid courier system. The API owns the
-- provider calls (adapters, credentials, webhooks); everything that must stay consistent
-- lives here, behind functions that check the caller's permission themselves:
--
--  1. Permissions: couriers.read, couriers.configure, couriers.pricing.manage,
--     shipments.read, shipments.create, shipments.cancel, shipments.track,
--     shipments.returns.manage, couriers.cod.read, couriers.cod.reconcile. Admins get them;
--     staff get none by default (an admin grants them per account); couriers.configure is
--     the owner's (super admins hold every permission anyway).
--
--  2. A shipment's status is its own lifecycle (`shipment_status`), never the order's. The
--     order keeps its existing statuses and transitions; courier events never move it, and
--     a delivery never marks cash as collected (that stays admin_record_cod_collection).
--
--  3. Booking is idempotent and never blind. admin_begin_shipment_booking creates the row in
--     `booking_pending` under the admin's booking key and tells the API whether it may call
--     the provider (only the first call for that key may). The API reports the outcome with
--     admin_finish_shipment_booking: booked, failed (the provider refused), or uncertain (a
--     timeout: the provider may have created it). An uncertain booking is never retried; it
--     waits for admin_resolve_shipment_booking after a lookup or a check in the courier
--     portal. One active forward shipment per order.
--
--  4. shipment_events is append-only and deduplicated by key: a repeated webhook or poll adds
--     nothing. An event moves the shipment only along allowed transitions and only when it is
--     not older than the last applied one, so late or replayed events are recorded, never
--     applied backwards.
--
--  5. Money is integer poisha. courier_cod_ledger is append-only (no update, no delete, even
--     for the owner role through these functions); a settlement must carry the courier's
--     payout reference as evidence, and its items must add up to its amount. Mock shipments
--     and their money are flagged `is_mock` and excluded from every real total.
--
--  6. Provider credentials are never stored here: courier_accounts holds only non-secret
--     settings (keys that look like secrets are refused) and the last connection check.
--
--  7. Customers read their own shipments through my_order_shipments: status, courier name,
--     tracking code and timeline. Never costs, settlement, raw provider data or mock flags
--     beyond "test shipment".
--
--  8. Notifications: an applied shipment event that a customer should hear about writes the
--     in-app notification (kind shipment_update, gated by the order-updates preference) and
--     a push outbox row (kind 'shipment'). claim_notifications now returns the row's kind and
--     shipment status; order rows are unchanged.
--
-- Error codes NZ600-NZ610 are the courier refusals (mapped in apps/api modules/admin/errors.ts).
--
-- Rollback (local only; nothing here deletes or rewrites existing rows):
--   drop the triggers shipment_events_notify, shipment_events_immutable,
--   courier_cod_ledger_immutable; drop the functions added below; drop tables
--   courier_cod_ledger, courier_settlements, courier_webhook_events, shipment_events,
--   shipments, courier_quotes, courier_rate_cards, courier_location_mappings,
--   courier_settings, courier_accounts; drop type shipment_status; restore
--   notification_outbox (drop the added columns and constraint, set to_status and
--   history_id not null), claim_notifications and private.notify_customer from
--   20261213092000_customer_notifications.sql / 20261027090000_notification_outbox.sql;
--   delete the role_permissions and permissions rows named above.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Permissions
-- ---------------------------------------------------------------------------

insert into public.permissions (name, description) values
  ('couriers.read', 'See courier providers, rate cards and the courier overview'),
  ('couriers.configure', 'Enable courier providers and change their settings'),
  ('couriers.pricing.manage', 'Manage negotiated courier rate cards'),
  ('shipments.read', 'See courier shipments and their tracking'),
  ('shipments.create', 'Compare couriers and book shipments for orders'),
  ('shipments.cancel', 'Cancel courier shipments'),
  ('shipments.track', 'Refresh shipment tracking and record courier status by hand'),
  ('shipments.returns.manage', 'Book return pickups and exchange shipments'),
  ('couriers.cod.read', 'See courier cash-on-delivery positions and settlements'),
  ('couriers.cod.reconcile', 'Record courier settlements and reconcile cash on delivery')
on conflict (name) do nothing;

-- Admins run day-to-day courier operations. Staff get nothing by default: an admin grants
-- the shipment permissions to the staff accounts that book parcels. Enabling a provider is
-- the owner's call (super admins hold every permission through permissions_of).
insert into public.role_permissions (role, permission)
select 'admin'::public.app_role, p
from unnest(array[
  'couriers.read', 'couriers.pricing.manage', 'shipments.read', 'shipments.create',
  'shipments.cancel', 'shipments.track', 'shipments.returns.manage', 'couriers.cod.read',
  'couriers.cod.reconcile'
]) as p
on conflict (role, permission) do nothing;

insert into public.role_permissions (role, permission)
select 'super_admin'::public.app_role, p
from unnest(array[
  'couriers.read', 'couriers.configure', 'couriers.pricing.manage', 'shipments.read',
  'shipments.create', 'shipments.cancel', 'shipments.track', 'shipments.returns.manage',
  'couriers.cod.read', 'couriers.cod.reconcile'
]) as p
on conflict (role, permission) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Types and helpers
-- ---------------------------------------------------------------------------

create type public.shipment_status as enum (
  'draft', 'quoted', 'booking_pending', 'booking_failed', 'booked', 'pickup_pending',
  'picked_up', 'in_transit', 'on_hold', 'out_for_delivery', 'delivered',
  'partially_delivered', 'delivery_failed', 'cancelled', 'return_initiated', 'returned',
  'unknown'
);

/** The caller, when they hold at least one of the permissions; NZ403 otherwise. */
create function private.courier_require_any(p_permissions text[])
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  if not exists (
    select 1 from unnest(p_permissions) as x (name)
    where x.name in (select y from private.permissions_of(v_user) as y)
  ) then
    raise exception 'missing permission %', array_to_string(p_permissions, ' or ')
      using errcode = 'NZ403';
  end if;
  return v_user;
end;
$$;

/**
 * Whether a shipment may move from one status to another. Terminal statuses never move;
 * nothing moves back to the booking stages; `unknown` is recorded but never applied.
 */
create function private.shipment_transition_ok(
  p_from public.shipment_status,
  p_to public.shipment_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_to = p_from or p_to = 'unknown' then false
    when p_from in ('booking_failed', 'cancelled', 'returned', 'delivered') then false
    when p_from in ('draft', 'quoted') then p_to in ('quoted', 'booking_pending', 'cancelled')
    when p_from = 'booking_pending' then p_to in ('booked', 'booking_failed', 'cancelled')
    when p_from = 'booked' then p_to not in ('draft', 'quoted', 'booking_pending', 'booking_failed')
    when p_from = 'pickup_pending' then
      p_to not in ('draft', 'quoted', 'booking_pending', 'booking_failed', 'booked')
    when p_from in ('picked_up', 'in_transit', 'on_hold', 'out_for_delivery', 'delivery_failed') then
      p_to in ('in_transit', 'on_hold', 'out_for_delivery', 'delivery_failed', 'delivered',
               'partially_delivered', 'return_initiated', 'returned', 'cancelled')
    when p_from = 'partially_delivered' then p_to in ('return_initiated', 'returned')
    when p_from = 'return_initiated' then p_to in ('returned')
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Provider accounts and courier settings (no secrets)
-- ---------------------------------------------------------------------------

create table public.courier_accounts (
  provider text primary key check (provider ~ '^[a-z][a-z0-9_]{1,30}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  is_enabled boolean not null default false,
  -- Non-secret provider settings (a Pathao store id, a default delivery type). Validated by
  -- the API per provider; the database refuses anything that looks like a credential.
  settings jsonb not null default '{}'::jsonb check (
    jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 4096
  ),
  -- What the courier charges, for internal estimates: COD fee in basis points of the COD
  -- amount (100 = 1%), and a flat return charge. Null = not known.
  cod_fee_bp integer check (cod_fee_bp is null or cod_fee_bp between 0 and 10000),
  return_charge_minor bigint check (return_charge_minor is null or return_charge_minor between 0 and 10000000),
  last_check_at timestamptz,
  last_check_ok boolean,
  last_check_mode text check (last_check_mode is null or last_check_mode in ('mock', 'live')),
  last_check_message text check (last_check_message is null or char_length(last_check_message) <= 300),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

insert into public.courier_accounts (provider, display_name) values
  ('steadfast', 'Steadfast Courier'),
  ('pathao', 'Pathao Courier')
on conflict (provider) do nothing;

create table public.courier_settings (
  id boolean primary key default true check (id),
  default_parcel_weight_grams integer not null default 500
    check (default_parcel_weight_grams between 1 and 50000),
  quote_validity_minutes integer not null default 30 check (quote_validity_minutes between 1 and 1440),
  -- Used to break a tie between equally good couriers; never overrides availability.
  preferred_provider text references public.courier_accounts (provider) on delete set null,
  -- Delivery history is used in a recommendation only once a courier has this many settled
  -- outcomes, so two early failures cannot rule a courier out.
  min_history_sample integer not null default 20 check (min_history_sample between 1 and 10000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

insert into public.courier_settings (id) values (true) on conflict (id) do nothing;

-- Negotiated rates, entered by the admin, for internal estimates. One row is "up to this
-- weight, this zone, this charge"; the smallest bracket that holds the parcel applies.
create table public.courier_rate_cards (
  id uuid primary key default gen_random_uuid(),
  provider text not null references public.courier_accounts (provider) on delete cascade,
  zone public.delivery_zone not null,
  weight_up_to_grams integer not null check (weight_up_to_grams between 1 and 50000),
  charge_minor bigint not null check (charge_minor between 0 and 10000000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  unique (provider, zone, weight_up_to_grams)
);

-- Pathao (and future couriers) need their own location ids; an admin picks them at booking
-- and the choice is remembered for the next order to the same district and area.
create table public.courier_location_mappings (
  id uuid primary key default gen_random_uuid(),
  provider text not null references public.courier_accounts (provider) on delete cascade,
  district text not null check (char_length(district) between 1 and 80),
  area_key text not null check (char_length(area_key) <= 80),
  destination jsonb not null check (jsonb_typeof(destination) = 'object' and pg_column_size(destination) <= 1024),
  label text check (label is null or char_length(label) <= 160),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  unique (provider, district, area_key)
);

-- ---------------------------------------------------------------------------
-- 4. Quotes
-- ---------------------------------------------------------------------------

create table public.courier_quotes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  provider text not null references public.courier_accounts (provider) on delete cascade,
  -- live: the courier's own API answered; provider_estimate: the courier returned an
  -- estimate; internal_estimate: from the admin's rate card; unavailable: no price.
  kind text not null check (kind in ('live', 'provider_estimate', 'internal_estimate', 'unavailable')),
  available boolean not null,
  unavailable_reason text check (unavailable_reason is null or char_length(unavailable_reason) <= 200),
  delivery_charge_minor bigint check (delivery_charge_minor is null or delivery_charge_minor >= 0),
  cod_fee_minor bigint check (cod_fee_minor is null or cod_fee_minor >= 0),
  return_charge_minor bigint check (return_charge_minor is null or return_charge_minor >= 0),
  weight_grams integer not null check (weight_grams between 1 and 50000),
  zone public.delivery_zone not null,
  cod_amount_minor bigint not null check (cod_amount_minor >= 0),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 4096),
  is_mock boolean not null default false,
  quoted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  quoted_by uuid references public.profiles (id) on delete set null,
  check (available = (kind <> 'unavailable')),
  check (not available or delivery_charge_minor is not null),
  check (expires_at > quoted_at)
);

create index courier_quotes_order_idx on public.courier_quotes (order_id, quoted_at desc);

-- ---------------------------------------------------------------------------
-- 5. Shipments and their events
-- ---------------------------------------------------------------------------

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  kind text not null default 'forward' check (kind in ('forward', 'return_pickup', 'exchange')),
  return_request_id uuid references public.return_requests (id) on delete restrict,
  parent_shipment_id uuid references public.shipments (id) on delete restrict,
  provider text not null references public.courier_accounts (provider) on delete restrict,
  status public.shipment_status not null default 'booking_pending',
  is_mock boolean not null,
  -- The admin's booking key: the same key never books twice.
  booking_key uuid not null unique,
  -- What Nilzora sends the courier as its own reference (invoice / merchant order id).
  merchant_ref text not null unique check (merchant_ref ~ '^[A-Z0-9-]{3,40}$'),
  consignment_id text check (consignment_id is null or char_length(consignment_id) between 1 and 80),
  tracking_code text check (tracking_code is null or char_length(tracking_code) between 1 and 80),
  tracking_url text check (tracking_url is null or tracking_url ~ '^https://[A-Za-z0-9.-]+/'),
  weight_grams integer not null check (weight_grams between 1 and 50000),
  cod_amount_minor bigint not null check (cod_amount_minor >= 0),
  delivery_zone public.delivery_zone not null,
  destination jsonb not null default '{}'::jsonb check (jsonb_typeof(destination) = 'object' and pg_column_size(destination) <= 1024),
  note text check (note is null or char_length(note) <= 300),
  quote_id uuid references public.courier_quotes (id) on delete set null,
  recommended_provider text references public.courier_accounts (provider) on delete set null,
  selection_reason text check (selection_reason is null or char_length(selection_reason) between 3 and 300),
  -- What the courier is expected to charge (from the quote or the booking answer).
  expected_charge_minor bigint check (expected_charge_minor is null or expected_charge_minor >= 0),
  expected_cod_fee_minor bigint check (expected_cod_fee_minor is null or expected_cod_fee_minor >= 0),
  provider_status text check (provider_status is null or char_length(provider_status) <= 80),
  provider_call_started_at timestamptz,
  booking_uncertain boolean not null default false,
  booking_error text check (booking_error is null or char_length(booking_error) <= 300),
  booked_at timestamptz,
  booked_by uuid references public.profiles (id) on delete set null,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) between 3 and 300),
  last_event_at timestamptz,
  next_sync_at timestamptz,
  sync_attempts integer not null default 0 check (sync_attempts >= 0),
  sync_error text check (sync_error is null or char_length(sync_error) <= 300),
  cod_state text not null default 'open' check (cod_state in ('open', 'disputed', 'reconciled')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'forward') = (return_request_id is null)),
  check (kind <> 'return_pickup' or cod_amount_minor = 0),
  check (status <> 'booked' or consignment_id is not null),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  -- A consignment id names one shipment per courier (unbooked rows have none yet).
  unique (provider, consignment_id)
);

-- One live parcel of each kind at a time: a new forward shipment only after the last one
-- was cancelled, failed to book or came back; one pickup and one exchange per return.
create unique index shipments_one_active_forward
  on public.shipments (order_id)
  where kind = 'forward' and status not in ('cancelled', 'booking_failed', 'returned');
create unique index shipments_one_active_per_return
  on public.shipments (return_request_id, kind)
  where kind <> 'forward' and status not in ('cancelled', 'booking_failed');
create index shipments_order_idx on public.shipments (order_id, created_at desc);
create index shipments_status_idx on public.shipments (status, created_at desc);
create index shipments_sync_due_idx on public.shipments (next_sync_at)
  where next_sync_at is not null;
create index shipments_tracking_idx on public.shipments (tracking_code) where tracking_code is not null;

create trigger shipments_set_updated_at
  before update on public.shipments
  for each row execute function public.set_updated_at();

create table public.shipment_events (
  id bigint generated always as identity primary key,
  shipment_id uuid not null references public.shipments (id) on delete restrict,
  status public.shipment_status not null,
  provider_status text check (provider_status is null or char_length(provider_status) <= 80),
  source text not null check (source in ('booking', 'webhook', 'poll', 'manual', 'system')),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  dedupe_key text not null unique check (char_length(dedupe_key) between 1 and 200),
  -- Whether the event moved the shipment (false: a repeat, an older event, or not allowed).
  applied boolean not null,
  note text check (note is null or char_length(note) <= 300),
  actor_id uuid references public.profiles (id) on delete set null
);

create index shipment_events_shipment_idx on public.shipment_events (shipment_id, occurred_at, id);

create table public.courier_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null references public.courier_accounts (provider) on delete restrict,
  dedupe_key text not null unique check (char_length(dedupe_key) between 1 and 200),
  event_type text check (event_type is null or char_length(event_type) <= 80),
  consignment_id text check (consignment_id is null or char_length(consignment_id) <= 80),
  merchant_ref text check (merchant_ref is null or char_length(merchant_ref) <= 40),
  signature_ok boolean not null,
  -- Only the fields the processor needs; the API strips names, phones and addresses.
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 8192),
  status text not null default 'pending' check (status in ('pending', 'processed', 'ignored', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  shipment_id uuid references public.shipments (id) on delete set null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index courier_webhook_events_retry_idx on public.courier_webhook_events (next_attempt_at)
  where status = 'failed';

-- ---------------------------------------------------------------------------
-- 6. Cash on delivery: settlements and the append-only ledger
-- ---------------------------------------------------------------------------

create table public.courier_settlements (
  id uuid primary key default gen_random_uuid(),
  provider text not null references public.courier_accounts (provider) on delete restrict,
  -- The courier's payout id or invoice number: the evidence the money arrived.
  reference text not null check (char_length(btrim(reference)) between 2 and 80),
  amount_minor bigint not null check (amount_minor >= 0),
  received_on date not null,
  note text check (note is null or char_length(note) <= 300),
  is_mock boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (provider, reference)
);

create table public.courier_cod_ledger (
  id bigint generated always as identity primary key,
  shipment_id uuid not null references public.shipments (id) on delete restrict,
  order_id uuid not null references public.orders (id) on delete restrict,
  entry_type text not null check (entry_type in (
    'cod_expected', 'cod_collected', 'delivery_charge', 'cod_fee', 'return_charge',
    'other_deduction', 'settlement', 'adjustment'
  )),
  -- Poisha. Positive, except an adjustment, which may go either way.
  amount_minor bigint not null check (entry_type = 'adjustment' or amount_minor >= 0),
  settlement_id uuid references public.courier_settlements (id) on delete restrict,
  evidence_ref text check (evidence_ref is null or char_length(evidence_ref) between 1 and 80),
  dedupe_key text unique check (dedupe_key is null or char_length(dedupe_key) between 1 and 200),
  is_mock boolean not null,
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (entry_type <> 'settlement' or (settlement_id is not null and evidence_ref is not null)),
  check (entry_type <> 'adjustment' or note is not null)
);

create index courier_cod_ledger_shipment_idx on public.courier_cod_ledger (shipment_id, id);
create index courier_cod_ledger_settlement_idx on public.courier_cod_ledger (settlement_id)
  where settlement_id is not null;

/** Ledger rows and shipment events are history: they are never changed or removed. */
create function private.refuse_history_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'NZ609';
end;
$$;

create trigger shipment_events_immutable
  before update or delete on public.shipment_events
  for each row execute function private.refuse_history_change();
create trigger courier_cod_ledger_immutable
  before update or delete on public.courier_cod_ledger
  for each row execute function private.refuse_history_change();

-- ---------------------------------------------------------------------------
-- 7. Row level security: closed tables, functions are the only door
-- ---------------------------------------------------------------------------

alter table public.courier_accounts enable row level security;
alter table public.courier_settings enable row level security;
alter table public.courier_rate_cards enable row level security;
alter table public.courier_location_mappings enable row level security;
alter table public.courier_quotes enable row level security;
alter table public.shipments enable row level security;
alter table public.shipment_events enable row level security;
alter table public.courier_webhook_events enable row level security;
alter table public.courier_settlements enable row level security;
alter table public.courier_cod_ledger enable row level security;

revoke all on table
  public.courier_accounts, public.courier_settings, public.courier_rate_cards,
  public.courier_location_mappings, public.courier_quotes, public.shipments,
  public.shipment_events, public.courier_webhook_events, public.courier_settlements,
  public.courier_cod_ledger
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Shared internals
-- ---------------------------------------------------------------------------

/** A shipment as the admin sees it. Costs only when the caller may read COD money. */
create function private.shipment_json(p_shipment public.shipments, p_costs boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_shipment.id,
    'orderNumber', (select o.order_number from public.orders o where o.id = p_shipment.order_id),
    'kind', p_shipment.kind,
    'returnRequestId', p_shipment.return_request_id,
    'parentShipmentId', p_shipment.parent_shipment_id,
    'provider', p_shipment.provider,
    'providerName', (select a.display_name from public.courier_accounts a where a.provider = p_shipment.provider),
    'status', p_shipment.status,
    'isMock', p_shipment.is_mock,
    'merchantRef', p_shipment.merchant_ref,
    'consignmentId', p_shipment.consignment_id,
    'trackingCode', p_shipment.tracking_code,
    'trackingUrl', p_shipment.tracking_url,
    'weightGrams', p_shipment.weight_grams,
    'codAmountMinor', p_shipment.cod_amount_minor,
    'deliveryZone', p_shipment.delivery_zone,
    'destination', p_shipment.destination,
    'note', p_shipment.note,
    'quoteId', p_shipment.quote_id,
    'recommendedProvider', p_shipment.recommended_provider,
    'selectionReason', p_shipment.selection_reason,
    'expectedChargeMinor', case when p_costs then p_shipment.expected_charge_minor end,
    'expectedCodFeeMinor', case when p_costs then p_shipment.expected_cod_fee_minor end,
    'providerStatus', p_shipment.provider_status,
    'bookingUncertain', p_shipment.booking_uncertain,
    'bookingError', p_shipment.booking_error,
    'providerCallStartedAt', p_shipment.provider_call_started_at,
    'bookedAt', p_shipment.booked_at,
    'pickedUpAt', p_shipment.picked_up_at,
    'deliveredAt', p_shipment.delivered_at,
    'cancelledAt', p_shipment.cancelled_at,
    'cancelReason', p_shipment.cancel_reason,
    'lastEventAt', p_shipment.last_event_at,
    'nextSyncAt', p_shipment.next_sync_at,
    'syncError', p_shipment.sync_error,
    'codState', p_shipment.cod_state,
    'createdAt', p_shipment.created_at,
    'updatedAt', p_shipment.updated_at
  );
$$;

create function private.shipment_events_json(p_shipment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'status', e.status,
    'providerStatus', e.provider_status,
    'source', e.source,
    'occurredAt', e.occurred_at,
    'recordedAt', e.recorded_at,
    'applied', e.applied,
    'note', e.note
  ) order by e.occurred_at, e.id), '[]'::jsonb)
  from public.shipment_events e
  where e.shipment_id = p_shipment_id;
$$;

/**
 * Records one shipment event, idempotently (by dedupe key), and applies it when the
 * transition is allowed and the event is not older than the last applied one. Returns
 * the event id, whether it was applied, and whether it was a repeat.
 */
create function private.shipment_apply_event(
  p_shipment_id uuid,
  p_status public.shipment_status,
  p_provider_status text,
  p_source text,
  p_occurred_at timestamptz,
  p_dedupe_key text,
  p_note text,
  p_actor uuid
)
returns table (event_id bigint, applied boolean, duplicate boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_shipment public.shipments;
  v_existing public.shipment_events;
  v_occurred timestamptz := coalesce(p_occurred_at, now());
  v_applied boolean;
  v_id bigint;
begin
  if p_dedupe_key is null or char_length(p_dedupe_key) not between 1 and 200 then
    raise exception 'an event key is required' using errcode = 'NZ412';
  end if;
  if v_occurred > now() + interval '10 minutes' then
    raise exception 'the event time is in the future' using errcode = 'NZ412';
  end if;

  select * into v_shipment from public.shipments s where s.id = p_shipment_id for update;
  if not found then
    raise exception 'shipment not found' using errcode = 'NZ404';
  end if;

  select * into v_existing from public.shipment_events e where e.dedupe_key = p_dedupe_key;
  if found then
    if v_existing.shipment_id <> p_shipment_id then
      raise exception 'the event key belongs to another shipment' using errcode = 'NZ412';
    end if;
    return query select v_existing.id, v_existing.applied, true;
    return;
  end if;

  v_applied := private.shipment_transition_ok(v_shipment.status, p_status)
    and (v_shipment.last_event_at is null or v_occurred >= v_shipment.last_event_at);

  insert into public.shipment_events (
    shipment_id, status, provider_status, source, occurred_at, dedupe_key, applied, note, actor_id
  ) values (
    p_shipment_id, p_status, left(nullif(btrim(coalesce(p_provider_status, '')), ''), 80),
    p_source, v_occurred, p_dedupe_key, v_applied, left(nullif(btrim(coalesce(p_note, '')), ''), 300),
    p_actor
  )
  returning id into v_id;

  if v_applied then
    update public.shipments s
    set status = p_status,
        provider_status = coalesce(left(nullif(btrim(coalesce(p_provider_status, '')), ''), 80), s.provider_status),
        last_event_at = v_occurred,
        picked_up_at = case when p_status = 'picked_up' and s.picked_up_at is null then v_occurred else s.picked_up_at end,
        delivered_at = case when p_status in ('delivered', 'partially_delivered') then v_occurred else s.delivered_at end,
        cancelled_at = case when p_status = 'cancelled' then v_occurred else s.cancelled_at end,
        cancel_reason = case when p_status = 'cancelled'
                             then coalesce(s.cancel_reason, left(coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Cancelled by the courier'), 300))
                             else s.cancel_reason end,
        -- Terminal shipments stop syncing.
        next_sync_at = case when p_status in ('delivered', 'returned', 'cancelled', 'booking_failed') then null else s.next_sync_at end
    where s.id = p_shipment_id;
  end if;

  return query select v_id, v_applied, false;
end;
$$;

/** The remaining cash the courier should collect for a forward shipment of this order. */
create function private.order_cod_due(p_order public.orders)
returns bigint
language sql
stable
set search_path = ''
as $$
  select case when p_order.payment_status = 'pending' then p_order.total_minor else 0 end;
$$;

/** A unique reference for the courier: the order number, the kind and a sequence. */
create function private.shipment_merchant_ref(p_order public.orders, p_kind text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p_order.order_number || '-'
    || case p_kind when 'forward' then 'F' when 'return_pickup' then 'R' else 'X' end
    || (count(*) + 1)::text
  from public.shipments s
  where s.order_id = p_order.id and s.kind = p_kind;
$$;

/** Refuses a provider that is not configured, or not enabled for live use. */
create function private.courier_check_provider(p_provider text, p_is_mock boolean)
returns public.courier_accounts
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_account public.courier_accounts;
begin
  select * into v_account from public.courier_accounts a where a.provider = p_provider;
  if not found then
    raise exception 'unknown courier %', p_provider using errcode = 'NZ600';
  end if;
  -- Mock shipments are local test data: they need the provider row, not an enabled account.
  if not p_is_mock and not v_account.is_enabled then
    raise exception 'courier % is not enabled', p_provider using errcode = 'NZ600';
  end if;
  return v_account;
end;
$$;

/** Validates a provider's location choice: a small object of ids and names only. */
create function private.courier_destination_ok(p_destination jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_destination is not null
    and jsonb_typeof(p_destination) = 'object'
    and pg_column_size(p_destination) <= 1024
    and not exists (
      select 1 from jsonb_each(p_destination) as e (key, value)
      where e.key !~ '^[a-z][a-zA-Z0-9_]{0,40}$'
         or jsonb_typeof(e.value) not in ('number', 'string', 'null')
    );
$$;

/** Settings an admin may store for a provider: no credential-like keys, simple values. */
create function private.courier_settings_ok(p_settings jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_settings is not null
    and jsonb_typeof(p_settings) = 'object'
    and pg_column_size(p_settings) <= 4096
    and not exists (
      select 1 from jsonb_each(p_settings) as e (key, value)
      where e.key !~ '^[a-z][a-zA-Z0-9_]{0,40}$'
         or e.key ~* '(secret|password|passwd|token|api_?key|apikey|credential|private)'
         or jsonb_typeof(e.value) not in ('number', 'string', 'boolean', 'null')
    );
$$;

-- ---------------------------------------------------------------------------
-- 9. Configuration: providers, settings, rate cards, location mappings
-- ---------------------------------------------------------------------------

create function public.admin_courier_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.courier_require_any(array['couriers.read', 'shipments.read']);
  v_settings public.courier_settings;
begin
  select * into v_settings from public.courier_settings where id;
  return jsonb_build_object(
    'settings', jsonb_build_object(
      'defaultParcelWeightGrams', v_settings.default_parcel_weight_grams,
      'quoteValidityMinutes', v_settings.quote_validity_minutes,
      'preferredProvider', v_settings.preferred_provider,
      'minHistorySample', v_settings.min_history_sample,
      'updatedAt', v_settings.updated_at
    ),
    'providers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider', a.provider,
        'displayName', a.display_name,
        'isEnabled', a.is_enabled,
        'settings', a.settings,
        'codFeeBp', a.cod_fee_bp,
        'returnChargeMinor', a.return_charge_minor,
        'lastCheckAt', a.last_check_at,
        'lastCheckOk', a.last_check_ok,
        'lastCheckMode', a.last_check_mode,
        'lastCheckMessage', a.last_check_message,
        'updatedAt', a.updated_at
      ) order by a.provider)
      from public.courier_accounts a
    ), '[]'::jsonb),
    'rateCards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'provider', r.provider,
        'zone', r.zone,
        'weightUpToGrams', r.weight_up_to_grams,
        'chargeMinor', r.charge_minor,
        'isActive', r.is_active,
        'updatedAt', r.updated_at
      ) order by r.provider, r.zone, r.weight_up_to_grams)
      from public.courier_rate_cards r
    ), '[]'::jsonb)
  );
end;
$$;

create function public.admin_save_courier_settings(
  p_default_parcel_weight_grams integer,
  p_quote_validity_minutes integer,
  p_preferred_provider text,
  p_min_history_sample integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('couriers.configure');
begin
  if p_default_parcel_weight_grams is null or p_default_parcel_weight_grams not between 1 and 50000
     or p_quote_validity_minutes is null or p_quote_validity_minutes not between 1 and 1440
     or p_min_history_sample is null or p_min_history_sample not between 1 and 10000 then
    raise exception 'invalid courier settings' using errcode = 'NZ412';
  end if;
  if p_preferred_provider is not null
     and not exists (select 1 from public.courier_accounts a where a.provider = p_preferred_provider) then
    raise exception 'unknown courier %', p_preferred_provider using errcode = 'NZ600';
  end if;
  update public.courier_settings
  set default_parcel_weight_grams = p_default_parcel_weight_grams,
      quote_validity_minutes = p_quote_validity_minutes,
      preferred_provider = p_preferred_provider,
      min_history_sample = p_min_history_sample,
      updated_at = now(),
      updated_by = v_actor
  where id;
  perform private.audit(v_actor, 'courier.settings_saved', 'courier_settings', 'default',
    jsonb_build_object('defaultParcelWeightGrams', p_default_parcel_weight_grams,
                       'quoteValidityMinutes', p_quote_validity_minutes,
                       'preferredProvider', p_preferred_provider,
                       'minHistorySample', p_min_history_sample));
end;
$$;

create function public.admin_save_courier_provider(
  p_provider text,
  p_is_enabled boolean,
  p_settings jsonb,
  p_cod_fee_bp integer,
  p_return_charge_minor bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('couriers.configure');
begin
  if p_is_enabled is null or not private.courier_settings_ok(coalesce(p_settings, '{}'::jsonb))
     or (p_cod_fee_bp is not null and p_cod_fee_bp not between 0 and 10000)
     or (p_return_charge_minor is not null and p_return_charge_minor not between 0 and 10000000) then
    raise exception 'invalid courier provider settings' using errcode = 'NZ412';
  end if;
  update public.courier_accounts
  set is_enabled = p_is_enabled,
      settings = coalesce(p_settings, '{}'::jsonb),
      cod_fee_bp = p_cod_fee_bp,
      return_charge_minor = p_return_charge_minor,
      updated_at = now(),
      updated_by = v_actor
  where provider = p_provider;
  if not found then
    raise exception 'unknown courier %', p_provider using errcode = 'NZ600';
  end if;
  perform private.audit(v_actor, 'courier.provider_saved', 'courier_account', p_provider,
    jsonb_build_object('isEnabled', p_is_enabled, 'codFeeBp', p_cod_fee_bp,
                       'returnChargeMinor', p_return_charge_minor,
                       'settingKeys', (select coalesce(jsonb_agg(k), '[]'::jsonb)
                                       from jsonb_object_keys(coalesce(p_settings, '{}'::jsonb)) k)));
end;
$$;

/** The API records each connection check (the message never contains a credential). */
create function public.admin_record_courier_check(
  p_provider text,
  p_ok boolean,
  p_mode text,
  p_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('couriers.configure');
begin
  if p_ok is null or p_mode not in ('mock', 'live') then
    raise exception 'invalid connection check' using errcode = 'NZ412';
  end if;
  update public.courier_accounts
  set last_check_at = now(),
      last_check_ok = p_ok,
      last_check_mode = p_mode,
      last_check_message = left(nullif(btrim(coalesce(p_message, '')), ''), 300)
  where provider = p_provider;
  if not found then
    raise exception 'unknown courier %', p_provider using errcode = 'NZ600';
  end if;
  perform private.audit(v_actor, 'courier.connection_checked', 'courier_account', p_provider,
    jsonb_build_object('ok', p_ok, 'mode', p_mode));
end;
$$;

create function public.admin_save_courier_rate_card(
  p_id uuid,
  p_provider text,
  p_zone public.delivery_zone,
  p_weight_up_to_grams integer,
  p_charge_minor bigint,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('couriers.pricing.manage');
  v_id uuid := p_id;
begin
  if p_zone is null or p_weight_up_to_grams is null or p_weight_up_to_grams not between 1 and 50000
     or p_charge_minor is null or p_charge_minor not between 0 and 10000000 or p_is_active is null then
    raise exception 'invalid rate card' using errcode = 'NZ412';
  end if;
  if not exists (select 1 from public.courier_accounts a where a.provider = p_provider) then
    raise exception 'unknown courier %', p_provider using errcode = 'NZ600';
  end if;
  begin
    if v_id is null then
      insert into public.courier_rate_cards (provider, zone, weight_up_to_grams, charge_minor, is_active, updated_by)
      values (p_provider, p_zone, p_weight_up_to_grams, p_charge_minor, p_is_active, v_actor)
      returning id into v_id;
    else
      update public.courier_rate_cards
      set provider = p_provider, zone = p_zone, weight_up_to_grams = p_weight_up_to_grams,
          charge_minor = p_charge_minor, is_active = p_is_active, updated_at = now(), updated_by = v_actor
      where id = v_id;
      if not found then
        raise exception 'rate card not found' using errcode = 'NZ404';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'a rate for this courier, zone and weight already exists' using errcode = 'NZ412';
  end;
  perform private.audit(v_actor, 'courier.rate_card_saved', 'courier_rate_card', v_id::text,
    jsonb_build_object('provider', p_provider, 'zone', p_zone, 'weightUpToGrams', p_weight_up_to_grams,
                       'chargeMinor', p_charge_minor, 'isActive', p_is_active));
  return v_id;
end;
$$;

create function public.admin_delete_courier_rate_card(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('couriers.pricing.manage');
  v_card public.courier_rate_cards;
begin
  delete from public.courier_rate_cards where id = p_id returning * into v_card;
  if v_card.id is null then
    raise exception 'rate card not found' using errcode = 'NZ404';
  end if;
  perform private.audit(v_actor, 'courier.rate_card_deleted', 'courier_rate_card', p_id::text,
    jsonb_build_object('provider', v_card.provider, 'zone', v_card.zone,
                       'weightUpToGrams', v_card.weight_up_to_grams, 'chargeMinor', v_card.charge_minor));
end;
$$;

create function public.admin_save_courier_location_mapping(
  p_provider text,
  p_district text,
  p_area text,
  p_destination jsonb,
  p_label text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.courier_require_any(array['shipments.create', 'shipments.returns.manage']);
  v_area text := lower(btrim(coalesce(p_area, '')));
begin
  if p_district is null or char_length(btrim(p_district)) not between 1 and 80
     or char_length(v_area) > 80 or not private.courier_destination_ok(p_destination)
     or p_destination = '{}'::jsonb then
    raise exception 'invalid courier location' using errcode = 'NZ412';
  end if;
  if not exists (select 1 from public.courier_accounts a where a.provider = p_provider) then
    raise exception 'unknown courier %', p_provider using errcode = 'NZ600';
  end if;
  insert into public.courier_location_mappings (provider, district, area_key, destination, label, updated_by)
  values (p_provider, btrim(p_district), v_area, p_destination, left(nullif(btrim(coalesce(p_label, '')), ''), 160), v_actor)
  on conflict (provider, district, area_key) do update
    set destination = excluded.destination, label = excluded.label,
        updated_at = now(), updated_by = excluded.updated_by;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Order context, quotes and provider history
-- ---------------------------------------------------------------------------

/** Everything the booking screen needs about one order, without the customer's contact data. */
create function public.admin_order_courier_context(p_order_number text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.courier_require_any(array['shipments.read']);
  v_order public.orders;
  v_costs boolean := private.has_permission('couriers.cod.read');
  v_settings public.courier_settings;
  v_reason text;
begin
  select * into v_order from public.orders o where o.order_number = p_order_number;
  if not found then
    raise exception 'order not found' using errcode = 'NZ404';
  end if;
  select * into v_settings from public.courier_settings where id;

  v_reason := case
    when v_order.status not in ('confirmed', 'processing', 'shipped') then 'order_status'
    when exists (
      select 1 from public.shipments s
      where s.order_id = v_order.id and s.kind = 'forward'
        and s.status not in ('cancelled', 'booking_failed', 'returned')
    ) then 'active_shipment'
  end;

  return jsonb_build_object(
    'order', jsonb_build_object(
      'orderNumber', v_order.order_number,
      'status', v_order.status,
      'paymentStatus', v_order.payment_status,
      'totalMinor', v_order.total_minor,
      'codDueMinor', private.order_cod_due(v_order),
      'shippingFeeMinor', v_order.shipping_fee_minor,
      'deliveryZone', v_order.delivery_zone,
      'division', v_order.ship_division,
      'district', v_order.ship_district,
      'area', v_order.ship_area,
      'itemCount', v_order.item_count,
      'placedAt', v_order.placed_at
    ),
    'bookable', v_reason is null,
    'notBookableReason', v_reason,
    'defaultParcelWeightGrams', v_settings.default_parcel_weight_grams,
    'shipments', coalesce((
      select jsonb_agg(private.shipment_json(s, v_costs) order by s.created_at desc)
      from public.shipments s where s.order_id = v_order.id
    ), '[]'::jsonb),
    'quotes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'provider', q.provider, 'kind', q.kind, 'available', q.available,
        'unavailableReason', q.unavailable_reason, 'deliveryChargeMinor', q.delivery_charge_minor,
        'codFeeMinor', q.cod_fee_minor, 'returnChargeMinor', q.return_charge_minor,
        'weightGrams', q.weight_grams, 'zone', q.zone, 'codAmountMinor', q.cod_amount_minor,
        'details', q.details, 'isMock', q.is_mock, 'quotedAt', q.quoted_at, 'expiresAt', q.expires_at
      ) order by q.quoted_at desc, q.provider)
      from public.courier_quotes q
      where q.order_id = v_order.id and q.expires_at > now()
    ), '[]'::jsonb),
    'locationMappings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider', m.provider, 'destination', m.destination, 'label', m.label,
        'exactArea', m.area_key = lower(btrim(v_order.ship_area))
      ) order by m.provider, (m.area_key = lower(btrim(v_order.ship_area))) desc)
      from public.courier_location_mappings m
      where m.district = v_order.ship_district
        and m.area_key in (lower(btrim(v_order.ship_area)), '')
    ), '[]'::jsonb)
  );
end;
$$;

/** Stores the quotes the API computed (live, estimates or unavailable) for one order. */
create function public.admin_record_courier_quotes(p_order_number text, p_quotes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.courier_require_any(array['shipments.create', 'shipments.returns.manage']);
  v_order public.orders;
  v_minutes integer;
  v_quote jsonb;
  v_ids jsonb := '[]'::jsonb;
  v_id uuid;
begin
  select * into v_order from public.orders o where o.order_number = p_order_number;
  if not found then
    raise exception 'order not found' using errcode = 'NZ404';
  end if;
  if p_quotes is null or jsonb_typeof(p_quotes) <> 'array' or jsonb_array_length(p_quotes) not between 1 and 10 then
    raise exception 'between 1 and 10 quotes are required' using errcode = 'NZ412';
  end if;
  select quote_validity_minutes into v_minutes from public.courier_settings where id;

  for v_quote in select value from jsonb_array_elements(p_quotes)
  loop
    if not exists (select 1 from public.courier_accounts a where a.provider = v_quote ->> 'provider') then
      raise exception 'unknown courier %', v_quote ->> 'provider' using errcode = 'NZ600';
    end if;
    insert into public.courier_quotes (
      order_id, provider, kind, available, unavailable_reason, delivery_charge_minor,
      cod_fee_minor, return_charge_minor, weight_grams, zone, cod_amount_minor, details,
      is_mock, expires_at, quoted_by
    ) values (
      v_order.id,
      v_quote ->> 'provider',
      v_quote ->> 'kind',
      coalesce((v_quote ->> 'available')::boolean, false),
      left(v_quote ->> 'unavailableReason', 200),
      (v_quote ->> 'deliveryChargeMinor')::bigint,
      (v_quote ->> 'codFeeMinor')::bigint,
      (v_quote ->> 'returnChargeMinor')::bigint,
      (v_quote ->> 'weightGrams')::integer,
      coalesce((v_quote ->> 'zone')::public.delivery_zone, v_order.delivery_zone),
      coalesce((v_quote ->> 'codAmountMinor')::bigint, private.order_cod_due(v_order)),
      coalesce(v_quote -> 'details', '{}'::jsonb),
      coalesce((v_quote ->> 'isMock')::boolean, false),
      now() + make_interval(mins => v_minutes),
      v_actor
    )
    returning id into v_id;
    v_ids := v_ids || jsonb_build_object('provider', v_quote ->> 'provider', 'id', v_id);
  end loop;
  return v_ids;
exception
  when invalid_text_representation or check_violation or not_null_violation or numeric_value_out_of_range then
    raise exception 'invalid courier quote' using errcode = 'NZ412';
end;
$$;

/** Delivery outcomes per courier (real shipments only), for the recommendation. */
create function public.admin_courier_provider_stats(p_days integer default 180)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.courier_require_any(array['couriers.read', 'shipments.read']);
begin
  if p_days is null or p_days not between 1 and 3650 then
    raise exception 'days must be between 1 and 3650' using errcode = 'NZ412';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'provider', a.provider,
      'settled', coalesce(x.settled, 0),
      'delivered', coalesce(x.delivered, 0),
      'failed', coalesce(x.failed, 0)
    ) order by a.provider)
    from public.courier_accounts a
    left join (
      select s.provider,
             count(*) filter (where s.status in ('delivered', 'partially_delivered', 'returned', 'delivery_failed')) as settled,
             count(*) filter (where s.status in ('delivered', 'partially_delivered')) as delivered,
             count(*) filter (where s.status in ('returned', 'delivery_failed')) as failed
      from public.shipments s
      where not s.is_mock and s.kind = 'forward'
        and s.created_at >= now() - make_interval(days => p_days)
      group by s.provider
    ) x on x.provider = a.provider
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Booking: begin, finish, resolve
-- ---------------------------------------------------------------------------

/** Shared core of the three begin functions: the idempotent row and the call decision. */
create function private.shipment_begin(
  p_actor uuid,
  p_order public.orders,
  p_kind text,
  p_return_request_id uuid,
  p_parent_shipment_id uuid,
  p_booking_key uuid,
  p_provider text,
  p_quote_id uuid,
  p_weight_grams integer,
  p_cod_amount_minor bigint,
  p_note text,
  p_recommended_provider text,
  p_selection_reason text,
  p_destination jsonb,
  p_is_mock boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.shipments;
  v_quote public.courier_quotes;
  v_reason text := nullif(btrim(coalesce(p_selection_reason, '')), '');
  v_shipment public.shipments;
begin
  if p_booking_key is null then
    raise exception 'a booking key is required' using errcode = 'NZ412';
  end if;

  -- The same key again: the same answer, and never a second provider call.
  select * into v_existing from public.shipments s where s.booking_key = p_booking_key;
  if found then
    if v_existing.order_id <> p_order.id or v_existing.provider <> p_provider or v_existing.kind <> p_kind then
      raise exception 'the booking key belongs to another booking' using errcode = 'NZ412';
    end if;
    return jsonb_build_object('shipment', private.shipment_json(v_existing, false), 'shouldCall', false,
                              'duplicate', true);
  end if;

  if p_is_mock is null or p_weight_grams is null or p_weight_grams not between 1 and 50000
     or p_cod_amount_minor is null or p_cod_amount_minor < 0
     or (p_note is not null and char_length(btrim(p_note)) > 300)
     or not private.courier_destination_ok(coalesce(p_destination, '{}'::jsonb)) then
    raise exception 'invalid shipment details' using errcode = 'NZ412';
  end if;
  perform private.courier_check_provider(p_provider, p_is_mock);

  if p_recommended_provider is not null and p_recommended_provider <> p_provider
     and (v_reason is null or char_length(v_reason) < 3) then
    raise exception 'say why the recommended courier was not chosen' using errcode = 'NZ606';
  end if;

  if p_quote_id is not null then
    select * into v_quote from public.courier_quotes q where q.id = p_quote_id;
    if not found or v_quote.order_id <> p_order.id or v_quote.provider <> p_provider
       or not v_quote.available or v_quote.is_mock <> p_is_mock then
      raise exception 'the quote does not match this booking' using errcode = 'NZ603';
    end if;
    if v_quote.expires_at <= now() then
      raise exception 'the quote has expired; compare couriers again' using errcode = 'NZ603';
    end if;
  end if;

  begin
    insert into public.shipments (
      order_id, kind, return_request_id, parent_shipment_id, provider, status, is_mock,
      booking_key, merchant_ref, weight_grams, cod_amount_minor, delivery_zone, destination,
      note, quote_id, recommended_provider, selection_reason, expected_charge_minor,
      expected_cod_fee_minor, provider_call_started_at, created_by
    ) values (
      p_order.id, p_kind, p_return_request_id, p_parent_shipment_id, p_provider, 'booking_pending',
      p_is_mock, p_booking_key, private.shipment_merchant_ref(p_order, p_kind), p_weight_grams,
      p_cod_amount_minor, p_order.delivery_zone, coalesce(p_destination, '{}'::jsonb),
      nullif(btrim(coalesce(p_note, '')), ''), p_quote_id, p_recommended_provider, v_reason,
      v_quote.delivery_charge_minor, v_quote.cod_fee_minor, now(), p_actor
    )
    returning * into v_shipment;
  exception when unique_violation then
    raise exception 'this order already has an active % shipment', replace(p_kind, '_', ' ')
      using errcode = 'NZ602';
  end;

  perform private.audit(p_actor, 'shipment.booking_started', 'shipment', v_shipment.id::text,
    jsonb_build_object('orderNumber', p_order.order_number, 'kind', p_kind, 'provider', p_provider,
                       'recommendedProvider', p_recommended_provider, 'overridden',
                       p_recommended_provider is not null and p_recommended_provider <> p_provider,
                       'isMock', p_is_mock));
  return jsonb_build_object('shipment', private.shipment_json(v_shipment, false), 'shouldCall', true,
                            'duplicate', false);
end;
$$;

/** Starts booking a forward shipment for a confirmed order. */
create function public.admin_begin_shipment_booking(
  p_order_number text,
  p_booking_key uuid,
  p_provider text,
  p_quote_id uuid,
  p_weight_grams integer,
  p_note text,
  p_recommended_provider text,
  p_selection_reason text,
  p_destination jsonb,
  p_is_mock boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('shipments.create');
  v_order public.orders;
begin
  select * into v_order from public.orders o where o.order_number = p_order_number for update;
  if not found then
    raise exception 'order not found' using errcode = 'NZ404';
  end if;
  if not exists (select 1 from public.shipments s where s.booking_key = p_booking_key)
     and v_order.status not in ('confirmed', 'processing', 'shipped') then
    raise exception 'an order that is % cannot be booked with a courier', v_order.status
      using errcode = 'NZ601';
  end if;
  return private.shipment_begin(
    v_actor, v_order, 'forward', null, null, p_booking_key, p_provider, p_quote_id,
    p_weight_grams, private.order_cod_due(v_order), p_note, p_recommended_provider,
    p_selection_reason, p_destination, p_is_mock
  );
end;
$$;

/** Starts booking a courier pickup of an approved return (no cash is collected). */
create function public.admin_begin_return_pickup(
  p_return_id uuid,
  p_booking_key uuid,
  p_provider text,
  p_weight_grams integer,
  p_note text,
  p_destination jsonb,
  p_is_mock boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('shipments.returns.manage');
  v_return public.return_requests;
  v_order public.orders;
begin
  select * into v_return from public.return_requests r where r.id = p_return_id for update;
  if not found then
    raise exception 'return not found' using errcode = 'NZ404';
  end if;
  if not exists (select 1 from public.shipments s where s.booking_key = p_booking_key)
     and v_return.status <> 'approved' then
    raise exception 'a pickup can be booked only for an approved return' using errcode = 'NZ607';
  end if;
  select * into v_order from public.orders o where o.id = v_return.order_id;
  return private.shipment_begin(
    v_actor, v_order, 'return_pickup', v_return.id, null, p_booking_key, p_provider, null,
    p_weight_grams, 0, p_note, null, null, p_destination, p_is_mock
  );
end;
$$;

/** Starts booking an exchange (replacement) shipment for a return. */
create function public.admin_begin_exchange_shipment(
  p_return_id uuid,
  p_booking_key uuid,
  p_provider text,
  p_weight_grams integer,
  p_cod_amount_minor bigint,
  p_note text,
  p_destination jsonb,
  p_is_mock boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('shipments.returns.manage');
  v_return public.return_requests;
  v_order public.orders;
  v_parent uuid;
begin
  select * into v_return from public.return_requests r where r.id = p_return_id for update;
  if not found then
    raise exception 'return not found' using errcode = 'NZ404';
  end if;
  if not exists (select 1 from public.shipments s where s.booking_key = p_booking_key)
     and v_return.status not in ('approved', 'received', 'completed') then
    raise exception 'an exchange can be shipped only for an approved return' using errcode = 'NZ607';
  end if;
  select * into v_order from public.orders o where o.id = v_return.order_id;
  if p_cod_amount_minor is null or p_cod_amount_minor < 0 or p_cod_amount_minor > v_order.total_minor then
    raise exception 'the exchange cash amount must be between 0 and the order total' using errcode = 'NZ412';
  end if;
  select s.id into v_parent from public.shipments s
  where s.order_id = v_order.id and s.kind = 'forward'
  order by s.created_at desc limit 1;
  return private.shipment_begin(
    v_actor, v_order, 'exchange', v_return.id, v_parent, p_booking_key, p_provider, null,
    p_weight_grams, p_cod_amount_minor, p_note, null, null, p_destination, p_is_mock
  );
end;
$$;

/** The permission a booking of this kind needs. */
create function private.shipment_book_permission(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_kind = 'forward' then 'shipments.create' else 'shipments.returns.manage' end;
$$;

/**
 * The API reports what the provider said: booked (with its consignment id), failed (the
 * provider refused: nothing was created), or uncertain (no clear answer: it may exist).
 */
create function public.admin_finish_shipment_booking(
  p_shipment_id uuid,
  p_outcome text,
  p_consignment_id text,
  p_tracking_code text,
  p_tracking_url text,
  p_provider_status text,
  p_charge_minor bigint,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shipment public.shipments;
  v_actor uuid;
begin
  select * into v_shipment from public.shipments s where s.id = p_shipment_id for update;
  if not found then
    raise exception 'shipment not found' using errcode = 'NZ404';
  end if;
  v_actor := private.require_permission(private.shipment_book_permission(v_shipment.kind));
  if p_outcome not in ('booked', 'failed', 'uncertain') then
    raise exception 'invalid booking outcome' using errcode = 'NZ412';
  end if;
  if v_shipment.status <> 'booking_pending' then
    -- Already settled (a repeat report): answer with the shipment as it is.
    return private.shipment_json(v_shipment, false);
  end if;

  if p_outcome = 'booked' then
    if p_consignment_id is null or char_length(btrim(p_consignment_id)) not between 1 and 80 then
      raise exception 'a booked shipment needs its consignment id' using errcode = 'NZ412';
    end if;
    perform private.shipment_mark_booked(v_shipment, btrim(p_consignment_id), p_tracking_code,
      p_tracking_url, p_provider_status, p_charge_minor, v_actor, 'booking');
  elsif p_outcome = 'failed' then
    update public.shipments
    set booking_uncertain = false, booking_error = left(coalesce(nullif(btrim(coalesce(p_error, '')), ''), 'The courier refused the booking'), 300)
    where id = v_shipment.id;
    perform private.shipment_apply_event(v_shipment.id, 'booking_failed', p_provider_status, 'booking',
      now(), 'booking:' || v_shipment.id::text || ':failed', left(p_error, 300), v_actor);
    perform private.audit(v_actor, 'shipment.booking_failed', 'shipment', v_shipment.id::text,
      jsonb_build_object('provider', v_shipment.provider, 'error', left(p_error, 200)));
  else
    update public.shipments
    set booking_uncertain = true,
        booking_error = left(coalesce(nullif(btrim(coalesce(p_error, '')), ''), 'No clear answer from the courier'), 300)
    where id = v_shipment.id;
    perform private.audit(v_actor, 'shipment.booking_uncertain', 'shipment', v_shipment.id::text,
      jsonb_build_object('provider', v_shipment.provider, 'error', left(p_error, 200)));
  end if;

  select * into v_shipment from public.shipments s where s.id = p_shipment_id;
  return private.shipment_json(v_shipment, false);
end;
$$;

/** Moves a pending booking to booked: identifiers, the booked event, the expected cash. */
create function private.shipment_mark_booked(
  p_shipment public.shipments,
  p_consignment_id text,
  p_tracking_code text,
  p_tracking_url text,
  p_provider_status text,
  p_charge_minor bigint,
  p_actor uuid,
  p_how text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_charge_minor is not null and p_charge_minor < 0 then
    raise exception 'invalid courier charge' using errcode = 'NZ412';
  end if;
  if p_tracking_url is not null and p_tracking_url !~ '^https://[A-Za-z0-9.-]+/' then
    raise exception 'invalid tracking link' using errcode = 'NZ412';
  end if;
  begin
    update public.shipments
    set consignment_id = p_consignment_id,
        tracking_code = nullif(btrim(coalesce(p_tracking_code, '')), ''),
        tracking_url = p_tracking_url,
        expected_charge_minor = coalesce(p_charge_minor, expected_charge_minor),
        booking_uncertain = false,
        booking_error = null,
        booked_at = now(),
        booked_by = p_actor,
        next_sync_at = now() + interval '15 minutes'
    where id = p_shipment.id;
  exception when unique_violation then
    raise exception 'that consignment id is already linked to another shipment' using errcode = 'NZ412';
  end;
  perform private.shipment_apply_event(p_shipment.id, 'booked', p_provider_status, 'booking', now(),
    'booking:' || p_shipment.id::text || ':booked', null, p_actor);
  if p_shipment.cod_amount_minor > 0 then
    insert into public.courier_cod_ledger (shipment_id, order_id, entry_type, amount_minor, dedupe_key, is_mock, created_by, note)
    values (p_shipment.id, p_shipment.order_id, 'cod_expected', p_shipment.cod_amount_minor,
            'cod_expected:' || p_shipment.id::text, p_shipment.is_mock, p_actor, 'Cash the courier should collect')
    on conflict (dedupe_key) do nothing;
  end if;
  perform private.audit(p_actor, 'shipment.booked', 'shipment', p_shipment.id::text,
    jsonb_build_object('provider', p_shipment.provider, 'consignmentId', p_consignment_id,
                       'how', p_how, 'isMock', p_shipment.is_mock));
end;
$$;

/**
 * Settles an uncertain booking after a lookup or a check in the courier's own portal:
 * booked (it exists: give its consignment id) or not created (safe to book again).
 */
create function public.admin_resolve_shipment_booking(
  p_shipment_id uuid,
  p_outcome text,
  p_consignment_id text,
  p_tracking_code text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shipment public.shipments;
  v_actor uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_shipment from public.shipments s where s.id = p_shipment_id for update;
  if not found then
    raise exception 'shipment not found' using errcode = 'NZ404';
  end if;
  v_actor := private.require_permission(private.shipment_book_permission(v_shipment.kind));
  if v_shipment.status <> 'booking_pending'
     or not (v_shipment.booking_uncertain
             or v_shipment.provider_call_started_at < now() - interval '2 minutes') then
    raise exception 'only a booking with no clear answer can be resolved' using errcode = 'NZ605';
  end if;
  if v_note is null or char_length(v_note) < 5 then
    raise exception 'say how the booking was checked' using errcode = 'NZ412';
  end if;

  if p_outcome = 'booked' then
    if p_consignment_id is null or char_length(btrim(p_consignment_id)) not between 1 and 80 then
      raise exception 'a booked shipment needs its consignment id' using errcode = 'NZ412';
    end if;
    perform private.shipment_mark_booked(v_shipment, btrim(p_consignment_id), p_tracking_code,
      null, null, null, v_actor, 'resolved');
  elsif p_outcome = 'not_created' then
    update public.shipments set booking_uncertain = false, booking_error = left(v_note, 300)
    where id = v_shipment.id;
    perform private.shipment_apply_event(v_shipment.id, 'booking_failed', null, 'manual', now(),
      'booking:' || v_shipment.id::text || ':not_created', v_note, v_actor);
  else
    raise exception 'invalid resolution' using errcode = 'NZ412';
  end if;
  perform private.audit(v_actor, 'shipment.booking_resolved', 'shipment', v_shipment.id::text,
    jsonb_build_object('outcome', p_outcome, 'note', left(v_note, 200)));

  select * into v_shipment from public.shipments s where s.id = p_shipment_id;
  return private.shipment_json(v_shipment, false);
end;
$$;

/**
 * What the courier needs to deliver one shipment: the recipient and the address, from the
 * order's own snapshot. Server only (service role): it never reaches a browser.
 */
create function public.service_shipment_booking_payload(p_shipment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'shipmentId', s.id,
    'merchantRef', s.merchant_ref,
    'kind', s.kind,
    'provider', s.provider,
    'isMock', s.is_mock,
    'codAmountMinor', s.cod_amount_minor,
    'weightGrams', s.weight_grams,
    'deliveryZone', s.delivery_zone,
    'destination', s.destination,
    'note', s.note,
    'itemCount', o.item_count,
    'recipientName', o.ship_recipient_name,
    'recipientPhone', o.ship_phone,
    'addressLine', o.ship_address_line,
    'area', o.ship_area,
    'district', o.ship_district,
    'division', o.ship_division,
    'postalCode', o.ship_postal_code,
    'landmark', o.ship_landmark,
    'providerSettings', a.settings
  )
  from public.shipments s
  join public.orders o on o.id = s.order_id
  join public.courier_accounts a on a.provider = s.provider
  where s.id = p_shipment_id;
$$;

-- ---------------------------------------------------------------------------
-- 12. Tracking: events from staff, webhooks and polling; cancellation
-- ---------------------------------------------------------------------------

/**
 * Staff record a courier status: from a manual refresh (`poll`) or by hand (`manual`, a
 * note is required, for a courier without an API).
 */
create function public.admin_record_shipment_event(
  p_shipment_id uuid,
  p_status public.shipment_status,
  p_provider_status text,
  p_occurred_at timestamptz,
  p_dedupe_key text,
  p_source text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('shipments.track');
  v_result record;
begin
  if p_source not in ('poll', 'manual') then
    raise exception 'invalid event source' using errcode = 'NZ412';
  end if;
  if p_source = 'manual' and char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'say where this status comes from' using errcode = 'NZ412';
  end if;
  if p_status in ('draft', 'quoted', 'booking_pending', 'booking_failed', 'booked') then
    raise exception 'booking statuses are set by the booking itself' using errcode = 'NZ604';
  end if;
  select * into v_result from private.shipment_apply_event(p_shipment_id, p_status, p_provider_status,
    p_source, p_occurred_at, p_dedupe_key, p_note, v_actor);
  if p_source = 'manual' then
    perform private.audit(v_actor, 'shipment.status_recorded', 'shipment', p_shipment_id::text,
      jsonb_build_object('status', p_status, 'applied', v_result.applied, 'note', left(p_note, 200)));
  end if;
  return jsonb_build_object('eventId', v_result.event_id, 'applied', v_result.applied,
                            'duplicate', v_result.duplicate);
end;
$$;

/** The same, for the webhook processor and the sync worker (service role only). */
create function public.service_record_shipment_event(
  p_shipment_id uuid,
  p_status public.shipment_status,
  p_provider_status text,
  p_occurred_at timestamptz,
  p_dedupe_key text,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result record;
begin
  if p_source not in ('webhook', 'poll') then
    raise exception 'invalid event source' using errcode = 'NZ412';
  end if;
  if p_status in ('draft', 'quoted', 'booking_pending', 'booking_failed', 'booked') then
    raise exception 'booking statuses are set by the booking itself' using errcode = 'NZ604';
  end if;
  select * into v_result from private.shipment_apply_event(p_shipment_id, p_status, p_provider_status,
    p_source, p_occurred_at, p_dedupe_key, null, null);
  return jsonb_build_object('eventId', v_result.event_id, 'applied', v_result.applied,
                            'duplicate', v_result.duplicate);
end;
$$;

/**
 * Cancels a shipment before pickup: either the courier's API confirmed it, or staff confirm
 * they cancelled it in the courier's portal. A booking that never reached the courier
 * (pending, not uncertain, the call never made) can be cancelled outright.
 */
create function public.admin_cancel_shipment(
  p_shipment_id uuid,
  p_reason text,
  p_provider_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('shipments.cancel');
  v_shipment public.shipments;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_result record;
begin
  if v_reason is null or char_length(v_reason) not between 3 and 300 then
    raise exception 'a reason of 3-300 characters is required' using errcode = 'NZ412';
  end if;
  select * into v_shipment from public.shipments s where s.id = p_shipment_id for update;
  if not found then
    raise exception 'shipment not found' using errcode = 'NZ404';
  end if;
  if v_shipment.status not in ('booking_pending', 'booked', 'pickup_pending') then
    raise exception 'a shipment that is % cannot be cancelled here', v_shipment.status
      using errcode = 'NZ610';
  end if;
  if v_shipment.status = 'booking_pending' and v_shipment.booking_uncertain then
    raise exception 'resolve the uncertain booking first' using errcode = 'NZ605';
  end if;
  if v_shipment.status <> 'booking_pending' and not coalesce(p_provider_confirmed, false) then
    raise exception 'cancel it with the courier first' using errcode = 'NZ610';
  end if;

  update public.shipments set cancel_reason = v_reason where id = v_shipment.id;
  select * into v_result from private.shipment_apply_event(v_shipment.id, 'cancelled', null, 'manual', now(),
    'cancel:' || v_shipment.id::text, v_reason, v_actor);
  perform private.audit(v_actor, 'shipment.cancelled', 'shipment', v_shipment.id::text,
    jsonb_build_object('provider', v_shipment.provider, 'reason', left(v_reason, 200),
                       'providerConfirmed', coalesce(p_provider_confirmed, false)));
  select * into v_shipment from public.shipments s where s.id = p_shipment_id;
  return private.shipment_json(v_shipment, false);
end;
$$;

/** Shipments due for a tracking sync, leased so two workers never take the same one. */
create function public.service_claim_shipment_sync(p_limit integer default 20, p_lease_seconds integer default 120)
returns table (
  id uuid, provider text, status public.shipment_status, consignment_id text,
  tracking_code text, merchant_ref text, is_mock boolean, sync_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit not between 1 and 100
     or p_lease_seconds is null or p_lease_seconds not between 10 and 3600 then
    raise exception 'limit must be 1-100 and lease 10-3600 seconds' using errcode = 'NZ412';
  end if;
  return query
  with due as (
    select s.id
    from public.shipments s
    where s.next_sync_at is not null and s.next_sync_at <= now()
      and s.consignment_id is not null
      and s.status not in ('delivered', 'returned', 'cancelled', 'booking_failed', 'booking_pending')
    order by s.next_sync_at, s.id
    limit p_limit
    for update of s skip locked
  )
  update public.shipments s
  set next_sync_at = now() + make_interval(secs => p_lease_seconds)
  from due
  where s.id = due.id
  returning s.id, s.provider, s.status, s.consignment_id, s.tracking_code, s.merchant_ref,
            s.is_mock, s.sync_attempts;
end;
$$;

/** Records a sync attempt and schedules the next one (with backoff after failures). */
create function public.service_finish_shipment_sync(
  p_shipment_id uuid,
  p_ok boolean,
  p_error text,
  p_next_in_seconds integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_next_in_seconds is null or p_next_in_seconds not between 30 and 604800 then
    raise exception 'next sync must be 30 seconds to 7 days away' using errcode = 'NZ412';
  end if;
  update public.shipments s
  set sync_attempts = case when p_ok then 0 else s.sync_attempts + 1 end,
      sync_error = case when p_ok then null else left(coalesce(p_error, 'sync failed'), 300) end,
      next_sync_at = case when s.status in ('delivered', 'returned', 'cancelled', 'booking_failed') then null
                          else now() + make_interval(secs => p_next_in_seconds) end
  where s.id = p_shipment_id;
end;
$$;

/** Staff ask for a sync now (the worker picks it up on its next round). */
create function public.admin_request_shipment_sync(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('shipments.track');
begin
  update public.shipments s
  set next_sync_at = now()
  where s.id = p_shipment_id
    and s.status not in ('delivered', 'returned', 'cancelled', 'booking_failed', 'booking_pending');
  if not found then
    raise exception 'this shipment has nothing to sync' using errcode = 'NZ604';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Webhook intake (service role only)
-- ---------------------------------------------------------------------------

/** Stores one incoming courier webhook once; a repeat (same key) is reported, not stored. */
create function public.service_store_courier_webhook(
  p_provider text,
  p_dedupe_key text,
  p_event_type text,
  p_consignment_id text,
  p_merchant_ref text,
  p_signature_ok boolean,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_signature_ok is null or p_dedupe_key is null then
    raise exception 'invalid webhook record' using errcode = 'NZ412';
  end if;
  insert into public.courier_webhook_events (
    provider, dedupe_key, event_type, consignment_id, merchant_ref, signature_ok, payload,
    status
  ) values (
    p_provider, left(p_dedupe_key, 200), left(p_event_type, 80), left(p_consignment_id, 80),
    left(p_merchant_ref, 40), p_signature_ok, coalesce(p_payload, '{}'::jsonb),
    case when p_signature_ok then 'pending' else 'ignored' end
  )
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  if v_id is null then
    select w.id into v_id from public.courier_webhook_events w where w.dedupe_key = left(p_dedupe_key, 200);
    return jsonb_build_object('id', v_id, 'duplicate', true);
  end if;
  return jsonb_build_object('id', v_id, 'duplicate', false);
end;
$$;

/** The shipment a webhook names, by consignment id or by Nilzora's own reference. */
create function public.service_find_shipment(p_provider text, p_consignment_id text, p_merchant_ref text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.shipments s
  where s.provider = p_provider
    and ((p_consignment_id is not null and s.consignment_id = p_consignment_id)
         or (p_merchant_ref is not null and s.merchant_ref = p_merchant_ref))
  order by (s.consignment_id = p_consignment_id) desc nulls last
  limit 1;
$$;

create function public.service_finish_courier_webhook(
  p_id uuid,
  p_status text,
  p_error text,
  p_shipment_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('processed', 'ignored', 'failed') then
    raise exception 'invalid webhook status' using errcode = 'NZ412';
  end if;
  update public.courier_webhook_events w
  set status = p_status,
      attempts = w.attempts + 1,
      last_error = case when p_status = 'failed' then left(coalesce(p_error, 'processing failed'), 300) else null end,
      -- Failed events are retried with a growing delay, five times at most.
      next_attempt_at = case when p_status = 'failed' and w.attempts + 1 < 5
                             then now() + make_interval(secs => 60 * power(2, w.attempts)::integer)
                             else null end,
      processed_at = case when p_status <> 'failed' then now() else w.processed_at end,
      shipment_id = coalesce(p_shipment_id, w.shipment_id)
  where w.id = p_id;
end;
$$;

/** Failed webhook events whose retry time has come. */
create function public.service_claim_courier_webhook_retries(p_limit integer default 20)
returns table (id uuid, provider text, event_type text, consignment_id text, merchant_ref text, payload jsonb, attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'limit must be 1-100' using errcode = 'NZ412';
  end if;
  return query
  with due as (
    select w.id from public.courier_webhook_events w
    where w.status = 'failed' and w.next_attempt_at is not null and w.next_attempt_at <= now()
    order by w.next_attempt_at, w.id
    limit p_limit
    for update of w skip locked
  )
  update public.courier_webhook_events w
  set next_attempt_at = now() + interval '5 minutes'
  from due
  where w.id = due.id
  returning w.id, w.provider, w.event_type, w.consignment_id, w.merchant_ref, w.payload, w.attempts;
end;
$$;

-- ---------------------------------------------------------------------------
-- 14. Reading shipments (staff)
-- ---------------------------------------------------------------------------

create function public.admin_list_shipments(
  p_status public.shipment_status,
  p_provider text,
  p_kind text,
  p_query text,
  p_from timestamptz,
  p_to timestamptz,
  p_include_mock boolean,
  p_limit integer,
  p_offset integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('shipments.read');
  v_costs boolean := private.has_permission('couriers.cod.read');
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset < 0 then
    raise exception 'invalid page' using errcode = 'NZ412';
  end if;
  return (
    with matching as (
      select s.id, s.created_at
      from public.shipments s
      join public.orders o on o.id = s.order_id
      where (p_status is null or s.status = p_status)
        and (p_provider is null or s.provider = p_provider)
        and (p_kind is null or s.kind = p_kind)
        and (coalesce(p_include_mock, false) or not s.is_mock)
        and (p_from is null or s.created_at >= p_from)
        and (p_to is null or s.created_at < p_to)
        and (v_q is null
             or o.order_number ilike v_q || '%'
             or s.consignment_id = v_q
             or s.tracking_code = v_q
             or s.merchant_ref ilike v_q || '%')
    )
    select jsonb_build_object(
      'total', (select count(*) from matching),
      'shipments', coalesce((
        select jsonb_agg(private.shipment_json(s, v_costs) order by page.created_at desc, page.id)
        from (
          select m.id, m.created_at
          from matching m
          order by m.created_at desc, m.id
          limit p_limit offset p_offset
        ) page
        join public.shipments s on s.id = page.id
      ), '[]'::jsonb)
    )
  );
end;
$$;

create function public.admin_get_shipment(p_shipment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('shipments.read');
  v_costs boolean := private.has_permission('couriers.cod.read');
  v_shipment public.shipments;
begin
  select * into v_shipment from public.shipments s where s.id = p_shipment_id;
  if not found then
    raise exception 'shipment not found' using errcode = 'NZ404';
  end if;
  return jsonb_build_object(
    'shipment', private.shipment_json(v_shipment, v_costs),
    'events', private.shipment_events_json(v_shipment.id),
    'ledger', case when v_costs then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'entryType', l.entry_type, 'amountMinor', l.amount_minor,
        'settlementId', l.settlement_id, 'evidenceRef', l.evidence_ref, 'isMock', l.is_mock,
        'note', l.note, 'createdAt', l.created_at
      ) order by l.id)
      from public.courier_cod_ledger l where l.shipment_id = v_shipment.id
    ), '[]'::jsonb) end,
    'codPosition', case when v_costs then private.shipment_cod_position(v_shipment) end
  );
end;
$$;

create function public.admin_courier_overview(p_include_mock boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.courier_require_any(array['couriers.read', 'shipments.read']);
  v_costs boolean := private.has_permission('couriers.cod.read');
begin
  return (
    select jsonb_build_object(
      'total', count(*),
      'bookingPending', count(*) filter (where s.status = 'booking_pending'),
      'uncertain', count(*) filter (where s.status = 'booking_pending' and s.booking_uncertain),
      'pendingPickup', count(*) filter (where s.status in ('booked', 'pickup_pending')),
      'inTransit', count(*) filter (where s.status in ('picked_up', 'in_transit', 'on_hold', 'out_for_delivery')),
      'delivered', count(*) filter (where s.status in ('delivered', 'partially_delivered')),
      'failed', count(*) filter (where s.status in ('delivery_failed', 'booking_failed')),
      'returned', count(*) filter (where s.status in ('return_initiated', 'returned')),
      'cancelled', count(*) filter (where s.status = 'cancelled'),
      'syncErrors', count(*) filter (where s.sync_error is not null),
      'codAwaitingSettlementMinor', case when v_costs then coalesce((
        select sum(greatest(p.expected_settlement_minor - p.settled_minor, 0))
        from public.shipments s2
        cross join lateral private.shipment_cod_numbers(s2.id) p
        where (coalesce(p_include_mock, false) or not s2.is_mock)
          and s2.cod_state <> 'reconciled'
      ), 0) end,
      'includesMock', coalesce(p_include_mock, false)
    )
    from public.shipments s
    where coalesce(p_include_mock, false) or not s.is_mock
  );
end;
$$;

create function public.admin_order_shipments(p_order_number text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('shipments.read');
  v_costs boolean := private.has_permission('couriers.cod.read');
  v_order_id uuid;
begin
  select o.id into v_order_id from public.orders o where o.order_number = p_order_number;
  if v_order_id is null then
    raise exception 'order not found' using errcode = 'NZ404';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'shipment', private.shipment_json(s, v_costs),
      'events', private.shipment_events_json(s.id)
    ) order by s.created_at desc)
    from public.shipments s where s.order_id = v_order_id
  ), '[]'::jsonb);
end;
$$;

create function public.admin_return_shipments(p_return_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.courier_require_any(array['shipments.read', 'shipments.returns.manage']);
  v_costs boolean := private.has_permission('couriers.cod.read');
begin
  if not exists (select 1 from public.return_requests r where r.id = p_return_id) then
    raise exception 'return not found' using errcode = 'NZ404';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'shipment', private.shipment_json(s, v_costs),
      'events', private.shipment_events_json(s.id)
    ) order by s.created_at desc)
    from public.shipments s where s.return_request_id = p_return_id
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 15. Cash on delivery positions, settlements and reconciliation
-- ---------------------------------------------------------------------------

/** The money of one shipment, from its ledger. */
create function private.shipment_cod_numbers(p_shipment_id uuid)
returns table (
  expected_minor bigint, collected_minor bigint, deductions_minor bigint,
  adjustments_minor bigint, settled_minor bigint, expected_settlement_minor bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(l.amount_minor) filter (where l.entry_type = 'cod_expected'), 0)::bigint,
    coalesce(sum(l.amount_minor) filter (where l.entry_type = 'cod_collected'), 0)::bigint,
    coalesce(sum(l.amount_minor) filter (where l.entry_type in ('delivery_charge', 'cod_fee', 'return_charge', 'other_deduction')), 0)::bigint,
    coalesce(sum(l.amount_minor) filter (where l.entry_type = 'adjustment'), 0)::bigint,
    coalesce(sum(l.amount_minor) filter (where l.entry_type = 'settlement'), 0)::bigint,
    (coalesce(sum(l.amount_minor) filter (where l.entry_type = 'cod_collected'), 0)
      - coalesce(sum(l.amount_minor) filter (where l.entry_type in ('delivery_charge', 'cod_fee', 'return_charge', 'other_deduction')), 0)
      + coalesce(sum(l.amount_minor) filter (where l.entry_type = 'adjustment'), 0))::bigint
  from public.courier_cod_ledger l
  where l.shipment_id = p_shipment_id;
$$;

/** One shipment's COD position and its derived status. */
create function private.shipment_cod_position(p_shipment public.shipments)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'expectedMinor', n.expected_minor,
    'collectedMinor', n.collected_minor,
    'deductionsMinor', n.deductions_minor,
    'adjustmentsMinor', n.adjustments_minor,
    'expectedSettlementMinor', n.expected_settlement_minor,
    'settledMinor', n.settled_minor,
    'differenceMinor', n.settled_minor - n.expected_settlement_minor,
    'status', case
      when p_shipment.cod_state = 'reconciled' then 'reconciled'
      when p_shipment.cod_state = 'disputed' then 'disputed'
      when n.settled_minor > 0 and n.settled_minor >= n.expected_settlement_minor then 'settled'
      when n.settled_minor > 0 then 'partially_settled'
      when n.collected_minor > 0 then 'collected'
      else 'pending'
    end,
    'codState', p_shipment.cod_state
  )
  from private.shipment_cod_numbers(p_shipment.id) n;
$$;

create function public.admin_cod_positions(
  p_provider text,
  p_status text,
  p_include_mock boolean,
  p_limit integer,
  p_offset integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('couriers.cod.read');
begin
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset < 0 then
    raise exception 'invalid page' using errcode = 'NZ412';
  end if;
  if p_status is not null and p_status not in ('pending', 'collected', 'partially_settled', 'settled', 'disputed', 'reconciled') then
    raise exception 'invalid COD status' using errcode = 'NZ412';
  end if;
  return (
    with rows as (
      select s, o.order_number, o.payment_status, private.shipment_cod_position(s) as position
      from public.shipments s
      join public.orders o on o.id = s.order_id
      where s.cod_amount_minor > 0
        and s.status not in ('booking_pending', 'booking_failed')
        and (p_provider is null or s.provider = p_provider)
        and (coalesce(p_include_mock, false) or not s.is_mock)
    ),
    filtered as (
      select * from rows r where p_status is null or r.position ->> 'status' = p_status
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'totals', (
        select jsonb_build_object(
          'expectedMinor', coalesce(sum((f.position ->> 'expectedMinor')::bigint), 0),
          'collectedMinor', coalesce(sum((f.position ->> 'collectedMinor')::bigint), 0),
          'deductionsMinor', coalesce(sum((f.position ->> 'deductionsMinor')::bigint), 0),
          'expectedSettlementMinor', coalesce(sum((f.position ->> 'expectedSettlementMinor')::bigint), 0),
          'settledMinor', coalesce(sum((f.position ->> 'settledMinor')::bigint), 0)
        ) from filtered f
      ),
      'positions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'shipmentId', (p.s).id,
          'orderNumber', p.order_number,
          'orderPaymentStatus', p.payment_status,
          'provider', (p.s).provider,
          'status', (p.s).status,
          'consignmentId', (p.s).consignment_id,
          'isMock', (p.s).is_mock,
          'deliveredAt', (p.s).delivered_at,
          'position', p.position
        ) order by (p.s).created_at desc)
        from (select * from filtered order by (s).created_at desc limit p_limit offset p_offset) p
      ), '[]'::jsonb)
    )
  );
end;
$$;

/** The cash the courier says it collected for one shipment (from its report or invoice). */
create function public.admin_record_cod_collected(
  p_shipment_id uuid,
  p_amount_minor bigint,
  p_evidence_ref text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('couriers.cod.reconcile');
  v_shipment public.shipments;
begin
  select * into v_shipment from public.shipments s where s.id = p_shipment_id for update;
  if not found then
    raise exception 'shipment not found' using errcode = 'NZ404';
  end if;
  if p_amount_minor is null or p_amount_minor < 0 or p_amount_minor > v_shipment.cod_amount_minor then
    raise exception 'the collected amount must be between 0 and the COD amount' using errcode = 'NZ608';
  end if;
  if nullif(btrim(coalesce(p_evidence_ref, '')), '') is null then
    raise exception 'give the courier report or invoice reference' using errcode = 'NZ608';
  end if;
  insert into public.courier_cod_ledger (shipment_id, order_id, entry_type, amount_minor, evidence_ref, is_mock, note, created_by, dedupe_key)
  values (v_shipment.id, v_shipment.order_id, 'cod_collected', p_amount_minor, btrim(p_evidence_ref),
          v_shipment.is_mock, left(nullif(btrim(coalesce(p_note, '')), ''), 300), v_actor,
          'cod_collected:' || v_shipment.id::text || ':' || btrim(p_evidence_ref))
  on conflict (dedupe_key) do nothing;
  if not found then
    raise exception 'this collection was already recorded' using errcode = 'NZ608';
  end if;
  perform private.audit(v_actor, 'courier.cod_collected_recorded', 'shipment', v_shipment.id::text,
    jsonb_build_object('amountMinor', p_amount_minor, 'evidenceRef', left(p_evidence_ref, 80)));
end;
$$;

/**
 * Records one courier payout and how it splits over shipments. The items must add up to
 * the payout, every shipment must belong to that courier, and the same reference is
 * accepted once. Each item writes ledger rows (settlement, and the deductions shown on the
 * courier's statement).
 */
create function public.admin_record_courier_settlement(
  p_provider text,
  p_reference text,
  p_amount_minor bigint,
  p_received_on date,
  p_note text,
  p_items jsonb,
  p_is_mock boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('couriers.cod.reconcile');
  v_ref text := nullif(btrim(coalesce(p_reference, '')), '');
  v_id uuid;
  v_item jsonb;
  v_shipment public.shipments;
  v_sum bigint := 0;
  v_part bigint;
  v_type text;
begin
  if v_ref is null or char_length(v_ref) not between 2 and 80 or p_amount_minor is null or p_amount_minor < 0
     or p_received_on is null or p_received_on > current_date + 1 or p_is_mock is null then
    raise exception 'give the payout reference, amount and date' using errcode = 'NZ608';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 500 then
    raise exception 'a settlement needs 1-500 shipments' using errcode = 'NZ608';
  end if;
  if not exists (select 1 from public.courier_accounts a where a.provider = p_provider) then
    raise exception 'unknown courier %', p_provider using errcode = 'NZ600';
  end if;

  begin
    insert into public.courier_settlements (provider, reference, amount_minor, received_on, note, is_mock, created_by)
    values (p_provider, v_ref, p_amount_minor, p_received_on, left(nullif(btrim(coalesce(p_note, '')), ''), 300), p_is_mock, v_actor)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'this payout reference was already recorded' using errcode = 'NZ608';
  end;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    select * into v_shipment from public.shipments s where s.id = (v_item ->> 'shipmentId')::uuid for update;
    if not found or v_shipment.provider <> p_provider or v_shipment.is_mock <> p_is_mock then
      raise exception 'a settlement line names a shipment of another courier' using errcode = 'NZ608';
    end if;
    foreach v_type in array array['settlement', 'delivery_charge', 'cod_fee', 'return_charge', 'other_deduction']
    loop
      v_part := (v_item ->> case v_type
        when 'settlement' then 'settledMinor'
        when 'delivery_charge' then 'deliveryChargeMinor'
        when 'cod_fee' then 'codFeeMinor'
        when 'return_charge' then 'returnChargeMinor'
        else 'otherDeductionMinor' end)::bigint;
      if v_part is not null then
        if v_part < 0 then
          raise exception 'settlement amounts cannot be negative' using errcode = 'NZ608';
        end if;
        if v_part > 0 or v_type = 'settlement' then
          insert into public.courier_cod_ledger (shipment_id, order_id, entry_type, amount_minor, settlement_id, evidence_ref, is_mock, created_by)
          values (v_shipment.id, v_shipment.order_id, v_type, v_part, v_id, v_ref, v_shipment.is_mock, v_actor);
        end if;
        if v_type = 'settlement' then
          v_sum := v_sum + v_part;
        end if;
      elsif v_type = 'settlement' then
        raise exception 'each line needs its settled amount' using errcode = 'NZ608';
      end if;
    end loop;
  end loop;

  if v_sum <> p_amount_minor then
    raise exception 'the lines add up to % but the payout is %', v_sum, p_amount_minor using errcode = 'NZ608';
  end if;
  perform private.audit(v_actor, 'courier.settlement_recorded', 'courier_settlement', v_id::text,
    jsonb_build_object('provider', p_provider, 'reference', v_ref, 'amountMinor', p_amount_minor,
                       'lines', jsonb_array_length(p_items), 'isMock', p_is_mock));
  return v_id;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid settlement line' using errcode = 'NZ608';
end;
$$;

/** A signed correction with a reason (a courier credit, a write-off agreed in writing). */
create function public.admin_record_cod_adjustment(p_shipment_id uuid, p_amount_minor bigint, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('couriers.cod.reconcile');
  v_shipment public.shipments;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_shipment from public.shipments s where s.id = p_shipment_id for update;
  if not found then
    raise exception 'shipment not found' using errcode = 'NZ404';
  end if;
  if p_amount_minor is null or p_amount_minor = 0 or abs(p_amount_minor) > 100000000
     or v_note is null or char_length(v_note) < 5 then
    raise exception 'an adjustment needs a non-zero amount and a reason' using errcode = 'NZ608';
  end if;
  insert into public.courier_cod_ledger (shipment_id, order_id, entry_type, amount_minor, is_mock, note, created_by)
  values (v_shipment.id, v_shipment.order_id, 'adjustment', p_amount_minor, v_shipment.is_mock, left(v_note, 300), v_actor);
  perform private.audit(v_actor, 'courier.cod_adjusted', 'shipment', v_shipment.id::text,
    jsonb_build_object('amountMinor', p_amount_minor, 'note', left(v_note, 200)));
end;
$$;

/** Marks a shipment's COD as disputed, reconciled (closed) or open again. */
create function public.admin_set_cod_state(p_shipment_id uuid, p_state text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('couriers.cod.reconcile');
  v_shipment public.shipments;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_position jsonb;
begin
  if p_state not in ('open', 'disputed', 'reconciled') then
    raise exception 'invalid COD state' using errcode = 'NZ412';
  end if;
  select * into v_shipment from public.shipments s where s.id = p_shipment_id for update;
  if not found then
    raise exception 'shipment not found' using errcode = 'NZ404';
  end if;
  v_position := private.shipment_cod_position(v_shipment);
  if p_state = 'disputed' and (v_note is null or char_length(v_note) < 5) then
    raise exception 'say what is disputed' using errcode = 'NZ412';
  end if;
  if p_state = 'reconciled' and (v_position ->> 'differenceMinor')::bigint <> 0
     and (v_note is null or char_length(v_note) < 5) then
    raise exception 'the amounts differ: give the reason to close it anyway' using errcode = 'NZ608';
  end if;
  update public.shipments set cod_state = p_state where id = v_shipment.id;
  perform private.audit(v_actor, 'courier.cod_state_changed', 'shipment', v_shipment.id::text,
    jsonb_build_object('from', v_shipment.cod_state, 'to', p_state,
                       'differenceMinor', (v_position ->> 'differenceMinor')::bigint,
                       'note', left(v_note, 200)));
end;
$$;

create function public.admin_list_courier_settlements(p_provider text, p_include_mock boolean, p_limit integer, p_offset integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('couriers.cod.read');
begin
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset < 0 then
    raise exception 'invalid page' using errcode = 'NZ412';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.courier_settlements c
              where (p_provider is null or c.provider = p_provider) and (coalesce(p_include_mock, false) or not c.is_mock)),
    'settlements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'provider', c.provider, 'reference', c.reference, 'amountMinor', c.amount_minor,
        'receivedOn', c.received_on, 'note', c.note, 'isMock', c.is_mock, 'createdAt', c.created_at,
        'lines', (select count(distinct l.shipment_id) from public.courier_cod_ledger l where l.settlement_id = c.id)
      ) order by c.received_on desc, c.created_at desc)
      from (
        select * from public.courier_settlements c
        where (p_provider is null or c.provider = p_provider) and (coalesce(p_include_mock, false) or not c.is_mock)
        order by c.received_on desc, c.created_at desc
        limit p_limit offset p_offset
      ) c
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 16. Customers: their own shipments
-- ---------------------------------------------------------------------------

/**
 * The customer's view of an order's shipments: courier, tracking code, status and the
 * applied timeline. Only shipments a courier accepted are shown; never costs, cash
 * settlement, raw courier data or internal notes.
 */
create function public.my_order_shipments(p_order_number text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_order public.orders;
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  select * into v_order from public.orders o where o.order_number = p_order_number and o.user_id = v_user;
  if not found then
    raise exception 'order not found' using errcode = 'NZ404';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id,
      'kind', s.kind,
      'returnRequestId', s.return_request_id,
      'providerName', a.display_name,
      'status', s.status,
      'trackingCode', s.tracking_code,
      'trackingUrl', s.tracking_url,
      'isTest', s.is_mock,
      'bookedAt', s.booked_at,
      'deliveredAt', s.delivered_at,
      'events', coalesce((
        select jsonb_agg(jsonb_build_object('status', e.status, 'occurredAt', e.occurred_at)
                         order by e.occurred_at, e.id)
        from public.shipment_events e
        where e.shipment_id = s.id and e.applied
      ), '[]'::jsonb)
    ) order by s.created_at desc)
    from public.shipments s
    join public.courier_accounts a on a.provider = s.provider
    where s.order_id = v_order.id
      and s.status not in ('draft', 'quoted', 'booking_pending', 'booking_failed')
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 17. Notifications: in-app (shipment_update) and push (outbox kind 'shipment')
-- ---------------------------------------------------------------------------

alter table public.notification_outbox
  add column kind text not null default 'order_status',
  add column shipment_event_id bigint unique references public.shipment_events (id) on delete cascade,
  add column shipment_status public.shipment_status;

alter table public.notification_outbox
  alter column to_status drop not null,
  alter column history_id drop not null;

alter table public.notification_outbox
  add constraint notification_outbox_kind_shape check (
    (kind = 'order_status' and to_status is not null and history_id is not null
       and shipment_event_id is null and shipment_status is null)
    or (kind = 'shipment' and shipment_event_id is not null and shipment_status is not null
       and to_status is null and history_id is null)
  );

-- notify_customer learns the new kind; it follows the "order updates" preference.
create or replace function private.notify_customer(
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
security definer
set search_path = ''
as $$
declare
  v_allow boolean;
begin
  if p_user is null then
    return;
  end if;

  select case p_kind
           when 'order_update' then coalesce(pref.in_app, true) and coalesce(pref.order_updates, true)
           when 'payment_update' then coalesce(pref.in_app, true) and coalesce(pref.payment_updates, true)
           when 'return_update' then coalesce(pref.in_app, true) and coalesce(pref.return_updates, true)
           when 'refund_update' then coalesce(pref.in_app, true) and coalesce(pref.refund_updates, true)
           when 'shipment_update' then coalesce(pref.in_app, true) and coalesce(pref.order_updates, true)
         end
    into v_allow
    from (select 1) one
    left join public.notification_preferences pref on pref.user_id = p_user;

  if not coalesce(v_allow, true) then
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

/**
 * A shipment event the customer should hear about: once per applied status change, in the
 * inbox and on the phone. Repeated or older courier events are not applied, so they notify
 * nobody. No address, phone or amount is ever in the text.
 */
create function private.notify_shipment_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shipment public.shipments;
  v_order public.orders;
  v_courier text;
  v_title text;
  v_body text;
begin
  if not new.applied
     or new.status not in ('booked', 'picked_up', 'out_for_delivery', 'delivered', 'partially_delivered',
                           'delivery_failed', 'return_initiated', 'returned', 'cancelled') then
    return null;
  end if;
  select * into v_shipment from public.shipments s where s.id = new.shipment_id;
  select * into v_order from public.orders o where o.id = v_shipment.order_id;
  if v_order.id is null then
    return null;
  end if;
  select a.display_name into v_courier from public.courier_accounts a where a.provider = v_shipment.provider;

  if v_shipment.kind = 'return_pickup' then
    if new.status not in ('booked', 'picked_up', 'delivered', 'cancelled') then
      return null;
    end if;
    v_title := case new.status
      when 'booked' then 'Return pickup booked'
      when 'picked_up' then 'Return picked up'
      when 'delivered' then 'Return received by the store'
      else 'Return pickup cancelled'
    end;
    v_body := case new.status
      when 'booked' then v_courier || ' will collect the items you are returning from order ' || v_order.order_number || '.'
      when 'picked_up' then v_courier || ' has collected the items you are returning from order ' || v_order.order_number || '.'
      when 'delivered' then 'The items you returned from order ' || v_order.order_number || ' have reached the store.'
      else 'The return pickup for order ' || v_order.order_number || ' has been cancelled.'
    end;
  else
    v_title := case new.status
      when 'booked' then case when v_shipment.kind = 'exchange' then 'Exchange shipment booked' else 'Shipment booked' end
      when 'picked_up' then 'Parcel picked up'
      when 'out_for_delivery' then 'Out for delivery'
      when 'delivered' then 'Parcel delivered'
      when 'partially_delivered' then 'Parcel partly delivered'
      when 'delivery_failed' then 'Delivery attempt failed'
      when 'return_initiated' then 'Parcel being returned'
      when 'returned' then 'Parcel returned to the store'
      else 'Shipment cancelled'
    end;
    v_body := case new.status
      when 'booked' then 'Order ' || v_order.order_number || ' has been booked with ' || v_courier
        || coalesce('. Tracking code: ' || v_shipment.tracking_code, '') || '.'
      when 'picked_up' then v_courier || ' has picked up order ' || v_order.order_number || '.'
      when 'out_for_delivery' then 'Order ' || v_order.order_number || ' is out for delivery with ' || v_courier || '.'
      when 'delivered' then v_courier || ' has delivered order ' || v_order.order_number || '.'
      when 'partially_delivered' then 'Part of order ' || v_order.order_number || ' was delivered.'
      when 'delivery_failed' then v_courier || ' could not deliver order ' || v_order.order_number || '. They will contact you or try again.'
      when 'return_initiated' then 'Order ' || v_order.order_number || ' is being returned to the store.'
      when 'returned' then 'Order ' || v_order.order_number || ' has come back to the store.'
      else 'The shipment for order ' || v_order.order_number || ' has been cancelled.'
    end;
  end if;

  perform private.notify_customer(
    v_order.user_id, 'shipment_update', v_title, v_body, 'order', v_order.id::text,
    '/account/orders/' || v_order.order_number, 'shipment_event:' || new.id::text
  );
  insert into public.notification_outbox (user_id, order_id, order_number, kind, shipment_event_id, shipment_status)
  values (v_order.user_id, v_order.id, v_order.order_number, 'shipment', new.id, new.status)
  on conflict (shipment_event_id) do nothing;
  return null;
end;
$$;

create trigger shipment_events_notify
  after insert on public.shipment_events
  for each row execute function private.notify_shipment_event();

-- The claim now also says which kind of row it is, and the shipment status for shipment
-- rows. Order rows are returned exactly as before.
drop function public.claim_notifications(integer, integer);

create function public.claim_notifications(p_limit integer default 20, p_lease_seconds integer default 60)
returns table (
  id uuid, user_id uuid, order_number text, to_status public.order_status, attempts integer,
  kind text, shipment_status public.shipment_status
)
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
    returning o.id, o.user_id, o.order_number, o.to_status, o.attempts, o.status, o.kind, o.shipment_status
  )
  select c.id, c.user_id, c.order_number, c.to_status, c.attempts, c.kind, c.shipment_status
  from claimed c
  where c.status = 'sending'
  order by c.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 18. Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.claim_notifications(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_notifications(integer, integer) to service_role;

do $$
declare
  v_fn text;
begin
  -- Staff functions: open to signed-in accounts, each checks its own permission.
  foreach v_fn in array array[
    'public.admin_courier_config()',
    'public.admin_save_courier_settings(integer, integer, text, integer)',
    'public.admin_save_courier_provider(text, boolean, jsonb, integer, bigint)',
    'public.admin_record_courier_check(text, boolean, text, text)',
    'public.admin_save_courier_rate_card(uuid, text, public.delivery_zone, integer, bigint, boolean)',
    'public.admin_delete_courier_rate_card(uuid)',
    'public.admin_save_courier_location_mapping(text, text, text, jsonb, text)',
    'public.admin_order_courier_context(text)',
    'public.admin_record_courier_quotes(text, jsonb)',
    'public.admin_courier_provider_stats(integer)',
    'public.admin_begin_shipment_booking(text, uuid, text, uuid, integer, text, text, text, jsonb, boolean)',
    'public.admin_begin_return_pickup(uuid, uuid, text, integer, text, jsonb, boolean)',
    'public.admin_begin_exchange_shipment(uuid, uuid, text, integer, bigint, text, jsonb, boolean)',
    'public.admin_finish_shipment_booking(uuid, text, text, text, text, text, bigint, text)',
    'public.admin_resolve_shipment_booking(uuid, text, text, text, text)',
    'public.admin_record_shipment_event(uuid, public.shipment_status, text, timestamptz, text, text, text)',
    'public.admin_cancel_shipment(uuid, text, boolean)',
    'public.admin_request_shipment_sync(uuid)',
    'public.admin_list_shipments(public.shipment_status, text, text, text, timestamptz, timestamptz, boolean, integer, integer)',
    'public.admin_get_shipment(uuid)',
    'public.admin_courier_overview(boolean)',
    'public.admin_order_shipments(text)',
    'public.admin_return_shipments(uuid)',
    'public.admin_cod_positions(text, text, boolean, integer, integer)',
    'public.admin_record_cod_collected(uuid, bigint, text, text)',
    'public.admin_record_courier_settlement(text, text, bigint, date, text, jsonb, boolean)',
    'public.admin_record_cod_adjustment(uuid, bigint, text)',
    'public.admin_set_cod_state(uuid, text, text)',
    'public.admin_list_courier_settlements(text, boolean, integer, integer)',
    'public.my_order_shipments(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;

  -- Server-only functions: the webhook processor and the sync worker (service role).
  foreach v_fn in array array[
    'public.service_shipment_booking_payload(uuid)',
    'public.service_record_shipment_event(uuid, public.shipment_status, text, timestamptz, text, text)',
    'public.service_claim_shipment_sync(integer, integer)',
    'public.service_finish_shipment_sync(uuid, boolean, text, integer)',
    'public.service_store_courier_webhook(text, text, text, text, text, boolean, jsonb)',
    'public.service_find_shipment(text, text, text)',
    'public.service_finish_courier_webhook(uuid, text, text, uuid)',
    'public.service_claim_courier_webhook_retries(integer)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end;
$$;

-- Internal helpers are never called directly by an account.
revoke execute on all functions in schema private from public, anon, authenticated;
