-- A customer can delete entries from their own notification centre.
--
-- Only the notification-centre row (public.customer_notifications) is removed. The order, the push
-- delivery record and every audit row stay as they are; nothing references this table. Both
-- functions answer auth.uid(), so a token for one account can never delete another's rows, and an
-- id that belongs to someone else (or to nobody) is simply not counted.

/** Deletes the caller's own entries with these ids; answers how many were deleted. */
create or replace function public.delete_my_customer_notifications(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_count integer;
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;
  if cardinality(p_ids) > 100 then
    raise exception 'too many notifications at once' using errcode = 'NZ412';
  end if;

  delete from public.customer_notifications n
  where n.user_id = v_user and n.id = any (p_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/**
 * Clears the caller's whole notification centre as of one moment: every entry created at or before
 * `p_before`. An entry that arrived after the customer pressed Clear all is never swept away.
 */
create or replace function public.clear_my_customer_notifications(p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_count integer;
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  if p_before is null then
    raise exception 'a cut-off time is required' using errcode = 'NZ412';
  end if;

  delete from public.customer_notifications n
  where n.user_id = v_user and n.created_at <= p_before;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.delete_my_customer_notifications(uuid[]) from public, anon, authenticated;
revoke execute on function public.clear_my_customer_notifications(timestamptz) from public, anon, authenticated;
grant execute on function public.delete_my_customer_notifications(uuid[]) to authenticated;
grant execute on function public.clear_my_customer_notifications(timestamptz) to authenticated;
