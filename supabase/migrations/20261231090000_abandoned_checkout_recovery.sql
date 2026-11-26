-- ===========================================================================
-- Abandoned checkouts: recovery workflow
-- ===========================================================================
-- The queue itself already exists (20261105090000_persisted_carts.sql): a checkout session is
-- only ever created when a customer really started a checkout, and
-- private.classify_stale_carts() flips it to `incomplete` once it has been quiet for
-- store_settings.cart_inactivity_minutes. Nothing here re-defines that behaviour.
--
-- What this migration adds is the part staff need to actually work the queue:
--
--   * abandoned_at      – when the attempt was first classified as abandoned, so "recovered"
--                         can be proven (converted_at > abandoned_at) instead of guessed.
--   * recovery_state    – open / contacted / dismissed. An explicit enum, never free text.
--   * attempts          – who contacted the customer, when, how, and what was said.
--   * recovery links    – a capability token that restores that customer's own cart. Only a
--                         SHA-256 hash is stored; the plaintext exists once, in the response
--                         to the admin who created it. Owners only: the restoring customer
--                         must be the owner of the session.
--   * metrics           – one function that answers the summary figures, so the Admin panel
--                         never adds numbers up in TypeScript.
--
-- Prices are never copied: a cart stores product/variant ids and quantities, and the value
-- column below is the catalogue price at read time, for context only.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Permission
-- ---------------------------------------------------------------------------

insert into public.permissions (name, description) values
  ('checkouts.recover',
   'Contact customers about an incomplete checkout, record the attempt and manage recovery links')
on conflict (name) do nothing;

-- Reading the queue stays with orders.read; acting on it is a separate, deniable right.
-- Moderators do not get it: this is customer contact and cart handling, not moderation.
insert into public.role_permissions (role, permission)
select 'super_admin'::public.app_role, 'checkouts.recover'
union all
select 'admin'::public.app_role, 'checkouts.recover'
union all
select 'staff'::public.app_role, 'checkouts.recover'
on conflict (role, permission) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The lifecycle the queue needs
-- ---------------------------------------------------------------------------

create type public.checkout_recovery_state as enum ('open', 'contacted', 'dismissed');

alter table public.checkout_sessions
  add column abandoned_at timestamptz,
  add column recovery_state public.checkout_recovery_state not null default 'open';

comment on column public.checkout_sessions.abandoned_at is
  'When the attempt was first classified as abandoned. Never cleared, so a later order proves recovery.';
comment on column public.checkout_sessions.recovery_state is
  'What staff did about it: open, contacted or dismissed. Conversion is tracked by status, not here.';

-- Backfill: sessions already sitting in the queue have no recorded moment of abandonment.
-- Their last activity is the only truthful estimate, so that is what is stored.
update public.checkout_sessions
set abandoned_at = last_activity_at
where abandoned_at is null
  and status in ('incomplete', 'expired');

-- ---------------------------------------------------------------------------
-- 3. Attempts and links
-- ---------------------------------------------------------------------------

create table public.checkout_recovery_attempts (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.checkout_sessions (id) on delete cascade,
  admin_id uuid references public.profiles (id) on delete set null,
  /** How the customer was reached. `other` covers anything not listed. */
  channel text not null
    check (channel in ('call', 'whatsapp', 'sms', 'email', 'in_person', 'other')),
  /** What was said. No secrets and no payment details belong here. */
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);

comment on table public.checkout_recovery_attempts is
  'One row per contact attempt. Written only by staff through admin_record_recovery_attempt.';

create index checkout_recovery_attempts_session_idx
  on public.checkout_recovery_attempts (session_id, created_at desc);

create table public.checkout_recovery_links (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.checkout_sessions (id) on delete cascade,
  /** SHA-256 of the token. The token itself is shown once and never stored. */
  token_hash bytea not null unique,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  /** Set the moment the customer used it. A link works once. */
  used_at timestamptz,
  revoked_at timestamptz,
  constraint checkout_recovery_link_window check (expires_at > created_at)
);

