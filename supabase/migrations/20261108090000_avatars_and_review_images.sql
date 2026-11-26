/*
 * Profile avatars and review photos
 * ---------------------------------
 * DRAFT, NOT APPLIED. Written for the owner to apply together with the other pending
 * migrations; the application code that uses it is written to degrade gracefully (no avatar,
 * no photos) until it is applied.
 *
 * Depends on (must already exist, in this order):
 *   20261023120000_identity_and_roles.sql      public.profiles, public.set_updated_at()
 *   20261025090000_admin_permissions_moderation.sql   private.require_permission(), private.audit()
 *   20261102090000_product_reviews.sql         public.product_reviews and the review functions
 *
 * What it adds
 *   1. profiles.avatar_key: the stored base key of the account's own picture (customers and staff
 *      share profiles, so one column serves both). It is not granted to clients: the existing
 *      column-level SELECT grant (20261031090000) does not list it, and UPDATE is limited to the
 *      columns the account screen edits. Only the functions below read or write it.
 *   2. public.product_review_images: the photos attached to a review, one row each, with the
 *      storage key the API generated. No client role can read or write the table directly.
 *   3. Functions (all security definer, search_path pinned, EXECUTE for authenticated only):
 *        my_avatar_key / set_my_avatar / clear_my_avatar    the caller's own picture
 *        add_review_image / remove_review_image             the caller's own review's photos
 *        admin_review_images                                moderators see photos they approve
 *   4. create or replace of catalog_product_reviews and my_product_review, adding an "images"
 *      array of {id, key}. Public reads still return approved reviews only, so a photo is public
 *      exactly when its review is: photos follow the review's moderation.
 *
 * Rules enforced here (the API checks the same things first, but the database is the authority)
 *   - A key must have the exact shape the API generates AND live under the caller's own folder
 *     (avatars/<own user id>/...) or the review's own folder (review-images/<review id>/...), so
 *     a key cannot point at another user's object.
 *   - Only the review's author can add or remove its photos; anyone else gets "not found".
 *   - Photos can be added only while the review is pending, so approved content cannot change
 *     after moderation. At most private.review_image_limit() photos per review.
 *   - Suspended accounts cannot change a picture.
 *
 * Rollback (manual, in this order; replace the two review functions with their versions in
 * 20261102090000_product_reviews.sql):
 *   drop function public.admin_review_images(uuid[]);
 *   drop function public.remove_review_image(uuid);
 *   drop function public.add_review_image(uuid, text, integer, integer);
 *   drop function public.clear_my_avatar();
 *   drop function public.set_my_avatar(text);
 *   drop function public.my_avatar_key();
 *   drop function private.review_image_limit();
 *   drop table public.product_review_images;
 *   alter table public.profiles drop column avatar_key;
 * Dropping the table or column does not delete the stored objects in the media bucket.
 */

