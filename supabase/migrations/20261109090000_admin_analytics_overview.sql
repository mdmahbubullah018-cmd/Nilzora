-- ---------------------------------------------------------------------------
-- Analytics overview and the monthly sales target
--
-- One aggregate read for the Admin dashboard and analytics pages over a range of
-- Bangladesh calendar days (Asia/Dhaka), optionally compared with the equally long
-- period right before it, plus a monthly revenue target kept in store settings.
-- The JSON shape is the contract in packages/contracts/src/admin-analytics.ts.
--
-- Definitions (all money in integer poisha):
--   - revenue: total_minor of orders that were not cancelled (COD: owed or paid,
--     delivery included); an order belongs to the Dhaka day it was placed;
--   - customers: accounts whose role is 'customer' (user_roles), by profile creation;
--   - a returned order: one with a return request that was not withdrawn
--     (return_requests.status <> 'cancelled');
--   - rates are null when their denominator is zero, never a made-up zero.
--
-- Additive only: one nullable column, one index, three functions.
-- ---------------------------------------------------------------------------

alter table public.store_settings
  add column monthly_sales_target_minor bigint
    check (monthly_sales_target_minor between 0 and 100000000000);

comment on column public.store_settings.monthly_sales_target_minor is
  'Revenue target for each calendar month, in poisha; null when no target is set.';

-- The overview reads orders by placement time across every status; the existing
-- indexes lead with status or user_id, so a range over all orders needs its own.
create index orders_placed_idx on public.orders (placed_at);

-- ---------------------------------------------------------------------------
-- Totals of one period [p_start, p_end), in the contract's analyticsTotals shape.
-- Called only by admin_analytics_overview, which has already checked the caller.
-- ---------------------------------------------------------------------------

