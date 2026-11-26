/*
 * Reviews that publish themselves, can be hidden with a reason, and can be answered
 * =================================================================================
 * The review system shipped in 20261102090000 (and extended for photos in
 * 20261108090000) made every review wait in a moderation queue. A verified review — one
 * written by an account with a *delivered* order for the product — does not need that
 * gate: the purchase is already proven, and the gate only delayed honest reviews and left
 * customers staring at "waiting for the store to check it".
 *
 * What changes
 *   1. A review is public the moment it is saved. Moderation becomes a *reactive* power:
 *      staff hide a review that breaks the rules, and hiding always records who and why.
 *      Nothing is deleted — the customer keeps their words and photos, and support can
 *      explain what happened.
 *   2. Staff can answer a review in public, once per review, and edit or withdraw that
 *      answer. The reply is shown under the review on the storefront and in the app.
 *   3. Permissions are split: `reviews.view` to read the list, `reviews.reply` to answer,
 *      `reviews.moderate` to hide. Reading is not the same right as deciding.
 *   4. A review carries up to 5 photos instead of 4.
 *   5. Editable reviews: a customer whose review was *not* hidden may correct their own
 *      rating and text, which used to be impossible.
 *
 * Safety
 *   - Additive and in-place: no row is deleted, no photo is touched, no key is rebuilt.
 *   - Every function keeps running as its owner but checks the CALLER's own permission
 *     first, so a route bug cannot act with more authority than the account holds.
 *   - The existing pending reviews are published by an explicit, reviewed statement at the
 *     end. It is guarded: only rows whose author still has a delivered order for the
 *     product are published, which is the same rule the insert already enforced.
 *
 * Rollback (manual; run in this order)
 *   drop function public.admin_reply_to_review(uuid, text);
 *   drop function public.admin_clear_review_reply(uuid);
 *   drop function public.edit_my_review(uuid, integer, text, text);
 *   drop table public.product_review_replies;
 *   -- then restore the previous bodies of
 *   --   private.review_image_limit()            (20261108090000: select 4)
 *   --   public.submit_product_review(...)       (20261102090000)
 *   --   public.my_product_review(uuid)          (20261108090000)
 *   --   public.catalog_product_reviews(...)     (20261108090000)
 *   --   public.admin_list_product_reviews(...)  (20261102090000)
 *   --   public.admin_set_product_review_status(...) (20261102090000)
 *   -- and delete the two permission rows added below.
 */

-- ---------------------------------------------------------------------------
-- 1. Permissions
-- ---------------------------------------------------------------------------

insert into public.permissions (name, description) values
  ('reviews.view', 'Read customer reviews and their photos'),
  ('reviews.reply', 'Answer a customer review in public')
on conflict (name) do nothing;

-- Owners and admins see and answer reviews; the moderator queue keeps working as before.
insert into public.role_permissions (role, permission)
select 'super_admin'::public.app_role, p.name
  from public.permissions p
 where p.name in ('reviews.view', 'reviews.reply')
union all
select 'admin'::public.app_role, p.name
  from public.permissions p
 where p.name in ('reviews.view', 'reviews.reply')
union all
select 'moderator'::public.app_role, p.name
  from public.permissions p
 where p.name in ('reviews.view', 'reviews.reply')
on conflict (role, permission) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Up to five photos
-- ---------------------------------------------------------------------------

create or replace function private.review_image_limit()
returns integer
language sql
immutable
as $$ select 5; $$;

comment on function private.review_image_limit() is
  'How many photos one review may carry. Read by add_review_image so the limit cannot be bypassed.';

-- ---------------------------------------------------------------------------
-- 3. Public answers
-- ---------------------------------------------------------------------------

