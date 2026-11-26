/*
 * Coupons and discounts
 * =====================
 * A coupon is a code the store issues to reduce an order's total. The discount is
 * always calculated here, in minor units, inside the same transaction that creates the
 * order: the API and every client only carry the code, never an amount or percentage.
 *
 * Rules this file enforces:
 *   - A code is unique (case-insensitive storage: always upper-case) and can be
 *     percentage (1-100, optionally capped) or a fixed amount in poisha.
 *   - A coupon may have a start/end time, a minimum order subtotal, a total usage
 *     limit and a per-customer limit.
 *   - Redemption is serialised on the coupon row: two concurrent checkouts cannot both
 *     take the last use, and the same order can never redeem twice (unique key).
 *   - Orders keep the discount they were placed with; later coupon edits never rewrite
 *     an existing order.
 *
 * Nothing here is destructive: every statement is additive except recreating
 * `place_cod_order`, whose body is reproduced verbatim with the coupon step inserted.
 */

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  /** Stored upper-case; shoppers may type either case. */
  code text not null unique,
  description text,
  kind text not null check (kind in ('percent', 'fixed')),
  /** Percentage (1-100) for `percent`, poisha for `fixed`. */
  value bigint not null check (value > 0),
  min_order_minor bigint not null default 0 check (min_order_minor >= 0),
  /** Caps a percentage discount; must stay null for fixed coupons. */
  max_discount_minor bigint check (max_discount_minor >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  /** Null means unlimited redemptions. */
  total_limit integer check (total_limit is null or total_limit > 0),
  per_customer_limit integer not null default 1 check (per_customer_limit > 0),
  is_active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
  constraint coupons_percent_range check (kind <> 'percent' or value between 1 and 100),
  constraint coupons_fixed_has_no_cap check (kind <> 'fixed' or max_discount_minor is null),
  constraint coupons_window check (starts_at is null or ends_at is null or ends_at > starts_at)
);

comment on table public.coupons is
  'Discount codes. Read and written only through the security-definer functions below.';

create trigger coupons_set_updated_at
before update on public.coupons
for each row execute function public.set_updated_at();

