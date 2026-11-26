-- ---------------------------------------------------------------------------
-- M2 — Staff inbox: deterministic order across pages
--
-- The inbox read (`my_staff_notifications`) ordered by `created_at desc` alone. Several
-- notifications written by one business event share a timestamp, and PostgreSQL is free to
-- return equal rows in any order between two statements, so a row could appear on two pages
-- or on none while someone paged through the inbox.
--
-- Adding the primary key as the tie-breaker makes the order total: newest first, and within
-- one timestamp by id (a uuid, so newest-and-highest first). Nothing else changes — same
-- signature, same visibility rule, same limit/offset bounds, same grants.
--
-- Rollback: restore the previous body from 20261106090000_seo_store_profile_notifications_insights.sql
-- ---------------------------------------------------------------------------

create or replace function public.my_staff_notifications(
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  kind public.staff_notification_kind,
  title text,
  body text,
  entity_type text,
  entity_id text,
  action_path text,
  read_at timestamptz,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;

  return query
  with visible as (
    select n.*
    from public.staff_notifications n
    where (n.recipient_id = v_user)
       or (n.recipient_id is null and private.has_permission(n.audience_permission))
  )
  select v.id, v.kind, v.title, v.body, v.entity_type, v.entity_id, v.action_path,
         v.read_at, v.created_at, count(*) over () as total_count
  from visible v
  order by v.created_at desc, v.id
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;