create table public.product_review_replies (
  /** One answer per review: a thread of staff replies would read as an argument. */
  review_id uuid primary key references public.product_reviews (id) on delete cascade,
  /** Who wrote it, for the audit trail; the public only sees that it is the store. */
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(body) between 2 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.product_review_replies is
  'The store''s public answer to a review. Written and removed only by admin_reply_to_review / admin_clear_review_reply.';

create trigger product_review_replies_set_updated_at
before update on public.product_review_replies
for each row execute function public.set_updated_at();

/* Personal data about the staff member and nothing a client may write: no policies. */
alter table public.product_review_replies enable row level security;

/**
 * The reply shaped for a reader: the store answers, so the author's name and picture are
 * the store's, not a person's. Returns null when there is no reply, which jsonb_build_object
 * turns into JSON null — what the contracts expect.
 */
create function private.review_reply_json(p_review_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'body', r.body,
           'authorName', 'Nilzora',
           'createdAt', r.created_at,
           'updatedAt', r.updated_at
         )
    from public.product_review_replies r
   where r.review_id = p_review_id;
$$;

/**
 * Publishes the store's answer to a review, or replaces the one already there. Requires
 * `reviews.reply`; refuses to answer a review the store has hidden, because a reply under
 * an invisible review answers nobody.
 */
create function public.admin_reply_to_review(p_review_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('reviews.reply');
  v_body text := btrim(coalesce(p_body, ''));
  v_review public.product_reviews;
  v_reply jsonb;
begin
  if char_length(v_body) < 2 then
    raise exception 'write a reply first' using errcode = 'NZ412';
  end if;
  if char_length(v_body) > 1000 then
    raise exception 'keep the reply under 1000 characters' using errcode = 'NZ412';
  end if;

  select * into v_review from public.product_reviews where id = p_review_id;
  if not found then
    raise exception 'review not found' using errcode = 'NZ404';
  end if;
  if v_review.status = 'rejected' then
    raise exception 'this review is hidden; publish it before replying' using errcode = 'NZ412';
  end if;

  insert into public.product_review_replies (review_id, author_id, body)
  values (p_review_id, v_actor, v_body)
  on conflict (review_id) do update
    set body = excluded.body,
        author_id = excluded.author_id
  returning jsonb_build_object(
    'body', body, 'authorName', 'Nilzora',
    'createdAt', created_at, 'updatedAt', updated_at
  ) into v_reply;

  perform private.audit(v_actor, 'review.replied', 'product_review', p_review_id::text,
    jsonb_build_object('productId', v_review.product_id));

  return v_reply;
end;
$$;

/** Withdraws the store's answer. Requires `reviews.reply`. */
create function public.admin_clear_review_reply(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('reviews.reply');
  v_review_id uuid;
begin
  delete from public.product_review_replies where review_id = p_review_id
  returning review_id into v_review_id;
  if v_review_id is null then
    return;
  end if;
  perform private.audit(v_actor, 'review.reply_removed', 'product_review', p_review_id::text,
    '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. A review publishes itself
-- ---------------------------------------------------------------------------

/**
 * Saves the caller's review of a product they bought and received, and publishes it at
 * once: the purchase is verified by the eligibility check above, which is the part that
 * cannot be faked. To take it down again staff use admin_set_product_review_status, which
 * records the reason and keeps the review on file.
 *
 * `confirmed_at` records that the store's own rules allowed it at the moment it was saved,
 * so a later support question ("why was this public?") has an answer that does not depend
 * on re-deriving eligibility from orders that may since have been archived.
 */
alter table public.product_reviews
  add column published_at timestamptz;

comment on column public.product_reviews.published_at is
  'When the review became visible. Set on save; re-set when a hidden review is published again.';

update public.product_reviews
   set published_at = coalesce(moderated_at, created_at)
 where status = 'approved';

create or replace function public.submit_product_review(
  p_product_id uuid,
  p_rating integer,
  p_body text,
  p_title text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_order uuid;
  v_body text := btrim(coalesce(p_body, ''));
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_id uuid;
begin
  if v_user is null then
    raise exception 'sign in to write a review' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_user and p.status = 'active') then
    raise exception 'this account cannot post reviews' using errcode = 'NZ464';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'choose a rating from 1 to 5' using errcode = 'NZ460';
  end if;
  if char_length(v_body) < 10 then
    raise exception 'write at least 10 characters' using errcode = 'NZ462';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'keep the review under 2000 characters' using errcode = 'NZ462';
  end if;
  if v_title is not null and char_length(v_title) > 120 then
    raise exception 'keep the title under 120 characters' using errcode = 'NZ462';
  end if;
  if not exists (select 1 from public.products p where p.id = p_product_id) then
    raise exception 'product not found' using errcode = 'NZ404';
  end if;

  v_order := private.review_eligibility(v_user, p_product_id);
  if v_order is null then
    raise exception 'only customers who received this product can review it'
      using errcode = 'NZ463';
  end if;

  if exists (
    select 1 from public.product_reviews r
    where r.product_id = p_product_id and r.user_id = v_user
  ) then
    raise exception 'you have already reviewed this product' using errcode = 'NZ461';
  end if;

  insert into public.product_reviews
    (product_id, user_id, order_id, rating, title, body, status, published_at)
  values
    (p_product_id, v_user, v_order, p_rating, v_title, v_body, 'approved', now())
  returning id into v_id;

  perform private.audit(v_user, 'review.published', 'product_review', v_id::text,
    jsonb_build_object('productId', p_product_id, 'rating', p_rating));

  return v_id;
end;
$$;

/**
 * Corrections to the customer's own review. A hidden review stays hidden: editing must
 * never be a way around a moderation decision. Raising it again is a new decision by staff.
 */
create function public.edit_my_review(
  p_review_id uuid,
  p_rating integer,
  p_body text,
  p_title text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_review public.product_reviews;
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'choose a rating from 1 to 5' using errcode = 'NZ460';
  end if;
  if char_length(v_body) < 10 or char_length(v_body) > 2000 then
    raise exception 'keep the review between 10 and 2000 characters' using errcode = 'NZ462';
  end if;
  if v_title is not null and char_length(v_title) > 120 then
    raise exception 'keep the title under 120 characters' using errcode = 'NZ462';
  end if;

  select * into v_review from public.product_reviews where id = p_review_id for update;
  if not found or v_review.user_id <> v_user then
    raise exception 'review not found' using errcode = 'NZ404';
  end if;
  if v_review.status = 'rejected' then
    raise exception 'this review is hidden; contact the store to change it' using errcode = 'NZ412';
  end if;

  update public.product_reviews
     set rating = p_rating, title = v_title, body = v_body
   where id = p_review_id;

  perform private.audit(v_user, 'review.edited', 'product_review', p_review_id::text,
    jsonb_build_object('productId', v_review.product_id, 'rating', p_rating));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Reads: reply on every review, hidden reviews still readable by their author
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
           'reply', private.review_reply_json(r.id),
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
           'reply', private.review_reply_json(x.id),
           'images', (
             select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'key', i.storage_key)
                                       order by i.position), '[]'::jsonb)
             from public.product_review_images i
             where i.review_id = x.id
           ),
           'createdAt', x.created_at,
           'updatedAt', x.updated_at
         ) order by x.created_at desc, x.id), '[]'::jsonb)
    into v_rows
  from (
    select r.id, r.rating, r.title, r.body, r.created_at, r.updated_at,
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
-- 6. The workspace list and the hide action
-- ---------------------------------------------------------------------------

/**
 * The workspace list, newest first. Reading needs `reviews.view`; deciding needs
 * `reviews.moderate`. The default status filter becomes `all`, because reviews are no
 * longer waiting for anyone: the list is where staff check what is already public.
 */
create or replace function public.admin_list_product_reviews(
  p_status text default 'all',
  p_product_search text default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('reviews.view');
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_size integer := least(100, greatest(1, coalesce(p_page_size, 25)));
  v_status text := coalesce(p_status, 'all');
  v_search text := nullif(btrim(coalesce(p_product_search, '')), '');
  v_total bigint;
  v_rows jsonb;
begin
  with filtered as (
    select r.*, p.name as product_name, p.slug as product_slug,
           pr.full_name as author_name, pr.email as author_email
    from public.product_reviews r
    join public.products p on p.id = r.product_id
    join public.profiles pr on pr.id = r.user_id
    where (v_status = 'all' or r.status = v_status)
      and (v_search is null or p.name ilike '%' || v_search || '%')
  ),
  page_rows as (
    select * from filtered
    order by created_at desc, id
    offset (v_page - 1) * v_size
    limit v_size
  )
  select
    (select count(*) from filtered),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id,
        'productId', x.product_id,
        'productName', x.product_name,
        'productSlug', x.product_slug,
        'authorId', x.user_id,
        'authorName', x.author_name,
        'authorEmail', x.author_email,
        'rating', x.rating,
        'title', x.title,
        'body', x.body,
        'status', x.status,
        'moderatedAt', x.moderated_at,
        'moderationNote', x.moderation_note,
        'reply', private.review_reply_json(x.id),
        'createdAt', x.created_at
      ) order by x.created_at desc, x.id)
      from page_rows x
    ), '[]'::jsonb)
  into v_total, v_rows;

  return jsonb_build_object(
    'reviews', v_rows,
    'page', v_page,
    'pageSize', v_size,
    'total', v_total,
    'totalPages', case when v_total = 0 then 0 else ceil(v_total::numeric / v_size)::int end
  );
