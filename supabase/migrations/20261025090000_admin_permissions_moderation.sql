-- Nilzora admin and moderator foundation: permissions held in the database (role
-- defaults plus per-account grants and denials, a denial always winning), an audit
-- log, product moderation, and the privileged store operations.
--
-- Every privileged write is a function that runs as its owner but first checks the
-- CALLER's own permissions (auth.uid(), never a parameter), so an API bug or a stolen
-- route cannot act with more authority than the signed-in account holds. Staff reads
-- use Row Level Security policies keyed by the same permission check.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

create table public.permissions (
  name text primary key check (name ~ '^[a-z_]+(\.[a-z_]+)+$'),
  description text not null
);

comment on table public.permissions is 'Every permission the application knows. Role defaults and overrides refer to these.';

insert into public.permissions (name, description) values
  ('admin_workspace.access', 'Enter the admin workspace'),
  ('moderator_workspace.access', 'Enter the moderator workspace'),
  ('products.read', 'See every product, including drafts, and stock movements'),
  ('products.create', 'Create draft products'),
  ('products.update', 'Edit products and submit them for review'),
  ('products.publish', 'Publish, unpublish and archive products; manage categories'),
  ('inventory.adjust', 'Adjust stock with a recorded reason'),
  ('orders.read', 'See every order'),
  ('orders.update_status', 'Move orders through fulfilment'),
  ('orders.cancel', 'Cancel orders and return their stock'),
  ('payments.collect', 'Record Cash-on-Delivery collection'),
  ('customers.read', 'See customer accounts'),
  ('customers.update', 'Suspend and reactivate customer accounts'),
  ('coupons.create', 'Create coupons (not yet available)'),
  ('coupons.update', 'Edit coupons (not yet available)'),
  ('reviews.moderate', 'Moderate customer reviews (not yet available)'),
  ('content.approve', 'Decide product content reviews assigned to you'),
  ('moderation.assign', 'Assign content reviews to moderators'),
  ('finance.read', 'See sales figures and analytics'),
  ('refunds.request', 'Request refunds (not yet available)'),
  ('refunds.approve', 'Approve refunds (not yet available)'),
  ('staff.invite', 'Invite staff and moderator accounts'),
  ('staff.roles.assign', 'Change account roles'),
  ('staff.permissions.manage', 'Grant or deny individual permissions'),
  ('settings.manage', 'Change store settings such as delivery charges'),
  ('audit_logs.read', 'Read the audit log');

create table public.role_permissions (
  role public.app_role not null,
  permission text not null references public.permissions (name) on delete cascade,
  primary key (role, permission)
);

comment on table public.role_permissions is 'Default permissions of each role. Changed only by migrations.';

-- Owners hold everything; admins everything except store settings.
insert into public.role_permissions (role, permission)
select 'super_admin'::public.app_role, name from public.permissions
union all
select 'admin'::public.app_role, name from public.permissions where name <> 'settings.manage'
union all
select 'staff'::public.app_role, unnest(array[
  'admin_workspace.access', 'products.read', 'products.create', 'products.update',
  'inventory.adjust', 'orders.read', 'orders.update_status', 'payments.collect',
  'customers.read', 'refunds.request'
])
union all
select 'moderator'::public.app_role, unnest(array[
  'moderator_workspace.access', 'products.read', 'reviews.moderate', 'content.approve'
]);

create type public.permission_effect as enum ('grant', 'deny');

create table public.user_permissions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  permission text not null references public.permissions (name) on delete cascade,
  effect public.permission_effect not null,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, permission)
);

comment on table public.user_permissions is 'Per-account overrides of the role defaults. A deny always wins; grants never apply to customers.';

create index user_permissions_granted_by_idx on public.user_permissions (granted_by);

-- The effective permissions of an account: role defaults plus grants, minus denials.
-- Suspended accounts hold nothing; customers never receive grants.
create function private.permissions_of(p_user uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  (
    select rp.permission
    from public.user_roles r
    join public.profiles p on p.id = r.user_id and p.status = 'active'
    join public.role_permissions rp on rp.role = r.role
    where r.user_id = p_user
    union
    select up.permission
    from public.user_permissions up
    join public.user_roles r on r.user_id = up.user_id and r.role <> 'customer'
    join public.profiles p on p.id = up.user_id and p.status = 'active'
    where up.user_id = p_user and up.effect = 'grant'
  )
  except
  select up.permission from public.user_permissions up
  where up.user_id = p_user and up.effect = 'deny';
$$;

/** Whether the signed-in caller holds a permission right now. Used by policies and functions. */
create function public.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.permissions_of((select auth.uid())) as granted (name)
    where granted.name = p_permission
  );
$$;

-- The caller's role, account status and effective permissions, for the API's
-- per-request identity check.
create function public.my_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'role', r.role,
    'status', p.status,
    'permissions', coalesce(
      (select jsonb_agg(x.name order by x.name) from private.permissions_of(p.id) as x (name)),
      '[]'::jsonb
    )
  )
  from public.profiles p
  join public.user_roles r on r.user_id = p.id
  where p.id = (select auth.uid());
$$;

