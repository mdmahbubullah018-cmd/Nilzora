-- Staff, moderator and admin invitations that grant nothing until they are accepted.
--
-- An invitation is only a pending record: sending one creates no account and assigns no role. The
-- role is granted at acceptance, by the same assign_user_role the owner uses, after the token, its
-- expiry, its status and the invitee's verified email have all been checked. Tokens are random,
-- single-use and stored only as a hash. All access is through the functions below (the table has
-- row level security and no policy, so no client can read or write it directly).
--
-- Additive: one table and eight functions. The older Supabase-invite columns and functions
-- (auth_invitations, issue_invitation, consume_invitation) are left exactly as they are, so an
-- invitation sent before this migration can still be accepted through its own link.

create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and char_length(email) between 3 and 254),
  full_name text check (full_name is null or char_length(full_name) between 1 and 120),
  role public.app_role not null check (role in ('staff', 'moderator', 'admin')),
  token_hash bytea not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  last_sent_at timestamptz not null default now(),
  send_count integer not null default 1 check (send_count >= 1),
  accepted_at timestamptz,
  accepted_user_id uuid references public.profiles (id),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  constraint staff_invitations_accepted_state check ((status = 'accepted') = (accepted_at is not null)),
  constraint staff_invitations_revoked_state check ((status = 'revoked') = (revoked_at is not null))
);

-- One live invitation per address and role: a second one is refused, not silently duplicated.
create unique index staff_invitations_one_pending on public.staff_invitations (email, role)
  where status = 'pending';
create index staff_invitations_created_idx on public.staff_invitations (created_at desc);

alter table public.staff_invitations enable row level security;
revoke all on public.staff_invitations from anon, authenticated;

/** Creates a pending invitation; only the owner may. Answers what the email needs. */
create or replace function public.admin_create_staff_invitation(
  p_email text,
  p_full_name text,
  p_role public.app_role,
  p_token_hash bytea,
  p_ttl interval default interval '7 days'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('staff.invite');
  v_actor_role public.app_role;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_id uuid;
  v_expires timestamptz;
  v_inviter text;
begin
  select r.role into v_actor_role from public.user_roles r where r.user_id = v_actor;
  if v_actor_role is distinct from 'super_admin' then
    raise exception 'only the owner can invite staff' using errcode = 'NZ403';
  end if;
  if p_role is null or p_role not in ('staff', 'moderator', 'admin') then
    raise exception 'choose staff, moderator or admin' using errcode = 'NZ412';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(v_email) > 254 then
    raise exception 'enter a valid email address' using errcode = 'NZ412';
  end if;
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    raise exception 'the invitation token is invalid' using errcode = 'NZ412';
  end if;
  if p_ttl is null or p_ttl < interval '1 hour' or p_ttl > interval '30 days' then
    raise exception 'the invitation lifetime is out of range' using errcode = 'NZ412';
  end if;

  -- A person who already holds a role other than customer is not invited again: the invitation
  -- could not change that account, and refusing keeps its permissions from being overwritten.
  if exists (
    select 1
    from public.profiles p
    join public.user_roles r on r.user_id = p.id
    where lower(p.email) = v_email and r.role <> 'customer'
  ) then
    raise exception 'this person already has a staff account' using errcode = 'NZ442';
  end if;

  update public.staff_invitations
     set status = 'expired'
   where email = v_email and role = p_role and status = 'pending' and expires_at <= now();
  if exists (
    select 1 from public.staff_invitations
    where email = v_email and role = p_role and status = 'pending'
  ) then
    raise exception 'an invitation for this address and role is already pending' using errcode = 'NZ442';
  end if;

  v_expires := now() + p_ttl;
  insert into public.staff_invitations (email, full_name, role, token_hash, expires_at, created_by)
  values (v_email, v_name, p_role, p_token_hash, v_expires, v_actor)
  returning id into v_id;

  -- The log names the invitation and the role, never the address or the token.
  perform private.audit(v_actor, 'staff.invitation_created', 'staff_invitation', v_id::text,
    jsonb_build_object('role', p_role));

  select coalesce(nullif(btrim(p.full_name), ''), 'The Nilzora team') into v_inviter
  from public.profiles p where p.id = v_actor;

  return jsonb_build_object(
    'id', v_id, 'email', v_email, 'fullName', v_name, 'role', p_role,
    'expiresAt', v_expires, 'inviterName', v_inviter);
end;
$$;

/** The invitations, newest first, with the state an administrator sees (expired is derived). */
create or replace function public.admin_list_staff_invitations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('staff.invite');
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x."createdAt" desc)
    from (
      select i.id,
             i.email,
             i.full_name as "fullName",
             i.role,
             case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end as status,
             i.created_at as "createdAt",
             i.expires_at as "expiresAt",
             i.accepted_at as "acceptedAt",
             i.revoked_at as "revokedAt",
             i.send_count as "sendCount",
             coalesce(nullif(btrim(p.full_name), ''), 'The Nilzora team') as "invitedBy"
      from public.staff_invitations i
      left join public.profiles p on p.id = i.created_by
      order by i.created_at desc
      limit 200
    ) x
  ), '[]'::jsonb);
