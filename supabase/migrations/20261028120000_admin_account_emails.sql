-- Admin account lists read the sign-in address from public.profiles.
--
-- Since the identity cutover, an application account is a `profiles` row: `auth.users`
-- is only kept for the legacy Supabase Auth fallback and no longer has a row for accounts
-- created by first-party registration. These functions previously joined `auth.users` for
-- the email, which silently dropped every new account from staff, customer, reviewer and
-- audit lists. `profiles.email` is authoritative, so they now read it, with `auth.users`
-- joined optionally for databases that still hold legacy accounts.
--
-- Behaviour that does not change: signatures, return types, permission checks, ordering,
-- audit writes and the rows an account may see. "Confirmed" now means
-- `profiles.email_verified_at`, which the cutover migration backfilled from
-- `auth.users.email_confirmed_at`, so pending invitations stay pending.

create or replace function public.admin_list_staff()
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
  select p.id, coalesce(p.email, u.email)::text, p.full_name, r.role, p.status, r.granted_at,
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
    p.email_verified_at is null
  from public.profiles p
  join public.user_roles r on r.user_id = p.id
  left join auth.users u on u.id = p.id
  where r.role <> 'customer'
  order by array_position(array['super_admin', 'admin', 'staff', 'moderator']::public.app_role[], r.role),
           coalesce(p.email, u.email);
end;
$$;

create or replace function public.admin_prepare_invitation_resend(p_user_id uuid)
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
  select r.role, coalesce(p.email, u.email)::text, p.email_verified_at into v_role, v_email, v_confirmed
  from public.user_roles r
  join public.profiles p on p.id = r.user_id
  left join auth.users u on u.id = r.user_id
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
revoke execute on function public.admin_prepare_invitation_resend(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_list_staff() to authenticated;
grant execute on function public.admin_prepare_invitation_resend(uuid) to authenticated;
