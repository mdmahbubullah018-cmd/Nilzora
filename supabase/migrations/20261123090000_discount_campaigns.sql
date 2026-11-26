-- ---------------------------------------------------------------------------
-- Discount campaigns: promotional pricing across products, categories, brands
-- and the whole catalog.
--
-- The single most important property of this migration: a campaign never writes
-- to public.products. A product's own price_minor (its sale price) and
-- compare_at_price_minor (its list price) are the product-level discount and stay
-- exactly as the administrator set them. A campaign is an overlay that is
-- resolved at read time, so when a campaign is paused, ended or simply passes its
-- end instant the product-level discount becomes effective again with no job, no
-- repair step and no administrator action.
--
-- Effective price, for a product or a variant:
--   list    = coalesce(compare_at_price_minor, price_minor)
--   price   = list - public.campaign_discount_minor(list, campaign)   (campaign wins)
--   price   = price_minor                                        (no campaign)
--
-- One campaign governs a product at a time; discounts never stack. Precedence is
--   1. product-targeted campaign
--   2. category-targeted campaign (a target also covers its subcategories)
--   3. brand-targeted campaign
--   4. storewide campaign
--   5. the product's own sale price
-- and within one level: higher priority, then the earlier start, then the older
-- campaign, then its id. The order is total, so two administrators previewing the
-- same catalog always see the same price.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Campaigns and their targets
-- ---------------------------------------------------------------------------

create type public.campaign_scope as enum ('products', 'categories', 'brands', 'storewide');

create type public.campaign_discount_kind as enum ('percent', 'fixed');

/*
 * draft     never affects prices; the working state of a campaign being prepared
 * scheduled affects prices from starts_at
 * active    affects prices now (and from starts_at if that is still in the future)
 * paused    never affects prices, but keeps its schedule so it can resume
 * ended     stopped early by an administrator; never affects prices again
 * archived  kept for history only
 *
 * "scheduled" and "active" are both live states: the resolver checks the time
 * window itself, so a campaign becomes (and stops being) effective at the right
 * instant even if no job ever runs.
 */
create type public.campaign_status as enum ('draft', 'scheduled', 'active', 'paused', 'ended', 'archived');

/*
 * Whether a coupon code may be used on a cart that contains this campaign's
 * products. The safe default is "stackable" only because coupons are already
 * capped and validated on the campaign-discounted subtotal; "blocked" refuses the
 * code outright with a clear message.
 */
create type public.campaign_coupon_policy as enum ('stackable', 'blocked');

