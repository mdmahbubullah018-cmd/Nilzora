-- Was this review helpful?
-- -----------------------
-- A review has had a public answer since 20261208090000. What it never had was the second
-- signal a shop actually needs: whether other customers found it useful. This adds it, and it
-- adds nothing else — no column on the review, no change to how a review is written.
--
-- The vote is a row, not a counter, because two rules can only be enforced on rows:
--
--   * one verdict per account per review (the primary key), so pressing the button twice cannot
--     inflate a number, and changing your mind replaces your verdict rather than adding one;
--   * you cannot vote on your own review (checked in the function, which is the only writer).
--
-- Counts are read through a function rather than stored, so they can never drift from the votes
-- they describe. Nothing here deletes or rewrites an existing review.

create table public.product_review_votes (
  review_id uuid not null references public.product_reviews (id) on delete cascade,
  voter_id uuid not null references public.profiles (id) on delete cascade,
  /** True for "helpful", false for "not helpful". */
  helpful boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (review_id, voter_id)
);

comment on table public.product_review_votes is
  'One customer''s helpful / not-helpful verdict on one review. Written only by vote_product_review.';

comment on column public.product_review_votes.helpful is
  'True means "helpful", false means "not helpful". A customer who withdraws their vote has no row.';

create index product_review_votes_review_idx
  on public.product_review_votes (review_id, helpful);

create trigger product_review_votes_set_updated_at
before update on public.product_review_votes
for each row execute function public.set_updated_at();

/* Personal data about the voter: a client may never read the rows, only the totals. */
alter table public.product_review_votes enable row level security;

/**
 * Records, changes or withdraws the caller's verdict on one review.
 *
 * `p_helpful` is deliberately nullable: null is how a customer takes their vote back, which is
 * the third action the button offers. A review nobody may see cannot be voted on, and a customer
 * cannot vote on their own review — that would be self-praise dressed as consensus.
 */
create function public.vote_product_review(p_review_id uuid, p_helpful boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_author uuid;
  v_status text;
begin
  if v_user is null then
    raise exception 'sign in to rate a review' using errcode = 'NZ401';
  end if;

  select r.user_id, r.status into v_author, v_status
  from public.product_reviews r
  where r.id = p_review_id;
  if not found then
    raise exception 'review not found' using errcode = 'NZ404';
  end if;
  if v_status <> 'approved' then
    raise exception 'this review is not published' using errcode = 'NZ412';
  end if;
  if v_author = v_user then
    raise exception 'you cannot vote on your own review' using errcode = 'NZ465';
  end if;

  if p_helpful is null then
    delete from public.product_review_votes v
    where v.review_id = p_review_id and v.voter_id = v_user;
  else
    insert into public.product_review_votes (review_id, voter_id, helpful)
    values (p_review_id, v_user, p_helpful)
    on conflict (review_id, voter_id) do update
      set helpful = excluded.helpful,
          updated_at = now();
  end if;

  return (
    select jsonb_build_object(
      'reviewId', p_review_id,
      'helpfulCount', count(*) filter (where v.helpful),
      'notHelpfulCount', count(*) filter (where not v.helpful),
      'viewerVote', case
        when not exists (
          select 1 from public.product_review_votes m
          where m.review_id = p_review_id and m.voter_id = v_user
        ) then null
        else (
          select case when m.helpful then 'helpful' else 'not_helpful' end
          from public.product_review_votes m
          where m.review_id = p_review_id and m.voter_id = v_user
        )
      end
    )
    from public.product_review_votes v
    where v.review_id = p_review_id
  );
end;
$$;

comment on function public.vote_product_review(uuid, boolean) is
  'Records, changes or withdraws (null) the caller''s helpful / not-helpful verdict on one published review.';

/**
 * The totals for a page of reviews, in one call.
 *
 * The public review list is readable by anyone, so this has to answer without an account: an
 * anonymous reader gets the two counts and `viewerVote = null`, and never learns who voted.
 * Passing no ids answers with nothing rather than with the whole table.
 */
create function public.review_vote_summaries(p_review_ids uuid[])
returns table (
  review_id uuid,
  helpful_count bigint,
  not_helpful_count bigint,
  viewer_vote text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_ids uuid[] := coalesce(p_review_ids, array[]::uuid[]);
begin
  if cardinality(v_ids) = 0 then
    return;
  end if;
  if cardinality(v_ids) > 100 then
    raise exception 'ask for at most 100 reviews' using errcode = 'NZ412';
  end if;

  return query
  select
    v.review_id,
    count(*) filter (where v.helpful),
    count(*) filter (where not v.helpful),
    case
      when v_user is null then null
      else (
        select case when m.helpful then 'helpful' else 'not_helpful' end
        from public.product_review_votes m
        where m.review_id = v.review_id and m.voter_id = v_user
      )
    end
  from public.product_review_votes v
  where v.review_id = any (v_ids)
  group by v.review_id;
end;
$$;

comment on function public.review_vote_summaries(uuid[]) is
  'Helpful / not-helpful totals for a page of reviews, with the caller''s own verdict when they have one.';

revoke execute on function public.vote_product_review(uuid, boolean) from public, anon;
grant execute on function public.vote_product_review(uuid, boolean) to authenticated;

revoke execute on function public.review_vote_summaries(uuid[]) from public;
grant execute on function public.review_vote_summaries(uuid[]) to anon, authenticated;
