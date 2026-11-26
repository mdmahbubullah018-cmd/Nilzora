-- ---------------------------------------------------------------------------
-- Phase 3: SEO, store profile, staff notifications and customer insight
--
-- Additive only: no existing table is replaced and no existing function changes
-- shape. SEO lives beside the catalog rows it describes, the public store profile
-- is a separate table from the private store_settings, staff notifications are
-- addressed by recipient or by the permission that may see them, and customer
-- spending is derived from orders and completed refunds rather than stored.
--
-- SQLSTATEs: NZ494 seo_target_missing, NZ495 store_profile_invalid,
--            NZ496 notification_not_found.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. SEO on the catalog
-- ---------------------------------------------------------------------------

alter table public.products
  add column seo_title text
    check (seo_title is null or char_length(btrim(seo_title)) between 1 and 70),
  add column seo_description text
    check (seo_description is null or char_length(btrim(seo_description)) between 1 and 200),
  add column og_title text
    check (og_title is null or char_length(btrim(og_title)) between 1 and 90),
  add column og_description text
    check (og_description is null or char_length(btrim(og_description)) between 1 and 300),
  -- A media key the existing media pipeline produced, never a full URL.
  add column og_image_key text
    check (og_image_key is null or og_image_key ~ '^(products|categories|seo)/[A-Za-z0-9/_-]{1,160}$'),
  -- Only a same-site path: an override can never point at another domain.
  add column canonical_path text
    check (canonical_path is null or (canonical_path ~ '^/[A-Za-z0-9/_?=&%.-]{0,159}$'
      and position('//' in canonical_path) = 0)),
  add column no_index boolean not null default false;

alter table public.categories
  add column seo_title text
    check (seo_title is null or char_length(btrim(seo_title)) between 1 and 70),
  add column seo_description text
    check (seo_description is null or char_length(btrim(seo_description)) between 1 and 200),
  add column og_title text
    check (og_title is null or char_length(btrim(og_title)) between 1 and 90),
  add column og_description text
    check (og_description is null or char_length(btrim(og_description)) between 1 and 300),
  add column og_image_key text
    check (og_image_key is null or og_image_key ~ '^(products|categories|seo)/[A-Za-z0-9/_-]{1,160}$'),
  add column canonical_path text
    check (canonical_path is null or (canonical_path ~ '^/[A-Za-z0-9/_?=&%.-]{0,159}$'
      and position('//' in canonical_path) = 0)),
  add column no_index boolean not null default false;

comment on column public.products.seo_title is
  'Search title for the public product page. Null falls back to the product name.';
comment on column public.products.canonical_path is
  'Optional same-site canonical override. Null uses the product''s own path.';

-- ---------------------------------------------------------------------------
-- 2. Public store profile (separate from the private store_settings)
-- ---------------------------------------------------------------------------

