-- ---------------------------------------------------------------------------
-- Vouchers: collectible coupons
--
-- A voucher is a coupon the store shows in its Voucher Center (is_voucher). A customer
-- collects it once; only a customer who collected it may redeem it, and only through the
-- same server-side coupon path as a typed code. Because an order carries exactly one coupon
-- (one claim, one coupon_redemptions row), an order can use one voucher OR one coupon code,
-- never both: the rule lives in the single pricing step, not in a client.
--
-- New for every coupon (vouchers and codes alike):
--   * scope: storewide, or only listed categories (with their subcategories) or products.
--     The minimum spend and the discount are measured on the qualifying lines only.
--   * audience: everyone, new customers (no orders yet) or returning customers.
-- New for vouchers:
--   * title (what the Voucher Center shows) and an optional cap on collections.
--   * voucher_collections: one row per customer per voucher (unique), never deleted when a
--     voucher expires; listings hide a voucher 4 days after it ends (query time, database
--     clock), and it shows again on its own if an admin gives it new dates.
--
-- Additive: new columns with defaults, one table, new functions, and two function
-- replacements (quote_cart_with_coupon, place_cod_order) whose bodies are the current
-- ones with the coupon step swapped for the scope- and voucher-aware claim.
-- ---------------------------------------------------------------------------

alter table public.coupons
  add column is_voucher boolean not null default false,
  add column title text check (title is null or char_length(title) between 1 and 80),
  add column scope text not null default 'storewide'
    check (scope in ('storewide', 'categories', 'products')),
  add column category_ids uuid[] not null default '{}',
  add column product_ids uuid[] not null default '{}',
  add column audience text not null default 'all'
    check (audience in ('all', 'new_customers', 'returning_customers')),
  add column collect_limit integer check (collect_limit is null or collect_limit > 0),
  add constraint coupons_scope_targets check (
    (scope = 'storewide' and cardinality(category_ids) = 0 and cardinality(product_ids) = 0)
    or (scope = 'categories' and cardinality(category_ids) between 1 and 50 and cardinality(product_ids) = 0)
    or (scope = 'products' and cardinality(product_ids) between 1 and 200 and cardinality(category_ids) = 0)
  );

comment on column public.coupons.is_voucher is
  'Shown in the Voucher Center; redeemable only by customers who collected it.';

create table public.voucher_collections (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  collected_at timestamptz not null default now(),
  constraint voucher_collections_once unique (coupon_id, user_id)
);

create index voucher_collections_user_idx on public.voucher_collections (user_id, collected_at desc);

alter table public.voucher_collections enable row level security;
create policy "Customers read their own collected vouchers"
  on public.voucher_collections for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on table public.voucher_collections from public, anon, authenticated;
grant select on table public.voucher_collections to authenticated;
grant select, insert, update, delete on table public.voucher_collections to service_role;

-- ---------------------------------------------------------------------------
-- Pricing helpers
-- ---------------------------------------------------------------------------

/** The part of a cart a coupon applies to: every line, or only its categories/products. */
create function private.coupon_eligible_subtotal(p_coupon public.coupons, p_items jsonb)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(l.line_total_minor), 0)::bigint
  from private.price_cart(p_items) l
  join public.products p on p.id = l.product_id
  where l.problem is null
    and (
      p_coupon.scope = 'storewide'
      or (p_coupon.scope = 'products' and l.product_id = any (p_coupon.product_ids))
      or (p_coupon.scope = 'categories'
          and p_coupon.category_ids && private.category_ancestry(p.category_id))
    );
$$;

/** Whether the account fits the coupon's audience (orders that were cancelled do not count). */
create function private.coupon_audience_ok(p_coupon public.coupons, p_user uuid)
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
    else exists (
      select 1 from public.orders o where o.user_id = p_user and o.status <> 'cancelled')
  end;
$$;

/**
 * The one coupon step of pricing: resolves the code for this customer and cart, checks the
 * voucher collection and the audience, measures the qualifying subtotal, then runs the
 * existing claim (validity window, minimum spend, usage limits, row lock) and discount.
 * NZ459 explains a voucher, audience or scope refusal; the claim keeps its NZ450-NZ457.
 */
