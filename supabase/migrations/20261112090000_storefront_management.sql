-- ---------------------------------------------------------------------------
-- Storefront and app management
--
--   1. Store profile: WhatsApp number, Google Play and App Store links, TikTok and X
--      profiles. A new overload of admin_save_store_profile takes them in p_extras
--      (a key present sets it, null clears it, a key left out keeps it); the original
--      signature keeps working and leaves them unchanged.
--   2. Static pages (about, privacy, terms, returns, shipping, faq): plain text bodies,
--      published or not, with their own SEO title and description.
--   3. Navigation menus (header, footer shop, footer help): store paths (the banner link
--      rule) or https links, ordered, switchable.
--   4. Homepage sections: which sections show, in what order, with what title and how
--      many items; seeded with today's home page.
--   5. Banners: an optional image for small screens, and ordering within a placement.
--
-- Every change needs settings.manage and is audited. The new tables have Row Level
-- Security and no policies; visitors read them only through the public_* functions,
-- which answer published or active content only.
--
-- SQLSTATEs: NZ403 missing permission, NZ404 not found, NZ412 invalid input,
--            NZ495 store profile invalid.
-- Additive only: new columns, tables and functions; changed functions keep their
-- signatures and behaviour.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Store profile extensions
-- ---------------------------------------------------------------------------

alter table public.store_profile
  add column whatsapp_number text
    check (whatsapp_number is null or whatsapp_number ~ '^\+8801[3-9][0-9]{8}$'),
  add column play_store_url text
    check (play_store_url is null or (char_length(play_store_url) <= 300
           and play_store_url ~ '^https://play\.google\.com/[A-Za-z0-9/?=&._%~-]*$')),
  add column app_store_url text
    check (app_store_url is null or (char_length(app_store_url) <= 300
           and app_store_url ~ '^https://apps\.apple\.com/[A-Za-z0-9/?=&._%~-]*$')),
  add column social_tiktok text
    check (social_tiktok is null or social_tiktok ~ '^https://(www\.)?tiktok\.com/@[A-Za-z0-9._]{1,40}$'),
  add column social_x text
    check (social_x is null or social_x ~ '^https://(www\.)?(x|twitter)\.com/[A-Za-z0-9_]{1,30}$');

create or replace function public.public_store_profile()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'displayName', p.display_name,
    'tagline', p.tagline,
    'description', p.description,
    'logoKey', p.logo_key,
    'contactEmail', p.contact_email,
    'contactPhone', p.contact_phone,
    'addressLine', p.address_line,
    'addressArea', p.address_area,
    'addressDistrict', p.address_district,
    'businessHours', p.business_hours,
    'supportEmail', p.support_email,
    'supportPhone', p.support_phone,
    'social', jsonb_strip_nulls(jsonb_build_object(
      'facebook', p.social_facebook,
      'instagram', p.social_instagram,
      'youtube', p.social_youtube,
      'tiktok', p.social_tiktok,
      'x', p.social_x
    )),
    'defaultSeoTitle', p.default_seo_title,
    'defaultSeoDescription', p.default_seo_description,
    'ogImageKey', p.og_image_key,
    'whatsappNumber', p.whatsapp_number,
    'playStoreUrl', p.play_store_url,
    'appStoreUrl', p.app_store_url,
    'updatedAt', p.updated_at
  )
  from public.store_profile p
  where p.id;
$$;

