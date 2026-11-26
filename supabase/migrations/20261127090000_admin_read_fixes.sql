-- ---------------------------------------------------------------------------
-- Admin read fixes (additive: function replacements only, same signatures and grants)
--
-- admin_seo_overview (20261106090000) declared fifteen output columns but selected eleven
-- (the Open Graph and canonical fields were missing) and ordered by a column position that
-- did not exist, so every call failed (42P10) and the SEO page could never load.
-- ---------------------------------------------------------------------------

create or replace function public.admin_seo_overview(p_query text default null)
returns table (
  kind text,
  id uuid,
  slug text,
  name text,
  is_public boolean,
  seo_title text,
  seo_description text,
  og_title text,
  og_description text,
  og_image_key text,
  canonical_path text,
  no_index boolean,
  missing_title boolean,
  missing_description boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
begin
  perform private.require_permission('products.read');

  return query
  select * from (
    select 'product'::text, pr.id, pr.slug, pr.name,
           (pr.status = 'active' and pr.moderation_status = 'approved'),
           pr.seo_title, pr.seo_description, pr.og_title, pr.og_description, pr.og_image_key,
           pr.canonical_path, pr.no_index,
           (pr.seo_title is null), (pr.seo_description is null), pr.updated_at
    from public.products pr
    where v_query is null or pr.name ilike '%' || v_query || '%' or pr.slug ilike '%' || v_query || '%'
    union all
    select 'category'::text, c.id, c.slug, c.name, c.is_active,
           c.seo_title, c.seo_description, c.og_title, c.og_description, c.og_image_key,
           c.canonical_path, c.no_index,
           (c.seo_title is null), (c.seo_description is null), c.updated_at
    from public.categories c
    where v_query is null or c.name ilike '%' || v_query || '%' or c.slug ilike '%' || v_query || '%'
  ) as rows_found
  order by 15 desc;
end;
$$;
