-- ===========================================================================
-- Size and colour filtering, and the options each listing can offer
-- ===========================================================================
-- Sizes and colours are not free text and not a separate list anyone maintains: they are the
-- product variant system that Admin already writes — `product_attributes.kind` ('size' or
-- 'color'), its values, and the variants that pair them. A shopper filters by a value that a
-- real, active variant of a published product actually carries.
--
-- Two additions:
--
--   1. catalog_variant_product_ids()  the products that have one active variant carrying every
--                                     requested size and every requested colour. It is what
--                                     makes the listing filter a filter rather than a post-hoc
--                                     sift in the client.
--   2. catalog_variant_facets()       the sizes and colours on offer for the current listing
--                                     context, so a page only ever shows values that exist in
--                                     the set it is actually listing.
--
-- Both are SECURITY DEFINER for the same reason catalog_product_colors() is: the variant
-- tables have no end-user policy (they are read only through narrow functions), so a policy
-- -bound read from the storefront would see nothing. Both apply the products/categories
-- visibility rule themselves, so neither can reveal a draft product's variant values.
--
-- No table, column, variant, SKU, price or stock row is changed. Only a read path is added.
-- ===========================================================================

/**
 * The products with one active variant that carries all of the requested size values and all of
 * the requested colour values. Both lists may be empty or null (nothing asked).
 *
 * The match is per variant, not per product: asking for size M and colour Black means one
 * variant that is both, which is the only reading a shopper expects. A product therefore
 * appears at most once, however many of its variants match.
 */
create function public.catalog_variant_product_ids(
  p_size_slugs text[] default null,
  p_color_slugs text[] default null
)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct v.product_id
  from public.product_variants v
  join public.products p on p.id = v.product_id
  join public.categories c on c.id = p.category_id
  where v.is_active
    and p.status = 'active'
    and c.is_active
    -- Every requested size must be on this same variant.
    and not exists (
      select 1
      from unnest(coalesce(p_size_slugs, '{}'::text[])) as wanted(slug)
      where not exists (
        select 1
        from public.product_variant_values pvv
        join public.product_attribute_values av on av.id = pvv.attribute_value_id
        join public.product_attributes a on a.id = pvv.attribute_id
        where pvv.variant_id = v.id
          and a.kind = 'size'
          and av.slug = wanted.slug
      )
    )
    and not exists (
      select 1
      from unnest(coalesce(p_color_slugs, '{}'::text[])) as wanted(slug)
      where not exists (
        select 1
        from public.product_variant_values pvv
        join public.product_attribute_values av on av.id = pvv.attribute_value_id
        join public.product_attributes a on a.id = pvv.attribute_id
        where pvv.variant_id = v.id
          and a.kind = 'color'
          and av.slug = wanted.slug
      )
    );
$$;

comment on function public.catalog_variant_product_ids(text[], text[]) is
  'Products with one active variant carrying every requested size and colour value. Read only.';

/**
 * The sizes and colours on offer for one listing context, as JSON:
 *
 *   { "sizes":  [ { "slug", "value", "count" } … ],
 *     "colors": [ { "slug", "value", "count", "swatchHex" } … ] }
 *
 * The context is the same one the listing is built from (category branch, search, brand, price
 * window, availability, collection), so a page never offers a value that would empty it.
 *
 * The two dimensions are computed the other way round on purpose: the sizes are narrowed by the
 * colour already chosen, and the colours by the size already chosen. That is what stops a
 * shopper from clicking into a combination nothing is sold in, while still letting them change
 * either choice. `count` is the number of distinct products offering that value.
 */