comment on table public.checkout_recovery_links is
  'Single-use cart recovery links. Only the hash is stored; the token is a capability and is never logged.';

create index checkout_recovery_links_session_idx
  on public.checkout_recovery_links (session_id, created_at desc);

alter table public.checkout_recovery_attempts enable row level security;
alter table public.checkout_recovery_links enable row level security;

-- No policy grants access to either table: every read and write goes through the
-- SECURITY DEFINER functions below, which check the caller's permission and scope.

-- ---------------------------------------------------------------------------
-- 4. Classification also stamps the abandonment moment
-- ---------------------------------------------------------------------------

create or replace function private.classify_stale_carts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - make_interval(mins => private.cart_inactivity_minutes());
  /** A cart never taken to checkout is dropped from tracking after a week of silence. */
  v_retention timestamptz := now() - interval '7 days';
begin
  update public.checkout_sessions
  set status = 'incomplete',
      abandoned_at = coalesce(abandoned_at, now())
  where status = 'started' and last_activity_at < v_cutoff;

  update public.checkout_sessions
  set status = 'expired',
      abandoned_at = coalesce(abandoned_at, last_activity_at)
  where status = 'incomplete' and last_activity_at < v_retention;

  update public.carts c
  set status = 'expired'
  where c.status = 'active'
    and c.last_activity_at < v_retention
    and not exists (select 1 from public.checkout_sessions s where s.cart_id = c.id);
end;
$$;

revoke execute on function private.classify_stale_carts() from public, anon, authenticated;

-- A conversion always ends the recovery conversation, and is only accepted for a session
-- that is still open. checkout_converted() already sets these; this keeps the state honest
-- for orders created before this migration existed.
update public.checkout_sessions
set recovery_state = 'contacted'
where recovery_state = 'open'
  and status = 'converted'
  and abandoned_at is not null;

-- ---------------------------------------------------------------------------
-- 5. The cart value, computed once
-- ---------------------------------------------------------------------------

/**
 * Catalogue value of what is sitting in a cart: quantity × the variant price when the line has
 * one, otherwise the product price. Context only — the order function prices the real order.
 */
create function private.cart_value_minor(p_cart_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(i.quantity * coalesce(v.price_minor, p.price_minor)), 0)::bigint
  from public.cart_items i
  join public.products p on p.id = i.product_id
  left join public.product_variants v on v.id = i.variant_id
  where i.cart_id = p_cart_id;
$$;

