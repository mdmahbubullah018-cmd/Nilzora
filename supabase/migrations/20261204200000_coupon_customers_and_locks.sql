-- ---------------------------------------------------------------------------
-- Coupons for chosen customers, locked terms once redeemed, and an order's coupon for staff
--
-- 1. A coupon or voucher can be meant for one or several chosen customers: the new audience
--    'selected_customers' plus public.coupon_customers (one row per recipient). The one
--    audience check, private.coupon_audience_ok, now answers for it, so every path that
--    already used that check refuses anyone else: the checkout quote and place_cod_order
--    (through private.claim_coupon_for_cart) and collecting a voucher. The Voucher Center and
--    My Vouchers list such a voucher to its recipients only, so nobody else even sees it.
--    Deny by default: an audience the check does not know is refused.
--
-- 2. Once an order redeemed a coupon, its code and its discount (type, value, cap) are what
--    those orders were priced with; admin_save_coupon refuses to change them (NZ442). Dates,
--    limits, the minimum spend, eligibility and the on/off switch stay editable: they only
--    shape future checkouts. Redemption rows are never touched.
--
-- 3. public.admin_order_coupons tells staff with orders.read which coupon or voucher priced
--    an order (coupons themselves stay closed to direct reads).
--
-- Additive except: the audience check constraint is widened (dropped and re-added with one
-- more value), and admin_save_coupon_targeting gains a trailing parameter with a default (the
-- old signature is dropped so calls are never ambiguous; old 8-argument calls still resolve).
-- ---------------------------------------------------------------------------

alter table public.coupons drop constraint coupons_audience_check;
alter table public.coupons add constraint coupons_audience_check
  check (audience in ('all', 'new_customers', 'returning_customers', 'selected_customers'));

