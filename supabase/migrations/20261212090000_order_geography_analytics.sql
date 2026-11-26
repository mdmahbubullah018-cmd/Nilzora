-- ---------------------------------------------------------------------------
-- Bangladesh order analytics: where orders come from, by division and district
--
-- One aggregate read behind the admin's Bangladesh Order Analytics page. The map,
-- the KPI cards, the rankings and every chart are built from this single result, so
-- two surfaces can never disagree about a total.
--
-- Source of the location: the order's own delivery snapshot (`ship_district`,
-- `ship_division`), copied from the chosen address at checkout by place_cod_order.
-- A customer's current address is never read for history — it may have changed.
--
-- Definitions, all inherited from admin_analytics_overview so the two pages agree:
--   - the population is every order placed in the range that matches the filters,
--     cancelled included; `statusBreakdown` adds up to it;
--   - the demand population (`eligibleOrders`) is that minus the cancelled orders, and
--     it is exactly `mappedOrders + unmappedOrders`; the timeline and the choropleth
--     are drawn from it;
--   - revenue is the total of the non-cancelled orders (COD: owed or paid, delivery
--     included), never net of refunds;
--   - a returned order has a return request that was not withdrawn;
--   - a district is canonical when the pair matches public.bd_districts, which is the
--     same reference table addresses are validated against. Anything else is reported
--     as unmapped and never guessed into a neighbouring district.
--
-- Additive only: one function and its grant. No table, column, index, row or policy is
-- touched, and nothing is backfilled.
--
-- Rollback
--   drop function public.admin_order_geography(date, date, text, text, text, text);
-- ---------------------------------------------------------------------------