revoke execute on function private.cart_value_minor(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The summary figures
-- ---------------------------------------------------------------------------

/**
 * The abandoned-checkout metrics for one reporting window.
 *
 * Every figure comes from checkout_sessions and its two side tables. "Abandoned" always means
 * `abandoned_at` inside the window, which is what makes the recovery rate meaningful: the
 * denominator is the attempts that were actually abandoned then, and the numerator is how many
 * of those later became an order.
 */
create function public.admin_checkout_recovery_metrics(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('checkouts.recover');
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
  v_abandoned integer;
  v_recovered integer;
  v_open integer;
  v_recent integer;
  v_potential bigint;
  v_attempts integer;
  v_contacted integer;
  v_dismissed integer;
begin
  perform private.classify_stale_carts();

  select count(*) into v_abandoned
  from public.checkout_sessions s
  where s.abandoned_at >= v_from and s.abandoned_at <= v_to;

  select count(*) into v_recovered
  from public.checkout_sessions s
  where s.abandoned_at >= v_from and s.abandoned_at <= v_to
    and s.converted_at is not null;

  select
    count(*) filter (where s.status = 'incomplete'),
    count(*) filter (where s.status = 'incomplete' and s.abandoned_at >= now() - interval '24 hours'),
    coalesce(sum(private.cart_value_minor(s.cart_id)) filter (where s.status = 'incomplete'), 0)::bigint,
    count(*) filter (where s.recovery_state = 'contacted'),
    count(*) filter (where s.recovery_state = 'dismissed')
  into v_open, v_recent, v_potential, v_contacted, v_dismissed
  from public.checkout_sessions s
  where s.abandoned_at >= v_from and s.abandoned_at <= v_to;

  select count(*) into v_attempts
  from public.checkout_recovery_attempts a
  where a.created_at >= v_from and a.created_at <= v_to;

  return jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'abandonedCount', v_abandoned,
    'openCount', v_open,
    'recentCount', v_recent,
    'potentialValueMinor', v_potential,
    'recoveredCount', v_recovered,
    -- Out of the attempts abandoned in this window, the share that became an order. Zero when
    -- nothing was abandoned, which the UI shows as "—" rather than 0%.
    'recoveryRatePercent', case
      when v_abandoned = 0 then null
      else round((v_recovered::numeric * 100) / v_abandoned, 1)
    end,
    'attemptCount', v_attempts,
    'contactedCount', v_contacted,
    'dismissedCount', v_dismissed,
    -- What the queue can honestly be measured against: when tracking started.
    'trackingSince', (select min(started_at) from public.checkout_sessions)
  );
end;
$$;

revoke execute on function public.admin_checkout_recovery_metrics(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_checkout_recovery_metrics(timestamptz, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The queue, with the figures staff triage on
-- ---------------------------------------------------------------------------

create function public.admin_abandoned_checkouts(
  p_status text default null,
  p_query text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_sort text default 'recent',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  status public.checkout_status,
  recovery_state public.checkout_recovery_state,
  customer_name text,
  customer_phone text,
  item_count integer,
  coupon_code text,
  cart_value_minor bigint,
  started_at timestamptz,
  last_activity_at timestamptz,
  abandoned_at timestamptz,
  converted_at timestamptz,
  order_number text,
  attempt_count integer,
  total_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('checkouts.recover');
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_sort text := lower(coalesce(p_sort, 'recent'));
  v_from timestamptz := coalesce(p_from, '-infinity'::timestamptz);
  v_to timestamptz := coalesce(p_to, 'infinity'::timestamptz);
begin
  perform private.classify_stale_carts();

  return query
  select s.id,
         s.status,
         s.recovery_state,
         pr.full_name,
         pr.phone,
         coalesce((select sum(i.quantity) from public.cart_items i where i.cart_id = s.cart_id), 0)::integer,
         s.coupon_code,
         private.cart_value_minor(s.cart_id),
         s.started_at,
         s.last_activity_at,
         s.abandoned_at,
         s.converted_at,
         o.order_number,
         (select count(*)::integer from public.checkout_recovery_attempts a where a.session_id = s.id),
         count(*) over ()
  from public.checkout_sessions s
  join public.profiles pr on pr.id = s.user_id
  left join public.orders o on o.id = s.converted_order_id
  where (p_status is null or s.status::text = p_status)
    -- The window is applied to the abandonment moment when there is one, so an attempt that
    -- started last month and went quiet yesterday shows up in a "today" report.
    and coalesce(s.abandoned_at, s.started_at) >= v_from
    and coalesce(s.abandoned_at, s.started_at) <= v_to
    and (
      v_query is null
      or pr.full_name ilike '%' || v_query || '%'
      or pr.phone ilike '%' || v_query || '%'
      or o.order_number ilike '%' || v_query || '%'
      or s.id::text = lower(v_query)
    )
  order by
    case when v_sort = 'value' then private.cart_value_minor(s.cart_id) end desc nulls last,
    case when v_sort = 'started' then s.started_at end desc nulls last,
    coalesce(s.abandoned_at, s.last_activity_at) desc
  limit least(coalesce(p_limit, 25), 100) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke execute on function public.admin_abandoned_checkouts(text, text, timestamptz, timestamptz, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.admin_abandoned_checkouts(text, text, timestamptz, timestamptz, text, integer, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 8. One record, with everything staff need to act
-- ---------------------------------------------------------------------------

create function public.admin_abandoned_checkout(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('checkouts.recover');
  v_session public.checkout_sessions;
begin
  perform private.classify_stale_carts();

  select * into v_session from public.checkout_sessions where id = p_session_id;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_session.id,
    'status', v_session.status,
    'recoveryState', v_session.recovery_state,
    'couponCode', v_session.coupon_code,
    'startedAt', v_session.started_at,
    'lastActivityAt', v_session.last_activity_at,
    'abandonedAt', v_session.abandoned_at,
    'convertedAt', v_session.converted_at,
    'orderNumber', (select o.order_number from public.orders o where o.id = v_session.converted_order_id),
    'cartValueMinor', private.cart_value_minor(v_session.cart_id),
    'itemCount', coalesce((select sum(i.quantity) from public.cart_items i where i.cart_id = v_session.cart_id), 0)::integer,
    'customer', (
      select jsonb_build_object('id', pr.id, 'name', pr.full_name, 'phone', pr.phone)
      from public.profiles pr where pr.id = v_session.user_id
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'productId', i.product_id,
               'productName', p.name,
               'productSlug', p.slug,
               'imageKey', (select pi.storage_key from public.product_images pi
                            where pi.product_id = p.id order by pi.position limit 1),
               'variantLabel', private.variant_label(i.variant_id),
               'sku', coalesce(v.sku, p.sku),
               'quantity', i.quantity,
               'unitPriceMinor', coalesce(v.price_minor, p.price_minor)
             ) order by i.id)
      from public.cart_items i
      join public.products p on p.id = i.product_id
      left join public.product_variants v on v.id = i.variant_id
      where i.cart_id = v_session.cart_id
    ), '[]'::jsonb),
    'attempts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id,
               'channel', a.channel,
               'note', a.note,
               'createdAt', a.created_at,
               'adminName', (select pr.full_name from public.profiles pr where pr.id = a.admin_id)
             ) order by a.created_at desc)
      from public.checkout_recovery_attempts a
      where a.session_id = v_session.id
    ), '[]'::jsonb),
    'link', (
      select jsonb_build_object(
               'createdAt', l.created_at,
               'expiresAt', l.expires_at,
               'usedAt', l.used_at,
               'revokedAt', l.revoked_at
             )
      from public.checkout_recovery_links l
      where l.session_id = v_session.id
      order by l.created_at desc
      limit 1
    )
  );
