/*
 * Shopping zones gain a picture of their own for the app.
 *
 * The storefront draws a zone as a 3:2 artwork with the name under it; the app draws the whole
 * card as artwork with its words inside. The same 3:2 picture does not work for both, so a zone
 * now keeps two independent pictures: `banner_key` (the site) and `mobile_banner_key` (the app).
 * Uploading or removing either one only ever touches its own column, so an admin can change the
 * app's artwork without the website changing, and the other way round.
 *
 * The key's own prefix carries its purpose — `zone-mobile-banners/<zone>/<picture>` — so a site
 * picture can never be stored as app artwork (or the reverse), and only a picture the media
 * service has just written for this zone can be set.
 *
 * Rollback:
 *   drop function public.admin_set_shopping_zone_mobile_banner(uuid, text);
 *   drop function public.admin_delete_shopping_zone(uuid);
 *   create function public.admin_delete_shopping_zone(uuid) ... -- the text-returning form
 *   recreate catalog_shopping_zones/catalog_shopping_zone/admin_list_shopping_zones/
 *     admin_shopping_zone without the mobileBannerKey field
 *   alter table public.shopping_zones drop column mobile_banner_key;
 * Dropping the column does not delete any stored object; the pictures stay in the bucket.
 */

alter table public.shopping_zones
  add column mobile_banner_key text
    check (
      mobile_banner_key is null
      or mobile_banner_key ~ '^zone-mobile-banners/[0-9a-f-]{36}/[0-9a-f-]{36}$'
    );

comment on column public.shopping_zones.mobile_banner_key is
  'Base key of the app-only artwork in the media bucket: <key>/full.webp and <key>/thumb.webp.';

-- ---------------------------------------------------------------------------
-- 1. Public reads: the app needs the key as well as the site picture
-- ---------------------------------------------------------------------------

create or replace function public.catalog_shopping_zones()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_zones jsonb;
begin
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', z.id,
             'slug', z.slug,
             'name', z.name,
             'description', z.description,
             'audience', z.audience,
             'bannerKey', z.banner_key,
             'bannerAlt', z.banner_alt,
             'mobileBannerKey', z.mobile_banner_key,
             'productCount', private.zone_product_count(z.id)
           )
           order by z.display_order, z.name, z.id
         ), '[]'::jsonb)
    into v_zones
  from public.shopping_zones z
  where z.is_active;
  return v_zones;
end;
$$;

create or replace function public.catalog_shopping_zone(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_zone public.shopping_zones;
begin
  select * into v_zone from public.shopping_zones z
   where z.slug = p_slug and z.is_active;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_zone.id,
    'slug', v_zone.slug,
    'name', v_zone.name,
    'description', v_zone.description,
    'audience', v_zone.audience,
    'bannerKey', v_zone.banner_key,
    'bannerAlt', v_zone.banner_alt,
    'mobileBannerKey', v_zone.mobile_banner_key,
    'productCount', private.zone_product_count(v_zone.id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Admin reads: the workspace lists and opens a zone with both keys
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_shopping_zones(
  p_query text default null,
  p_status text default 'all',
  p_sort text default 'order',
  p_page integer default 1,
  p_page_size integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('zones.manage');
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_size integer := least(200, greatest(1, coalesce(p_page_size, 100)));
  v_status text := coalesce(p_status, 'all');
  v_search text := nullif(btrim(coalesce(p_query, '')), '');
  v_sort text := coalesce(p_sort, 'order');
  v_total bigint;
  v_rows jsonb;
begin
  if v_status not in ('active', 'inactive', 'all') then
    raise exception 'choose active, inactive or all' using errcode = 'NZ412';
  end if;
  if v_sort not in ('order', 'name', 'products') then
    raise exception 'choose order, name or products' using errcode = 'NZ412';
  end if;

  with filtered as (
    select z.*,
           (select count(*) from public.product_shopping_zones pz where pz.zone_id = z.id)::int
             as explicit_products,
           (select count(*) from public.category_shopping_zones cz where cz.zone_id = z.id)::int
             as categories,
           private.zone_product_count(z.id) as products
      from public.shopping_zones z
     where (v_status = 'all' or (v_status = 'active') = z.is_active)
       and (v_search is null
            or z.name ilike '%' || v_search || '%'
            or z.slug ilike '%' || v_search || '%')
  ),
  page_rows as (
    select * from filtered
     order by
       case when v_sort = 'order' then display_order end asc nulls last,
       case when v_sort = 'products' then products end desc nulls last,
       name, id
    offset (v_page - 1) * v_size
    limit v_size
  )
  select
    (select count(*) from filtered),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'slug', o.slug,
        'name', o.name,
        'description', o.description,
        'audience', o.audience,
        'bannerKey', o.banner_key,
        'bannerAlt', o.banner_alt,
        'mobileBannerKey', o.mobile_banner_key,
        'seoTitle', o.seo_title,
        'seoDescription', o.seo_description,
        'displayOrder', o.display_order,
        'isActive', o.is_active,
        'productCount', o.products,
        'explicitProductCount', o.explicit_products,
        'categoryCount', o.categories,
        'updatedAt', o.updated_at
      ) order by
        case when v_sort = 'order' then o.display_order end asc nulls last,
        case when v_sort = 'products' then o.products end desc nulls last,
        o.name, o.id)
      from page_rows o
    ), '[]'::jsonb)
  into v_total, v_rows;

  return jsonb_build_object(
    'zones', v_rows,
    'noteCounts', jsonb_build_object(
      'active', (select count(*) from public.shopping_zones where is_active),
      'inactive', (select count(*) from public.shopping_zones where not is_active)
    ),
    'page', v_page,
    'pageSize', v_size,
    'total', v_total,
    'totalPages', case when v_total = 0 then 0 else ceil(v_total::numeric / v_size)::int end
  );
