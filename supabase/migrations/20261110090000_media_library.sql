-- ---------------------------------------------------------------------------
-- Media library
--
-- Pictures the store reuses outside the catalog (store logo and sharing image, SEO
-- images, onboarding slides). The API processes every upload itself (bytes sniffed,
-- metadata stripped, WebP full size and thumbnail) and writes the two objects under a
-- key it generated, `library/<asset id>`; these functions only record and manage rows.
--
-- The table has Row Level Security and no policies: it is reached only through the
-- security-definer functions below, which check the caller's permission and write the
-- audit log. Reading needs settings.manage or products.update; every change needs
-- settings.manage. An asset that a store-profile, SEO, onboarding or banner image field
-- still uses cannot be deleted (NZ442), and the storage objects are removed by the API
-- only after the delete has committed.
--
-- SQLSTATEs: NZ404 not found, NZ412 invalid input, NZ442 in use.
-- Additive only: one table and new functions.
-- ---------------------------------------------------------------------------

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  /** Object keys of the two stored WebP files, always derived from the id. */
  full_key text not null unique,
  thumb_key text not null unique,
  /** Type of the stored files. */
  content_type text not null default 'image/webp'
    check (content_type in ('image/webp', 'image/jpeg', 'image/png')),
  /** Pixel size and bytes of the full-size file. */
  width integer not null check (width between 1 and 8000),
  height integer not null check (height between 1 and 8000),
  bytes integer not null check (bytes between 1 and 5242880),
  /** A description for screen readers. */
  alt text check (alt is null or char_length(btrim(alt)) between 1 and 250),
  /** The uploader's file name, kept only as a label (no folders, no control characters). */
  original_name text check (
    original_name is null
    or (char_length(btrim(original_name)) between 1 and 200
        and original_name !~ '[[:cntrl:]/\\]')
  ),
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint media_assets_keys_match_id check (
    full_key = 'library/' || id::text || '/full.webp'
    and thumb_key = 'library/' || id::text || '/thumb.webp'
  )
);

comment on table public.media_assets is
  'Library pictures (store profile, SEO, onboarding). Reached only through the admin_*_media functions.';

create index media_assets_created_idx on public.media_assets (created_at desc, id desc);
create index media_assets_uploaded_by_idx on public.media_assets (uploaded_by);

alter table public.media_assets enable row level security;
revoke all on table public.media_assets from public, anon, authenticated;

/** The base key other image fields store: `library/<id>`. */
create function private.media_base_key(p_asset public.media_assets)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'library/' || p_asset.id::text;
$$;

/** One asset as the API reads it, with the uploader's name and email. */
create function private.media_asset_json(p_asset public.media_assets)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_asset.id,
    'key', private.media_base_key(p_asset),
    'fullKey', p_asset.full_key,
    'thumbKey', p_asset.thumb_key,
    'contentType', p_asset.content_type,
    'width', p_asset.width,
    'height', p_asset.height,
    'bytes', p_asset.bytes,
    'alt', p_asset.alt,
    'originalName', p_asset.original_name,
    'uploadedBy', (
      select jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email)
      from public.profiles p
      where p.id = p_asset.uploaded_by
    ),
    'createdAt', p_asset.created_at
  );
$$;

/** Whether an image field still stores the key: the store profile, SEO, onboarding, banners. */
create function private.media_key_in_use(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.store_profile s where s.logo_key = p_key or s.og_image_key = p_key)
      or exists (select 1 from public.onboarding_slides o where o.image_key = p_key)
      or exists (select 1 from public.products p where p.og_image_key = p_key)
      or exists (select 1 from public.categories c where c.og_image_key = p_key)
      or exists (select 1 from public.banners b where b.image_key = p_key);
$$;

revoke execute on function private.media_base_key(public.media_assets) from public, anon, authenticated;
revoke execute on function private.media_asset_json(public.media_assets) from public, anon, authenticated;
revoke execute on function private.media_key_in_use(text) from public, anon, authenticated;