end;
$$;

revoke execute on function public.admin_abandoned_checkout(uuid) from public, anon, authenticated;
grant execute on function public.admin_abandoned_checkout(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Actions: an attempt, a state, a link
-- ---------------------------------------------------------------------------

/**
 * Records that a human contacted the customer. There is no messaging integration in this
 * project, so this is deliberately a record of a manual contact, not a "send".
 */
create function public.admin_record_recovery_attempt(
  p_session_id uuid,
  p_channel text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('checkouts.recover');
  v_channel text := lower(btrim(coalesce(p_channel, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_state public.checkout_sessions;
begin
  if v_channel not in ('call', 'whatsapp', 'sms', 'email', 'in_person', 'other') then
    raise exception 'That contact channel is not one this store records'
      using errcode = 'NZR01';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'A contact note may be at most 500 characters'
      using errcode = 'NZR02';
  end if;

  select * into v_state from public.checkout_sessions where id = p_session_id for update;
  if not found then
    raise exception 'That checkout does not exist' using errcode = 'NZ404';
  end if;

  insert into public.checkout_recovery_attempts (session_id, admin_id, channel, note)
  values (p_session_id, v_actor, v_channel, v_note);

  -- The first contact moves an open record to contacted; a dismissed one stays dismissed
  -- until staff deliberately reopen it.
  update public.checkout_sessions
  set recovery_state = 'contacted'
  where id = p_session_id and recovery_state = 'open';

  return public.admin_abandoned_checkout(p_session_id);
end;
$$;

revoke execute on function public.admin_record_recovery_attempt(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_record_recovery_attempt(uuid, text, text) to authenticated;

/**
 * Moves the record between open, contacted and dismissed. A converted checkout cannot be
 * dismissed: it is no longer abandoned, and the order is the record of what happened.
 */
create function public.admin_set_recovery_state(p_session_id uuid, p_state text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('checkouts.recover');
  v_state public.checkout_recovery_state;
  v_session public.checkout_sessions;
begin
  if lower(btrim(coalesce(p_state, ''))) not in ('open', 'contacted', 'dismissed') then
    raise exception 'That recovery state does not exist' using errcode = 'NZR03';
  end if;
  v_state := lower(btrim(p_state))::public.checkout_recovery_state;

  select * into v_session from public.checkout_sessions where id = p_session_id for update;
  if not found then
    raise exception 'That checkout does not exist' using errcode = 'NZ404';
  end if;
  if v_session.status = 'converted' and v_state = 'dismissed' then
    raise exception 'This checkout became an order; there is nothing to dismiss'
      using errcode = 'NZR06';
  end if;

  update public.checkout_sessions set recovery_state = v_state where id = p_session_id;
  return public.admin_abandoned_checkout(p_session_id);
end;
$$;

revoke execute on function public.admin_set_recovery_state(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_recovery_state(uuid, text) to authenticated;

/**
 * Mints a single-use recovery link for one session.
 *
 * The token is 32 random bytes, returned once and stored only as a SHA-256 hash. It expires
 * after 72 hours, revokes any earlier link for the same session, and only works for the
 * customer who owns the session. No customer detail is ever carried in the URL.
 */
create function public.admin_create_recovery_link(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('checkouts.recover');
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires timestamptz := now() + interval '72 hours';
  v_session public.checkout_sessions;
begin
  select * into v_session from public.checkout_sessions where id = p_session_id for update;
  if not found then
    raise exception 'That checkout does not exist' using errcode = 'NZ404';
  end if;
  if v_session.status = 'converted' then
    raise exception 'This checkout already became an order' using errcode = 'NZR06';
  end if;

  -- One capability at a time: an older link must stop working when a new one is minted.
  update public.checkout_recovery_links
  set revoked_at = now()
  where session_id = p_session_id and revoked_at is null and used_at is null;

  insert into public.checkout_recovery_links (session_id, token_hash, created_by, expires_at)
  values (p_session_id, extensions.digest(v_token, 'sha256'), v_actor, v_expires);

  return jsonb_build_object(
    'token', v_token,
    'expiresAt', v_expires,
    'checkoutId', p_session_id
  );
end;
$$;

revoke execute on function public.admin_create_recovery_link(uuid) from public, anon, authenticated;
grant execute on function public.admin_create_recovery_link(uuid) to authenticated;

create function public.admin_revoke_recovery_link(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('checkouts.recover');
begin
  if not exists (select 1 from public.checkout_sessions where id = p_session_id) then
    raise exception 'That checkout does not exist' using errcode = 'NZ404';
  end if;

  update public.checkout_recovery_links
  set revoked_at = now()
  where session_id = p_session_id and revoked_at is null and used_at is null;

  return public.admin_abandoned_checkout(p_session_id);
end;
$$;

revoke execute on function public.admin_revoke_recovery_link(uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_recovery_link(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. The customer side of a recovery link
-- ---------------------------------------------------------------------------

/**
 * What a visitor holding a link is allowed to learn before signing in: whether the link still
 * works, how many items are waiting and roughly what they are worth. No name, no phone, no
 * address, no product list — the link can be forwarded by mistake.
 */
create function public.checkout_recovery_preview(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.checkout_recovery_links;
  v_session public.checkout_sessions;
begin
  select * into v_link
  from public.checkout_recovery_links
  where token_hash = extensions.digest(lower(btrim(coalesce(p_token, ''))), 'sha256');

  if not found then
    return jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;
  if v_link.revoked_at is not null then
    return jsonb_build_object('valid', false, 'reason', 'revoked');
  end if;
  if v_link.used_at is not null then
    return jsonb_build_object('valid', false, 'reason', 'used');
  end if;
  if v_link.expires_at <= now() then
    return jsonb_build_object('valid', false, 'reason', 'expired');
  end if;

  select * into v_session from public.checkout_sessions where id = v_link.session_id;
  if not found or v_session.status in ('converted', 'expired') then
    return jsonb_build_object('valid', false, 'reason', 'closed');
  end if;

  return jsonb_build_object(
    'valid', true,
    'itemCount', coalesce((select sum(i.quantity) from public.cart_items i where i.cart_id = v_session.cart_id), 0)::integer,
    'cartValueMinor', private.cart_value_minor(v_session.cart_id),
    'expiresAt', v_link.expires_at
  );
end;
$$;

revoke execute on function public.checkout_recovery_preview(text) from public;
grant execute on function public.checkout_recovery_preview(text) to anon, authenticated;

/**
 * Restores one abandoned cart into the signed-in customer's own cart.
 *
 * Three things are enforced here and nowhere else:
 *   1. the caller is signed in and *is* the owner of that checkout,
 *   2. the link is unexpired, unused and unrevoked,
 *   3. only product/variant ids and quantities cross over — prices are never restored.
 *
 * The lines are returned, not written: the API replays them through cart_set_item, so stock,
 * variant and coupon rules stay in the one place that already owns them.
 */
create function public.checkout_recovery_restore(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_link public.checkout_recovery_links;
  v_session public.checkout_sessions;
begin
  if v_actor is null then
    raise exception 'Sign in to restore your cart' using errcode = 'NZR04';
  end if;

  select * into v_link
  from public.checkout_recovery_links
  where token_hash = extensions.digest(lower(btrim(coalesce(p_token, ''))), 'sha256')
  for update;

  if not found then
    raise exception 'That recovery link is no longer valid' using errcode = 'NZR04';
  end if;
  if v_link.revoked_at is not null or v_link.used_at is not null or v_link.expires_at <= now() then
    raise exception 'That recovery link is no longer valid' using errcode = 'NZR04';
  end if;

  select * into v_session from public.checkout_sessions where id = v_link.session_id for update;
  if not found or v_session.status in ('converted', 'expired') then
    raise exception 'That recovery link is no longer valid' using errcode = 'NZR04';
  end if;
  -- Ownership, not possession: a forwarded link restores nothing for anybody else.
  if v_session.user_id <> v_actor then
    raise exception 'That recovery link belongs to another customer' using errcode = 'NZR05';
  end if;

  update public.checkout_recovery_links set used_at = now() where id = v_link.id;

  -- Opening the link is activity: the attempt is live again, so it must not stay abandoned.
  update public.checkout_sessions
  set status = 'started',
      last_activity_at = now()
  where id = v_session.id;

  update public.carts set status = 'checkout', last_activity_at = now() where id = v_session.cart_id;

  return jsonb_build_object(
    'checkoutId', v_session.id,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'productId', i.product_id,
               'variantId', i.variant_id,
               'quantity', i.quantity,
               -- What the caller already has on that line, so the API adds instead of replacing.
               'existingQuantity', coalesce((
                 select mine.quantity
                 from public.carts c
                 join public.cart_items mine on mine.cart_id = c.id
                 where c.user_id = v_actor
                   and c.status in ('active', 'checkout')
                   and mine.product_id = i.product_id
                   and mine.variant_id is not distinct from i.variant_id
                 limit 1
               ), 0)
             ) order by i.id)
      from public.cart_items i
      where i.cart_id = v_session.cart_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.checkout_recovery_restore(text) from public, anon;
grant execute on function public.checkout_recovery_restore(text) to authenticated;