create function public.catalog_variant_facets(
  p_category_slug text default null,
  p_query text default null,
  p_branch_slugs text[] default null,
  p_brand_slug text default null,
  p_min_price_minor bigint default null,
  p_max_price_minor bigint default null,
  p_in_stock boolean default null,
  p_zone_slug text default null,
  p_size_slugs text[] default null,
  p_color_slugs text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query tsquery;
  v_result jsonb;
begin
  if p_query is not null then
    v_query := to_tsquery('simple'::regconfig, p_query);
  end if;

  with matched as (
    select
      p.id,
      p.compare_at_price_minor,
      p.price_minor,
      coalesce(p.compare_at_price_minor, p.price_minor) as list_minor
    from public.products p
    join public.categories c on c.id = p.category_id
    left join public.brands b on b.id = p.brand_id
    where p.status = 'active'
      and c.is_active
      and (p_branch_slugs is not null or p_category_slug is null or c.slug = p_category_slug)
      and (p_branch_slugs is null or c.slug = any (p_branch_slugs))
      and (p_brand_slug is null or b.slug = p_brand_slug)
      and (v_query is null or p.search @@ v_query)
      and (p_in_stock is not true or p.stock_quantity > 0)
      and public.product_in_zone(p_zone_slug, p.id, p.category_id)
  ),
  priced as (
    select
      m.id,
      case
        when k.campaign_id is null then m.price_minor
        else m.list_minor - public.campaign_discount_minor(
          m.list_minor, k.discount_kind, k.discount_value, k.max_discount_minor)
      end as effective_minor
    from matched m
    left join public.product_campaigns(array(select m2.id from matched m2)) k on k.product_id = m.id
  ),
  filtered as (
    select * from priced f
    where (p_min_price_minor is null or f.effective_minor >= p_min_price_minor)
      and (p_max_price_minor is null or f.effective_minor <= p_max_price_minor)
  ),
  offered as (
    select f.id as product_id, a.kind, av.slug, av.value, av.position, av.swatch_hex
    from filtered f
    join public.product_variants v on v.product_id = f.id and v.is_active
    join public.product_variant_values pvv on pvv.variant_id = v.id
    join public.product_attribute_values av on av.id = pvv.attribute_value_id
    join public.product_attributes a on a.id = pvv.attribute_id
    where a.kind in ('size', 'color')
      and a.is_active
      -- A colour with no variant offering it is not offered: only a matching variant of a live
      -- product counts, and an in-stock listing only counts variants that can be bought.
      and (p_in_stock is not true or v.stock_quantity > 0)
      and (
        (p_size_slugs is null and p_color_slugs is null)
        or f.id in (select public.catalog_variant_product_ids(p_size_slugs, p_color_slugs))
      )
  )
  select jsonb_build_object(
    'sizes', coalesce((
      select jsonb_agg(
               jsonb_build_object('slug', s.slug, 'value', s.value, 'count', s.products)
               order by s.position, s.value)
      from (
        select o.slug, min(o.value) as value, min(o.position) as position,
               count(distinct o.product_id)::int as products
        from offered o
        where o.kind = 'size'
          -- Narrowed by the colours already chosen, never by the sizes themselves.
          and (
            p_color_slugs is null
            or o.product_id in (select public.catalog_variant_product_ids(null, p_color_slugs))
          )
        group by o.slug
      ) s
    ), '[]'::jsonb),
    'colors', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'slug', c.slug, 'value', c.value, 'count', c.products,
                 'swatchHex', c.swatch_hex)
               order by c.position, c.value)
      from (
        select o.slug, min(o.value) as value, min(o.position) as position,
               min(o.swatch_hex) as swatch_hex,
               count(distinct o.product_id)::int as products
        from offered o
        where o.kind = 'color'
          -- Narrowed by the sizes already chosen, never by the colours themselves.
          and (
            p_size_slugs is null
            or o.product_id in (select public.catalog_variant_product_ids(p_size_slugs, null))
          )
        group by o.slug
      ) c
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

comment on function public.catalog_variant_facets(
  text, text, text[], text, bigint, bigint, boolean, text, text[], text[]
) is
  'The size and colour values on offer for a listing context, narrowed by the other dimension. Read only.';

-- ---------------------------------------------------------------------------
-- The listing itself: size and colour become real filters
-- ---------------------------------------------------------------------------

/*
 * The two new arguments change the signature, and a named-argument call cannot tell two
 * overloads apart, so the previous eleven-argument version is dropped first. Every caller in
 * this repository passes p_size_slugs/p_color_slugs (or relies on their defaults), and the
 * grants are restored below.
 */
drop function public.catalog_products(
  text, text, text, integer, integer, text[], text, bigint, bigint, boolean, text
);

