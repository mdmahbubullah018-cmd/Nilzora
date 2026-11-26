-- Two-factor authentication (TOTP) for super_admin accounts.
--
-- What lives where:
--   * The TOTP secret is encrypted by the API (AES-256-GCM, key from TWO_FACTOR_ENCRYPTION_KEY)
--     before it reaches the database; only ciphertext is stored here. The database never sees
--     the key, so a database dump alone cannot produce codes.
--   * Recovery codes are random and high-entropy; only their SHA-256 hashes are stored, and each
--     can be used once.
--   * A sign-in that passed 2FA is recorded per session FAMILY (auth_sessions.family_id), so the
--     refresh-token rotation (which keeps the family) keeps the verification, and signing out or a
--     detected refresh-token replay (which revokes the family) ends it.
--   * Replay protection: the last accepted TOTP time step is stored; a code for that step or an
--     earlier one is refused, so an observed code cannot be used twice.
--   * Failed attempts lock verification for 15 minutes after 5 failures (per account).
--
-- Every function is SECURITY DEFINER with an empty search_path and is executable by the service
-- role only: the API's first-party auth service calls them after it has authenticated the caller.
-- The tables have RLS on and no policies, so no end-user role can read or write them.
-- Additive only: three new tables, new functions, no change to existing objects.

create table public.admin_two_factor (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- "v1:" + base64(iv | auth tag | ciphertext); the version names the key, for rotation.
  secret_ciphertext text not null check (char_length(secret_ciphertext) between 20 and 500),
  status text not null check (status in ('pending', 'active')),
  last_used_step bigint,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint admin_two_factor_active_has_date check ((status = 'active') = (activated_at is not null))
);

create table public.admin_two_factor_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  code_hash bytea not null unique check (octet_length(code_hash) = 32),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  revoked_at timestamptz
);
create index admin_two_factor_recovery_codes_user_idx
  on public.admin_two_factor_recovery_codes (user_id) where used_at is null and revoked_at is null;

create table public.auth_session_mfa (
  family_id uuid primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  verified_at timestamptz not null default now(),
  method text not null check (method in ('totp', 'recovery_code'))
);
create index auth_session_mfa_user_idx on public.auth_session_mfa (user_id);

alter table public.admin_two_factor enable row level security;
alter table public.admin_two_factor_recovery_codes enable row level security;
alter table public.auth_session_mfa enable row level security;
revoke all on table public.admin_two_factor, public.admin_two_factor_recovery_codes,
  public.auth_session_mfa from public, anon, authenticated;

-- Which accounts must use 2FA. One place, so adding a role later is a one-line change.
create function private.two_factor_required(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur where ur.user_id = p_user and ur.role = 'super_admin'
  );
$$;

