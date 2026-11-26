-- Photos can be attached to a review right after it is posted.
--
-- Reviews by verified buyers are published the moment they are submitted, but add_review_image only
-- accepted a review that was still waiting for approval, so a review posted with photos was saved
-- and every one of its photos was then refused. The function now also accepts the customer's own
-- review while it is at most an hour old. Everything else is unchanged: the review must be the
-- caller's, the photo key must be the one made for this review, a review keeps at most four, and
-- moderators can still reject a review (and so its photos) afterwards. Nothing is dropped or rewritten.

CREATE OR REPLACE FUNCTION public.add_review_image(p_review_id uuid, p_key text, p_width integer, p_height integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := (select auth.uid());
  v_status text;
  v_published timestamptz;
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
  select r.status, r.published_at into v_status, v_published
  from public.product_reviews r
  where r.id = p_review_id and r.user_id = v_user
  for update;
  if not found then
    raise exception 'review not found' using errcode = 'NZ404';
  end if;
  -- Photos belong to the review the customer is posting. A review waiting for approval takes them,
  -- and so does one that was published an hour ago or less (reviews by verified buyers are published
  -- at once, so the photos are attached right after, a moment later). After that the review is
  -- closed to new photos.
  if not (
    v_status = 'pending'
    or (v_status = 'approved' and v_published is not null and v_published > now() - interval '1 hour')
  ) then
    raise exception 'photos can only be added soon after the review is posted'
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
$function$;

-- A review keeps at most four photos, the same number the website and the app offer. The database was
-- still allowing five, so the limit the customer saw was not the one that was enforced. Reviews that
-- already hold five keep them: the limit only decides whether another can be added.
create or replace function private.review_image_limit()
returns integer
language sql
immutable
as $$ select 4; $$;