create table public.coupon_customers (
  coupon_id uuid not null references public.coupons (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_by uuid references public.profiles (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (coupon_id, user_id)
);

create index coupon_customers_user_idx on public.coupon_customers (user_id);

comment on table public.coupon_customers is
  'Recipients of a coupon whose audience is selected_customers. Read and written only through security-definer functions.';

-- Staff-only data, like coupons: no client role reads it directly.
alter table public.coupon_customers enable row level security;
revoke all on table public.coupon_customers from public, anon, authenticated;
grant select, insert, update, delete on table public.coupon_customers to service_role;

-- ---------------------------------------------------------------------------
-- The audience check (every pricing and collection path calls it)
-- ---------------------------------------------------------------------------

create or replace function private.coupon_audience_ok(p_coupon public.coupons, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_coupon.audience
    when 'all' then true
    when 'new_customers' then not exists (
      select 1 from public.orders o where o.user_id = p_user and o.status <> 'cancelled')
    when 'returning_customers' then exists (
      select 1 from public.orders o where o.user_id = p_user and o.status <> 'cancelled')
    when 'selected_customers' then p_user is not null and exists (
      select 1 from public.coupon_customers cc
      where cc.coupon_id = p_coupon.id and cc.user_id = p_user)
    else false
  end;
$$;

/** Why an account is outside a coupon's audience, in the words the storefront shows. */
create function private.coupon_audience_refusal(p_audience text, p_noun text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_audience
    when 'new_customers' then 'this ' || p_noun || ' is for a first order only'
    when 'returning_customers' then 'this ' || p_noun || ' is for returning customers'
    else 'this ' || p_noun || ' is not available on your account'
  end;
$$;

revoke execute on function private.coupon_audience_refusal(text, text) from public, anon, authenticated;

/*
 * The coupon step of pricing (20261129092000), with the audience checked first: a customer
 * who is not a recipient of a targeted voucher is told it is not for their account, never
 * asked to collect something they cannot collect.
 */
create or replace function private.claim_coupon_for_cart(
  p_code text,
  p_user uuid,
  p_items jsonb,
  p_subtotal bigint
)
returns public.coupons
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_coupon public.coupons;
  v_eligible bigint;
begin
  select * into v_coupon from public.coupons where code = upper(btrim(coalesce(p_code, '')));
  if found then
    if not private.coupon_audience_ok(v_coupon, p_user) then
      raise exception '%', private.coupon_audience_refusal(v_coupon.audience, 'offer')
        using errcode = 'NZ459';
    end if;
    if v_coupon.is_voucher and not exists (
      select 1 from public.voucher_collections vc
      where vc.coupon_id = v_coupon.id and vc.user_id = p_user
    ) then
      raise exception 'collect this voucher before using it' using errcode = 'NZ459';
    end if;
    v_eligible := case when v_coupon.scope = 'storewide' then p_subtotal
                       else private.coupon_eligible_subtotal(v_coupon, p_items) end;
    if v_coupon.scope <> 'storewide' and v_eligible = 0 then
      raise exception 'nothing in your cart qualifies for this offer' using errcode = 'NZ459';
    end if;
  else
    v_eligible := p_subtotal;
  end if;
  -- The existing claim: validity window, minimum spend (on the qualifying lines), limits, lock.
  return private.claim_coupon(p_code, p_user, v_eligible);
end;
$$;

-- ---------------------------------------------------------------------------
-- What customers see: a targeted voucher is listed to its recipients only
-- ---------------------------------------------------------------------------

create or replace function public.voucher_center()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.voucher_json(c, (select auth.uid()))
                            order by (c.ends_at is not null and c.ends_at <= now()), c.ends_at nulls last, c.created_at desc),
                  '[]'::jsonb)
  from public.coupons c
  where c.is_voucher
    and c.is_active
    and (c.starts_at is null or c.starts_at <= now() + interval '7 days')
    and (c.ends_at is null or c.ends_at > now() - interval '4 days')
    and (c.audience <> 'selected_customers' or private.coupon_audience_ok(c, (select auth.uid())));
$$;

/**
 * The caller's collected vouchers. A targeted voucher the caller is no longer a recipient of
 * is left out (it can no longer be redeemed); its collection and redemptions stay recorded.
 */
create or replace function public.my_vouchers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'sign in to see your vouchers' using errcode = 'NZ401';
  end if;
  return coalesce((
    select jsonb_agg(private.voucher_json(c, v_user) order by vc.collected_at desc)
    from public.voucher_collections vc
    join public.coupons c on c.id = vc.coupon_id
    where vc.user_id = v_user
      and (c.ends_at is null or c.ends_at > now() - interval '4 days')
      and (c.is_active or c.updated_at > now() - interval '4 days')
      and (c.audience <> 'selected_customers' or private.coupon_audience_ok(c, v_user))
  ), '[]'::jsonb);
end;
$$;

create or replace function public.collect_voucher(p_coupon_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_coupon public.coupons;
  v_collections integer;
begin
  if v_user is null then
    raise exception 'sign in to collect vouchers' using errcode = 'NZ401';
  end if;
  -- The row lock serialises collections, so a collection cap cannot be overrun.
  select * into v_coupon from public.coupons where id = p_coupon_id and is_voucher for update;
  if not found or not v_coupon.is_active then
    raise exception 'this voucher is not available' using errcode = 'NZ459';
  end if;
  -- Checked before anything else: a targeted voucher answers nothing to anyone else.
  if v_coupon.audience = 'selected_customers' and not private.coupon_audience_ok(v_coupon, v_user) then
    raise exception 'this voucher is not available' using errcode = 'NZ459';
  end if;
  if exists (select 1 from public.voucher_collections where coupon_id = v_coupon.id and user_id = v_user) then
    return private.voucher_json(v_coupon, v_user);
  end if;
  if v_coupon.starts_at is not null and now() < v_coupon.starts_at then
    raise exception 'this voucher can be collected once it starts' using errcode = 'NZ459';
  end if;
  if v_coupon.ends_at is not null and now() >= v_coupon.ends_at then
    raise exception 'this voucher has expired' using errcode = 'NZ459';
  end if;
  if not private.coupon_audience_ok(v_coupon, v_user) then
    raise exception '%', private.coupon_audience_refusal(v_coupon.audience, 'voucher')
      using errcode = 'NZ459';
  end if;
  select count(*) into v_collections from public.voucher_collections where coupon_id = v_coupon.id;
  if v_coupon.collect_limit is not null and v_collections >= v_coupon.collect_limit then
    raise exception 'this voucher has been fully collected' using errcode = 'NZ459';
  end if;

  insert into public.voucher_collections (coupon_id, user_id) values (v_coupon.id, v_user)
  on conflict on constraint voucher_collections_once do nothing;
  return private.voucher_json(v_coupon, v_user);
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: targeting with recipients
-- ---------------------------------------------------------------------------

drop function public.admin_save_coupon_targeting(uuid, boolean, text, text, uuid[], uuid[], text, integer);

/**
 * Sets the voucher, scope and audience settings of a coupon (after admin_save_coupon, in the
 * same transaction when the API runs both). Needs coupons.create or coupons.update. With the
 * audience 'selected_customers', `p_customer_ids` names 1-500 customer accounts and becomes
 * the exact recipient list; any other audience clears the list. Recipients are targeting, not
 * history: redemptions and collections are never touched.
 */
create function public.admin_save_coupon_targeting(
  p_coupon_id uuid,
  p_is_voucher boolean,
  p_title text,
  p_scope text,
  p_category_ids uuid[],
  p_product_ids uuid[],
  p_audience text,
  p_collect_limit integer,
  p_customer_ids uuid[] default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_scope text := coalesce(p_scope, 'storewide');
  v_audience text := coalesce(p_audience, 'all');
  v_categories uuid[] := case when v_scope = 'categories' then coalesce(p_category_ids, '{}') else '{}' end;
  v_products uuid[] := case when v_scope = 'products' then coalesce(p_product_ids, '{}') else '{}' end;
  v_customers uuid[] := case when v_audience = 'selected_customers'
                             then array(select distinct x from unnest(coalesce(p_customer_ids, '{}')) x)
                             else '{}' end;
begin
  if not (public.has_permission('coupons.update') or public.has_permission('coupons.create')) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;
  if v_scope not in ('storewide', 'categories', 'products')
     or v_audience not in ('all', 'new_customers', 'returning_customers', 'selected_customers')
     or (p_collect_limit is not null and p_collect_limit < 1)
     or (v_scope = 'categories' and (cardinality(v_categories) = 0
         or exists (select 1 from unnest(v_categories) x where not exists (select 1 from public.categories c where c.id = x))))
     or (v_scope = 'products' and (cardinality(v_products) = 0
         or exists (select 1 from unnest(v_products) x where not exists (select 1 from public.products p where p.id = x))))
     or (v_audience = 'selected_customers' and (cardinality(v_customers) not between 1 and 500
         or exists (select 1 from unnest(v_customers) x where not exists (
           select 1 from public.user_roles r where r.user_id = x and r.role = 'customer')))) then
    raise exception 'invalid coupon targeting' using errcode = 'NZ412';
  end if;

  update public.coupons set
    is_voucher = coalesce(p_is_voucher, false),
    title = nullif(btrim(coalesce(p_title, '')), ''),
    scope = v_scope,
    category_ids = v_categories,
    product_ids = v_products,
    audience = v_audience,
    collect_limit = p_collect_limit
  where id = p_coupon_id;
  if not found then
    raise exception 'coupon not found' using errcode = 'NZ404';
  end if;

  delete from public.coupon_customers cc
  where cc.coupon_id = p_coupon_id and not (cc.user_id = any (v_customers));
  insert into public.coupon_customers (coupon_id, user_id, added_by)
  select p_coupon_id, x, v_actor from unnest(v_customers) x
  on conflict (coupon_id, user_id) do nothing;

  perform private.audit(v_actor, 'coupon.targeting_changed', 'coupon', p_coupon_id::text,
    jsonb_build_object('isVoucher', coalesce(p_is_voucher, false), 'scope', v_scope,
      'audience', v_audience, 'customerCount', cardinality(v_customers)));
end;
$$;

revoke execute on function public.admin_save_coupon_targeting(uuid, boolean, text, text, uuid[], uuid[], text, integer, uuid[]) from public, anon;
grant execute on function public.admin_save_coupon_targeting(uuid, boolean, text, text, uuid[], uuid[], text, integer, uuid[]) to authenticated, service_role;

/**
 * Targeting and collection figures of one coupon, for its admin page, with its recipients.
 * A recipient's email and phone are shown only to an account that may read customers.
 */
create or replace function public.admin_coupon_targeting(p_coupon_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('coupons.update');
  v_coupon public.coupons;
  v_contact boolean := public.has_permission('customers.read');
begin
  select * into v_coupon from public.coupons where id = p_coupon_id;
  if not found then
    raise exception 'coupon not found' using errcode = 'NZ404';
  end if;
  return jsonb_build_object(
    'isVoucher', v_coupon.is_voucher,
    'title', v_coupon.title,
    'scope', v_coupon.scope,
    'categoryIds', to_jsonb(v_coupon.category_ids),
    'productIds', to_jsonb(v_coupon.product_ids),
    'audience', v_coupon.audience,
    'collectLimit', v_coupon.collect_limit,
    'collectionCount', (select count(*) from public.voucher_collections vc where vc.coupon_id = v_coupon.id),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'sku', p.sku) order by p.name)
      from public.products p where p.id = any (v_coupon.product_ids)), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pr.id,
               'name', pr.full_name,
               'email', case when v_contact then coalesce(pr.email, u.email) end,
               'phone', case when v_contact then pr.phone end
             ) order by lower(coalesce(pr.full_name, pr.email, u.email, '')), pr.id)
      from public.coupon_customers cc
      join public.profiles pr on pr.id = cc.user_id
      left join auth.users u on u.id = pr.id
      where cc.coupon_id = v_coupon.id), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: a redeemed coupon keeps its code and its discount
