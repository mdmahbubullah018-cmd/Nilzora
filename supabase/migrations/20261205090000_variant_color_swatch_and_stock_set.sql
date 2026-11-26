-- ---------------------------------------------------------------------------
-- Colour identity, swatches and absolute stock setting for variants
--
-- 1. `product_attributes.kind` names what an attribute is: a colour, a size, or
--    something else. The storefront and the app draw a colour as a swatch and a size as
--    a chip; the admin groups them the same way. Existing rows keep 'other', so nothing
--    that ships today changes appearance until an admin marks an attribute.
--
-- 2. `product_attribute_values.swatch_hex` is an optional #RRGGBB for one colour value
--    (Black, Navy, Cherry Red …). A value without it renders as the text chip it does
--    today, so a pattern or printed fabric is never forced into a single colour.
--
-- 3. `admin_save_attribute` and `admin_save_attribute_value` gain the new trailing
--    argument with a default: a caller that does not send it behaves exactly as before.
--    Because the argument list changes, the old signatures are replaced rather than
--    shadowed (a defaulted parameter creates a new function in PostgreSQL).
--
-- 4. `admin_list_attributes` and `catalog_product_variants` report the kind and the
--    swatch, so both clients read the same facts.
--
-- 5. `admin_set_variant_stock` sets an exact count ("Set stock" in the admin), while the
--    existing `admin_adjust_variant_stock` keeps powering Add (+n), Remove (−n) and a
--    correction (the same signed change with a required reason). Every one of them
--    writes the inventory ledger; nothing rewrites history.
--
-- 6. A variant that has been ordered or has stock history is no longer deleted: the
--    function refuses (NZ409) and the admin deactivates it instead, so an order's
--    variant reference can never be lost by a product edit.
--
-- Additive and backward compatible: no table, column, order or grant is removed.
-- ---------------------------------------------------------------------------

alter table public.product_attributes
  add column kind text not null default 'other'
  constraint product_attributes_kind_check check (kind in ('color', 'size', 'other'));

comment on column public.product_attributes.kind is
  'What the attribute is: a colour (rendered as a swatch), a size (a chip) or other.';

alter table public.product_attribute_values
  add column swatch_hex text
  constraint product_attribute_values_swatch_hex_check
  check (swatch_hex is null or swatch_hex ~ '^#[0-9a-fA-F]{6}$');

comment on column public.product_attribute_values.swatch_hex is
  'Optional #RRGGBB for a colour value; null renders the value as a text chip.';

-- ---------------------------------------------------------------------------
-- Admin: create or change an attribute (now with its kind)
-- ---------------------------------------------------------------------------

drop function public.admin_save_attribute(uuid, text, text, integer, boolean);

