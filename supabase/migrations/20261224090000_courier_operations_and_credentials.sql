-- ---------------------------------------------------------------------------
-- Courier operations settings, encrypted courier credentials and live-activation gates
--
-- Ordinary courier switches move out of the API's environment into the database, where
-- the owner manages them from the admin workspace (couriers.configure) and every change is
-- audited:
--
--  1. courier_settings gains the operating mode (off | mock | live), whether real API
--     bookings are on, automatic tracking sync and its interval, and the courier request
--     timeout. Defaults are the safe ones: off, nothing booked, nothing synced.
--     Turning on live mode, or real bookings while live, needs the typed confirmation
--     "ENABLE LIVE COURIERS" (NZ611). The API also refuses test (mock) mode while it is
--     connected to a hosted database, so test shipments never reach production data.
--
--  2. Courier credentials are stored encrypted in Supabase Vault (vault.secrets), one
--     secret per field, written by the owner and never read back: admins see only which
--     fields are set and when. Only the server (service role) can read the values. A
--     courier's non-secret API base URL is stored on its account row.
--
--  3. A courier is "verified for live use" only by an explicit owner step after a
--     successful live connection check in the last 24 hours (NZ612) and the typed
--     confirmation "VERIFY <COURIER>". Changing its credentials or base URL clears the
--     verification. Adding credentials alone never makes a courier operational.
--
--  4. API bookings are gated in the database too: a test booking needs test mode; a real
--     booking needs live mode, real bookings on, the courier enabled and verified (NZ600).
--     A booking recorded from the courier's portal stays possible in every mode for real
--     parcels; a test one needs test mode.
--
--  5. admin_order_shipment_states lets the order list show each order's parcel to staff
--     who may read shipments (an empty answer for everyone else).
--
-- Rollback (local only): drop the functions added below, restore admin_courier_config,
-- admin_begin_shipment_booking, admin_begin_return_pickup, admin_begin_exchange_shipment
-- and admin_record_portal_booking from 20261223091000/20261223092000, delete the vault
-- secrets named 'nilzora/courier/%', drop table courier_credentials and the added columns.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Settings and account columns
-- ---------------------------------------------------------------------------

alter table public.courier_settings
  add column mode text not null default 'off' check (mode in ('off', 'mock', 'live')),
  add column booking_enabled boolean not null default false,
  add column tracking_sync_enabled boolean not null default false,
  add column tracking_sync_interval_seconds integer not null default 300
    check (tracking_sync_interval_seconds between 60 and 86400),
  add column http_timeout_ms integer not null default 15000
    check (http_timeout_ms between 1000 and 60000),
  add column live_booking_confirmed_at timestamptz,
  add column live_booking_confirmed_by uuid references public.profiles (id) on delete set null;

alter table public.courier_accounts
  add column api_base_url text check (
    api_base_url is null or api_base_url ~ '^https://[a-z0-9.-]+(/[A-Za-z0-9._~/-]*)?$'
  ),
  add column live_verified_at timestamptz,
  add column live_verified_by uuid references public.profiles (id) on delete set null;

-- Which credential fields are set (never their values: those live in Vault).
create table public.courier_credentials (
  provider text not null references public.courier_accounts (provider) on delete cascade,
  field text not null check (field ~ '^[a-z][a-z_]{1,40}$'),
  secret_id uuid not null,
  set_at timestamptz not null default now(),
  set_by uuid references public.profiles (id) on delete set null,
  primary key (provider, field)
);

alter table public.courier_credentials enable row level security;
revoke all on table public.courier_credentials from public, anon, authenticated;

