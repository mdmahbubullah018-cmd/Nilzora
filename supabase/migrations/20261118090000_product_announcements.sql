-- Product announcements: a newly published product reaches the customers who asked for it.
--
-- Same shape as the order-notification outbox (20261027090000_notification_outbox.sql), for
-- the same reasons: the row is written in the transaction that publishes the product, nothing
-- is sent from the database, and a slow or failing push can never affect the publication.
-- Unlike order updates, one event has many recipients, so the work is split into one claimable
-- row per recipient: bounded retries, no fan-out at send time, and no duplicate per customer.
--
-- Nothing here reads Redis. The API's worker claims rows with SELECT ... FOR UPDATE SKIP LOCKED
-- on a timer, which needs no queue and no extra connection.

create table public.product_announcements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  -- The instant the product first went on sale. `products.published_at` is set once, so a
  -- draft edit, a re-save or a retried transition can never announce the same product twice.
  published_at timestamptz not null,
  -- A copy: the announcement keeps the name and picture of the moment it was published.
  product_name text not null,
  product_slug text not null,
  -- Base key in the media bucket ({key}/thumb.webp). The API resolves it to a public URL;
  -- a storage key never leaves the server.
  image_key text,
  created_at timestamptz not null default now(),
  unique (product_id, published_at)
);

comment on table public.product_announcements is
  'One row per product publication that should be announced. Written by the products trigger, read only by the notification worker.';