end;
$$;

create or replace function public.admin_shopping_zone(p_zone_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('zones.manage');
  v_zone public.shopping_zones;
begin
  select * into v_zone from public.shopping_zones where id = p_zone_id;
  if not found then
    raise exception 'zone not found' using errcode = 'NZ404';
  end if;
  return jsonb_build_object(
    'id', v_zone.id,
    'slug', v_zone.slug,
    'name', v_zone.name,
    'description', v_zone.description,
    'audience', v_zone.audience,
    'bannerKey', v_zone.banner_key,
    'bannerAlt', v_zone.banner_alt,
    'mobileBannerKey', v_zone.mobile_banner_key,
    'seoTitle', v_zone.seo_title,
    'seoDescription', v_zone.seo_description,
    'displayOrder', v_zone.display_order,
    'isActive', v_zone.is_active,
    'productCount', private.zone_product_count(v_zone.id),
    'explicitProductCount', (
      select count(*)::int from public.product_shopping_zones pz where pz.zone_id = v_zone.id
    ),
    'categoryCount', (
      select count(*)::int from public.category_shopping_zones cz where cz.zone_id = v_zone.id
    ),
    'productIds', (
      select coalesce(jsonb_agg(pz.product_id order by pz.created_at, pz.product_id), '[]'::jsonb)
        from public.product_shopping_zones pz where pz.zone_id = v_zone.id
    ),
    'categoryIds', (
      select coalesce(jsonb_agg(cz.category_id order by cz.created_at, cz.category_id), '[]'::jsonb)
        from public.category_shopping_zones cz where cz.zone_id = v_zone.id
    ),
    'updatedAt', v_zone.updated_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Admin writes: the app's picture, set exactly like the site's
-- ---------------------------------------------------------------------------

/**
 * Sets a zone's app artwork. The key must be one the media service just wrote for this zone
 * under `zone-mobile-banners/`, so a request can never point the app's artwork at a product
 * picture, at another zone's picture, at the site banner, or at a URL. The site's own picture
 * is not read and not written here.
 * Returns the key it replaced, for the API to delete after the commit.
 */
create function public.admin_set_shopping_zone_mobile_banner(
  p_zone_id uuid,
  p_banner_key text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('zones.manage');
  v_old text;
begin
  if p_banner_key is not null
     and p_banner_key !~ ('^zone-mobile-banners/' || p_zone_id::text || '/[0-9a-f-]{36}$') then
    raise exception 'invalid mobile banner key' using errcode = 'NZ412';
  end if;
  select mobile_banner_key into v_old
    from public.shopping_zones where id = p_zone_id for update;
  if not found then
    raise exception 'zone not found' using errcode = 'NZ404';
  end if;
  update public.shopping_zones
     set mobile_banner_key = p_banner_key
   where id = p_zone_id;
  perform private.audit(
    v_actor, 'zone.mobile_banner_set', 'shopping_zone', p_zone_id::text, '{}'::jsonb
  );
  return v_old;
end;
$$;

/**
 * Deletes a zone and its own association rows, and nothing else.
 *
 * A zone that still holds products or categories is refused (NZ409) rather than silently
 * detaching them. Orders, snapshots, products and categories are never touched. The caller
 * receives both picture keys — the site's and the app's — so the API can delete the files that
 * are no longer referenced after the commit.
 */
drop function public.admin_delete_shopping_zone(uuid);

create function public.admin_delete_shopping_zone(p_zone_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('zones.manage');
  v_products integer;
  v_categories integer;
  v_keys jsonb;
begin
  select count(*)::int into v_products
    from public.product_shopping_zones where zone_id = p_zone_id;
  select count(*)::int into v_categories
    from public.category_shopping_zones where zone_id = p_zone_id;
  if not exists (select 1 from public.shopping_zones z where z.id = p_zone_id) then
    raise exception 'zone not found' using errcode = 'NZ404';
  end if;
  if v_products > 0 or v_categories > 0 then
    raise exception 'this zone still holds % products and % categories; remove them first',
      v_products, v_categories using errcode = 'NZ409';
  end if;

  delete from public.shopping_zones
   where id = p_zone_id
  returning jsonb_build_object(
    'bannerKey', banner_key,
    'mobileBannerKey', mobile_banner_key
  ) into v_keys;
  perform private.audit(v_actor, 'zone.deleted', 'shopping_zone', p_zone_id::text, '{}'::jsonb);
  return v_keys;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.admin_set_shopping_zone_mobile_banner(uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_set_shopping_zone_mobile_banner(uuid, text)
  to authenticated;

revoke execute on function public.admin_delete_shopping_zone(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_delete_shopping_zone(uuid) to authenticated;
