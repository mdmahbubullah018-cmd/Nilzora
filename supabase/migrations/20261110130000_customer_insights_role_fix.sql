-- ---------------------------------------------------------------------------
-- Customer insight: read the customer role from user_roles
--
-- admin_customer_insights (20261106090000) filtered on `p.role = 'customer'`, but
-- profiles has no role column (roles live in user_roles), so every call failed at run
-- time. Its read of the store settings (`where id`) was also ambiguous with the
-- function's own `id` output column. This replaces the function with the same
-- signature, permission check, columns, segments and ordering; only the customer filter
-- (now a join on user_roles) and the qualified settings read differ.
-- ---------------------------------------------------------------------------

create or replace function public.admin_customer_insights(
  p_segment text default null,
  p_query text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  full_name text,
  email text,
  orders_count bigint,
  completed_orders bigint,
  eligible_spend_minor bigint,
  average_order_minor bigint,
  first_order_at timestamptz,
  last_order_at timestamptz,
  segments text[],
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_repeat integer;
  v_high bigint;
  v_inactive integer;
begin
  perform private.require_permission('customers.read');

  select repeat_order_threshold, high_spend_threshold_minor, inactive_days
  into v_repeat, v_high, v_inactive
  from public.store_settings ss where ss.id;

  return query
  with spend as (
    select o.user_id,
           count(*) filter (where o.status <> 'cancelled') as orders_count,
           count(*) filter (where o.status = 'delivered') as completed_orders,
           coalesce(sum(o.total_minor) filter (where o.status <> 'cancelled'), 0)::bigint as gross_minor,
           min(o.placed_at) filter (where o.status <> 'cancelled') as first_order_at,
           max(o.placed_at) filter (where o.status <> 'cancelled') as last_order_at
    from public.orders o
    group by o.user_id
  ),
  refunded as (
    select o.user_id, coalesce(sum(r.amount_minor), 0)::bigint as refunded_minor
    from public.refunds r
    join public.orders o on o.id = r.order_id
    where r.status = 'completed'
    group by o.user_id
  ),
  scored as (
    select p.id,
           p.full_name,
           p.email,
           coalesce(s.orders_count, 0) as orders_count,
           coalesce(s.completed_orders, 0) as completed_orders,
           greatest(coalesce(s.gross_minor, 0) - coalesce(f.refunded_minor, 0), 0)::bigint as spend_minor,
           s.first_order_at,
           s.last_order_at,
           array_remove(array[
             case when coalesce(s.orders_count, 0) <= 1 then 'new' end,
             case when coalesce(s.orders_count, 0) >= v_repeat then 'repeat' end,
             case when greatest(coalesce(s.gross_minor, 0) - coalesce(f.refunded_minor, 0), 0) >= v_high
                  then 'high_spender' end,
             case when s.last_order_at is not null
                       and s.last_order_at < now() - make_interval(days => v_inactive)
                  then 'inactive' end,
             case when s.last_order_at is not null
                       and s.last_order_at >= now() - make_interval(days => v_inactive)
                  then 'active' end
           ], null)::text[] as segments
    from public.profiles p
    join public.user_roles r on r.user_id = p.id and r.role = 'customer'
    left join spend s on s.user_id = p.id
    left join refunded f on f.user_id = p.id
    where (nullif(btrim(coalesce(p_query, '')), '') is null
           or p.full_name ilike '%' || btrim(p_query) || '%'
           or p.email ilike '%' || btrim(p_query) || '%')
  )
  select sc.id, sc.full_name, sc.email, sc.orders_count, sc.completed_orders,
         sc.spend_minor,
         case when sc.orders_count = 0 then 0
              else (sc.spend_minor / sc.orders_count)::bigint end as average_order_minor,
         sc.first_order_at, sc.last_order_at, sc.segments,
         count(*) over () as total_count
  from scored sc
  where nullif(btrim(coalesce(p_segment, '')), '') is null
     or p_segment = any (sc.segments)
  order by sc.spend_minor desc, sc.id
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;


revoke execute on function public.admin_customer_insights(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.admin_customer_insights(text, text, integer, integer) to authenticated;
