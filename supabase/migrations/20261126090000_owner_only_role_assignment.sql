-- ---------------------------------------------------------------------------
-- User management: only the owner (super_admin) creates system users and assigns roles
--
-- Until now an admin holding staff.roles.assign or staff.invite could appoint staff and
-- moderators, and an owner could appoint another owner. The rule is now:
--
--   * Only an active super_admin may assign any role (staff invitations assign the new
--     account's role through this function, so they follow the same rule).
--   * Nobody may assign the super_admin role through this function. Owners are created
--     only by the bootstrap_owner path, never from the admin interface.
--   * The existing guards stay: nobody changes their own role, the last owner cannot be
--     demoted, and a role assignment still needs staff.roles.assign or staff.invite
--     (an explicit denial removes it, even from an owner).
--
-- Additive: one function replacement with the same signature and grants. No table,
-- policy, permission or role default changes.
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

  if v_actor_role is null
     or not exists (
       select 1 from private.permissions_of(p_actor_id) as x (name)
       where x.name in ('staff.roles.assign', 'staff.invite')
     ) then
    raise exception 'the acting account may not assign roles' using errcode = 'NZ002';
  end if;

  -- Only the owner creates system users and assigns roles.
  if v_actor_role <> 'super_admin' then
    raise exception 'only the owner can assign roles' using errcode = 'NZ003';
  end if;

  -- The owner role is never handed out from the admin interface.
  if p_role = 'super_admin' then
    raise exception 'the owner role cannot be assigned' using errcode = 'NZ005';
  end if;

  select role into v_target_role from public.user_roles where user_id = p_target_id for update;
  if v_target_role is null then
    raise exception 'target account not found' using errcode = 'NZ404';
  end if;

  if v_target_role = 'super_admin'
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
