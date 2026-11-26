-- Follow-ups to the admin foundation:
--   * assigners (moderation.assign) list the accounts that can review content without
--     needing staff-management permissions;
--   * one customer can be read as the caller (customers.read), email included, so the
--     API needs no service-role lookup for it;
--   * the audit log's action filter is a literal prefix ("_" no longer acts as a wildcard).

create function public.admin_list_reviewers()
returns table (id uuid, email text, full_name text, open_reviews bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('moderation.assign');
  return query
  select p.id, u.email::text, p.full_name,
    (select count(*) from public.moderation_tasks t where t.assigned_to = p.id and t.status = 'pending')
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.status = 'active'
    and exists (select 1 from private.permissions_of(p.id) as x (name) where x.name = 'content.approve')
  order by p.full_name nulls last, u.email;
end;
$$;

create function public.admin_get_customer(p_id uuid)
returns table (
  id uuid,
  email text,
  full_name text,
  phone text,
  status public.profile_status,
  created_at timestamptz,
  order_count bigint,
  last_order_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('customers.read');
  return query
  select p.id, u.email::text, p.full_name, p.phone, p.status, p.created_at,
    (select count(*) from public.orders o where o.user_id = p.id),
    (select max(o.placed_at) from public.orders o where o.user_id = p.id)
  from public.profiles p
  join public.user_roles r on r.user_id = p.id and r.role = 'customer'
  join auth.users u on u.id = p.id
  where p.id = p_id;
end;
$$;

create or replace function public.admin_audit_log(
  p_action_prefix text default null,
  p_actor uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id bigint,
  actor_id uuid,
  actor_email text,
  actor_name text,
  action text,
  target_type text,
  target_id text,
  details jsonb,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('audit_logs.read');
  if p_limit not between 1 and 100 or p_offset not between 0 and 100000 then
    raise exception 'invalid page' using errcode = 'NZ412';
  end if;
  if p_action_prefix is not null and p_action_prefix !~ '^[a-z_.]{1,60}$' then
    raise exception 'invalid action filter' using errcode = 'NZ412';
  end if;
  return query
  select a.id, a.actor_id, u.email::text, p.full_name, a.action, a.target_type, a.target_id,
    a.details, a.created_at, count(*) over ()
  from public.audit_log a
  left join auth.users u on u.id = a.actor_id
  left join public.profiles p on p.id = a.actor_id
  -- A literal prefix: "_" and "%" in the filter match only themselves.
  where (p_action_prefix is null or left(a.action, char_length(p_action_prefix)) = p_action_prefix)
    and (p_actor is null or a.actor_id = p_actor)
  order by a.created_at desc, a.id desc
  limit p_limit offset p_offset;
end;
$$;

revoke execute on function public.admin_list_reviewers() from public, anon, authenticated;
revoke execute on function public.admin_get_customer(uuid) from public, anon, authenticated;
grant execute on function public.admin_list_reviewers() to authenticated;
grant execute on function public.admin_get_customer(uuid) to authenticated;
