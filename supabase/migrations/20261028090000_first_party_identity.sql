-- First-party identity, sessions and email codes.
--
-- Additive and reversible: the Supabase Auth trigger and the profiles -> auth.users
-- foreign key stay in place, so Supabase Auth keeps working until the cutover
-- migration. Existing user ids are preserved because profiles.id already holds them.

create type public.auth_code_purpose as enum ('verify_email', 'reset_password');

-- ---------------------------------------------------------------------------
-- Profiles become the application identity table.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column email text,
  add column password_hash text,
  add column email_verified_at timestamptz,
  add column password_updated_at timestamptz,
  add column failed_login_count integer not null default 0,
  add column locked_until timestamptz;

comment on column public.profiles.email is 'Sign-in address, lower-cased. Authoritative for the application; backfilled from auth.users once.';
comment on column public.profiles.password_hash is 'Argon2id hash written by the API. Null until the account claims a password.';
comment on column public.profiles.locked_until is 'Sign-in is refused until this instant after repeated failures.';

update public.profiles p
   set email = lower(u.email),
       email_verified_at = u.email_confirmed_at
  from auth.users u
 where u.id = p.id
   and u.email is not null;

do $$
begin
  if exists (select 1 from public.profiles where email is null) then
    raise exception 'profiles without an email address';
  end if;
end;
$$;

create unique index profiles_email_key on public.profiles (lower(email));

-- ---------------------------------------------------------------------------
-- Sessions: opaque tokens stored only as SHA-256 hashes.
-- ---------------------------------------------------------------------------

create table public.auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  secret_hash bytea not null unique,
  refresh_hash bytea not null unique,
  family_id uuid not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by uuid references public.auth_sessions (id) on delete set null,
  user_agent text,
  ip inet,
  last_used_at timestamptz
);

comment on table public.auth_sessions is 'Opaque first-party sessions. Tokens are never stored in clear; only their hashes are.';

create index auth_sessions_user_idx on public.auth_sessions (user_id);
create index auth_sessions_family_idx on public.auth_sessions (family_id);

-- ---------------------------------------------------------------------------
-- Email one-time codes (six digits) and OAuth links and invitations.
-- ---------------------------------------------------------------------------

create table public.auth_email_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  user_id uuid references public.profiles (id) on delete cascade,
  purpose public.auth_code_purpose not null,
  code_hash bytea not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.auth_email_codes is 'Hashed six-digit codes. Only one unconsumed code exists per address and purpose.';

create unique index auth_email_codes_active_key
  on public.auth_email_codes (lower(email), purpose)
  where consumed_at is null;
create index auth_email_codes_email_idx on public.auth_email_codes (lower(email), created_at desc);

create table public.auth_oauth_accounts (
  provider text not null check (provider ~ '^[a-z]+$'),
  provider_subject text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  email text,
  linked_at timestamptz not null default now(),
  primary key (provider, provider_subject)
);

comment on table public.auth_oauth_accounts is 'External identities linked to an account after the provider verified the address.';

create table public.auth_invitations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.auth_invitations is 'One-time staff invitation links, stored as hashes.';

alter table public.auth_sessions enable row level security;
alter table public.auth_email_codes enable row level security;
alter table public.auth_oauth_accounts enable row level security;
alter table public.auth_invitations enable row level security;

revoke all on table public.auth_sessions, public.auth_email_codes,
  public.auth_oauth_accounts, public.auth_invitations from public, anon, authenticated;
grant select, insert, update, delete on table public.auth_sessions, public.auth_email_codes,
  public.auth_oauth_accounts, public.auth_invitations to service_role;

-- ---------------------------------------------------------------------------
-- Account provisioning (replaces the Auth signup trigger for new accounts).
-- ---------------------------------------------------------------------------

