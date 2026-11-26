/*
 * Shopping Zones
 * ==============
 * Zones are a merchandising layer, not a second taxonomy: "Men's", "Women's", "Kids" and any
 * custom collection an admin invents. Categories stay the product taxonomy; a zone groups
 * products and categories for navigation.
 *
 * Design notes
 *   - One shared model, three presentations: the storefront, the app and the admin all read
 *     the same rows through the functions below.
 *   - `audience` is free metadata (men / women / kids / unisex / anything), never a closed
 *     enum, so a custom zone needs no code change.
 *   - Association resolution is deterministic and applied in one place:
 *       1. A product with explicit rows in product_shopping_zones belongs to exactly those
 *          zones.
 *       2. A product with no explicit rows inherits the zones of its category.
 *       3. Otherwise it belongs to no zone and stays in general browsing.
 *     `private.product_zone_ids()` is that rule, and every read (public listing, counts,
 *     admin preview) uses it, so no caller can invent a different order.
 *   - Nothing here is mandatory: categories and products without zones keep working exactly
 *     as before, and unassigned products never disappear from the Shop.
 *   - Only active zones are ever public; the check is in the database, not the UI.
 *   - Deleting a zone removes its own junction rows only. Products, categories, orders and
 *     their snapshots are untouched; a zone that still has associations is refused instead
 *     of silently detaching them.
 *   - Purely additive: no existing table, policy or column is altered. `catalog_products`
 *     is redefined with one extra optional parameter and its old signature dropped first, so
 *     no ambiguous overload lingers.
 *
 * Rollback (manual, in this order)
 *   drop function public.admin_set_shopping_zone_categories(uuid, uuid[]);
 *   drop function public.admin_set_shopping_zone_products(uuid, uuid[]);
 *   drop function public.admin_delete_shopping_zone(uuid);
 *   drop function public.admin_set_shopping_zone_banner(uuid, text, text);
 *   drop function public.admin_set_shopping_zone_active(uuid, boolean);
 *   drop function public.admin_save_shopping_zone(uuid, text, text, text, text, integer, boolean, text, text, text, text);
 *   drop function public.admin_shopping_zone(uuid);
 *   drop function public.admin_list_shopping_zones(text, text, text, integer, integer);
 *   drop function public.catalog_shopping_zones();
 *   drop function public.catalog_shopping_zone(text);
 *   drop function private.zone_product_count(uuid);
 *   drop function private.product_zone_ids(uuid, uuid);
 *   drop function private.zone_slug_is_public(text);
 *   drop function public.catalog_products(text, text, text, integer, integer, text[], text, bigint, bigint, boolean, text);
 *   -- then restore catalog_products from 20261123090000_discount_campaigns.sql
 *   drop table public.category_shopping_zones;
 *   drop table public.product_shopping_zones;
 *   drop table public.shopping_zones;
 *   delete from public.role_permissions where permission = 'zones.manage';
 *   delete from public.permissions where name = 'zones.manage';
 * Dropping the zone tables does not delete any product, category or stored banner object.
 */

-- ---------------------------------------------------------------------------
-- 1. Permission
-- ---------------------------------------------------------------------------

insert into public.permissions (name, description) values
  ('zones.manage', 'Create and manage shopping zones, their banners and their products')
on conflict (name) do nothing;

-- Owners and admins curate the storefront's navigation. Staff and moderators do not: a zone
-- is a marketing decision, not day-to-day catalogue work.
insert into public.role_permissions (role, permission)
select 'super_admin'::public.app_role, 'zones.manage'
union all
select 'admin'::public.app_role, 'zones.manage'
on conflict (role, permission) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