create table public.discount_campaigns (
  id uuid primary key default gen_random_uuid(),
  -- Internal name and notes: never shown to customers.
  name text not null check (char_length(btrim(name)) between 1 and 120),
  internal_notes text check (internal_notes is null or char_length(internal_notes) <= 500),
  -- The words a customer reads on the storefront.
  customer_title text not null check (char_length(btrim(customer_title)) between 1 and 120),
  scope public.campaign_scope not null,
  discount_kind public.campaign_discount_kind not null,
  -- Percentage points for 'percent' (1-100), poisha for 'fixed'.
  discount_value bigint not null check (discount_value between 1 and 1000000000),
  -- Cap on a percentage discount, in poisha. Never set for a fixed discount.
  max_discount_minor bigint check (max_discount_minor is null or max_discount_minor > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  status public.campaign_status not null default 'draft',
  -- Breaks ties inside one scope level; higher wins.
  priority integer not null default 0 check (priority between -100 and 100),
  -- Whether the storefront shows the campaign's banner and price label.
  is_visible boolean not null default true,
  -- Media key of the campaign banner; the public URL is built by the API.
  banner_image_key text check (banner_image_key is null or char_length(banner_image_key) <= 400),
  coupon_policy public.campaign_coupon_policy not null default 'stackable',
  -- Optimistic concurrency: every write must name the version it read.
  version integer not null default 1 check (version >= 1),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint discount_campaigns_window
    check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint discount_campaigns_percent_range
    check (discount_kind <> 'percent' or discount_value between 1 and 100),
  constraint discount_campaigns_cap_only_for_percent
    check (max_discount_minor is null or discount_kind = 'percent')
);

comment on table public.discount_campaigns is
  'Promotional pricing rules. Resolved at read time; never copies into products.';
comment on column public.discount_campaigns.discount_value is
  'Percentage points when discount_kind is percent, poisha when fixed.';
comment on column public.discount_campaigns.version is
  'Optimistic concurrency token; a stale write is refused instead of overwriting another administrator.';
comment on column public.discount_campaigns.banner_image_key is
  'Media key of the campaign banner; the key itself is never exposed, only the public variant URLs.';

create index discount_campaigns_status_idx on public.discount_campaigns (status, starts_at, ends_at);
create index discount_campaigns_created_idx on public.discount_campaigns (created_at desc);

create table public.discount_campaign_products (
  campaign_id uuid not null references public.discount_campaigns (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  primary key (campaign_id, product_id)
);

create index discount_campaign_products_product_idx on public.discount_campaign_products (product_id);

create table public.discount_campaign_categories (
  campaign_id uuid not null references public.discount_campaigns (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  primary key (campaign_id, category_id)
);

create index discount_campaign_categories_category_idx
  on public.discount_campaign_categories (category_id);

create table public.discount_campaign_brands (
  campaign_id uuid not null references public.discount_campaigns (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  primary key (campaign_id, brand_id)
);

create index discount_campaign_brands_brand_idx on public.discount_campaign_brands (brand_id);

comment on table public.discount_campaign_products is
  'Products a product-targeted campaign names.';
comment on table public.discount_campaign_categories is
  'Categories a category campaign names; a target covers its subcategories.';
comment on table public.discount_campaign_brands is 'Brands a brand campaign names.';

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into public.permissions (name, description) values
  ('discounts.view', 'See discount campaigns and their pricing'),
  ('discounts.create', 'Create a discount campaign as a draft'),
  ('discounts.edit', 'Edit a campaign and its targets'),
  ('discounts.schedule', 'Put a campaign on the calendar'),
  ('discounts.activate', 'Start a campaign, or resume a paused one'),
  ('discounts.pause', 'Pause a running campaign'),
  ('discounts.end', 'End a campaign early'),
  ('discounts.archive', 'Archive a campaign'),
  ('discounts.manage_priority', 'Change a campaign''s conflict priority'),
  ('discounts.manage_coupon_policy', 'Decide whether coupons stack with a campaign');

-- Owners hold everything (permissions_of() already grants them the catalogue).
-- Admins run promotions day to day; staff and moderators start with none and are
-- granted exactly what they need.
insert into public.role_permissions (role, permission)
select 'admin'::public.app_role, unnest(array[
  'discounts.view', 'discounts.create', 'discounts.edit', 'discounts.schedule',
  'discounts.activate', 'discounts.pause', 'discounts.end', 'discounts.archive',
  'discounts.manage_priority', 'discounts.manage_coupon_policy'
]);

-- Owners hold every permission in the catalogue, and the table says so for each of them,
-- so the owner's row set stays equal to PERMISSIONS (an integration test asserts it).
insert into public.role_permissions (role, permission)
select 'super_admin'::public.app_role, unnest(array[
  'discounts.view', 'discounts.create', 'discounts.edit', 'discounts.schedule',
  'discounts.activate', 'discounts.pause', 'discounts.end', 'discounts.archive',
  'discounts.manage_priority', 'discounts.manage_coupon_policy'
]);

-- ---------------------------------------------------------------------------
-- Pricing resolution
-- ---------------------------------------------------------------------------

/** A category and every category above it. A target covers descendants, so this
 *  is what makes a campaign on "Men" reach a product in "Men > Shirts". */
create function private.category_ancestry(p_category_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  with recursive up as (
    select c.id, c.parent_id, 1 as depth
    from public.categories c
    where c.id = p_category_id
    union all
    select c.id, c.parent_id, up.depth + 1
    from public.categories c
    join up on c.id = up.parent_id
    where up.depth < 3
  )
  select coalesce(array_agg(up.id), '{}'::uuid[]) from up;
$$;

/** Every category at or below the given ones. Used to count and list the products
 *  a category campaign actually reaches. */
create function private.category_descendants(p_category_ids uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  with recursive down as (
    select c.id, 1 as depth from public.categories c where c.id = any (p_category_ids)
    union all
    select c.id, down.depth + 1
    from public.categories c
    join down on c.parent_id = down.id
    where down.depth < 3
  )
  select coalesce(array_agg(down.id), '{}'::uuid[]) from down;
$$;

/**
 * The discount a campaign takes off one price, in poisha. Never negative and
 * never the whole price: a product always keeps at least one poisha, which is
 * what its own check constraint requires.
 */
create function public.campaign_discount_minor(
  p_price_minor bigint,
  p_kind public.campaign_discount_kind,
  p_value bigint,
  p_max_discount_minor bigint
)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select greatest(
    0,
    least(
      greatest(coalesce(p_price_minor, 0) - 1, 0),
      case
        when p_kind = 'fixed' then p_value
        else least(
          (coalesce(p_price_minor, 0) * p_value) / 100,
          coalesce(p_max_discount_minor, coalesce(p_price_minor, 0))
        )
      end
    )
  );
$$;

comment on function public.campaign_discount_minor(bigint, public.campaign_discount_kind, bigint, bigint) is
  'Whole poisha, rounded down, capped by the campaign maximum and by the price itself.';

revoke execute on function public.campaign_discount_minor(bigint, public.campaign_discount_kind, bigint, bigint)
  from public;
grant execute on function public.campaign_discount_minor(bigint, public.campaign_discount_kind, bigint, bigint)
  to anon, authenticated, service_role;

/**
 * The campaign that governs each of the given products right now, one row per
 * product. The time window is checked here rather than in a scheduled job, so
 * pricing is right even when nothing has run for days.
 */
create function public.product_campaigns(p_product_ids uuid[])
returns table (
  product_id uuid,
  campaign_id uuid,
  campaign_title text,
  campaign_scope public.campaign_scope,
  discount_kind public.campaign_discount_kind,
  discount_value bigint,
  max_discount_minor bigint,
  coupon_policy public.campaign_coupon_policy,
  ends_at timestamptz,
  is_visible boolean,
  priority integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with live as (
    select c.*
    from public.discount_campaigns c
    where c.status in ('scheduled', 'active')
      and (c.starts_at is null or now() >= c.starts_at)
      and (c.ends_at is null or now() < c.ends_at)
  ),
  subject as (
    select p.id, p.brand_id, private.category_ancestry(p.category_id) as ancestry
    from public.products p
    where p.id = any (coalesce(p_product_ids, '{}'::uuid[]))
  ),
  matches as (
    select
      s.id as product_id,
      c.id as campaign_id,
      c.customer_title,
      c.scope,
      c.discount_kind,
      c.discount_value,
      c.max_discount_minor,
      c.coupon_policy,
      c.ends_at,
      c.is_visible,
      case c.scope
        when 'products' then 1
        when 'categories' then 2
        when 'brands' then 3
        else 4
      end as scope_rank,
      c.priority,
      c.starts_at,
      c.created_at
    from subject s
    join live c on (
      c.scope = 'storewide'
      or (c.scope = 'products' and exists (
        select 1 from public.discount_campaign_products t
        where t.campaign_id = c.id and t.product_id = s.id
      ))
      or (c.scope = 'categories' and exists (
        select 1 from public.discount_campaign_categories t
        where t.campaign_id = c.id and t.category_id = any (s.ancestry)
      ))
      or (c.scope = 'brands' and s.brand_id is not null and exists (
        select 1 from public.discount_campaign_brands t
        where t.campaign_id = c.id and t.brand_id = s.brand_id
      ))
    )
  ),
  ranked as (
    select m.*,
      row_number() over (
        partition by m.product_id
        order by m.scope_rank, m.priority desc, m.starts_at asc nulls first,
                 m.created_at asc, m.campaign_id asc
      ) as place
    from matches m
  )
  select
    r.product_id, r.campaign_id, r.customer_title, r.scope, r.discount_kind,
    r.discount_value, r.max_discount_minor, r.coupon_policy, r.ends_at, r.is_visible,
    r.priority
  from ranked r
  where r.place = 1;
$$;

comment on function public.product_campaigns(uuid[]) is
  'The one campaign (if any) governing each product now. Public: prices are public data.';

revoke execute on function public.product_campaigns(uuid[]) from public, anon, authenticated;
grant execute on function public.product_campaigns(uuid[]) to anon, authenticated, service_role;

/**
 * The products a set of targets reaches, with their current catalog prices. Used
 * by the preview, the affected-product count and the campaign detail screen so all
 * three agree with the pricing engine.
 */
create function private.target_products(
  p_scope public.campaign_scope,
  p_category_ids uuid[],
  p_brand_ids uuid[],
  p_product_ids uuid[]
)
returns table (
  product_id uuid,
  slug text,
  name text,
  sku text,
  category_slug text,
  category_name text,
  price_minor bigint,
  compare_at_price_minor bigint,
  status public.product_status
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.slug, p.name, p.sku, c.slug, c.name, p.price_minor,
         p.compare_at_price_minor, p.status
  from public.products p
  join public.categories c on c.id = p.category_id
  where case p_scope
          when 'storewide' then true
          when 'products' then p.id = any (coalesce(p_product_ids, '{}'::uuid[]))
          when 'categories' then p.category_id = any (
            private.category_descendants(coalesce(p_category_ids, '{}'::uuid[])))
          when 'brands' then p.brand_id = any (coalesce(p_brand_ids, '{}'::uuid[]))
        end
  order by p.name, p.id;
$$;

/** The products a saved campaign reaches, with their catalog prices. */
create function private.campaign_products(p_campaign public.discount_campaigns)
returns table (
  product_id uuid,
  slug text,
  name text,
  sku text,
  category_slug text,
  category_name text,
  price_minor bigint,
  compare_at_price_minor bigint,
  status public.product_status
)
language sql
stable
security definer
set search_path = ''
as $$
  select *
  from private.target_products(
    p_campaign.scope,
    case when p_campaign.scope = 'categories' then array(
      select t.category_id from public.discount_campaign_categories t
      where t.campaign_id = p_campaign.id
    ) else null end,
    case when p_campaign.scope = 'brands' then array(
      select t.brand_id from public.discount_campaign_brands t
      where t.campaign_id = p_campaign.id
    ) else null end,
    case when p_campaign.scope = 'products' then array(
      select t.product_id from public.discount_campaign_products t
      where t.campaign_id = p_campaign.id
    ) else null end
  );
$$;

/** How many published products a campaign reaches: the number an administrator cares
 *  about, because a draft product is never sold at any price. */
create function private.campaign_product_count(p_campaign public.discount_campaigns)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)
  from private.campaign_products(p_campaign) p
  where p.status = 'active';
$$;

-- ---------------------------------------------------------------------------
-- Storefront catalog reads, priced through the campaign engine
-- ---------------------------------------------------------------------------

-- The listing gained filter parameters, so the old five-parameter form would
-- otherwise linger as an ambiguous overload.
drop function if exists public.catalog_products(text, text, text, integer, integer);

/**
 * One page of the public catalog. Every price is the one a shopper pays right
 * now: a campaign's price when one governs the product, otherwise the product's
 * own sale price. Filtering and sorting by price use that same effective price,
 * so a "price: low to high" list never contradicts the numbers on the cards.
 *
 * p_category_slugs null lists the whole shop; an array lists that branch.
 */
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
  p_in_stock boolean default null
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

revoke execute on function public.catalog_products(text, text, text, integer, integer, text[], text, bigint, bigint, boolean)
  from public, anon, authenticated;
grant execute on function public.catalog_products(text, text, text, integer, integer, text[], text, bigint, bigint, boolean)
  to anon, authenticated, service_role;

/** One published product, priced the same way as a listing row. */
create function public.catalog_product(p_slug text)
returns table (
  id uuid,
  slug text,
  sku text,
  name text,
  summary text,
  description text,
  price_minor bigint,
  compare_at_price_minor bigint,
  stock_quantity integer,
  max_order_quantity integer,
  is_featured boolean,
  published_at timestamptz,
  brand_id uuid,
  size_chart jsonb,
  category_slug text,
  category_name text,
  campaign_id uuid,
  campaign_title text,
  campaign_ends_at timestamptz,
  campaign_discount_kind public.campaign_discount_kind,
  campaign_discount_value bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with found as (
    select p.*, c.slug as category_slug, c.name as category_name,
           coalesce(p.compare_at_price_minor, p.price_minor) as list_minor
    from public.products p
    join public.categories c on c.id = p.category_id
    where p.slug = p_slug and p.status = 'active' and c.is_active
  ),
  priced as (
    select f.*,
           k.campaign_id, k.campaign_title, k.ends_at as campaign_ends_at,
           k.discount_kind as campaign_discount_kind,
           k.discount_value as campaign_discount_value,
           case when k.campaign_id is null then f.price_minor
                else f.list_minor - public.campaign_discount_minor(
                  f.list_minor, k.discount_kind, k.discount_value, k.max_discount_minor)
           end as effective_minor,
           case when k.campaign_id is null then f.compare_at_price_minor
                else f.list_minor
           end as effective_compare_minor
    from found f
    left join public.product_campaigns(array(select f2.id from found f2)) k on k.product_id = f.id
  )
  select p.id, p.slug, p.sku, p.name, p.summary, p.description, p.effective_minor,
         p.effective_compare_minor, p.stock_quantity, p.max_order_quantity, p.is_featured,
         p.published_at, p.brand_id, p.size_chart, p.category_slug, p.category_name,
         p.campaign_id, p.campaign_title, p.campaign_ends_at,
         p.campaign_discount_kind, p.campaign_discount_value
  from priced p;
$$;

revoke execute on function public.catalog_product(text) from public, anon, authenticated;
grant execute on function public.catalog_product(text) to anon, authenticated, service_role;

/**
 * The campaigns a shopper may see: live, marked visible, and reaching at least one
 * published product. `p_category_id` narrows to campaigns that reach a product in
 * that category, which is what a category page's banner needs.
 */
create function public.catalog_campaigns(p_category_id uuid default null)
returns table (
  campaign_id uuid,
  title text,
  scope public.campaign_scope,
  discount_kind public.campaign_discount_kind,
  discount_value bigint,
  max_discount_minor bigint,
  ends_at timestamptz,
  banner_image_key text,
  product_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with live as (
    select c.*
    from public.discount_campaigns c
    where c.status in ('scheduled', 'active')
      and c.is_visible
      and (c.starts_at is null or now() >= c.starts_at)
      and (c.ends_at is null or now() < c.ends_at)
  ),
  reached as (
    select
      l.id,
      count(p.product_id) filter (
        where p.status = 'active'
          and (p_category_id is null or exists (
            select 1
            from public.products pr
            where pr.id = p.product_id
              and p_category_id = any (private.category_ancestry(pr.category_id))
          ))
      )::bigint as product_count
    from live l
    left join lateral private.campaign_products(l) p on true
    group by l.id
  )
  select l.id, l.customer_title, l.scope, l.discount_kind, l.discount_value,
         l.max_discount_minor, l.ends_at, l.banner_image_key, coalesce(r.product_count, 0)
  from live l
  join reached r on r.id = l.id
  where coalesce(r.product_count, 0) > 0
  order by l.priority desc, l.created_at, l.id;
$$;

revoke execute on function public.catalog_campaigns(uuid) from public, anon, authenticated;
grant execute on function public.catalog_campaigns(uuid) to anon, authenticated, service_role;
-- ---------------------------------------------------------------------------
-- Cart, checkout and order pricing
--
-- price_cart is the one place a cart line gets its price. It resolves the same
-- campaigns the catalog does, so a product's card, its detail page, the cart and
-- the order snapshot can never disagree.
-- ---------------------------------------------------------------------------

drop function if exists private.price_cart(jsonb);

create function private.price_cart(p_items jsonb)
returns table (
  line_no integer,
  product_id uuid,
  variant_id uuid,
  variant_label text,
  slug text,
  name text,
  sku text,
  unit_price_minor bigint,
  compare_at_price_minor bigint,
  list_price_minor bigint,
  catalog_price_minor bigint,
  campaign_id uuid,
  campaign_title text,
  campaign_ends_at timestamptz,
  campaign_coupon_policy public.campaign_coupon_policy,
  campaign_discount_minor bigint,
  quantity integer,
  line_total_minor bigint,
  stock_quantity integer,
  max_order_quantity integer,
  problem text
)
language sql
stable
set search_path = ''
as $$
  with on_sale as (
    select p.*
    from public.products p
    join public.categories c on c.id = p.category_id
    where p.status = 'active' and c.is_active
  ),
  lines as (
    select
      ci.line_no,
      ci.product_id,
      ci.variant_id,
      ci.quantity,
      p.id as sale_id,
      p.slug,
      p.name,
      p.sku as product_sku,
      p.price_minor as product_price_minor,
      p.compare_at_price_minor as product_compare_minor,
      p.stock_quantity as product_stock,
      p.max_order_quantity,
      v.id as variant_row,
      v.sku as variant_sku,
      v.price_minor as variant_price_minor,
      v.compare_at_price_minor as variant_compare_minor,
      v.stock_quantity as variant_stock,
      v.is_active as variant_active,
      (select count(*) from public.product_variants pv where pv.product_id = ci.product_id)
        as variant_count,
      case when ci.variant_id is null then null
           else private.variant_label(ci.variant_id) end as variant_label
    from private.cart_items(p_items) as ci
    left join on_sale p on p.id = ci.product_id
    left join public.product_variants v
      on v.id = ci.variant_id and v.product_id = ci.product_id
  ),
  stored as (
    select
      l.*,
      coalesce(l.variant_price_minor, l.product_price_minor) as catalog_minor,
      coalesce(
        case when l.variant_price_minor is not null then l.variant_compare_minor
             else l.product_compare_minor end,
        coalesce(l.variant_price_minor, l.product_price_minor)
      ) as list_minor
    from lines l
  ),
  governed as (
    select s.*, k.campaign_id, k.campaign_title, k.ends_at as campaign_ends_at,
           k.coupon_policy as campaign_coupon_policy, k.discount_kind, k.discount_value,
           k.max_discount_minor
    from stored s
    left join public.product_campaigns(
      array(select distinct s2.product_id from stored s2 where s2.sale_id is not null)
    ) k on k.product_id = s.product_id
  )
  select
    g.line_no,
    g.product_id,
    g.variant_id,
    g.variant_label,
    g.slug,
    g.name,
    coalesce(g.variant_sku, g.product_sku),
    case when g.campaign_id is null then g.catalog_minor
         else g.list_minor - public.campaign_discount_minor(
           g.list_minor, g.discount_kind, g.discount_value, g.max_discount_minor) end,
    case when g.campaign_id is null then
           case when g.variant_price_minor is not null then g.variant_compare_minor
                else g.product_compare_minor end
         else g.list_minor end,
    g.list_minor,
    g.catalog_minor,
    g.campaign_id,
    g.campaign_title,
    g.campaign_ends_at,
    g.campaign_coupon_policy,
    case when g.campaign_id is null then 0
         else public.campaign_discount_minor(
           g.list_minor, g.discount_kind, g.discount_value, g.max_discount_minor) end,
    g.quantity,
    case when g.campaign_id is null then g.catalog_minor
         else g.list_minor - public.campaign_discount_minor(
           g.list_minor, g.discount_kind, g.discount_value, g.max_discount_minor) end * g.quantity,
    case when g.variant_id is null then g.product_stock
         else coalesce(g.variant_stock, 0) end,
    g.max_order_quantity,
    case
      when g.sale_id is null then 'unavailable'
      when g.variant_id is not null and g.variant_row is null then 'variant_invalid'
      when g.variant_id is null and g.variant_count > 0 then 'variant_required'
      when g.variant_id is not null and g.variant_active is not true then 'unavailable'
      when g.quantity > g.max_order_quantity then 'quantity_limit'
      when g.quantity > (case when g.variant_id is null then g.product_stock
                              else coalesce(g.variant_stock, 0) end)
        then 'insufficient_stock'
    end
  from governed g
  order by g.line_no;
$$;

create or replace function public.quote_cart(p_items jsonb, p_address_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lines jsonb;
  v_item_count integer;
  v_subtotal bigint;
  v_campaign_discount bigint;
  v_has_problem boolean;
  v_zone public.delivery_zone;
  v_fee bigint;
begin
  select
    jsonb_agg(
      jsonb_build_object(
        'productId', l.product_id,
        'variantId', l.variant_id,
        'variantLabel', l.variant_label,
        'slug', l.slug,
        'name', l.name,
        'sku', l.sku,
        'unitPriceMinor', l.unit_price_minor,
        'compareAtPriceMinor', l.compare_at_price_minor,
        'listPriceMinor', l.list_price_minor,
        'campaignDiscountMinor', l.campaign_discount_minor,
        'campaign', case when l.campaign_id is null then null else jsonb_build_object(
          'id', l.campaign_id,
          'title', l.campaign_title,
          'endsAt', l.campaign_ends_at,
          'couponPolicy', l.campaign_coupon_policy
        ) end,
        'quantity', l.quantity,
        'lineTotalMinor', l.line_total_minor,
        'availableQuantity', least(l.stock_quantity, l.max_order_quantity),
        'problem', l.problem
      )
      order by l.line_no
    ),
    coalesce(sum(l.quantity) filter (where l.problem is null), 0),
    coalesce(sum(l.line_total_minor) filter (where l.problem is null), 0),
    coalesce(sum(l.campaign_discount_minor * l.quantity) filter (where l.problem is null), 0),
    bool_or(l.problem is not null)
  into v_lines, v_item_count, v_subtotal, v_campaign_discount, v_has_problem
  from private.price_cart(p_items) as l;

  if p_address_id is not null then
    v_zone := private.own_address_zone(p_address_id);
    if v_zone is null then
      raise exception 'address not found' using errcode = 'NZ411';
    end if;
    select amount_minor into v_fee from public.delivery_charges where zone = v_zone;
  end if;

  return jsonb_build_object(
    'lines', coalesce(v_lines, '[]'::jsonb),
    'itemCount', v_item_count,
    'subtotalMinor', v_subtotal,
    'campaignDiscountMinor', v_campaign_discount,
    'deliveryZone', v_zone,
    'shippingFeeMinor', v_fee,
    'totalMinor', case when v_fee is null then null else v_subtotal + v_fee end,
    'purchasable', not v_has_problem and (p_address_id is null or v_fee is not null)
  );
end;
$$;

/**
 * The same quote with a coupon. A code is refused, with a message and an
 * undiscounted total, when a campaign in the cart does not allow coupons; that is
 * decided here, from the campaign rows, so no client can talk its way past it.
 */
create or replace function public.quote_cart_with_coupon(
  p_items jsonb,
  p_address_id uuid,
  p_coupon_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    v_coupon := private.claim_coupon(p_coupon_code, v_user, v_subtotal);
    v_discount := private.coupon_discount(v_coupon, v_subtotal);
  exception
    when sqlstate 'NZ450' or sqlstate 'NZ451' or sqlstate 'NZ452' or sqlstate 'NZ453'
      or sqlstate 'NZ454' or sqlstate 'NZ455' or sqlstate 'NZ456' or sqlstate 'NZ457' then
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
      'description', v_coupon.description
    )
  );
end;
$$;

revoke execute on function public.quote_cart_with_coupon(jsonb, uuid, text)
  from public, anon, authenticated;
grant execute on function public.quote_cart_with_coupon(jsonb, uuid, text)
  to anon, authenticated, service_role;
-- ---------------------------------------------------------------------------
-- Order snapshots carry the promotional breakdown
--
-- An order line keeps the list price, the product's own sale price, the campaign
-- that priced it and the money that campaign took off. Historical orders are
-- never recomputed: editing or ending a campaign cannot change a placed order.
-- ---------------------------------------------------------------------------

alter table public.order_items
  add column regular_price_minor bigint check (regular_price_minor is null or regular_price_minor >= unit_price_minor),
  add column catalog_price_minor bigint check (catalog_price_minor is null or catalog_price_minor > 0),
  add column campaign_id uuid references public.discount_campaigns (id) on delete set null,
  add column campaign_title text check (campaign_title is null or char_length(campaign_title) <= 120),
  add column campaign_discount_minor bigint not null default 0
    check (campaign_discount_minor >= 0);

comment on column public.order_items.regular_price_minor is
  'The list price the line was sold against: what a campaign discounts.';
comment on column public.order_items.catalog_price_minor is
  'The product''s own sale price at the moment of the order, before any campaign.';
comment on column public.order_items.campaign_id is
  'The campaign that priced the line, if one did. Kept after the campaign is archived.';

create index order_items_campaign_idx on public.order_items (campaign_id)
  where campaign_id is not null;

create or replace function public.place_cod_order(
  p_idempotency_key uuid,
  p_address_id uuid,
  p_items jsonb,
  p_note text default null,
  p_expected_total_minor bigint default null,
  p_coupon_code text default null
)
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
    v_coupon := private.claim_coupon(p_coupon_code, v_user, v_subtotal);
    v_discount := private.coupon_discount(v_coupon, v_subtotal);
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
    regular_price_minor, catalog_price_minor, campaign_id, campaign_title, campaign_discount_minor
  )
  select v_order.id, l.product_id, l.variant_id, l.variant_label, l.name, l.slug, l.sku,
         l.unit_price_minor, l.quantity, l.line_total_minor,
         l.list_price_minor, l.catalog_price_minor, l.campaign_id, l.campaign_title,
         l.campaign_discount_minor
  from private.price_cart(p_items) as l;

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

-- ---------------------------------------------------------------------------
-- Variants are priced through the same engine
-- ---------------------------------------------------------------------------

create or replace function public.catalog_product_variants(p_slug text)
returns table (
  variant_id uuid,
  sku text,
  price_minor bigint,
  compare_at_price_minor bigint,
  stock_quantity integer,
  max_order_quantity integer,
  image_url text,
  "position" integer,
  options jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with subject as (
    select p.id, p.max_order_quantity,
           p.price_minor as product_price, p.compare_at_price_minor as product_compare
    from public.products p
    join public.categories c on c.id = p.category_id
    where p.slug = p_slug and p.status = 'active' and c.is_active
  ),
  governed as (
    select k.* from public.product_campaigns(array(select id from subject)) k
  ),
  rows as (
    select v.id, v.sku, v.price_minor, v.compare_at_price_minor, v.stock_quantity,
           v.image_url, v.position, v.product_id,
           s.max_order_quantity, s.product_compare,
           coalesce(v.price_minor, s.product_price) as catalog_minor,
           coalesce(
             case when v.price_minor is not null then v.compare_at_price_minor
                  else s.product_compare end,
             coalesce(v.price_minor, s.product_price)
           ) as list_minor
    from public.product_variants v
    join subject s on s.id = v.product_id
    where v.is_active
  )
  select
    r.id,
    r.sku,
    case when g.campaign_id is null then r.catalog_minor
         else r.list_minor - public.campaign_discount_minor(
           r.list_minor, g.discount_kind, g.discount_value, g.max_discount_minor) end,
    case when g.campaign_id is null then
           case when r.price_minor is not null then r.compare_at_price_minor
                else r.product_compare end
         else r.list_minor end,
    r.stock_quantity,
    r.max_order_quantity,
    r.image_url,
    r.position,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'attribute', a.name,
               'attributeSlug', a.slug,
               'value', av.value,
               'valueSlug', av.slug
             ) order by a.position, av.position)
      from public.product_variant_values pvv
      join public.product_attribute_values av on av.id = pvv.attribute_value_id
      join public.product_attributes a on a.id = pvv.attribute_id
      where pvv.variant_id = r.id
    ), '[]'::jsonb)
  from rows r
  left join governed g on g.product_id = r.product_id
  order by r.position, r.sku;
$$;

revoke execute on function public.catalog_product_variants(text) from public, anon, authenticated;
grant execute on function public.catalog_product_variants(text) to anon, authenticated, service_role;
-- ---------------------------------------------------------------------------
-- Admin: discount campaign management
--
-- Every entry point checks the caller's own permission first, then validates the
-- whole configuration again, so an API bug or a hand-made request cannot create a
-- campaign the storefront would price wrongly.
-- ---------------------------------------------------------------------------

/** One campaign as the admin list shows it, with its live state and reach. */
create function private.campaign_view(p_campaign public.discount_campaigns)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_campaign.id,
    'name', p_campaign.name,
    'customerTitle', p_campaign.customer_title,
    'internalNotes', p_campaign.internal_notes,
    'scope', p_campaign.scope,
    'discountKind', p_campaign.discount_kind,
    'discountValue', p_campaign.discount_value,
    'maxDiscountMinor', p_campaign.max_discount_minor,
    'startsAt', p_campaign.starts_at,
    'endsAt', p_campaign.ends_at,
    'status', p_campaign.status,
    'state', case
      when p_campaign.status = 'draft' then 'draft'
      when p_campaign.status = 'archived' then 'archived'
      when p_campaign.status = 'ended' then 'ended'
      when p_campaign.status = 'paused' then 'paused'
      when p_campaign.starts_at is not null and now() < p_campaign.starts_at then 'scheduled'
      when p_campaign.ends_at is not null and now() >= p_campaign.ends_at then 'expired'
      when p_campaign.status = 'scheduled' then 'active'
      else 'active'
    end,
    'priority', p_campaign.priority,
    'isVisible', p_campaign.is_visible,
    'bannerImageKey', p_campaign.banner_image_key,
    'couponPolicy', p_campaign.coupon_policy,
    'version', p_campaign.version,
    'productCount', private.campaign_product_count(p_campaign),
    'createdAt', p_campaign.created_at,
    'updatedAt', p_campaign.updated_at,
    'endedAt', p_campaign.ended_at
  );
$$;

create function public.admin_list_campaigns(
  p_search text default null,
  p_state text default 'all',
  p_scope text default 'all',
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_size integer := least(100, greatest(1, coalesce(p_page_size, 25)));
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_state text := coalesce(p_state, 'all');
  v_scope text := coalesce(p_scope, 'all');
  v_total bigint;
  v_rows jsonb;
begin
  perform private.require_permission('discounts.view');
  if v_state not in ('all', 'draft', 'scheduled', 'active', 'paused', 'expired', 'ended', 'archived') then
    raise exception 'unknown campaign state' using errcode = 'NZ491';
  end if;
  if v_scope not in ('all', 'products', 'categories', 'brands', 'storewide') then
    raise exception 'unknown campaign scope' using errcode = 'NZ491';
  end if;

  with graded as (
    select c.id, private.campaign_view(c) as payload, c.status, c.scope, c.created_at
    from public.discount_campaigns c
  ),
  filtered as (
    select g.* from graded g
    where (v_search is null
           or coalesce(g.payload ->> 'name', '') ilike '%' || v_search || '%'
           or coalesce(g.payload ->> 'customerTitle', '') ilike '%' || v_search || '%')
      and (v_state = 'all' or g.payload ->> 'state' = v_state)
      and (v_scope = 'all' or g.scope::text = v_scope)
  ),
  page_rows as (
    select * from filtered
    order by created_at desc, id
    offset (v_page - 1) * v_size
    limit v_size
  )
  select
    (select count(*) from filtered),
    coalesce((select jsonb_agg(p.payload order by p.created_at desc, p.id) from page_rows p), '[]'::jsonb)
  into v_total, v_rows;

  return jsonb_build_object(
    'campaigns', v_rows,
    'page', v_page,
    'pageSize', v_size,
    'total', v_total,
    'totalPages', case when v_total = 0 then 0 else ceil(v_total::numeric / v_size)::int end
  );
end;
$$;

/** One campaign with its targets resolved to names, for the detail and edit screens. */
create function public.admin_get_campaign(p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_campaign public.discount_campaigns;
  v_view jsonb;
begin
  perform private.require_permission('discounts.view');
  select * into v_campaign from public.discount_campaigns c where c.id = p_campaign_id;
  if not found then
    raise exception 'campaign not found' using errcode = 'NZ490';
  end if;
  v_view := private.campaign_view(v_campaign);
  return v_view || jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name)
                       order by c.name)
      from public.discount_campaign_categories t
      join public.categories c on c.id = t.category_id
      where t.campaign_id = p_campaign_id
    ), '[]'::jsonb),
    'brands', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name)
                       order by b.name)
      from public.discount_campaign_brands t
      join public.brands b on b.id = t.brand_id
      where t.campaign_id = p_campaign_id
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'slug', p.slug, 'name', p.name)
                       order by p.name)
      from public.discount_campaign_products t
      join public.products p on p.id = t.product_id
      where t.campaign_id = p_campaign_id
    ), '[]'::jsonb)
  );
