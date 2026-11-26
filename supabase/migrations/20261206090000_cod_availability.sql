-- ---------------------------------------------------------------------------
-- Cash on delivery can be switched off
--
-- 1. `store_settings.cod_enabled` is the store's answer to "is cash on delivery open?".
--    It starts true, so nothing changes for an existing shop.
--
-- 2. `public_store_profile()` reports it as `codAvailable`, so the storefront and the app can
--    draw the payment step honestly without asking for an admin permission.
--
-- 3. `place_cod_order` refuses with NZ423 (payment_unavailable) when it is off: the database
--    is the boundary, so a checkout page left open overnight cannot place a cash order after
--    the switch was turned off. Every other rule of the order transaction is unchanged.
--
-- 4. `admin_save_store_settings` gains a trailing `p_cod_enabled` that defaults to null, and
--    `admin_store_settings` reports the value to the settings page. Null means "leave the
--    switch as it is", so a caller written before this migration — which can only pass the
--    five original arguments — keeps working without silently turning cash orders back on.
--    bKash and Nagad have no setting at all: they stay unavailable until their own
--    integrations exist.
--
-- Additive: one column, one helper, and functions whose arguments only gain a default.
-- ---------------------------------------------------------------------------

alter table public.store_settings
  add column cod_enabled boolean not null default true;

comment on column public.store_settings.cod_enabled is
  'Whether customers may place a cash-on-delivery order right now.';

/** Whether cash on delivery may be placed. Deny by default if the row is missing. */
create or replace function private.cod_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select cod_enabled from public.store_settings where id), false);
$$;

-- ---------------------------------------------------------------------------
-- Admin: read and save the switch
-- ---------------------------------------------------------------------------
create or replace function public.admin_store_settings()
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
             'repeatOrderThreshold', repeat_order_threshold,
             'highSpendThresholdMinor', high_spend_threshold_minor,
             'inactiveDays', inactive_days,
             'monthlySalesTargetMinor', monthly_sales_target_minor,
             'codEnabled', cod_enabled,
             'updatedAt', updated_at
           )
    from public.store_settings where id
  );
end;
$$;

drop function public.admin_save_store_settings(integer, integer, integer, bigint, integer);
create function public.admin_save_store_settings(p_return_window_days integer, p_cart_inactivity_minutes integer, p_repeat_order_threshold integer, p_high_spend_threshold_minor bigint, p_inactive_days integer,
  p_cod_enabled boolean default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
begin
  perform public.admin_save_store_settings(p_return_window_days, p_cart_inactivity_minutes);
  if p_repeat_order_threshold is not null or p_high_spend_threshold_minor is not null
     or p_inactive_days is not null then
    perform public.admin_save_insight_thresholds(
      p_repeat_order_threshold, p_high_spend_threshold_minor, p_inactive_days);
  end if;
  if p_cod_enabled is not null then
    update public.store_settings set cod_enabled = p_cod_enabled, updated_by = v_actor where id;
    perform private.audit(v_actor, 'settings.payments_saved', 'store_settings', 'settings',
      jsonb_build_object('codEnabled', p_cod_enabled));
  end if;
  return public.admin_store_settings();
end;
$$;
revoke execute on function public.admin_save_store_settings(
  integer, integer, integer, bigint, integer, boolean
) from public, anon, authenticated;
grant execute on function public.admin_save_store_settings(
  integer, integer, integer, bigint, integer, boolean
) to authenticated;

-- ---------------------------------------------------------------------------
-- Customers: does the profile offer cash on delivery?
-- ---------------------------------------------------------------------------
create or replace function public.public_store_profile()
 returns jsonb
 language sql
 stable
 security definer
 set search_path = ''
as $$
  select jsonb_build_object(
    'displayName', p.display_name,
    'tagline', p.tagline,
    'description', p.description,
    'logoKey', p.logo_key,
    'contactEmail', p.contact_email,
    'contactPhone', p.contact_phone,
    'addressLine', p.address_line,
    'addressArea', p.address_area,
    'addressDistrict', p.address_district,
    'businessHours', p.business_hours,
    'supportEmail', p.support_email,
    'supportPhone', p.support_phone,
    'social', jsonb_strip_nulls(jsonb_build_object(
      'facebook', p.social_facebook,
      'instagram', p.social_instagram,
      'youtube', p.social_youtube,
      'tiktok', p.social_tiktok,
      'x', p.social_x
    )),
    'defaultSeoTitle', p.default_seo_title,
    'defaultSeoDescription', p.default_seo_description,
    'ogImageKey', p.og_image_key,
    'whatsappNumber', p.whatsapp_number,
    'playStoreUrl', p.play_store_url,
    'appStoreUrl', p.app_store_url,
    'codAvailable', (select s.cod_enabled from public.store_settings s where s.id),
    'updatedAt', p.updated_at
  )
  from public.store_profile p
  where p.id;
$$;

-- ---------------------------------------------------------------------------
-- The order itself: refused while cash on delivery is switched off
-- ---------------------------------------------------------------------------
create or replace function public.place_cod_order(p_idempotency_key uuid, p_address_id uuid, p_items jsonb, p_note text default null, p_expected_total_minor bigint default null, p_coupon_code text default null)
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
    v_discount := private.coupon_cart_discount(v_coupon, p_items, v_subtotal);
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
$$;

revoke execute on function public.place_cod_order(uuid, uuid, jsonb, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.place_cod_order(uuid, uuid, jsonb, text, bigint, text)
  to authenticated;
