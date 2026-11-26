-- Device tokens follow the Auth SESSION that registered them.
--
-- A client cannot always remove its token when a session ends (offline sign-out, an
-- expired or revoked refresh token), and the next person to use the phone must not
-- receive the previous account's notifications. So each token row records the session
-- of the access token that registered it, and the notification sender (a later phase)
-- reads tokens only through deliverable_device_tokens(), which returns a token only
-- while that session still exists and has not run out.
--
-- Also lowers the token maximum from 4096 to 1024 characters: a UNIQUE btree entry is
-- limited to about 2.7 KB, so a long high-entropy token would fail with 54000 (a 503)
-- instead of a 400. Real FCM and APNs tokens are far shorter.

alter table public.device_tokens add column session_id uuid;

comment on column public.device_tokens.session_id is 'The Auth session (auth.sessions.id) of the access token that registered the token. Null on rows created before this column existed; those are local test data only and count as undeliverable.';

-- A token longer than the new maximum would make the constraint fail loudly here, which
-- is the intended outcome: nothing is deleted on the way.
do $$
declare
  v_name text;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'public.device_tokens'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%char_length(token)%';
  if v_name is not null then
    execute format('alter table public.device_tokens drop constraint %I', v_name);
  end if;
end;
$$;

alter table public.device_tokens
  add constraint device_tokens_token_check
  check (char_length(token) between 20 and 1024 and token ~ '^[A-Za-z0-9:_.~+/=-]+$');

comment on table public.device_tokens is 'Native push tokens of signed-in devices, bound to the Auth session that registered them. Written only by register_device_token / unregister_device_token and the notification sender (service role); never readable by end users. The sender must read tokens through deliverable_device_tokens(), never by selecting this table.';

-- ---------------------------------------------------------------------------
-- Registration: record the caller's session
-- ---------------------------------------------------------------------------

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
  -- Supabase access tokens carry the session they belong to; a token without one cannot
  -- be tied to a session, so it cannot register a device.
  if v_claim is null
     or v_claim !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'a session is required to register a device' using errcode = 'NZ412';
  end if;
  v_session := v_claim::uuid;
  if not exists (select 1 from public.profiles where id = v_user and status = 'active') then
    raise exception 'this account cannot register devices' using errcode = 'NZ403';
  end if;

  -- One registration per account at a time, so the cap below cannot be raced past.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  -- A token that belonged to another account moves to the caller, with the caller's session.
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

-- ---------------------------------------------------------------------------
-- The sender's view: tokens whose registering session is still alive
-- ---------------------------------------------------------------------------

/**
 * The tokens a notification may be sent to right now: not marked dead, registered by a
 * session that still exists, belongs to the token's account and has not run out
 * (auth.sessions.not_after). Rows without a session (created before sessions were
 * recorded) are never deliverable. p_user_id limits the answer to one account.
 *
 * The Phase 9 sender MUST read tokens through this function, never by selecting
 * device_tokens, so a token whose session has ended is never read. It can still mark a
 * dead token by id (update ... set invalidated_at = now() where id = ...).
 */
create function public.deliverable_device_tokens(p_user_id uuid default null)
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
      select 1 from auth.sessions s
      where s.id = d.session_id
        and s.user_id = d.user_id
        and (s.not_after is null or s.not_after > now())
    )
  order by d.user_id, d.last_seen_at desc, d.id;
$$;

revoke execute on function public.deliverable_device_tokens(uuid) from public, anon, authenticated;
grant execute on function public.deliverable_device_tokens(uuid) to service_role;
