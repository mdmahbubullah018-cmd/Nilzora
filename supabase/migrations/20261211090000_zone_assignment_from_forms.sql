/*
 * Shopping zone assignment from the product and category forms
 * ===========================================================
 * The zone editor writes the junction tables from the zone's side. These four functions let
 * a product's or a category's own page do the same from the other side, so an admin does not
 * have to leave the record they are editing.
 *
 * There is still exactly one model and one rule:
 *   - `product_shopping_zones` and `category_shopping_zones` are the only places an
 *     association lives, and the zone editor and these functions write the same rows.
 *   - `private.product_zone_ids()` still decides membership (explicit rows win, otherwise the
 *     category's zones). Nothing here re-states that rule, so the two surfaces cannot drift.
 *
 * Product semantics, stated plainly because the UI has to show them:
 *   - no explicit rows  → the product follows its category (inherited zones)
 *   - one or more rows  → the product belongs to exactly those zones, and its category's
 *                         zones are ignored for it
 *   - an empty list is therefore the same as "follow the category": an explicit empty set is
 *     indistinguishable from no set by the rule above, so it is not offered as a third state.
 *
 * Rollback
 *   drop function public.admin_set_category_zones(uuid, uuid[]);
 *   drop function public.admin_category_zones(uuid);
 *   drop function public.admin_set_product_zones(uuid, uuid[]);
 *   drop function public.admin_product_zones(uuid);
 * No table, row or stored banner is touched by dropping these.
 */

-- ---------------------------------------------------------------------------
-- 1. A product's zones, as the two states the rule actually has
-- ---------------------------------------------------------------------------

/**
 * What a product's page needs to show: the zones pinned to it, the zones of its category,
 * and what the product therefore resolves to. All three, so the form can explain the result
 * instead of leaving the admin to infer it.
 */