create function private.analytics_totals(p_start timestamptz, p_end timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ranged as (
    select o.status,
           o.payment_status,
           o.total_minor,
           exists (
             select 1 from public.return_requests rr
             where rr.order_id = o.id and rr.status <> 'cancelled'
           ) as returned
    from public.orders o
    where o.placed_at >= p_start and o.placed_at < p_end
  )
  select jsonb_build_object(
    'orderCount', count(*) filter (where r.status <> 'cancelled'),
    'cancelledCount', count(*) filter (where r.status = 'cancelled'),
    'revenueMinor', coalesce(sum(r.total_minor) filter (where r.status <> 'cancelled'), 0),
    'averageOrderMinor',
      coalesce(round(avg(r.total_minor) filter (where r.status <> 'cancelled'))::bigint, 0),
    'newCustomers', (
      select count(*)
      from public.profiles p
      join public.user_roles ur on ur.user_id = p.id and ur.role = 'customer'
      where p.created_at >= p_start and p.created_at < p_end
    ),
    'collectedMinor', coalesce(sum(r.total_minor) filter (where r.payment_status = 'collected'), 0),
    'deliveredCount', count(*) filter (where r.status = 'delivered'),
    'returnedOrderCount', count(*) filter (where r.returned)
  )
  from ranged r;
$$;

-- ---------------------------------------------------------------------------
-- The analytics overview (finance.read). Top customers are included only for a
-- caller who may also read customers (customers.read); otherwise they are null.
-- ---------------------------------------------------------------------------

create function public.admin_analytics_overview(
  p_from date,
  p_to date,
  p_compare boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- LOW_STOCK_THRESHOLD in packages/contracts/src/catalog.ts (and the dashboard card).
  c_low_stock constant integer := 5;
  v_compare boolean := coalesce(p_compare, true);
  v_reads_customers boolean;
  v_days integer;
  v_start timestamptz;
  v_end timestamptz;
  v_prev_from date;
  v_prev_to date;
  v_prev_start timestamptz;
  v_month timestamp;
  v_result jsonb;
begin
  perform private.require_permission('finance.read');
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from + 1 > 366 then
    raise exception 'choose a range of 1 to 366 days' using errcode = 'NZ412';
  end if;

  v_reads_customers := private.has_permission('customers.read');
  v_days := p_to - p_from + 1;
  -- Midnight in Dhaka on the first day, to midnight after the last day (exclusive).
  v_start := p_from::timestamp at time zone 'Asia/Dhaka';
  v_end := (p_to + 1)::timestamp at time zone 'Asia/Dhaka';
  v_prev_from := p_from - v_days;
  v_prev_to := p_from - 1;
  v_prev_start := v_prev_from::timestamp at time zone 'Asia/Dhaka';
  v_month := date_trunc('month', now() at time zone 'Asia/Dhaka');

  with ranged as (
    select o.id,
           o.user_id,
           o.status,
           o.payment_status,
           o.total_minor,
           o.delivery_zone,
           o.placed_at at time zone 'Asia/Dhaka' as local_at,
           exists (
             select 1 from public.return_requests rr
             where rr.order_id = o.id and rr.status <> 'cancelled'
           ) as returned
    from public.orders o
    where o.placed_at >= v_start and o.placed_at < v_end
  ),
  sold as (
    select * from ranged where status <> 'cancelled'
  ),
  days as (
    select g.d::date as day
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as g (d)
  ),
  daily_orders as (
    select local_at::date as day,
           count(*) filter (where status <> 'cancelled') as order_count,
           coalesce(sum(total_minor) filter (where status <> 'cancelled'), 0) as revenue_minor
    from ranged
    group by 1
  ),
  daily_status as (
    select s.day, jsonb_object_agg(s.status, s.n) as by_status
    from (
      select local_at::date as day, status, count(*) as n
      from ranged
      group by 1, 2
    ) s
    group by s.day
  ),
  daily_customers as (
    select (p.created_at at time zone 'Asia/Dhaka')::date as day, count(*) as n
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id and ur.role = 'customer'
    where p.created_at >= v_start and p.created_at < v_end
    group by 1
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'days', v_days),
    'previousRange', case when v_compare
      then jsonb_build_object('from', v_prev_from, 'to', v_prev_to) end,
    'totals', private.analytics_totals(v_start, v_end),
    'previousTotals', case when v_compare
      then private.analytics_totals(v_prev_start, v_start) end,
    'daily', (
      select jsonb_agg(jsonb_build_object(
               'day', d.day,
               'revenueMinor', coalesce(o.revenue_minor, 0),
               'orderCount', coalesce(o.order_count, 0),
               'newCustomers', coalesce(c.n, 0),
               'byStatus', coalesce(s.by_status, '{}'::jsonb)
             ) order by d.day)
      from days d
      left join daily_orders o on o.day = d.day
      left join daily_status s on s.day = d.day
      left join daily_customers c on c.day = d.day
    ),
    'previousDaily', case when v_compare then (
      select jsonb_agg(jsonb_build_object(
               'day', g.d::date,
               'revenueMinor', coalesce(x.revenue_minor, 0),
               'orderCount', coalesce(x.order_count, 0)
             ) order by g.d)
      from generate_series(v_prev_from::timestamp, v_prev_to::timestamp, interval '1 day') as g (d)
      left join (
        select (o.placed_at at time zone 'Asia/Dhaka')::date as day,
               count(*) as order_count,
               sum(o.total_minor) as revenue_minor
        from public.orders o
        where o.placed_at >= v_prev_start and o.placed_at < v_start and o.status <> 'cancelled'
        group by 1
      ) x on x.day = g.d::date
    ) else '[]'::jsonb end,
    'snapshot', (
      select jsonb_build_object(
               'codPendingMinor', coalesce(sum(o.total_minor), 0),
               'codPendingCount', count(*),
               'lowStockCount', (
                 select count(*) from public.products p
                 where p.status = 'active' and p.stock_quantity <= c_low_stock
               ),
               'outOfStockCount', (
                 select count(*) from public.products p
                 where p.status = 'active' and p.stock_quantity <= 0
               )
             )
      from public.orders o
      where o.status = 'delivered' and o.payment_status = 'pending'
    ),
    'statusSplit', (
      select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
      from (select status, count(*) as n from ranged group by status) s
    ),
    'paymentSplit', (
      select jsonb_build_object(
               'pendingMinor', coalesce(sum(total_minor) filter (where payment_status = 'pending'), 0),
               'pendingCount', count(*) filter (where payment_status = 'pending'),
               'collectedMinor', coalesce(sum(total_minor) filter (where payment_status = 'collected'), 0),
               'collectedCount', count(*) filter (where payment_status = 'collected')
             )
      from sold
    ),
    'deliveryZones', (
      select jsonb_agg(jsonb_build_object(
               'zone', z.zone,
               'orderCount', coalesce(x.order_count, 0),
               'revenueMinor', coalesce(x.revenue_minor, 0)
             ) order by z.zone)
      from unnest(enum_range(null::public.delivery_zone)) as z (zone)
      left join (
        select delivery_zone, count(*) as order_count, sum(total_minor) as revenue_minor
        from sold
        group by delivery_zone
      ) x on x.delivery_zone = z.zone
    ),
    'salesByCategory', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'categoryId', t.category_id,
               'categoryName', t.category_name,
               'unitsSold', t.units,
               'revenueMinor', t.revenue
             ) order by t.revenue desc, t.units desc, t.category_name), '[]'::jsonb)
      from (
        select p.category_id,
               coalesce(min(cat.name), 'Uncategorised') as category_name,
               sum(oi.quantity) as units,
               sum(oi.line_total_minor) as revenue
        from public.order_items oi
        join sold s on s.id = oi.order_id
        join public.products p on p.id = oi.product_id
        left join public.categories cat on cat.id = p.category_id
        group by p.category_id
        order by sum(oi.line_total_minor) desc, sum(oi.quantity) desc, min(cat.name)
        limit 10
      ) t
    ),
    'topProducts', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'productId', t.product_id,
               'productName', t.product_name,
               'unitsSold', t.units,
               'revenueMinor', t.revenue
             ) order by t.units desc, t.revenue desc, t.product_name), '[]'::jsonb)
      from (
        select oi.product_id,
               min(p.name) as product_name,
               sum(oi.quantity) as units,
               sum(oi.line_total_minor) as revenue
        from public.order_items oi
        join sold s on s.id = oi.order_id
        join public.products p on p.id = oi.product_id
        group by oi.product_id
        order by sum(oi.quantity) desc, sum(oi.line_total_minor) desc, min(p.name)
        limit 10
      ) t
    ),
    -- Every order placed in the range (cancelled included), by Dhaka weekday and hour.
    'heatmap', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'weekday', h.weekday,
               'hour', h.hour,
               'orderCount', h.n
             ) order by h.weekday, h.hour), '[]'::jsonb)
      from (
        select extract(isodow from local_at)::integer as weekday,
               extract(hour from local_at)::integer as hour,
               count(*) as n
        from ranged
        group by 1, 2
      ) h
    ),
    -- Carts created, checkouts started and orders placed (cancelled included) in the range.
    'funnel', jsonb_build_object(
      'carts', (
        select count(*) from public.carts c
        where c.created_at >= v_start and c.created_at < v_end
      ),
      'checkouts', (
        select count(*) from public.checkout_sessions cs
        where cs.started_at >= v_start and cs.started_at < v_end
      ),
      'orders', (select count(*) from ranged)
    ),
    -- Delivered orders can no longer change status, and only delivered orders can be
    -- returned, so the returns numerator never exceeds its denominator.
    'rates', (
      select jsonb_build_object(
               'fulfillment', case when count(*) filter (where status <> 'cancelled') = 0 then null
                 else round(
                   (count(*) filter (where status = 'delivered'))::numeric
                     / count(*) filter (where status <> 'cancelled'),
                   4) end,
               'returns', case when count(*) filter (where status = 'delivered') = 0 then null
                 else round(
                   (count(*) filter (where status = 'delivered' and returned))::numeric
                     / count(*) filter (where status = 'delivered'),
                   4) end
             )
      from ranged
    ),
    'monthTarget', jsonb_build_object(
      'month', to_char(v_month, 'YYYY-MM'),
      'targetMinor', (select ss.monthly_sales_target_minor from public.store_settings ss where ss.id),
      'revenueMinor', (
        select coalesce(sum(o.total_minor), 0) from public.orders o
        where o.status <> 'cancelled'
          and o.placed_at >= v_month at time zone 'Asia/Dhaka'
          and o.placed_at < (v_month + interval '1 month') at time zone 'Asia/Dhaka'
      )
    ),
    'topCustomers', case when v_reads_customers then (
      select coalesce(jsonb_agg(jsonb_build_object(
               'customerId', t.user_id,
               'name', p.full_name,
               'email', p.email,
               'orderCount', t.order_count,
               'revenueMinor', t.revenue_minor,
               'daily', (
                 select jsonb_agg(coalesce(x.revenue_minor, 0) order by d.day)
                 from days d
                 left join (
                   select s.local_at::date as day, sum(s.total_minor) as revenue_minor
                   from sold s
                   where s.user_id = t.user_id
                   group by 1
                 ) x on x.day = d.day
               )
             ) order by t.revenue_minor desc, t.order_count desc, t.user_id), '[]'::jsonb)
      from (
        select s.user_id, count(*) as order_count, sum(s.total_minor) as revenue_minor
        from sold s
        join public.user_roles ur on ur.user_id = s.user_id and ur.role = 'customer'
        group by s.user_id
        order by sum(s.total_minor) desc, count(*) desc, s.user_id
        limit 10
      ) t
      join public.profiles p on p.id = t.user_id
    ) end
  )
  into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- The monthly sales target (settings.manage). Null clears it.
