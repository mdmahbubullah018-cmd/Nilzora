-- Reordering the categories of one group (a parent's subcategories, or the top level).
--
-- Additive only. A reorder is one atomic change: the caller names the whole group in the order
-- it should appear, the group is locked while it is rewritten, and every member gets a new
-- sort_order in steps of 10 (so a later single insert still has room between two neighbours).
-- Nothing else about a category changes, and nothing is created or deleted.
--
-- Same permission as every other category writer (products.publish), audited the same way.

create function public.admin_reorder_categories(p_parent_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.publish');
  v_members integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 500 then
    raise exception 'name the categories of one group, in order' using errcode = 'NZ422';
  end if;
  if (select count(distinct u) from unnest(p_ids) as u) <> cardinality(p_ids) then
    raise exception 'a category can appear only once' using errcode = 'NZ422';
  end if;

  -- Hold the group still while it is rewritten, so two admins cannot interleave.
  perform 1
    from public.categories c
   where c.parent_id is not distinct from p_parent_id
   for update;

  select count(*) into v_members
    from public.categories c
   where c.parent_id is not distinct from p_parent_id;

  -- Exactly the group, nothing more and nothing less: a stale list is refused, not guessed at.
  if v_members <> cardinality(p_ids)
     or exists (
       select 1
         from unnest(p_ids) as u
        where not exists (
          select 1 from public.categories c
           where c.id = u and c.parent_id is not distinct from p_parent_id
        )
     )
  then
    raise exception 'the list must be exactly the categories of this group' using errcode = 'NZ422';
  end if;

  update public.categories c
     set sort_order = (t.position - 1) * 10
    from unnest(p_ids) with ordinality as t(id, position)
   where c.id = t.id;

  perform private.audit(v_actor, 'category.reordered', 'category',
    coalesce(p_parent_id::text, 'top-level'),
    jsonb_build_object('parentId', p_parent_id, 'count', cardinality(p_ids)));
end;
$$;

comment on function public.admin_reorder_categories(uuid, uuid[]) is
  'Rewrites the sort order of one group of categories (a parent''s children, or the top level) atomically. Audited.';

revoke execute on function public.admin_reorder_categories(uuid, uuid[]) from public, anon;
grant execute on function public.admin_reorder_categories(uuid, uuid[]) to authenticated, service_role;