-- ---------------------------------------------------------------------------
-- Avatars
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column avatar_key text
  constraint profiles_avatar_key_shape check (
    avatar_key is null
    or avatar_key ~ '^avatars/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

comment on column public.profiles.avatar_key is
  'Base key of the profile picture in the media bucket (the API stores <key>/full.webp and <key>/thumb.webp). Written only by set_my_avatar / clear_my_avatar.';

/** The caller's own picture key, or null. */
create function public.my_avatar_key()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_key text;
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  select p.avatar_key into v_key from public.profiles p where p.id = v_user;
  return v_key;
end;
$$;

/**
 * Points the caller's profile at a freshly stored picture and returns the previous key, so the
 * API can delete the old objects only after this succeeded.
 */
create function public.set_my_avatar(p_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_previous text;
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  if p_key is null or p_key !~ ('^avatars/' || v_user::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'invalid avatar key' using errcode = 'NZ469';
  end if;

  select p.avatar_key into v_previous
  from public.profiles p
  where p.id = v_user and p.status = 'active'
  for update;
  if not found then
    raise exception 'this account cannot change its picture' using errcode = 'NZ464';
  end if;

  update public.profiles set avatar_key = p_key where id = v_user;
  return v_previous;
end;
$$;

/** Removes the caller's picture and returns the key it had, for cleanup. */
create function public.clear_my_avatar()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_previous text;
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;

  select p.avatar_key into v_previous
  from public.profiles p
  where p.id = v_user and p.status = 'active'
  for update;
  if not found then
    raise exception 'this account cannot change its picture' using errcode = 'NZ464';
  end if;

  update public.profiles set avatar_key = null where id = v_user;
  return v_previous;
end;
$$;

-- ---------------------------------------------------------------------------
-- Review photos
-- ---------------------------------------------------------------------------

/** The most photos one review keeps. Mirrors MAX_REVIEW_IMAGES in @nilzora/contracts. */
create function private.review_image_limit()
returns integer
language sql
immutable
as $$ select 4; $$;

create table public.product_review_images (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.product_reviews (id) on delete cascade,
  /** The review's author, repeated so ownership checks never need a join. */
  user_id uuid not null references public.profiles (id) on delete cascade,
  storage_key text not null,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  position smallint not null check (position >= 0),
  created_at timestamptz not null default now(),
  constraint product_review_images_key_shape check (
    storage_key ~ '^review-images/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  -- The key's folder is the review's own id: a photo cannot be filed under another review.
  constraint product_review_images_key_in_review check (
    storage_key like 'review-images/' || review_id::text || '/%'
  ),
  constraint product_review_images_key_unique unique (storage_key),
  constraint product_review_images_position_unique unique (review_id, position)
);

create index product_review_images_review_idx
  on public.product_review_images (review_id, position);

create index product_review_images_user_idx
  on public.product_review_images (user_id);

comment on table public.product_review_images is
  'Photos a customer attached to their review. Visible publicly only through catalog_product_reviews, i.e. only once the review is approved.';

-- No policies: no client role reads or writes this table directly.
alter table public.product_review_images enable row level security;
revoke all on public.product_review_images from anon, authenticated;

/**
 * Attaches one stored photo to the caller's own review. Returns the new photo and the review's
 * photos in order, as {id, key} pairs (the API turns keys into public URLs).
 */
create function public.add_review_image(
  p_review_id uuid,
  p_key text,
  p_width integer,
  p_height integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_status text;
  v_count integer;
  v_position integer;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_user and p.status = 'active') then
    raise exception 'this account cannot post reviews' using errcode = 'NZ464';
  end if;

  -- Someone else's review looks exactly like a missing one.
  select r.status into v_status
  from public.product_reviews r
  where r.id = p_review_id and r.user_id = v_user
  for update;
  if not found then
    raise exception 'review not found' using errcode = 'NZ404';
  end if;
  if v_status <> 'pending' then
    raise exception 'photos can only be added while the review is waiting for approval'
      using errcode = 'NZ466';
  end if;

  if p_key is null
     or p_key !~ ('^review-images/' || p_review_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     or p_width is null or p_width < 1 or p_height is null or p_height < 1 then
    raise exception 'invalid review photo' using errcode = 'NZ468';
  end if;

  select count(*), coalesce(max(i.position), -1) + 1
    into v_count, v_position
  from public.product_review_images i
  where i.review_id = p_review_id;
  if v_count >= private.review_image_limit() then
    raise exception 'a review keeps at most % photos', private.review_image_limit()
      using errcode = 'NZ467';
  end if;

  insert into public.product_review_images (review_id, user_id, storage_key, width, height, position)
  values (p_review_id, v_user, p_key, p_width, p_height, v_position)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'images', (
      select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'key', i.storage_key)
                                order by i.position), '[]'::jsonb)
      from public.product_review_images i
      where i.review_id = p_review_id
    )
  );
end;
$$;

/**
 * Removes one of the caller's own review photos. Returns the removed key (for object cleanup)
 * and the review's remaining photos.
 */
create function public.remove_review_image(p_image_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_review uuid;
  v_key text;
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;

  delete from public.product_review_images i
  where i.id = p_image_id and i.user_id = v_user
  returning i.review_id, i.storage_key into v_review, v_key;
  if not found then
    raise exception 'photo not found' using errcode = 'NZ404';
  end if;

  return jsonb_build_object(
    'key', v_key,
    'images', (
      select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'key', i.storage_key)
                                order by i.position), '[]'::jsonb)
      from public.product_review_images i
      where i.review_id = v_review
    )
  );
end;
$$;

