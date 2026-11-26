-- Product images (Cloudflare R2). The database keeps only what identifies the objects:
-- the API builds public URLs from its own configuration. Images are product content, so
-- they follow the content rules of admin_update_product: not while the product is on
-- sale or under review, and any change sends the product back for review. Every write is
-- a SECURITY DEFINER function that checks the caller's own permission and audits the
-- change; nobody writes the table directly.

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  -- Base key of the two WebP variants: {base}/full.webp and {base}/thumb.webp. It is
  -- derived from the ids, never chosen by a client.
  storage_key text not null unique,
  width integer not null check (width between 1 and 4096),
  height integer not null check (height between 1 and 4096),
  bytes integer not null check (bytes between 1 and 10485760),
  alt_text text check (alt_text is null or char_length(alt_text) between 1 and 160),
  position integer not null check (position between 0 and 7),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint product_images_key_matches_ids
    check (storage_key = 'products/' || product_id::text || '/' || id::text),
  -- Checked at commit so reordering can swap positions within one statement.
  constraint product_images_position_unique unique (product_id, position) deferrable initially deferred
);

comment on table public.product_images is 'Product images stored in R2 (full and thumb WebP variants under storage_key). Position 0 is the primary image. Written only by the admin_*_product_image functions.';
comment on column public.product_images.bytes is 'Size of the full variant in bytes.';

alter table public.product_images enable row level security;

create policy "Anyone reads images of products on sale"
  on public.product_images for select to anon, authenticated
  using (
    exists (select 1 from public.products p where p.id = product_id and p.status = 'active')
  );

create policy "Product staff read every image"
  on public.product_images for select to authenticated
  using ((select public.has_permission('products.read')));

revoke all on table public.product_images from public, anon, authenticated;
grant select (id, product_id, storage_key, width, height, alt_text, position, created_at)
  on table public.product_images to anon, authenticated;
grant select, insert, update, delete on table public.product_images to service_role;

-- ---------------------------------------------------------------------------
-- Shared guard: the product must exist and be editable as content.
-- ---------------------------------------------------------------------------

create function private.lock_product_for_image_edit(p_product_id uuid)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product not found' using errcode = 'NZ404';
  end if;
  if v_product.status = 'active' then
    raise exception 'unpublish the product before changing its images' using errcode = 'NZ430';
  end if;
  if v_product.moderation_status = 'pending' then
    raise exception 'the product is under review' using errcode = 'NZ431';
  end if;
  return v_product;
end;
$$;