create function private.claim_coupon_for_cart(
  p_code text,
  p_user uuid,
  p_items jsonb,
  p_subtotal bigint,
  out o_coupon public.coupons,
  out o_discount bigint
)
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
    if v_coupon.is_voucher and not exists (
      select 1 from public.voucher_collections vc
      where vc.coupon_id = v_coupon.id and vc.user_id = p_user
    ) then
      raise exception 'collect this voucher before using it' using errcode = 'NZ459';
    end if;
    if not private.coupon_audience_ok(v_coupon, p_user) then
      raise exception '%', case v_coupon.audience
        when 'new_customers' then 'this offer is for a first order only'
        else 'this offer is for returning customers' end
        using errcode = 'NZ459';
    end if;
    v_eligible := case when v_coupon.scope = 'storewide' then p_subtotal
                       else private.coupon_eligible_subtotal(v_coupon, p_items) end;
    if v_coupon.scope <> 'storewide' and v_eligible = 0 then
      raise exception 'nothing in your cart qualifies for this offer' using errcode = 'NZ459';
    end if;
  else
    v_eligible := p_subtotal;
  end if;

  o_coupon := private.claim_coupon(p_code, p_user, v_eligible);
  o_discount := private.coupon_discount(o_coupon, v_eligible);
end;
$$;

revoke execute on function private.coupon_eligible_subtotal(public.coupons, jsonb) from public, anon, authenticated;
revoke execute on function private.coupon_audience_ok(public.coupons, uuid) from public, anon, authenticated;
revoke execute on function private.claim_coupon_for_cart(text, uuid, jsonb, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What customers see
-- ---------------------------------------------------------------------------

/** A voucher as customers see it, with this account's state; null hides it. */
create function private.voucher_json(p_coupon public.coupons, p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_collected timestamptz;
  v_used integer := 0;
  v_collections integer;
  v_state text;
  v_redeemed bigint;
begin
  if p_user is not null then
    select vc.collected_at into v_collected from public.voucher_collections vc
    where vc.coupon_id = p_coupon.id and vc.user_id = p_user;
    select count(*) into v_used from public.coupon_redemptions r
    where r.coupon_id = p_coupon.id and r.user_id = p_user;
  end if;
  select count(*) into v_collections from public.voucher_collections vc where vc.coupon_id = p_coupon.id;
  select count(*) into v_redeemed from public.coupon_redemptions r where r.coupon_id = p_coupon.id;

  v_state := case
    when v_collected is not null and v_used >= p_coupon.per_customer_limit then 'used'
    when not p_coupon.is_active
      or (p_coupon.ends_at is not null and now() >= p_coupon.ends_at)
      or (p_coupon.total_limit is not null and v_redeemed >= p_coupon.total_limit) then 'expired'
    when p_coupon.starts_at is not null and now() < p_coupon.starts_at then 'upcoming'
    when v_collected is not null then 'collected'
    when p_coupon.collect_limit is not null and v_collections >= p_coupon.collect_limit then 'fully_collected'
    else 'available'
  end;

  return jsonb_build_object(
    'id', p_coupon.id,
    'code', case when v_collected is not null then p_coupon.code end,
    'title', coalesce(p_coupon.title, p_coupon.description, p_coupon.code),
    'description', p_coupon.description,
    'kind', p_coupon.kind,
    'value', p_coupon.value,
    'maxDiscountMinor', p_coupon.max_discount_minor,
    'minOrderMinor', p_coupon.min_order_minor,
    'startsAt', p_coupon.starts_at,
    'endsAt', p_coupon.ends_at,
    'scope', p_coupon.scope,
    'audience', p_coupon.audience,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('slug', c.slug, 'name', c.name) order by c.name)
      from public.categories c where c.id = any (p_coupon.category_ids) and c.is_active), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object('slug', pr.slug, 'name', pr.name) order by pr.name)
      from (select pr.slug, pr.name from public.products pr
            where pr.id = any (p_coupon.product_ids) and pr.status = 'active'
            order by pr.name limit 6) pr), '[]'::jsonb),
    'state', v_state,
    'collectedAt', v_collected,
    'usedCount', v_used,
    'perCustomerLimit', p_coupon.per_customer_limit
  );
end;
$$;

revoke execute on function private.voucher_json(public.coupons, uuid) from public, anon, authenticated;

/**
 * The Voucher Center: every active voucher that has started (or starts within 7 days) and
 * has not been over for more than 4 days, with the caller's own state when signed in.
 */
create function public.voucher_center()
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
    and (c.ends_at is null or c.ends_at > now() - interval '4 days');
$$;

/**
 * The caller's collected vouchers. A voucher that ended (or was switched off) more than
 * 4 days ago is left out; its collection and redemptions stay recorded.
 */
create function public.my_vouchers()
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
  ), '[]'::jsonb);
end;
$$;

