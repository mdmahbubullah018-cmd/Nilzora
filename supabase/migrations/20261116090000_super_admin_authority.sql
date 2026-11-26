-- ---------------------------------------------------------------------------
-- Super Admin: one server-side authority, and publishing without a review
--
-- Why: a product can only be published once its content is approved
-- (products_active_approved, NZ432 in admin_set_product_status), and nobody may
-- approve content they submitted or wrote (NZ437 in decide_moderation_task). An
-- owner who created a product could therefore submit it, watch it enter review and
-- never publish it: the store owner had no path to a live product without a second
-- account. The fix is a super-admin path, not a looser workflow.
--
-- 1. private.is_super_admin(): the server-side answer to "is this the owner?", read
--    from user_roles. Never from a claim, user metadata or anything a request carries.
-- 2. private.permissions_of(): a super admin holds every permission in the catalogue,
--    minus explicit denials, so a permission added by a later migration can never be
--    silently missing from the owner's account. Every other account keeps exactly what
--    it has today (role defaults + grants - denials).
-- 3. admin_set_product_status(): when a super admin explicitly publishes content that
--    is not approved, the publish itself approves it (moderation_status and status in
--    one statement, so the check constraint holds), any pending review of that product
--    is closed as approved and the decision is audited. Everyone else still gets NZ432.
-- 4. decide_moderation_task() and assign_moderation_task(): a super admin may take and
--    decide the review of their own submission; nobody else may.
--
-- Additive: one helper, three function replacements. No table, column, policy or grant
-- is dropped, and every existing role keeps its current effective permissions.
-- ---------------------------------------------------------------------------

/** Whether the account holds the protected super_admin role right now. */
create or replace function private.is_super_admin(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null
    and exists (
      select 1 from public.user_roles r
      where r.user_id = p_user and r.role = 'super_admin'
    );
$$;

comment on function private.is_super_admin(uuid) is
  'True when the account holds the super_admin role in user_roles. The only authority check for owner-only actions.';

revoke all on function private.is_super_admin(uuid) from public;

-- The effective permissions of an account. Super admin: the whole catalogue, minus
-- explicit denials. Everyone else: role defaults plus grants, minus denials.
create or replace function private.permissions_of(p_user uuid)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.is_super_admin(p_user)
     and exists (select 1 from public.profiles p where p.id = p_user and p.status = 'active') then
    return query
      select all_permissions.name
      from public.permissions as all_permissions
      except
      select up.permission
      from public.user_permissions up
      where up.user_id = p_user and up.effect = 'deny';
    return;
  end if;

  return query
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
end;
$$;

comment on function private.permissions_of(uuid) is
  'Effective permissions. A super admin holds the whole catalogue (minus explicit denials); everyone else keeps role defaults + grants - denials.';

-- Publishing: approved content only, unless the owner publishes it themselves.
create or replace function public.admin_set_product_status(p_product_id uuid, p_status public.product_status)
returns public.product_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.publish');
  v_product public.products;
  v_owner_publish boolean := false;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product not found' using errcode = 'NZ404';
  end if;

  if p_status = 'active' and v_product.moderation_status <> 'approved' then
    if not private.is_super_admin(v_actor) then
      raise exception 'only approved content can be published' using errcode = 'NZ432';
    end if;
    -- The owner publishing is the approval: both columns move together so
    -- products_active_approved holds at every point in the statement.
    v_owner_publish := true;
  end if;

  update public.products
  set status = p_status,
      moderation_status = case when v_owner_publish then 'approved' else moderation_status end,
      updated_by = v_actor
  where id = p_product_id;

  if v_owner_publish then
    with closed as (
      update public.moderation_tasks
      set status = 'approved',
          decided_by = v_actor,
          decided_at = now(),
          decision_note = 'Published directly by the store owner.'
      where product_id = p_product_id and status = 'pending'
      returning id
    )
    insert into public.moderation_events (task_id, kind, actor_id, note)
    select closed.id, 'approved', v_actor, 'Published directly by the store owner.'
    from closed;

    perform private.audit(v_actor, 'moderation.approved', 'product', p_product_id::text,
      jsonb_build_object('implicit', true, 'by', 'owner_publish'));
  end if;

  perform private.audit(v_actor, 'product.status_changed', 'product', p_product_id::text,
    jsonb_build_object(
      'from', v_product.status,
      'to', p_status,
      'approvedOnPublish', v_owner_publish
    ));
  return p_status;
end;
$$;

-- Reviews: independent review stays the rule; the owner may take and decide their own.
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
  -- The owner answers for their own content; nobody else reviews what they submitted or wrote.
  if (p_moderator = v_task.submitted_by or p_moderator = v_task.content_editor)
     and not private.is_super_admin(p_moderator) then
    raise exception 'nobody reviews content they submitted or wrote' using errcode = 'NZ437';
  end if;
  -- Assigners hand reviews to others; only an owner may take one themselves.
  if p_moderator = v_actor and not private.is_super_admin(v_actor) then
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
  if (v_task.submitted_by = v_actor or v_task.content_editor = v_actor)
     and not private.is_super_admin(v_actor) then
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
