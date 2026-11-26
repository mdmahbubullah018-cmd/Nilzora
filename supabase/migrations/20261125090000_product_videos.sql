-- Product videos (Cloudflare R2). Additive: one new table and its admin functions.
-- The same content rules as product images (20261027100000_product_images.sql): a video
-- changes only while the product is off sale and not under review, any change sends the
-- product back for review, every write is a SECURITY DEFINER function that checks the
-- caller's own permission and writes the audit log, and nobody writes the table directly.

create table public.product_videos (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  -- Object key, derived from the ids by the database, never chosen by a client.
  storage_key text not null unique,
  content_type text not null check (content_type in ('video/mp4', 'video/webm')),
  bytes integer not null check (bytes between 1 and 41943040),
  title text check (title is null or char_length(title) between 1 and 160),
  position integer not null check (position between 0 and 2),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint product_videos_key_matches_ids check (
    storage_key = 'products/' || product_id::text || '/videos/' || id::text || '.'
      || case content_type when 'video/mp4' then 'mp4' else 'webm' end
  ),
  constraint product_videos_position_unique unique (product_id, position) deferrable initially deferred
);

comment on table public.product_videos is 'Product videos stored in R2 at storage_key. Written only by the admin_*_product_video functions.';

alter table public.product_videos enable row level security;

create policy "Anyone reads videos of products on sale"
  on public.product_videos for select to anon, authenticated
  using (
    exists (select 1 from public.products p where p.id = product_id and p.status = 'active')
  );

create policy "Product staff read every video"
  on public.product_videos for select to authenticated
  using ((select public.has_permission('products.read')));

revoke all on table public.product_videos from public, anon, authenticated;
grant select (id, product_id, storage_key, content_type, bytes, title, position, created_at)
  on table public.product_videos to anon, authenticated;
grant select, insert, update, delete on table public.product_videos to service_role;

-- ---------------------------------------------------------------------------
-- admin_add_product_video: registers a video whose object the API already stored.
-- At most 3 per product; the new one goes last. Returns its position.
-- ---------------------------------------------------------------------------

create function public.admin_add_product_video(
  p_product_id uuid,
  p_video_id uuid,
  p_content_type text,
  p_bytes integer,
  p_title text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.update');
  v_title text := private.normalized_alt_text(p_title);
  v_count integer;
  v_position integer;
begin
  if p_video_id is null or p_bytes is null or p_bytes not between 1 and 41943040
     or p_content_type is null or p_content_type not in ('video/mp4', 'video/webm') then
    raise exception 'invalid video details' using errcode = 'NZ412';
  end if;

  perform private.lock_product_for_image_edit(p_product_id);

  select count(*)::integer into v_count from public.product_videos where product_id = p_product_id;
  if v_count >= 3 then
    raise exception 'a product keeps at most 3 videos' using errcode = 'NZ440';
  end if;
  v_position := v_count;

  insert into public.product_videos (id, product_id, storage_key, content_type, bytes, title, position, created_by)
  values (
    p_video_id, p_product_id,
    'products/' || p_product_id::text || '/videos/' || p_video_id::text || '.'
      || case p_content_type when 'video/mp4' then 'mp4' else 'webm' end,
    p_content_type, p_bytes, v_title, v_position, v_actor
  );

  perform private.touch_product_content(p_product_id, v_actor);
  perform private.audit(v_actor, 'product.video_added', 'product', p_product_id::text,
    jsonb_build_object('videoId', p_video_id, 'position', v_position));
  return v_position;
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_reorder_product_videos: the list must name every video of the product once.
-- ---------------------------------------------------------------------------

create function public.admin_reorder_product_videos(p_product_id uuid, p_video_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.update');
  v_current uuid[];
begin
  perform private.lock_product_for_image_edit(p_product_id);

  select coalesce(array_agg(id order by id), '{}') into v_current
  from public.product_videos where product_id = p_product_id;

  if p_video_ids is null
     or cardinality(p_video_ids) <> cardinality(v_current)
     or (select count(distinct x) from unnest(p_video_ids) as x) <> cardinality(p_video_ids)
     or (select coalesce(array_agg(x order by x), '{}') from unnest(p_video_ids) as x) <> v_current then
    raise exception 'list every video of the product exactly once' using errcode = 'NZ412';
  end if;

  update public.product_videos v
  set position = o.ord - 1
  from unnest(p_video_ids) with ordinality as o (id, ord)
  where v.id = o.id and v.product_id = p_product_id;

  perform private.touch_product_content(p_product_id, v_actor);
  perform private.audit(v_actor, 'product.videos_reordered', 'product', p_product_id::text,
    jsonb_build_object('count', cardinality(p_video_ids)));
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_delete_product_video: removes the row and closes the gap. Returns the key so
-- the API deletes the object from R2 after this commits.
-- ---------------------------------------------------------------------------

create function public.admin_delete_product_video(p_video_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.update');
  v_product_id uuid;
  v_key text;
begin
  select product_id into v_product_id from public.product_videos where id = p_video_id;
  if not found then
    raise exception 'video not found' using errcode = 'NZ404';
  end if;
  perform private.lock_product_for_image_edit(v_product_id);

  delete from public.product_videos where id = p_video_id returning storage_key into v_key;

  update public.product_videos v
  set position = r.new_position
  from (
    select id, (row_number() over (order by position) - 1)::integer as new_position
    from public.product_videos where product_id = v_product_id
  ) r
  where v.id = r.id and v.position <> r.new_position;

  perform private.touch_product_content(v_product_id, v_actor);
  perform private.audit(v_actor, 'product.video_removed', 'product', v_product_id::text,
    jsonb_build_object('videoId', p_video_id));
  return v_key;
end;
$$;

revoke execute on function public.admin_add_product_video(uuid, uuid, text, integer, text) from public, anon;
revoke execute on function public.admin_reorder_product_videos(uuid, uuid[]) from public, anon;
revoke execute on function public.admin_delete_product_video(uuid) from public, anon;
grant execute on function public.admin_add_product_video(uuid, uuid, text, integer, text) to authenticated, service_role;
grant execute on function public.admin_reorder_product_videos(uuid, uuid[]) to authenticated, service_role;
grant execute on function public.admin_delete_product_video(uuid) to authenticated, service_role;