/** A description: trimmed, empty means none, at most 250 characters (NZ412). */
create function private.media_alt(p_alt text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_alt text := nullif(btrim(coalesce(p_alt, '')), '');
begin
  if v_alt is not null and char_length(v_alt) > 250 then
    raise exception 'the description must be at most 250 characters' using errcode = 'NZ412';
  end if;
  return v_alt;
end;
$$;

revoke execute on function private.media_alt(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reads: settings.manage or products.update
-- ---------------------------------------------------------------------------

/** One page of the library, newest first; `p_q` matches the description or the file name. */
create function public.admin_list_media(
  p_q text default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns table (asset jsonb, total_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_pattern text;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  if not (private.has_permission('settings.manage') or private.has_permission('products.update')) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;
  if p_page is null or p_page not between 1 and 1000
     or p_page_size is null or p_page_size not between 1 and 100 then
    raise exception 'invalid page' using errcode = 'NZ412';
  end if;
  if v_q is not null and char_length(v_q) > 100 then
    raise exception 'the search is too long' using errcode = 'NZ412';
  end if;
  -- The search text is literal: LIKE wildcards in it match themselves.
  v_pattern := case when v_q is null then null
    else '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%' end;

  return query
  select private.media_asset_json(m), count(*) over ()
  from public.media_assets m
  where v_pattern is null
     or m.alt ilike v_pattern
     or m.original_name ilike v_pattern
  order by m.created_at desc, m.id desc
  limit p_page_size offset (p_page - 1) * p_page_size;
end;
$$;

-- ---------------------------------------------------------------------------
-- Changes: settings.manage, audited
-- ---------------------------------------------------------------------------

/**
 * Records an upload the API has already stored under `library/<p_id>`. Answers with the
 * asset. The objects exist before the row; if this refuses, the API removes them.
 */
create function public.admin_record_media(
  p_id uuid,
  p_content_type text,
  p_width integer,
  p_height integer,
  p_bytes integer,
  p_alt text,
  p_original_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_name text := nullif(btrim(coalesce(p_original_name, '')), '');
  v_asset public.media_assets;
begin
  if p_id is null then
    raise exception 'an asset id is required' using errcode = 'NZ412';
  end if;
  if v_name is not null and (char_length(v_name) > 200 or v_name ~ '[[:cntrl:]/\\]') then
    raise exception 'invalid file name' using errcode = 'NZ412';
  end if;

  insert into public.media_assets (
    id, full_key, thumb_key, content_type, width, height, bytes, alt, original_name, uploaded_by
  ) values (
    p_id,
    'library/' || p_id::text || '/full.webp',
    'library/' || p_id::text || '/thumb.webp',
    coalesce(p_content_type, 'image/webp'),
    p_width,
    p_height,
    p_bytes,
    private.media_alt(p_alt),
    v_name,
    v_actor
  )
  returning * into v_asset;

  perform private.audit(v_actor, 'media.uploaded', 'media_asset', p_id::text,
    jsonb_build_object('key', private.media_base_key(v_asset), 'bytes', p_bytes));
  return private.media_asset_json(v_asset);
end;
$$;

/** Changes an asset's description (null or empty removes it). Answers with the asset. */
create function public.admin_update_media_alt(p_id uuid, p_alt text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_alt text := private.media_alt(p_alt);
  v_asset public.media_assets;
begin
  update public.media_assets set alt = v_alt where id = p_id
  returning * into v_asset;
  if not found then
    raise exception 'media asset not found' using errcode = 'NZ404';
  end if;
  perform private.audit(v_actor, 'media.alt_changed', 'media_asset', p_id::text,
    jsonb_build_object('hasAlt', v_alt is not null));
  return private.media_asset_json(v_asset);
end;
$$;

/**
 * Deletes an asset that no image field uses (NZ442 otherwise) and answers with the
 * object keys to remove. The API deletes the objects only after this has committed.
 */
create function public.admin_delete_media(p_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_asset public.media_assets;
begin
  select * into v_asset from public.media_assets where id = p_id for update;
  if not found then
    raise exception 'media asset not found' using errcode = 'NZ404';
  end if;
  if private.media_key_in_use(private.media_base_key(v_asset)) then
    raise exception 'the picture is still in use' using errcode = 'NZ442';
  end if;

  delete from public.media_assets where id = p_id;
  perform private.audit(v_actor, 'media.deleted', 'media_asset', p_id::text,
    jsonb_build_object('key', private.media_base_key(v_asset)));
  return array[v_asset.full_key, v_asset.thumb_key];
end;
$$;

revoke execute on function public.admin_list_media(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.admin_record_media(uuid, text, integer, integer, integer, text, text)
  from public, anon, authenticated;
revoke execute on function public.admin_update_media_alt(uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_delete_media(uuid) from public, anon, authenticated;

grant execute on function public.admin_list_media(text, integer, integer) to authenticated;
grant execute on function public.admin_record_media(uuid, text, integer, integer, integer, text, text)
  to authenticated;
grant execute on function public.admin_update_media_alt(uuid, text) to authenticated;
grant execute on function public.admin_delete_media(uuid) to authenticated;
