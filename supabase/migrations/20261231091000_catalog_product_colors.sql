-- ===========================================================================
-- Product card colour previews
-- ===========================================================================
-- A listing card shows the colours a product is sold in, so a shopper can see there is a
-- choice without opening the product. The public role cannot read the variant tables — they
-- are reachable only through catalog_product_variants(p_slug), one product at a time — so a
-- page of 24 cards would need 24 calls.
--
-- This adds ONE read-only function that answers the whole page at once. It creates no table,
-- changes no column, writes nothing, and does not touch variant ids, SKUs, prices or stock:
-- the variant system keeps working exactly as it does today, and the product page keeps using
-- catalog_product_variants for the full option set.
--
-- Only colours that carry a configured swatch are returned, because a card preview has no room
-- for a name and a colour must never be invented. Callers still ask for at least two colours
-- before drawing anything.
-- ===========================================================================

create function public.catalog_product_colors(p_product_ids uuid[])
returns table (
  product_id uuid,
  value text,
  value_slug text,
  swatch_hex text,
  "position" integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (v.product_id, av.slug)
         v.product_id,
         av.value,
         av.slug,
         av.swatch_hex,
         av.position
  from public.product_variants v
  join public.product_variant_values pvv on pvv.variant_id = v.id
  join public.product_attribute_values av on av.id = pvv.attribute_value_id
  join public.product_attributes a on a.id = pvv.attribute_id
  join public.products p on p.id = v.product_id
  join public.categories c on c.id = p.category_id
  where v.product_id = any (p_product_ids)
    and v.is_active
    and p.status = 'active'
    and c.is_active
    and a.kind = 'color'
    and av.swatch_hex is not null
  order by v.product_id, av.slug, av.position;
$$;

comment on function public.catalog_product_colors(uuid[]) is
  'The colours each listed product is sold in, with their configured swatches, for the card preview. Read only.';

revoke execute on function public.catalog_product_colors(uuid[]) from public, anon, authenticated;
grant execute on function public.catalog_product_colors(uuid[]) to anon, authenticated, service_role;