/** The credential fields each courier's adapter may use. */
create function private.courier_credential_fields(p_provider text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_provider
    when 'steadfast' then array['api_key', 'secret_key', 'webhook_token']
    when 'pathao' then array['client_id', 'client_secret', 'username', 'password', 'webhook_secret']
    else array[]::text[]
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Operations settings
-- ---------------------------------------------------------------------------

create function public.admin_save_courier_operations(
  p_mode text,
  p_booking_enabled boolean,
  p_tracking_sync_enabled boolean,
  p_tracking_sync_interval_seconds integer,
  p_http_timeout_ms integer,
  p_confirmation text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('couriers.configure');
  v_old public.courier_settings;
  v_going_live boolean;
begin
  if p_mode is null or p_mode not in ('off', 'mock', 'live')
     or p_booking_enabled is null or p_tracking_sync_enabled is null
     or p_tracking_sync_interval_seconds is null or p_tracking_sync_interval_seconds not between 60 and 86400
     or p_http_timeout_ms is null or p_http_timeout_ms not between 1000 and 60000 then
    raise exception 'invalid courier operations settings' using errcode = 'NZ412';
  end if;
  select * into v_old from public.courier_settings where id for update;

  v_going_live := (p_mode = 'live' and v_old.mode <> 'live')
    or (p_mode = 'live' and p_booking_enabled and not (v_old.mode = 'live' and v_old.booking_enabled));
  if v_going_live and coalesce(btrim(p_confirmation), '') <> 'ENABLE LIVE COURIERS' then
    raise exception 'type ENABLE LIVE COURIERS to turn on real courier operations' using errcode = 'NZ611';
  end if;

  update public.courier_settings
  set mode = p_mode,
      booking_enabled = p_booking_enabled,
      tracking_sync_enabled = p_tracking_sync_enabled,
      tracking_sync_interval_seconds = p_tracking_sync_interval_seconds,
      http_timeout_ms = p_http_timeout_ms,
      live_booking_confirmed_at = case
        when p_mode = 'live' and p_booking_enabled
          then case when v_going_live then now() else live_booking_confirmed_at end
        else null end,
      live_booking_confirmed_by = case
        when p_mode = 'live' and p_booking_enabled
          then case when v_going_live then v_actor else live_booking_confirmed_by end
        else null end,
      updated_at = now(),
      updated_by = v_actor
  where id;

  perform private.audit(v_actor, 'courier.operations_saved', 'courier_settings', 'default',
    jsonb_build_object(
      'from', jsonb_build_object('mode', v_old.mode, 'bookingEnabled', v_old.booking_enabled,
                                 'trackingSyncEnabled', v_old.tracking_sync_enabled),
      'to', jsonb_build_object('mode', p_mode, 'bookingEnabled', p_booking_enabled,
                               'trackingSyncEnabled', p_tracking_sync_enabled,
                               'trackingSyncIntervalSeconds', p_tracking_sync_interval_seconds,
                               'httpTimeoutMs', p_http_timeout_ms),
      'liveConfirmed', v_going_live));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Credentials (Supabase Vault) and the non-secret base URL
-- ---------------------------------------------------------------------------

create function public.admin_set_courier_credential(p_provider text, p_field text, p_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('couriers.configure');
  v_value text := btrim(coalesce(p_value, ''));
  v_name text := 'nilzora/courier/' || p_provider || '/' || p_field;
  v_secret uuid;
begin
  if not exists (select 1 from public.courier_accounts a where a.provider = p_provider) then
    raise exception 'unknown courier %', p_provider using errcode = 'NZ600';
  end if;
  if p_field is null or not (p_field = any (private.courier_credential_fields(p_provider))) then
    raise exception 'unknown credential field' using errcode = 'NZ412';
  end if;
  if char_length(v_value) not between 1 and 1000 then
    raise exception 'a credential must be 1-1000 characters' using errcode = 'NZ412';
  end if;

  select c.secret_id into v_secret from public.courier_credentials c
  where c.provider = p_provider and c.field = p_field;
  if v_secret is null then
    select s.id into v_secret from vault.secrets s where s.name = v_name;
  end if;
  if v_secret is null then
    v_secret := vault.create_secret(v_value, v_name, 'Nilzora courier credential');
  else
    perform vault.update_secret(v_secret, v_value, v_name, 'Nilzora courier credential');
  end if;

  insert into public.courier_credentials (provider, field, secret_id, set_at, set_by)
  values (p_provider, p_field, v_secret, now(), v_actor)
  on conflict (provider, field) do update
    set secret_id = excluded.secret_id, set_at = excluded.set_at, set_by = excluded.set_by;

  -- New credentials must be checked again before live use.
  update public.courier_accounts
  set live_verified_at = null, live_verified_by = null, updated_at = now(), updated_by = v_actor
  where provider = p_provider;

  perform private.audit(v_actor, 'courier.credential_set', 'courier_account', p_provider,
    jsonb_build_object('field', p_field));
end;
$$;

create function public.admin_clear_courier_credential(p_provider text, p_field text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('couriers.configure');
  v_row public.courier_credentials;
begin
  delete from public.courier_credentials c
  where c.provider = p_provider and c.field = p_field
  returning * into v_row;
  if v_row.provider is null then
    raise exception 'that credential is not set' using errcode = 'NZ404';
  end if;
  delete from vault.secrets s where s.id = v_row.secret_id;
  update public.courier_accounts
  set live_verified_at = null, live_verified_by = null, updated_at = now(), updated_by = v_actor
  where provider = p_provider;
  perform private.audit(v_actor, 'courier.credential_cleared', 'courier_account', p_provider,
    jsonb_build_object('field', p_field));
end;
$$;

/** The courier's API base URL (validated against the courier's host allow-list by the API). */
create function public.admin_save_courier_api_base_url(p_provider text, p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('couriers.configure');
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if v_url is not null and v_url !~ '^https://[a-z0-9.-]+(/[A-Za-z0-9._~/-]*)?$' then
    raise exception 'the base URL must be https without a query' using errcode = 'NZ412';
  end if;
  update public.courier_accounts
  set api_base_url = v_url,
      live_verified_at = case when api_base_url is distinct from v_url then null else live_verified_at end,
      live_verified_by = case when api_base_url is distinct from v_url then null else live_verified_by end,
      updated_at = now(),
      updated_by = v_actor
  where provider = p_provider;
  if not found then
    raise exception 'unknown courier %', p_provider using errcode = 'NZ600';
  end if;
  perform private.audit(v_actor, 'courier.base_url_saved', 'courier_account', p_provider,
    jsonb_build_object('set', v_url is not null));
end;
$$;

/**
 * Marks a courier verified (or not) for live use. Verifying needs a successful live
 * connection check in the last 24 hours and the typed confirmation "VERIFY <COURIER>".
 */
create function public.admin_set_courier_live_verified(p_provider text, p_verified boolean, p_confirmation text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('couriers.configure');
  v_account public.courier_accounts;
begin
  select * into v_account from public.courier_accounts a where a.provider = p_provider for update;
  if not found then
    raise exception 'unknown courier %', p_provider using errcode = 'NZ600';
  end if;
  if p_verified is null then
    raise exception 'say whether the courier is verified' using errcode = 'NZ412';
  end if;
  if p_verified then
    if coalesce(btrim(p_confirmation), '') <> 'VERIFY ' || upper(p_provider) then
      raise exception 'type VERIFY % to confirm', upper(p_provider) using errcode = 'NZ611';
    end if;
    if not coalesce(v_account.last_check_ok, false) or v_account.last_check_mode is distinct from 'live'
       or v_account.last_check_at < now() - interval '24 hours' then
      raise exception 'run a successful live connection check first' using errcode = 'NZ612';
    end if;
  end if;
  update public.courier_accounts
  set live_verified_at = case when p_verified then now() end,
      live_verified_by = case when p_verified then v_actor end,
      updated_at = now(),
      updated_by = v_actor
  where provider = p_provider;
  perform private.audit(v_actor,
    case when p_verified then 'courier.live_verified' else 'courier.live_unverified' end,
    'courier_account', p_provider, '{}'::jsonb);
end;
$$;

/** Decrypted credentials of one courier, for the API's adapters only (service role). */
create function public.service_courier_credentials(p_provider text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(c.field, d.decrypted_secret), '{}'::jsonb)
  from public.courier_credentials c
  join vault.decrypted_secrets d on d.id = c.secret_id
  where c.provider = p_provider;
$$;

/** The courier runtime settings the API and its worker run on (no secrets). */
create function public.service_courier_runtime()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'mode', s.mode,
    'bookingEnabled', s.booking_enabled,
    'trackingSyncEnabled', s.tracking_sync_enabled,
    'trackingSyncIntervalSeconds', s.tracking_sync_interval_seconds,
    'httpTimeoutMs', s.http_timeout_ms,
    'providers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider', a.provider,
        'isEnabled', a.is_enabled,
        'apiBaseUrl', a.api_base_url,
        'liveVerified', a.live_verified_at is not null,
        'credentialFields', coalesce((
          select jsonb_agg(c.field order by c.field) from public.courier_credentials c
          where c.provider = a.provider
        ), '[]'::jsonb)
      ) order by a.provider)
      from public.courier_accounts a
    ), '[]'::jsonb)
  )
  from public.courier_settings s
  where s.id;
$$;

-- ---------------------------------------------------------------------------
-- 4. The admin's view of the configuration (adds operations and credential status)
-- ---------------------------------------------------------------------------

create or replace function public.admin_courier_config()
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
    'operations', jsonb_build_object(
      'mode', v_settings.mode,
      'bookingEnabled', v_settings.booking_enabled,
      'trackingSyncEnabled', v_settings.tracking_sync_enabled,
      'trackingSyncIntervalSeconds', v_settings.tracking_sync_interval_seconds,
      'httpTimeoutMs', v_settings.http_timeout_ms,
      'liveBookingConfirmedAt', v_settings.live_booking_confirmed_at
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
        'updatedAt', a.updated_at,
        'apiBaseUrl', a.api_base_url,
        'liveVerifiedAt', a.live_verified_at,
        'credentials', coalesce((
          select jsonb_agg(jsonb_build_object('field', c.field, 'setAt', c.set_at) order by c.field)
          from public.courier_credentials c where c.provider = a.provider
        ), '[]'::jsonb),
        'credentialFields', to_jsonb(private.courier_credential_fields(a.provider))
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
    ), '[]'::jsonb),
    'locationMappings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'provider', m.provider,
        'district', m.district,
        'area', m.area_key,
        'destination', m.destination,
        'label', m.label,
        'updatedAt', m.updated_at
      ) order by m.provider, m.district, m.area_key)
      from public.courier_location_mappings m
    ), '[]'::jsonb)
  );
