-- ---------------------------------------------------------------------------
-- Slug availability for the admin product, category and brand forms
--
-- Answers from the real rows with the same rules a save applies: the address shape and
-- length of each kind (the tables' check constraints), the storefront paths a brand may
-- never take (private.is_reserved_slug) and old brand addresses kept as redirects
-- (private.brand_slug_available). Reads only; nothing is reserved by asking.
--
-- Additive only: two new functions.
-- ---------------------------------------------------------------------------

/** Whether another item of the kind already holds the address (brands: or redirects from it). */
create function private.slug_taken(p_kind text, p_slug text, p_exclude_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'product' then exists (
      select 1 from public.products p where p.slug = p_slug and p.id is distinct from p_exclude_id
    )
    when 'category' then exists (
      select 1 from public.categories c where c.slug = p_slug and c.id is distinct from p_exclude_id
    )
    when 'brand' then exists (
      select 1 from public.brands b where b.slug = p_slug and b.id is distinct from p_exclude_id
    ) or not private.brand_slug_available(p_slug, p_exclude_id)
    else true
  end;
$$;

revoke execute on function private.slug_taken(text, text, uuid) from public, anon, authenticated;

/**
 * { available, reason: 'taken' | 'reserved' | 'invalid' | null, suggestion } for one
 * address. The suggestion is the first free `<slug>-2` … `<slug>-999` (shortened to fit
 * the kind's length limit) when the address is taken or reserved.
 */
create function public.admin_slug_availability(
  p_kind text,
  p_slug text,
  p_exclude_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_min integer;
  v_max integer;
  v_reason text;
  v_suffix text;
  v_candidate text;
begin
  perform private.require_permission('products.read');
  if p_kind is null or p_kind not in ('product', 'category', 'brand') then
    raise exception 'unknown kind of address' using errcode = 'NZ412';
  end if;

  -- The length limits of products_slug_check, categories_slug_check and brands_slug_check.
  v_min := case p_kind when 'brand' then 2 else 1 end;
  v_max := case p_kind when 'product' then 120 when 'category' then 80 else 60 end;

  if p_slug is null
     or char_length(p_slug) not between v_min and v_max
     or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    return jsonb_build_object('available', false, 'reason', 'invalid', 'suggestion', null);
  end if;

  if p_kind = 'brand' and private.is_reserved_slug(p_slug) then
    v_reason := 'reserved';
  elsif private.slug_taken(p_kind, p_slug, p_exclude_id) then
    v_reason := 'taken';
  else
    return jsonb_build_object('available', true, 'reason', null, 'suggestion', null);
  end if;

  for v_n in 2..999 loop
    v_suffix := '-' || v_n::text;
    v_candidate := rtrim(left(p_slug, v_max - char_length(v_suffix)), '-') || v_suffix;
    if not (p_kind = 'brand' and private.is_reserved_slug(v_candidate))
       and not private.slug_taken(p_kind, v_candidate, p_exclude_id) then
      return jsonb_build_object('available', false, 'reason', v_reason, 'suggestion', v_candidate);
    end if;
  end loop;

  return jsonb_build_object('available', false, 'reason', v_reason, 'suggestion', null);
end;
$$;

revoke execute on function public.admin_slug_availability(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_slug_availability(text, text, uuid) to authenticated;
