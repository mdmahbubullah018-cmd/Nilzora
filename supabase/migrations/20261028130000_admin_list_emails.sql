-- Admin read models read the sign-in address from public.profiles.
--
-- Same reason as 20261028120000: after the identity cutover an account is a `profiles`
-- row, so an inner join to `auth.users` dropped every account created by first-party
-- registration from customer, reviewer, audit and name lookups. `profiles.email` is now
-- authoritative and `auth.users` is joined optionally for legacy accounts.
--
-- Statements, return types, permission checks, filters, ordering and pagination are
-- unchanged, and the existing grants on each function are preserved by CREATE OR REPLACE.
-- admin_account_names(uuid[])
CREATE OR REPLACE FUNCTION public.admin_account_names(p_ids uuid[])
 RETURNS TABLE(id uuid, email text, full_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (
    public.has_permission('moderation.assign') or public.has_permission('content.approve')
    or public.has_permission('products.update') or public.has_permission('orders.read')
  ) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;
  if p_ids is null or cardinality(p_ids) > 200 then
    raise exception 'too many accounts' using errcode = 'NZ412';
  end if;
  return query
  select p.id, coalesce(p.email, u.email)::text, p.full_name
  from public.profiles p
  left join auth.users u on u.id = p.id
  join public.user_roles r on r.user_id = p.id and r.role <> 'customer'
  where p.id = any (p_ids);
end;
$function$;

-- admin_audit_log(text,uuid,integer,integer)
CREATE OR REPLACE FUNCTION public.admin_audit_log(p_action_prefix text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id bigint, actor_id uuid, actor_email text, actor_name text, action text, target_type text, target_id text, details jsonb, created_at timestamp with time zone, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_permission('audit_logs.read');
  if p_limit not between 1 and 100 or p_offset not between 0 and 100000 then
    raise exception 'invalid page' using errcode = 'NZ412';
  end if;
  if p_action_prefix is not null and p_action_prefix !~ '^[a-z_.]{1,60}$' then
    raise exception 'invalid action filter' using errcode = 'NZ412';
  end if;
  return query
  select a.id, a.actor_id, coalesce(p.email, u.email)::text, p.full_name, a.action, a.target_type, a.target_id,
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
$function$;

-- admin_get_customer(uuid)
CREATE OR REPLACE FUNCTION public.admin_get_customer(p_id uuid)
 RETURNS TABLE(id uuid, email text, full_name text, phone text, status profile_status, created_at timestamp with time zone, order_count bigint, last_order_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_permission('customers.read');
  return query
  select p.id, coalesce(p.email, u.email)::text, p.full_name, p.phone, p.status, p.created_at,
    (select count(*) from public.orders o where o.user_id = p.id),
    (select max(o.placed_at) from public.orders o where o.user_id = p.id)
  from public.profiles p
  join public.user_roles r on r.user_id = p.id and r.role = 'customer'
  left join auth.users u on u.id = p.id
  where p.id = p_id;
end;
$function$;

-- admin_list_customers(text,profile_status,integer,integer)
CREATE OR REPLACE FUNCTION public.admin_list_customers(p_query text DEFAULT NULL::text, p_status profile_status DEFAULT NULL::profile_status, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, email text, full_name text, phone text, status profile_status, created_at timestamp with time zone, order_count bigint, last_order_at timestamp with time zone, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
begin
  perform private.require_permission('customers.read');
  if p_limit not between 1 and 100 or p_offset not between 0 and 100000 then
    raise exception 'invalid page' using errcode = 'NZ412';
  end if;
  if v_query is not null and char_length(v_query) > 100 then
    raise exception 'the search is too long' using errcode = 'NZ412';
  end if;
  return query
  select p.id, coalesce(p.email, u.email)::text, p.full_name, p.phone, p.status, p.created_at,
    (select count(*) from public.orders o where o.user_id = p.id),
    (select max(o.placed_at) from public.orders o where o.user_id = p.id),
    count(*) over ()
  from public.profiles p
  join public.user_roles r on r.user_id = p.id and r.role = 'customer'
  left join auth.users u on u.id = p.id
  where (p_status is null or p.status = p_status)
    and (
      v_query is null
      or strpos(lower(coalesce(p.email, u.email)), lower(v_query)) > 0
      or strpos(lower(coalesce(p.full_name, '')), lower(v_query)) > 0
      or strpos(coalesce(p.phone, ''), v_query) > 0
    )
  order by p.created_at desc, p.id
  limit p_limit offset p_offset;
end;
$function$;

-- admin_list_reviewers()
CREATE OR REPLACE FUNCTION public.admin_list_reviewers()
 RETURNS TABLE(id uuid, email text, full_name text, open_reviews bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_permission('moderation.assign');
  return query
  select p.id, coalesce(p.email, u.email)::text, p.full_name,
    (select count(*) from public.moderation_tasks t where t.assigned_to = p.id and t.status = 'pending')
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.status = 'active'
    and exists (select 1 from private.permissions_of(p.id) as x (name) where x.name = 'content.approve')
  order by p.full_name nulls last, coalesce(p.email, u.email);
end;
$function$;