-- One row per order that used a coupon: the audit of who redeemed what, for how much.
create table public.coupon_redemptions (
  id bigint generated always as identity primary key,
  coupon_id uuid not null references public.coupons (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  order_id uuid not null references public.orders (id) on delete cascade,
  discount_minor bigint not null check (discount_minor >= 0),
  redeemed_at timestamptz not null default now(),
  /** An order redeems a given coupon at most once. */
  constraint coupon_redemptions_order_unique unique (coupon_id, order_id)
);

create index coupon_redemptions_coupon_user_idx
  on public.coupon_redemptions (coupon_id, user_id);

create index coupons_active_window_idx
  on public.coupons (is_active, starts_at, ends_at);

comment on table public.coupon_redemptions is
  'One row per coupon used on an order; the source of truth for usage limits.';

/*
 * Coupons are staff-only data: no client role reads them directly. Every access goes
 * through a security-definer function that checks a permission or a customer's
 * eligibility, so row-level security stays closed with no policies at all.
 */
alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;

-- ---------------------------------------------------------------------------
-- Discount arithmetic and eligibility
-- ---------------------------------------------------------------------------

/**
 * The discount a coupon gives on this subtotal, in poisha. Never more than the
 * subtotal, never negative, rounded down so the store never over-pays by a poisha.
 */
create function private.coupon_discount(p_coupon public.coupons, p_subtotal bigint)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select least(
    p_subtotal,
    greatest(
      0,
      case
        when p_coupon.kind = 'fixed' then p_coupon.value
        else least(
          (p_subtotal * p_coupon.value) / 100,
          coalesce(p_coupon.max_discount_minor, p_subtotal)
        )
      end
    )
  );
$$;

/**
 * Resolves a code to a coupon the customer may use for this subtotal right now, and
 * locks the coupon row for the rest of the transaction. Locking is what makes usage
 * limits safe: concurrent checkouts using the last redemption queue here and the
 * second one sees the first redemption when it re-counts.
 *
 * Errors (SQLSTATE NZ44x) say exactly why a code cannot be used, so the storefront can
 * say the same thing without re-deriving the rules.
 */
create function private.claim_coupon(p_code text, p_user uuid, p_subtotal bigint)
returns public.coupons
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_coupon public.coupons;
  v_used bigint;
  v_used_by_customer bigint;
begin
  if v_code = '' then
    raise exception 'enter a coupon code' using errcode = 'NZ450';
  end if;

  select * into v_coupon from public.coupons where code = v_code for update;
  if not found then
    raise exception 'this coupon code is not valid' using errcode = 'NZ451';
  end if;
  if not v_coupon.is_active then
    raise exception 'this coupon is no longer available' using errcode = 'NZ452';
  end if;
  if v_coupon.starts_at is not null and now() < v_coupon.starts_at then
    raise exception 'this coupon is not available yet' using errcode = 'NZ453';
  end if;
  if v_coupon.ends_at is not null and now() >= v_coupon.ends_at then
    raise exception 'this coupon has expired' using errcode = 'NZ454';
  end if;
  if p_subtotal < v_coupon.min_order_minor then
    raise exception 'this coupon needs a subtotal of at least %', v_coupon.min_order_minor
      using errcode = 'NZ455';
  end if;

  select count(*) into v_used
  from public.coupon_redemptions r
  where r.coupon_id = v_coupon.id;

  if v_coupon.total_limit is not null and v_used >= v_coupon.total_limit then
    raise exception 'this coupon has reached its usage limit' using errcode = 'NZ456';
  end if;

  select count(*) into v_used_by_customer
  from public.coupon_redemptions r
  where r.coupon_id = v_coupon.id and r.user_id = p_user;

  if v_used_by_customer >= v_coupon.per_customer_limit then
    raise exception 'you have already used this coupon' using errcode = 'NZ457';
  end if;

  return v_coupon;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cart pricing with a coupon (the existing quote_cart is left untouched)
-- ---------------------------------------------------------------------------

/**
 * The same quote as quote_cart, with a coupon applied when one is given and usable.
 * The base quote is reused rather than reimplemented, so cart totals can never drift
 * between a plain quote and a couponed one.
 *
 * An unusable code does not fail the request: the quote carries `couponProblem` with a
 * message and the undiscounted totals, which is what a cart needs to keep working.
 */
create function public.quote_cart_with_coupon(
  p_items jsonb,
  p_address_id uuid,
  p_coupon_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_quote jsonb := public.quote_cart(p_items, p_address_id);
  v_subtotal bigint := coalesce((v_quote ->> 'subtotalMinor')::bigint, 0);
  v_total bigint := (v_quote ->> 'totalMinor')::bigint;
  v_coupon public.coupons;
  v_discount bigint := 0;
  v_problem text;
begin
  if p_coupon_code is null or btrim(p_coupon_code) = '' then
    return v_quote || jsonb_build_object('discountMinor', 0);
  end if;

  if v_user is null then
    -- Pricing a coupon needs an account, because per-customer limits do.
    return v_quote || jsonb_build_object(
      'discountMinor', 0,
      'couponProblem', 'Sign in to use a coupon'
    );
  end if;

  if (v_quote ->> 'purchasable')::boolean is not true then
    return v_quote || jsonb_build_object(
      'discountMinor', 0,
      'couponProblem', 'Resolve the cart before applying a coupon'
    );
  end if;

  begin
    v_coupon := private.claim_coupon(p_coupon_code, v_user, v_subtotal);
    v_discount := private.coupon_discount(v_coupon, v_subtotal);
  exception
    -- Each eligibility failure has its own code; the message is what the cart shows.
    when sqlstate 'NZ450' or sqlstate 'NZ451' or sqlstate 'NZ452' or sqlstate 'NZ453'
      or sqlstate 'NZ454' or sqlstate 'NZ455' or sqlstate 'NZ456' or sqlstate 'NZ457' then
      get stacked diagnostics v_problem = message_text;
      return v_quote || jsonb_build_object('discountMinor', 0, 'couponProblem', v_problem);
  end;

  return v_quote || jsonb_build_object(
    'discountMinor', v_discount,
    'totalMinor', case when v_total is null then null else v_total - v_discount end,
    'coupon', jsonb_build_object(
      'code', v_coupon.code,
      'kind', v_coupon.kind,
      'value', v_coupon.value,
      'maxDiscountMinor', v_coupon.max_discount_minor,
      'description', v_coupon.description
    )
  );
end;
$$;

revoke execute on function public.quote_cart_with_coupon(jsonb, uuid, text)
  from public, anon, authenticated;
grant execute on function public.quote_cart_with_coupon(jsonb, uuid, text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- place_cod_order: reproduced in full, with the coupon step inserted
--
-- The signature gains `p_coupon_code` (defaulted, so existing calls still work). The
-- body is identical to the previous version except that a coupon is resolved and
-- locked before the total is compared, and its redemption is recorded with the order.
-- ---------------------------------------------------------------------------

revoke execute on function public.place_cod_order(uuid, uuid, jsonb, text, bigint)
  from public, anon, authenticated;
drop function public.place_cod_order(uuid, uuid, jsonb, text, bigint);

create function public.place_cod_order(
  p_idempotency_key uuid,
  p_address_id uuid,
  p_items jsonb,
  p_note text default null,
  p_expected_total_minor bigint default null,
  p_coupon_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_fingerprint text;
  v_existing public.orders;
  v_address public.addresses;
  v_zone public.delivery_zone;
  v_fee bigint;
  v_subtotal bigint;
  v_item_count integer;
  v_problems jsonb;
  v_coupon public.coupons;
  v_discount bigint := 0;
  v_order public.orders;
begin
  if v_user is null then
    raise exception 'sign in to place an order' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_address_id is null then
    raise exception 'an idempotency key and an address are required' using errcode = 'NZ412';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'the note is too long' using errcode = 'NZ412';
  end if;

  if not exists (select 1 from public.profiles where id = v_user and status = 'active') then
    raise exception 'this account cannot place orders' using errcode = 'NZ410';
  end if;

  -- Validates the cart (NZ412) before anything is locked.
  perform 1 from private.cart_items(p_items);

  v_fingerprint := md5(jsonb_build_object(
    'address', p_address_id,
    'note', v_note,
    'coupon', upper(btrim(coalesce(p_coupon_code, ''))),
    'items', (
      select jsonb_agg(jsonb_build_array(ci.product_id, ci.quantity) order by ci.product_id)
      from private.cart_items(p_items) as ci
    )
  )::text);

  -- Serialise attempts that share a key, then answer a repeat with the first order.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || p_idempotency_key::text, 0));

  select * into v_existing
  from public.orders
  where user_id = v_user and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'this idempotency key was already used for a different order'
        using errcode = 'NZ416';
    end if;
    return jsonb_build_object(
      'orderId', v_existing.id, 'orderNumber', v_existing.order_number, 'created', false
    );
  end if;

  -- Cash-on-Delivery abuse guard: a few unconfirmed orders at a time per account.
  if (select count(*) from public.orders where user_id = v_user and status = 'pending') >= 5 then
    raise exception 'too many orders are waiting for confirmation' using errcode = 'NZ420';
  end if;

  select * into v_address from public.addresses where id = p_address_id and user_id = v_user;
  if not found then
    raise exception 'address not found' using errcode = 'NZ411';
  end if;

  select d.delivery_zone into v_zone
  from public.bd_districts d
  where d.name = v_address.district and d.division = v_address.division;

  select amount_minor into v_fee from public.delivery_charges where zone = v_zone;
  if v_fee is null then
    raise exception 'delivery is not available for this address yet' using errcode = 'NZ417';
  end if;

  -- Lock the products in a fixed order; the pricing below then reads committed stock.
  perform 1
  from public.products
  where id in (select ci.product_id from private.cart_items(p_items) as ci)
  order by id
  for update;

  select
    coalesce(sum(l.line_total_minor), 0),
    coalesce(sum(l.quantity), 0),
    jsonb_agg(jsonb_build_object('productId', l.product_id, 'problem', l.problem)
      order by l.line_no) filter (where l.problem is not null)
  into v_subtotal, v_item_count, v_problems
  from private.price_cart(p_items) as l;

  if v_problems is not null then
    if exists (select 1 from jsonb_array_elements(v_problems) as e (p) where p ->> 'problem' = 'unavailable') then
      raise exception 'some products are not available' using errcode = 'NZ413', detail = v_problems::text;
    elsif exists (select 1 from jsonb_array_elements(v_problems) as e (p) where p ->> 'problem' = 'quantity_limit') then
      raise exception 'some quantities exceed the per-order limit' using errcode = 'NZ415', detail = v_problems::text;
    else
      raise exception 'not enough stock' using errcode = 'NZ414', detail = v_problems::text;
    end if;
  end if;

  /*
   * The coupon is resolved (and locked) before the reviewed total is compared, so an
   * expired, exhausted or ineligible code fails the checkout instead of quietly
   * charging full price, and the comparison below is made against the discounted total.
   */
  if p_coupon_code is not null and btrim(p_coupon_code) <> '' then
    v_coupon := private.claim_coupon(p_coupon_code, v_user, v_subtotal);
    v_discount := private.coupon_discount(v_coupon, v_subtotal);
  end if;

  if p_expected_total_minor is not null
     and p_expected_total_minor <> v_subtotal + v_fee - v_discount then
    raise exception 'the order total has changed' using errcode = 'NZ418',
      detail = jsonb_build_object('totalMinor', v_subtotal + v_fee - v_discount)::text;
  end if;

  insert into public.orders (
    user_id, item_count, subtotal_minor, shipping_fee_minor, discount_minor, total_minor,
    delivery_zone, ship_recipient_name, ship_phone, ship_division, ship_district, ship_area,
    ship_address_line, ship_postal_code, ship_landmark, customer_note,
    idempotency_key, request_fingerprint
  ) values (
    v_user, v_item_count, v_subtotal, v_fee, v_discount, v_subtotal + v_fee - v_discount,
    v_zone, v_address.recipient_name, v_address.phone, v_address.division, v_address.district,
    v_address.area, v_address.address_line, v_address.postal_code, v_address.landmark, v_note,
    p_idempotency_key, v_fingerprint
  )
  returning * into v_order;

  insert into public.order_items (
    order_id, product_id, product_name, product_slug, sku, unit_price_minor, quantity, line_total_minor
  )
  select v_order.id, l.product_id, l.name, l.slug, l.sku, l.unit_price_minor, l.quantity, l.line_total_minor
  from private.price_cart(p_items) as l;

  if v_coupon.id is not null then
    insert into public.coupon_redemptions (coupon_id, user_id, order_id, discount_minor)
    values (v_coupon.id, v_user, v_order.id, v_discount);
  end if;

  with moved as (
    update public.products p
    set stock_quantity = p.stock_quantity - ci.quantity
    from private.cart_items(p_items) as ci
    where p.id = ci.product_id
    returning p.id, ci.quantity, p.stock_quantity
  )
  insert into public.inventory_movements (product_id, change, stock_after, reason, order_id, actor_id)
  select moved.id, -moved.quantity, moved.stock_quantity, 'order_placed', v_order.id, v_user
  from moved;

  insert into public.order_status_history (order_id, from_status, to_status, actor_kind, actor_id)
  values (v_order.id, null, 'pending', 'customer', v_user);

  return jsonb_build_object('orderId', v_order.id, 'orderNumber', v_order.order_number, 'created', true);
end;
$$;

revoke execute on function public.place_cod_order(uuid, uuid, jsonb, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.place_cod_order(uuid, uuid, jsonb, text, bigint, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: coupons
-- ---------------------------------------------------------------------------

/**
 * The coupon list, newest first. `p_state` is one of all | active | scheduled |
 * expired | inactive | exhausted; counts and discounts come from the redemption rows.
 */
create function public.admin_list_coupons(
  p_search text default null,
  p_state text default 'all',
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('coupons.update');
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_size integer := least(100, greatest(1, coalesce(p_page_size, 25)));
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_state text := coalesce(p_state, 'all');
  v_total bigint;
  v_rows jsonb;
begin
  with usage as (
    select r.coupon_id,
           count(*)::bigint as redemption_count,
           coalesce(sum(r.discount_minor), 0)::bigint as total_discount
    from public.coupon_redemptions r
    group by r.coupon_id
  ),
  graded as (
    select c.id,
           case
             when not c.is_active then 'inactive'
             when c.starts_at is not null and now() < c.starts_at then 'scheduled'
             when c.ends_at is not null and now() >= c.ends_at then 'expired'
             when c.total_limit is not null and coalesce(u.redemption_count, 0) >= c.total_limit
               then 'exhausted'
             else 'active'
           end as state,
           c.code, c.description, c.kind, c.value, c.min_order_minor, c.max_discount_minor,
           c.starts_at, c.ends_at, c.total_limit, c.per_customer_limit, c.is_active,
           c.created_at, c.updated_at,
           coalesce(u.redemption_count, 0) as redemption_count,
           coalesce(u.total_discount, 0) as total_discount
    from public.coupons c
    left join usage u on u.coupon_id = c.id
  ),
  filtered as (
    select * from graded g
    where (v_search is null or g.code ilike '%' || v_search || '%'
           or coalesce(g.description, '') ilike '%' || v_search || '%')
      and (v_state = 'all' or g.state = v_state)
  ),
  page_rows as (
    select * from filtered
    order by created_at desc, code
    offset (v_page - 1) * v_size
    limit v_size
  )
  select
    (select count(*) from filtered),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'code', p.code,
        'description', p.description,
        'kind', p.kind,
        'value', p.value,
        'minOrderMinor', p.min_order_minor,
        'maxDiscountMinor', p.max_discount_minor,
        'startsAt', p.starts_at,
        'endsAt', p.ends_at,
        'totalLimit', p.total_limit,
        'perCustomerLimit', p.per_customer_limit,
        'isActive', p.is_active,
        'state', p.state,
        'redemptionCount', p.redemption_count,
        'totalDiscountMinor', p.total_discount,
        'createdAt', p.created_at,
        'updatedAt', p.updated_at
      ) order by p.created_at desc, p.code)
      from page_rows p
    ), '[]'::jsonb)
  into v_total, v_rows;

  return jsonb_build_object(
    'coupons', v_rows,
    'page', v_page,
    'pageSize', v_size,
    'total', v_total,
    'totalPages', case when v_total = 0 then 0 else ceil(v_total::numeric / v_size)::int end
  );
end;
$$;

/** One coupon with its usage figures. */
create function public.admin_get_coupon(p_coupon_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('coupons.update');
  v_row jsonb;
begin
  select jsonb_build_object(
    'id', c.id,
    'code', c.code,
    'description', c.description,
    'kind', c.kind,
    'value', c.value,
    'minOrderMinor', c.min_order_minor,
    'maxDiscountMinor', c.max_discount_minor,
    'startsAt', c.starts_at,
    'endsAt', c.ends_at,
    'totalLimit', c.total_limit,
    'perCustomerLimit', c.per_customer_limit,
    'isActive', c.is_active,
    'redemptionCount', (select count(*) from public.coupon_redemptions r where r.coupon_id = c.id),
    'totalDiscountMinor',
      (select coalesce(sum(r.discount_minor), 0) from public.coupon_redemptions r where r.coupon_id = c.id),
    'createdAt', c.created_at,
    'updatedAt', c.updated_at
  )
  into v_row
  from public.coupons c
  where c.id = p_coupon_id;

  if v_row is null then
    raise exception 'coupon not found' using errcode = 'NZ404';
  end if;
  return v_row;
end;
$$;

/**
 * Creates (p_coupon_id null) or updates a coupon. Every rule is re-checked here, so a
 * request that bypasses the API still cannot store an invalid coupon.
 */
create function public.admin_save_coupon(
  p_coupon_id uuid,
  p_code text,
  p_kind text,
  p_value bigint,
  p_min_order_minor bigint default 0,
  p_max_discount_minor bigint default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_total_limit integer default null,
  p_per_customer_limit integer default 1,
  p_is_active boolean default true,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('coupons.update');
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_id uuid := p_coupon_id;
  v_kind text := coalesce(p_kind, 'percent');
begin
  if v_code !~ '^[A-Z0-9][A-Z0-9_-]{2,31}$' then
    raise exception 'use 3-32 letters, digits, dashes or underscores' using errcode = 'NZ412';
  end if;
  if v_kind not in ('percent', 'fixed') then
    raise exception 'choose a percentage or a fixed amount' using errcode = 'NZ412';
  end if;
  if p_value is null or p_value <= 0 then
    raise exception 'the discount must be more than zero' using errcode = 'NZ412';
  end if;
  if v_kind = 'percent' and p_value > 100 then
    raise exception 'a percentage cannot exceed 100' using errcode = 'NZ412';
  end if;
  if v_kind = 'fixed' and p_max_discount_minor is not null then
    raise exception 'a fixed discount needs no cap' using errcode = 'NZ412';
  end if;
  if coalesce(p_min_order_minor, 0) < 0 then
    raise exception 'the minimum order cannot be negative' using errcode = 'NZ412';
  end if;
  if coalesce(p_per_customer_limit, 1) < 1 then
    raise exception 'the per-customer limit must be at least one' using errcode = 'NZ412';
  end if;
  if p_total_limit is not null and p_total_limit < 1 then
    raise exception 'the total limit must be at least one' using errcode = 'NZ412';
  end if;
  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'the end must be after the start' using errcode = 'NZ412';
  end if;
  if exists (
    select 1 from public.coupons c
    where c.code = v_code and (v_id is null or c.id <> v_id)
  ) then
    raise exception 'a coupon with this code already exists' using errcode = 'NZ458';
  end if;

  if v_id is null then
    insert into public.coupons (
      code, description, kind, value, min_order_minor, max_discount_minor,
      starts_at, ends_at, total_limit, per_customer_limit, is_active, created_by
    ) values (
      v_code, v_description, v_kind, p_value, coalesce(p_min_order_minor, 0),
      case when v_kind = 'percent' then p_max_discount_minor else null end,
      p_starts_at, p_ends_at, p_total_limit, coalesce(p_per_customer_limit, 1),
      coalesce(p_is_active, true), v_actor
    )
    returning id into v_id;
    perform private.audit(v_actor, 'coupon.created', 'coupon', v_id::text,
      jsonb_build_object('code', v_code, 'kind', v_kind, 'value', p_value));
  else
    update public.coupons
    set code = v_code,
        description = v_description,
        kind = v_kind,
        value = p_value,
        min_order_minor = coalesce(p_min_order_minor, 0),
        max_discount_minor = case when v_kind = 'percent' then p_max_discount_minor else null end,
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        total_limit = p_total_limit,
        per_customer_limit = coalesce(p_per_customer_limit, 1),
        is_active = coalesce(p_is_active, true)
    where id = v_id;
    if not found then
      raise exception 'coupon not found' using errcode = 'NZ404';
    end if;
    perform private.audit(v_actor, 'coupon.updated', 'coupon', v_id::text,
      jsonb_build_object('code', v_code, 'kind', v_kind, 'value', p_value));
  end if;

  return v_id;
end;
$$;

/** Turns a coupon on or off without touching its rules. */
create function public.admin_set_coupon_active(p_coupon_id uuid, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('coupons.update');
begin
  update public.coupons set is_active = coalesce(p_is_active, false) where id = p_coupon_id;
  if not found then
    raise exception 'coupon not found' using errcode = 'NZ404';
  end if;
  perform private.audit(v_actor,
    case when coalesce(p_is_active, false) then 'coupon.activated' else 'coupon.deactivated' end,
    'coupon', p_coupon_id::text, '{}'::jsonb);
end;
$$;

/** Who used a coupon, newest first, with the order and the discount given. */
create function public.admin_coupon_redemptions(
  p_coupon_id uuid,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('coupons.update');
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_size integer := least(100, greatest(1, coalesce(p_page_size, 25)));
  v_total bigint;
  v_rows jsonb;
begin
  if not exists (select 1 from public.coupons c where c.id = p_coupon_id) then
    raise exception 'coupon not found' using errcode = 'NZ404';
  end if;

  select count(*) into v_total
  from public.coupon_redemptions r
  where r.coupon_id = p_coupon_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id,
           'orderNumber', o.order_number,
           'discountMinor', x.discount_minor,
           'redeemedAt', x.redeemed_at,
           'customerId', x.user_id,
           'customerName', p.full_name,
           'customerEmail', p.email
         ) order by x.redeemed_at desc, x.id desc), '[]'::jsonb)
    into v_rows
  from (
    select r.* from public.coupon_redemptions r
    where r.coupon_id = p_coupon_id
    order by r.redeemed_at desc, r.id desc
    offset (v_page - 1) * v_size
    limit v_size
  ) x
  join public.orders o on o.id = x.order_id
  join public.profiles p on p.id = x.user_id;

  return jsonb_build_object(
    'redemptions', v_rows,
    'page', v_page,
    'pageSize', v_size,
    'total', v_total,
    'totalPages', case when v_total = 0 then 0 else ceil(v_total::numeric / v_size)::int end
  );
end;
$$;

revoke execute on function public.admin_list_coupons(text, text, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.admin_get_coupon(uuid) from public, anon, authenticated;
revoke execute on function public.admin_save_coupon(
  uuid, text, text, bigint, bigint, bigint, timestamptz, timestamptz, integer, integer, boolean, text
) from public, anon, authenticated;
revoke execute on function public.admin_set_coupon_active(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.admin_coupon_redemptions(uuid, integer, integer)
  from public, anon, authenticated;

grant execute on function public.admin_list_coupons(text, text, integer, integer) to authenticated;
grant execute on function public.admin_get_coupon(uuid) to authenticated;
grant execute on function public.admin_save_coupon(
  uuid, text, text, bigint, bigint, bigint, timestamptz, timestamptz, integer, integer, boolean, text
) to authenticated;
grant execute on function public.admin_set_coupon_active(uuid, boolean) to authenticated;
grant execute on function public.admin_coupon_redemptions(uuid, integer, integer) to authenticated;
