-- Brands (the maker or label of a product, separate from its category) and promotional
-- banners. Additive only: existing products keep working with no brand.

-- ---------------------------------------------------------------------------
-- Brands
-- ---------------------------------------------------------------------------

/** Top-level storefront paths a brand slug may never take (brands live at /<slug>). */
create function private.is_reserved_slug(p_slug text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_slug = any (array[
    'about', 'account', 'admin', 'api', 'auth', 'brand', 'brands', 'cart', 'categories', 'category',
    'checkout', 'confirm-email', 'contact', 'design-system', 'favicon', 'forgot-password', 'help',
    'login', 'logout', 'orders', 'privacy', 'product', 'products', 'register', 'reset-password',
    'robots', 'search', 'shop', 'sitemap', 'terms', 'verify-otp', 'welcome'
  ]);
$$;

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (char_length(slug) between 2 and 60 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      and not private.is_reserved_slug(slug)),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  -- Base key of the logo's WebP variants in media storage (never a full URL).
  logo_key text check (logo_key is null or logo_key ~ '^brands/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index brands_name_key on public.brands (lower(btrim(name)));
create index brands_active_name_idx on public.brands (name) where is_active;

create trigger brands_set_updated_at
  before update on public.brands
  for each row execute function public.set_updated_at();

/** Former slugs, so old brand links redirect to the current one. */
create table public.brand_slug_redirects (
  old_slug text primary key,
  brand_id uuid not null references public.brands (id) on delete cascade,
  created_at timestamptz not null default now()
);

create function private.brands_remember_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.slug is distinct from old.slug then
    delete from public.brand_slug_redirects where old_slug = new.slug;
    insert into public.brand_slug_redirects (old_slug, brand_id)
    values (old.slug, new.id)
    on conflict (old_slug) do update set brand_id = excluded.brand_id, created_at = now();
  end if;
  return new;
end;
$$;

create trigger brands_remember_slug
  after update of slug on public.brands
  for each row execute function private.brands_remember_slug();

/** A redirect may not shadow a live brand's slug. */
create function private.brand_slug_available(p_slug text, p_brand_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.brand_slug_redirects r where r.old_slug = p_slug and r.brand_id <> coalesce(p_brand_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
$$;

alter table public.products
  add column brand_id uuid references public.brands (id) on delete set null;
create index products_brand_listing_idx on public.products (brand_id, published_at desc)
  where status = 'active';

grant select (brand_id) on table public.products to anon, authenticated;

alter table public.brands enable row level security;
alter table public.brand_slug_redirects enable row level security;

create policy "Anyone reads active brands"
  on public.brands for select to anon, authenticated
  using (is_active);

create policy "Product staff read every brand"
  on public.brands for select to authenticated
  using ((select public.has_permission('products.read')));

create policy "Anyone reads brand redirects"
  on public.brand_slug_redirects for select to anon, authenticated
  using (true);

revoke all on table public.brands, public.brand_slug_redirects from public, anon, authenticated;
grant select on table public.brands, public.brand_slug_redirects to anon, authenticated;
grant all on table public.brands, public.brand_slug_redirects to service_role;

/** Products on sale of each active brand, counted as the caller. */
create function public.product_count(p_brand public.brands)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*) from public.products p
  where p.brand_id = p_brand.id and p.status = 'active'
    and exists (select 1 from public.categories c where c.id = p.category_id and c.is_active);
$$;

revoke execute on function public.product_count(public.brands) from public;
grant execute on function public.product_count(public.brands) to anon, authenticated;

/** One page of a brand's products on sale; same row shape as catalog_products. */
create function public.catalog_brand_products(
  p_brand_slug text,
  p_sort text default 'featured',
  p_limit integer default 24,
  p_offset integer default 0
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
  total_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 60 or p_offset is null or p_offset not between 0 and 10000 then
    raise exception 'invalid page' using errcode = '22023';
  end if;
  if p_sort is null or p_sort not in ('featured', 'newest', 'price_asc', 'price_desc') then
    raise exception 'invalid sort' using errcode = '22023';
  end if;

  return query
  select p.id, p.slug, p.sku, p.name, p.summary, p.price_minor, p.compare_at_price_minor,
    p.stock_quantity, p.max_order_quantity, p.is_featured, p.published_at,
    c.slug, c.name, count(*) over ()
  from public.products p
  join public.categories c on c.id = p.category_id
  join public.brands b on b.id = p.brand_id
  where p.status = 'active'
    and c.is_active
    and b.is_active
    and b.slug = p_brand_slug
  order by
    case when p_sort = 'featured' then p.is_featured end desc nulls last,
    case when p_sort = 'price_asc' then p.price_minor end asc nulls last,
    case when p_sort = 'price_desc' then p.price_minor end desc nulls last,
    p.published_at desc,
    p.id
  limit p_limit
  offset p_offset;
end;
$$;

revoke execute on function public.catalog_brand_products(text, text, integer, integer) from public;
grant execute on function public.catalog_brand_products(text, text, integer, integer)
  to anon, authenticated, service_role;

create function public.admin_save_brand(
  p_brand_id uuid,
  p_slug text,
  p_name text,
  p_description text,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.publish');
  v_id uuid := p_brand_id;
begin
  if p_slug is null or private.is_reserved_slug(p_slug) or not private.brand_slug_available(p_slug, p_brand_id) then
    raise exception 'this address is not available' using errcode = 'NZ441';
  end if;
  if v_id is null then
    insert into public.brands (slug, name, description, is_active)
    values (p_slug, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
      coalesce(p_is_active, true))
    returning id into v_id;
    perform private.audit(v_actor, 'brand.created', 'brand', v_id::text,
      jsonb_build_object('slug', p_slug));
  else
    update public.brands
    set slug = p_slug, name = btrim(p_name),
        description = nullif(btrim(coalesce(p_description, '')), ''),
        is_active = coalesce(p_is_active, true)
    where id = v_id;
    if not found then
      raise exception 'brand not found' using errcode = 'NZ404';
    end if;
    perform private.audit(v_actor, 'brand.updated', 'brand', v_id::text,
      jsonb_build_object('slug', p_slug, 'isActive', coalesce(p_is_active, true)));
  end if;
  return v_id;
end;
$$;

/** Sets or clears a brand's logo; returns the replaced logo's key for deleting its files. */
create function public.admin_set_brand_logo(p_brand_id uuid, p_logo_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.publish');
  v_old text;
begin
  if p_logo_key is not null and p_logo_key !~ ('^brands/' || p_brand_id::text || '/[0-9a-f-]{36}$') then
    raise exception 'invalid logo key' using errcode = 'NZ412';
  end if;
  select logo_key into v_old from public.brands where id = p_brand_id for update;
  if not found then
    raise exception 'brand not found' using errcode = 'NZ404';
  end if;
  update public.brands set logo_key = p_logo_key where id = p_brand_id;
  perform private.audit(v_actor, case when p_logo_key is null then 'brand.logo_removed' else 'brand.logo_set' end,
    'brand', p_brand_id::text, '{}'::jsonb);
  return v_old;
end;
$$;

/** Assigns a product to a brand (or none). Brand is product metadata shown to shoppers. */
create function public.admin_set_product_brand(p_product_id uuid, p_brand_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.publish');
begin
  if p_brand_id is not null and not exists (select 1 from public.brands where id = p_brand_id) then
    raise exception 'brand not found' using errcode = 'NZ404';
  end if;
  update public.products set brand_id = p_brand_id where id = p_product_id;
  if not found then
    raise exception 'product not found' using errcode = 'NZ404';
  end if;
  perform private.audit(v_actor, 'product.brand_set', 'product', p_product_id::text,
    jsonb_build_object('brandId', p_brand_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Banners
-- ---------------------------------------------------------------------------

create type public.banner_placement as enum ('home_hero', 'home_secondary', 'category');

create table public.banners (
  id uuid primary key default gen_random_uuid(),
  placement public.banner_placement not null,
  category_id uuid references public.categories (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  subtitle text check (subtitle is null or char_length(subtitle) <= 200),
  cta_label text check (cta_label is null or char_length(btrim(cta_label)) between 1 and 30),
  -- Only links inside the storefront: a path, never another site.
  cta_href text check (
    cta_href is null
    or (char_length(cta_href) <= 300 and cta_href ~ '^/[A-Za-z0-9/_?=&%.~-]*$' and cta_href !~ '^//')
  ),
  image_key text check (image_key is null or image_key ~ '^banners/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  sort_order integer not null default 0 check (sort_order between 0 and 1000),
  is_active boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint banners_category_placement check ((placement = 'category') = (category_id is not null)),
  constraint banners_cta_pair check ((cta_label is null) = (cta_href is null)),
  constraint banners_schedule check (starts_at is null or ends_at is null or ends_at > starts_at)
);

create index banners_display_idx on public.banners (placement, category_id, sort_order)
  where is_active;

create trigger banners_set_updated_at
  before update on public.banners
  for each row execute function public.set_updated_at();

alter table public.banners enable row level security;

-- The database, not the client, decides what is eligible to show.
create policy "Anyone reads banners on show"
  on public.banners for select to anon, authenticated
  using (
    is_active
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
    and (category_id is null or exists (
      select 1 from public.categories c where c.id = category_id and c.is_active))
  );

create policy "Store managers read every banner"
  on public.banners for select to authenticated
  using ((select public.has_permission('settings.manage')));

revoke all on table public.banners from public, anon, authenticated;
grant select on table public.banners to anon, authenticated;
grant all on table public.banners to service_role;

create function public.admin_save_banner(
  p_banner_id uuid,
  p_placement public.banner_placement,
  p_category_id uuid,
  p_title text,
  p_subtitle text,
  p_cta_label text,
  p_cta_href text,
  p_sort_order integer,
  p_is_active boolean,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_id uuid := p_banner_id;
  v_category uuid := case when p_placement = 'category' then p_category_id end;
begin
  if p_placement = 'category' and (v_category is null
      or not exists (select 1 from public.categories where id = v_category)) then
    raise exception 'choose a category' using errcode = 'NZ412';
  end if;
  if v_id is null then
    insert into public.banners (placement, category_id, title, subtitle, cta_label, cta_href,
      sort_order, is_active, starts_at, ends_at, created_by)
    values (p_placement, v_category, btrim(p_title), nullif(btrim(coalesce(p_subtitle, '')), ''),
      nullif(btrim(coalesce(p_cta_label, '')), ''), nullif(btrim(coalesce(p_cta_href, '')), ''),
      coalesce(p_sort_order, 0), coalesce(p_is_active, false), p_starts_at, p_ends_at, v_actor)
    returning id into v_id;
    perform private.audit(v_actor, 'banner.created', 'banner', v_id::text,
      jsonb_build_object('placement', p_placement));
  else
    update public.banners
    set placement = p_placement, category_id = v_category, title = btrim(p_title),
        subtitle = nullif(btrim(coalesce(p_subtitle, '')), ''),
        cta_label = nullif(btrim(coalesce(p_cta_label, '')), ''),
        cta_href = nullif(btrim(coalesce(p_cta_href, '')), ''),
        sort_order = coalesce(p_sort_order, 0), is_active = coalesce(p_is_active, false),
        starts_at = p_starts_at, ends_at = p_ends_at
    where id = v_id;
    if not found then
      raise exception 'banner not found' using errcode = 'NZ404';
    end if;
    perform private.audit(v_actor, 'banner.updated', 'banner', v_id::text,
      jsonb_build_object('placement', p_placement, 'isActive', coalesce(p_is_active, false)));
  end if;
  return v_id;
end;
$$;

/** Sets or clears a banner's image; returns the replaced image's key for deleting its files. */
create function public.admin_set_banner_image(p_banner_id uuid, p_image_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_old text;
begin
  if p_image_key is not null and p_image_key !~ ('^banners/' || p_banner_id::text || '/[0-9a-f-]{36}$') then
    raise exception 'invalid image key' using errcode = 'NZ412';
  end if;
  select image_key into v_old from public.banners where id = p_banner_id for update;
  if not found then
    raise exception 'banner not found' using errcode = 'NZ404';
  end if;
  update public.banners set image_key = p_image_key where id = p_banner_id;
  perform private.audit(v_actor, 'banner.image_set', 'banner', p_banner_id::text, '{}'::jsonb);
  return v_old;
end;
$$;

/** Deletes a banner; returns its image key so the API removes the files after commit. */
create function public.admin_delete_banner(p_banner_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_key text;
begin
  delete from public.banners where id = p_banner_id returning image_key into v_key;
  if not found then
    raise exception 'banner not found' using errcode = 'NZ404';
  end if;
  perform private.audit(v_actor, 'banner.deleted', 'banner', p_banner_id::text, '{}'::jsonb);
  return v_key;
end;
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.admin_save_brand(uuid, text, text, text, boolean)',
    'public.admin_set_brand_logo(uuid, text)',
    'public.admin_set_product_brand(uuid, uuid)',
    'public.admin_save_banner(uuid, public.banner_placement, uuid, text, text, text, text, integer, boolean, timestamptz, timestamptz)',
    'public.admin_set_banner_image(uuid, text)',
    'public.admin_delete_banner(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end;
$$;
