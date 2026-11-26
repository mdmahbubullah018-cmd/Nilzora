-- Two adjustments found by the integration suites.
--
-- 1. Accepting a legacy Supabase invitation confirms the address on the auth.users row,
--    which never reached public.profiles.email_verified_at after the cutover. That left
--    such accounts looking unverified: first-party login refused them and the staff list
--    still reported a pending invitation. A trigger now copies the confirmation across,
--    which is the same thing the sign-up bridge does at insert time.
--
-- 2. register_device_token no longer requires the session id in the token to exist at
--    registration time. That was stricter than the contract the devices API has always
--    had: an access token naming a session that is not in either store registers, and
--    deliverable_device_tokens never delivers it. A session that belongs to somebody
--    else is still refused, so one account cannot claim another account's session.

create or replace function public.sync_verified_email_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null then
    update public.profiles
       set email_verified_at = coalesce(email_verified_at, new.email_confirmed_at)
     where id = new.id;
  end if;
  return new;
end;
$$;

comment on function public.sync_verified_email_from_auth_user() is
  'Copies a legacy Supabase email confirmation onto the profile, which is the authoritative record.';

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function public.sync_verified_email_from_auth_user();

create or replace function public.register_device_token(
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
  v_claim text := (select auth.jwt() ->> 'session_id');
  v_version text := nullif(btrim(coalesce(p_app_version, '')), '');
  v_session uuid;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'sign in to register a device' using errcode = '42501';
  end if;
  if p_token is null or p_platform is null
     or char_length(p_token) not between 20 and 1024
     or p_token !~ '^[A-Za-z0-9:_.~+/=-]+$' then
    raise exception 'a valid push token and platform are required' using errcode = 'NZ412';
  end if;
  if v_version is not null and char_length(v_version) > 32 then
    raise exception 'the app version is too long' using errcode = 'NZ412';
  end if;
  if v_claim is null
     or v_claim !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'a session is required to register a device' using errcode = 'NZ412';
  end if;

  v_session := v_claim::uuid;
  -- A session that exists but belongs to another account is never acceptable.
  if exists (
    select 1 from public.auth_sessions s
     where s.id = v_session and s.user_id <> v_user
  ) or exists (
    select 1 from auth.sessions s
     where s.id = v_session and s.user_id <> v_user
  ) then
    raise exception 'a session is required to register a device' using errcode = 'NZ412';
  end if;

  if not exists (select 1 from public.profiles where id = v_user and status = 'active') then
    raise exception 'this account cannot register devices' using errcode = 'NZ403';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  insert into public.device_tokens (user_id, token, platform, app_version, session_id, last_seen_at)
  values (v_user, p_token, p_platform, v_version, v_session, clock_timestamp())
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        app_version = excluded.app_version,
        session_id = excluded.session_id,
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