end;
$$;

create function public.admin_delete_courier_location_mapping(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.courier_require_any(array['shipments.create', 'shipments.returns.manage']);
  v_row public.courier_location_mappings;
begin
  delete from public.courier_location_mappings m where m.id = p_id returning * into v_row;
  if v_row.id is null then
    raise exception 'location mapping not found' using errcode = 'NZ404';
  end if;
  perform private.audit(v_actor, 'courier.location_mapping_deleted', 'courier_location_mapping', p_id::text,
    jsonb_build_object('provider', v_row.provider, 'district', v_row.district));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Booking gates
-- ---------------------------------------------------------------------------

/**
 * Refuses an API booking the current settings do not allow: a test booking outside test
 * mode, or a real booking unless live mode and real bookings are on and the courier is
 * enabled and verified for live use.
 */
create function private.courier_require_api_booking(p_provider text, p_is_mock boolean)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.courier_settings;
  v_account public.courier_accounts;
begin
  select * into v_settings from public.courier_settings where id;
  if coalesce(p_is_mock, false) then
    if v_settings.mode <> 'mock' then
      raise exception 'test bookings need courier test mode' using errcode = 'NZ600';
    end if;
    return;
  end if;
  if v_settings.mode <> 'live' or not v_settings.booking_enabled then
    raise exception 'real courier bookings are switched off' using errcode = 'NZ600';
  end if;
  select * into v_account from public.courier_accounts a where a.provider = p_provider;
  if not found or not v_account.is_enabled or v_account.live_verified_at is null then
    raise exception 'courier % is not verified for live bookings', p_provider using errcode = 'NZ600';
  end if;
end;
$$;

create or replace function public.admin_begin_shipment_booking(
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
  v_known boolean;
begin
  select * into v_order from public.orders o where o.order_number = p_order_number for update;
  if not found then
    raise exception 'order not found' using errcode = 'NZ404';
  end if;
  v_known := exists (select 1 from public.shipments s where s.booking_key = p_booking_key);
  if not v_known then
    perform private.courier_require_api_booking(p_provider, p_is_mock);
    if v_order.status not in ('confirmed', 'processing', 'shipped') then
      raise exception 'an order that is % cannot be booked with a courier', v_order.status
        using errcode = 'NZ601';
    end if;
  end if;
  return private.shipment_begin(
    v_actor, v_order, 'forward', null, null, p_booking_key, p_provider, p_quote_id,
    p_weight_grams, private.order_cod_due(v_order), p_note, p_recommended_provider,
    p_selection_reason, p_destination, p_is_mock
  );
end;
$$;

create or replace function public.admin_begin_return_pickup(
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
  v_known boolean;
begin
  select * into v_return from public.return_requests r where r.id = p_return_id for update;
  if not found then
    raise exception 'return not found' using errcode = 'NZ404';
  end if;
  v_known := exists (select 1 from public.shipments s where s.booking_key = p_booking_key);
  if not v_known then
    perform private.courier_require_api_booking(p_provider, p_is_mock);
    if v_return.status <> 'approved' then
      raise exception 'a pickup can be booked only for an approved return' using errcode = 'NZ607';
    end if;
  end if;
  select * into v_order from public.orders o where o.id = v_return.order_id;
  return private.shipment_begin(
    v_actor, v_order, 'return_pickup', v_return.id, null, p_booking_key, p_provider, null,
    p_weight_grams, 0, p_note, null, null, p_destination, p_is_mock
  );
end;
$$;

create or replace function public.admin_begin_exchange_shipment(
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
  v_known boolean;
begin
  select * into v_return from public.return_requests r where r.id = p_return_id for update;
  if not found then
    raise exception 'return not found' using errcode = 'NZ404';
  end if;
  v_known := exists (select 1 from public.shipments s where s.booking_key = p_booking_key);
  if not v_known then
    perform private.courier_require_api_booking(p_provider, p_is_mock);
    if v_return.status not in ('approved', 'received', 'completed') then
      raise exception 'an exchange can be shipped only for an approved return' using errcode = 'NZ607';
    end if;
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

-- A portal booking records a real parcel in any mode; a test one only in test mode.
create or replace function public.admin_record_portal_booking(
  p_order_number text,
  p_return_id uuid,
  p_booking_key uuid,
  p_provider text,
  p_weight_grams integer,
  p_consignment_id text,
  p_tracking_code text,
  p_charge_minor bigint,
  p_note text,
  p_recommended_provider text,
  p_selection_reason text,
  p_is_mock boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission(
    case when p_return_id is null then 'shipments.create' else 'shipments.returns.manage' end
  );
  v_order public.orders;
  v_return public.return_requests;
  v_known boolean;
  v_begin jsonb;
  v_shipment public.shipments;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_consignment text := nullif(btrim(coalesce(p_consignment_id, '')), '');
begin
  if v_consignment is null or char_length(v_consignment) > 80 then
    raise exception 'give the consignment id the courier portal showed' using errcode = 'NZ412';
  end if;
  if v_note is null or char_length(v_note) not between 5 and 300 then
    raise exception 'say where and how it was booked' using errcode = 'NZ412';
  end if;
  if p_charge_minor is not null and p_charge_minor not between 0 and 10000000 then
    raise exception 'invalid courier charge' using errcode = 'NZ412';
  end if;

  select * into v_order from public.orders o where o.order_number = p_order_number for update;
  if not found then
    raise exception 'order not found' using errcode = 'NZ404';
  end if;
  v_known := exists (select 1 from public.shipments s where s.booking_key = p_booking_key);
  if not v_known and coalesce(p_is_mock, false)
     and (select mode from public.courier_settings where id) <> 'mock' then
    raise exception 'test bookings need courier test mode' using errcode = 'NZ600';
  end if;

  if p_return_id is null then
    if not v_known and v_order.status not in ('confirmed', 'processing', 'shipped') then
      raise exception 'an order that is % cannot be booked with a courier', v_order.status
        using errcode = 'NZ601';
    end if;
    v_begin := private.shipment_begin(
      v_actor, v_order, 'forward', null, null, p_booking_key, p_provider, null, p_weight_grams,
      private.order_cod_due(v_order), v_note, p_recommended_provider, p_selection_reason,
      '{}'::jsonb, p_is_mock
    );
  else
    select * into v_return from public.return_requests r where r.id = p_return_id for update;
    if not found or v_return.order_id <> v_order.id then
      raise exception 'return not found' using errcode = 'NZ404';
    end if;
    if not v_known and v_return.status <> 'approved' then
      raise exception 'a pickup can be booked only for an approved return' using errcode = 'NZ607';
    end if;
    v_begin := private.shipment_begin(
      v_actor, v_order, 'return_pickup', v_return.id, null, p_booking_key, p_provider, null,
      p_weight_grams, 0, v_note, null, null, '{}'::jsonb, p_is_mock
    );
  end if;

  select * into v_shipment from public.shipments s
  where s.id = (v_begin -> 'shipment' ->> 'id')::uuid for update;

  if (v_begin ->> 'shouldCall')::boolean then
    update public.shipments set provider_call_started_at = null where id = v_shipment.id;
    perform private.shipment_mark_booked(v_shipment, v_consignment, p_tracking_code, null, null,
      p_charge_minor, v_actor, 'portal');
    perform private.audit(v_actor, 'shipment.portal_booking_recorded', 'shipment', v_shipment.id::text,
      jsonb_build_object('orderNumber', v_order.order_number, 'kind', v_shipment.kind,
                         'provider', v_shipment.provider, 'consignmentId', v_consignment,
                         'isMock', v_shipment.is_mock));
    select * into v_shipment from public.shipments s where s.id = v_shipment.id;
  end if;

  return private.shipment_json(v_shipment, private.has_permission('couriers.cod.read'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The order list's parcel column
-- ---------------------------------------------------------------------------

/**
 * Each listed order's latest delivery parcel (the active one first). Staff who may not read
 * shipments get an empty list, so the order list keeps working for them.
 */
create function public.admin_order_shipment_states(p_order_numbers text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  if p_order_numbers is null or cardinality(p_order_numbers) > 200 then
    raise exception 'between 0 and 200 order numbers' using errcode = 'NZ412';
  end if;
  if not private.has_permission('shipments.read') then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'orderNumber', x.order_number,
      'shipmentId', x.id,
      'status', x.status,
      'provider', x.provider,
      'providerName', x.display_name,
      'trackingCode', x.tracking_code,
      'bookingUncertain', x.booking_uncertain,
      'isMock', x.is_mock
    ))
    from (
      select distinct on (o.order_number) o.order_number, s.id, s.status, s.provider,
             a.display_name, s.tracking_code, s.booking_uncertain, s.is_mock
      from public.orders o
      join public.shipments s on s.order_id = o.id and s.kind = 'forward'
      join public.courier_accounts a on a.provider = s.provider
      where o.order_number = any (p_order_numbers)
      order by o.order_number,
               (s.status in ('cancelled', 'booking_failed')) asc,
               s.created_at desc
    ) x
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.admin_save_courier_operations(text, boolean, boolean, integer, integer, text)',
    'public.admin_set_courier_credential(text, text, text)',
    'public.admin_clear_courier_credential(text, text)',
    'public.admin_save_courier_api_base_url(text, text)',
    'public.admin_set_courier_live_verified(text, boolean, text)',
    'public.admin_delete_courier_location_mapping(uuid)',
    'public.admin_order_shipment_states(text[])'
  ] loop
    execute format('revoke execute on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;

  foreach v_fn in array array[
    'public.service_courier_credentials(text)',
    'public.service_courier_runtime()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
