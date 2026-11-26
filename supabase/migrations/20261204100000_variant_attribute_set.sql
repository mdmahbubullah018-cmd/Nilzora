-- ---------------------------------------------------------------------------
-- Every variant of a product names the same attributes
--
-- The storefront and the app ask a shopper for one value per attribute the product's
-- variants use, then look for the variant with exactly those values. A variant that
-- names fewer (or other) attributes than its siblings can therefore never be chosen:
-- a "Size: M" variant beside "Size: L / Colour: Navy" is unreachable, and so is its
-- stock. admin_save_variant now refuses such a variant (NZ471 variant_required), and
-- refuses a variant with no values at all.
--
-- Reproduced from 20261103090000 with only those two checks added; the signature,
-- grants and every other rule are unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.admin_save_variant(
  p_variant_id uuid,
  p_product_id uuid,
  p_sku text,
  p_price_minor bigint,
  p_compare_at_price_minor bigint,
  p_image_url text,
  p_position integer,
  p_is_active boolean,
  p_attribute_value_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.update');
  v_id uuid;
  v_price bigint := p_price_minor;
  v_values uuid[] := coalesce(p_attribute_value_ids, '{}'::uuid[]);
  v_attributes uuid[];
begin
  if p_product_id is null then
    raise exception 'a product is required' using errcode = 'NZ412';
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'product not found' using errcode = 'NZ404';
  end if;
  if p_sku is null or p_sku !~ '^[A-Z0-9][A-Z0-9-]{1,39}$' then
    raise exception 'the variant SKU is not valid' using errcode = 'NZ412';
  end if;
  if v_price is not null and (v_price < 1 or v_price > 1000000000) then
    raise exception 'the variant price is not valid' using errcode = 'NZ412';
  end if;
  if p_compare_at_price_minor is not null
     and (v_price is null or p_compare_at_price_minor <= v_price) then
    raise exception 'the former price must be higher than the variant price' using errcode = 'NZ412';
  end if;
  if p_image_url is not null and char_length(p_image_url) > 500 then
    raise exception 'the image address is too long' using errcode = 'NZ412';
  end if;
  if cardinality(v_values) = 0 then
    raise exception 'choose a value for at least one attribute' using errcode = 'NZ471';
  end if;

  if exists (select 1 from public.product_variants
             where sku = p_sku and id is distinct from p_variant_id) then
    raise exception 'this SKU is already used' using errcode = 'NZ472';
  end if;

  -- A variant needs exactly one value per attribute, and never two of the same one.
  if exists (
    select 1
    from public.product_attribute_values av
    where av.id = any (v_values)
    group by av.attribute_id
    having count(*) > 1
  ) then
    raise exception 'a variant may hold only one value per attribute' using errcode = 'NZ412';
  end if;
  if exists (
    select 1 from unnest(v_values) as v(id)
    where not exists (select 1 from public.product_attribute_values av where av.id = v.id)
  ) then
    raise exception 'one of the chosen values no longer exists' using errcode = 'NZ412';
  end if;

  -- The attributes this variant names must be the ones every other variant of the
  -- product names, or shoppers could never choose it.
  select coalesce(array_agg(distinct av.attribute_id order by av.attribute_id), '{}'::uuid[])
  into v_attributes
  from public.product_attribute_values av
  where av.id = any (v_values);

  if exists (
    select 1
    from public.product_variants other
    where other.product_id = p_product_id
      and other.id is distinct from p_variant_id
      and (select coalesce(array_agg(distinct pvv.attribute_id order by pvv.attribute_id), '{}'::uuid[])
           from public.product_variant_values pvv where pvv.variant_id = other.id)
          <> v_attributes
  ) then
    raise exception 'every variant of a product needs a value for the same attributes'
      using errcode = 'NZ471';
  end if;

  if p_variant_id is null then
    insert into public.product_variants
      (product_id, sku, price_minor, compare_at_price_minor, image_url, position, is_active)
    values (p_product_id, p_sku, v_price, p_compare_at_price_minor, p_image_url,
            coalesce(p_position, 0), coalesce(p_is_active, true))
    returning id into v_id;
  else
    update public.product_variants
    set sku = p_sku,
        price_minor = v_price,
        compare_at_price_minor = p_compare_at_price_minor,
        image_url = p_image_url,
        position = coalesce(p_position, position),
        is_active = coalesce(p_is_active, is_active)
    where id = p_variant_id and product_id = p_product_id
    returning id into v_id;
    if v_id is null then
      raise exception 'variant not found' using errcode = 'NZ404';
    end if;

    if exists (
      select 1
      from public.order_items oi
      join public.product_variants v on v.id = v_id
      where oi.variant_id = v_id and oi.sku <> p_sku
    ) then
      raise exception 'this variant appears on a past order, so its SKU cannot change'
        using errcode = 'NZ412';
    end if;
  end if;

  -- Combinations are unique per product: two variants may not share the same values.
  if exists (
    select 1
    from public.product_variants other
    where other.product_id = p_product_id
      and other.id <> v_id
      and (select coalesce(array_agg(pvv.attribute_value_id order by pvv.attribute_value_id), '{}'::uuid[])
           from public.product_variant_values pvv where pvv.variant_id = other.id)
          = (select coalesce(array_agg(x order by x), '{}'::uuid[]) from unnest(v_values) as x)
  ) then
    raise exception 'a variant with these options already exists' using errcode = 'NZ472';
  end if;

  delete from public.product_variant_values where variant_id = v_id;
  insert into public.product_variant_values (variant_id, attribute_id, attribute_value_id)
  select v_id, av.attribute_id, av.id
  from public.product_attribute_values av
  where av.id = any (v_values);

  perform private.audit(v_actor,
    case when p_variant_id is null then 'variant.created' else 'variant.updated' end,
    'product_variant', v_id::text,
    jsonb_build_object('product', p_product_id, 'sku', p_sku, 'priceMinor', v_price));
  return v_id;
end;
$$;

revoke execute on function public.admin_save_variant(uuid, uuid, text, bigint, bigint, text, integer, boolean, uuid[])
  from public, anon, authenticated;
grant execute on function public.admin_save_variant(uuid, uuid, text, bigint, bigint, text, integer, boolean, uuid[])
  to authenticated;