end;
$$;

/** Withdraws a pending invitation: its link stops working at once. */
create or replace function public.admin_revoke_staff_invitation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('staff.invite');
  v_row public.staff_invitations;
begin
  select * into v_row from public.staff_invitations where id = p_id for update;
  if not found then
    raise exception 'invitation not found' using errcode = 'NZ404';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'only a pending invitation can be revoked' using errcode = 'NZ412';
  end if;
  update public.staff_invitations
     set status = 'revoked', revoked_at = now(), revoked_by = v_actor
   where id = p_id;
  perform private.audit(v_actor, 'staff.invitation_revoked', 'staff_invitation', p_id::text,
    jsonb_build_object('role', v_row.role));
end;
$$;

/**
 * Sends an invitation again with a fresh token and a fresh expiry (the old link stops working).
 * Allowed for a pending or an expired invitation, never for an accepted or revoked one.
 */
create or replace function public.admin_reissue_staff_invitation(
  p_id uuid,
  p_token_hash bytea,
  p_ttl interval default interval '7 days'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('staff.invite');
  v_actor_role public.app_role;
  v_row public.staff_invitations;
  v_expires timestamptz;
  v_inviter text;
begin
  select r.role into v_actor_role from public.user_roles r where r.user_id = v_actor;
  if v_actor_role is distinct from 'super_admin' then
    raise exception 'only the owner can invite staff' using errcode = 'NZ403';
  end if;
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    raise exception 'the invitation token is invalid' using errcode = 'NZ412';
  end if;
  if p_ttl is null or p_ttl < interval '1 hour' or p_ttl > interval '30 days' then
    raise exception 'the invitation lifetime is out of range' using errcode = 'NZ412';
  end if;
  select * into v_row from public.staff_invitations where id = p_id for update;
  if not found then
    raise exception 'invitation not found' using errcode = 'NZ404';
  end if;
  if v_row.status in ('accepted', 'revoked') then
    raise exception 'this invitation can no longer be sent again' using errcode = 'NZ412';
  end if;

  v_expires := now() + p_ttl;
  update public.staff_invitations
     set token_hash = p_token_hash, status = 'pending', expires_at = v_expires,
         last_sent_at = now(), send_count = send_count + 1
   where id = p_id;
  perform private.audit(v_actor, 'staff.invitation_resent', 'staff_invitation', p_id::text,
    jsonb_build_object('role', v_row.role));

  select coalesce(nullif(btrim(p.full_name), ''), 'The Nilzora team') into v_inviter
  from public.profiles p where p.id = v_actor;
  return jsonb_build_object(
    'id', p_id, 'email', v_row.email, 'fullName', v_row.full_name, 'role', v_row.role,
    'expiresAt', v_expires, 'inviterName', v_inviter);
end;
$$;

/** What an invitee sees before accepting. Null unless the token is pending and unexpired. */
create or replace function public.staff_invitation_preview(p_token_hash bytea)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'email', i.email,
    'fullName', i.full_name,
    'role', i.role,
    'expiresAt', i.expires_at,
    'inviterName', coalesce(nullif(btrim(p.full_name), ''), 'The Nilzora team'),
    'accountExists', exists (select 1 from public.profiles x where lower(x.email) = i.email)
  )
  from public.staff_invitations i
  left join public.profiles p on p.id = i.created_by
  where i.token_hash = p_token_hash and i.status = 'pending' and i.expires_at > now();
