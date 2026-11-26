-- Campaigns may be presented without a customer-facing title: the card, the offer and the
-- picture can carry it alone. The column stays `not null` (readers expect a string) and the
-- function stores an empty title as '', so no client has to deal with a null heading.
--
-- Additive-in-effect: one check constraint is loosened and one function is replaced with the
-- same body except its title rule. Nothing else about campaigns changes.

alter table public.discount_campaigns
  drop constraint discount_campaigns_customer_title_check;

alter table public.discount_campaigns
  add constraint discount_campaigns_customer_title_check
  check (char_length(btrim(customer_title)) <= 120);
CREATE OR REPLACE FUNCTION public.admin_save_campaign(p_campaign_id uuid, p_name text, p_customer_title text, p_scope public.campaign_scope, p_discount_kind public.campaign_discount_kind, p_discount_value bigint, p_max_discount_minor bigint DEFAULT NULL::bigint, p_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_priority integer DEFAULT 0, p_is_visible boolean DEFAULT true, p_banner_image_key text DEFAULT NULL::text, p_coupon_policy public.campaign_coupon_policy DEFAULT 'stackable'::public.campaign_coupon_policy, p_category_ids uuid[] DEFAULT NULL::uuid[], p_brand_ids uuid[] DEFAULT NULL::uuid[], p_product_ids uuid[] DEFAULT NULL::uuid[], p_internal_notes text DEFAULT NULL::text, p_expected_version integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_title text := btrim(coalesce(p_customer_title, ''));
  v_notes text := nullif(btrim(coalesce(p_internal_notes, '')), '');
  v_banner text := nullif(btrim(coalesce(p_banner_image_key, '')), '');
  v_categories uuid[] := coalesce(p_category_ids, '{}'::uuid[]);
  v_brands uuid[] := coalesce(p_brand_ids, '{}'::uuid[]);
  v_products uuid[] := coalesce(p_product_ids, '{}'::uuid[]);
  v_campaign public.discount_campaigns;
  v_id uuid := p_campaign_id;
begin
  if p_campaign_id is null then
    v_actor := private.require_permission('discounts.create');
  else
    v_actor := private.require_permission('discounts.edit');
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'give the campaign a name of 1-120 characters' using errcode = 'NZ491';
  end if;
  -- The customer-facing title is optional: a campaign can speak through its offer, its
  -- picture and its card alone.
  if char_length(v_title) > 120 then
    raise exception 'keep the customer-facing title under 120 characters' using errcode = 'NZ491';
  end if;
  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'keep the internal notes under 500 characters' using errcode = 'NZ491';
  end if;
  if p_discount_value is null or p_discount_value < 1 then
    raise exception 'the discount must be more than zero' using errcode = 'NZ491';
  end if;
  if p_discount_kind = 'percent' and p_discount_value > 100 then
    raise exception 'a percentage cannot exceed 100' using errcode = 'NZ491';
  end if;
  if p_discount_kind = 'fixed' and p_max_discount_minor is not null then
    raise exception 'a fixed discount needs no cap' using errcode = 'NZ491';
  end if;
  if p_max_discount_minor is not null and p_max_discount_minor < 1 then
    raise exception 'the maximum discount must be more than zero' using errcode = 'NZ491';
  end if;
  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'the end must be after the start' using errcode = 'NZ491';
  end if;
  if p_priority is null or p_priority < -100 or p_priority > 100 then
    raise exception 'the priority must be between -100 and 100' using errcode = 'NZ491';
  end if;

  perform private.validate_campaign_targets(p_scope, v_categories, v_brands, v_products);

  if v_id is null then
    if exists (
      select 1 from public.discount_campaigns c
      where lower(c.name) = lower(v_name) and c.status not in ('archived', 'ended')
    ) then
      raise exception 'another open campaign already uses this name' using errcode = 'NZ491';
    end if;

    insert into public.discount_campaigns (
      name, internal_notes, customer_title, scope, discount_kind, discount_value,
      max_discount_minor, starts_at, ends_at, priority, is_visible, banner_image_key,
      coupon_policy, created_by, updated_by
    ) values (
      v_name, v_notes, v_title, p_scope, p_discount_kind, p_discount_value,
      case when p_discount_kind = 'percent' then p_max_discount_minor else null end,
      p_starts_at, p_ends_at, p_priority, coalesce(p_is_visible, true), v_banner,
      p_coupon_policy, v_actor, v_actor
    )
    returning * into v_campaign;

    v_id := v_campaign.id;
    perform private.audit(v_actor, 'discount_campaign.created', 'discount_campaign', v_id::text,
      jsonb_build_object(
        'name', v_name, 'scope', p_scope, 'kind', p_discount_kind,
        'value', p_discount_value, 'priority', p_priority));
  else
    select * into v_campaign from public.discount_campaigns c
    where c.id = p_campaign_id
    for update;
    if not found then
      raise exception 'campaign not found' using errcode = 'NZ490';
    end if;
    if v_campaign.status = 'archived' then
      raise exception 'an archived campaign cannot be edited' using errcode = 'NZ491';
    end if;
    if p_expected_version is null or p_expected_version <> v_campaign.version then
      raise exception 'this campaign changed since you opened it; reload and try again'
        using errcode = 'NZ492';
    end if;
    if p_priority <> v_campaign.priority then
      perform private.require_permission('discounts.manage_priority');
    end if;
    if p_coupon_policy <> v_campaign.coupon_policy then
      perform private.require_permission('discounts.manage_coupon_policy');
    end if;
    if exists (
      select 1 from public.discount_campaigns c
      where lower(c.name) = lower(v_name) and c.id <> v_id
        and c.status not in ('archived', 'ended')
    ) then
      raise exception 'another open campaign already uses this name' using errcode = 'NZ491';
    end if;

    update public.discount_campaigns
    set name = v_name,
        internal_notes = v_notes,
        customer_title = v_title,
        scope = p_scope,
        discount_kind = p_discount_kind,
        discount_value = p_discount_value,
        max_discount_minor = case when p_discount_kind = 'percent' then p_max_discount_minor else null end,
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        priority = p_priority,
        is_visible = coalesce(p_is_visible, true),
        banner_image_key = v_banner,
        coupon_policy = p_coupon_policy,
        updated_by = v_actor,
        updated_at = now(),
        version = version + 1
    where id = v_id
    returning * into v_campaign;

    perform private.audit(v_actor, 'discount_campaign.updated', 'discount_campaign', v_id::text,
      jsonb_build_object(
        'name', v_name,
        'scope', p_scope,
        'kind', p_discount_kind,
        'value', p_discount_value,
        'priority', p_priority,
        'couponPolicy', p_coupon_policy));
  end if;

  delete from public.discount_campaign_products where campaign_id = v_id;
  delete from public.discount_campaign_categories where campaign_id = v_id;
  delete from public.discount_campaign_brands where campaign_id = v_id;

  if p_scope = 'products' then
    insert into public.discount_campaign_products (campaign_id, product_id)
    select v_id, x from unnest(v_products) x;
  elsif p_scope = 'categories' then
    insert into public.discount_campaign_categories (campaign_id, category_id)
    select v_id, x from unnest(v_categories) x;
  elsif p_scope = 'brands' then
    insert into public.discount_campaign_brands (campaign_id, brand_id)
    select v_id, x from unnest(v_brands) x;
  end if;

  select * into v_campaign from public.discount_campaigns c where c.id = v_id;
  return private.campaign_view(v_campaign);
end;
$function$