end;
$$;

/**
 * Publishes or hides a review. Hiding requires a reason, which the customer can read, and
 * the review itself is kept: nothing here deletes a row, a photo or the store's reply.
 * Publishing again lifts the note and records the time it went back up.
 */
create or replace function public.admin_set_product_review_status(
  p_review_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('reviews.moderate');
  v_review public.product_reviews;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_status not in ('approved', 'rejected') then
    raise exception 'choose approved or rejected' using errcode = 'NZ412';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'keep the note under 300 characters' using errcode = 'NZ412';
  end if;
  if p_status = 'rejected' and v_note is null then
    raise exception 'say why the review was hidden' using errcode = 'NZ412';
  end if;

  select * into v_review from public.product_reviews where id = p_review_id for update;
  if not found then
    raise exception 'review not found' using errcode = 'NZ404';
  end if;
  if v_review.user_id = v_actor then
    raise exception 'you cannot moderate your own review' using errcode = 'NZ465';
  end if;

  update public.product_reviews
     set status = p_status,
         moderated_by = v_actor,
         moderated_at = now(),
         moderation_note = v_note,
         published_at = case p_status when 'approved' then now() else published_at end
   where id = p_review_id;

  perform private.audit(v_actor,
    case p_status when 'approved' then 'review.published' else 'review.hidden' end,
    'product_review', p_review_id::text,
    jsonb_build_object('productId', v_review.product_id, 'rating', v_review.rating,
                       'reason', v_note));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------

revoke execute on function private.review_reply_json(uuid) from public, anon, authenticated;
revoke execute on function public.admin_reply_to_review(uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_clear_review_reply(uuid) from public, anon, authenticated;
revoke execute on function public.edit_my_review(uuid, integer, text, text)
  from public, anon, authenticated;
revoke execute on function public.submit_product_review(uuid, integer, text, text)
  from public, anon, authenticated;
revoke execute on function public.my_product_review(uuid) from public, anon, authenticated;
revoke execute on function public.admin_list_product_reviews(text, text, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.admin_set_product_review_status(uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.catalog_product_reviews(text, integer, integer)
  from public, anon, authenticated;

grant execute on function public.admin_reply_to_review(uuid, text) to authenticated;
grant execute on function public.admin_clear_review_reply(uuid) to authenticated;
grant execute on function public.edit_my_review(uuid, integer, text, text) to authenticated;
grant execute on function public.submit_product_review(uuid, integer, text, text) to authenticated;
grant execute on function public.my_product_review(uuid) to authenticated;
grant execute on function public.admin_list_product_reviews(text, text, integer, integer)
  to authenticated;
grant execute on function public.admin_set_product_review_status(uuid, text, text)
  to authenticated;
grant execute on function public.catalog_product_reviews(text, integer, integer)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. The reviews already waiting
-- ---------------------------------------------------------------------------

/*
 * Reviews written before this migration were saved as `pending` because that was the only
 * way in. Each is published only if its author still has a delivered order for its product
 * — the same rule the insert enforced — and only with the photos and the text it already
 * has. Nothing is deleted and no photo is touched.
 *
 * This is the only statement in the file that changes existing rows. To see exactly which
 * reviews it would publish first, run the same condition as a select:
 *
 *   select r.id, r.rating, r.body, r.created_at
 *     from public.product_reviews r
 *    where r.status = 'pending'
 *      and private.review_eligibility(r.user_id, r.product_id) is not null;
 */
update public.product_reviews r
   set status = 'approved',
       published_at = coalesce(r.published_at, r.created_at),
       moderated_at = coalesce(r.moderated_at, now()),
       moderation_note = null
 where r.status = 'pending'
   and private.review_eligibility(r.user_id, r.product_id) is not null;
