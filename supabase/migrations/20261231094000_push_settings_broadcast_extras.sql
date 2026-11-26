-- Push: automatic product announcements get a switch and a message template; broadcasts get a
-- picture, a link to any store page and an optional send time.
--
-- Additive: one new single-row settings table and two nullable columns on the announcement
-- outbox. Existing announcements, deliveries and the one-per-publication rule are untouched.
-- Two functions are replaced because their shape grows: admin_create_broadcast gains three
-- optional arguments (the old three-argument form is dropped and re-granted; behaviour is the
-- same when they are omitted) and claim_announcement_deliveries gains a link_path column
-- (dropped and recreated with the same arguments and grants, as 20261201090000 did before it).

create table public.push_settings (
  id boolean primary key default true check (id),
  auto_announce_products boolean not null default true,
  product_title_template text not null default 'New at Nilzora'
    check (char_length(btrim(product_title_template)) between 1 and 65),
  product_body_template text not null default 'Discover {name} — now available.'
    check (char_length(btrim(product_body_template)) between 1 and 240),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.push_settings (id) values (true);
alter table public.push_settings enable row level security;
revoke all on table public.push_settings from public, anon, authenticated;
grant select on table public.push_settings to service_role;

comment on table public.push_settings is
  'One row. Whether a newly published product is announced automatically, and the words used ({name} is the product name).';

alter table public.product_announcements
  add column link_path text check (
    link_path is null
    or (link_path ~ '^/[A-Za-z0-9/_?=&%.~-]{0,199}$' and link_path not like '%//%')
  ),
  add column scheduled_for timestamptz;

create function public.admin_get_push_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('notifications.broadcast');
  return (
    select jsonb_build_object(
      'autoAnnounceProducts', s.auto_announce_products,
      'productTitleTemplate', s.product_title_template,
      'productBodyTemplate', s.product_body_template,
      'updatedAt', s.updated_at
    )
    from public.push_settings s
  );
end;
$$;

create function public.admin_save_push_settings(
  p_auto_announce boolean,
  p_title_template text,
  p_body_template text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('notifications.broadcast');
  v_title text := btrim(coalesce(p_title_template, ''));
  v_body text := btrim(coalesce(p_body_template, ''));
begin
  if char_length(v_title) not between 1 and 65 or char_length(v_body) not between 1 and 240 then
    raise exception 'a title of 1-65 and a message of 1-240 characters' using errcode = 'NZ412';
  end if;
  update public.push_settings
     set auto_announce_products = coalesce(p_auto_announce, true),
         product_title_template = v_title,
         product_body_template = v_body,
         updated_by = v_actor,
         updated_at = now()
   where id;
  perform private.audit(v_actor, 'notification.push_settings', 'push_settings', 'singleton',
    jsonb_build_object('autoAnnounce', coalesce(p_auto_announce, true)));
  return public.admin_get_push_settings();
end;
$$;

revoke execute on function public.admin_get_push_settings() from public, anon;
revoke execute on function public.admin_save_push_settings(boolean, text, text) from public, anon;
grant execute on function public.admin_get_push_settings() to authenticated, service_role;
grant execute on function public.admin_save_push_settings(boolean, text, text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION private.enqueue_product_announcement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_announcement uuid;
  v_image text;
  v_enabled boolean;
  v_title_template text;
  v_body_template text;
begin
  -- Only the transition into "on sale, approved" announces anything: creating a draft,
  -- editing one, submitting it for review, archiving it or saving it again does not.
  if new.status <> 'active' or new.moderation_status <> 'approved' then
    return null;
  end if;
  -- The store can switch automatic product announcements off.
  select s.auto_announce_products, s.product_title_template, s.product_body_template
    into v_enabled, v_title_template, v_body_template
  from public.push_settings s;
  if not coalesce(v_enabled, true) then
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

  insert into public.product_announcements
    (product_id, published_at, product_name, product_slug, image_key, title, body)
  values (
    new.id, coalesce(new.published_at, now()), new.name, new.slug, v_image,
    left(replace(coalesce(v_title_template, 'New at Nilzora'), '{name}', new.name), 65),
    left(replace(coalesce(v_body_template, 'Discover {name} — now available.'), '{name}', new.name), 240)
  )
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
$function$;

drop function public.claim_announcement_deliveries(integer, integer);

CREATE OR REPLACE FUNCTION public.claim_announcement_deliveries(p_limit integer DEFAULT 20, p_lease_seconds integer DEFAULT 60)
 RETURNS TABLE(id uuid, user_id uuid, product_name text, product_slug text, image_key text, attempts integer, kind text, title text, body text, link_path text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
         a.kind, a.title, a.body, a.link_path
  from claimed c
  join public.product_announcements a on a.id = c.announcement_id
  where c.status = 'sending';
end;
$function$;

revoke execute on function public.claim_announcement_deliveries(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_announcement_deliveries(integer, integer) to service_role;

CREATE OR REPLACE FUNCTION public.admin_list_broadcasts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        'linkPath', a.link_path,
        'imageKey', a.image_key,
        'scheduledFor', a.scheduled_for,
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
$function$;

drop function public.admin_create_broadcast(text, text, uuid);

CREATE OR REPLACE FUNCTION public.admin_create_broadcast(p_title text, p_body text, p_product_id uuid DEFAULT NULL::uuid, p_image_key text DEFAULT NULL::text, p_link_path text DEFAULT NULL::text, p_scheduled_for timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if p_image_key is not null and p_image_key !~ '^(products|categories|seo|brand|library)/[A-Za-z0-9/_-]{1,172}$' then
    raise exception 'unusable picture' using errcode = 'NZ412';
  end if;
  if p_link_path is not null and (p_link_path !~ '^/[A-Za-z0-9/_?=&%.~-]{0,199}$' or p_link_path like '%//%') then
    raise exception 'link to a page inside the store' using errcode = 'NZ412';
  end if;
  if p_scheduled_for is not null and (p_scheduled_for < now() - interval '1 minute' or p_scheduled_for > now() + interval '30 days') then
    raise exception 'schedule within the next 30 days' using errcode = 'NZ412';
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
    (kind, product_id, published_at, product_name, product_slug, image_key, title, body, created_by,
     link_path, scheduled_for)
  values
    ('broadcast', v_product.id, now(), v_title, coalesce(v_product.slug, ''), p_image_key, v_title, v_body, v_actor,
     p_link_path, p_scheduled_for)
  returning id into v_id;

  insert into public.product_announcement_deliveries (announcement_id, user_id, next_attempt_at)
  select v_id, t.user_id, coalesce(p_scheduled_for, now())
  from public.deliverable_device_tokens() t
  join public.device_tokens d on d.id = t.id
  join public.user_roles r on r.user_id = t.user_id and r.role = 'customer'
  where d.promotional_opt_in
  group by t.user_id
  on conflict (announcement_id, user_id) do nothing;
  get diagnostics v_recipients = row_count;

  perform private.audit(v_actor, 'notification.broadcast', 'announcement', v_id::text,
    jsonb_build_object('recipients', v_recipients, 'linksProduct', p_product_id is not null,
                       'hasImage', p_image_key is not null, 'scheduled', p_scheduled_for is not null));
  return jsonb_build_object('id', v_id, 'recipients', v_recipients);
end;
$function$;

revoke execute on function public.admin_create_broadcast(text, text, uuid, text, text, timestamptz) from public, anon;
grant execute on function public.admin_create_broadcast(text, text, uuid, text, text, timestamptz) to authenticated, service_role;
