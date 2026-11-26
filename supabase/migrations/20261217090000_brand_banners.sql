-- Brand banners: wide artwork shown inside storefront brand cards, separate from the logo mark.
alter table public.brands
  add column if not exists banner_key text
    check (banner_key is null or banner_key ~ '^brands/[0-9a-f-]{36}/[0-9a-f-]{36}$');

comment on column public.brands.banner_key is
  'R2 object key of the brand card banner (3:2 artwork). Null falls back to the logo.';

/** Sets or clears a brand banner and returns the previous key so the caller can delete that object. */
create function public.admin_set_brand_banner(p_brand_id uuid, p_banner_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.publish');
  v_old text;
begin
  if p_banner_key is not null and p_banner_key !~ ('^brands/' || p_brand_id::text || '/[0-9a-f-]{36}$') then
    raise exception 'invalid banner key' using errcode = 'NZ412';
  end if;
  select banner_key into v_old from public.brands where id = p_brand_id for update;
  if not found then
    raise exception 'brand not found' using errcode = 'NZ404';
  end if;
  update public.brands set banner_key = p_banner_key where id = p_brand_id;
  perform private.audit(v_actor, case when p_banner_key is null then 'brand.banner_removed' else 'brand.banner_set' end,
    'brand', p_brand_id::text, '{}'::jsonb);
  return v_old;
end;
$$;

revoke execute on function public.admin_set_brand_banner(uuid, text) from public, anon;
grant execute on function public.admin_set_brand_banner(uuid, text) to authenticated;
