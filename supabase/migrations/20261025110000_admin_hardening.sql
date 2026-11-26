-- Hardening from the Phase 7 security review:
--   1. Changing the price, limits or featuring of a product ON SALE needs products.publish
--      (staff may still edit drafts freely).
--   2. Public reads of products never include who created or changed them.
--   3. Role assignment also honours the actor's effective permissions (a denial applies).
--   4. Separation of duties in moderation: whoever last changed the content cannot be
--      assigned or decide it; assigners cannot assign reviews to themselves (owners
--      excepted); only the submitter or an assigner may withdraw a review.
--   5. The stock ledger is read by stock and product editors only; customer staff read
--      customer profiles only.

-- ---------------------------------------------------------------------------
-- 1 and 4: who last changed the content, and live operational changes
-- ---------------------------------------------------------------------------

alter table public.products
  add column content_updated_by uuid references public.profiles (id) on delete set null;
update public.products set content_updated_by = created_by where content_updated_by is null;

alter table public.moderation_tasks
  add column content_editor uuid references public.profiles (id) on delete set null;

create or replace function public.admin_create_product(
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
    stock_quantity, max_order_quantity, is_featured, status, moderation_status,
    created_by, updated_by, content_updated_by
  ) values (
    p_category_id, p_slug, p_sku, btrim(p_name), nullif(btrim(coalesce(p_summary, '')), ''),
    nullif(btrim(coalesce(p_description, '')), ''), p_price_minor, p_compare_at_price_minor,
    p_initial_stock, coalesce(p_max_order_quantity, 10), coalesce(p_is_featured, false),
    'draft', 'not_submitted', v_actor, v_actor, v_actor
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

create or replace function public.admin_update_product(
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
  v_operations_changed boolean;
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
  v_operations_changed :=
    v_product.price_minor is distinct from p_price_minor
    or v_product.compare_at_price_minor is distinct from p_compare_at_price_minor
    or v_product.max_order_quantity is distinct from p_max_order_quantity
    or v_product.is_featured is distinct from coalesce(p_is_featured, false);

  if v_content_changed and v_product.status = 'active' then
    raise exception 'unpublish the product before changing its content' using errcode = 'NZ430';
  end if;
  if v_content_changed and v_product.moderation_status = 'pending' then
    raise exception 'the product is under review' using errcode = 'NZ431';
  end if;
  -- What shoppers pay for a product on sale is decided by publishers only.
  if v_operations_changed and v_product.status = 'active'
     and not exists (select 1 from private.permissions_of(v_actor) as x (name) where x.name = 'products.publish') then
    raise exception 'changing a product on sale needs products.publish' using errcode = 'NZ403';
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
      content_updated_by = case when v_content_changed then v_actor else content_updated_by end,
      updated_by = v_actor
  where id = p_product_id;

  perform private.audit(v_actor, 'product.updated', 'product', p_product_id::text,
    jsonb_build_object(
      'contentChanged', v_content_changed,
      'priceMinor', jsonb_build_object('from', v_product.price_minor, 'to', p_price_minor)
    ));
end;
$$;

create or replace function public.submit_product_for_review(p_product_id uuid)
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

  insert into public.moderation_tasks (product_id, content, submitted_by, content_editor)
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
    v_actor,
    coalesce(v_product.content_updated_by, v_product.created_by)
  )
  returning id into v_task;

  update public.products set moderation_status = 'pending', updated_by = v_actor where id = p_product_id;
  insert into public.moderation_events (task_id, kind, actor_id) values (v_task, 'submitted', v_actor);
  perform private.audit(v_actor, 'moderation.submitted', 'product', p_product_id::text,
    jsonb_build_object('taskId', v_task));
  return v_task;
end;
$$;

create or replace function public.assign_moderation_task(p_task_id uuid, p_moderator uuid)
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
  if p_moderator = v_task.submitted_by or p_moderator = v_task.content_editor then
    raise exception 'nobody reviews content they submitted or wrote' using errcode = 'NZ437';
  end if;
  -- Assigners hand reviews to others; only an owner may take one themselves.
  if p_moderator = v_actor
     and not exists (select 1 from public.user_roles where user_id = v_actor and role = 'super_admin') then
    raise exception 'assign the review to someone else' using errcode = 'NZ437';
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

create or replace function public.decide_moderation_task(
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
  if v_task.submitted_by = v_actor or v_task.content_editor = v_actor then
    raise exception 'nobody reviews content they submitted or wrote' using errcode = 'NZ437';
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

create or replace function public.withdraw_moderation_task(p_task_id uuid)
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
  -- The submitter takes their own submission back; assigners may withdraw any.
  if v_task.submitted_by is distinct from v_actor
     and not exists (select 1 from private.permissions_of(v_actor) as x (name) where x.name = 'moderation.assign') then
    raise exception 'only the submitter or an assigner can withdraw a review' using errcode = 'NZ403';
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
-- 2: public product reads never carry staff account ids
-- ---------------------------------------------------------------------------

revoke select on table public.products from anon, authenticated;
grant select (
  id, category_id, slug, sku, name, summary, description, price_minor, compare_at_price_minor,
  stock_quantity, max_order_quantity, status, is_featured, published_at, search, created_at,
  updated_at, moderation_status
) on table public.products to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3: role assignment honours the actor's effective permissions
-- ---------------------------------------------------------------------------

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

  -- An owner or admin who still holds a role permission (a denial removes it): changing
  -- roles, or inviting (which assigns the new account's role).
  if v_actor_role is null or v_actor_role not in ('super_admin', 'admin')
     or not exists (
       select 1 from private.permissions_of(p_actor_id) as x (name)
       where x.name in ('staff.roles.assign', 'staff.invite')
     ) then
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

revoke execute on function public.assign_user_role(uuid, uuid, public.app_role) from public, anon, authenticated;
grant execute on function public.assign_user_role(uuid, uuid, public.app_role) to service_role;

-- ---------------------------------------------------------------------------
-- 5: narrower staff reads
-- ---------------------------------------------------------------------------

drop policy "Product staff read the stock ledger" on public.inventory_movements;
create policy "Stock and product editors read the stock ledger"
  on public.inventory_movements for select to authenticated
  using (
    (select public.has_permission('inventory.adjust'))
    or (select public.has_permission('products.update'))
  );

-- Role rows are readable by their owner only, so the policy asks through a definer
-- function. It answers only callers holding customers.read, so it reveals no roles.
create function public.can_read_customer_profile(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission('customers.read')
    and exists (select 1 from public.user_roles r where r.user_id = p_id and r.role = 'customer');
$$;

revoke execute on function public.can_read_customer_profile(uuid) from public, anon, authenticated;
grant execute on function public.can_read_customer_profile(uuid) to authenticated;

drop policy "Customer staff read profiles" on public.profiles;
create policy "Customer staff read customer profiles"
  on public.profiles for select to authenticated
  using (public.can_read_customer_profile(id));

-- ---------------------------------------------------------------------------
-- Staff invitations: which are still pending, and resending one
-- ---------------------------------------------------------------------------

drop function public.admin_list_staff();
create function public.admin_list_staff()
returns table (
  id uuid,
  email text,
  full_name text,
  role public.app_role,
  status public.profile_status,
  granted_at timestamptz,
  overrides jsonb,
  permissions jsonb,
  invitation_pending boolean
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
    ),
    -- Invited accounts confirm their address when they accept and set a password.
    u.email_confirmed_at is null
  from public.profiles p
  join public.user_roles r on r.user_id = p.id
  join auth.users u on u.id = p.id
  where r.role <> 'customer'
  order by array_position(array['super_admin', 'admin', 'staff', 'moderator']::public.app_role[], r.role), u.email;
end;
$$;

-- Checked and recorded as the caller before the server sends the email again: the
-- account must still be an unaccepted invitation, for a role the caller may invite.
create function public.admin_prepare_invitation_resend(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('staff.invite');
  v_actor_role public.app_role;
  v_role public.app_role;
  v_email text;
  v_confirmed timestamptz;
begin
  select r.role, u.email::text, u.email_confirmed_at into v_role, v_email, v_confirmed
  from public.user_roles r
  join public.profiles p on p.id = r.user_id
  join auth.users u on u.id = r.user_id
  where r.user_id = p_user_id and r.role <> 'customer' and p.status = 'active';
  if not found then
    raise exception 'invitation not found' using errcode = 'NZ404';
  end if;
  if v_confirmed is not null then
    raise exception 'the invitation was already accepted' using errcode = 'NZ412';
  end if;

  select role into v_actor_role from public.user_roles where user_id = v_actor;
  if v_role = 'super_admin' or (v_role = 'admin' and v_actor_role <> 'super_admin') then
    raise exception 'only an owner can invite admins' using errcode = 'NZ403';
  end if;

  perform private.audit(v_actor, 'staff.invitation_resent', 'account', p_user_id::text,
    jsonb_build_object('role', v_role));
  return v_email;
end;
$$;

revoke execute on function public.admin_list_staff() from public, anon, authenticated;
revoke execute on function public.admin_prepare_invitation_resend(uuid) from public, anon, authenticated;
grant execute on function public.admin_list_staff() to authenticated;
grant execute on function public.admin_prepare_invitation_resend(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Category product counts
-- ---------------------------------------------------------------------------

-- PostgREST's embedded products(count) reads whole product rows, which the column
-- grants above no longer allow; this computed column counts in SQL instead. It runs
-- as the caller, so the count covers exactly the products the caller may read.
create function public.product_count(p_category public.categories)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*) from public.products p where p.category_id = p_category.id;
$$;

revoke execute on function public.product_count(public.categories) from public, anon, authenticated;
grant execute on function public.product_count(public.categories) to authenticated;