end;
$$;

/** The targets a scope needs, checked against the catalog so a stale picker fails loudly. */
create function private.validate_campaign_targets(
  p_scope public.campaign_scope,
  p_category_ids uuid[],
  p_brand_ids uuid[],
  p_product_ids uuid[]
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_categories integer := coalesce(array_length(p_category_ids, 1), 0);
  v_brands integer := coalesce(array_length(p_brand_ids, 1), 0);
  v_products integer := coalesce(array_length(p_product_ids, 1), 0);
begin
  if p_scope = 'storewide' then
    if v_categories + v_brands + v_products > 0 then
      raise exception 'a storewide campaign covers everything and takes no targets'
        using errcode = 'NZ491';
    end if;
    return;
  end if;

  if p_scope = 'categories' then
    if v_categories = 0 then
      raise exception 'choose at least one category' using errcode = 'NZ491';
    end if;
    if v_brands + v_products > 0 then
      raise exception 'a category campaign targets categories only' using errcode = 'NZ491';
    end if;
    if exists (select 1 from unnest(p_category_ids) x where not exists (
      select 1 from public.categories c where c.id = x)) then
      raise exception 'one of the chosen categories no longer exists' using errcode = 'NZ491';
    end if;
  elsif p_scope = 'brands' then
    if v_brands = 0 then
      raise exception 'choose at least one brand' using errcode = 'NZ491';
    end if;
    if v_categories + v_products > 0 then
      raise exception 'a brand campaign targets brands only' using errcode = 'NZ491';
    end if;
    if exists (select 1 from unnest(p_brand_ids) x where not exists (
      select 1 from public.brands b where b.id = x)) then
      raise exception 'one of the chosen brands no longer exists' using errcode = 'NZ491';
    end if;
  elsif p_scope = 'products' then
    if v_products = 0 then
      raise exception 'choose at least one product' using errcode = 'NZ491';
    end if;
    if v_categories + v_brands > 0 then
      raise exception 'a product campaign targets products only' using errcode = 'NZ491';
    end if;
    if exists (select 1 from unnest(p_product_ids) x where not exists (
      select 1 from public.products p where p.id = x)) then
      raise exception 'one of the chosen products no longer exists' using errcode = 'NZ491';
    end if;
  end if;
end;
$$;

/**
 * Creates (p_campaign_id null) or updates a campaign and replaces its targets.
 *
 * `p_expected_version` is the version the editor read. A stale value is refused
 * (NZ492) rather than overwriting a change another administrator just made, which
 * is what keeps two people editing the same campaign from silently clobbering each
 * other. Changing priority or the coupon policy needs its own permission.
 */
create function public.admin_save_campaign(
  p_campaign_id uuid,
  p_name text,
  p_customer_title text,
  p_scope public.campaign_scope,
  p_discount_kind public.campaign_discount_kind,
  p_discount_value bigint,
  p_max_discount_minor bigint default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_priority integer default 0,
  p_is_visible boolean default true,
  p_banner_image_key text default null,
  p_coupon_policy public.campaign_coupon_policy default 'stackable',
  p_category_ids uuid[] default null,
  p_brand_ids uuid[] default null,
  p_product_ids uuid[] default null,
  p_internal_notes text default null,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  if char_length(v_title) < 1 or char_length(v_title) > 120 then
    raise exception 'give the campaign a customer-facing title of 1-120 characters'
      using errcode = 'NZ491';
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
$$;

/**
 * Moves a campaign between states. The transition decides which permission is
 * needed, so a "marketing" account with schedule rights cannot start a campaign.
 */
create function public.admin_set_campaign_status(
  p_campaign_id uuid,
  p_status public.campaign_status,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_campaign public.discount_campaigns;
  v_from public.campaign_status;
  v_action text;
begin
  if p_campaign_id is null or p_status is null then
    raise exception 'a campaign and a status are required' using errcode = 'NZ491';
  end if;

  select * into v_campaign from public.discount_campaigns c
  where c.id = p_campaign_id
  for update;
  if not found then
    raise exception 'campaign not found' using errcode = 'NZ490';
  end if;
  v_from := v_campaign.status;

  if p_status = v_from then
    return private.campaign_view(v_campaign);
  end if;

  if p_status = 'scheduled' then
    v_actor := private.require_permission('discounts.schedule');
    if v_campaign.starts_at is null then
      raise exception 'set a start date before scheduling this campaign' using errcode = 'NZ491';
    end if;
  elsif p_status = 'active' then
    v_actor := private.require_permission('discounts.activate');
    if v_from = 'draft' or v_from = 'archived' then
      -- A campaign activated straight from draft is scheduled from now.
      if v_campaign.starts_at is null then
        update public.discount_campaigns set starts_at = now() where id = p_campaign_id;
      end if;
    end if;
  elsif p_status = 'paused' then
    v_actor := private.require_permission('discounts.pause');
  elsif p_status = 'ended' then
    v_actor := private.require_permission('discounts.end');
  elsif p_status = 'archived' then
    v_actor := private.require_permission('discounts.archive');
  elsif p_status = 'draft' then
    v_actor := private.require_permission('discounts.edit');
  else
    raise exception 'unknown campaign status' using errcode = 'NZ491';
  end if;

  if v_from = 'archived' then
    raise exception 'an archived campaign cannot be reopened' using errcode = 'NZ491';
  end if;
  if v_from = 'ended' and p_status not in ('archived', 'ended') then
    raise exception 'an ended campaign can only be archived' using errcode = 'NZ491';
  end if;
  if p_expected_version is not null and p_expected_version <> v_campaign.version then
    raise exception 'this campaign changed since you opened it; reload and try again'
      using errcode = 'NZ492';
  end if;

  update public.discount_campaigns
  set status = p_status,
      ended_at = case when p_status = 'ended' then now() else ended_at end,
      updated_by = v_actor,
      updated_at = now(),
      version = version + 1
  where id = p_campaign_id
  returning * into v_campaign;

  v_action := case p_status
    when 'scheduled' then 'discount_campaign.scheduled'
    when 'active' then 'discount_campaign.activated'
    when 'paused' then 'discount_campaign.paused'
    when 'ended' then 'discount_campaign.ended'
    when 'archived' then 'discount_campaign.archived'
    else 'discount_campaign.drafted'
  end;
  perform private.audit(v_actor, v_action, 'discount_campaign', p_campaign_id::text,
    jsonb_build_object('from', v_from, 'to', p_status));

  return private.campaign_view(v_campaign);
end;
$$;

/** Copies a campaign's configuration as a new draft, targets included. */
create function public.admin_duplicate_campaign(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('discounts.create');
  v_source public.discount_campaigns;
  v_copy public.discount_campaigns;
  v_name text;
begin
  select * into v_source from public.discount_campaigns c where c.id = p_campaign_id;
  if not found then
    raise exception 'campaign not found' using errcode = 'NZ490';
  end if;

  v_name := left(v_source.name || ' (copy)', 120);
  while exists (
    select 1 from public.discount_campaigns c
    where lower(c.name) = lower(v_name) and c.status not in ('archived', 'ended')
  ) loop
    v_name := left(v_source.name || ' (copy ' || floor(random() * 900 + 100)::int || ')', 120);
  end loop;

  insert into public.discount_campaigns (
    name, internal_notes, customer_title, scope, discount_kind, discount_value,
    max_discount_minor, starts_at, ends_at, status, priority, is_visible,
    banner_image_key, coupon_policy, created_by, updated_by
  ) values (
    v_name, v_source.internal_notes, v_source.customer_title, v_source.scope,
    v_source.discount_kind, v_source.discount_value, v_source.max_discount_minor,
    v_source.starts_at, v_source.ends_at, 'draft', v_source.priority, v_source.is_visible,
    v_source.banner_image_key, v_source.coupon_policy, v_actor, v_actor
  )
  returning * into v_copy;

  insert into public.discount_campaign_products (campaign_id, product_id)
  select v_copy.id, t.product_id from public.discount_campaign_products t
  where t.campaign_id = p_campaign_id;

  insert into public.discount_campaign_categories (campaign_id, category_id)
  select v_copy.id, t.category_id from public.discount_campaign_categories t
  where t.campaign_id = p_campaign_id;

  insert into public.discount_campaign_brands (campaign_id, brand_id)
  select v_copy.id, t.brand_id from public.discount_campaign_brands t
  where t.campaign_id = p_campaign_id;

  perform private.audit(v_actor, 'discount_campaign.duplicated', 'discount_campaign',
    v_copy.id::text, jsonb_build_object('source', p_campaign_id, 'name', v_name));

  return private.campaign_view(v_copy);
end;
$$;
/**
 * What a campaign (saved or still being drafted) would do to real products, in
 * the real pricing engine's own terms: today's price, the promotional price, and
 * whether an existing campaign would still win.
 */
create function public.admin_preview_campaign(
  p_scope public.campaign_scope,
  p_discount_kind public.campaign_discount_kind,
  p_discount_value bigint,
  p_max_discount_minor bigint default null,
  p_priority integer default 0,
  p_category_ids uuid[] default null,
  p_brand_ids uuid[] default null,
  p_product_ids uuid[] default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_size integer := least(100, greatest(1, coalesce(p_page_size, 25)));
  v_rank integer := case p_scope
    when 'products' then 1 when 'categories' then 2 when 'brands' then 3 else 4 end;
  v_total bigint;
  v_rows jsonb;
begin
  perform private.require_permission('discounts.view');
  if p_discount_value is null or p_discount_value < 1 then
    raise exception 'the discount must be more than zero' using errcode = 'NZ491';
  end if;
  if p_discount_kind = 'percent' and p_discount_value > 100 then
    raise exception 'a percentage cannot exceed 100' using errcode = 'NZ491';
  end if;

  with targets as (
    select * from private.target_products(p_scope, p_category_ids, p_brand_ids, p_product_ids)
  ),
  governed as (
    select * from public.product_campaigns(array(select product_id from targets))
  ),
  projected as (
    select
      t.*,
      coalesce(t.compare_at_price_minor, t.price_minor) as list_minor,
      g.campaign_id as current_campaign_id,
      g.campaign_title as current_campaign_title,
      g.campaign_scope as current_scope,
      g.priority as current_priority,
      case
        when g.campaign_id is null then true
        when v_rank < case g.campaign_scope
          when 'products' then 1 when 'categories' then 2 when 'brands' then 3 else 4 end then true
        when v_rank > case g.campaign_scope
          when 'products' then 1 when 'categories' then 2 when 'brands' then 3 else 4 end then false
        else p_priority >= g.priority
      end as wins
    from targets t
    left join governed g on g.product_id = t.product_id
  ),
  priced as (
    select
      p.*,
      case
        when p.wins then p.list_minor - public.campaign_discount_minor(
          p.list_minor, p_discount_kind, p_discount_value, p_max_discount_minor)
        else p.price_minor
      end as campaign_price_minor
    from projected p
  )
  select
    (select count(*) from priced),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'productId', q.product_id,
        'slug', q.slug,
        'name', q.name,
        'sku', q.sku,
        'categoryName', q.category_name,
        'status', q.status,
        'regularPriceMinor', q.list_minor,
        'productPriceMinor', q.price_minor,
        'campaignPriceMinor', q.campaign_price_minor,
        'campaignDiscountMinor', q.list_minor - q.campaign_price_minor,
        'overridesProductDiscount', q.wins and q.list_minor > q.price_minor,
        'governedBy', q.current_campaign_title,
        'wins', q.wins
      ) order by q.name, q.product_id)
      from (
        select * from priced
        order by name, product_id
        offset (v_page - 1) * v_size
        limit v_size
      ) q
    ), '[]'::jsonb)
  into v_total, v_rows;

  return jsonb_build_object(
    'products', v_rows,
    'page', v_page,
    'pageSize', v_size,
    'total', v_total,
    'activeTotal', (
      select count(*)::bigint
      from private.target_products(p_scope, p_category_ids, p_brand_ids, p_product_ids) t
      where t.status = 'active'
    ),
    'totalPages', case when v_total = 0 then 0 else ceil(v_total::numeric / v_size)::int end
  );
end;
$$;

/** The products a saved campaign reaches, with the prices it sets and who else wants them. */
create function public.admin_campaign_products(
  p_campaign_id uuid,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_campaign public.discount_campaigns;
begin
  perform private.require_permission('discounts.view');
  select * into v_campaign from public.discount_campaigns c where c.id = p_campaign_id;
  if not found then
    raise exception 'campaign not found' using errcode = 'NZ490';
  end if;
  return public.admin_preview_campaign(
    v_campaign.scope, v_campaign.discount_kind, v_campaign.discount_value,
    v_campaign.max_discount_minor, v_campaign.priority,
    case when v_campaign.scope = 'categories' then array(
      select t.category_id from public.discount_campaign_categories t
      where t.campaign_id = p_campaign_id) else null end,
    case when v_campaign.scope = 'brands' then array(
      select t.brand_id from public.discount_campaign_brands t
      where t.campaign_id = p_campaign_id) else null end,
    case when v_campaign.scope = 'products' then array(
      select t.product_id from public.discount_campaign_products t
      where t.campaign_id = p_campaign_id) else null end,
    p_page, p_page_size
  );
end;
$$;

/**
 * The campaigns that want at least one of the same products as this one. Reported
 * before activation so an administrator can see, and resolve, an overlap first.
 */
create function public.admin_campaign_conflicts(p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_campaign public.discount_campaigns;
begin
  perform private.require_permission('discounts.view');
  select * into v_campaign from public.discount_campaigns c where c.id = p_campaign_id;
  if not found then
    raise exception 'campaign not found' using errcode = 'NZ490';
  end if;

  return coalesce((
    with mine as (
      select p.product_id from private.campaign_products(v_campaign) p where p.status = 'active'
    ),
    others as (
      select c.* from public.discount_campaigns c
      where c.id <> p_campaign_id
        and c.status in ('scheduled', 'active')
        and (c.starts_at is null or c.ends_at is null or c.starts_at < coalesce(v_campaign.ends_at, 'infinity'))
        and (v_campaign.starts_at is null or c.ends_at is null or c.ends_at > v_campaign.starts_at)
    ),
    shared as (
      select o.id, count(*)::bigint as shared_products
      from others o
      join lateral private.campaign_products(o) op on true
      join mine m on m.product_id = op.product_id
      group by o.id
    )
    select jsonb_agg(jsonb_build_object(
      'campaignId', o.id,
      'name', o.name,
      'customerTitle', o.customer_title,
      'scope', o.scope,
      'discountKind', o.discount_kind,
      'discountValue', o.discount_value,
      'priority', o.priority,
      'status', o.status,
      'startsAt', o.starts_at,
      'endsAt', o.ends_at,
      'sharedProducts', s.shared_products
    ) order by s.shared_products desc, o.name)
    from others o
    join shared s on s.id = o.id
  ), '[]'::jsonb);
end;
$$;

/** The campaign's own audit trail, newest first. */
create function public.admin_campaign_history(
  p_campaign_id uuid,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(100, greatest(1, coalesce(p_limit, 50)));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_total bigint;
  v_entries jsonb;
begin
  perform private.require_permission('discounts.view');

  select count(*) into v_total
  from public.audit_log al
  where al.target_type = 'discount_campaign' and al.target_id = p_campaign_id::text;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'action', a.action,
    'actorId', a.actor_id,
    'actorName', p.full_name,
    'actorEmail', u.email,
    'details', a.details,
    'createdAt', a.created_at
  ) order by a.created_at desc, a.id desc), '[]'::jsonb)
  into v_entries
  from (
    select * from public.audit_log al
    where al.target_type = 'discount_campaign' and al.target_id = p_campaign_id::text
    order by al.created_at desc, al.id desc
    limit v_limit offset v_offset
  ) a
  left join public.profiles p on p.id = a.actor_id
  left join auth.users u on u.id = a.actor_id;

  return jsonb_build_object('entries', v_entries, 'total', v_total);
end;
$$;

/**
 * The live campaigns that reach each category, for the category management screen.
 * A category is reached when a product in it (or in a subcategory) is targeted.
 */
create function public.admin_category_campaigns(p_category_ids uuid[] default null)
returns table (
  category_id uuid,
  campaign_id uuid,
  customer_title text,
  scope public.campaign_scope,
  discount_kind public.campaign_discount_kind,
  discount_value bigint,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.campaign_status,
  product_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('discounts.view');
  return query
  with live as (
    select c.* from public.discount_campaigns c
    where c.status in ('scheduled', 'active')
  ),
  wanted as (
    select c.id from public.categories c
    where p_category_ids is null or c.id = any (p_category_ids)
  ),
  pairs as (
    select w.id as category_id, l.*
    from wanted w
    join live l on true
    where exists (
      select 1
      from private.campaign_products(l) cp
      join public.products pr on pr.id = cp.product_id
      join public.categories pc on pc.id = pr.category_id
      where pr.status = 'active'
        and w.id = any (private.category_ancestry(pc.id))
    )
  )
  select
    p.category_id, p.id, p.customer_title, p.scope, p.discount_kind, p.discount_value,
    p.starts_at, p.ends_at, p.status,
    (select count(*)
     from private.campaign_products(p) cp
     join public.products pr on pr.id = cp.product_id
     join public.categories pc on pc.id = pr.category_id
     where pr.status = 'active'
       and p.category_id = any (private.category_ancestry(pc.id)))::bigint
  from pairs p
  order by p.customer_title;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and Row Level Security
--
-- Campaign rows are never written directly: every mutation is a function above,
-- which checks the caller's permission, its version and the whole configuration.
-- ---------------------------------------------------------------------------

revoke all on table
  public.discount_campaigns, public.discount_campaign_products,
  public.discount_campaign_categories, public.discount_campaign_brands
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.discount_campaigns, public.discount_campaign_products,
  public.discount_campaign_categories, public.discount_campaign_brands
to service_role;

grant select on table
  public.discount_campaigns, public.discount_campaign_products,
  public.discount_campaign_categories, public.discount_campaign_brands
to authenticated;

alter table public.discount_campaigns enable row level security;
alter table public.discount_campaign_products enable row level security;
alter table public.discount_campaign_categories enable row level security;
alter table public.discount_campaign_brands enable row level security;

create policy "Discount managers read campaigns"
  on public.discount_campaigns for select to authenticated
  using (public.has_permission('discounts.view'));

create policy "Discount managers read campaign products"
  on public.discount_campaign_products for select to authenticated
  using (public.has_permission('discounts.view'));

create policy "Discount managers read campaign categories"
  on public.discount_campaign_categories for select to authenticated
  using (public.has_permission('discounts.view'));

create policy "Discount managers read campaign brands"
  on public.discount_campaign_brands for select to authenticated
  using (public.has_permission('discounts.view'));

revoke execute on function public.admin_list_campaigns(text, text, text, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.admin_get_campaign(uuid) from public, anon, authenticated;
revoke execute on function public.admin_save_campaign(
  uuid, text, text, public.campaign_scope, public.campaign_discount_kind, bigint, bigint,
  timestamptz, timestamptz, integer, boolean, text, public.campaign_coupon_policy,
  uuid[], uuid[], uuid[], text, integer) from public, anon, authenticated;
revoke execute on function public.admin_set_campaign_status(uuid, public.campaign_status, integer)
  from public, anon, authenticated;
revoke execute on function public.admin_duplicate_campaign(uuid) from public, anon, authenticated;
revoke execute on function public.admin_preview_campaign(
  public.campaign_scope, public.campaign_discount_kind, bigint, bigint, integer,
  uuid[], uuid[], uuid[], integer, integer) from public, anon, authenticated;
revoke execute on function public.admin_campaign_products(uuid, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.admin_campaign_conflicts(uuid) from public, anon, authenticated;
revoke execute on function public.admin_campaign_history(uuid, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.admin_category_campaigns(uuid[]) from public, anon, authenticated;

grant execute on function public.admin_list_campaigns(text, text, text, integer, integer) to authenticated, service_role;
grant execute on function public.admin_get_campaign(uuid) to authenticated, service_role;
grant execute on function public.admin_save_campaign(
  uuid, text, text, public.campaign_scope, public.campaign_discount_kind, bigint, bigint,
  timestamptz, timestamptz, integer, boolean, text, public.campaign_coupon_policy,
  uuid[], uuid[], uuid[], text, integer) to authenticated, service_role;
grant execute on function public.admin_set_campaign_status(uuid, public.campaign_status, integer) to authenticated, service_role;
grant execute on function public.admin_duplicate_campaign(uuid) to authenticated, service_role;
grant execute on function public.admin_preview_campaign(
  public.campaign_scope, public.campaign_discount_kind, bigint, bigint, integer,
  uuid[], uuid[], uuid[], integer, integer) to authenticated, service_role;
grant execute on function public.admin_campaign_products(uuid, integer, integer) to authenticated, service_role;
grant execute on function public.admin_campaign_conflicts(uuid) to authenticated, service_role;
grant execute on function public.admin_campaign_history(uuid, integer, integer) to authenticated, service_role;
grant execute on function public.admin_category_campaigns(uuid[]) to authenticated, service_role;