/** The account's 2FA state for one session. */
create function public.two_factor_status(p_user uuid, p_session uuid)
returns table (
  required boolean,
  enrolled boolean,
  pending boolean,
  verified boolean,
  locked_until timestamptz,
  session_issued_at timestamptz,
  recovery_codes_left integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.two_factor_required(p_user),
    coalesce(tf.status = 'active', false),
    coalesce(tf.status = 'pending', false),
    exists (
      select 1 from public.auth_session_mfa m
      join public.auth_sessions s on s.family_id = m.family_id
      where s.id = p_session and s.user_id = p_user and m.user_id = p_user
    ),
    case when tf.locked_until > now() then tf.locked_until end,
    (select s.issued_at from public.auth_sessions s where s.id = p_session and s.user_id = p_user),
    (select count(*)::integer from public.admin_two_factor_recovery_codes rc
      where rc.user_id = p_user and rc.used_at is null and rc.revoked_at is null)
  from (select 1) as one
  left join public.admin_two_factor tf on tf.user_id = p_user;
$$;

/** Starts (or restarts) enrollment with a new encrypted secret. Refused while 2FA is active. */
create function public.two_factor_begin(p_user uuid, p_ciphertext text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.admin_two_factor where user_id = p_user and status = 'active') then
    raise exception 'two-factor authentication is already active' using errcode = 'NZ409';
  end if;
  insert into public.admin_two_factor (user_id, secret_ciphertext, status)
  values (p_user, p_ciphertext, 'pending')
  on conflict (user_id) do update
    set secret_ciphertext = excluded.secret_ciphertext, status = 'pending', last_used_step = null,
        failed_attempts = 0, locked_until = null, activated_at = null, updated_at = now();
  perform private.audit(p_user, 'two_factor.enrollment_started', 'profile', p_user::text, '{}'::jsonb);
end;
$$;

/** What the API needs to check a code: the ciphertext and the replay and lock state. */
create function public.two_factor_material(p_user uuid)
returns table (secret_ciphertext text, status text, last_used_step bigint, locked_until timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select tf.secret_ciphertext, tf.status, tf.last_used_step,
         case when tf.locked_until > now() then tf.locked_until end
  from public.admin_two_factor tf where tf.user_id = p_user;
$$;

/**
 * Records a TOTP code the API has checked, atomically with the replay check: false when that
 * time step (or a later one) was already used. With p_activate it also turns a pending enrollment
 * on and stores the recovery-code hashes. Marks the session's family as verified.
 */
create function public.two_factor_confirm(
  p_user uuid,
  p_session uuid,
  p_step bigint,
  p_activate boolean,
  p_recovery_hashes bytea[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tf public.admin_two_factor;
  v_family uuid;
begin
  select * into v_tf from public.admin_two_factor where user_id = p_user for update;
  if not found then
    raise exception 'two-factor authentication is not set up' using errcode = 'NZ404';
  end if;
  if v_tf.locked_until > now() then
    raise exception 'too many attempts' using errcode = 'NZ429';
  end if;
  if v_tf.last_used_step is not null and p_step <= v_tf.last_used_step then
    return false;
  end if;
  select s.family_id into v_family from public.auth_sessions s
   where s.id = p_session and s.user_id = p_user and s.revoked_at is null and s.expires_at > now();
  if v_family is null then
    raise exception 'session not found' using errcode = 'NZ404';
  end if;

  if p_activate then
    if v_tf.status <> 'pending' then
      raise exception 'there is no enrollment to confirm' using errcode = 'NZ409';
    end if;
    if coalesce(cardinality(p_recovery_hashes), 0) <> 10 then
      raise exception 'ten recovery codes are required' using errcode = 'NZ412';
    end if;
    update public.admin_two_factor_recovery_codes set revoked_at = now()
     where user_id = p_user and used_at is null and revoked_at is null;
    insert into public.admin_two_factor_recovery_codes (user_id, code_hash)
    select p_user, h from unnest(p_recovery_hashes) as h;
    update public.admin_two_factor
       set status = 'active', activated_at = now(), last_used_step = p_step,
           failed_attempts = 0, locked_until = null, updated_at = now()
     where user_id = p_user;
    perform private.audit(p_user, 'two_factor.activated', 'profile', p_user::text, '{}'::jsonb);
  else
    if v_tf.status <> 'active' then
      raise exception 'two-factor authentication is not active' using errcode = 'NZ412';
    end if;
    update public.admin_two_factor
       set last_used_step = p_step, failed_attempts = 0, locked_until = null, updated_at = now()
     where user_id = p_user;
    perform private.audit(p_user, 'two_factor.verified', 'profile', p_user::text,
      jsonb_build_object('method', 'totp'));
  end if;

  insert into public.auth_session_mfa (family_id, user_id, method)
  values (v_family, p_user, 'totp')
  on conflict (family_id) do update set verified_at = now(), method = 'totp'
    where public.auth_session_mfa.user_id = p_user;
  return true;
end;
$$;

/** Counts a failed code. Five in a row lock verification for 15 minutes. Returns the lock end. */
create function public.two_factor_record_failure(p_user uuid, p_reason text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
  v_locked timestamptz;
begin
  update public.admin_two_factor
     set failed_attempts = failed_attempts + 1, updated_at = now()
   where user_id = p_user
   returning failed_attempts into v_attempts;
  if v_attempts is null then return null; end if;
  if v_attempts >= 5 then
    v_locked := now() + interval '15 minutes';
    update public.admin_two_factor set locked_until = v_locked, failed_attempts = 0
     where user_id = p_user;
    perform private.audit(p_user, 'two_factor.locked', 'profile', p_user::text,
      jsonb_build_object('until', v_locked));
  end if;
  perform private.audit(p_user, 'two_factor.verification_failed', 'profile', p_user::text,
    jsonb_build_object('reason', left(coalesce(p_reason, 'invalid_code'), 40)));
  return v_locked;
end;
$$;

/** Spends one recovery code (by hash) for this session. -1 when it is unknown or used. */
create function public.two_factor_use_recovery_code(p_user uuid, p_session uuid, p_hash bytea)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tf public.admin_two_factor;
  v_code uuid;
  v_family uuid;
  v_left integer;
begin
  select * into v_tf from public.admin_two_factor where user_id = p_user for update;
  if not found or v_tf.status <> 'active' then
    raise exception 'two-factor authentication is not active' using errcode = 'NZ412';
  end if;
  if v_tf.locked_until > now() then
    raise exception 'too many attempts' using errcode = 'NZ429';
  end if;
  select s.family_id into v_family from public.auth_sessions s
   where s.id = p_session and s.user_id = p_user and s.revoked_at is null and s.expires_at > now();
  if v_family is null then
    raise exception 'session not found' using errcode = 'NZ404';
  end if;

  update public.admin_two_factor_recovery_codes set used_at = now()
   where id = (
     select rc.id from public.admin_two_factor_recovery_codes rc
      where rc.user_id = p_user and rc.code_hash = p_hash and rc.used_at is null and rc.revoked_at is null
      for update
   )
  returning id into v_code;
  if v_code is null then return -1; end if;

  update public.admin_two_factor set failed_attempts = 0, locked_until = null, updated_at = now()
   where user_id = p_user;
  insert into public.auth_session_mfa (family_id, user_id, method)
  values (v_family, p_user, 'recovery_code')
  on conflict (family_id) do update set verified_at = now(), method = 'recovery_code'
    where public.auth_session_mfa.user_id = p_user;
  select count(*)::integer into v_left from public.admin_two_factor_recovery_codes
   where user_id = p_user and used_at is null and revoked_at is null;
  perform private.audit(p_user, 'two_factor.recovery_code_used', 'profile', p_user::text,
    jsonb_build_object('codes_left', v_left));
  return v_left;
end;
$$;

/** Replaces the unused recovery codes; only from a session that passed 2FA. */
create function public.two_factor_replace_recovery_codes(p_user uuid, p_session uuid, p_hashes bytea[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(cardinality(p_hashes), 0) <> 10 then
    raise exception 'ten recovery codes are required' using errcode = 'NZ412';
  end if;
  if not exists (
    select 1 from public.auth_session_mfa m join public.auth_sessions s on s.family_id = m.family_id
     where s.id = p_session and s.user_id = p_user and m.user_id = p_user
  ) or not exists (select 1 from public.admin_two_factor where user_id = p_user and status = 'active') then
    raise exception 'verify two-factor authentication first' using errcode = 'NZ403';
  end if;
  update public.admin_two_factor_recovery_codes set revoked_at = now()
   where user_id = p_user and used_at is null and revoked_at is null;
  insert into public.admin_two_factor_recovery_codes (user_id, code_hash)
  select p_user, h from unnest(p_hashes) as h;
  perform private.audit(p_user, 'two_factor.recovery_codes_replaced', 'profile', p_user::text, '{}'::jsonb);
end;
$$;

/**
 * Removes an account's 2FA (secret, unused recovery codes and every verified session family), so
 * the account must enroll again before privileged use. The API calls it for a self-service reset
 * (after the password and a current code); the operator break-glass script calls it with a null
 * actor. Audited either way.
 */
create function public.two_factor_reset(p_user uuid, p_actor uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_had boolean;
begin
  delete from public.admin_two_factor where user_id = p_user returning true into v_had;
  update public.admin_two_factor_recovery_codes set revoked_at = now()
   where user_id = p_user and used_at is null and revoked_at is null;
  delete from public.auth_session_mfa where user_id = p_user;
  perform private.audit(p_actor, 'two_factor.reset', 'profile', p_user::text,
    jsonb_build_object('reason', left(coalesce(p_reason, ''), 200), 'by_operator', p_actor is null));
  return coalesce(v_had, false);
end;
$$;

revoke all on function private.two_factor_required(uuid) from public, anon, authenticated;
revoke all on function public.two_factor_status(uuid, uuid) from public, anon, authenticated;
revoke all on function public.two_factor_begin(uuid, text) from public, anon, authenticated;
revoke all on function public.two_factor_material(uuid) from public, anon, authenticated;
revoke all on function public.two_factor_confirm(uuid, uuid, bigint, boolean, bytea[]) from public, anon, authenticated;
revoke all on function public.two_factor_record_failure(uuid, text) from public, anon, authenticated;
revoke all on function public.two_factor_use_recovery_code(uuid, uuid, bytea) from public, anon, authenticated;
revoke all on function public.two_factor_replace_recovery_codes(uuid, uuid, bytea[]) from public, anon, authenticated;
revoke all on function public.two_factor_reset(uuid, uuid, text) from public, anon, authenticated;

grant execute on function private.two_factor_required(uuid) to service_role;
grant execute on function public.two_factor_status(uuid, uuid) to service_role;
grant execute on function public.two_factor_begin(uuid, text) to service_role;
grant execute on function public.two_factor_material(uuid) to service_role;
grant execute on function public.two_factor_confirm(uuid, uuid, bigint, boolean, bytea[]) to service_role;
grant execute on function public.two_factor_record_failure(uuid, text) to service_role;
grant execute on function public.two_factor_use_recovery_code(uuid, uuid, bytea) to service_role;
grant execute on function public.two_factor_replace_recovery_codes(uuid, uuid, bytea[]) to service_role;
grant execute on function public.two_factor_reset(uuid, uuid, text) to service_role;
