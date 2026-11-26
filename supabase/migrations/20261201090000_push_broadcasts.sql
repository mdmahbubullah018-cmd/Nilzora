-- ---------------------------------------------------------------------------
-- Push broadcasts: an announcement written by staff
--
-- Reuses the product-announcement outbox (20261118090000) instead of a second pipeline: a
-- broadcast is an announcement of kind 'broadcast' with its own title and body, optionally
-- linking to a product the app already knows how to open. It goes to exactly the audience
-- product announcements reach (customers with a live device that opted in to promotional
-- messages), one claimable delivery row per customer, with the same retries, the same dead-
-- token handling and nothing sent from inside the database.
--
-- Safety: a new permission, notifications.broadcast (owner and admin by default); at most
-- one broadcast per 10 minutes for the whole store; every broadcast is audited.
--
-- Changes: product_announcements gains nullable/optional columns (existing rows become kind
-- 'product'); claim_announcement_deliveries is dropped and recreated because its result
-- gains columns (same arguments, same grants). Nothing is deleted.
-- ---------------------------------------------------------------------------

insert into public.permissions (name, description) values
  ('notifications.broadcast', 'Send a push message to every customer who opted in');

insert into public.role_permissions (role, permission) values
  ('admin'::public.app_role, 'notifications.broadcast'),
  ('super_admin'::public.app_role, 'notifications.broadcast');

alter table public.product_announcements
  alter column product_id drop not null,
  add column kind text not null default 'product' check (kind in ('product', 'broadcast')),
  add column title text check (title is null or char_length(title) between 1 and 65),
  add column body text check (body is null or char_length(body) between 1 and 240),
  add column created_by uuid references public.profiles (id) on delete set null,
  add constraint product_announcements_kind_fields check (
    (kind = 'product' and product_id is not null)
    or (kind = 'broadcast' and title is not null and body is not null)
  );

create index product_announcements_broadcast_idx
  on public.product_announcements (created_at desc) where kind = 'broadcast';

-- ---------------------------------------------------------------------------
-- Sending one
-- ---------------------------------------------------------------------------

/**
 * Queues a broadcast for every customer with an opted-in, live device. Answers its id and
 * how many customers it will reach. Refused (NZ442) within 10 minutes of the last one.
 */
create function public.admin_create_broadcast(
  p_title text,
  p_body text,
  p_product_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('notifications.broadcast');
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_product public.products;
  v_id uuid;
  v_recipients integer;
begin
  if char_length(v_title) not between 1 and 65 or char_length(v_body) not between 1 and 240 then
    raise exception 'a title of 1-65 and a message of 1-240 characters' using errcode = 'NZ412';
  end if;
  if p_product_id is not null then
    select * into v_product from public.products
    where id = p_product_id and status = 'active' and moderation_status = 'approved';
    if not found then
      raise exception 'link a product that is on sale' using errcode = 'NZ412';
    end if;
  end if;

  -- One store-wide broadcast at a time: serialise on the table, then check the last one.
  lock table public.product_announcements in share row exclusive mode;
  if exists (
    select 1 from public.product_announcements
    where kind = 'broadcast' and created_at > now() - interval '10 minutes'
  ) then
    raise exception 'wait 10 minutes between broadcasts' using errcode = 'NZ442';
  end if;

  insert into public.product_announcements
    (kind, product_id, published_at, product_name, product_slug, image_key, title, body, created_by)
  values
    ('broadcast', v_product.id, now(), v_title, coalesce(v_product.slug, ''), null, v_title, v_body, v_actor)
  returning id into v_id;

  insert into public.product_announcement_deliveries (announcement_id, user_id)
  select v_id, t.user_id
  from public.deliverable_device_tokens() t
  join public.device_tokens d on d.id = t.id
  join public.user_roles r on r.user_id = t.user_id and r.role = 'customer'
  where d.promotional_opt_in
  group by t.user_id
  on conflict (announcement_id, user_id) do nothing;
  get diagnostics v_recipients = row_count;

  perform private.audit(v_actor, 'notification.broadcast', 'announcement', v_id::text,
    jsonb_build_object('recipients', v_recipients, 'linksProduct', p_product_id is not null));
  return jsonb_build_object('id', v_id, 'recipients', v_recipients);
end;
$$;

/** The latest broadcasts with their delivery figures (newest first, at most 50). */
create function public.admin_list_broadcasts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('notifications.broadcast');
begin
  return coalesce((
    select jsonb_agg(row order by created_at desc)
    from (
      select a.created_at, jsonb_build_object(
        'id', a.id,
        'title', a.title,
        'body', a.body,
        'productSlug', nullif(a.product_slug, ''),
        'createdAt', a.created_at,
        'author', p.full_name,
        'recipients', count(d.id),
        'sent', count(d.id) filter (where d.status = 'sent'),
        'pending', count(d.id) filter (where d.status in ('pending', 'sending')),
        'failed', count(d.id) filter (where d.status = 'failed'),
        'skipped', count(d.id) filter (where d.status = 'skipped')
      ) as row
      from public.product_announcements a
      left join public.profiles p on p.id = a.created_by
      left join public.product_announcement_deliveries d on d.announcement_id = a.id
      where a.kind = 'broadcast'
      group by a.id, p.full_name
      order by a.created_at desc
      limit 50
    ) listed
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.admin_create_broadcast(text, text, uuid) from public, anon;
revoke execute on function public.admin_list_broadcasts() from public, anon;
grant execute on function public.admin_create_broadcast(text, text, uuid) to authenticated, service_role;
grant execute on function public.admin_list_broadcasts() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The worker's claim now carries the kind and, for a broadcast, its own words
-- ---------------------------------------------------------------------------

drop function public.claim_announcement_deliveries(integer, integer);

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
  attempts integer,
  kind text,
  title text,
  body text
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
    returning x.id, x.user_id, x.announcement_id, x.attempts, x.status
  )
  select c.id, c.user_id, a.product_name, a.product_slug, a.image_key, c.attempts,
         a.kind, a.title, a.body
  from claimed c
  join public.product_announcements a on a.id = c.announcement_id
  where c.status = 'sending';
end;
$$;

revoke execute on function public.claim_announcement_deliveries(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_announcement_deliveries(integer, integer) to service_role;