/** Collects a voucher for the caller. Collecting again is harmless and answers the same voucher. */
create function public.collect_voucher(p_coupon_id uuid)
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
    raise exception '%', case v_coupon.audience
      when 'new_customers' then 'this voucher is for a first order only'
      else 'this voucher is for returning customers' end
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

revoke execute on function public.voucher_center() from public;
revoke execute on function public.my_vouchers() from public, anon;
revoke execute on function public.collect_voucher(uuid) from public, anon;
grant execute on function public.voucher_center() to anon, authenticated, service_role;
grant execute on function public.my_vouchers() to authenticated, service_role;
grant execute on function public.collect_voucher(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------

/**
 * Sets the voucher, scope and audience settings of a coupon (after admin_save_coupon, in
 * the same transaction when the API runs both). Needs coupons.create or coupons.update.
 */
create function public.admin_save_coupon_targeting(
  p_coupon_id uuid,
  p_is_voucher boolean,
  p_title text,
  p_scope text,
  p_category_ids uuid[],
  p_product_ids uuid[],
  p_audience text,
  p_collect_limit integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_scope text := coalesce(p_scope, 'storewide');
  v_categories uuid[] := case when v_scope = 'categories' then coalesce(p_category_ids, '{}') else '{}' end;
  v_products uuid[] := case when v_scope = 'products' then coalesce(p_product_ids, '{}') else '{}' end;
begin
  if not (public.has_permission('coupons.update') or public.has_permission('coupons.create')) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;
  if v_scope not in ('storewide', 'categories', 'products')
     or coalesce(p_audience, 'all') not in ('all', 'new_customers', 'returning_customers')
     or (p_collect_limit is not null and p_collect_limit < 1)
     or (v_scope = 'categories' and (cardinality(v_categories) = 0
         or exists (select 1 from unnest(v_categories) x where not exists (select 1 from public.categories c where c.id = x))))
     or (v_scope = 'products' and (cardinality(v_products) = 0
         or exists (select 1 from unnest(v_products) x where not exists (select 1 from public.products p where p.id = x)))) then
    raise exception 'invalid coupon targeting' using errcode = 'NZ412';
  end if;

  update public.coupons set
    is_voucher = coalesce(p_is_voucher, false),
    title = nullif(btrim(coalesce(p_title, '')), ''),
    scope = v_scope,
    category_ids = v_categories,
    product_ids = v_products,
    audience = coalesce(p_audience, 'all'),
    collect_limit = p_collect_limit
  where id = p_coupon_id;
  if not found then
    raise exception 'coupon not found' using errcode = 'NZ404';
  end if;

  perform private.audit(v_actor, 'coupon.targeting_changed', 'coupon', p_coupon_id::text,
    jsonb_build_object('isVoucher', coalesce(p_is_voucher, false), 'scope', v_scope,
      'audience', coalesce(p_audience, 'all')));
end;
$$;

/** Targeting and collection figures of one coupon, for its admin page. */
create function public.admin_coupon_targeting(p_coupon_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('coupons.update');
  v_coupon public.coupons;
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
      from public.products p where p.id = any (v_coupon.product_ids)), '[]'::jsonb)
  );
end;
$$;

/**
 * Deletes a coupon or voucher nobody has redeemed (collections go with it). One that was
 * redeemed is refused (NZ442): orders refer to it, so it can only be switched off.
 */
create function public.admin_delete_coupon(p_coupon_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('coupons.update');
  v_coupon public.coupons;
begin
  select * into v_coupon from public.coupons where id = p_coupon_id for update;
  if not found then
    raise exception 'coupon not found' using errcode = 'NZ404';
  end if;
  if exists (select 1 from public.coupon_redemptions r where r.coupon_id = p_coupon_id) then
    raise exception 'this coupon was used in orders: switch it off instead' using errcode = 'NZ442';
  end if;
  delete from public.coupons where id = p_coupon_id;
  perform private.audit(v_actor, 'coupon.deleted', 'coupon', p_coupon_id::text,
    jsonb_build_object('code', v_coupon.code, 'isVoucher', v_coupon.is_voucher));
end;
$$;

revoke execute on function public.admin_save_coupon_targeting(uuid, boolean, text, text, uuid[], uuid[], text, integer) from public, anon;
revoke execute on function public.admin_coupon_targeting(uuid) from public, anon;
revoke execute on function public.admin_delete_coupon(uuid) from public, anon;
grant execute on function public.admin_save_coupon_targeting(uuid, boolean, text, text, uuid[], uuid[], text, integer) to authenticated, service_role;
grant execute on function public.admin_coupon_targeting(uuid) to authenticated, service_role;
grant execute on function public.admin_delete_coupon(uuid) to authenticated, service_role;
