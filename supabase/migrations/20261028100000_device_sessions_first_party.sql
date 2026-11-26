-- Device tokens follow a first-party session instead of a Supabase Auth session.
--
-- Additive replacement: the columns and signatures stay the same, so the devices store
-- and the notification sender keep working; only the session source changes.

comment on column public.device_tokens.session_id is 'The first-party auth_sessions.id of the access token that registered the token.';

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
  -- The session must be the caller's own and still alive.
  if not exists (
    select 1 from public.auth_sessions s
     where s.id = v_session and s.user_id = v_user
       and s.revoked_at is null and s.refresh_expires_at > now()
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

create or replace function public.deliverable_device_tokens(p_user_id uuid default null)
returns table (id uuid, user_id uuid, token text, platform public.device_platform)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.user_id, d.token, d.platform
  from public.device_tokens d
  where (p_user_id is null or d.user_id = p_user_id)
    and d.invalidated_at is null
    and d.session_id is not null
    and exists (
      select 1 from public.auth_sessions s
      where s.id = d.session_id
        and s.user_id = d.user_id
        and s.revoked_at is null
        and s.refresh_expires_at > now()
    )
  order by d.user_id, d.last_seen_at desc, d.id;
$$;

revoke execute on function public.deliverable_device_tokens(uuid) from public, anon, authenticated;
grant execute on function public.deliverable_device_tokens(uuid) to service_role;
