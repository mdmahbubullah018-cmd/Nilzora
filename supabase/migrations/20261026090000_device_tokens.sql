-- Push-notification devices. A signed-in app registers its native push token (FCM on
-- Android, APNs on iOS later) and removes it on sign-out. The notification sender
-- (a later phase) reads tokens with the service role; no end user can read, list or
-- write the table, so a token is never readable from a client. Registration is not a
-- privileged action: no audit entries, and tokens are never logged.

create type public.device_platform as enum ('android', 'ios');

create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- The token the platform issued; one device token belongs to one account at a time.
  token text not null unique
    check (char_length(token) between 20 and 4096 and token ~ '^[A-Za-z0-9:_.~+/=-]+$'),
  platform public.device_platform not null,
  app_version text check (app_version is null or char_length(app_version) <= 32),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Set by the sender when the push service reports the token dead; registering again clears it.
  invalidated_at timestamptz
);

comment on table public.device_tokens is 'Native push tokens of signed-in devices. Written only by register_device_token / unregister_device_token and the notification sender (service role); never readable by end users.';

-- Also serves the per-account cap (newest first) and the sender's lookup by account.
create index device_tokens_user_idx on public.device_tokens (user_id, last_seen_at desc);

alter table public.device_tokens enable row level security;

-- ---------------------------------------------------------------------------
-- Registration and removal: SECURITY DEFINER functions acting for the caller only
-- ---------------------------------------------------------------------------

/** Most devices an account keeps; registering beyond it forgets the least recently seen. */
create function public.register_device_token(
  p_token text,
  p_platform public.device_platform,
  p_app_version text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_version text := nullif(btrim(coalesce(p_app_version, '')), '');
  v_id uuid;
begin
  if v_user is null then
    raise exception 'sign in to register a device' using errcode = '42501';
  end if;
  if p_token is null or p_platform is null
     or char_length(p_token) not between 20 and 4096
     or p_token !~ '^[A-Za-z0-9:_.~+/=-]+$' then
    raise exception 'a valid push token and platform are required' using errcode = 'NZ412';
  end if;
  if v_version is not null and char_length(v_version) > 32 then
    raise exception 'the app version is too long' using errcode = 'NZ412';
  end if;
  if not exists (select 1 from public.profiles where id = v_user and status = 'active') then
    raise exception 'this account cannot register devices' using errcode = 'NZ403';
  end if;

  -- One registration per account at a time, so the cap below cannot be raced past.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  -- A token that belonged to another account moves to the caller: the device is theirs now.
  insert into public.device_tokens (user_id, token, platform, app_version, last_seen_at)
  values (v_user, p_token, p_platform, v_version, clock_timestamp())
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        app_version = excluded.app_version,
        last_seen_at = excluded.last_seen_at,
        invalidated_at = null
  returning id into v_id;

  delete from public.device_tokens
  where id in (
    select id from public.device_tokens
    where user_id = v_user
    order by (id = v_id) desc, last_seen_at desc, id
    offset 10
  );

  return v_id;
end;
$$;

/** Forgets the caller's own token. False when the caller has no such token; it says nothing about anyone else's. */
create function public.unregister_device_token(p_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_deleted integer;
begin
  if v_user is null then
    raise exception 'sign in to remove a device' using errcode = '42501';
  end if;

  delete from public.device_tokens where user_id = v_user and token = p_token;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: no end-user access to the table; the functions are the only way in
-- ---------------------------------------------------------------------------

revoke all on table public.device_tokens from public, anon, authenticated;
grant select, insert, update, delete on table public.device_tokens to service_role;

revoke execute on function public.register_device_token(text, public.device_platform, text)
  from public, anon, authenticated;
revoke execute on function public.unregister_device_token(text) from public, anon, authenticated;
grant execute on function public.register_device_token(text, public.device_platform, text) to authenticated;
grant execute on function public.unregister_device_token(text) to authenticated;
