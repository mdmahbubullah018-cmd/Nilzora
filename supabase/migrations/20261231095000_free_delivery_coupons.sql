-- Free delivery coupons, and the vouchers that apply to one product.
--
-- Additive: one new coupon kind ('free_delivery', stored with value 1 and no cap), one helper that
-- prices a coupon with the delivery fee in view, and one read function. The kind's discount is the
-- delivery fee, so an order's total can never go below its goods and the existing redemption,
-- per-customer, total-limit and race protections apply unchanged. Nothing is dropped or rewritten.

alter table public.coupons drop constraint coupons_kind_check;
alter table public.coupons
  add constraint coupons_kind_check check (kind in ('percent', 'fixed', 'free_delivery'));
alter table public.coupons
  add constraint coupons_free_delivery_no_cap check (kind <> 'free_delivery' or max_discount_minor is null);

/** What a coupon takes off an order: free delivery waives the fee; every other kind is unchanged. */
create or replace function private.coupon_order_discount(
  p_coupon public.coupons, p_items jsonb, p_subtotal bigint, p_fee bigint
) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_coupon.kind = 'free_delivery' then greatest(0, coalesce(p_fee, 0))
    else private.coupon_cart_discount(p_coupon, p_items, p_subtotal)
  end;
$$;
revoke all on function private.coupon_order_discount(public.coupons, jsonb, bigint, bigint) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_coupon(p_coupon_id uuid, p_code text, p_kind text, p_value bigint, p_min_order_minor bigint DEFAULT 0, p_max_discount_minor bigint DEFAULT NULL::bigint, p_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_total_limit integer DEFAULT NULL::integer, p_per_customer_limit integer DEFAULT 1, p_is_active boolean DEFAULT true, p_description text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  -- A new coupon needs coupons.create; changing one needs coupons.update.
  v_actor uuid := private.require_permission(
    case when p_coupon_id is null then 'coupons.create' else 'coupons.update' end);
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_id uuid := p_coupon_id;
  v_kind text := coalesce(p_kind, 'percent');
  v_cap bigint := case when coalesce(p_kind, 'percent') = 'percent' then p_max_discount_minor else null end;
  v_value bigint := case when coalesce(p_kind, 'percent') = 'free_delivery' then 1 else p_value end;
  v_current public.coupons;
begin
  if v_code !~ '^[A-Z0-9][A-Z0-9_-]{2,31}$' then
    raise exception 'use 3-32 letters, digits, dashes or underscores' using errcode = 'NZ412';
  end if;
  if v_kind not in ('percent', 'fixed', 'free_delivery') then
    raise exception 'choose a percentage, a fixed amount or free delivery' using errcode = 'NZ412';
  end if;
  if v_value is null or v_value <= 0 then
    raise exception 'the discount must be more than zero' using errcode = 'NZ412';
  end if;
  if v_kind = 'percent' and v_value > 100 then
    raise exception 'a percentage cannot exceed 100' using errcode = 'NZ412';
  end if;
  if v_kind in ('fixed', 'free_delivery') and p_max_discount_minor is not null then
    raise exception 'this kind of discount needs no cap' using errcode = 'NZ412';
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
        or v_current.value <> v_value
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
      v_code, v_description, v_kind, v_value, coalesce(p_min_order_minor, 0),
      v_cap, p_starts_at, p_ends_at, p_total_limit, coalesce(p_per_customer_limit, 1),
      coalesce(p_is_active, true), v_actor
    )
    returning id into v_id;
    perform private.audit(v_actor, 'coupon.created', 'coupon', v_id::text,
      jsonb_build_object('code', v_code, 'kind', v_kind, 'value', v_value));
  else
    update public.coupons
    set code = v_code,
        description = v_description,
        kind = v_kind,
        value = v_value,
        min_order_minor = coalesce(p_min_order_minor, 0),
        max_discount_minor = v_cap,
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        total_limit = p_total_limit,
        per_customer_limit = coalesce(p_per_customer_limit, 1),
        is_active = coalesce(p_is_active, true)
    where id = v_id;
    perform private.audit(v_actor, 'coupon.updated', 'coupon', v_id::text,
      jsonb_build_object('code', v_code, 'kind', v_kind, 'value', v_value));
  end if;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.quote_cart_with_coupon(p_items jsonb, p_address_id uuid, p_coupon_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if exists (
    select 1
    from private.price_cart(p_items) l
    where l.campaign_id is not null and l.campaign_coupon_policy = 'blocked'
  ) then
    return v_quote || jsonb_build_object(
      'discountMinor', 0,
      'couponProblem', 'A coupon cannot be combined with the promotion in this cart'
    );
  end if;

  begin
    v_coupon := private.claim_coupon_for_cart(p_coupon_code, v_user, p_items, v_subtotal);
    v_discount := private.coupon_order_discount(
      v_coupon, p_items, v_subtotal, coalesce((v_quote ->> 'shippingFeeMinor')::bigint, 0));
  exception
    when sqlstate 'NZ450' or sqlstate 'NZ451' or sqlstate 'NZ452' or sqlstate 'NZ453'
      or sqlstate 'NZ454' or sqlstate 'NZ455' or sqlstate 'NZ456' or sqlstate 'NZ457' or sqlstate 'NZ459' then
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
      'description', v_coupon.description,
      'isVoucher', v_coupon.is_voucher,
      'title', v_coupon.title
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.place_cod_order(p_idempotency_key uuid, p_address_id uuid, p_items jsonb, p_note text DEFAULT NULL::text, p_expected_total_minor bigint DEFAULT NULL::bigint, p_coupon_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if not private.cod_enabled() then
    raise exception 'cash on delivery is not available right now' using errcode = 'NZ423';
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

  perform 1 from private.cart_items(p_items);

  v_fingerprint := md5(jsonb_build_object(
    'address', p_address_id,
    'note', v_note,
    'coupon', upper(btrim(coalesce(p_coupon_code, ''))),
    'items', (
      select jsonb_agg(jsonb_build_array(ci.product_id, ci.variant_id, ci.quantity) order by ci.product_id, ci.variant_id)
      from private.cart_items(p_items) as ci
    )
  )::text);

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

  perform 1
  from public.products
  where id in (select ci.product_id from private.cart_items(p_items) as ci)
  order by id
  for update;

  perform 1
  from public.product_variants
  where id in (select ci.variant_id from private.cart_items(p_items) as ci where ci.variant_id is not null)
  order by id
  for update;

  select
    coalesce(sum(l.line_total_minor), 0),
    coalesce(sum(l.quantity), 0),
    jsonb_agg(jsonb_build_object('productId', l.product_id, 'variantId', l.variant_id, 'problem', l.problem)
      order by l.line_no) filter (where l.problem is not null)
  into v_subtotal, v_item_count, v_problems
  from private.price_cart(p_items) as l;

  if v_problems is not null then
    if exists (select 1 from jsonb_array_elements(v_problems) as e (p) where p ->> 'problem' = 'unavailable') then
      raise exception 'some products are not available' using errcode = 'NZ413', detail = v_problems::text;
    elsif exists (select 1 from jsonb_array_elements(v_problems) as e (p) where p ->> 'problem' = 'variant_required') then
      raise exception 'choose an option for every product that has them' using errcode = 'NZ471', detail = v_problems::text;
    elsif exists (select 1 from jsonb_array_elements(v_problems) as e (p) where p ->> 'problem' = 'variant_invalid') then
      raise exception 'one of the chosen options is no longer sold' using errcode = 'NZ470', detail = v_problems::text;
    elsif exists (select 1 from jsonb_array_elements(v_problems) as e (p) where p ->> 'problem' = 'quantity_limit') then
      raise exception 'some quantities exceed the per-order limit' using errcode = 'NZ415', detail = v_problems::text;
    else
      raise exception 'not enough stock' using errcode = 'NZ414', detail = v_problems::text;
    end if;
  end if;

  if p_coupon_code is not null and btrim(p_coupon_code) <> '' then
    -- A campaign that does not allow coupons refuses the code before it is claimed,
    -- so a blocked code is never counted as a redemption.
    if exists (
      select 1
      from private.price_cart(p_items) l
      where l.campaign_id is not null and l.campaign_coupon_policy = 'blocked'
    ) then
      raise exception 'a coupon cannot be combined with the promotion in this cart'
        using errcode = 'NZ459';
    end if;
    v_coupon := private.claim_coupon_for_cart(p_coupon_code, v_user, p_items, v_subtotal);
    v_discount := private.coupon_order_discount(v_coupon, p_items, v_subtotal, coalesce(v_fee, 0));
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
    order_id, product_id, variant_id, variant_label, product_name, product_slug, sku,
    unit_price_minor, quantity, line_total_minor,
    regular_price_minor, catalog_price_minor, campaign_id, campaign_title, campaign_discount_minor,
    image_key, image_alt
  )
  select v_order.id, l.product_id, l.variant_id, l.variant_label, l.name, l.slug, l.sku,
         l.unit_price_minor, l.quantity, l.line_total_minor,
         l.list_price_minor, l.catalog_price_minor, l.campaign_id, l.campaign_title,
         l.campaign_discount_minor,
         img.storage_key, img.alt_text
  from private.price_cart(p_items) as l
  left join lateral (
    select pi.storage_key, pi.alt_text
    from public.product_images pi
    where pi.product_id = l.product_id
    order by pi.position, pi.id
    limit 1
  ) img on true;

  if v_coupon.id is not null then
    insert into public.coupon_redemptions (coupon_id, user_id, order_id, discount_minor)
    values (v_coupon.id, v_user, v_order.id, v_discount);
  end if;

  with moved as (
    update public.product_variants v
    set stock_quantity = v.stock_quantity - ci.quantity
    from private.cart_items(p_items) as ci
    where ci.variant_id is not null and v.id = ci.variant_id
    returning v.id, v.product_id, ci.quantity, v.stock_quantity
  )
  insert into public.inventory_movements
    (product_id, variant_id, change, stock_after, reason, order_id, actor_id)
  select moved.product_id, moved.id, -moved.quantity, moved.stock_quantity,
         'order_placed', v_order.id, v_user
  from moved;

  with moved as (
    update public.products p
    set stock_quantity = p.stock_quantity - ci.quantity
    from private.cart_items(p_items) as ci
    where ci.variant_id is null and p.id = ci.product_id
    returning p.id, ci.quantity, p.stock_quantity
  )
  insert into public.inventory_movements (product_id, change, stock_after, reason, order_id, actor_id)
  select moved.id, -moved.quantity, moved.stock_quantity, 'order_placed', v_order.id, v_user
  from moved;

  insert into public.order_status_history (order_id, from_status, to_status, actor_kind, actor_id)
  values (v_order.id, null, 'pending', 'customer', v_user);

  return jsonb_build_object('orderId', v_order.id, 'orderNumber', v_order.order_number, 'created', true);
end;
$function$;

/** The collectable vouchers that apply to one product (its own, its category's or the store's). */
create or replace function public.product_vouchers(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.voucher_json(c, (select auth.uid()))
                            order by c.ends_at nulls last, c.created_at desc), '[]'::jsonb)
  from (
    select c.*
    from public.coupons c
    join public.products p
      on p.slug = p_slug and p.status = 'active' and p.moderation_status = 'approved'
    where c.is_voucher
      and c.is_active
      and (c.starts_at is null or c.starts_at <= now() + interval '7 days')
      and (c.ends_at is null or c.ends_at > now())
      and (c.audience <> 'selected_customers' or private.coupon_audience_ok(c, (select auth.uid())))
      and (
        c.scope = 'storewide'
        or (c.scope = 'products' and p.id = any (c.product_ids))
        or (c.scope = 'categories' and c.category_ids && private.category_ancestry(p.category_id))
      )
    order by c.ends_at nulls last, c.created_at desc
    limit 6
  ) c;
$$;
revoke execute on function public.product_vouchers(text) from public, anon, authenticated;
grant execute on function public.product_vouchers(text) to anon, authenticated;
