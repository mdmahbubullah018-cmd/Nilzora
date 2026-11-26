-- A device stays deliverable across a normal session refresh.
--
-- Refreshing an access token rotates the session: rotate_session (first_party_identity)
-- inserts a new auth_sessions row and marks the old one revoked, with replaced_by naming
-- its successor. Registration records the session that registered the device, so after the
-- first rotation that id names a revoked row: the sender found no device at all and the
-- notification was closed as "no_device" until the customer happened to reopen the app.
-- A rotation is not a sign-out, so a device is now deliverable while the session it was
-- registered on, or a session that rotation replaced it with, is still live.
--
-- What the check protects is unchanged. The family of the device's own session is followed
-- only when that session was in fact replaced (replaced_by is set) and only to a live
-- session of the same account: revoked_at is null and the refresh window is open. A
-- sign-out revokes the session with no successor, an expired refresh window fails the same
-- test, and refresh-token reuse revokes every session of the family, so none of those
-- deliver anything. Only the service role can read tokens, through this function.

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
    and (
      -- The session that registered the device, still alive.
      exists (
        select 1 from public.auth_sessions s
        where s.id = d.session_id
          and s.user_id = d.user_id
          and s.revoked_at is null
          and s.refresh_expires_at > now()
      )
      -- ... or one that replaced it, in the same login (family), still alive. Every rotation
      -- of one login stays in its family and replaces the previous session, so a live row of
      -- that family is this device's current session.
      or exists (
        select 1
        from public.auth_sessions bound
        join public.auth_sessions current on current.family_id = bound.family_id
        where bound.id = d.session_id
          and bound.user_id = d.user_id
          and bound.replaced_by is not null
          and current.user_id = d.user_id
          and current.revoked_at is null
          and current.refresh_expires_at > now()
      )
      -- A Supabase Auth session is never rotated by this API: its own end is the whole test.
      or exists (
        select 1 from auth.sessions s
        where s.id = d.session_id
          and s.user_id = d.user_id
          and (s.not_after is null or s.not_after > now())
      )
    )
  order by d.user_id, d.last_seen_at desc, d.id;
$$;

revoke execute on function public.deliverable_device_tokens(uuid) from public, anon, authenticated;
grant execute on function public.deliverable_device_tokens(uuid) to service_role;

comment on function public.deliverable_device_tokens(uuid) is
  'Sender-only view of device tokens: a token is deliverable while the session that registered it lives, or while a session that rotation replaced it with (same login family) lives.';