create table public.shopping_zones (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (char_length(slug) <= 60 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text check (description is null or char_length(description) <= 300),
  /**
   * Suggested classification: men, women, kids, unisex, or any word an admin needs. Metadata
   * only — it never decides where a zone appears or which products it holds.
   */
  audience text check (
    audience is null or (char_length(audience) <= 20 and audience ~ '^[a-z][a-z0-9_-]*$')
  ),
  /** Base key of the banner in the media bucket (the API writes <key>/full.webp and thumb). */
  banner_key text check (banner_key is null or banner_key ~ '^zone-banners/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  banner_alt text check (banner_alt is null or char_length(banner_alt) <= 160),
  seo_title text check (seo_title is null or char_length(btrim(seo_title)) between 1 and 70),
  seo_description text check (
    seo_description is null or char_length(btrim(seo_description)) between 1 and 160
  ),
  display_order integer not null default 0 check (display_order between 0 and 1000),
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.shopping_zones is
  'Merchandising collections shown beside the category taxonomy. Public reads see active rows only.';
comment on column public.shopping_zones.audience is
  'Free-form classification (men, women, kids, unisex, custom...). Metadata; never a closed list.';

create index shopping_zones_public_idx
  on public.shopping_zones (display_order, name)
  where is_active;

create trigger shopping_zones_set_updated_at
  before update on public.shopping_zones
  for each row execute function public.set_updated_at();

/* One row per product a zone holds explicitly. */
create table public.product_shopping_zones (
  zone_id uuid not null references public.shopping_zones (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (zone_id, product_id)
);

comment on table public.product_shopping_zones is
  'Explicit product-zone membership. These rows win over category inheritance.';

/* The reverse lookup the resolution rule needs: does this product have any explicit zone? */
create index product_shopping_zones_product_idx on public.product_shopping_zones (product_id);

/* One row per category a zone covers. */
create table public.category_shopping_zones (
  zone_id uuid not null references public.shopping_zones (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (zone_id, category_id)
);

comment on table public.category_shopping_zones is
  'Zones a category belongs to. Inherited by products that have no explicit zone rows.';

create index category_shopping_zones_category_idx on public.category_shopping_zones (category_id);

/*
 * No client role reads the junction tables directly: the public function below decides what
 * a visitor may see, and every admin write is a permission-checked function.
 */
alter table public.shopping_zones enable row level security;
alter table public.product_shopping_zones enable row level security;
alter table public.category_shopping_zones enable row level security;

-- ---------------------------------------------------------------------------
-- 3. The resolution rule, in one place
-- ---------------------------------------------------------------------------

/**
 * The zones a product belongs to: its own explicit rows, or — only when it has none — the
 * zones of its category. An explicit choice is never widened by category inheritance, and a
 * product can qualify through several zones without ever being counted twice (the caller
 * filters on membership, never joins to multiply rows).
 */
create function private.product_zone_ids(p_product_id uuid, p_category_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select array_agg(pz.zone_id)
       from public.product_shopping_zones pz
      where pz.product_id = p_product_id),
    (select array_agg(cz.zone_id)
       from public.category_shopping_zones cz
      where cz.category_id = p_category_id),
    '{}'::uuid[]
  );
$$;

/**
 * True when the zone named by `p_zone_slug` exists, is active, and the product belongs to it.
 * The listing filter's whole job is this predicate, so the storefront, the app and the admin
 * preview cannot disagree about whether a product is in a zone.
 *
 * It lives in the public schema because the listing itself runs as the visitor (security
 * invoker, so product Row Level Security still decides what is visible) and cannot reach the
 * `private` schema. The function is security definer, so it can read the association tables
 * that no client role may read directly, and it answers only a yes/no about public data.
 */
create function public.product_in_zone(
  p_zone_slug text,
  p_product_id uuid,
  p_category_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_zone_slug is null or exists (
    select 1
      from public.shopping_zones z
     where z.slug = p_zone_slug
       and z.is_active
       and z.id = any (private.product_zone_ids(p_product_id, p_category_id))
  );
$$;

/** Products of a zone that a shopper can actually see, for the admin's and the home's counts. */
create function private.zone_product_count(p_zone_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from public.products p
    join public.categories c on c.id = p.category_id
   where p.status = 'active'
     and c.is_active
     and p_zone_id = any (private.product_zone_ids(p.id, p.category_id));
$$;

-- ---------------------------------------------------------------------------
-- 4. Public read: the zones a visitor may see
-- ---------------------------------------------------------------------------

/**
 * Every active zone, in display order, with its banner key and how many shopper-visible
 * products it holds. Inactive zones are filtered here — the storefront and the app never
 * receive them, so hiding them in a UI is never the only safeguard.
 */
create function public.catalog_shopping_zones()
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

/**
 * One active zone by its address, or null. A listing filtered by a zone uses this to answer
 * 404 for an unknown or hidden zone instead of pretending the collection is simply empty.
 */
create function public.catalog_shopping_zone(p_slug text)
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
    'productCount', private.zone_product_count(v_zone.id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The listing filter
-- ---------------------------------------------------------------------------

-- The listing gained a zone parameter, so the ten-parameter form would otherwise linger as
-- an ambiguous overload. Everything else in the body — including the ordering, which decides
-- how equally-priced products and equally-ranked matches are tie-broken — is reproduced
-- exactly as deployed, so adding a zone cannot reshuffle an unfiltered listing.
drop function if exists public.catalog_products(
  text, text, text, integer, integer, text[], text, bigint, bigint, boolean
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
  p_zone_slug text default null
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

-- ---------------------------------------------------------------------------
-- 6. Admin reads and writes (permission-checked)
-- ---------------------------------------------------------------------------

/**
 * The workspace list: every zone, active or not, with its counts and whether it has a banner.
 * `p_status` is active | inactive | all; `p_query` matches the name or slug.
 */
create function public.admin_list_shopping_zones(
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

/** One zone with the ids of everything it holds, for the edit form. */
create function public.admin_shopping_zone(p_zone_id uuid)
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

/**
 * Creates or edits a zone. A blank slug is made from the name; a slug that another zone owns
 * is refused with NZ409 so the workspace can point at the field.
 */
create function public.admin_save_shopping_zone(
  p_zone_id uuid,
  p_name text,
  p_slug text,
  p_description text default null,
  p_audience text default null,
  p_display_order integer default 0,
  p_is_active boolean default true,
  p_seo_title text default null,
  p_seo_description text default null,
  p_banner_alt text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('zones.manage');
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := btrim(coalesce(p_slug, ''));
  v_audience text := nullif(btrim(lower(coalesce(p_audience, ''))), '');
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_seo_title text := nullif(btrim(coalesce(p_seo_title, '')), '');
  v_seo_description text := nullif(btrim(coalesce(p_seo_description, '')), '');
  v_banner_alt text := nullif(btrim(coalesce(p_banner_alt, '')), '');
  v_id uuid;
begin
  if v_name = '' then
    raise exception 'give the zone a name' using errcode = 'NZ412';
  end if;
  if v_slug = '' then
    v_slug := regexp_replace(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g');
  end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) > 60 then
    raise exception 'use lower-case words and hyphens for the address' using errcode = 'NZ412';
  end if;
  if v_audience is not null and v_audience !~ '^[a-z][a-z0-9_-]*$' then
    raise exception 'use a single lower-case word for the audience' using errcode = 'NZ412';
  end if;
  if p_display_order is null or p_display_order not between 0 and 1000 then
    raise exception 'choose a position from 0 to 1000' using errcode = 'NZ412';
  end if;

  if p_zone_id is null then
    insert into public.shopping_zones
      (slug, name, description, audience, display_order, is_active,
       seo_title, seo_description, banner_alt, created_by)
    values
      (v_slug, v_name, v_description, v_audience, p_display_order, coalesce(p_is_active, true),
       v_seo_title, v_seo_description, v_banner_alt, v_actor)
    returning id into v_id;
    perform private.audit(v_actor, 'zone.created', 'shopping_zone', v_id::text,
      jsonb_build_object('slug', v_slug));
  else
    update public.shopping_zones
       set slug = v_slug,
           name = v_name,
           description = v_description,
           audience = v_audience,
           display_order = p_display_order,
           is_active = coalesce(p_is_active, true),
           seo_title = v_seo_title,
           seo_description = v_seo_description,
           banner_alt = v_banner_alt
     where id = p_zone_id
    returning id into v_id;
    if v_id is null then
      raise exception 'zone not found' using errcode = 'NZ404';
    end if;
    perform private.audit(v_actor, 'zone.updated', 'shopping_zone', v_id::text,
      jsonb_build_object('slug', v_slug));
  end if;
  return v_id;
exception
  when unique_violation then
    raise exception 'another zone already uses that address' using errcode = 'NZ409';
end;
$$;

/** Shows or hides a zone. Hiding removes it from the storefront and the app at once. */
create function public.admin_set_shopping_zone_active(p_zone_id uuid, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('zones.manage');
begin
  update public.shopping_zones set is_active = coalesce(p_is_active, false) where id = p_zone_id;
  if not found then
    raise exception 'zone not found' using errcode = 'NZ404';
  end if;
  perform private.audit(v_actor,
    case when coalesce(p_is_active, false) then 'zone.activated' else 'zone.deactivated' end,
    'shopping_zone', p_zone_id::text, '{}'::jsonb);
end;
$$;

/**
 * Sets a zone's banner. The key must be one the media service just wrote for this zone, so a
 * request can never point a banner at a product picture, another zone's picture or a URL.
 * Returns the key it replaced, for the API to delete after the commit.
 */
create function public.admin_set_shopping_zone_banner(
  p_zone_id uuid,
  p_banner_key text,
  p_banner_alt text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('zones.manage');
  v_old text;
  v_alt text := nullif(btrim(coalesce(p_banner_alt, '')), '');
begin
  if p_banner_key is not null
     and p_banner_key !~ ('^zone-banners/' || p_zone_id::text || '/[0-9a-f-]{36}$') then
    raise exception 'invalid banner key' using errcode = 'NZ412';
  end if;
  select banner_key into v_old from public.shopping_zones where id = p_zone_id for update;
  if not found then
    raise exception 'zone not found' using errcode = 'NZ404';
  end if;
  update public.shopping_zones
     set banner_key = p_banner_key,
         banner_alt = case when p_banner_key is null then null else v_alt end
   where id = p_zone_id;
  perform private.audit(v_actor, 'zone.banner_set', 'shopping_zone', p_zone_id::text, '{}'::jsonb);
  return v_old;
end;
$$;

/** Replaces a zone's explicit product list in one transaction. */
create function public.admin_set_shopping_zone_products(p_zone_id uuid, p_product_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('zones.manage');
  v_ids uuid[] := coalesce(p_product_ids, '{}'::uuid[]);
  v_kept integer;
begin
  if not exists (select 1 from public.shopping_zones z where z.id = p_zone_id) then
    raise exception 'zone not found' using errcode = 'NZ404';
  end if;
  if exists (select 1 from unnest(v_ids) as id where id is null) then
    raise exception 'invalid product id' using errcode = 'NZ412';
  end if;
  if exists (
    select 1 from unnest(v_ids) as id
     where not exists (select 1 from public.products p where p.id = id)
  ) then
    raise exception 'one of those products no longer exists' using errcode = 'NZ412';
  end if;

  delete from public.product_shopping_zones
   where zone_id = p_zone_id
     and not (product_id = any (v_ids));
  insert into public.product_shopping_zones (zone_id, product_id)
  select p_zone_id, id from unnest(v_ids) as id
  on conflict (zone_id, product_id) do nothing;
  select count(*)::int into v_kept from public.product_shopping_zones where zone_id = p_zone_id;

  perform private.audit(v_actor, 'zone.products_set', 'shopping_zone', p_zone_id::text,
    jsonb_build_object('products', v_kept));
  return v_kept;
end;
$$;

/** Replaces a zone's category list in one transaction. */
create function public.admin_set_shopping_zone_categories(p_zone_id uuid, p_category_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('zones.manage');
  v_ids uuid[] := coalesce(p_category_ids, '{}'::uuid[]);
  v_kept integer;
begin
  if not exists (select 1 from public.shopping_zones z where z.id = p_zone_id) then
    raise exception 'zone not found' using errcode = 'NZ404';
  end if;
  if exists (select 1 from unnest(v_ids) as id where id is null) then
    raise exception 'invalid category id' using errcode = 'NZ412';
  end if;
  if exists (
    select 1 from unnest(v_ids) as id
     where not exists (select 1 from public.categories c where c.id = id)
  ) then
    raise exception 'one of those categories no longer exists' using errcode = 'NZ412';
  end if;

  delete from public.category_shopping_zones
   where zone_id = p_zone_id
     and not (category_id = any (v_ids));
  insert into public.category_shopping_zones (zone_id, category_id)
  select p_zone_id, id from unnest(v_ids) as id
  on conflict (zone_id, category_id) do nothing;
  select count(*)::int into v_kept from public.category_shopping_zones where zone_id = p_zone_id;

  perform private.audit(v_actor, 'zone.categories_set', 'shopping_zone', p_zone_id::text,
    jsonb_build_object('categories', v_kept));
  return v_kept;
end;
$$;

/**
 * Deletes a zone and its own association rows, and nothing else.
 *
 * A zone that still holds products or categories is refused (NZ409) rather than silently
 * detaching them: an admin who means it removes the associations first, having seen what
 * they are. Orders, order snapshots, products and categories are never touched, and the
 * caller receives the banner key so the API can delete the picture after the commit.
 */
create function public.admin_delete_shopping_zone(p_zone_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('zones.manage');
  v_products integer;
  v_categories integer;
  v_key text;
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

  delete from public.shopping_zones where id = p_zone_id returning banner_key into v_key;
  perform private.audit(v_actor, 'zone.deleted', 'shopping_zone', p_zone_id::text, '{}'::jsonb);
  return v_key;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------

revoke execute on function private.product_zone_ids(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.zone_product_count(uuid) from public, anon, authenticated;

/* The membership test a listing filter needs, and nothing else, is readable by a visitor. */
revoke execute on function public.product_in_zone(text, uuid, uuid) from public;
grant execute on function public.product_in_zone(text, uuid, uuid) to anon, authenticated, service_role;

revoke execute on function public.catalog_shopping_zones() from public, anon, authenticated;
revoke execute on function public.catalog_shopping_zone(text) from public, anon, authenticated;
revoke execute on function public.admin_list_shopping_zones(text, text, text, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.admin_shopping_zone(uuid) from public, anon, authenticated;
revoke execute on function public.admin_save_shopping_zone(
  uuid, text, text, text, text, integer, boolean, text, text, text
) from public, anon, authenticated;
revoke execute on function public.admin_set_shopping_zone_active(uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.admin_set_shopping_zone_banner(uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.admin_set_shopping_zone_products(uuid, uuid[])
  from public, anon, authenticated;
revoke execute on function public.admin_set_shopping_zone_categories(uuid, uuid[])
  from public, anon, authenticated;
revoke execute on function public.admin_delete_shopping_zone(uuid)
  from public, anon, authenticated;
revoke execute on function public.catalog_products(
  text, text, text, integer, integer, text[], text, bigint, bigint, boolean, text
) from public, anon, authenticated;

grant execute on function public.catalog_shopping_zones() to anon, authenticated, service_role;
grant execute on function public.catalog_shopping_zone(text) to anon, authenticated, service_role;
grant execute on function public.admin_list_shopping_zones(text, text, text, integer, integer)
  to authenticated;
grant execute on function public.admin_shopping_zone(uuid) to authenticated;
grant execute on function public.admin_save_shopping_zone(
  uuid, text, text, text, text, integer, boolean, text, text, text
) to authenticated;
grant execute on function public.admin_set_shopping_zone_active(uuid, boolean) to authenticated;
grant execute on function public.admin_set_shopping_zone_banner(uuid, text, text) to authenticated;
grant execute on function public.admin_set_shopping_zone_products(uuid, uuid[]) to authenticated;
grant execute on function public.admin_set_shopping_zone_categories(uuid, uuid[]) to authenticated;
grant execute on function public.admin_delete_shopping_zone(uuid) to authenticated;
grant execute on function public.catalog_products(
  text, text, text, integer, integer, text[], text, bigint, bigint, boolean, text
) to anon, authenticated, service_role;
