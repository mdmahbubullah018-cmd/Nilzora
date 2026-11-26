-- ---------------------------------------------------------------------------
-- Deleting a brand
--
-- Only a brand no product belongs to can be deleted (NZ442 otherwise), so a product
-- never loses its brand silently. The brand's old-address redirects go with it (their
-- foreign key cascades). The function answers with the logo's base key so the API can
-- remove the logo files after the delete has committed. Needs products.publish, like
-- every other brand change; audited.
--
-- Additive only: one new function.
-- ---------------------------------------------------------------------------

create function public.admin_delete_brand(p_brand_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.publish');
  v_brand public.brands;
  v_products integer;
begin
  select * into v_brand from public.brands where id = p_brand_id for update;
  if not found then
    raise exception 'brand not found' using errcode = 'NZ404';
  end if;
  -- Products are locked too, so none can be moved to the brand while it is deleted.
  select count(*) into v_products
  from (select 1 from public.products where brand_id = p_brand_id for update) p;
  if v_products > 0 then
    raise exception 'products still belong to the brand' using errcode = 'NZ442';
  end if;

  delete from public.brands where id = p_brand_id;
  perform private.audit(v_actor, 'brand.deleted', 'brand', p_brand_id::text,
    jsonb_build_object('slug', v_brand.slug, 'name', v_brand.name));
  return v_brand.logo_key;
end;
$$;

revoke execute on function public.admin_delete_brand(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_brand(uuid) to authenticated;
