-- admin_list_site_pages (20261112090000) fell back to a page's defaults with
-- coalesce(private.site_page_json(p), ...), but for a page that has never been written the
-- left join yields an all-null row and site_page_json() turns it into an object of nulls,
-- not SQL null. The fallback never applied and the admin pages list could not load until
-- every page existed. The default now applies whenever the page row is missing.

create or replace function public.admin_list_site_pages()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('settings.manage');
  return (
    select jsonb_agg(
             case
               when p.slug is null then jsonb_build_object(
                 'slug', s.slug, 'title', private.site_page_default_title(s.slug), 'body', '',
                 'isPublished', false, 'seoTitle', null, 'seoDescription', null, 'updatedAt', null
               )
               else private.site_page_json(p)
             end
             order by s.position)
    from unnest(array['about', 'privacy', 'terms', 'returns', 'shipping', 'faq'])
           with ordinality as s (slug, position)
    left join public.site_pages p on p.slug = s.slug
  );
end;
$$;