create function public.admin_order_geography(
  p_from date,
  p_to date,
  p_division text default null,
  p_district text default null,
  p_status text default null,
  p_metric text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('finance.read');
  v_metric text := coalesce(nullif(btrim(coalesce(p_metric, '')), ''), 'orders');
  v_division text := nullif(btrim(coalesce(p_division, '')), '');
  v_district text := nullif(btrim(coalesce(p_district, '')), '');
  v_status public.order_status;
  v_canonical_division text;
  v_start timestamptz;
  v_end timestamptz;
  v_result jsonb;
begin
  if p_from is null or p_to is null then
    raise exception 'a start and end day are required' using errcode = 'NZ412';
  end if;
  if p_to < p_from or (p_to - p_from) >= 366 then
    raise exception 'choose a range of 1 to 366 days' using errcode = 'NZ412';
  end if;
  if v_metric not in ('orders', 'revenue', 'delivered') then
    raise exception 'unsupported metric' using errcode = 'NZ412';
  end if;
  if nullif(btrim(coalesce(p_status, '')), '') is not null then
    if p_status::text not in (select unnest(enum_range(null::public.order_status))::text) then
      raise exception 'unsupported status' using errcode = 'NZ412';
    end if;
    v_status := p_status::public.order_status;
  end if;

  -- A district decides its division; the two filters can never form an impossible pair.
  if v_district is not null then
    select d.division into v_canonical_division
      from public.bd_districts d where d.name = v_district;
    if v_canonical_division is null then
      raise exception 'unknown district' using errcode = 'NZ412';
    end if;
    if v_division is not null and v_division <> v_canonical_division then
      raise exception 'that district is not in that division' using errcode = 'NZ412';
    end if;
    v_division := v_canonical_division;
  elsif v_division is not null then
    if not exists (select 1 from public.bd_districts d where d.division = v_division) then
      raise exception 'unknown division' using errcode = 'NZ412';
    end if;
  end if;

  -- Bangladesh calendar days, converted once so the range stays an index-friendly
  -- comparison on placed_at (the existing orders_placed_idx covers it).
  v_start := p_from::timestamp at time zone 'Asia/Dhaka';
  v_end := (p_to + 1)::timestamp at time zone 'Asia/Dhaka';

  with ranged as materialized (
    select o.id,
           o.status,
           o.total_minor,
           o.ship_district,
           o.ship_division,
           d.name as district,
           d.division,
           (o.placed_at at time zone 'Asia/Dhaka')::date as day,
           exists (
             select 1 from public.return_requests r
              where r.order_id = o.id and r.status <> 'cancelled'
           ) as returned
      from public.orders o
      left join public.bd_districts d
        on d.name = o.ship_district and d.division = o.ship_division
     where o.placed_at >= v_start and o.placed_at < v_end
       and (v_division is null or o.ship_division = v_division)
       and (v_district is null or o.ship_district = v_district)
       and (v_status is null or o.status = v_status)
  ),
  eligible as (
    select * from ranged where status <> 'cancelled'
  ),
  totals as (
    select count(*) as placed,
           count(*) filter (where status <> 'cancelled') as eligible,
           count(*) filter (where status = 'delivered') as delivered,
           count(*) filter (where status = 'pending') as pending,
           count(*) filter (where status = 'processing') as processing,
           count(*) filter (where status = 'shipped') as shipped,
           count(*) filter (where status = 'cancelled') as cancelled,
           count(*) filter (where returned) as returned,
           coalesce(sum(total_minor) filter (where status <> 'cancelled'), 0) as revenue_minor,
           coalesce(round(avg(total_minor) filter (where status <> 'cancelled'))::bigint, 0) as average_minor,
           count(*) filter (where status <> 'cancelled' and district is not null) as mapped
      from ranged
  ),
  by_district as (
    select district,
           count(*) as order_count,
           count(*) filter (where status = 'delivered') as delivered_count,
           sum(total_minor) as revenue_minor
      from eligible
     where district is not null
     group by district
  ),
  by_division as (
    select division,
           count(*) as order_count,
           count(*) filter (where status = 'delivered') as delivered_count,
           sum(total_minor) as revenue_minor
      from eligible
     where division is not null
     group by division
  ),
  by_day as (
    select day,
           count(*) as order_count,
           count(*) filter (where status = 'delivered') as delivered_count,
           sum(total_minor) as revenue_minor
      from eligible
     group by day
  ),
  by_status as (
    select status, count(*) as n from ranged group by status
  ),
  bad_values as (
    select ship_district, ship_division, count(*) as n, sum(total_minor) as revenue_minor
      from eligible
     where district is null
     group by ship_district, ship_division
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'timezone', 'Asia/Dhaka',
    'filters', jsonb_build_object(
      'from', p_from,
      'to', p_to,
      'division', v_division,
      'district', v_district,
      'status', v_status,
      'metric', v_metric
    ),
    'summary', (
      select jsonb_build_object(
        'totalOrders', t.placed,
        'eligibleOrders', t.eligible,
        'deliveredOrders', t.delivered,
        'pendingOrders', t.pending,
        'processingOrders', t.processing,
        'shippedOrders', t.shipped,
        'cancelledOrders', t.cancelled,
        'returnedOrders', t.returned,
        'revenueMinor', t.revenue_minor,
        'averageOrderMinor', t.average_minor,
        'deliveredRate', case
          when t.eligible = 0 then null
          else round(t.delivered::numeric / t.eligible, 4)
        end,
        'mappedOrders', t.mapped,
        'unmappedOrders', t.eligible - t.mapped
      )
      from totals t
    ),
    'divisions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'division', x.division,
               'orderCount', coalesce(g.order_count, 0),
               'deliveredCount', coalesce(g.delivered_count, 0),
               'revenueMinor', coalesce(g.revenue_minor, 0),
               'share', case
                 when t.mapped = 0 then null
                 else round(coalesce(g.order_count, 0)::numeric / t.mapped, 4)
               end
             ) order by x.division), '[]'::jsonb)
        from (select distinct division from public.bd_districts) x
        cross join totals t
        left join by_division g on g.division = x.division
    ),
    'districts', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'district', x.name,
               'division', x.division,
               'orderCount', coalesce(g.order_count, 0),
               'deliveredCount', coalesce(g.delivered_count, 0),
               'revenueMinor', coalesce(g.revenue_minor, 0),
               'share', case
                 when t.mapped = 0 then null
                 else round(coalesce(g.order_count, 0)::numeric / t.mapped, 4)
               end
             ) order by x.division, x.name), '[]'::jsonb)
        from public.bd_districts x
        cross join totals t
        left join by_district g on g.district = x.name
    ),
    'timeline', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'day', to_char(d.day, 'YYYY-MM-DD'),
               'orderCount', coalesce(s.order_count, 0),
               'deliveredCount', coalesce(s.delivered_count, 0),
               'revenueMinor', coalesce(s.revenue_minor, 0)
             ) order by d.day), '[]'::jsonb)
        from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d (day)
        left join by_day s on s.day = d.day::date
    ),
    'statusBreakdown', (
      select coalesce(jsonb_agg(jsonb_build_object('status', s.status, 'count', s.n)
                                order by s.n desc, s.status), '[]'::jsonb)
        from by_status s
    ),
    'unmapped', jsonb_build_object(
      'orderCount', (select coalesce(sum(n), 0) from bad_values),
      'revenueMinor', (select coalesce(sum(revenue_minor), 0) from bad_values),
      'missingDistrictCount', (
        -- Orders, like unknownDistrictCount: bad_values holds one row per value pair, so
        -- counting its rows would report distinct values instead of orders.
        select coalesce(sum(n), 0) from bad_values
         where ship_district is null or btrim(ship_district) = ''
      ),
      'unknownDistrictCount', (
        select coalesce(sum(n), 0) from bad_values
         where btrim(coalesce(ship_district, '')) <> ''
      ),
      'values', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'district', v.ship_district,
                 'division', v.ship_division,
                 'orderCount', v.n
               ) order by v.n desc), '[]'::jsonb)
          from (select * from bad_values order by n desc limit 10) v
      )
    )
  )
  into v_result;

  return v_result;
end;
$$;

comment on function public.admin_order_geography(date, date, text, text, text, text) is
  'Order demand by division and district over Bangladesh calendar days, from the order''s own delivery snapshot. Requires finance.read.';

-- Signed-in accounts only, and the function checks the permission itself; anon and
-- PUBLIC are revoked explicitly because functions are executable by PUBLIC by default.
revoke execute on function public.admin_order_geography(date, date, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_order_geography(date, date, text, text, text, text)
  to authenticated;