create table public.product_announcement_deliveries (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.product_announcements (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status public.notification_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text check (last_error is null or last_error ~ '^[a-z0-9_]{1,64}$'),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  -- One announcement per customer, however often the event is delivered again.
  unique (announcement_id, user_id)
);

comment on table public.product_announcement_deliveries is
  'One claimable row per customer for a product announcement: the promise that a customer is told once, and retried only while that is still true.';
comment on column public.product_announcement_deliveries.last_error is
  'A short machine code for the last failure; never a token, message or personal data.';

create index product_announcement_deliveries_due_idx
  on public.product_announcement_deliveries (next_attempt_at)
  where status in ('pending', 'sending');
create index product_announcement_deliveries_user_idx
  on public.product_announcement_deliveries (user_id);
create index product_announcements_product_idx
  on public.product_announcements (product_id);

alter table public.product_announcements enable row level security;
alter table public.product_announcement_deliveries enable row level security;
-- No policies: like the order outbox, both tables are reachable only by the service role.

-- ---------------------------------------------------------------------------
-- Device preference: a customer opts in to product announcements per device
-- ---------------------------------------------------------------------------

alter table public.device_tokens
  add column promotional_opt_in boolean not null default false;

comment on column public.device_tokens.promotional_opt_in is
  'The customer turned product announcements on for this device. Off by default, and never changed by registering the token again.';

/**
 * Sets the caller's own opt-in for one of their tokens. Returns the stored value. A token that
 * is not the caller's is not an error and changes nothing, so the call cannot be used to probe
 * which tokens exist.
 */
create function public.set_device_announcements(p_token text, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_enabled boolean := coalesce(p_enabled, false);
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = 'NZ401';
  end if;
  if p_token is null or char_length(p_token) not between 20 and 1024 then
    raise exception 'invalid token' using errcode = 'NZ412';
  end if;

  update public.device_tokens
  set promotional_opt_in = v_enabled, last_seen_at = clock_timestamp()
  where token = p_token and user_id = v_user;

  return v_enabled;
end;
$$;

revoke execute on function public.set_device_announcements(text, boolean) from public, anon;
grant execute on function public.set_device_announcements(text, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enqueue: a product becomes publicly available
-- ---------------------------------------------------------------------------

create function private.enqueue_product_announcement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_announcement uuid;
  v_image text;
begin
  -- Only the transition into "on sale, approved" announces anything: creating a draft,
  -- editing one, submitting it for review, archiving it or saving it again does not.
  if new.status <> 'active' or new.moderation_status <> 'approved' then
    return null;
  end if;
  if old.status = 'active' and old.moderation_status = 'approved' then
    return null;
  end if;

  select pi.storage_key into v_image
  from public.product_images pi
  where pi.product_id = new.id
  order by pi.position
  limit 1;

  insert into public.product_announcements (product_id, published_at, product_name, product_slug, image_key)
  values (new.id, coalesce(new.published_at, now()), new.name, new.slug, v_image)
  on conflict (product_id, published_at) do nothing
  returning id into v_announcement;

  -- Already announced (the trigger ran twice for one publication): nothing to queue.
  if v_announcement is null then
    return null;
  end if;

  insert into public.product_announcement_deliveries (announcement_id, user_id)
  select v_announcement, t.user_id
  from public.deliverable_device_tokens() t
  join public.device_tokens d on d.id = t.id
  where d.promotional_opt_in
  group by t.user_id
  on conflict (announcement_id, user_id) do nothing;

  return null;
end;
$$;

create trigger products_enqueue_announcement
  after insert or update of status, moderation_status on public.products
  for each row execute function private.enqueue_product_announcement();

-- ---------------------------------------------------------------------------
-- Worker interface (service role only)
-- ---------------------------------------------------------------------------

/**
 * Takes up to p_limit due deliveries for the caller: pending rows whose time has come, and
 * rows another worker claimed but never finished once their lease ran out. Rows of accounts
 * that are not active are marked skipped instead of being returned.
 */
create function public.claim_announcement_deliveries(
  p_limit integer default 20,
  p_lease_seconds integer default 60
)
returns table (
  id uuid,
  user_id uuid,
  product_name text,
  product_slug text,
  image_key text,
  attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit not between 1 and 100
     or p_lease_seconds is null or p_lease_seconds not between 5 and 3600 then
    raise exception 'limit must be 1-100 and lease 5-3600 seconds' using errcode = 'NZ412';
  end if;

  return query
  with due as (
    select x.id, x.user_id
    from public.product_announcement_deliveries x
    where x.next_attempt_at <= now()
      and (x.status = 'pending' or (x.status = 'sending' and x.locked_until <= now()))
    order by x.next_attempt_at, x.created_at, x.id
    limit p_limit
    for update of x skip locked
  ),
  claimed as (
    update public.product_announcement_deliveries x
    set status = case when p.status = 'active' then 'sending'::public.notification_status
                      else 'skipped'::public.notification_status end,
        locked_until = case when p.status = 'active' then now() + make_interval(secs => p_lease_seconds) end,
        attempts = x.attempts + case when p.status = 'active' then 1 else 0 end,
        last_error = case when p.status = 'active' then x.last_error else 'account_inactive' end
    from due
    join public.profiles p on p.id = due.user_id
    where x.id = due.id
    returning x.id, x.user_id, x.attempts, x.status
  )
  select c.id, c.user_id, a.product_name, a.product_slug, a.image_key, c.attempts
  from claimed c
  join public.product_announcements a on a.id = c.announcement_id
  where c.status = 'sending';
end;
$$;

/** Records what happened to one delivery: sent, to be retried at p_retry_seconds, failed or skipped. */
create function public.finish_announcement_delivery(
  p_id uuid,
  p_outcome text,
  p_retry_seconds integer default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_outcome not in ('sent', 'retry', 'failed', 'skipped') then
    raise exception 'invalid outcome' using errcode = 'NZ412';
  end if;
  if p_error is not null and p_error !~ '^[a-z0-9_]{1,64}$' then
    raise exception 'invalid error code' using errcode = 'NZ412';
  end if;

  update public.product_announcement_deliveries
  set status = case p_outcome
                 when 'sent' then 'sent'::public.notification_status
                 when 'retry' then 'pending'::public.notification_status
                 when 'failed' then 'failed'::public.notification_status
                 else 'skipped'::public.notification_status
               end,
      next_attempt_at = case when p_outcome = 'retry'
                             then now() + make_interval(secs => greatest(coalesce(p_retry_seconds, 30), 1))
                             else next_attempt_at end,
      locked_until = null,
      last_error = case when p_outcome = 'sent' then null else p_error end,
      sent_at = case when p_outcome = 'sent' then now() else sent_at end
  where id = p_id;
end;
$$;

revoke execute on function public.claim_announcement_deliveries(integer, integer) from public, anon, authenticated;
revoke execute on function public.finish_announcement_delivery(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.claim_announcement_deliveries(integer, integer) to service_role;
grant execute on function public.finish_announcement_delivery(uuid, text, integer, text) to service_role;