-- Raises NZ403 unless the caller holds the permission; returns the caller's id.
create function private.require_permission(p_permission text)
returns uuid
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
  if not exists (select 1 from private.permissions_of(v_user) as x (name) where x.name = p_permission) then
    raise exception 'missing permission %', p_permission using errcode = 'NZ403';
  end if;
  return v_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit log. Written only by the functions below; never holds passwords, tokens
-- or more personal data than the action needs.
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  target_type text not null check (char_length(target_type) between 1 and 40),
  target_id text check (target_id is null or char_length(target_id) <= 80),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.audit_log is 'Privileged actions. Insert-only, through the admin functions.';

create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, created_at desc);
create index audit_log_target_idx on public.audit_log (target_type, target_id);

create function private.audit(
  p_actor uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_details jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (p_actor, p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb));
$$;

-- Role changes are audited, and an account moved to the customer role loses its
-- permission overrides (customers never hold grants). The rules are unchanged.
create or replace function public.assign_user_role(p_actor_id uuid, p_target_id uuid, p_role public.app_role)
returns public.user_roles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.app_role;
  v_target_role public.app_role;
  v_result public.user_roles;
begin
  if p_actor_id is null or p_target_id is null or p_role is null then
    raise exception 'actor, target and role are required' using errcode = '22004';
  end if;

  if p_actor_id = p_target_id then
    raise exception 'accounts cannot change their own role' using errcode = 'NZ001';
  end if;

  perform 1 from public.user_roles where role = 'super_admin' for update;

  select r.role into v_actor_role
  from public.user_roles r
  join public.profiles p on p.id = r.user_id
  where r.user_id = p_actor_id and p.status = 'active';

  if v_actor_role is null or v_actor_role not in ('super_admin', 'admin') then
    raise exception 'the acting account may not assign roles' using errcode = 'NZ002';
  end if;

  select role into v_target_role from public.user_roles where user_id = p_target_id for update;
  if v_target_role is null then
    raise exception 'target account not found' using errcode = 'NZ404';
  end if;

  if v_actor_role = 'admin'
     and (p_role in ('super_admin', 'admin') or v_target_role in ('super_admin', 'admin')) then
    raise exception 'only an owner can grant or change admin roles' using errcode = 'NZ003';
  end if;

  if v_target_role = 'super_admin' and p_role <> 'super_admin'
     and (select count(*) from public.user_roles where role = 'super_admin') <= 1 then
    raise exception 'the last owner cannot be demoted' using errcode = 'NZ004';
  end if;

  update public.user_roles
  set role = p_role, granted_by = p_actor_id, granted_at = now()
  where user_id = p_target_id
  returning * into v_result;

  if p_role = 'customer' then
    delete from public.user_permissions where user_id = p_target_id;
  end if;

  perform private.audit(p_actor_id, 'staff.role_changed', 'account', p_target_id::text,
    jsonb_build_object('from', v_target_role, 'to', p_role));

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permission overrides: grant or deny one permission to one account.
-- ---------------------------------------------------------------------------