-- ---------------------------------------------------------------------------

create function public.admin_set_sales_target(p_target_minor bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_before bigint;
  v_after bigint;
  v_updated_at timestamptz;
begin
  if p_target_minor is not null and p_target_minor not between 0 and 100000000000 then
    raise exception 'the target must be from 0 to 1,000,000,000 taka' using errcode = 'NZ412';
  end if;

  select monthly_sales_target_minor into v_before
  from public.store_settings where id
  for update;

  update public.store_settings
  set monthly_sales_target_minor = p_target_minor,
      updated_by = v_actor
  where id
  returning monthly_sales_target_minor, updated_at into v_after, v_updated_at;

  perform private.audit(v_actor, 'settings.sales_target_changed', 'store_settings', 'settings',
    jsonb_build_object('before', v_before, 'after', v_after));

  return jsonb_build_object('targetMinor', v_after, 'updatedAt', v_updated_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: signed-in accounts may call the public functions (each checks the
-- caller's permission itself); the private helper is never callable directly.
-- ---------------------------------------------------------------------------

revoke execute on function private.analytics_totals(timestamptz, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.admin_analytics_overview(date, date, boolean)
  from public, anon, authenticated;
revoke execute on function public.admin_set_sales_target(bigint) from public, anon, authenticated;

grant execute on function public.admin_analytics_overview(date, date, boolean) to authenticated;
grant execute on function public.admin_set_sales_target(bigint) to authenticated;