create function public.admin_save_attribute(
  p_attribute_id uuid,
  p_slug text,
  p_name text,
  p_position integer,
  p_is_active boolean,
  p_kind text default 'other'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.update');
  v_kind text := coalesce(nullif(btrim(p_kind), ''), 'other');
  v_id uuid;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 40 then
    raise exception 'the attribute address is not valid' using errcode = 'NZ412';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 40 then
    raise exception 'the attribute name must be 1 to 40 characters' using errcode = 'NZ412';
  end if;
  if v_kind not in ('color', 'size', 'other') then
    raise exception 'the attribute kind is not valid' using errcode = 'NZ412';
  end if;
  if exists (select 1 from public.product_attributes
             where slug = p_slug and id is distinct from p_attribute_id) then
    raise exception 'an attribute with this address already exists' using errcode = 'NZ441';
  end if;

  if p_attribute_id is null then
    insert into public.product_attributes (slug, name, position, is_active, kind)
    values (p_slug, btrim(p_name), coalesce(p_position, 0), coalesce(p_is_active, true), v_kind)
    returning id into v_id;
    perform private.audit(v_actor, 'attribute.created', 'product_attribute', v_id::text,
      jsonb_build_object('slug', p_slug, 'kind', v_kind));
  else
    update public.product_attributes
    set slug = p_slug,
        name = btrim(p_name),
        position = coalesce(p_position, position),
        is_active = coalesce(p_is_active, is_active),
        kind = v_kind
    where id = p_attribute_id
    returning id into v_id;
    if v_id is null then
      raise exception 'attribute not found' using errcode = 'NZ404';
    end if;
    perform private.audit(v_actor, 'attribute.updated', 'product_attribute', v_id::text,
      jsonb_build_object('slug', p_slug, 'kind', v_kind));
  end if;

  return v_id;
end;
$$;

revoke execute on function public.admin_save_attribute(uuid, text, text, integer, boolean, text)
  from public, anon, authenticated;
grant execute on function public.admin_save_attribute(uuid, text, text, integer, boolean, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: create or change one value (now with an optional swatch)
-- ---------------------------------------------------------------------------

drop function public.admin_save_attribute_value(uuid, uuid, text, text, integer);

create function public.admin_save_attribute_value(
  p_value_id uuid,
  p_attribute_id uuid,
  p_slug text,
  p_value text,
  p_position integer,
  p_swatch_hex text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.update');
  v_swatch text := nullif(btrim(coalesce(p_swatch_hex, '')), '');
  v_id uuid;
begin
  if p_attribute_id is null then
    raise exception 'an attribute is required' using errcode = 'NZ412';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 40 then
    raise exception 'the value address is not valid' using errcode = 'NZ412';
  end if;
  if p_value is null or char_length(btrim(p_value)) not between 1 and 40 then
    raise exception 'the value must be 1 to 40 characters' using errcode = 'NZ412';
  end if;
  if v_swatch is not null and v_swatch !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'the swatch must be a colour such as #0F172A' using errcode = 'NZ412';
  end if;
  if exists (select 1 from public.product_attribute_values
             where attribute_id = p_attribute_id and slug = p_slug
               and id is distinct from p_value_id) then
    raise exception 'this attribute already has that value' using errcode = 'NZ441';
  end if;

  if p_value_id is null then
    insert into public.product_attribute_values (attribute_id, slug, value, position, swatch_hex)
    values (p_attribute_id, p_slug, btrim(p_value), coalesce(p_position, 0), v_swatch)
    returning id into v_id;
    perform private.audit(v_actor, 'attribute_value.created', 'product_attribute_value', v_id::text,
      jsonb_build_object('attribute', p_attribute_id, 'value', p_value, 'swatch', v_swatch));
  else
    update public.product_attribute_values
    set slug = p_slug,
        value = btrim(p_value),
        position = coalesce(p_position, position),
        swatch_hex = v_swatch
    where id = p_value_id and attribute_id = p_attribute_id
    returning id into v_id;
    if v_id is null then
      raise exception 'attribute value not found' using errcode = 'NZ404';
    end if;
    perform private.audit(v_actor, 'attribute_value.updated', 'product_attribute_value', v_id::text,
      jsonb_build_object('attribute', p_attribute_id, 'value', p_value, 'swatch', v_swatch));
  end if;

  return v_id;
end;
$$;

revoke execute on function public.admin_save_attribute_value(uuid, uuid, text, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.admin_save_attribute_value(uuid, uuid, text, text, integer, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Reads: the kind and the swatch travel with the value
-- ---------------------------------------------------------------------------

drop function public.admin_list_attributes();

create function public.admin_list_attributes()
returns table (
  id uuid,
  slug text,
  name text,
  "position" integer,
  is_active boolean,
  kind text,
  "values" jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.read');
begin
  return query
  select a.id, a.slug, a.name, a.position, a.is_active, a.kind,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', av.id, 'slug', av.slug, 'value', av.value, 'position', av.position,
                    'swatchHex', av.swatch_hex
                  ) order by av.position, av.value)
           from public.product_attribute_values av
           where av.attribute_id = a.id
         ), '[]'::jsonb)
  from public.product_attributes a
  order by a.position, a.name;
end;
$$;

revoke execute on function public.admin_list_attributes() from public, anon, authenticated;
grant execute on function public.admin_list_attributes() to authenticated;

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
               'kind', a.kind,
               'value', av.value,
               'valueSlug', av.slug,
               'swatchHex', av.swatch_hex
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
-- Admin: set a variant's stock to an exact count
-- ---------------------------------------------------------------------------

create function public.admin_set_variant_stock(
  p_variant_id uuid,
  p_stock integer,
  p_note text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('inventory.adjust');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_stock integer;
  v_product uuid;
begin
  if p_stock is null or p_stock < 0 or p_stock > 1000000 then
    raise exception 'the stock must be a whole number from zero' using errcode = 'NZ412';
  end if;
  if v_note is null or char_length(v_note) < 3 or char_length(v_note) > 300 then
    raise exception 'a reason of 3 to 300 characters is required' using errcode = 'NZ412';
  end if;

  select stock_quantity, product_id into v_stock, v_product
  from public.product_variants where id = p_variant_id for update;
  if v_stock is null then
    raise exception 'variant not found' using errcode = 'NZ404';
  end if;
  if v_stock = p_stock then
    return v_stock;
  end if;

  update public.product_variants set stock_quantity = p_stock where id = p_variant_id;

  insert into public.inventory_movements
    (product_id, variant_id, change, stock_after, reason, actor_id, note)
  values (v_product, p_variant_id, p_stock - v_stock, p_stock, 'stock_set', v_actor, v_note);

  perform private.audit(v_actor, 'inventory.variant_stock_set', 'product_variant', p_variant_id::text,
    jsonb_build_object('from', v_stock, 'to', p_stock));
  return p_stock;
end;
$$;

revoke execute on function public.admin_set_variant_stock(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.admin_set_variant_stock(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- A variant with history is deactivated, never deleted
-- ---------------------------------------------------------------------------

create or replace function public.admin_delete_variant(p_variant_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.publish');
  v_product uuid;
begin
  if exists (select 1 from public.order_items oi where oi.variant_id = p_variant_id)
     or exists (select 1 from public.inventory_movements im
                where im.variant_id = p_variant_id and im.reason <> 'initial_stock') then
    raise exception 'this combination has order or stock history; hide it instead'
      using errcode = 'NZ409';
  end if;

  delete from public.product_variants where id = p_variant_id returning product_id into v_product;
  if v_product is null then
    raise exception 'variant not found' using errcode = 'NZ404';
  end if;
  perform private.audit(v_actor, 'variant.deleted', 'product_variant', p_variant_id::text,
    jsonb_build_object('product', v_product));
  return true;
end;
$$;