create function public.admin_product_zones(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('zones.manage');
  v_category uuid;
  v_mine jsonb;
  v_inherited jsonb;
begin
  select p.category_id into v_category from public.products p where p.id = p_product_id;
  if v_category is null then
    raise exception 'product not found' using errcode = 'NZ404';
  end if;

  select coalesce(jsonb_agg(pz.zone_id order by pz.zone_id), '[]'::jsonb)
    into v_mine
    from public.product_shopping_zones pz
   where pz.product_id = p_product_id;

  select coalesce(jsonb_agg(cz.zone_id order by cz.zone_id), '[]'::jsonb)
    into v_inherited
    from public.category_shopping_zones cz
   where cz.category_id = v_category;

  return jsonb_build_object(
    'mine', v_mine,
    'inherited', v_inherited,
    'resolved', to_jsonb(private.product_zone_ids(p_product_id, v_category))
  );
end;
$$;

/**
 * Replaces a product's pinned zones. An empty list clears them, which hands the product back
 * to its category — the same two states the listing rule understands.
 */
create function public.admin_set_product_zones(p_product_id uuid, p_zone_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('zones.manage');
  v_ids uuid[] := coalesce(p_zone_ids, '{}'::uuid[]);
  v_kept integer;
begin
  if not exists (select 1 from public.products p where p.id = p_product_id) then
    raise exception 'product not found' using errcode = 'NZ404';
  end if;
  if exists (select 1 from unnest(v_ids) as t(id) where t.id is null) then
    raise exception 'invalid zone id' using errcode = 'NZ412';
  end if;
  -- `t.id`, not `id`: inside the subquery an unqualified `id` binds to the zone row's own
  -- column, which would make this check compare a row with itself and never fire.
  if exists (
    select 1 from unnest(v_ids) as t(id)
     where not exists (select 1 from public.shopping_zones z where z.id = t.id)
  ) then
    raise exception 'one of those zones no longer exists' using errcode = 'NZ412';
  end if;

  delete from public.product_shopping_zones where product_id = p_product_id;
  insert into public.product_shopping_zones (zone_id, product_id)
  select id, p_product_id from unnest(v_ids) as id
  on conflict (zone_id, product_id) do nothing;
  select count(*)::int into v_kept
    from public.product_shopping_zones where product_id = p_product_id;

  perform private.audit(v_actor, 'product.zones_set', 'product', p_product_id::text,
    jsonb_build_object('zones', v_kept));
  return v_kept;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. A category's zones (pure inheritance, no precedence to explain)
-- ---------------------------------------------------------------------------

/** The zones a category feeds to the products that have no zones of their own. */
create function public.admin_category_zones(p_category_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('zones.manage');
begin
  if not exists (select 1 from public.categories c where c.id = p_category_id) then
    raise exception 'category not found' using errcode = 'NZ404';
  end if;
  return jsonb_build_object(
    'zoneIds', (
      select coalesce(jsonb_agg(cz.zone_id order by cz.zone_id), '[]'::jsonb)
        from public.category_shopping_zones cz
       where cz.category_id = p_category_id
    )
  );
end;
$$;

/** Replaces a category's zones. An empty list is allowed: the category feeds none. */
create function public.admin_set_category_zones(p_category_id uuid, p_zone_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('zones.manage');
  v_ids uuid[] := coalesce(p_zone_ids, '{}'::uuid[]);
  v_kept integer;
begin
  if not exists (select 1 from public.categories c where c.id = p_category_id) then
    raise exception 'category not found' using errcode = 'NZ404';
  end if;
  if exists (select 1 from unnest(v_ids) as t(id) where t.id is null) then
    raise exception 'invalid zone id' using errcode = 'NZ412';
  end if;
  if exists (
    select 1 from unnest(v_ids) as t(id)
     where not exists (select 1 from public.shopping_zones z where z.id = t.id)
  ) then
    raise exception 'one of those zones no longer exists' using errcode = 'NZ412';
  end if;

  delete from public.category_shopping_zones where category_id = p_category_id;
  insert into public.category_shopping_zones (zone_id, category_id)
  select id, p_category_id from unnest(v_ids) as id
  on conflict (zone_id, category_id) do nothing;
  select count(*)::int into v_kept
    from public.category_shopping_zones where category_id = p_category_id;

  perform private.audit(v_actor, 'category.zones_set', 'category', p_category_id::text,
    jsonb_build_object('zones', v_kept));
  return v_kept;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Correction to the two zone-editor writes deployed with the zone tables
-- ---------------------------------------------------------------------------

/*
 * Both functions validated their id lists with an unqualified `id` inside a nested
 * subquery, where it bound to the *inner* table's own column — the predicate compared a row
 * with itself, so the "no longer exists" branch could never fire. The foreign key still
 * refused a bad id (23503), so no bad row was ever written, but the API answered a generic
 * failure instead of telling the admin which field was wrong. These are the same functions
 * with the alias qualified; nothing else changes.
 */

create or replace function public.admin_set_shopping_zone_products(
  p_zone_id uuid,
  p_product_ids uuid[]
)
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
  if exists (select 1 from unnest(v_ids) as t(id) where t.id is null) then
    raise exception 'invalid product id' using errcode = 'NZ412';
  end if;
  if exists (
    select 1 from unnest(v_ids) as t(id)
     where not exists (select 1 from public.products p where p.id = t.id)
  ) then
    raise exception 'one of those products no longer exists' using errcode = 'NZ412';
  end if;

  delete from public.product_shopping_zones
   where zone_id = p_zone_id
     and not (product_id = any (v_ids));
  insert into public.product_shopping_zones (zone_id, product_id)
  select p_zone_id, t.id from unnest(v_ids) as t(id)
  on conflict (zone_id, product_id) do nothing;
  select count(*)::int into v_kept from public.product_shopping_zones where zone_id = p_zone_id;

  perform private.audit(v_actor, 'zone.products_set', 'shopping_zone', p_zone_id::text,
    jsonb_build_object('products', v_kept));
  return v_kept;
end;
$$;

create or replace function public.admin_set_shopping_zone_categories(
  p_zone_id uuid,
  p_category_ids uuid[]
)
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
  if exists (select 1 from unnest(v_ids) as t(id) where t.id is null) then
    raise exception 'invalid category id' using errcode = 'NZ412';
  end if;
  if exists (
    select 1 from unnest(v_ids) as t(id)
     where not exists (select 1 from public.categories c where c.id = t.id)
  ) then
    raise exception 'one of those categories no longer exists' using errcode = 'NZ412';
  end if;

  delete from public.category_shopping_zones
   where zone_id = p_zone_id
     and not (category_id = any (v_ids));
  insert into public.category_shopping_zones (zone_id, category_id)
  select p_zone_id, t.id from unnest(v_ids) as t(id)
  on conflict (zone_id, category_id) do nothing;
  select count(*)::int into v_kept from public.category_shopping_zones where zone_id = p_zone_id;

  perform private.audit(v_actor, 'zone.categories_set', 'shopping_zone', p_zone_id::text,
    jsonb_build_object('categories', v_kept));
  return v_kept;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants: signed-in accounts only, and the functions check the permission themselves
-- ---------------------------------------------------------------------------

revoke execute on function public.admin_product_zones(uuid) from public, anon, authenticated;
revoke execute on function public.admin_set_product_zones(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.admin_category_zones(uuid) from public, anon, authenticated;
revoke execute on function public.admin_set_category_zones(uuid, uuid[]) from public, anon, authenticated;

grant execute on function public.admin_product_zones(uuid) to authenticated;
grant execute on function public.admin_set_product_zones(uuid, uuid[]) to authenticated;
grant execute on function public.admin_category_zones(uuid) to authenticated;
grant execute on function public.admin_set_category_zones(uuid, uuid[]) to authenticated;
