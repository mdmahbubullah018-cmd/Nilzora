-- ---------------------------------------------------------------------------
-- Deleting a product that was never sold
--
-- Products could only be archived. A product with orders must stay (order lines keep their
-- snapshot, but reports, returns and the stock ledger point at it), so archiving remains
-- the way to retire it. A product that was never ordered (a draft made by mistake, a test
-- item) can now be deleted for good:
--
--   * needs products.publish (the same authority that archives and publishes);
--   * refused while the product is on sale (NZ430) or once any order line names it (NZ442);
--   * its images, videos, variants, reviews and cart lines go with it (existing cascades),
--     its stock-ledger rows are removed explicitly (they only describe this product);
--   * answers the storage keys of its images and videos so the API deletes the files after
--     this commits, and writes one audit row with what was deleted.
--
-- Additive: one new function. Nothing existing changes.
-- ---------------------------------------------------------------------------

create function public.admin_delete_product(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.publish');
  v_product public.products;
  v_images text[];
  v_videos text[];
  v_movements integer;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product not found' using errcode = 'NZ404';
  end if;
  if v_product.status = 'active' then
    raise exception 'unpublish the product before deleting it' using errcode = 'NZ430';
  end if;
  if exists (select 1 from public.order_items i where i.product_id = p_product_id) then
    raise exception 'the product has orders: archive it instead' using errcode = 'NZ442';
  end if;

  select coalesce(array_agg(storage_key), '{}') into v_images
  from public.product_images where product_id = p_product_id;
  select coalesce(array_agg(storage_key), '{}') into v_videos
  from public.product_videos where product_id = p_product_id;

  delete from public.inventory_movements where product_id = p_product_id;
  get diagnostics v_movements = row_count;
  delete from public.products where id = p_product_id;

  perform private.audit(v_actor, 'product.deleted', 'product', p_product_id::text,
    jsonb_build_object('sku', v_product.sku, 'name', v_product.name,
      'images', cardinality(v_images), 'videos', cardinality(v_videos),
      'stockMovements', v_movements));

  return jsonb_build_object('imageKeys', to_jsonb(v_images), 'videoKeys', to_jsonb(v_videos));
end;
$$;

revoke execute on function public.admin_delete_product(uuid) from public, anon;
grant execute on function public.admin_delete_product(uuid) to authenticated, service_role;