-- Images are reviewed content: a change sends the product back for review.
create function private.touch_product_content(p_product_id uuid, p_actor uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.products
  set moderation_status = 'not_submitted',
      content_updated_by = p_actor,
      updated_by = p_actor
  where id = p_product_id;
$$;

create function private.normalized_alt_text(p_alt text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_alt text := nullif(btrim(coalesce(p_alt, '')), '');
begin
  if v_alt is not null and char_length(v_alt) > 160 then
    raise exception 'the description is too long' using errcode = 'NZ412';
  end if;
  return v_alt;
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_add_product_image: registers an image whose objects the API already stored.
-- At most 8 per product; the new image goes last. Returns its position.
-- ---------------------------------------------------------------------------

create function public.admin_add_product_image(
  p_product_id uuid,
  p_image_id uuid,
  p_width integer,
  p_height integer,
  p_bytes integer,
  p_alt_text text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.update');
  v_alt text := private.normalized_alt_text(p_alt_text);
  v_count integer;
  v_position integer;
begin
  if p_image_id is null or p_width is null or p_height is null or p_bytes is null
     or p_width not between 1 and 4096 or p_height not between 1 and 4096
     or p_bytes not between 1 and 10485760 then
    raise exception 'invalid image details' using errcode = 'NZ412';
  end if;

  perform private.lock_product_for_image_edit(p_product_id);

  select count(*)::integer into v_count from public.product_images where product_id = p_product_id;
  if v_count >= 8 then
    raise exception 'a product keeps at most 8 images' using errcode = 'NZ440';
  end if;
  v_position := v_count;

  insert into public.product_images (id, product_id, storage_key, width, height, bytes, alt_text, position, created_by)
  values (
    p_image_id, p_product_id, 'products/' || p_product_id::text || '/' || p_image_id::text,
    p_width, p_height, p_bytes, v_alt, v_position, v_actor
  );

  perform private.touch_product_content(p_product_id, v_actor);
  perform private.audit(v_actor, 'product.image_added', 'product', p_product_id::text,
    jsonb_build_object('imageId', p_image_id, 'position', v_position));
  return v_position;
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_update_product_image: changes the description (alt text); null removes it.
-- ---------------------------------------------------------------------------

create function public.admin_update_product_image(p_image_id uuid, p_alt_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.update');
  v_alt text := private.normalized_alt_text(p_alt_text);
  v_product_id uuid;
begin
  select product_id into v_product_id from public.product_images where id = p_image_id;
  if not found then
    raise exception 'image not found' using errcode = 'NZ404';
  end if;
  perform private.lock_product_for_image_edit(v_product_id);

  update public.product_images set alt_text = v_alt where id = p_image_id;

  perform private.touch_product_content(v_product_id, v_actor);
  perform private.audit(v_actor, 'product.image_updated', 'product', v_product_id::text,
    jsonb_build_object('imageId', p_image_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_reorder_product_images: the array must list exactly the product's images.
-- ---------------------------------------------------------------------------

create function public.admin_reorder_product_images(p_product_id uuid, p_image_ids uuid[])
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
  from public.product_images where product_id = p_product_id;

  if p_image_ids is null
     or cardinality(p_image_ids) <> cardinality(v_current)
     or (select count(distinct x) from unnest(p_image_ids) as x) <> cardinality(p_image_ids)
     or (select coalesce(array_agg(x order by x), '{}') from unnest(p_image_ids) as x) <> v_current then
    raise exception 'list every image of the product exactly once' using errcode = 'NZ412';
  end if;

  update public.product_images i
  set position = o.ord - 1
  from unnest(p_image_ids) with ordinality as o (id, ord)
  where i.id = o.id and i.product_id = p_product_id;

  perform private.touch_product_content(p_product_id, v_actor);
  perform private.audit(v_actor, 'product.images_reordered', 'product', p_product_id::text,
    jsonb_build_object('count', cardinality(p_image_ids)));
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_delete_product_image: removes the row and closes the gap. Returns the base
-- key so the API deletes the objects from R2 after this commits.
-- ---------------------------------------------------------------------------

create function public.admin_delete_product_image(p_image_id uuid)
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
  select product_id into v_product_id from public.product_images where id = p_image_id;
  if not found then
    raise exception 'image not found' using errcode = 'NZ404';
  end if;
  perform private.lock_product_for_image_edit(v_product_id);

  delete from public.product_images where id = p_image_id returning storage_key into v_key;

  update public.product_images i
  set position = r.new_position
  from (
    select id, (row_number() over (order by position) - 1)::integer as new_position
    from public.product_images where product_id = v_product_id
  ) r
  where i.id = r.id and i.position <> r.new_position;

  perform private.touch_product_content(v_product_id, v_actor);
  perform private.audit(v_actor, 'product.image_removed', 'product', v_product_id::text,
    jsonb_build_object('imageId', p_image_id));
  return v_key;
end;
$$;

revoke execute on function private.lock_product_for_image_edit(uuid) from public, anon, authenticated;
revoke execute on function private.touch_product_content(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.normalized_alt_text(text) from public, anon, authenticated;

revoke execute on function public.admin_add_product_image(uuid, uuid, integer, integer, integer, text) from public, anon, authenticated;
revoke execute on function public.admin_update_product_image(uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_reorder_product_images(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.admin_delete_product_image(uuid) from public, anon, authenticated;
grant execute on function public.admin_add_product_image(uuid, uuid, integer, integer, integer, text) to authenticated;
grant execute on function public.admin_update_product_image(uuid, text) to authenticated;
grant execute on function public.admin_reorder_product_images(uuid, uuid[]) to authenticated;
grant execute on function public.admin_delete_product_image(uuid) to authenticated;
