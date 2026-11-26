-- Launch hardening (additive only: new indexes and two replaced function bodies).
--
-- 1. Foreign-key indexes that real queries need. Chosen from the functions that filter on these
--    columns and from the ON DELETE actions that scan them, not from a checklist: of the 116
--    foreign keys without a leading index, these are the ones on a request path or on a table
--    that grows without bound (guest carts). All are small today, so a plain CREATE INDEX inside
--    the migration transaction is brief.
--      chat_attachments.conversation_id   six chat functions filter on it
--      order_items.variant_id             admin_save_variant / admin_delete_variant; ON DELETE SET NULL
--      inventory_movements.variant_id     admin_delete_variant; ON DELETE SET NULL
--      cart_items.variant_id / product_id ON DELETE CASCADE from variants and products
--      wishlist_items.product_id          ON DELETE CASCADE from products
--      carts.converted_order_id           checkout_converted()
--
-- 2. A coupon used on an order that was later cancelled is available again: private.claim_coupon
--    (checkout) and private.voucher_json (the customer's voucher state) count only redemptions
--    whose order was not cancelled. No redemption row is changed or removed.
--
-- 3. The staff notification count, list and mark-all-read evaluated
--    private.has_permission(n.audience_permission) for every notification row, and each call
--    recomputed the caller's whole permission set: measured locally at ~225 ms per unread-count
--    call with 1,304 notifications, growing linearly, on a query the admin header polls. The
--    caller's permissions are now computed once per call. Same visibility rule: a row is visible
--    when it is addressed to the caller, or broadcast to a permission the caller holds (a null
--    audience, or a caller with no permissions, still sees no broadcast).
--
-- 4. The courier migrations (20261223091000, 20261224090000) revoked EXECUTE on every function in
--    the private schema from PUBLIC. That also caught four pure, IMMUTABLE validators that CHECK
--    constraints call, and a constraint's function needs EXECUTE for the role doing the write. Since
--    then the service role could not insert or update products, brands or export jobs directly
--    (permission denied for function size_chart_valid); only the owner-run security-definer
--    functions still could. They read no table and reveal nothing, so EXECUTE goes back to the
--    service role only. Nobody else writes these tables directly.

create index if not exists chat_attachments_conversation_idx
  on public.chat_attachments (conversation_id);
create index if not exists order_items_variant_idx
  on public.order_items (variant_id) where variant_id is not null;
create index if not exists inventory_movements_variant_idx
  on public.inventory_movements (variant_id, created_at desc) where variant_id is not null;
create index if not exists cart_items_variant_idx
  on public.cart_items (variant_id) where variant_id is not null;
create index if not exists cart_items_product_idx
  on public.cart_items (product_id);
create index if not exists wishlist_items_product_idx
  on public.wishlist_items (product_id);
create index if not exists carts_converted_order_idx
  on public.carts (converted_order_id) where converted_order_id is not null;

CREATE OR REPLACE FUNCTION private.claim_coupon(p_code text, p_user uuid, p_subtotal bigint)
 RETURNS coupons
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- A cancelled order never received its discount, so it no longer uses up the coupon.
  -- The redemption row itself is kept as history. The coupon row is locked above, so two
  -- checkouts counting at the same moment are still serialised.
  select count(*) into v_used
  from public.coupon_redemptions r
  join public.orders o on o.id = r.order_id and o.status <> 'cancelled'
  where r.coupon_id = v_coupon.id;

  if v_coupon.total_limit is not null and v_used >= v_coupon.total_limit then
    raise exception 'this coupon has reached its usage limit' using errcode = 'NZ456';
  end if;

  select count(*) into v_used_by_customer
  from public.coupon_redemptions r
  join public.orders o on o.id = r.order_id and o.status <> 'cancelled'
  where r.coupon_id = v_coupon.id and r.user_id = p_user;

  if v_used_by_customer >= v_coupon.per_customer_limit then
    raise exception 'you have already used this coupon' using errcode = 'NZ457';
  end if;

  return v_coupon;
end;
$function$;

CREATE OR REPLACE FUNCTION private.voucher_json(p_coupon coupons, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    join public.orders o on o.id = r.order_id and o.status <> 'cancelled'
    where r.coupon_id = p_coupon.id and r.user_id = p_user;
  end if;
  select count(*) into v_collections from public.voucher_collections vc where vc.coupon_id = p_coupon.id;
  select count(*) into v_redeemed from public.coupon_redemptions r
  join public.orders o on o.id = r.order_id and o.status <> 'cancelled'
  where r.coupon_id = p_coupon.id;

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
$function$;

CREATE OR REPLACE FUNCTION public.my_unread_notification_count()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select count(*)::integer
  from public.staff_notifications n
  where n.read_at is null
    and (
      n.recipient_id = (select auth.uid())
      or (n.recipient_id is null and n.audience_permission = any (
        array(select x.name from private.permissions_of((select auth.uid())) as x (name))
      ))
    );
$function$;

CREATE OR REPLACE FUNCTION public.my_staff_notifications(p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, kind staff_notification_kind, title text, body text, entity_type text, entity_id text, action_path text, read_at timestamp with time zone, created_at timestamp with time zone, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := (select auth.uid());
  -- Once per call, not once per notification row (see the header of this migration).
  v_permissions text[] := array(select x.name from private.permissions_of(v_user) as x (name));
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;

  return query
  with visible as (
    select n.*
    from public.staff_notifications n
    where (n.recipient_id = v_user)
       or (n.recipient_id is null and n.audience_permission = any (v_permissions))
  )
  select v.id, v.kind, v.title, v.body, v.entity_type, v.entity_id, v.action_path,
         v.read_at, v.created_at, count(*) over () as total_count
  from visible v
  order by v.created_at desc, v.id
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_all_staff_notifications_read()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := (select auth.uid());
  -- Once per call, not once per notification row (see the header of this migration).
  v_permissions text[] := array(select x.name from private.permissions_of(v_user) as x (name));
  v_count integer;
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;

  update public.staff_notifications n
  set read_at = now()
  where n.read_at is null
    and (
      n.recipient_id = v_user
      or (n.recipient_id is null and n.audience_permission = any (v_permissions))
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

grant execute on function private.size_chart_valid(jsonb) to service_role;
grant execute on function private.product_tags_valid(text[]) to service_role;
grant execute on function private.is_reserved_slug(text) to service_role;
grant execute on function private.report_permission(text) to service_role;
