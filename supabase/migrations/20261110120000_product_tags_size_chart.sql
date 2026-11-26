-- ---------------------------------------------------------------------------
-- Product tags and size charts
--
--   tags        up to 15 merchandising tags (1 to 30 characters: lower-case letters,
--               digits, single spaces and hyphens), de-duplicated. Staff only: no
--               column privilege is granted, staff read them through
--               admin_product_tags(). Like the price and featuring, changing them on a
--               product on sale needs products.publish.
--   size_chart  null or { columns: 1..8 headings, rows: 1..30 rows of the same width },
--               every entry at most 40 characters. Shown to shoppers, so it is content:
--               it changes only while the product is not on sale and not under review,
--               and a change sends the product back for review.
--
-- admin_create_product and admin_update_product gain overloads that also take the new
-- fields; the existing signatures now delegate to them with "no tags, no chart" (create)
-- and "keep both" (update), so every existing caller behaves exactly as before.
--
-- The product search vector is a generated column; tags are deliberately not added to
-- it here (that needs the column's expression rebuilt, which is not a small change).
--
-- Additive only: two columns, validators and new function overloads.
-- ---------------------------------------------------------------------------

/** Whether a tag list is stored in its normal form (lower-case, trimmed, unique, ≤ 15). */
create function private.product_tags_valid(p_tags text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_tags is not null
    and coalesce(array_ndims(p_tags), 1) = 1
    and cardinality(p_tags) <= 15
    and not exists (
      select 1 from unnest(p_tags) as t (tag)
      where t.tag is null
         or char_length(t.tag) not between 1 and 30
         or t.tag !~ '^[a-z0-9]([a-z0-9 -]*[a-z0-9])?$'
         or t.tag like '%  %'
    )
    and cardinality(p_tags) = (select count(distinct t.tag) from unnest(p_tags) as t (tag));
$$;

/** Trims and lower-cases tags, collapses inner spaces, drops empties and repeats (first kept). */
create function private.normalize_product_tags(p_tags text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(n.tag order by n.first_position), '{}'::text[])
  from (
    select x.tag, min(x.position) as first_position
    from (
      select lower(regexp_replace(btrim(u.tag), '\s+', ' ', 'g')) as tag, u.position
      from unnest(coalesce(p_tags, '{}'::text[])) with ordinality as u (tag, position)
    ) x
    where x.tag is not null and x.tag <> ''
    group by x.tag
  ) n;
$$;

/** Whether a size chart has the stored shape (null, meaning none, is valid). */
create function private.size_chart_valid(p_chart jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_width integer;
  v_row jsonb;
  v_cell jsonb;
begin
  if p_chart is null then
    return true;
  end if;
  if jsonb_typeof(p_chart) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_chart) as k (name) where k.name not in ('columns', 'rows'))
     or jsonb_typeof(p_chart -> 'columns') is distinct from 'array'
     or jsonb_typeof(p_chart -> 'rows') is distinct from 'array' then
    return false;
  end if;

  v_width := jsonb_array_length(p_chart -> 'columns');
  if v_width not between 1 and 8 or jsonb_array_length(p_chart -> 'rows') not between 1 and 30 then
    return false;
  end if;

  for v_cell in select c.value from jsonb_array_elements(p_chart -> 'columns') as c loop
    if jsonb_typeof(v_cell) <> 'string'
       or btrim(v_cell #>> '{}') = ''
       or char_length(v_cell #>> '{}') > 40 then
      return false;
    end if;
  end loop;

  for v_row in select r.value from jsonb_array_elements(p_chart -> 'rows') as r loop
    if jsonb_typeof(v_row) <> 'array' or jsonb_array_length(v_row) <> v_width then
      return false;
    end if;
    for v_cell in select c.value from jsonb_array_elements(v_row) as c loop
      if jsonb_typeof(v_cell) <> 'string' or char_length(v_cell #>> '{}') > 40 then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;

alter table public.products
  add column tags text[] not null default '{}'::text[]
    constraint products_tags_valid check (private.product_tags_valid(tags)),
  add column size_chart jsonb
    constraint products_size_chart_valid check (private.size_chart_valid(size_chart));

comment on column public.products.tags is
  'Merchandising tags (staff only). Normal form: lower-case, trimmed, unique, at most 15.';
comment on column public.products.size_chart is
  'Size chart shown to shoppers: { columns: [...], rows: [[...], ...] }, or null.';

-- Shoppers see the size chart with the rest of an active product; tags stay private.
grant select (size_chart) on table public.products to anon, authenticated;

/** A product's tags for staff who may read products; null otherwise (or when not found). */
create function public.admin_product_tags(p_product_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select p.tags
  from public.products p
  where p.id = p_product_id
    and private.has_permission('products.read');
$$;

-- ---------------------------------------------------------------------------
-- Create: the full form, and the original signature delegating to it
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_product(
  p_category_id uuid,
  p_slug text,
  p_sku text,
  p_name text,
  p_summary text,
  p_description text,
  p_price_minor bigint,
  p_compare_at_price_minor bigint,
  p_max_order_quantity integer,
  p_is_featured boolean,
  p_initial_stock integer,
  p_tags text[],
  p_size_chart jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.create');
  v_tags text[] := private.normalize_product_tags(p_tags);
  v_id uuid;
begin
  if p_initial_stock is null or p_initial_stock < 0 or p_initial_stock > 1000000 then
    raise exception 'initial stock must be from 0 to 1,000,000' using errcode = 'NZ412';
  end if;
  if not exists (select 1 from public.categories where id = p_category_id) then
    raise exception 'category not found' using errcode = 'NZ412';
  end if;
  if not private.product_tags_valid(v_tags) then
    raise exception 'invalid tags' using errcode = 'NZ412';
  end if;
  if not private.size_chart_valid(p_size_chart) then
    raise exception 'invalid size chart' using errcode = 'NZ412';
  end if;

  insert into public.products (
    category_id, slug, sku, name, summary, description, price_minor, compare_at_price_minor,
    stock_quantity, max_order_quantity, is_featured, status, moderation_status,
    created_by, updated_by, content_updated_by, tags, size_chart
  ) values (
    p_category_id, p_slug, p_sku, btrim(p_name), nullif(btrim(coalesce(p_summary, '')), ''),
    nullif(btrim(coalesce(p_description, '')), ''), p_price_minor, p_compare_at_price_minor,
    p_initial_stock, coalesce(p_max_order_quantity, 10), coalesce(p_is_featured, false),
    'draft', 'not_submitted', v_actor, v_actor, v_actor, v_tags, p_size_chart
  )
  returning id into v_id;

  if p_initial_stock > 0 then
    insert into public.inventory_movements (product_id, change, stock_after, reason, actor_id, note)
    values (v_id, p_initial_stock, p_initial_stock, 'initial_stock', v_actor, 'Initial stock');
  end if;

  perform private.audit(v_actor, 'product.created', 'product', v_id::text,
    jsonb_build_object('sku', p_sku, 'initialStock', p_initial_stock));
  return v_id;
end;
$$;

create or replace function public.admin_create_product(
  p_category_id uuid,
  p_slug text,
  p_sku text,
  p_name text,
  p_summary text,
  p_description text,
  p_price_minor bigint,
  p_compare_at_price_minor bigint,
  p_max_order_quantity integer,
  p_is_featured boolean,
  p_initial_stock integer
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.admin_create_product(
    p_category_id, p_slug, p_sku, p_name, p_summary, p_description, p_price_minor,
    p_compare_at_price_minor, p_max_order_quantity, p_is_featured, p_initial_stock,
    '{}'::text[], null::jsonb
  );
$$;

-- ---------------------------------------------------------------------------
-- Update: the full form, and the original signature delegating to it
-- ---------------------------------------------------------------------------

/**
 * `p_tags` null keeps the current tags; `p_replace_size_chart` false keeps the current
 * chart (true sets it to `p_size_chart`, where null removes it).
 */
create or replace function public.admin_update_product(
  p_product_id uuid,
  p_category_id uuid,
  p_slug text,
  p_name text,
  p_summary text,
  p_description text,
  p_price_minor bigint,
  p_compare_at_price_minor bigint,
  p_max_order_quantity integer,
  p_is_featured boolean,
  p_tags text[],
  p_size_chart jsonb,
  p_replace_size_chart boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.update');
  v_product public.products;
  v_summary text := nullif(btrim(coalesce(p_summary, '')), '');
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_tags text[];
  v_size_chart jsonb;
  v_tags_changed boolean;
  v_chart_changed boolean;
  v_content_changed boolean;
  v_operations_changed boolean;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product not found' using errcode = 'NZ404';
  end if;
  if not exists (select 1 from public.categories where id = p_category_id) then
    raise exception 'category not found' using errcode = 'NZ412';
  end if;

  v_tags := case when p_tags is null then v_product.tags
                 else private.normalize_product_tags(p_tags) end;
  v_size_chart := case when coalesce(p_replace_size_chart, false) then p_size_chart
                       else v_product.size_chart end;
  if not private.product_tags_valid(v_tags) then
    raise exception 'invalid tags' using errcode = 'NZ412';
  end if;
  if not private.size_chart_valid(v_size_chart) then
    raise exception 'invalid size chart' using errcode = 'NZ412';
  end if;
  v_tags_changed := v_product.tags is distinct from v_tags;
  v_chart_changed := v_product.size_chart is distinct from v_size_chart;

  v_content_changed :=
    v_product.category_id is distinct from p_category_id
    or v_product.slug is distinct from p_slug
    or v_product.name is distinct from btrim(p_name)
    or v_product.summary is distinct from v_summary
    or v_product.description is distinct from v_description
    or v_chart_changed;
  v_operations_changed :=
    v_product.price_minor is distinct from p_price_minor
    or v_product.compare_at_price_minor is distinct from p_compare_at_price_minor
    or v_product.max_order_quantity is distinct from p_max_order_quantity
    or v_product.is_featured is distinct from coalesce(p_is_featured, false)
    or v_tags_changed;

  if v_content_changed and v_product.status = 'active' then
    raise exception 'unpublish the product before changing its content' using errcode = 'NZ430';
  end if;
  if v_content_changed and v_product.moderation_status = 'pending' then
    raise exception 'the product is under review' using errcode = 'NZ431';
  end if;
  -- What shoppers pay for a product on sale is decided by publishers only.
  if v_operations_changed and v_product.status = 'active'
     and not exists (select 1 from private.permissions_of(v_actor) as x (name) where x.name = 'products.publish') then
    raise exception 'changing a product on sale needs products.publish' using errcode = 'NZ403';
  end if;

  update public.products
  set category_id = p_category_id,
      slug = p_slug,
      name = btrim(p_name),
      summary = v_summary,
      description = v_description,
      price_minor = p_price_minor,
      compare_at_price_minor = p_compare_at_price_minor,
      max_order_quantity = p_max_order_quantity,
      is_featured = coalesce(p_is_featured, false),
      tags = v_tags,
      size_chart = v_size_chart,
      moderation_status = case when v_content_changed then 'not_submitted' else moderation_status end,
      content_updated_by = case when v_content_changed then v_actor else content_updated_by end,
      updated_by = v_actor
  where id = p_product_id;

  perform private.audit(v_actor, 'product.updated', 'product', p_product_id::text,
    jsonb_build_object(
      'contentChanged', v_content_changed,
      'priceMinor', jsonb_build_object('from', v_product.price_minor, 'to', p_price_minor),
      'tagsChanged', v_tags_changed,
      'sizeChartChanged', v_chart_changed
    ));
end;
$$;

create or replace function public.admin_update_product(
  p_product_id uuid,
  p_category_id uuid,
  p_slug text,
  p_name text,
  p_summary text,
  p_description text,
  p_price_minor bigint,
  p_compare_at_price_minor bigint,
  p_max_order_quantity integer,
  p_is_featured boolean
)
returns void
language sql
security definer
set search_path = ''
as $$
  select public.admin_update_product(
    p_product_id, p_category_id, p_slug, p_name, p_summary, p_description, p_price_minor,
    p_compare_at_price_minor, p_max_order_quantity, p_is_featured,
    null::text[], null::jsonb, false
  );
$$;

revoke execute on function public.admin_create_product(
  uuid, text, text, text, text, text, bigint, bigint, integer, boolean, integer, text[], jsonb
) from public, anon, authenticated;
revoke execute on function public.admin_update_product(
  uuid, uuid, text, text, text, text, bigint, bigint, integer, boolean, text[], jsonb, boolean
) from public, anon, authenticated;
revoke execute on function public.admin_product_tags(uuid) from public, anon, authenticated;

grant execute on function public.admin_create_product(
  uuid, text, text, text, text, text, bigint, bigint, integer, boolean, integer, text[], jsonb
) to authenticated;
grant execute on function public.admin_update_product(
  uuid, uuid, text, text, text, text, bigint, bigint, integer, boolean, text[], jsonb, boolean
) to authenticated;
grant execute on function public.admin_product_tags(uuid) to authenticated;
