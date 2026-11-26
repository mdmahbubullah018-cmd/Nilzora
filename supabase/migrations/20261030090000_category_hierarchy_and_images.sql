-- Category hierarchy, cover images and featured flag.
--
-- Additive only: every existing category keeps working as a top-level category with no
-- image. `admin_save_category` is deliberately left untouched - its security properties,
-- ownership and grants stay exactly as they are. Placement (parent + featured) and the
-- cover image get their own SECURITY DEFINER functions so the audited field-writer never
-- has to change shape.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.categories
  add column parent_id uuid references public.categories (id) on delete restrict,
  -- Base key of the cover image's WebP variants in media storage (never a full URL).
  add column image_key text
    check (image_key is null or image_key ~ '^categories/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  add column is_featured boolean not null default false;

comment on column public.categories.parent_id is
  'Parent category. Null for a top-level department. Three levels maximum.';
comment on column public.categories.image_key is
  'Base key of the cover image''s WebP variants in media storage.';

create index categories_parent_order_idx on public.categories (parent_id, sort_order, name);
create index categories_featured_idx on public.categories (sort_order, name)
  where is_featured and is_active;

-- ---------------------------------------------------------------------------
-- Hierarchy guard: no cycles, at most three levels, parent must exist.
-- ---------------------------------------------------------------------------

create function private.categories_guard_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_depth integer := 1;
  v_cursor uuid := new.parent_id;
  v_seen uuid[] := array[new.id];
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'a category cannot be its own parent' using errcode = 'NZ422';
  end if;

  while v_cursor is not null loop
    if v_cursor = any (v_seen) then
      raise exception 'a category cannot be moved under its own child' using errcode = 'NZ422';
    end if;
    v_seen := v_seen || v_cursor;
    v_depth := v_depth + 1;
    if v_depth > 3 then
      raise exception 'categories support at most three levels' using errcode = 'NZ422';
    end if;
    select c.parent_id into v_cursor from public.categories c where c.id = v_cursor;
    if not found then
      raise exception 'parent category not found' using errcode = 'NZ404';
    end if;
  end loop;

  return new;
end;
$$;

comment on function private.categories_guard_hierarchy() is
  'Rejects self-parenting, cycles and hierarchies deeper than three levels.';

revoke execute on function private.categories_guard_hierarchy() from public, anon, authenticated;

create trigger categories_guard_hierarchy
  before insert or update of parent_id on public.categories
  for each row execute function private.categories_guard_hierarchy();

-- ---------------------------------------------------------------------------
-- Placement: parent and featured flag. Same permission as admin_save_category.
-- ---------------------------------------------------------------------------

create function public.admin_save_category_placement(
  p_category_id uuid,
  p_parent_id uuid,
  p_is_featured boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.publish');
  v_previous uuid;
begin
  select c.parent_id into v_previous from public.categories c where c.id = p_category_id for update;
  if not found then
    raise exception 'category not found' using errcode = 'NZ404';
  end if;

  update public.categories
  set parent_id = p_parent_id,
      is_featured = coalesce(p_is_featured, false)
  where id = p_category_id;

  perform private.audit(v_actor, 'category.placement_changed', 'category', p_category_id::text,
    jsonb_build_object('parentId', p_parent_id, 'previousParentId', v_previous,
      'isFeatured', coalesce(p_is_featured, false)));
  return p_category_id;
end;
$$;

comment on function public.admin_save_category_placement(uuid, uuid, boolean) is
  'Moves a category in the tree and sets its featured flag. Audited.';

-- ---------------------------------------------------------------------------
-- Cover image. The key is derived from the category id, never chosen by a client.
-- ---------------------------------------------------------------------------

create function public.admin_set_category_image(p_category_id uuid, p_image_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.publish');
begin
  if p_image_key is null or p_image_key !~ ('^categories/' || p_category_id::text || '/[0-9a-f-]{36}$') then
    raise exception 'invalid category image key' using errcode = 'NZ422';
  end if;

  update public.categories set image_key = p_image_key where id = p_category_id;
  if not found then
    raise exception 'category not found' using errcode = 'NZ404';
  end if;

  perform private.audit(v_actor, 'category.image_changed', 'category', p_category_id::text,
    jsonb_build_object('imageKey', p_image_key));
end;
$$;

create function public.admin_clear_category_image(p_category_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.publish');
  v_previous text;
begin
  update public.categories set image_key = null where id = p_category_id
  returning image_key into v_previous;
  if not found then
    raise exception 'category not found' using errcode = 'NZ404';
  end if;

  perform private.audit(v_actor, 'category.image_cleared', 'category', p_category_id::text,
    jsonb_build_object('imageKey', v_previous));
  return v_previous;
end;
$$;

-- ---------------------------------------------------------------------------
-- Safe deletion. Never cascades into products or child categories.
-- ---------------------------------------------------------------------------

create function public.admin_delete_category(p_category_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.publish');
  v_products integer;
  v_children integer;
  v_slug text;
begin
  select c.slug into v_slug from public.categories c where c.id = p_category_id for update;
  if not found then
    raise exception 'category not found' using errcode = 'NZ404';
  end if;

  select count(*) into v_products from public.products p where p.category_id = p_category_id;
  if v_products > 0 then
    raise exception 'move the % product(s) in this category first', v_products using errcode = 'NZ409';
  end if;

  select count(*) into v_children from public.categories c where c.parent_id = p_category_id;
  if v_children > 0 then
    raise exception 'move the % subcategory(ies) first', v_children using errcode = 'NZ409';
  end if;

  delete from public.categories where id = p_category_id;

  perform private.audit(v_actor, 'category.deleted', 'category', p_category_id::text,
    jsonb_build_object('slug', v_slug));
end;
$$;

-- ---------------------------------------------------------------------------
-- Public read: the whole active tree in storefront order.
-- A new function, so catalog_categories() keeps its existing contract.
-- ---------------------------------------------------------------------------

create function public.catalog_category_tree()
returns table (
  slug text,
  name text,
  description text,
  parent_slug text,
  depth integer,
  image_key text,
  is_featured boolean,
  sort_order integer,
  product_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive tree as (
    select c.id, c.slug, c.name, c.description, c.parent_id, c.image_key,
           c.is_featured, c.sort_order, 1 as depth, c.sort_order::text as path
    from public.categories c
    where c.parent_id is null and c.is_active
    union all
    select c.id, c.slug, c.name, c.description, c.parent_id, c.image_key,
           c.is_featured, c.sort_order, t.depth + 1, t.path || '/' || lpad(c.sort_order::text, 10, '0')
    from public.categories c
    join tree t on c.parent_id = t.id
    where c.is_active
  )
  select t.slug, t.name, t.description, parent.slug as parent_slug, t.depth,
         t.image_key, t.is_featured, t.sort_order,
         (select count(*) from public.products p
          where p.category_id = t.id and p.status = 'active') as product_count
  from tree t
  left join public.categories parent on parent.id = t.parent_id
  order by t.path;
$$;

comment on function public.catalog_category_tree() is
  'Active category tree with parent slug and depth, for storefront navigation.';

revoke execute on function public.catalog_category_tree() from public;
grant execute on function public.catalog_category_tree() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Grants for the new writer functions. Same shape as admin_save_category.
-- ---------------------------------------------------------------------------

revoke execute on function public.admin_save_category_placement(uuid, uuid, boolean) from public, anon;
revoke execute on function public.admin_set_category_image(uuid, text) from public, anon;
revoke execute on function public.admin_clear_category_image(uuid) from public, anon;
revoke execute on function public.admin_delete_category(uuid) from public, anon;

grant execute on function public.admin_save_category_placement(uuid, uuid, boolean) to authenticated, service_role;
grant execute on function public.admin_set_category_image(uuid, text) to authenticated, service_role;
grant execute on function public.admin_clear_category_image(uuid) to authenticated, service_role;
grant execute on function public.admin_delete_category(uuid) to authenticated, service_role;
