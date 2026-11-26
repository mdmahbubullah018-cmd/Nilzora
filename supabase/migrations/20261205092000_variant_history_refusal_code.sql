-- ---------------------------------------------------------------------------
-- A variant with history answers with its own refusal
--
-- 20261205090000 guarded admin_delete_variant with NZ409, which the API already
-- answers as "category in use", so a shopkeeper was told to move a category's
-- products when the real reason was the variant's orders. NZ473 is unused and
-- maps to variant_has_history in the API.
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
      using errcode = 'NZ473';
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

revoke execute on function public.admin_delete_variant(uuid) from public, anon;
grant execute on function public.admin_delete_variant(uuid) to authenticated;
