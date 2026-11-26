-- Banners whose words are all optional
-- ---------------------------------------
-- A banner used to need a title of 1-80 characters, so an admin could not publish artwork that
-- already carries its own message: something had to be typed, and the storefront then showed it.
-- Now every word on a banner is optional:
--
--   * `title` (the heading) may be empty: '' means "no heading". The column stays NOT NULL so the
--     contracts, the API and both storefronts keep one shape (an empty string, never null).
--   * `image_alt` (new) describes the picture for screen readers. It is never shown.
--   * A banner still needs *something* a screen reader can announce: a heading or a picture
--     description. `admin_save_banner` refuses one with neither (NZ412), so an image-only banner
--     is accessible too.
--
-- `admin_save_banner` gains `p_image_alt`. It defaults to null so existing callers that pass the
-- original eleven arguments keep working; the old eleven-argument function is replaced (same
-- name, same order, one more trailing argument), and the grants are applied to the new one.

alter table public.banners
  add column image_alt text;

alter table public.banners
  add constraint banners_image_alt_check
    check (image_alt is null or (char_length(btrim(image_alt)) between 1 and 160));

alter table public.banners drop constraint banners_title_check;
alter table public.banners
  add constraint banners_title_check
    check (title = btrim(title) and char_length(title) <= 80);

-- The homepage hero never showed a banner's title: it was required only as the artwork's text
-- alternative. Now that a heading is shown when present, existing hero titles move to the picture
-- description, so every existing hero looks exactly as before (picture only, same alt text).
-- Campaign cards and category strips already showed their titles, so they keep them.
update public.banners
set image_alt = left(btrim(title), 160), title = ''
where placement = 'home_hero' and title <> '' and image_alt is null;

drop function public.admin_save_banner(
  uuid, public.banner_placement, uuid, text, text, text, text, integer, boolean, timestamptz, timestamptz
);

create function public.admin_save_banner(
  p_banner_id uuid,
  p_placement public.banner_placement,
  p_category_id uuid,
  p_title text,
  p_subtitle text,
  p_cta_label text,
  p_cta_href text,
  p_sort_order integer,
  p_is_active boolean,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_image_alt text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_id uuid := p_banner_id;
  v_category uuid := case when p_placement = 'category' then p_category_id end;
  v_title text := btrim(coalesce(p_title, ''));
  v_alt text := nullif(btrim(coalesce(p_image_alt, '')), '');
begin
  if p_placement = 'category' and (v_category is null
      or not exists (select 1 from public.categories where id = v_category)) then
    raise exception 'choose a category' using errcode = 'NZ412';
  end if;
  if v_title = '' and v_alt is null then
    raise exception 'add a heading or describe the picture' using errcode = 'NZ412';
  end if;
  if v_id is null then
    insert into public.banners (placement, category_id, title, subtitle, cta_label, cta_href,
      sort_order, is_active, starts_at, ends_at, image_alt, created_by)
    values (p_placement, v_category, v_title, nullif(btrim(coalesce(p_subtitle, '')), ''),
      nullif(btrim(coalesce(p_cta_label, '')), ''), nullif(btrim(coalesce(p_cta_href, '')), ''),
      coalesce(p_sort_order, 0), coalesce(p_is_active, false), p_starts_at, p_ends_at, v_alt,
      v_actor)
    returning id into v_id;
    perform private.audit(v_actor, 'banner.created', 'banner', v_id::text,
      jsonb_build_object('placement', p_placement));
  else
    update public.banners
    set placement = p_placement, category_id = v_category, title = v_title,
        subtitle = nullif(btrim(coalesce(p_subtitle, '')), ''),
        cta_label = nullif(btrim(coalesce(p_cta_label, '')), ''),
        cta_href = nullif(btrim(coalesce(p_cta_href, '')), ''),
        sort_order = coalesce(p_sort_order, 0), is_active = coalesce(p_is_active, false),
        starts_at = p_starts_at, ends_at = p_ends_at, image_alt = v_alt
    where id = v_id;
    if not found then
      raise exception 'banner not found' using errcode = 'NZ404';
    end if;
    perform private.audit(v_actor, 'banner.updated', 'banner', v_id::text,
      jsonb_build_object('placement', p_placement, 'isActive', coalesce(p_is_active, false)));
  end if;
  return v_id;
end;
$$;

revoke execute on function public.admin_save_banner(
  uuid, public.banner_placement, uuid, text, text, text, text, integer, boolean, timestamptz,
  timestamptz, text
) from public, anon;
grant execute on function public.admin_save_banner(
  uuid, public.banner_placement, uuid, text, text, text, text, integer, boolean, timestamptz,
  timestamptz, text
) to authenticated;