-- ---------------------------------------------------------------------------

create or replace function public.admin_save_coupon(
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
  -- A new coupon needs coupons.create; changing one needs coupons.update.
  v_actor uuid := private.require_permission(
    case when p_coupon_id is null then 'coupons.create' else 'coupons.update' end);
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_id uuid := p_coupon_id;
  v_kind text := coalesce(p_kind, 'percent');
  v_cap bigint := case when coalesce(p_kind, 'percent') = 'percent' then p_max_discount_minor else null end;
  v_current public.coupons;
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

  if v_id is not null then
    -- The same row lock a checkout's claim takes: no redemption can slip in between the
    -- check below and the update.
    select * into v_current from public.coupons where id = v_id for update;
    if not found then
      raise exception 'coupon not found' using errcode = 'NZ404';
    end if;
    if (v_current.code <> v_code
        or v_current.kind <> v_kind
        or v_current.value <> p_value
        or v_current.max_discount_minor is distinct from v_cap)
       and exists (select 1 from public.coupon_redemptions r where r.coupon_id = v_id) then
      raise exception 'this coupon was used in orders: its code and discount can no longer change'
        using errcode = 'NZ442';
    end if;
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
      v_cap, p_starts_at, p_ends_at, p_total_limit, coalesce(p_per_customer_limit, 1),
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
        max_discount_minor = v_cap,
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        total_limit = p_total_limit,
        per_customer_limit = coalesce(p_per_customer_limit, 1),
        is_active = coalesce(p_is_active, true)
    where id = v_id;
    perform private.audit(v_actor, 'coupon.updated', 'coupon', v_id::text,
      jsonb_build_object('code', v_code, 'kind', v_kind, 'value', p_value));
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff: the coupon or voucher that priced each order
-- ---------------------------------------------------------------------------

/**
 * For up to 100 order numbers, the coupon each one redeemed (orders without one are left
 * out). Needs orders.read. The discount is the one recorded at checkout, never recomputed.
 */
create function public.admin_order_coupons(p_order_numbers text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('orders.read');
begin
  if cardinality(coalesce(p_order_numbers, '{}')) > 100 then
    raise exception 'ask for at most 100 orders' using errcode = 'NZ412';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'orderNumber', o.order_number,
             'couponId', c.id,
             'code', c.code,
             'title', c.title,
             'isVoucher', c.is_voucher,
             'discountMinor', r.discount_minor
           ) order by o.order_number)
    from public.coupon_redemptions r
    join public.orders o on o.id = r.order_id
    join public.coupons c on c.id = r.coupon_id
    where o.order_number = any (coalesce(p_order_numbers, '{}'))
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.admin_order_coupons(text[]) from public, anon;
grant execute on function public.admin_order_coupons(text[]) to authenticated, service_role;