/** One optional profile text from p_extras: trimmed, empty is null; NZ495 when the shape is wrong. */
create function private.profile_extra(p_extras jsonb, p_key text, p_pattern text, p_current text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value text;
begin
  if not (p_extras ? p_key) then
    return p_current;
  end if;
  if jsonb_typeof(p_extras -> p_key) not in ('string', 'null') then
    raise exception '% must be text', p_key using errcode = 'NZ495';
  end if;
  v_value := nullif(btrim(coalesce(p_extras ->> p_key, '')), '');
  if v_value is not null and (char_length(v_value) > 300 or v_value !~ p_pattern) then
    raise exception '% is not valid', p_key using errcode = 'NZ495';
  end if;
  return v_value;
end;
$$;

/**
 * Saves the whole profile, plus the extras present in p_extras (whatsappNumber,
 * playStoreUrl, appStoreUrl, socialTiktok, socialX). p_extras is the second parameter and
 * has no default, so a call without it always reaches the original signature.
 */
create function public.admin_save_store_profile(
  p_display_name text,
  p_extras jsonb,
  p_tagline text default null,
  p_description text default null,
  p_logo_key text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_address_line text default null,
  p_address_area text default null,
  p_address_district text default null,
  p_business_hours text default null,
  p_support_email text default null,
  p_support_phone text default null,
  p_social_facebook text default null,
  p_social_instagram text default null,
  p_social_youtube text default null,
  p_default_seo_title text default null,
  p_default_seo_description text default null,
  p_og_image_key text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_extras jsonb := coalesce(p_extras, '{}'::jsonb);
  v_current public.store_profile;
begin
  if p_display_name is null or btrim(p_display_name) = '' then
    raise exception 'the store needs a name' using errcode = 'NZ495';
  end if;
  if jsonb_typeof(v_extras) <> 'object'
     or exists (select 1 from jsonb_object_keys(v_extras) k
                where k not in ('whatsappNumber', 'playStoreUrl', 'appStoreUrl', 'socialTiktok', 'socialX')) then
    raise exception 'unknown profile field' using errcode = 'NZ495';
  end if;
  select * into v_current from public.store_profile where id for update;

  update public.store_profile set
    display_name = btrim(p_display_name),
    tagline = nullif(btrim(coalesce(p_tagline, '')), ''),
    description = nullif(btrim(coalesce(p_description, '')), ''),
    logo_key = nullif(btrim(coalesce(p_logo_key, '')), ''),
    contact_email = nullif(btrim(coalesce(p_contact_email, '')), ''),
    contact_phone = nullif(btrim(coalesce(p_contact_phone, '')), ''),
    address_line = nullif(btrim(coalesce(p_address_line, '')), ''),
    address_area = nullif(btrim(coalesce(p_address_area, '')), ''),
    address_district = nullif(btrim(coalesce(p_address_district, '')), ''),
    business_hours = nullif(btrim(coalesce(p_business_hours, '')), ''),
    support_email = nullif(btrim(coalesce(p_support_email, '')), ''),
    support_phone = nullif(btrim(coalesce(p_support_phone, '')), ''),
    social_facebook = nullif(btrim(coalesce(p_social_facebook, '')), ''),
    social_instagram = nullif(btrim(coalesce(p_social_instagram, '')), ''),
    social_youtube = nullif(btrim(coalesce(p_social_youtube, '')), ''),
    default_seo_title = nullif(btrim(coalesce(p_default_seo_title, '')), ''),
    default_seo_description = nullif(btrim(coalesce(p_default_seo_description, '')), ''),
    og_image_key = nullif(btrim(coalesce(p_og_image_key, '')), ''),
    whatsapp_number = private.profile_extra(v_extras, 'whatsappNumber', '^\+8801[3-9][0-9]{8}$', v_current.whatsapp_number),
    play_store_url = private.profile_extra(v_extras, 'playStoreUrl', '^https://play\.google\.com/[A-Za-z0-9/?=&._%~-]*$', v_current.play_store_url),
    app_store_url = private.profile_extra(v_extras, 'appStoreUrl', '^https://apps\.apple\.com/[A-Za-z0-9/?=&._%~-]*$', v_current.app_store_url),
    social_tiktok = private.profile_extra(v_extras, 'socialTiktok', '^https://(www\.)?tiktok\.com/@[A-Za-z0-9._]{1,40}$', v_current.social_tiktok),
    social_x = private.profile_extra(v_extras, 'socialX', '^https://(www\.)?(x|twitter)\.com/[A-Za-z0-9_]{1,30}$', v_current.social_x),
    updated_at = now(),
    updated_by = v_actor
  where id;

  perform private.audit(v_actor, 'store_profile.save', 'store_profile', 'default');
end;
$$;

/** The original signature: saves the same fields and keeps the extras as they are. */
create or replace function public.admin_save_store_profile(
  p_display_name text,
  p_tagline text default null,
  p_description text default null,
  p_logo_key text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_address_line text default null,
  p_address_area text default null,
  p_address_district text default null,
  p_business_hours text default null,
  p_support_email text default null,
  p_support_phone text default null,
  p_social_facebook text default null,
  p_social_instagram text default null,
  p_social_youtube text default null,
  p_default_seo_title text default null,
  p_default_seo_description text default null,
  p_og_image_key text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  select public.admin_save_store_profile(
    p_display_name => p_display_name,
    p_extras => '{}'::jsonb,
    p_tagline => p_tagline,
    p_description => p_description,
    p_logo_key => p_logo_key,
    p_contact_email => p_contact_email,
    p_contact_phone => p_contact_phone,
    p_address_line => p_address_line,
    p_address_area => p_address_area,
    p_address_district => p_address_district,
    p_business_hours => p_business_hours,
    p_support_email => p_support_email,
    p_support_phone => p_support_phone,
    p_social_facebook => p_social_facebook,
    p_social_instagram => p_social_instagram,
    p_social_youtube => p_social_youtube,
    p_default_seo_title => p_default_seo_title,
    p_default_seo_description => p_default_seo_description,
    p_og_image_key => p_og_image_key
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Static pages
-- ---------------------------------------------------------------------------

create table public.site_pages (
  slug text primary key check (slug in ('about', 'privacy', 'terms', 'returns', 'shipping', 'faq')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  /** Plain text: blank lines separate paragraphs; "# ", "## " and "- " start headings and list items. */
  body text not null default '' check (
    char_length(body) <= 20000
    and body !~ E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]'
  ),
  is_published boolean not null default false,
  seo_title text check (seo_title is null or char_length(btrim(seo_title)) between 1 and 70),
  seo_description text check (seo_description is null or char_length(btrim(seo_description)) between 1 and 200),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

comment on table public.site_pages is
  'Static storefront pages. Read through public_site_page (published only); written through admin_save_site_page.';

alter table public.site_pages enable row level security;
revoke all on table public.site_pages from public, anon, authenticated;

/** The title a page has before the store writes one. */
create function private.site_page_default_title(p_slug text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_slug
    when 'about' then 'About us'
    when 'privacy' then 'Privacy policy'
    when 'terms' then 'Terms of service'
    when 'returns' then 'Returns and refunds'
    when 'shipping' then 'Delivery information'
    when 'faq' then 'Frequently asked questions'
  end;
$$;

create function private.site_page_json(p_page public.site_pages)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'slug', p_page.slug,
    'title', p_page.title,
    'body', p_page.body,
    'isPublished', p_page.is_published,
    'seoTitle', p_page.seo_title,
    'seoDescription', p_page.seo_description,
    'updatedAt', p_page.updated_at
  );
$$;

/** A published page, or null (unknown, unwritten or unpublished). */
create function public.public_site_page(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'slug', p.slug, 'title', p.title, 'body', p.body,
    'seoTitle', p.seo_title, 'seoDescription', p.seo_description, 'updatedAt', p.updated_at
  )
  from public.site_pages p
  where p.slug = p_slug and p.is_published;
$$;

/** Every known page for staff, written or not (an unwritten one is an unpublished draft). */
create function public.admin_list_site_pages()
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
             coalesce(private.site_page_json(p), jsonb_build_object(
               'slug', s.slug, 'title', private.site_page_default_title(s.slug), 'body', '',
               'isPublished', false, 'seoTitle', null, 'seoDescription', null, 'updatedAt', null
             )) order by s.position)
    from unnest(array['about', 'privacy', 'terms', 'returns', 'shipping', 'faq'])
           with ordinality as s (slug, position)
    left join public.site_pages p on p.slug = s.slug
  );
end;
$$;

create function public.admin_save_site_page(
  p_slug text,
  p_title text,
  p_body text,
  p_is_published boolean,
  p_seo_title text default null,
  p_seo_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_page public.site_pages;
begin
  if private.site_page_default_title(p_slug) is null then
    raise exception 'unknown page' using errcode = 'NZ404';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 120
     or char_length(coalesce(p_body, '')) > 20000
     or coalesce(p_body, '') ~ E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]'
     or (p_seo_title is not null and char_length(btrim(p_seo_title)) > 70)
     or (p_seo_description is not null and char_length(btrim(p_seo_description)) > 200) then
    raise exception 'invalid page' using errcode = 'NZ412';
  end if;
  if coalesce(p_is_published, false) and btrim(coalesce(p_body, '')) = '' then
    raise exception 'a published page needs text' using errcode = 'NZ412';
  end if;

  insert into public.site_pages (slug, title, body, is_published, seo_title, seo_description, updated_by)
  values (p_slug, btrim(p_title), coalesce(p_body, ''), coalesce(p_is_published, false),
          nullif(btrim(coalesce(p_seo_title, '')), ''), nullif(btrim(coalesce(p_seo_description, '')), ''), v_actor)
  on conflict (slug) do update set
    title = excluded.title, body = excluded.body, is_published = excluded.is_published,
    seo_title = excluded.seo_title, seo_description = excluded.seo_description,
    updated_at = now(), updated_by = v_actor
  returning * into v_page;

  perform private.audit(v_actor, 'site_page.saved', 'site_page', p_slug,
    jsonb_build_object('published', v_page.is_published));
  return private.site_page_json(v_page);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Navigation menus
-- ---------------------------------------------------------------------------

create table public.site_menu_items (
  id uuid primary key default gen_random_uuid(),
  menu text not null check (menu in ('header', 'footer_shop', 'footer_help')),
  label text not null check (char_length(btrim(label)) between 1 and 40),
  /** A path inside the store (the banner link rule) or an https address. */
  href text not null check (
    char_length(href) <= 300
    and ((href ~ '^/[A-Za-z0-9/_?=&%.~-]*$' and href !~ '^//')
         or href ~ '^https://[A-Za-z0-9.-]+(/[A-Za-z0-9/_?=&%.~#-]*)?$')
  ),
  sort_order integer not null default 0 check (sort_order between 0 and 1000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

create index site_menu_items_menu_idx on public.site_menu_items (menu, sort_order, created_at);

alter table public.site_menu_items enable row level security;
revoke all on table public.site_menu_items from public, anon, authenticated;

create function private.menu_item_json(p_item public.site_menu_items)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_item.id, 'menu', p_item.menu, 'label', p_item.label, 'href', p_item.href,
    'sortOrder', p_item.sort_order, 'isActive', p_item.is_active, 'updatedAt', p_item.updated_at
  );
$$;

/** What a visitor's navigation shows: active links per menu and the published pages. */
create function public.public_navigation()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'menus', jsonb_build_object(
      'header', coalesce((select jsonb_agg(jsonb_build_object('label', m.label, 'href', m.href)
                                  order by m.sort_order, m.created_at)
                          from public.site_menu_items m where m.menu = 'header' and m.is_active), '[]'::jsonb),
      'footerShop', coalesce((select jsonb_agg(jsonb_build_object('label', m.label, 'href', m.href)
                                      order by m.sort_order, m.created_at)
                              from public.site_menu_items m where m.menu = 'footer_shop' and m.is_active), '[]'::jsonb),
      'footerHelp', coalesce((select jsonb_agg(jsonb_build_object('label', m.label, 'href', m.href)
                                      order by m.sort_order, m.created_at)
                              from public.site_menu_items m where m.menu = 'footer_help' and m.is_active), '[]'::jsonb)
    ),
    'pages', coalesce((select jsonb_agg(jsonb_build_object('slug', p.slug, 'title', p.title)
                               order by array_position(array['about', 'privacy', 'terms', 'returns', 'shipping', 'faq'], p.slug))
                       from public.site_pages p where p.is_published), '[]'::jsonb)
  );
$$;

create function public.admin_list_menu_items()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('settings.manage');
  return coalesce((
    select jsonb_agg(private.menu_item_json(m) order by m.menu, m.sort_order, m.created_at)
    from public.site_menu_items m
  ), '[]'::jsonb);
end;
$$;

/** Creates (p_id null, appended last) or changes one link. A menu holds at most 12. */
create function public.admin_save_menu_item(
  p_id uuid,
  p_menu text,
  p_label text,
  p_href text,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_item public.site_menu_items;
begin
  if p_menu is null or p_menu not in ('header', 'footer_shop', 'footer_help')
     or p_label is null or char_length(btrim(p_label)) not between 1 and 40
     or p_href is null or char_length(p_href) > 300
     or not ((p_href ~ '^/[A-Za-z0-9/_?=&%.~-]*$' and p_href !~ '^//')
             or p_href ~ '^https://[A-Za-z0-9.-]+(/[A-Za-z0-9/_?=&%.~#-]*)?$') then
    raise exception 'invalid link' using errcode = 'NZ412';
  end if;

  if p_id is null then
    if (select count(*) from public.site_menu_items where menu = p_menu) >= 12 then
      raise exception 'a menu holds at most 12 links' using errcode = 'NZ412';
    end if;
    insert into public.site_menu_items (menu, label, href, sort_order, is_active, updated_by)
    values (p_menu, btrim(p_label), p_href,
            coalesce((select max(sort_order) + 1 from public.site_menu_items where menu = p_menu), 0),
            coalesce(p_is_active, true), v_actor)
    returning * into v_item;
  else
    update public.site_menu_items
    set label = btrim(p_label), href = p_href, is_active = coalesce(p_is_active, true),
        updated_at = now(), updated_by = v_actor
    where id = p_id and menu = p_menu
    returning * into v_item;
    if not found then
      raise exception 'link not found' using errcode = 'NZ404';
    end if;
  end if;

  perform private.audit(v_actor, 'menu_item.saved', 'menu_item', v_item.id::text,
    jsonb_build_object('menu', v_item.menu));
  return private.menu_item_json(v_item);
end;
$$;

create function public.admin_delete_menu_item(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_menu text;
begin
  delete from public.site_menu_items where id = p_id returning menu into v_menu;
  if not found then
    raise exception 'link not found' using errcode = 'NZ404';
  end if;
  perform private.audit(v_actor, 'menu_item.deleted', 'menu_item', p_id::text,
    jsonb_build_object('menu', v_menu));
end;
$$;

/** Orders one menu: p_ids must list each of its links exactly once. */
create function public.admin_reorder_menu(p_menu text, p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
begin
  if p_menu is null or p_menu not in ('header', 'footer_shop', 'footer_help') or p_ids is null
     or cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
     or (select array_agg(id order by id) from public.site_menu_items where menu = p_menu)
        is distinct from (select array_agg(x order by x) from unnest(p_ids) x) then
    raise exception 'list every link of the menu exactly once' using errcode = 'NZ412';
  end if;
  update public.site_menu_items m
  set sort_order = o.position - 1, updated_at = now(), updated_by = v_actor
  from unnest(p_ids) with ordinality as o (id, position)
  where m.id = o.id;
  perform private.audit(v_actor, 'menu.reordered', 'menu', p_menu, '{}'::jsonb);
  return public.admin_list_menu_items();
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Homepage sections
-- ---------------------------------------------------------------------------

create table public.homepage_sections (
  key text primary key
    check (key in ('hero', 'categories', 'featured', 'new_arrivals', 'brands', 'promotions', 'services')),
  is_enabled boolean not null default true,
  sort_order integer not null check (sort_order between 0 and 100),
  /** Replaces the section's own heading (sections with a heading only). */
  title text check (title is null or char_length(btrim(title)) between 1 and 60),
  item_limit integer check (item_limit is null or item_limit between 1 and 24),
  /** featured and new_arrivals may narrow to one category and/or brand by slug. */
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

-- Today's home page: hero, the service strip, categories, new arrivals, featured
-- products, promotions, then brands.
insert into public.homepage_sections (key, sort_order) values
  ('hero', 0), ('services', 1), ('categories', 2), ('new_arrivals', 3),
  ('featured', 4), ('promotions', 5), ('brands', 6);

alter table public.homepage_sections enable row level security;
revoke all on table public.homepage_sections from public, anon, authenticated;

create function private.homepage_section_json(p_section public.homepage_sections)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'key', p_section.key, 'isEnabled', p_section.is_enabled, 'sortOrder', p_section.sort_order,
    'title', p_section.title, 'itemLimit', p_section.item_limit, 'config', p_section.config,
    'updatedAt', p_section.updated_at
  );
$$;

/** The enabled sections in order (empty when none are set up: the storefront falls back). */
create function public.public_homepage()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('sections', coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', s.key, 'title', s.title, 'itemLimit', s.item_limit, 'config', s.config
           ) order by s.sort_order, s.key)
    from public.homepage_sections s where s.is_enabled
  ), '[]'::jsonb));
$$;

create function public.admin_homepage()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('settings.manage');
  return coalesce((
    select jsonb_agg(private.homepage_section_json(s) order by s.sort_order, s.key)
    from public.homepage_sections s
  ), '[]'::jsonb);
end;
$$;

/**
 * Saves every section at once, in the given order: an array with each key exactly once,
 * each { key, isEnabled, title, itemLimit, config }.
 */
create function public.admin_save_homepage(p_sections jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_section jsonb;
  v_position integer;
  v_key text;
  v_config jsonb;
  v_keys text[] := array['hero', 'categories', 'featured', 'new_arrivals', 'brands', 'promotions', 'services'];
begin
  if p_sections is null or jsonb_typeof(p_sections) <> 'array'
     or jsonb_array_length(p_sections) <> cardinality(v_keys)
     or (select array_agg(e ->> 'key' order by e ->> 'key') from jsonb_array_elements(p_sections) e)
        is distinct from (select array_agg(k order by k) from unnest(v_keys) k) then
    raise exception 'list every homepage section exactly once' using errcode = 'NZ412';
  end if;

  for v_section, v_position in
    select e.value, e.ordinality from jsonb_array_elements(p_sections) with ordinality as e
  loop
    v_key := v_section ->> 'key';
    v_config := coalesce(v_section -> 'config', '{}'::jsonb);
    if jsonb_typeof(v_section -> 'isEnabled') <> 'boolean'
       or (v_section ? 'title' and jsonb_typeof(v_section -> 'title') not in ('string', 'null'))
       or (v_section ->> 'title' is not null and char_length(btrim(v_section ->> 'title')) not between 1 and 60)
       or (v_section ? 'itemLimit' and jsonb_typeof(v_section -> 'itemLimit') not in ('number', 'null'))
       or (v_section ->> 'itemLimit' is not null
           and ((v_section ->> 'itemLimit') !~ '^\d+$' or (v_section ->> 'itemLimit')::integer not between 1 and 24))
       or jsonb_typeof(v_config) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_config) k where k not in ('categorySlug', 'brandSlug'))
       or (v_config <> '{}'::jsonb and v_key not in ('featured', 'new_arrivals'))
       or (v_config ? 'categorySlug' and (v_config ->> 'categorySlug') !~ '^[a-z0-9]+(-[a-z0-9]+)*$')
       or (v_config ? 'brandSlug' and (v_config ->> 'brandSlug') !~ '^[a-z0-9]+(-[a-z0-9]+)*$') then
      raise exception 'invalid section %', v_key using errcode = 'NZ412';
    end if;

    update public.homepage_sections set
      is_enabled = (v_section ->> 'isEnabled')::boolean,
      sort_order = v_position - 1,
      title = nullif(btrim(coalesce(v_section ->> 'title', '')), ''),
      item_limit = (v_section ->> 'itemLimit')::integer,
      config = v_config,
      updated_at = now(),
      updated_by = v_actor
    where key = v_key;
    if not found then
      insert into public.homepage_sections (key, is_enabled, sort_order, title, item_limit, config, updated_by)
      values (v_key, (v_section ->> 'isEnabled')::boolean, v_position - 1,
              nullif(btrim(coalesce(v_section ->> 'title', '')), ''), (v_section ->> 'itemLimit')::integer,
              v_config, v_actor);
    end if;
  end loop;

  perform private.audit(v_actor, 'homepage.saved', 'homepage', 'default', '{}'::jsonb);
  return public.admin_homepage();
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Banners: a small-screen image and ordering
-- ---------------------------------------------------------------------------

alter table public.banners
  add column mobile_image_key text
    check (mobile_image_key is null or mobile_image_key ~ '^banners/[0-9a-f-]{36}/[0-9a-f-]{36}$');

/** Sets or clears a banner's small-screen image; answers the replaced key for cleanup. */
create function public.admin_set_banner_mobile_image(p_banner_id uuid, p_image_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_old text;
begin
  if p_image_key is not null and p_image_key !~ ('^banners/' || p_banner_id::text || '/[0-9a-f-]{36}$') then
    raise exception 'invalid image key' using errcode = 'NZ412';
  end if;
  select mobile_image_key into v_old from public.banners where id = p_banner_id for update;
  if not found then
    raise exception 'banner not found' using errcode = 'NZ404';
  end if;
  update public.banners set mobile_image_key = p_image_key where id = p_banner_id;
  perform private.audit(v_actor,
    case when p_image_key is null then 'banner.mobile_image_removed' else 'banner.mobile_image_set' end,
    'banner', p_banner_id::text, '{}'::jsonb);
  return v_old;
end;
$$;

/** Deletes a banner and answers every image key it held, for removing the files after commit. */
create function public.admin_delete_banner_files(p_banner_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_banner public.banners;
begin
  delete from public.banners where id = p_banner_id returning * into v_banner;
  if not found then
    raise exception 'banner not found' using errcode = 'NZ404';
  end if;
  perform private.audit(v_actor, 'banner.deleted', 'banner', p_banner_id::text, '{}'::jsonb);
  return array_remove(array[v_banner.image_key, v_banner.mobile_image_key], null);
end;
$$;

/**
 * Orders the banners of one placement (and, for category banners, one category):
 * p_ids lists each of them exactly once, first shown first.
 */
create function public.admin_reorder_banners(p_placement public.banner_placement, p_category_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
begin
  if p_placement is null or p_ids is null or cardinality(p_ids) > 100
     or cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
     or (p_placement = 'category') <> (p_category_id is not null)
     or (select array_agg(b.id order by b.id) from public.banners b
         where b.placement = p_placement and b.category_id is not distinct from p_category_id)
        is distinct from (select array_agg(x order by x) from unnest(p_ids) x) then
    raise exception 'list every banner of the placement exactly once' using errcode = 'NZ412';
  end if;
  update public.banners b
  set sort_order = (o.position - 1) * 10
  from unnest(p_ids) with ordinality as o (id, position)
  where b.id = o.id;
  perform private.audit(v_actor, 'banners.reordered', 'banner_placement', p_placement::text,
    jsonb_build_object('categoryId', p_category_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function private.site_page_json(public.site_pages) from public, anon, authenticated;
revoke execute on function private.menu_item_json(public.site_menu_items) from public, anon, authenticated;
revoke execute on function private.homepage_section_json(public.homepage_sections) from public, anon, authenticated;
revoke execute on function private.profile_extra(jsonb, text, text, text) from public, anon, authenticated;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.public_site_page(text)',
    'public.public_navigation()',
    'public.public_homepage()'
  ] loop
    execute format('revoke execute on function %s from public', v_fn);
    execute format('grant execute on function %s to anon, authenticated', v_fn);
  end loop;

  foreach v_fn in array array[
    'public.admin_save_store_profile(text, jsonb, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text)',
    'public.admin_list_site_pages()',
    'public.admin_save_site_page(text, text, text, boolean, text, text)',
    'public.admin_list_menu_items()',
    'public.admin_save_menu_item(uuid, text, text, text, boolean)',
    'public.admin_delete_menu_item(uuid)',
    'public.admin_reorder_menu(text, uuid[])',
    'public.admin_homepage()',
    'public.admin_save_homepage(jsonb)',
    'public.admin_set_banner_mobile_image(uuid, text)',
    'public.admin_delete_banner_files(uuid)',
    'public.admin_reorder_banners(public.banner_placement, uuid, uuid[])'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end;
$$;