create function public.catalog_products(
  p_category_slug text default null,
  p_query text default null,
  p_sort text default 'featured',
  p_limit integer default 24,
  p_offset integer default 0,
  p_branch_slugs text[] default null,
  p_brand_slug text default null,
  p_min_price_minor bigint default null,
  p_max_price_minor bigint default null,
  p_in_stock boolean default null,
  p_zone_slug text default null,
  p_size_slugs text[] default null,
  p_color_slugs text[] default null
)
returns table (
  id uuid,
  slug text,
  sku text,
  name text,
  summary text,
  price_minor bigint,
  compare_at_price_minor bigint,
  stock_quantity integer,
  max_order_quantity integer,
  is_featured boolean,
  published_at timestamptz,
  category_slug text,
  category_name text,
  campaign_id uuid,
  campaign_title text,
  campaign_ends_at timestamptz,
  campaign_discount_kind public.campaign_discount_kind,
  campaign_discount_value bigint,
  total_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_query tsquery;
begin
  if p_limit is null or p_limit not between 1 and 60 or p_offset is null or p_offset not between 0 and 10000 then
    raise exception 'invalid page' using errcode = '22023';
  end if;
  if p_sort is null or p_sort not in ('featured', 'newest', 'price_asc', 'price_desc', 'relevance') then
    raise exception 'invalid sort' using errcode = '22023';
  end if;
  if p_query is not null then
    v_query := to_tsquery('simple'::regconfig, p_query);
  end if;

  return query
  with matched as (
    select
      p.id, p.slug, p.sku, p.name, p.summary, p.price_minor, p.compare_at_price_minor,
      p.stock_quantity, p.max_order_quantity, p.is_featured, p.published_at,
      coalesce(p.compare_at_price_minor, p.price_minor) as list_minor,
      p.search, c.slug as category_slug, c.name as category_name
    from public.products p
    join public.categories c on c.id = p.category_id
    left join public.brands b on b.id = p.brand_id
    where p.status = 'active'
      and c.is_active
      and (p_branch_slugs is not null or p_category_slug is null or c.slug = p_category_slug)
      and (p_branch_slugs is null or c.slug = any (p_branch_slugs))
      and (p_brand_slug is null or b.slug = p_brand_slug)
      and (v_query is null or p.search @@ v_query)
      and (p_in_stock is not true or p.stock_quantity > 0)
      -- The zone filter is a membership test, never a join: a product that qualifies through
      -- several zones (or through both an explicit row and its category) appears exactly once.
      and public.product_in_zone(p_zone_slug, p.id, p.category_id)
      -- A variant filter is a membership test too, so several matching variants still yield
      -- one row, and the count below stays the number of products rather than of variants.
      and (
        (p_size_slugs is null and p_color_slugs is null)
        or p.id in (select public.catalog_variant_product_ids(p_size_slugs, p_color_slugs))
      )
  ),
  priced as (
    select
      m.*,
      k.campaign_id, k.campaign_title, k.ends_at as campaign_ends_at,
      k.discount_kind as campaign_discount_kind, k.discount_value as campaign_discount_value,
      case
        when k.campaign_id is null then m.price_minor
        else m.list_minor - public.campaign_discount_minor(
          m.list_minor, k.discount_kind, k.discount_value, k.max_discount_minor)
      end as effective_minor,
      case
        when k.campaign_id is null then m.compare_at_price_minor
        else m.list_minor
      end as effective_compare_minor
    from matched m
    left join public.product_campaigns(array(select m2.id from matched m2)) k on k.product_id = m.id
  ),
  filtered as (
    select * from priced f
    where (p_min_price_minor is null or f.effective_minor >= p_min_price_minor)
      and (p_max_price_minor is null or f.effective_minor <= p_max_price_minor)
  )
  select
    f.id, f.slug, f.sku, f.name, f.summary, f.effective_minor, f.effective_compare_minor,
    f.stock_quantity, f.max_order_quantity, f.is_featured, f.published_at,
    f.category_slug, f.category_name,
    f.campaign_id, f.campaign_title, f.campaign_ends_at,
    f.campaign_discount_kind, f.campaign_discount_value,
    count(*) over ()
  from filtered f
  order by
    case when p_sort = 'relevance' and v_query is not null
      then ts_rank(f.search, v_query) end desc nulls last,
    case when p_sort = 'featured' then f.is_featured end desc nulls last,
    case when p_sort = 'price_asc' then f.effective_minor end asc nulls last,
    case when p_sort = 'price_desc' then f.effective_minor end desc nulls last,
    f.published_at desc,
    f.id
  limit p_limit
  offset p_offset;
end;
$$;

comment on function public.catalog_products(
  text, text, text, integer, integer, text[], text, bigint, bigint, boolean, text, text[], text[]
) is
  'One page of the public catalogue, priced with its live campaign. Size and colour match on a single variant.';

-- ---------------------------------------------------------------------------
-- Grants: the reads are public, the tables behind them stay closed
-- ---------------------------------------------------------------------------

revoke execute on function public.catalog_variant_product_ids(text[], text[])
  from public, anon, authenticated;
revoke execute on function public.catalog_variant_facets(
  text, text, text[], text, bigint, bigint, boolean, text, text[], text[]
) from public, anon, authenticated;
revoke execute on function public.catalog_products(
  text, text, text, integer, integer, text[], text, bigint, bigint, boolean, text, text[], text[]
) from public, anon, authenticated;

grant execute on function public.catalog_variant_product_ids(text[], text[])
  to anon, authenticated, service_role;
grant execute on function public.catalog_variant_facets(
  text, text, text[], text, bigint, bigint, boolean, text, text[], text[]
) to anon, authenticated, service_role;
grant execute on function public.catalog_products(
  text, text, text, integer, integer, text[], text, bigint, bigint, boolean, text, text[], text[]
) to anon, authenticated, service_role;