create function public.provision_account(
  p_id uuid,
  p_email text,
  p_full_name text default null,
  p_phone text default null,
  p_password_hash text default null,
  p_email_verified boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_email = '' then
    raise exception 'an email address is required' using errcode = 'NZ412';
  end if;
  if exists (select 1 from public.profiles where lower(email) = v_email) then
    raise exception 'an account already uses this email' using errcode = 'NZ409';
  end if;
  if v_name is not null and char_length(v_name) > 120 then v_name := null; end if;
  if v_phone is not null and v_phone !~ '^\+8801[3-9][0-9]{8}$' then v_phone := null; end if;

  insert into public.profiles (id, email, full_name, phone, password_hash, email_verified_at)
  values (p_id, v_email, v_name, v_phone, p_password_hash,
          case when p_email_verified then now() end);

  -- Every new account starts as a customer, whatever the request contained.
  insert into public.user_roles (user_id, role) values (p_id, 'customer');
  return p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Email codes: issue, consume (single use, attempt limited), verify.
-- ---------------------------------------------------------------------------

create function public.issue_email_code(
  p_email text,
  p_purpose public.auth_code_purpose,
  p_code_hash bytea,
  p_ttl interval default '10 minutes'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user uuid;
begin
  select id into v_user from public.profiles where lower(email) = v_email;

  -- Invalidate any earlier active code for this address and purpose.
  update public.auth_email_codes
     set consumed_at = now()
   where lower(email) = v_email and purpose = p_purpose and consumed_at is null;

  insert into public.auth_email_codes (email, user_id, purpose, code_hash, expires_at)
  values (v_email, v_user, p_purpose, p_code_hash, now() + p_ttl);
end;
$$;

/**
 * Redeems a code. Returns the account id, or null when the code is wrong, expired,
 * already used, or has exhausted its attempts. The row is locked, so two concurrent
 * attempts can never redeem the same code twice.
 */
create function public.consume_email_code(
  p_email text,
  p_purpose public.auth_code_purpose,
  p_code_hash bytea
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_code public.auth_email_codes;
begin
  select * into v_code
    from public.auth_email_codes
   where lower(email) = v_email and purpose = p_purpose and consumed_at is null
   order by created_at desc
   limit 1
   for update;

  if not found then return null; end if;
  if v_code.expires_at <= now() or v_code.attempts >= 5 then return null; end if;

  if v_code.code_hash <> p_code_hash then
    update public.auth_email_codes set attempts = attempts + 1 where id = v_code.id;
    return null;
  end if;

  update public.auth_email_codes set consumed_at = now() where id = v_code.id;
  return v_code.user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Passwords and account state.
-- ---------------------------------------------------------------------------

create function public.set_password(p_user uuid, p_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set password_hash = p_hash,
         password_updated_at = now(),
         failed_login_count = 0,
         locked_until = null,
         email_verified_at = coalesce(email_verified_at, now())
   where id = p_user;
  if not found then
    raise exception 'account not found' using errcode = 'NZ404';
  end if;
end;
$$;

/** Sign-in material for one account, or nothing. Never returns the hash to a client. */
create function public.login_lookup(p_email text)
returns table (id uuid, password_hash text, status public.profile_status,
               email_verified_at timestamptz, locked_until timestamptz,
               failed_login_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.password_hash, p.status, p.email_verified_at, p.locked_until,
         p.failed_login_count
  from public.profiles p
  where lower(p.email) = lower(btrim(coalesce(p_email, '')));
$$;

create function public.record_login_failure(p_user uuid, p_lock_after integer default 8)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.profiles
     set failed_login_count = failed_login_count + 1
   where id = p_user
   returning failed_login_count into v_count;

  if v_count >= p_lock_after then
    update public.profiles set locked_until = now() + interval '15 minutes' where id = p_user;
  end if;
end;
$$;

create function public.clear_login_failures(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set failed_login_count = 0, locked_until = null where id = p_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- Session lifecycle.
-- ---------------------------------------------------------------------------

create function public.create_session(
  p_user uuid,
  p_secret_hash bytea,
  p_refresh_hash bytea,
  p_access_ttl interval,
  p_refresh_ttl interval,
  p_user_agent text default null,
  p_ip text default null
)
returns table (session_id uuid, family_id uuid, expires_at timestamptz, refresh_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_family uuid := gen_random_uuid();
  v_access timestamptz := now() + p_access_ttl;
  v_refresh timestamptz := now() + p_refresh_ttl;
begin
  insert into public.auth_sessions
    (id, user_id, secret_hash, refresh_hash, family_id, expires_at, refresh_expires_at,
     user_agent, ip, last_used_at)
  values
    (v_id, p_user, p_secret_hash, p_refresh_hash, v_family, v_access, v_refresh,
     left(p_user_agent, 300), case when p_ip is null then null else p_ip::inet end, now());

  return query select v_id, v_family, v_access, v_refresh;
end;
$$;

/** Resolves a presented access token. Null for unknown, expired or revoked sessions. */
create function public.resolve_session(p_secret_hash bytea)
returns table (user_id uuid, session_id uuid, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id, s.id, s.expires_at
  from public.auth_sessions s
  where s.secret_hash = p_secret_hash
    and s.revoked_at is null
    and s.expires_at > now();
$$;

/**
 * Rotates a refresh token. A spent or revoked refresh token revokes the whole family
 * (reuse detection). Returns the new session, or nothing when the token is unusable.
 */
create function public.rotate_session(
  p_refresh_hash bytea,
  p_secret_hash bytea,
  p_new_refresh_hash bytea,
  p_access_ttl interval,
  p_refresh_ttl interval,
  p_user_agent text default null,
  p_ip text default null
)
returns table (session_id uuid, user_id uuid, expires_at timestamptz, refresh_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.auth_sessions;
  v_new uuid := gen_random_uuid();
  v_access timestamptz := now() + p_access_ttl;
  v_refresh timestamptz := now() + p_refresh_ttl;
begin
  select * into v_old from public.auth_sessions where refresh_hash = p_refresh_hash for update;
  if not found then return; end if;

  if v_old.revoked_at is not null or v_old.refresh_expires_at <= now() or v_old.replaced_by is not null then
    -- A spent token came back: treat it as theft and end the whole family.
    update public.auth_sessions set revoked_at = now()
     where family_id = v_old.family_id and revoked_at is null;
    return;
  end if;

  if not exists (select 1 from public.profiles p where p.id = v_old.user_id and p.status = 'active') then
    update public.auth_sessions set revoked_at = now() where family_id = v_old.family_id;
    return;
  end if;

  insert into public.auth_sessions
    (id, user_id, secret_hash, refresh_hash, family_id, expires_at, refresh_expires_at,
     user_agent, ip, last_used_at)
  values
    (v_new, v_old.user_id, p_secret_hash, p_new_refresh_hash, v_old.family_id, v_access,
     v_refresh, left(p_user_agent, 300),
     case when p_ip is null then null else p_ip::inet end, now());

  update public.auth_sessions
     set revoked_at = now(), replaced_by = v_new
   where id = v_old.id;

  return query select v_new, v_old.user_id, v_access, v_refresh;
end;
$$;

create function public.revoke_session(p_secret_hash bytea)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.auth_sessions set revoked_at = now()
   where secret_hash = p_secret_hash and revoked_at is null;
$$;

create function public.revoke_all_sessions(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.auth_sessions set revoked_at = now()
   where user_id = p_user and revoked_at is null;
$$;

-- ---------------------------------------------------------------------------
-- Invitations.
-- ---------------------------------------------------------------------------

create function public.issue_invitation(
  p_user uuid,
  p_token_hash bytea,
  p_ttl interval default '7 days',
  p_created_by uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.auth_invitations set consumed_at = now()
   where user_id = p_user and consumed_at is null;
  insert into public.auth_invitations (user_id, token_hash, expires_at, created_by)
  values (p_user, p_token_hash, now() + p_ttl, p_created_by);
end;
$$;

create function public.consume_invitation(p_token_hash bytea)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.auth_invitations;
begin
  select * into v_row from public.auth_invitations
   where token_hash = p_token_hash and consumed_at is null and expires_at > now()
   for update;
  if not found then return null; end if;
  update public.auth_invitations set consumed_at = now() where id = v_row.id;
  return v_row.user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin functions: read the address from profiles instead of auth.users.
-- Identical signatures, return types and permission checks.
-- ---------------------------------------------------------------------------

create or replace function public.bootstrap_owner(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  lock table public.user_roles in share row exclusive mode;

  if exists (select 1 from public.user_roles where role = 'super_admin') then
    raise exception 'an owner already exists' using errcode = 'NZ005';
  end if;

  select p.id into v_user_id
  from public.profiles p
  where lower(p.email) = lower(btrim(p_email)) and p.email_verified_at is not null;

  if v_user_id is null then
    raise exception 'no confirmed account uses that email address' using errcode = 'NZ404';
  end if;

  update public.user_roles
  set role = 'super_admin', granted_by = null, granted_at = now()
  where user_id = v_user_id;

  return v_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: deny by default; only the API's service role may call these.
-- ---------------------------------------------------------------------------

revoke execute on function public.provision_account(uuid, text, text, text, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.issue_email_code(text, public.auth_code_purpose, bytea, interval)
  from public, anon, authenticated;
revoke execute on function public.consume_email_code(text, public.auth_code_purpose, bytea)
  from public, anon, authenticated;
revoke execute on function public.set_password(uuid, text) from public, anon, authenticated;
revoke execute on function public.login_lookup(text) from public, anon, authenticated;
revoke execute on function public.record_login_failure(uuid, integer) from public, anon, authenticated;
revoke execute on function public.clear_login_failures(uuid) from public, anon, authenticated;
revoke execute on function public.create_session(uuid, bytea, bytea, interval, interval, text, text)
  from public, anon, authenticated;
revoke execute on function public.resolve_session(bytea) from public, anon, authenticated;
revoke execute on function public.rotate_session(bytea, bytea, bytea, interval, interval, text, text)
  from public, anon, authenticated;
revoke execute on function public.revoke_session(bytea) from public, anon, authenticated;
revoke execute on function public.revoke_all_sessions(uuid) from public, anon, authenticated;
revoke execute on function public.issue_invitation(uuid, bytea, interval, uuid)
  from public, anon, authenticated;
revoke execute on function public.consume_invitation(bytea) from public, anon, authenticated;

grant execute on function public.provision_account(uuid, text, text, text, text, boolean)
  to service_role;
grant execute on function public.issue_email_code(text, public.auth_code_purpose, bytea, interval)
  to service_role;
grant execute on function public.consume_email_code(text, public.auth_code_purpose, bytea)
  to service_role;
grant execute on function public.set_password(uuid, text) to service_role;
grant execute on function public.login_lookup(text) to service_role;
grant execute on function public.record_login_failure(uuid, integer) to service_role;
grant execute on function public.clear_login_failures(uuid) to service_role;
grant execute on function public.create_session(uuid, bytea, bytea, interval, interval, text, text)
  to service_role;
grant execute on function public.resolve_session(bytea) to service_role;
grant execute on function public.rotate_session(bytea, bytea, bytea, interval, interval, text, text)
  to service_role;
grant execute on function public.revoke_session(bytea) to service_role;
grant execute on function public.revoke_all_sessions(uuid) to service_role;
grant execute on function public.issue_invitation(uuid, bytea, interval, uuid) to service_role;
grant execute on function public.consume_invitation(bytea) to service_role;