create function public.admin_set_permission(
  p_target uuid,
  p_permission text,
  p_effect public.permission_effect default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('staff.permissions.manage');
  v_actor_role public.app_role;
  v_target_role public.app_role;
  v_before public.permission_effect;
begin
  if p_target is null or p_permission is null then
    raise exception 'an account and a permission are required' using errcode = 'NZ412';
  end if;
  if p_target = v_actor then
    raise exception 'accounts cannot change their own permissions' using errcode = 'NZ438';
  end if;
  if not exists (select 1 from public.permissions where name = p_permission) then
    raise exception 'unknown permission' using errcode = 'NZ412';
  end if;

  select role into v_actor_role from public.user_roles where user_id = v_actor;
  select role into v_target_role from public.user_roles where user_id = p_target for update;
  if v_target_role is null then
    raise exception 'account not found' using errcode = 'NZ404';
  end if;
  if v_target_role = 'customer' then
    raise exception 'customer accounts hold no permissions' using errcode = 'NZ439';
  end if;
  -- Only an owner manages admins and owners.
  if v_target_role in ('super_admin', 'admin') and v_actor_role <> 'super_admin' then
    raise exception 'only an owner can change an admin''s permissions' using errcode = 'NZ439';
  end if;
  -- Nobody hands out (or takes away) authority they do not hold themselves.
  if not exists (select 1 from private.permissions_of(v_actor) as x (name) where x.name = p_permission) then
    raise exception 'you can only manage permissions you hold' using errcode = 'NZ403';
  end if;

  select effect into v_before from public.user_permissions
  where user_id = p_target and permission = p_permission;

  if p_effect is null then
    delete from public.user_permissions where user_id = p_target and permission = p_permission;
  else
    insert into public.user_permissions (user_id, permission, effect, granted_by)
    values (p_target, p_permission, p_effect, v_actor)
    on conflict (user_id, permission)
    do update set effect = excluded.effect, granted_by = excluded.granted_by, created_at = now();
  end if;

  perform private.audit(v_actor, 'staff.permission_changed', 'account', p_target::text,
    jsonb_build_object('permission', p_permission, 'from', v_before, 'to', p_effect));
end;
$$;

-- Staff and moderator accounts with their roles and overrides.
create function public.admin_list_staff()
returns table (
  id uuid,
  email text,
  full_name text,
  role public.app_role,
  status public.profile_status,
  granted_at timestamptz,
  overrides jsonb,
  permissions jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_permission('staff.roles.assign') or public.has_permission('staff.permissions.manage')) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;
  return query
  select p.id, u.email::text, p.full_name, r.role, p.status, r.granted_at,
    coalesce(
      (select jsonb_agg(jsonb_build_object('permission', up.permission, 'effect', up.effect) order by up.permission)
       from public.user_permissions up where up.user_id = p.id),
      '[]'::jsonb
    ),
    coalesce(
      (select jsonb_agg(x.name order by x.name) from private.permissions_of(p.id) as x (name)),
      '[]'::jsonb
    )
  from public.profiles p
  join public.user_roles r on r.user_id = p.id
  join auth.users u on u.id = p.id
  where r.role <> 'customer'
  order by array_position(array['super_admin', 'admin', 'staff', 'moderator']::public.app_role[], r.role), u.email;
end;
$$;

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------

create function public.admin_list_customers(
  p_query text default null,
  p_status public.profile_status default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  email text,
  full_name text,
  phone text,
  status public.profile_status,
  created_at timestamptz,
  order_count bigint,
  last_order_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
begin
  perform private.require_permission('customers.read');
  if p_limit not between 1 and 100 or p_offset not between 0 and 100000 then
    raise exception 'invalid page' using errcode = 'NZ412';
  end if;
  if v_query is not null and char_length(v_query) > 100 then
    raise exception 'the search is too long' using errcode = 'NZ412';
  end if;
  return query
  select p.id, u.email::text, p.full_name, p.phone, p.status, p.created_at,
    (select count(*) from public.orders o where o.user_id = p.id),
    (select max(o.placed_at) from public.orders o where o.user_id = p.id),
    count(*) over ()
  from public.profiles p
  join public.user_roles r on r.user_id = p.id and r.role = 'customer'
  join auth.users u on u.id = p.id
  where (p_status is null or p.status = p_status)
    and (
      v_query is null
      or strpos(lower(u.email), lower(v_query)) > 0
      or strpos(lower(coalesce(p.full_name, '')), lower(v_query)) > 0
      or strpos(coalesce(p.phone, ''), v_query) > 0
    )
  order by p.created_at desc, p.id
  limit p_limit offset p_offset;
end;
$$;

create function public.admin_set_account_status(
  p_target uuid,
  p_status public.profile_status,
  p_reason text default null
)
returns public.profile_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('customers.update');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_before public.profile_status;
begin
  if p_target is null or p_status is null then
    raise exception 'an account and a status are required' using errcode = 'NZ412';
  end if;
  if p_target = v_actor then
    raise exception 'accounts cannot change their own status' using errcode = 'NZ438';
  end if;
  if p_status = 'suspended' and (v_reason is null or char_length(v_reason) < 5) then
    raise exception 'a reason is required to suspend an account' using errcode = 'NZ412';
  end if;
  if v_reason is not null and char_length(v_reason) > 300 then
    raise exception 'the reason is too long' using errcode = 'NZ412';
  end if;
  -- Staff accounts are managed through roles, not here.
  if not exists (select 1 from public.user_roles where user_id = p_target and role = 'customer') then
    raise exception 'customer not found' using errcode = 'NZ404';
  end if;

  select status into v_before from public.profiles where id = p_target for update;
  update public.profiles set status = p_status where id = p_target;

  perform private.audit(v_actor, 'customer.status_changed', 'account', p_target::text,
    jsonb_build_object('from', v_before, 'to', p_status, 'reason', v_reason));
  return p_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Products: moderation state, and the operations on them
-- ---------------------------------------------------------------------------

create type public.moderation_status as enum (
  'not_submitted', 'pending', 'approved', 'changes_requested', 'rejected'
);

alter table public.products
  add column moderation_status public.moderation_status not null default 'not_submitted',
  add column created_by uuid references public.profiles (id) on delete set null,
  add column updated_by uuid references public.profiles (id) on delete set null;

-- Products already on sale were published before moderation existed.
update public.products set moderation_status = 'approved' where status = 'active';

comment on column public.products.moderation_status is 'Content review state. Publishing requires approved; any content edit resets it.';

-- A row inserted already on sale (the development seed, test fixtures: trusted
-- service-role writes) counts as approved. The admin functions always create drafts,
-- and publishing later requires approval (admin_set_product_status).
create or replace function private.products_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status = 'active' and new.moderation_status = 'not_submitted' then
    new.moderation_status := 'approved';
  end if;
  if new.status = 'active' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

-- A product on sale must have approved content (the storefront shows only active ones).
alter table public.products
  add constraint products_active_approved check (status <> 'active' or moderation_status = 'approved');

create index products_moderation_idx on public.products (moderation_status) where status <> 'archived';

create function public.admin_create_product(
  p_category_id uuid,
  p_slug text,
  p_sku text,
  p_name text,
  p_summary text,
  p_description text,
  p_price_minor bigint,
  p_compare_at_price_minor bigint,
  p_max_order_quantity integer,
  p_is_featured boolean,
  p_initial_stock integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.create');
  v_id uuid;
begin
  if p_initial_stock is null or p_initial_stock < 0 or p_initial_stock > 1000000 then
    raise exception 'initial stock must be from 0 to 1,000,000' using errcode = 'NZ412';
  end if;
  if not exists (select 1 from public.categories where id = p_category_id) then
    raise exception 'category not found' using errcode = 'NZ412';
  end if;

  insert into public.products (
    category_id, slug, sku, name, summary, description, price_minor, compare_at_price_minor,
    stock_quantity, max_order_quantity, is_featured, status, moderation_status, created_by, updated_by
  ) values (
    p_category_id, p_slug, p_sku, btrim(p_name), nullif(btrim(coalesce(p_summary, '')), ''),
    nullif(btrim(coalesce(p_description, '')), ''), p_price_minor, p_compare_at_price_minor,
    p_initial_stock, coalesce(p_max_order_quantity, 10), coalesce(p_is_featured, false),
    'draft', 'not_submitted', v_actor, v_actor
  )
  returning id into v_id;

  if p_initial_stock > 0 then
    insert into public.inventory_movements (product_id, change, stock_after, reason, actor_id, note)
    values (v_id, p_initial_stock, p_initial_stock, 'initial_stock', v_actor, 'Initial stock');
  end if;

  perform private.audit(v_actor, 'product.created', 'product', v_id::text,
    jsonb_build_object('sku', p_sku, 'initialStock', p_initial_stock));
  return v_id;
end;
$$;

-- Content (category, address, name and texts) can change only while the product is
-- not on sale and not under review, and changing it sends it back for review.
-- Price, limits and featuring are operational and can change at any time.
create function public.admin_update_product(
  p_product_id uuid,
  p_category_id uuid,
  p_slug text,
  p_name text,
  p_summary text,
  p_description text,
  p_price_minor bigint,
  p_compare_at_price_minor bigint,
  p_max_order_quantity integer,
  p_is_featured boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.update');
  v_product public.products;
  v_summary text := nullif(btrim(coalesce(p_summary, '')), '');
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_content_changed boolean;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product not found' using errcode = 'NZ404';
  end if;
  if not exists (select 1 from public.categories where id = p_category_id) then
    raise exception 'category not found' using errcode = 'NZ412';
  end if;

  v_content_changed :=
    v_product.category_id is distinct from p_category_id
    or v_product.slug is distinct from p_slug
    or v_product.name is distinct from btrim(p_name)
    or v_product.summary is distinct from v_summary
    or v_product.description is distinct from v_description;

  if v_content_changed and v_product.status = 'active' then
    raise exception 'unpublish the product before changing its content' using errcode = 'NZ430';
  end if;
  if v_content_changed and v_product.moderation_status = 'pending' then
    raise exception 'the product is under review' using errcode = 'NZ431';
  end if;

  update public.products
  set category_id = p_category_id,
      slug = p_slug,
      name = btrim(p_name),
      summary = v_summary,
      description = v_description,
      price_minor = p_price_minor,
      compare_at_price_minor = p_compare_at_price_minor,
      max_order_quantity = p_max_order_quantity,
      is_featured = coalesce(p_is_featured, false),
      moderation_status = case when v_content_changed then 'not_submitted' else moderation_status end,
      updated_by = v_actor
  where id = p_product_id;

  perform private.audit(v_actor, 'product.updated', 'product', p_product_id::text,
    jsonb_build_object(
      'contentChanged', v_content_changed,
      'priceMinor', jsonb_build_object('from', v_product.price_minor, 'to', p_price_minor)
    ));
end;
$$;

create function public.admin_set_product_status(p_product_id uuid, p_status public.product_status)
returns public.product_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.publish');
  v_product public.products;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product not found' using errcode = 'NZ404';
  end if;
  if p_status = 'active' and v_product.moderation_status <> 'approved' then
    raise exception 'only approved content can be published' using errcode = 'NZ432';
  end if;

  update public.products set status = p_status, updated_by = v_actor where id = p_product_id;
  perform private.audit(v_actor, 'product.status_changed', 'product', p_product_id::text,
    jsonb_build_object('from', v_product.status, 'to', p_status));
  return p_status;
end;
$$;

create function public.admin_adjust_stock(p_product_id uuid, p_change integer, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('inventory.adjust');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_stock integer;
begin
  if p_change is null or p_change = 0 or abs(p_change) > 1000000 then
    raise exception 'the change must be a whole number, not zero' using errcode = 'NZ412';
  end if;
  if v_note is null or char_length(v_note) < 3 or char_length(v_note) > 300 then
    raise exception 'a reason of 3 to 300 characters is required' using errcode = 'NZ412';
  end if;

  select stock_quantity into v_stock from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product not found' using errcode = 'NZ404';
  end if;
  if v_stock + p_change < 0 then
    raise exception 'stock cannot go below zero' using errcode = 'NZ433';
  end if;

  update public.products set stock_quantity = v_stock + p_change, updated_by = v_actor
  where id = p_product_id;
  insert into public.inventory_movements (product_id, change, stock_after, reason, actor_id, note)
  values (p_product_id, p_change, v_stock + p_change, 'adjustment', v_actor, v_note);

  perform private.audit(v_actor, 'inventory.adjusted', 'product', p_product_id::text,
    jsonb_build_object('change', p_change, 'stockAfter', v_stock + p_change));
  return v_stock + p_change;
end;
$$;

create function public.admin_save_category(
  p_category_id uuid,
  p_slug text,
  p_name text,
  p_description text,
  p_sort_order integer,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.publish');
  v_id uuid := p_category_id;
begin
  if v_id is null then
    insert into public.categories (slug, name, description, sort_order, is_active)
    values (p_slug, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
      coalesce(p_sort_order, 0), coalesce(p_is_active, true))
    returning id into v_id;
    perform private.audit(v_actor, 'category.created', 'category', v_id::text,
      jsonb_build_object('slug', p_slug));
  else
    update public.categories
    set slug = p_slug, name = btrim(p_name), description = nullif(btrim(coalesce(p_description, '')), ''),
        sort_order = coalesce(p_sort_order, 0), is_active = coalesce(p_is_active, true)
    where id = v_id;
    if not found then
      raise exception 'category not found' using errcode = 'NZ404';
    end if;
    perform private.audit(v_actor, 'category.updated', 'category', v_id::text,
      jsonb_build_object('slug', p_slug, 'isActive', coalesce(p_is_active, true)));
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Moderation: staff submit draft product content; an admin assigns the review to a
-- moderator; only that moderator decides it, and never on their own submission.
-- ---------------------------------------------------------------------------

create type public.moderation_task_status as enum (
  'pending', 'approved', 'rejected', 'changes_requested', 'withdrawn'
);
create type public.moderation_event_kind as enum (
  'submitted', 'assigned', 'approved', 'rejected', 'changes_requested', 'withdrawn'
);

create table public.moderation_tasks (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  status public.moderation_task_status not null default 'pending',
  -- The content as submitted, so the decision is about exactly what was reviewed.
  content jsonb not null,
  submitted_by uuid references public.profiles (id) on delete set null,
  submitted_at timestamptz not null default now(),
  assigned_to uuid references public.profiles (id) on delete set null,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 1000),
  constraint moderation_tasks_decided check ((status = 'pending') = (decided_at is null))
);

-- At most one open review per product.
create unique index moderation_tasks_one_open_idx on public.moderation_tasks (product_id) where status = 'pending';
create index moderation_tasks_assignee_idx on public.moderation_tasks (assigned_to, status, submitted_at);
create index moderation_tasks_status_idx on public.moderation_tasks (status, submitted_at);

create table public.moderation_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.moderation_tasks (id) on delete cascade,
  kind public.moderation_event_kind not null,
  actor_id uuid references public.profiles (id) on delete set null,
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now()
);

create index moderation_events_task_idx on public.moderation_events (task_id, created_at);

create function public.submit_product_for_review(p_product_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.update');
  v_product public.products;
  v_task uuid;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product not found' using errcode = 'NZ404';
  end if;
  if v_product.status <> 'draft' then
    raise exception 'only draft products can be submitted' using errcode = 'NZ430';
  end if;
  if v_product.moderation_status in ('pending', 'approved') then
    raise exception 'the product is already under review or approved' using errcode = 'NZ431';
  end if;

  insert into public.moderation_tasks (product_id, content, submitted_by)
  values (
    p_product_id,
    jsonb_build_object(
      'name', v_product.name,
      'summary', v_product.summary,
      'description', v_product.description,
      'slug', v_product.slug,
      'sku', v_product.sku,
      'categoryId', v_product.category_id,
      'categoryName', (select name from public.categories where id = v_product.category_id),
      'priceMinor', v_product.price_minor,
      'compareAtPriceMinor', v_product.compare_at_price_minor
    ),
    v_actor
  )
  returning id into v_task;

  update public.products set moderation_status = 'pending', updated_by = v_actor where id = p_product_id;
  insert into public.moderation_events (task_id, kind, actor_id) values (v_task, 'submitted', v_actor);
  perform private.audit(v_actor, 'moderation.submitted', 'product', p_product_id::text,
    jsonb_build_object('taskId', v_task));
  return v_task;
end;
$$;

create function public.assign_moderation_task(p_task_id uuid, p_moderator uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('moderation.assign');
  v_task public.moderation_tasks;
begin
  select * into v_task from public.moderation_tasks where id = p_task_id for update;
  if not found then
    raise exception 'review not found' using errcode = 'NZ404';
  end if;
  if v_task.status <> 'pending' then
    raise exception 'the review is already closed' using errcode = 'NZ436';
  end if;
  if p_moderator is null
     or not exists (select 1 from private.permissions_of(p_moderator) as x (name) where x.name = 'content.approve') then
    raise exception 'the account cannot review content' using errcode = 'NZ436';
  end if;
  if p_moderator = v_task.submitted_by then
    raise exception 'nobody reviews their own submission' using errcode = 'NZ437';
  end if;

  update public.moderation_tasks
  set assigned_to = p_moderator, assigned_by = v_actor, assigned_at = now()
  where id = p_task_id;
  insert into public.moderation_events (task_id, kind, actor_id, note)
  values (p_task_id, 'assigned', v_actor, null);
  perform private.audit(v_actor, 'moderation.assigned', 'moderation_task', p_task_id::text,
    jsonb_build_object('moderatorId', p_moderator, 'previousModeratorId', v_task.assigned_to));
end;
$$;

create function public.decide_moderation_task(
  p_task_id uuid,
  p_decision public.moderation_task_status,
  p_note text default null
)
returns public.moderation_task_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('content.approve');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_task public.moderation_tasks;
begin
  if p_decision is null or p_decision not in ('approved', 'rejected', 'changes_requested') then
    raise exception 'decide with approved, rejected or changes_requested' using errcode = 'NZ412';
  end if;
  if p_decision <> 'approved' and (v_note is null or char_length(v_note) < 10) then
    raise exception 'explain the decision in at least 10 characters' using errcode = 'NZ412';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'the note is too long' using errcode = 'NZ412';
  end if;

  select * into v_task from public.moderation_tasks where id = p_task_id for update;
  -- Reviews assigned to someone else are indistinguishable from missing ones.
  if not found or v_task.assigned_to is distinct from v_actor then
    raise exception 'review not found' using errcode = 'NZ404';
  end if;
  if v_task.status <> 'pending' then
    raise exception 'the review is already closed' using errcode = 'NZ436';
  end if;
  if v_task.submitted_by = v_actor then
    raise exception 'nobody reviews their own submission' using errcode = 'NZ437';
  end if;

  update public.moderation_tasks
  set status = p_decision, decided_by = v_actor, decided_at = now(), decision_note = v_note
  where id = p_task_id;
  update public.products
  set moderation_status = p_decision::text::public.moderation_status
  where id = v_task.product_id;
  insert into public.moderation_events (task_id, kind, actor_id, note)
  values (p_task_id, p_decision::text::public.moderation_event_kind, v_actor, v_note);
  perform private.audit(v_actor, 'moderation.decided', 'moderation_task', p_task_id::text,
    jsonb_build_object('decision', p_decision, 'productId', v_task.product_id));
  return p_decision;
end;
$$;

create function public.withdraw_moderation_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.update');
  v_task public.moderation_tasks;
begin
  select * into v_task from public.moderation_tasks where id = p_task_id for update;
  if not found then
    raise exception 'review not found' using errcode = 'NZ404';
  end if;
  if v_task.status <> 'pending' then
    raise exception 'the review is already closed' using errcode = 'NZ436';
  end if;

  update public.moderation_tasks
  set status = 'withdrawn', decided_by = v_actor, decided_at = now()
  where id = p_task_id;
  update public.products set moderation_status = 'not_submitted' where id = v_task.product_id;
  insert into public.moderation_events (task_id, kind, actor_id) values (p_task_id, 'withdrawn', v_actor);
  perform private.audit(v_actor, 'moderation.withdrawn', 'moderation_task', p_task_id::text,
    jsonb_build_object('productId', v_task.product_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Orders: fulfilment, cancellation and Cash-on-Delivery collection
-- ---------------------------------------------------------------------------

alter table public.orders
  add column payment_collected_at timestamptz,
  add column payment_collected_by uuid references public.profiles (id) on delete set null,
  add constraint orders_collection_consistent
    check ((payment_status = 'collected') = (payment_collected_at is not null));

create function public.admin_update_order_status(
  p_order_number text,
  p_status public.order_status,
  p_note text default null
)
returns public.order_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission(
    case when p_status = 'cancelled' then 'orders.cancel' else 'orders.update_status' end
  );
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_order public.orders;
  v_allowed boolean;
begin
  if p_status is null then
    raise exception 'a status is required' using errcode = 'NZ412';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'the note is too long' using errcode = 'NZ412';
  end if;
  if p_status = 'cancelled' and (v_note is null or char_length(v_note) < 5) then
    raise exception 'a reason is required to cancel an order' using errcode = 'NZ412';
  end if;

  select * into v_order from public.orders where order_number = p_order_number for update;
  if not found then
    raise exception 'order not found' using errcode = 'NZ404';
  end if;

  v_allowed := case v_order.status
    when 'pending' then p_status in ('confirmed', 'cancelled')
    when 'confirmed' then p_status in ('processing', 'cancelled')
    when 'processing' then p_status in ('shipped', 'cancelled')
    when 'shipped' then p_status = 'delivered'
    else false
  end;
  if not v_allowed then
    raise exception 'an order that is % cannot become %', v_order.status, p_status using errcode = 'NZ434';
  end if;

  if p_status = 'cancelled' then
    update public.orders
    set status = 'cancelled', payment_status = 'cancelled', cancelled_at = now(), cancel_reason = v_note
    where id = v_order.id;

    perform 1 from public.products
    where id in (select product_id from public.order_items where order_id = v_order.id)
    order by id
    for update;

    with restored as (
      update public.products p
      set stock_quantity = p.stock_quantity + oi.quantity
      from public.order_items oi
      where oi.order_id = v_order.id and p.id = oi.product_id
      returning p.id, oi.quantity, p.stock_quantity
    )
    insert into public.inventory_movements (product_id, change, stock_after, reason, order_id, actor_id)
    select restored.id, restored.quantity, restored.stock_quantity, 'order_cancelled', v_order.id, v_actor
    from restored;
  else
    update public.orders set status = p_status where id = v_order.id;
  end if;

  insert into public.order_status_history (order_id, from_status, to_status, actor_kind, actor_id, note)
  values (v_order.id, v_order.status, p_status, 'staff', v_actor, v_note);
  perform private.audit(v_actor, 'order.status_changed', 'order', p_order_number,
    jsonb_build_object('from', v_order.status, 'to', p_status));
  return p_status;
end;
$$;

create function public.admin_record_cod_collection(p_order_number text)
returns public.payment_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('payments.collect');
  v_order public.orders;
begin
  select * into v_order from public.orders where order_number = p_order_number for update;
  if not found then
    raise exception 'order not found' using errcode = 'NZ404';
  end if;
  if v_order.status <> 'delivered' or v_order.payment_status <> 'pending' then
    raise exception 'cash can be recorded only for a delivered order still awaiting payment'
      using errcode = 'NZ435';
  end if;

  update public.orders
  set payment_status = 'collected', payment_collected_at = now(), payment_collected_by = v_actor
  where id = v_order.id;
  perform private.audit(v_actor, 'order.payment_collected', 'order', p_order_number,
    jsonb_build_object('totalMinor', v_order.total_minor));
  return 'collected';
end;
$$;

-- ---------------------------------------------------------------------------
-- Settings and analytics
-- ---------------------------------------------------------------------------

create function public.admin_set_delivery_charge(p_zone public.delivery_zone, p_amount_minor bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_before bigint;
begin
  if p_zone is null or p_amount_minor is null or p_amount_minor not between 0 and 10000000 then
    raise exception 'the charge must be from 0 to 100,000 taka' using errcode = 'NZ412';
  end if;
  select amount_minor into v_before from public.delivery_charges where zone = p_zone;
  insert into public.delivery_charges (zone, amount_minor) values (p_zone, p_amount_minor)
  on conflict (zone) do update set amount_minor = excluded.amount_minor;
  perform private.audit(v_actor, 'settings.delivery_charge_changed', 'delivery_zone', p_zone::text,
    jsonb_build_object('fromMinor', v_before, 'toMinor', p_amount_minor));
end;
$$;

-- Sales over the last p_days days (Bangladesh calendar days). Cancelled orders are
-- counted separately and never as sales.
create function public.admin_sales_overview(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz;
  v_result jsonb;
begin
  perform private.require_permission('finance.read');
  if p_days is null or p_days not between 1 and 365 then
    raise exception 'choose 1 to 365 days' using errcode = 'NZ412';
  end if;
  v_since := (date_trunc('day', now() at time zone 'Asia/Dhaka') - make_interval(days => p_days - 1))
    at time zone 'Asia/Dhaka';

  with recent as (
    select * from public.orders where placed_at >= v_since
  ),
  days as (
    select generate_series(
      (v_since at time zone 'Asia/Dhaka')::date,
      (now() at time zone 'Asia/Dhaka')::date,
      interval '1 day'
    )::date as day
  )
  select jsonb_build_object(
    'days', p_days,
    'orderCount', (select count(*) from recent where status <> 'cancelled'),
    'cancelledCount', (select count(*) from recent where status = 'cancelled'),
    'salesMinor', (select coalesce(sum(total_minor), 0) from recent where status <> 'cancelled'),
    'collectedMinor', (select coalesce(sum(total_minor), 0) from recent where payment_status = 'collected'),
    'awaitingCollectionMinor', (
      select coalesce(sum(total_minor), 0) from public.orders
      where status = 'delivered' and payment_status = 'pending'
    ),
    'averageOrderMinor', (
      select coalesce(round(avg(total_minor))::bigint, 0) from recent where status <> 'cancelled'
    ),
    'byStatus', (
      select coalesce(jsonb_object_agg(s.status, s.count), '{}'::jsonb)
      from (select status, count(*) from public.orders group by status) s
    ),
    'daily', (
      select jsonb_agg(jsonb_build_object(
        'day', d.day,
        'orderCount', coalesce(x.order_count, 0),
        'salesMinor', coalesce(x.sales_minor, 0)
      ) order by d.day)
      from days d
      left join (
        select (placed_at at time zone 'Asia/Dhaka')::date as day,
          count(*) as order_count, sum(total_minor) as sales_minor
        from recent where status <> 'cancelled'
        group by 1
      ) x on x.day = d.day
    ),
    'topProducts', (
      select coalesce(jsonb_agg(t order by t."unitsSold" desc, t."productName"), '[]'::jsonb)
      from (
        select oi.product_id as "productId", min(oi.product_name) as "productName",
          sum(oi.quantity) as "unitsSold", sum(oi.line_total_minor) as "salesMinor"
        from public.order_items oi
        join recent o on o.id = oi.order_id and o.status <> 'cancelled'
        group by oi.product_id
        order by sum(oi.quantity) desc
        limit 5
      ) t
    )
  )
  into v_result;
  return v_result;
end;
$$;

-- The audit log with each actor's name and email.
create function public.admin_audit_log(
  p_action_prefix text default null,
  p_actor uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id bigint,
  actor_id uuid,
  actor_email text,
  actor_name text,
  action text,
  target_type text,
  target_id text,
  details jsonb,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('audit_logs.read');
  if p_limit not between 1 and 100 or p_offset not between 0 and 100000 then
    raise exception 'invalid page' using errcode = 'NZ412';
  end if;
  if p_action_prefix is not null and p_action_prefix !~ '^[a-z_.]{1,60}$' then
    raise exception 'invalid action filter' using errcode = 'NZ412';
  end if;
  return query
  select a.id, a.actor_id, u.email::text, p.full_name, a.action, a.target_type, a.target_id,
    a.details, a.created_at, count(*) over ()
  from public.audit_log a
  left join auth.users u on u.id = a.actor_id
  left join public.profiles p on p.id = a.actor_id
  where (p_action_prefix is null or a.action like p_action_prefix || '%')
    and (p_actor is null or a.actor_id = p_actor)
  order by a.created_at desc, a.id desc
  limit p_limit offset p_offset;
end;
$$;

-- Names and emails of reviewers and submitters, for the moderation screens.
create function public.admin_account_names(p_ids uuid[])
returns table (id uuid, email text, full_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    public.has_permission('moderation.assign') or public.has_permission('content.approve')
    or public.has_permission('products.update') or public.has_permission('orders.read')
  ) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;
  if p_ids is null or cardinality(p_ids) > 200 then
    raise exception 'too many accounts' using errcode = 'NZ412';
  end if;
  return query
  select p.id, u.email::text, p.full_name
  from public.profiles p
  join auth.users u on u.id = p.id
  join public.user_roles r on r.user_id = p.id and r.role <> 'customer'
  where p.id = any (p_ids);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on table public.permissions, public.role_permissions, public.user_permissions,
  public.audit_log, public.moderation_tasks, public.moderation_events
from public, anon, authenticated;

grant select, insert, update, delete on table public.permissions, public.role_permissions,
  public.user_permissions, public.audit_log, public.moderation_tasks, public.moderation_events
to service_role;

grant select on table public.permissions, public.role_permissions to authenticated;
grant select on table public.user_permissions, public.moderation_tasks, public.moderation_events
  to authenticated;
grant select on table public.inventory_movements to authenticated;
grant select (payment_collected_at) on table public.orders to authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.has_permission(text)',
    'public.my_access()',
    'public.admin_set_permission(uuid, text, public.permission_effect)',
    'public.admin_list_staff()',
    'public.admin_list_customers(text, public.profile_status, integer, integer)',
    'public.admin_set_account_status(uuid, public.profile_status, text)',
    'public.admin_create_product(uuid, text, text, text, text, text, bigint, bigint, integer, boolean, integer)',
    'public.admin_update_product(uuid, uuid, text, text, text, text, bigint, bigint, integer, boolean)',
    'public.admin_set_product_status(uuid, public.product_status)',
    'public.admin_adjust_stock(uuid, integer, text)',
    'public.admin_save_category(uuid, text, text, text, integer, boolean)',
    'public.submit_product_for_review(uuid)',
    'public.assign_moderation_task(uuid, uuid)',
    'public.decide_moderation_task(uuid, public.moderation_task_status, text)',
    'public.withdraw_moderation_task(uuid)',
    'public.admin_update_order_status(text, public.order_status, text)',
    'public.admin_record_cod_collection(text)',
    'public.admin_set_delivery_charge(public.delivery_zone, bigint)',
    'public.admin_sales_overview(integer)',
    'public.admin_audit_log(text, uuid, integer, integer)',
    'public.admin_account_names(uuid[])'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- assign_user_role stays service-role only (the API passes the verified actor).
revoke execute on function public.assign_user_role(uuid, uuid, public.app_role) from public, anon, authenticated;
grant execute on function public.assign_user_role(uuid, uuid, public.app_role) to service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security: staff reads, by permission. These add to the customer
-- policies (policies of one command are combined with OR).
-- ---------------------------------------------------------------------------

alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_permissions enable row level security;
alter table public.audit_log enable row level security;
alter table public.moderation_tasks enable row level security;
alter table public.moderation_events enable row level security;

create policy "Signed-in accounts read the permission list"
  on public.permissions for select to authenticated using (true);

create policy "Signed-in accounts read role defaults"
  on public.role_permissions for select to authenticated using (true);

create policy "Accounts read their own overrides; permission managers read all"
  on public.user_permissions for select to authenticated
  using ((select auth.uid()) = user_id or (select public.has_permission('staff.permissions.manage')));

create policy "Product staff read every product"
  on public.products for select to authenticated
  using ((select public.has_permission('products.read')));

create policy "Product staff read every category"
  on public.categories for select to authenticated
  using ((select public.has_permission('products.read')));

create policy "Product staff read the stock ledger"
  on public.inventory_movements for select to authenticated
  using ((select public.has_permission('products.read')));

create policy "Order staff read every order"
  on public.orders for select to authenticated
  using ((select public.has_permission('orders.read')));

create policy "Order staff read every order item"
  on public.order_items for select to authenticated
  using ((select public.has_permission('orders.read')));

create policy "Order staff read every order history"
  on public.order_status_history for select to authenticated
  using ((select public.has_permission('orders.read')));

create policy "Customer staff read profiles"
  on public.profiles for select to authenticated
  using ((select public.has_permission('customers.read')));

create policy "Reviewers read their assigned reviews; assigners and editors read all"
  on public.moderation_tasks for select to authenticated
  using (
    (assigned_to = (select auth.uid()) and (select public.has_permission('content.approve')))
    or (select public.has_permission('moderation.assign'))
    or (select public.has_permission('products.update'))
  );

create policy "Review history follows its review"
  on public.moderation_events for select to authenticated
  using (exists (select 1 from public.moderation_tasks t where t.id = task_id));

-- audit_log has no end-user policy: it is read through admin_audit_log() only.
