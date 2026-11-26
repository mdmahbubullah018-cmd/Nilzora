-- Nilzora identity foundation: customer profiles, application roles and the only
-- trusted paths that may grant privileged roles. Catalog, cart, order, audit-log
-- and per-user permission tables belong to later phases.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.app_role as enum ('super_admin', 'admin', 'staff', 'moderator', 'customer');
create type public.profile_status as enum ('active', 'suspended');

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at current
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: one row per Supabase Auth user. Holds customer-editable fields and
-- the account status. It never stores a role.
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (full_name is null or char_length(full_name) between 1 and 120),
  phone text check (phone is null or phone ~ '^\+8801[3-9][0-9]{8}$'),
  status public.profile_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Customer-facing profile for each auth user. Roles live in user_roles.';
comment on column public.profiles.phone is 'Mobile number as provided by the customer (E.164, Bangladesh). Not verified.';
comment on column public.profiles.status is 'Suspended accounts are refused by the API and cannot edit their profile.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- user_roles: the trusted source of each account's role. Only the service role
-- and the security-definer functions below write to it.
-- ---------------------------------------------------------------------------

create table public.user_roles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  role public.app_role not null default 'customer',
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now()
);

comment on table public.user_roles is 'Authoritative application role per account. Never writable by end users.';
comment on column public.user_roles.granted_by is 'Account that granted the current role; null for signup defaults and owner bootstrap.';

-- Staff listings filter out the (much larger) customer population.
create index user_roles_privileged_idx on public.user_roles (role) where role <> 'customer';
create index user_roles_granted_by_idx on public.user_roles (granted_by);

-- ---------------------------------------------------------------------------
-- New accounts: create the profile and the customer role in the same
-- transaction as the auth user, so the two can never drift apart.
-- ---------------------------------------------------------------------------

create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full_name text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
  v_phone text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '');
begin
  -- Signup metadata is user-controlled: keep only well-formed optional profile fields.
  if v_full_name is not null and char_length(v_full_name) > 120 then
    v_full_name := null;
  end if;
  if v_phone is not null and v_phone !~ '^\+8801[3-9][0-9]{8}$' then
    v_phone := null;
  end if;

  insert into public.profiles (id, full_name, phone) values (new.id, v_full_name, v_phone);

  -- Every new account starts as a customer, whatever the signup request contained.
  insert into public.user_roles (user_id, role) values (new.id, 'customer');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Privileged role assignment. Executable only by the service role (the API),
-- which passes the verified acting account; the rules are re-checked here.
-- ---------------------------------------------------------------------------

create function public.assign_user_role(p_actor_id uuid, p_target_id uuid, p_role public.app_role)
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

  -- Serialise role changes against owner rows before reading the actor's role, so two
  -- owners demoting each other concurrently cannot both succeed.
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

  -- Admins manage staff, moderator and customer accounts; only owners touch admin roles.
  if v_actor_role = 'admin'
     and (p_role in ('super_admin', 'admin') or v_target_role in ('super_admin', 'admin')) then
    raise exception 'only an owner can grant or change admin roles' using errcode = 'NZ003';
  end if;

  -- Invariant check (the rules above already prevent it): never leave the store without an owner.
  if v_target_role = 'super_admin' and p_role <> 'super_admin'
     and (select count(*) from public.user_roles where role = 'super_admin') <= 1 then
    raise exception 'the last owner cannot be demoted' using errcode = 'NZ004';
  end if;

  update public.user_roles
  set role = p_role, granted_by = p_actor_id, granted_at = now()
  where user_id = p_target_id
  returning * into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- One-time owner bootstrap for a fresh installation. Works only while no owner
-- exists and only for an account whose email address has been confirmed.
-- ---------------------------------------------------------------------------

create function public.bootstrap_owner(p_email text)
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

  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = lower(btrim(p_email)) and u.email_confirmed_at is not null;

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
-- Privileges: deny by default, then grant exactly what the policies allow.
-- ---------------------------------------------------------------------------

revoke all on table public.profiles, public.user_roles from public, anon, authenticated;
grant select, insert, update, delete on table public.profiles, public.user_roles to service_role;

grant select on table public.profiles to authenticated;
grant update (full_name, phone) on table public.profiles to authenticated;
grant select (user_id, role, granted_at) on table public.user_roles to authenticated;

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.assign_user_role(uuid, uuid, public.app_role) from public, anon, authenticated;
revoke execute on function public.bootstrap_owner(text) from public, anon, authenticated;
grant execute on function public.assign_user_role(uuid, uuid, public.app_role) to service_role;
grant execute on function public.bootstrap_owner(text) to service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;

create policy "Users read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "Active users update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id and status = 'active')
  with check ((select auth.uid()) = id);

create policy "Users read their own role"
  on public.user_roles for select to authenticated
  using ((select auth.uid()) = user_id);

-- No insert or delete policies exist for end users on either table, and none at
-- all for anon. Role changes go through assign_user_role / bootstrap_owner only.