create table public.store_profile (
  id boolean primary key default true check (id),
  display_name text not null default 'Nilzora'
    check (char_length(btrim(display_name)) between 1 and 80),
  tagline text check (tagline is null or char_length(btrim(tagline)) <= 160),
  description text check (description is null or char_length(description) <= 1000),
  logo_key text
    check (logo_key is null or logo_key ~ '^(brand|seo)/[A-Za-z0-9/_-]{1,160}$'),
  contact_email text
    check (contact_email is null or contact_email ~ '^[^@\s]{1,60}@[^@\s]{3,80}$'),
  contact_phone text check (contact_phone is null or char_length(btrim(contact_phone)) <= 32),
  address_line text check (address_line is null or char_length(btrim(address_line)) <= 200),
  address_area text check (address_area is null or char_length(btrim(address_area)) <= 120),
  address_district text check (address_district is null or char_length(btrim(address_district)) <= 120),
  business_hours text check (business_hours is null or char_length(btrim(business_hours)) <= 200),
  support_email text
    check (support_email is null or support_email ~ '^[^@\s]{1,60}@[^@\s]{3,80}$'),
  support_phone text check (support_phone is null or char_length(btrim(support_phone)) <= 32),
  /** Named profiles only: free text would invite invented networks. */
  social_facebook text check (social_facebook is null or social_facebook ~ '^https://[a-z.]*facebook\.com/[A-Za-z0-9._-]{1,80}$'),
  social_instagram text check (social_instagram is null or social_instagram ~ '^https://[a-z.]*instagram\.com/[A-Za-z0-9._-]{1,80}$'),
  social_youtube text check (social_youtube is null or social_youtube ~ '^https://[a-z.]*youtube\.com/[A-Za-z0-9@._/-]{1,120}$'),
  default_seo_title text
    check (default_seo_title is null or char_length(btrim(default_seo_title)) between 1 and 70),
  default_seo_description text
    check (default_seo_description is null or char_length(btrim(default_seo_description)) between 1 and 200),
  og_image_key text
    check (og_image_key is null or og_image_key ~ '^(brand|seo)/[A-Za-z0-9/_-]{1,160}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

comment on table public.store_profile is
  'The store''s public face: what a customer may see. Private operational settings stay in store_settings.';

insert into public.store_profile (id) values (true);

alter table public.store_profile enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Insight thresholds (private, alongside the other store settings)
-- ---------------------------------------------------------------------------

alter table public.store_settings
  add column repeat_order_threshold integer not null default 2
    check (repeat_order_threshold between 2 and 20),
  add column high_spend_threshold_minor bigint not null default 500000
    check (high_spend_threshold_minor between 1 and 1000000000),
  add column inactive_days integer not null default 60
    check (inactive_days between 7 and 730);

-- ---------------------------------------------------------------------------
-- 4. Staff notifications
-- ---------------------------------------------------------------------------

create type public.staff_notification_kind as enum (
  'order_new',
  'stock_low',
  'return_new',
  'refund_action',
  'moderation_pending'
);

create table public.staff_notifications (
  id uuid primary key default gen_random_uuid(),
  /** Set for one named recipient; null when the notification is addressed by permission. */
  recipient_id uuid references public.profiles (id) on delete cascade,
  /** Set when every account holding this permission may see it. */
  audience_permission text,
  kind public.staff_notification_kind not null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text check (body is null or char_length(body) <= 500),
  /** The entity the notification is about, for the link the Admin inbox draws. */
  entity_type text not null check (entity_type in ('order', 'product', 'return', 'refund')),
  entity_id text not null check (char_length(entity_id) between 1 and 80),
  /** Where staff act on it, always a same-site Admin path. */
  action_path text check (action_path is null or action_path ~ '^/admin/[A-Za-z0-9/_?=&%.-]{0,159}$'),
  /**
   * Stable per event, so a retried trigger or a replayed event cannot create a second
   * notification for the same business fact.
   */
  dedupe_key text not null unique check (char_length(dedupe_key) between 1 and 120),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint staff_notifications_one_audience check (
    (recipient_id is null) <> (audience_permission is null)
  )
);

comment on table public.staff_notifications is
  'In-app notifications for staff and admins. One row per business event, addressed to a person or to a permission.';

create index staff_notifications_recipient_idx
  on public.staff_notifications (recipient_id, created_at desc);
create index staff_notifications_audience_idx
  on public.staff_notifications (audience_permission, created_at desc);
create index staff_notifications_unread_idx
  on public.staff_notifications (created_at desc) where read_at is null;

alter table public.staff_notifications enable row level security;

/** Whether the caller holds a permission; unlike require_permission it never raises. */
create function private.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.permissions_of((select auth.uid())) as x (name)
    where x.name = p_permission
  );
$$;

revoke execute on function private.has_permission(text) from public, anon, authenticated;

/** One notification, written by the triggers below. Duplicates are dropped by dedupe_key. */
create function private.notify_staff(
  p_kind public.staff_notification_kind,
  p_audience_permission text,
  p_title text,
  p_body text,
  p_entity_type text,
  p_entity_id text,
  p_action_path text,
  p_dedupe_key text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.staff_notifications (
    audience_permission, kind, title, body, entity_type, entity_id, action_path, dedupe_key
  )
  values (
    p_audience_permission, p_kind, p_title, p_body,
    p_entity_type, p_entity_id, p_action_path, p_dedupe_key
  )
  on conflict (dedupe_key) do nothing;
$$;

revoke execute on function private.notify_staff(
  public.staff_notification_kind, text, text, text, text, text, text, text
) from public, anon, authenticated;

-- A new order is the queue's most time-sensitive event.
create function private.notify_new_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.notify_staff(
    'order_new',
    'orders.read',
    'New order ' || new.order_number,
    format('A %s order for %s poisha is waiting for confirmation.',
      new.payment_method, new.total_minor),
    'order',
    new.id::text,
    '/admin/orders/' || new.order_number,
    'order_new:' || new.id::text
  );
  return new;
end;
$$;

create trigger orders_notify_staff
after insert on public.orders
for each row execute function private.notify_new_order();

-- A return request staff have to decide.
create function private.notify_new_return()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number text;
begin
  select order_number into v_number from public.orders where id = new.order_id;
  perform private.notify_staff(
    'return_new',
    'orders.read',
    'Return requested',
    'A customer asked to send items back from order ' || coalesce(v_number, ''),
    'return',
    new.id::text,
    '/admin/returns/' || new.id::text,
    'return_new:' || new.id::text
  );
  return new;
end;
$$;

create trigger return_requests_notify_staff
after insert on public.return_requests
for each row execute function private.notify_new_return();

-- A refund that needs a decision, or (once approved) the payout that needs recording.
create function private.notify_refund_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number text;
begin
  select order_number into v_number from public.orders where id = new.order_id;
  perform private.notify_staff(
    'refund_action',
    case when new.status = 'approved' then 'refunds.approve' else 'refunds.request' end,
    case
      when new.status = 'approved' then 'Refund approved — record the payout'
      else 'Refund needs a decision'
    end,
    format('%s poisha for order %s.', new.amount_minor, coalesce(v_number, '')),
    'refund',
    new.id::text,
    '/admin/refunds/' || new.id::text,
    -- One notification per refund per stage, so a replayed update adds nothing.
    'refund_' || new.status::text || ':' || new.id::text
  );
  return new;
end;
$$;

create trigger refunds_notify_staff
after insert or update of status on public.refunds
for each row execute function private.notify_refund_action();

-- Low stock, recorded once per product each time it drops to the threshold.
create function private.notify_low_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and new.stock_quantity <= 5
     and (old.stock_quantity is null or old.stock_quantity > 5) then
    perform private.notify_staff(
      'stock_low',
      'inventory.adjust',
      'Low stock: ' || new.name,
      format('%s left. Restock before the next order.', new.stock_quantity),
      'product',
      new.id::text,
      '/admin/products/' || new.id::text,
      'stock_low:' || new.id::text || ':' || to_char(now(), 'YYYY-MM-DD')
    );
  end if;
  return new;
end;
$$;

create trigger products_notify_low_stock
after update of stock_quantity on public.products
for each row execute function private.notify_low_stock();

-- A product submitted for moderation.
create function private.notify_moderation_pending()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.moderation_status = 'pending' and old.moderation_status is distinct from 'pending' then
    perform private.notify_staff(
      'moderation_pending',
      'content.approve',
      'Product awaiting review',
      new.name || ' was submitted for content review.',
      'product',
      new.id::text,
      '/admin/products/' || new.id::text,
      'moderation_pending:' || new.id::text || ':' || to_char(now(), 'YYYY-MM-DD HH24:MI')
    );
  end if;
  return new;
end;
$$;

create trigger products_notify_moderation
after update of moderation_status on public.products
for each row execute function private.notify_moderation_pending();

-- ---------------------------------------------------------------------------
-- 5. Public reads
-- ---------------------------------------------------------------------------

/** Exactly what a customer may see about the store. Never a private setting. */
create function public.public_store_profile()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'displayName', p.display_name,
    'tagline', p.tagline,
    'description', p.description,
    'logoKey', p.logo_key,
    'contactEmail', p.contact_email,
    'contactPhone', p.contact_phone,
    'addressLine', p.address_line,
    'addressArea', p.address_area,
    'addressDistrict', p.address_district,
    'businessHours', p.business_hours,
    'supportEmail', p.support_email,
    'supportPhone', p.support_phone,
    'social', jsonb_strip_nulls(jsonb_build_object(
      'facebook', p.social_facebook,
      'instagram', p.social_instagram,
      'youtube', p.social_youtube
    )),
    'defaultSeoTitle', p.default_seo_title,
    'defaultSeoDescription', p.default_seo_description,
    'ogImageKey', p.og_image_key,
    'updatedAt', p.updated_at
  )
  from public.store_profile p
  where p.id;
$$;

/**
 * The resolved metadata for one published product, or null. An unpublished, draft or
 * hidden product never appears here, so metadata cannot leak it.
 */
create function public.public_product_seo(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', 'product',
    'slug', pr.slug,
    'title', coalesce(pr.seo_title, pr.name),
    'description', coalesce(pr.seo_description, pr.summary),
    'ogTitle', coalesce(pr.og_title, pr.seo_title, pr.name),
    'ogDescription', coalesce(pr.og_description, pr.seo_description, pr.summary),
    'ogImageKey', pr.og_image_key,
    'canonicalPath', coalesce(pr.canonical_path, '/products/' || pr.slug),
    'noIndex', pr.no_index,
    'defaultSeoTitle', s.default_seo_title,
    'defaultSeoDescription', s.default_seo_description,
    'updatedAt', pr.updated_at
  )
  from public.products pr
  cross join public.store_profile s
  where pr.slug = p_slug
    and pr.status = 'active'
    and pr.moderation_status = 'approved'
    and exists (
      select 1 from public.categories c where c.id = pr.category_id and c.is_active
    )
  limit 1;
$$;

/** The resolved metadata for one visible category, or null. */
create function public.public_category_seo(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', 'category',
    'slug', c.slug,
    'title', coalesce(c.seo_title, c.name),
    'description', coalesce(c.seo_description, c.description),
    'ogTitle', coalesce(c.og_title, c.seo_title, c.name),
    'ogDescription', coalesce(c.og_description, c.seo_description, c.description),
    'ogImageKey', c.og_image_key,
    'canonicalPath', coalesce(c.canonical_path, '/category/' || c.slug),
    'noIndex', c.no_index,
    'defaultSeoTitle', s.default_seo_title,
    'defaultSeoDescription', s.default_seo_description,
    'updatedAt', c.updated_at
  )
  from public.categories c
  cross join public.store_profile s
  where c.slug = p_slug and c.is_active
  limit 1;
$$;

/** Everything a sitemap may list: published products and visible categories only. */
create function public.public_sitemap_entries()
returns table (kind text, slug text, last_modified timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select 'product'::text, pr.slug, pr.updated_at
  from public.products pr
  where pr.status = 'active'
    and pr.moderation_status = 'approved'
    and pr.no_index = false
    and exists (
      select 1 from public.categories c where c.id = pr.category_id and c.is_active
    )
  union all
  select 'category'::text, c.slug, c.updated_at
  from public.categories c
  where c.is_active and c.no_index = false
  order by 3 desc;
$$;

-- ---------------------------------------------------------------------------
-- 6. Admin: SEO
-- ---------------------------------------------------------------------------

/** One row per product and category that may be indexed, with what is still missing. */
create function public.admin_seo_overview(p_query text default null)
returns table (
  kind text,
  id uuid,
  slug text,
  name text,
  is_public boolean,
  seo_title text,
  seo_description text,
  og_title text,
  og_description text,
  og_image_key text,
  canonical_path text,
  no_index boolean,
  missing_title boolean,
  missing_description boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
begin
  perform private.require_permission('products.read');

  return query
  select 'product'::text, pr.id, pr.slug, pr.name,
         (pr.status = 'active' and pr.moderation_status = 'approved'),
         pr.seo_title, pr.seo_description, pr.no_index,
         (pr.seo_title is null), (pr.seo_description is null), pr.updated_at
  from public.products pr
  where v_query is null or pr.name ilike '%' || v_query || '%' or pr.slug ilike '%' || v_query || '%'
  union all
  select 'category'::text, c.id, c.slug, c.name, c.is_active,
         c.seo_title, c.seo_description, c.no_index,
         (c.seo_title is null), (c.seo_description is null), c.updated_at
  from public.categories c
  where v_query is null or c.name ilike '%' || v_query || '%' or c.slug ilike '%' || v_query || '%'
  order by 14 desc;
end;
$$;

create function public.admin_save_product_seo(
  p_product_id uuid,
  p_seo_title text default null,
  p_seo_description text default null,
  p_og_title text default null,
  p_og_description text default null,
  p_og_image_key text default null,
  p_canonical_path text default null,
  p_no_index boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.update');
begin
  update public.products set
    seo_title = nullif(btrim(coalesce(p_seo_title, '')), ''),
    seo_description = nullif(btrim(coalesce(p_seo_description, '')), ''),
    og_title = nullif(btrim(coalesce(p_og_title, '')), ''),
    og_description = nullif(btrim(coalesce(p_og_description, '')), ''),
    og_image_key = nullif(btrim(coalesce(p_og_image_key, '')), ''),
    canonical_path = nullif(btrim(coalesce(p_canonical_path, '')), ''),
    no_index = coalesce(p_no_index, false)
  where id = p_product_id;

  if not found then
    raise exception 'that product does not exist' using errcode = 'NZ494';
  end if;

  perform private.audit(v_actor, 'product.seo.save', 'product', p_product_id::text);
end;
$$;

create function public.admin_save_category_seo(
  p_category_id uuid,
  p_seo_title text default null,
  p_seo_description text default null,
  p_og_title text default null,
  p_og_description text default null,
  p_og_image_key text default null,
  p_canonical_path text default null,
  p_no_index boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.update');
begin
  update public.categories set
    seo_title = nullif(btrim(coalesce(p_seo_title, '')), ''),
    seo_description = nullif(btrim(coalesce(p_seo_description, '')), ''),
    og_title = nullif(btrim(coalesce(p_og_title, '')), ''),
    og_description = nullif(btrim(coalesce(p_og_description, '')), ''),
    og_image_key = nullif(btrim(coalesce(p_og_image_key, '')), ''),
    canonical_path = nullif(btrim(coalesce(p_canonical_path, '')), ''),
    no_index = coalesce(p_no_index, false)
  where id = p_category_id;

  if not found then
    raise exception 'that category does not exist' using errcode = 'NZ494';
  end if;

  perform private.audit(v_actor, 'category.seo.save', 'category', p_category_id::text);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Admin: store profile
-- ---------------------------------------------------------------------------

create function public.admin_store_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
begin
  perform v_actor;
  return public.public_store_profile();
end;
$$;

create function public.admin_save_store_profile(
  p_display_name text,
  p_tagline text default null,
  p_description text default null,
  p_logo_key text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_address_line text default null,
  p_address_area text default null,
  p_address_district text default null,
  p_business_hours text default null,
  p_support_email text default null,
  p_support_phone text default null,
  p_social_facebook text default null,
  p_social_instagram text default null,
  p_social_youtube text default null,
  p_default_seo_title text default null,
  p_default_seo_description text default null,
  p_og_image_key text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
begin
  if p_display_name is null or btrim(p_display_name) = '' then
    raise exception 'the store needs a name' using errcode = 'NZ495';
  end if;

  update public.store_profile set
    display_name = btrim(p_display_name),
    tagline = nullif(btrim(coalesce(p_tagline, '')), ''),
    description = nullif(btrim(coalesce(p_description, '')), ''),
    logo_key = nullif(btrim(coalesce(p_logo_key, '')), ''),
    contact_email = nullif(btrim(coalesce(p_contact_email, '')), ''),
    contact_phone = nullif(btrim(coalesce(p_contact_phone, '')), ''),
    address_line = nullif(btrim(coalesce(p_address_line, '')), ''),
    address_area = nullif(btrim(coalesce(p_address_area, '')), ''),
    address_district = nullif(btrim(coalesce(p_address_district, '')), ''),
    business_hours = nullif(btrim(coalesce(p_business_hours, '')), ''),
    support_email = nullif(btrim(coalesce(p_support_email, '')), ''),
    support_phone = nullif(btrim(coalesce(p_support_phone, '')), ''),
    social_facebook = nullif(btrim(coalesce(p_social_facebook, '')), ''),
    social_instagram = nullif(btrim(coalesce(p_social_instagram, '')), ''),
    social_youtube = nullif(btrim(coalesce(p_social_youtube, '')), ''),
    default_seo_title = nullif(btrim(coalesce(p_default_seo_title, '')), ''),
    default_seo_description = nullif(btrim(coalesce(p_default_seo_description, '')), ''),
    og_image_key = nullif(btrim(coalesce(p_og_image_key, '')), ''),
    updated_at = now(),
    updated_by = v_actor
  where id;

  perform private.audit(v_actor, 'store_profile.save', 'store_profile', 'default');
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Staff notification inbox
-- ---------------------------------------------------------------------------

/** The caller's own notifications: addressed to them, or to a permission they hold. */
create function public.my_staff_notifications(
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  kind public.staff_notification_kind,
  title text,
  body text,
  entity_type text,
  entity_id text,
  action_path text,
  read_at timestamptz,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;

  return query
  with visible as (
    select n.*
    from public.staff_notifications n
    where (n.recipient_id = v_user)
       or (n.recipient_id is null and private.has_permission(n.audience_permission))
  )
  select v.id, v.kind, v.title, v.body, v.entity_type, v.entity_id, v.action_path,
         v.read_at, v.created_at, count(*) over () as total_count
  from visible v
  order by v.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

create function public.my_unread_notification_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.staff_notifications n
  where n.read_at is null
    and (
      n.recipient_id = (select auth.uid())
      or (n.recipient_id is null and private.has_permission(n.audience_permission))
    );
$$;

/** Marks one notification read. A notification the caller cannot see is refused. */
create function public.mark_staff_notification_read(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;

  update public.staff_notifications n
  set read_at = now()
  where n.id = p_id
    and n.read_at is null
    and (
      n.recipient_id = v_user
      or (n.recipient_id is null and private.has_permission(n.audience_permission))
    );

  if not found then
    -- Already read is fine; invisible or missing is not.
    if not exists (
      select 1 from public.staff_notifications n
      where n.id = p_id
        and (
          n.recipient_id = v_user
          or (n.recipient_id is null and private.has_permission(n.audience_permission))
        )
    ) then
      raise exception 'that notification is not yours' using errcode = 'NZ496';
    end if;
  end if;
end;
$$;

/** Marks everything the caller can currently see as read. */
create function public.mark_all_staff_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_count integer;
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;

  update public.staff_notifications n
  set read_at = now()
  where n.read_at is null
    and (
      n.recipient_id = v_user
      or (n.recipient_id is null and private.has_permission(n.audience_permission))
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Customer insight
-- ---------------------------------------------------------------------------

/**
 * Spending is what the customer has actually paid for goods they kept:
 *   - a cancelled order contributes nothing;
 *   - an order counts once it is confirmed (or later), so a pending order is not revenue;
 *   - every completed refund is subtracted, because that money went back;
 *   - amounts are integer poisha throughout.
 */
create function public.admin_customer_insights(
  p_segment text default null,
  p_query text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  full_name text,
  email text,
  orders_count bigint,
  completed_orders bigint,
  eligible_spend_minor bigint,
  average_order_minor bigint,
  first_order_at timestamptz,
  last_order_at timestamptz,
  segments text[],
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_repeat integer;
  v_high bigint;
  v_inactive integer;
begin
  perform private.require_permission('customers.read');

  select repeat_order_threshold, high_spend_threshold_minor, inactive_days
  into v_repeat, v_high, v_inactive
  from public.store_settings where id;

  return query
  with spend as (
    select o.user_id,
           count(*) filter (where o.status <> 'cancelled') as orders_count,
           count(*) filter (where o.status = 'delivered') as completed_orders,
           coalesce(sum(o.total_minor) filter (where o.status <> 'cancelled'), 0)::bigint as gross_minor,
           min(o.placed_at) filter (where o.status <> 'cancelled') as first_order_at,
           max(o.placed_at) filter (where o.status <> 'cancelled') as last_order_at
    from public.orders o
    group by o.user_id
  ),
  refunded as (
    select o.user_id, coalesce(sum(r.amount_minor), 0)::bigint as refunded_minor
    from public.refunds r
    join public.orders o on o.id = r.order_id
    where r.status = 'completed'
    group by o.user_id
  ),
  scored as (
    select p.id,
           p.full_name,
           p.email,
           coalesce(s.orders_count, 0) as orders_count,
           coalesce(s.completed_orders, 0) as completed_orders,
           greatest(coalesce(s.gross_minor, 0) - coalesce(f.refunded_minor, 0), 0)::bigint as spend_minor,
           s.first_order_at,
           s.last_order_at,
           array_remove(array[
             case when coalesce(s.orders_count, 0) <= 1 then 'new' end,
             case when coalesce(s.orders_count, 0) >= v_repeat then 'repeat' end,
             case when greatest(coalesce(s.gross_minor, 0) - coalesce(f.refunded_minor, 0), 0) >= v_high
                  then 'high_spender' end,
             case when s.last_order_at is not null
                       and s.last_order_at < now() - make_interval(days => v_inactive)
                  then 'inactive' end,
             case when s.last_order_at is not null
                       and s.last_order_at >= now() - make_interval(days => v_inactive)
                  then 'active' end
           ], null)::text[] as segments
    from public.profiles p
    left join spend s on s.user_id = p.id
    left join refunded f on f.user_id = p.id
    where p.role = 'customer'
      and (nullif(btrim(coalesce(p_query, '')), '') is null
           or p.full_name ilike '%' || btrim(p_query) || '%'
           or p.email ilike '%' || btrim(p_query) || '%')
  )
  select sc.id, sc.full_name, sc.email, sc.orders_count, sc.completed_orders,
         sc.spend_minor,
         case when sc.orders_count = 0 then 0
              else (sc.spend_minor / sc.orders_count)::bigint end as average_order_minor,
         sc.first_order_at, sc.last_order_at, sc.segments,
         count(*) over () as total_count
  from scored sc
  where nullif(btrim(coalesce(p_segment, '')), '') is null
     or p_segment = any (sc.segments)
  order by sc.spend_minor desc, sc.id
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.public_store_profile() from public, anon, authenticated;
revoke execute on function public.public_product_seo(text) from public, anon, authenticated;
revoke execute on function public.public_category_seo(text) from public, anon, authenticated;
revoke execute on function public.public_sitemap_entries() from public, anon, authenticated;
revoke execute on function public.admin_seo_overview(text) from public, anon, authenticated;
revoke execute on function public.admin_save_product_seo(
  uuid, text, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.admin_save_category_seo(
  uuid, text, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.admin_store_profile() from public, anon, authenticated;
revoke execute on function public.admin_save_store_profile(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
revoke execute on function public.my_staff_notifications(integer, integer) from public, anon, authenticated;
revoke execute on function public.my_unread_notification_count() from public, anon, authenticated;
revoke execute on function public.mark_staff_notification_read(uuid) from public, anon, authenticated;
revoke execute on function public.mark_all_staff_notifications_read() from public, anon, authenticated;
revoke execute on function public.admin_customer_insights(text, text, integer, integer)
  from public, anon, authenticated;

grant execute on function public.public_store_profile() to anon, authenticated;
grant execute on function public.public_product_seo(text) to anon, authenticated;
grant execute on function public.public_category_seo(text) to anon, authenticated;
grant execute on function public.public_sitemap_entries() to anon, authenticated;
grant execute on function public.admin_seo_overview(text) to authenticated;
grant execute on function public.admin_save_product_seo(
  uuid, text, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.admin_save_category_seo(
  uuid, text, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.admin_store_profile() to authenticated;
grant execute on function public.admin_save_store_profile(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text
) to authenticated;
grant execute on function public.my_staff_notifications(integer, integer) to authenticated;
grant execute on function public.my_unread_notification_count() to authenticated;
grant execute on function public.mark_staff_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_staff_notifications_read() to authenticated;
grant execute on function public.admin_customer_insights(text, text, integer, integer) to authenticated;
