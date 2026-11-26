/*
 * Product reviews and ratings
 * ===========================
 * A customer review of a product they bought. Whole-star rating (1-5) plus optional
 * title and text; every review starts `pending` and only an approved one is public.
 *
 * Design notes
 *   - Rating aggregates are never stored. They are counted from approved rows by
 *     `public.catalog_product_reviews`, so approving, rejecting or deleting a review can
 *     never leave a stale average behind, and no client can post an aggregate.
 *   - "Verified purchase" is not a column: eligibility is the rule, checked on insert —
 *     the account must have a *delivered* order containing that product. The public
 *     function reports `verified` from that same order link, so the flag is derived,
 *     never trusted from a request.
 *   - One review per product per customer (unique key). A second attempt raises NZ461
 *     rather than silently replacing the first.
 *   - A moderator may not decide their own review (NZ465), and the database checks the
 *     `reviews.moderate` permission itself.
 *
 * This is separate from content moderation (product/submission reviews in the
 * `moderation_tasks` tables), which is staff-facing and about product content.
 *
 * Purely additive: no existing table, function or policy is touched.
 */

create table public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  /** The delivered order that earns the review; kept for the record and for support. */
  order_id uuid not null references public.orders (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  title text check (title is null or char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 10 and 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  moderated_by uuid references public.profiles (id),
  moderated_at timestamptz,
  /** The moderator's explanation; shown to the customer who wrote the review. */
  moderation_note text check (moderation_note is null or char_length(moderation_note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  /** One review per customer per product. */
  constraint product_reviews_one_per_customer unique (product_id, user_id)
);

create index product_reviews_product_public_idx
  on public.product_reviews (product_id, status, created_at desc);

create index product_reviews_pending_idx
  on public.product_reviews (created_at desc)
  where status = 'pending';

create index product_reviews_customer_idx
  on public.product_reviews (user_id, created_at desc);

create trigger product_reviews_set_updated_at
before update on public.product_reviews
for each row execute function public.set_updated_at();

comment on table public.product_reviews is
  'Customer product reviews. Public reads and writes go through the functions below.';

/*
 * Reviews are personal data (who bought what and what they wrote), so no client role
 * reads the table directly: the public function returns only approved rows with a
 * shortened name, and everything else runs as a security-definer function that checks
 * the caller first.
 */
alter table public.product_reviews enable row level security;

-- ---------------------------------------------------------------------------
-- Eligibility
-- ---------------------------------------------------------------------------

/**
 * The delivered order that lets this customer review this product, or null. A product
 * appears once in an order (the cart forbids repeats), so the newest delivered order is
 * the one recorded with the review.
 */
create function private.review_eligibility(p_user uuid, p_product_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  where o.user_id = p_user
    and oi.product_id = p_product_id
    and o.status = 'delivered'
  order by o.placed_at desc, o.id
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Customer: submit, read own
-- ---------------------------------------------------------------------------

/**
 * Submits a review of a product the caller bought and received. Every review starts
 * pending; the customer cannot set its status, nor claim a purchase they do not have.
 */
create function public.submit_product_review(
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

  insert into public.product_reviews (product_id, user_id, order_id, rating, title, body)
  values (p_product_id, v_user, v_order, p_rating, v_title, v_body)
  returning id into v_id;

  perform private.audit(v_user, 'review.submitted', 'product_review', v_id::text,
    jsonb_build_object('productId', p_product_id, 'rating', p_rating));

  return v_id;
end;
$$;

/** Whether the caller may review this product, and the review they already wrote. */
create function public.my_product_review(p_product_id uuid)
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

-- ---------------------------------------------------------------------------
-- Public: approved reviews and the rating summary
-- ---------------------------------------------------------------------------

/**
 * Approved reviews of one product, newest first, with the rating summary. The reviewer
 * is shown by first name and initial only, which is enough for a human to recognise
 * their own review without publishing a full identity.
 */
create function public.catalog_product_reviews(
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
-- Admin: moderation queue
-- ---------------------------------------------------------------------------

/** The queue, newest first; `p_status` is pending | approved | rejected | all. */
create function public.admin_list_product_reviews(
  p_status text default 'pending',
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
  v_actor uuid := private.require_permission('reviews.moderate');
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_size integer := least(100, greatest(1, coalesce(p_page_size, 25)));
  v_status text := coalesce(p_status, 'pending');
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
 * Approves or rejects a review. Requires `reviews.moderate`, refuses a moderator's own
 * review, and records who decided and why. Approving an already-approved review is a
 * no-op rather than an error, so a double click is harmless.
 */
create function public.admin_set_product_review_status(
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
  if p_status not in ('approved', 'rejected', 'pending') then
    raise exception 'choose approved or rejected' using errcode = 'NZ412';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'keep the note under 300 characters' using errcode = 'NZ412';
  end if;
  if p_status = 'rejected' and v_note is null then
    raise exception 'say why the review was rejected' using errcode = 'NZ412';
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
      moderation_note = v_note
  where id = p_review_id;

  perform private.audit(v_actor,
    case p_status
      when 'approved' then 'review.approved'
      when 'rejected' then 'review.rejected'
      else 'review.returned'
    end,
    'product_review', p_review_id::text,
    jsonb_build_object('productId', v_review.product_id, 'rating', v_review.rating));
end;
$$;

revoke execute on function public.submit_product_review(uuid, integer, text, text)
  from public, anon, authenticated;
revoke execute on function public.my_product_review(uuid) from public, anon, authenticated;
revoke execute on function public.admin_list_product_reviews(text, text, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.admin_set_product_review_status(uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.catalog_product_reviews(text, integer, integer)
  from public, anon, authenticated;

grant execute on function public.submit_product_review(uuid, integer, text, text) to authenticated;
grant execute on function public.my_product_review(uuid) to authenticated;
grant execute on function public.admin_list_product_reviews(text, text, integer, integer)
  to authenticated;
grant execute on function public.admin_set_product_review_status(uuid, text, text)
  to authenticated;
grant execute on function public.catalog_product_reviews(text, integer, integer)
  to anon, authenticated, service_role;
