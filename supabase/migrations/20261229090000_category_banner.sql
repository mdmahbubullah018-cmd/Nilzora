-- Category banners: wide artwork shown at the top of a category's page in the apps, separate from the
-- square cover (`image_key`) used on category cards. Additive only: existing categories keep a null
-- banner and look exactly as before; nothing is rewritten or deleted.

alter table public.categories
  add column if not exists banner_key text
    check (banner_key is null or banner_key ~ '^categories/[0-9a-f-]{36}/[0-9a-f-]{36}$');

comment on column public.categories.banner_key is
  'R2 object key of the category page banner (wide artwork). Null shows the cover or the brand fallback.';

/** Sets or clears a category banner and returns the previous key so the caller can delete that object. */
create function public.admin_set_category_banner(p_category_id uuid, p_banner_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.publish');
  v_old text;
begin
  if p_banner_key is not null
     and p_banner_key !~ ('^categories/' || p_category_id::text || '/[0-9a-f-]{36}$') then
    raise exception 'invalid category banner key' using errcode = 'NZ422';
  end if;

  select banner_key into v_old from public.categories where id = p_category_id for update;
  if not found then
    raise exception 'category not found' using errcode = 'NZ404';
  end if;

  update public.categories set banner_key = p_banner_key where id = p_category_id;

  perform private.audit(v_actor,
    case when p_banner_key is null then 'category.banner_removed' else 'category.banner_set' end,
    'category', p_category_id::text, '{}'::jsonb);
  return v_old;
end;
$$;

revoke execute on function public.admin_set_category_banner(uuid, text) from public, anon;
grant execute on function public.admin_set_category_banner(uuid, text) to authenticated, service_role;