$$;

/**
 * Accepts an invitation for an account whose email is the invited address. In one transaction:
 * the token must be pending and unexpired, the account must be active and hold no staff role yet,
 * and the owner who invited must still be able to hand the role out; only then is the role
 * granted (by assign_user_role) and the invitation closed. Anything else changes nothing.
 */
create or replace function public.accept_staff_invitation(p_token_hash bytea, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.staff_invitations;
  v_profile public.profiles;
  v_current public.app_role;
begin
  select * into v_row from public.staff_invitations where token_hash = p_token_hash for update;
  if not found or v_row.status <> 'pending' or v_row.expires_at <= now() then
    raise exception 'this invitation is no longer valid' using errcode = 'NZ412';
  end if;

  select * into v_profile from public.profiles where id = p_user_id;
  if not found or lower(coalesce(v_profile.email, '')) <> v_row.email then
    raise exception 'this invitation was sent to a different address' using errcode = 'NZ412';
  end if;
  if v_profile.status <> 'active' then
    raise exception 'this account cannot accept an invitation' using errcode = 'NZ412';
  end if;

  select r.role into v_current from public.user_roles r where r.user_id = p_user_id for update;
  if v_current is null then
    raise exception 'account not found' using errcode = 'NZ404';
  end if;
  if v_current <> 'customer' then
    raise exception 'this account already has a role' using errcode = 'NZ442';
  end if;

  -- The role is handed out exactly as the owner would: refused if the inviter is no longer an
  -- active owner allowed to invite.
  perform public.assign_user_role(v_row.created_by, p_user_id, v_row.role);

  update public.staff_invitations
     set status = 'accepted', accepted_at = now(), accepted_user_id = p_user_id
   where id = v_row.id;
  perform private.audit(p_user_id, 'staff.invitation_accepted', 'staff_invitation', v_row.id::text,
    jsonb_build_object('role', v_row.role));

  return jsonb_build_object('role', v_row.role);
end;
$$;

revoke execute on function public.admin_create_staff_invitation(text, text, public.app_role, bytea, interval) from public, anon, authenticated;
revoke execute on function public.admin_list_staff_invitations() from public, anon, authenticated;
revoke execute on function public.admin_revoke_staff_invitation(uuid) from public, anon, authenticated;
revoke execute on function public.admin_reissue_staff_invitation(uuid, bytea, interval) from public, anon, authenticated;
revoke execute on function public.staff_invitation_preview(bytea) from public, anon, authenticated;
revoke execute on function public.accept_staff_invitation(bytea, uuid) from public, anon, authenticated;

grant execute on function public.admin_create_staff_invitation(text, text, public.app_role, bytea, interval) to authenticated;
grant execute on function public.admin_list_staff_invitations() to authenticated;
grant execute on function public.admin_revoke_staff_invitation(uuid) to authenticated;
grant execute on function public.admin_reissue_staff_invitation(uuid, bytea, interval) to authenticated;
-- The public acceptance path runs as the API's service role, after it has verified the invitee.
grant execute on function public.staff_invitation_preview(bytea) to service_role;
grant execute on function public.accept_staff_invitation(bytea, uuid) to service_role;
