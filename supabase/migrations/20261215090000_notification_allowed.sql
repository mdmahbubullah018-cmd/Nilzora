-- ---------------------------------------------------------------------------
-- The sender asks one question: may this account be told about an order?
--
-- The notification worker reads one account's order-update choice before it sends. It runs
-- as the service role, and `notification_preferences` is deny-by-default: no role but the
-- owner reaches it, which is what keeps one account's choices away from another. Reading
-- the table with the service key therefore failed (42501 permission denied) and every
-- delivery ended as a retry with `worker_error`.
--
-- Opening the table to the service role would have fixed the symptom while exposing every
-- account's choices to any holder of that key. Instead this adds one function that answers
-- a single boolean: security definer, so it reads the table as its owner; empty
-- search_path; executable by the service role alone. A customer keeps reading their own
-- row through my_notification_preferences(), and an anonymous visitor can call neither.
--
-- Additive only: one function and two grants. No table, row, policy or existing function is
-- touched, and no data is read, written or moved by this migration.
--
-- Rollback
--   drop function public.notification_allowed(uuid);
-- ---------------------------------------------------------------------------

/**
 * Whether the account should be told about an order event. An account that never opened
 * Settings has no row and is answered "yes" - the behaviour every account had before
 * preferences existed - and a row with `order_updates = false` is answered "no".
 *
 * Deliberately answers nothing else: not the other categories, not the row, not the
 * timestamp. A failure inside the function raises rather than answering, so a caller can
 * never mistake an error for "allowed" and quietly notify someone who opted out.
 */
create function public.notification_allowed(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_allowed boolean;
begin
  if p_user_id is null then
    raise exception 'an account is required' using errcode = 'NZ412';
  end if;

  select p.order_updates
    into v_allowed
    from public.notification_preferences p
   where p.user_id = p_user_id;

  -- No row: every category is on, as it was before the account could choose.
  return coalesce(v_allowed, true);
end;
$$;

comment on function public.notification_allowed(uuid) is
  'One account''s order-update choice for the sender: true when no row exists or the category is on. Service role only.';

-- The backend's key is the only caller: a customer reads their own row through
-- my_notification_preferences(), and nothing anonymous may ask about anybody.
revoke execute on function public.notification_allowed(uuid) from public, anon, authenticated;
grant execute on function public.notification_allowed(uuid) to service_role;