/** Photos of the given reviews, for the moderation queue. */
create function public.admin_review_images(p_review_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('reviews.moderate');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('reviewId', i.review_id, 'id', i.id, 'key', i.storage_key)
                     order by i.review_id, i.position)
    from public.product_review_images i
    where i.review_id = any (coalesce(p_review_ids, '{}'::uuid[]))
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads that now include photos (same signatures; the result gains an "images" array)
-- ---------------------------------------------------------------------------

create or replace function public.my_product_review(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_review jsonb;
  v_order uuid;
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;

  select jsonb_build_object(
           'id', r.id,
           'rating', r.rating,
           'title', r.title,
           'body', r.body,
           'status', r.status,
           'moderationNote', r.moderation_note,
           'images', (
             select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'key', i.storage_key)
                                       order by i.position), '[]'::jsonb)
             from public.product_review_images i
             where i.review_id = r.id
           ),
           'createdAt', r.created_at,
           'updatedAt', r.updated_at
         )
    into v_review
  from public.product_reviews r
  where r.product_id = p_product_id and r.user_id = v_user;

  v_order := private.review_eligibility(v_user, p_product_id);

  return jsonb_build_object(
    'eligible', v_order is not null,
    'review', v_review
  );
end;
$$;

create or replace function public.catalog_product_reviews(
  p_product_slug text,
  p_page integer default 1,
  p_page_size integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_product uuid;
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_size integer := least(50, greatest(1, coalesce(p_page_size, 10)));
  v_count integer;
  v_average numeric;
  v_distribution jsonb;
  v_rows jsonb;
begin
  select id into v_product from public.products where slug = p_product_slug;
  if v_product is null then
    raise exception 'product not found' using errcode = 'NZ404';
  end if;

  select count(*), round(avg(r.rating)::numeric, 2)
    into v_count, v_average
  from public.product_reviews r
  where r.product_id = v_product and r.status = 'approved';

  select jsonb_object_agg(s.star::text, s.total)
    into v_distribution
  from (
    select star, count(r.id) as total
    from generate_series(1, 5) as star
    left join public.product_reviews r
      on r.product_id = v_product and r.status = 'approved' and r.rating = star
    group by star
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id,
           'rating', x.rating,
           'title', x.title,
           'body', x.body,
           'authorName', x.author_name,
           'verified', true,
           'images', (
             select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'key', i.storage_key)
                                       order by i.position), '[]'::jsonb)
             from public.product_review_images i
             where i.review_id = x.id
           ),
           'createdAt', x.created_at
         ) order by x.created_at desc, x.id), '[]'::jsonb)
    into v_rows
  from (
    select r.id, r.rating, r.title, r.body, r.created_at,
           split_part(p.full_name, ' ', 1) ||
             case
               when position(' ' in coalesce(p.full_name, '')) > 0
                 then ' ' || left(split_part(p.full_name, ' ', 2), 1) || '.'
               else ''
             end as author_name
    from public.product_reviews r
    join public.profiles p on p.id = r.user_id
    where r.product_id = v_product and r.status = 'approved'
    order by r.created_at desc, r.id
    offset (v_page - 1) * v_size
    limit v_size
  ) x;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'averageRating', coalesce(v_average, 0),
      'reviewCount', coalesce(v_count, 0),
      'distribution', coalesce(v_distribution, '{}'::jsonb)
    ),
    'reviews', v_rows,
    'page', v_page,
    'pageSize', v_size,
    'total', coalesce(v_count, 0),
    'totalPages', case when coalesce(v_count, 0) = 0 then 0
                       else ceil(v_count::numeric / v_size)::int end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.my_avatar_key() from public, anon, authenticated;
revoke execute on function public.set_my_avatar(text) from public, anon, authenticated;
revoke execute on function public.clear_my_avatar() from public, anon, authenticated;
revoke execute on function public.add_review_image(uuid, text, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.remove_review_image(uuid) from public, anon, authenticated;
revoke execute on function public.admin_review_images(uuid[]) from public, anon, authenticated;
revoke execute on function private.review_image_limit() from public, anon, authenticated;

grant execute on function public.my_avatar_key() to authenticated;
grant execute on function public.set_my_avatar(text) to authenticated;
grant execute on function public.clear_my_avatar() to authenticated;
grant execute on function public.add_review_image(uuid, text, integer, integer) to authenticated;
grant execute on function public.remove_review_image(uuid) to authenticated;
grant execute on function public.admin_review_images(uuid[]) to authenticated;
