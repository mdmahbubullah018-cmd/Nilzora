-- ---------------------------------------------------------------------------
-- Reports, exports and order documents
--
--   1. Report helpers: filter validation (Dhaka day range of at most 366 days, the
--      filters each kind accepts), literal search patterns, staff names.
--   2. Nine report kinds behind one dispatcher, public.admin_report(kind, filters,
--      limit, offset, with_summary), which checks the kind's permission for the CALLER
--      and answers { rows, total, summary, chart }. Rows hold raw values: money in
--      poisha, fractions for percentages, ISO dates and instants.
--      Personal data is minimal: no report has a phone number or a street address, the
--      orders report names only the district and delivery zone, the customers report
--      has name, email, joined date, orders, spend and status, and the audit-log report
--      never includes an entry's details.
--   3. public.admin_audit_export: the audit row of a direct download.
--   4. public.admin_order_document: the data of an invoice or packing slip (the one
--      place a delivery address and phone belong), audited per download.
--   5. Export jobs: public.export_jobs (RLS on, no policies, no table privileges) with
--      functions for the creator (create, list, get, download) and for the API's worker
--      (claim, progress, finish, fail, expire; service_role only). A caller only ever
--      sees their own jobs; a download rechecks the report permission.
--
-- SQLSTATEs: NZ403 missing permission, NZ404 not found, NZ412 invalid input,
--            NZ443 export not ready, NZ444 export expired.
-- Additive only: one table and new functions.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------

/** The permission a report kind needs; null for an unknown kind. */
create function private.report_permission(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'sales' then 'finance.read'
    when 'orders' then 'orders.read'
    when 'products' then 'products.read'
    when 'inventory' then 'products.read'
    when 'customers' then 'customers.read'
    when 'coupons' then 'coupons.update'
    when 'cod_collections' then 'finance.read'
    when 'moderation' then 'moderation.assign'
    when 'audit_logs' then 'audit_logs.read'
  end;
$$;

/** The filter keys a kind accepts beyond from/to, and the values its status may take. */
create function private.report_filter_support(p_kind text, out keys text[], out statuses text[])
language sql
immutable
set search_path = ''
as $$
  select
    case p_kind
      when 'sales' then '{}'::text[]
      when 'orders' then array['status', 'paymentStatus', 'q']
      when 'products' then array['status', 'categoryId', 'brandId', 'q']
      when 'inventory' then array['status', 'categoryId', 'q']
      when 'customers' then array['status', 'q']
      when 'coupons' then array['status', 'q']
      when 'cod_collections' then array['q']
      when 'moderation' then array['status', 'q']
      when 'audit_logs' then array['q']
    end,
    case p_kind
      when 'orders' then array['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled']
      when 'products' then array['draft', 'active', 'archived']
      when 'inventory' then array['initial_stock', 'order_placed', 'order_cancelled', 'adjustment']
      when 'customers' then array['active', 'suspended']
      when 'coupons' then array['active', 'inactive']
      when 'moderation' then array['pending', 'approved', 'rejected', 'changes_requested', 'withdrawn']
    end;
$$;

/**
 * Validates a kind's filters (NZ412 otherwise) and answers the range as instants: from
 * midnight in Dhaka on the first day to midnight after the last day.
 */
create function private.report_range(
  p_kind text,
  p_filters jsonb,
  out range_start timestamptz,
  out range_end timestamptz,
  out day_from date,
  out day_to date
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_support record;
  v_key text;
begin
  if p_filters is null or jsonb_typeof(p_filters) <> 'object' then
    raise exception 'filters must be an object' using errcode = 'NZ412';
  end if;
  select * into v_support from private.report_filter_support(p_kind);
  if v_support.keys is null then
    raise exception 'unknown report' using errcode = 'NZ412';
  end if;
  for v_key in select jsonb_object_keys(p_filters) loop
    if v_key not in ('from', 'to') and not (v_key = any (v_support.keys)) then
      raise exception 'this report has no % filter', v_key using errcode = 'NZ412';
    end if;
    if jsonb_typeof(p_filters -> v_key) <> 'string' then
      raise exception 'filter % must be text', v_key using errcode = 'NZ412';
    end if;
  end loop;

  if p_filters ? 'status' and not ((p_filters ->> 'status') = any (coalesce(v_support.statuses, '{}'))) then
    raise exception 'unknown status' using errcode = 'NZ412';
  end if;
  if p_filters ? 'paymentStatus'
     and (p_filters ->> 'paymentStatus') not in ('pending', 'collected', 'cancelled') then
    raise exception 'unknown payment status' using errcode = 'NZ412';
  end if;
  if (p_filters ? 'categoryId' and (p_filters ->> 'categoryId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     or (p_filters ? 'brandId' and (p_filters ->> 'brandId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'invalid id filter' using errcode = 'NZ412';
  end if;
  if p_filters ? 'q' and char_length(btrim(p_filters ->> 'q')) not between 1 and 100 then
    raise exception 'the search must be 1 to 100 characters' using errcode = 'NZ412';
  end if;

  if (p_filters ->> 'from') !~ '^\d{4}-\d{2}-\d{2}$' or (p_filters ->> 'to') !~ '^\d{4}-\d{2}-\d{2}$'
     or p_filters ->> 'from' is null or p_filters ->> 'to' is null then
    raise exception 'choose a range of days' using errcode = 'NZ412';
  end if;
  begin
    day_from := (p_filters ->> 'from')::date;
    day_to := (p_filters ->> 'to')::date;
  exception when others then
    raise exception 'choose a range of days' using errcode = 'NZ412';
  end;
  if day_from > day_to or day_to - day_from + 1 > 366 then
    raise exception 'choose a range of 1 to 366 days' using errcode = 'NZ412';
  end if;
  range_start := day_from::timestamp at time zone 'Asia/Dhaka';
  range_end := (day_to + 1)::timestamp at time zone 'Asia/Dhaka';
end;
$$;

/** The search filter as a literal ILIKE pattern (wildcards in it match themselves), or null. */
create function private.report_like(p_filters jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when nullif(btrim(coalesce(p_filters ->> 'q', '')), '') is null then null
    else '%' || replace(replace(replace(btrim(p_filters ->> 'q'), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;
$$;

/** A staff account's display name (name, else email); null for nobody. */
create function private.report_person(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.full_name, p.email) from public.profiles p where p.id = p_id;
$$;

/** Only the known filter keys, for echoing back and for audit details. */
create function private.report_filters_echo(p_filters jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'from', p_filters ->> 'from',
    'to', p_filters ->> 'to',
    'status', p_filters ->> 'status',
    'paymentStatus', p_filters ->> 'paymentStatus',
    'categoryId', p_filters ->> 'categoryId',
    'brandId', p_filters ->> 'brandId',
    'q', p_filters ->> 'q'
  ));
$$;

-- ---------------------------------------------------------------------------
-- 2. The reports (private; reached through public.admin_report)
-- ---------------------------------------------------------------------------

create function private.report_sales(p_filters jsonb, p_limit integer, p_offset integer, p_summary boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_result jsonb;
begin
  select * into r from private.report_range('sales', p_filters);
  with days as (
    select g.d::date as day
    from generate_series(r.day_from::timestamp, r.day_to::timestamp, interval '1 day') as g (d)
  ),
  agg as (
    select (o.placed_at at time zone 'Asia/Dhaka')::date as day,
           count(*) filter (where o.status <> 'cancelled') as orders,
           count(*) filter (where o.status = 'cancelled') as cancelled,
           coalesce(sum(o.total_minor) filter (where o.status <> 'cancelled'), 0) as revenue,
           coalesce(sum(o.total_minor) filter (where o.payment_status = 'collected'), 0) as collected
    from public.orders o
    where o.placed_at >= r.range_start and o.placed_at < r.range_end
    group by 1
  ),
  report_rows as (
    select d.day,
           coalesce(a.orders, 0) as orders,
           coalesce(a.cancelled, 0) as cancelled,
           coalesce(a.revenue, 0) as revenue,
           coalesce(a.collected, 0) as collected
    from days d
    left join agg a on a.day = d.day
  )
  select jsonb_build_object(
    'total', (select count(*) from report_rows),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', x.day,
               'orders', x.orders,
               'cancelled', x.cancelled,
               'revenue', x.revenue,
               'averageOrder', case when x.orders = 0 then 0 else round(x.revenue::numeric / x.orders)::bigint end,
               'collected', x.collected
             ) order by x.day)
      from (select * from report_rows order by day limit p_limit offset p_offset) x
    ), '[]'::jsonb),
    'summary', case when p_summary then (
      select jsonb_build_object(
               'revenue', coalesce(sum(revenue), 0),
               'orders', coalesce(sum(orders), 0),
               'averageOrder', case when coalesce(sum(orders), 0) = 0 then 0
                                    else round(sum(revenue)::numeric / sum(orders))::bigint end,
               'collected', coalesce(sum(collected), 0),
               'cancelled', coalesce(sum(cancelled), 0)
             )
      from report_rows
    ) end,
    'chart', case when p_summary then (
      select coalesce(jsonb_agg(jsonb_build_object('label', to_char(day, 'YYYY-MM-DD'), 'value', revenue) order by day), '[]'::jsonb)
      from report_rows
    ) end
  ) into v_result;
  return v_result;
end;
$$;

create function private.report_orders(p_filters jsonb, p_limit integer, p_offset integer, p_summary boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_status text := p_filters ->> 'status';
  v_payment text := p_filters ->> 'paymentStatus';
  v_like text := private.report_like(p_filters);
  v_result jsonb;
begin
  select * into r from private.report_range('orders', p_filters);
  with base as (
    select o.order_number, o.placed_at, o.status::text as status, o.payment_status::text as payment_status,
           o.ship_recipient_name, o.ship_district, o.delivery_zone::text as zone, o.item_count,
           o.subtotal_minor, o.discount_minor, o.shipping_fee_minor, o.total_minor
    from public.orders o
    where o.placed_at >= r.range_start and o.placed_at < r.range_end
      and (v_status is null or o.status::text = v_status)
      and (v_payment is null or o.payment_status::text = v_payment)
      and (v_like is null or o.order_number ilike v_like or o.ship_recipient_name ilike v_like)
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'orderNumber', x.order_number,
               'placedAt', x.placed_at,
               'status', x.status,
               'paymentStatus', x.payment_status,
               'customer', x.ship_recipient_name,
               'district', x.ship_district,
               'zone', x.zone,
               'items', x.item_count,
               'subtotal', x.subtotal_minor,
               'discount', x.discount_minor,
               'delivery', x.shipping_fee_minor,
               'total', x.total_minor
             ) order by x.placed_at desc, x.order_number desc)
      from (select * from base order by placed_at desc, order_number desc limit p_limit offset p_offset) x
    ), '[]'::jsonb),
    'summary', case when p_summary then (
      select jsonb_build_object(
               'orders', count(*),
               'revenue', coalesce(sum(total_minor) filter (where status <> 'cancelled'), 0),
               'cancelled', count(*) filter (where status = 'cancelled'),
               'averageOrder', coalesce(round(avg(total_minor) filter (where status <> 'cancelled'))::bigint, 0)
             )
      from base
    ) end,
    'chart', case when p_summary then (
      select coalesce(jsonb_agg(jsonb_build_object('label', s.status, 'value', s.n) order by s.n desc, s.status), '[]'::jsonb)
      from (select status, count(*) as n from base group by status) s
    ) end
  ) into v_result;
  return v_result;
end;
$$;

create function private.report_products(p_filters jsonb, p_limit integer, p_offset integer, p_summary boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_status text := p_filters ->> 'status';
  v_category uuid;
  v_brand uuid;
  v_like text := private.report_like(p_filters);
  v_result jsonb;
begin
  select * into r from private.report_range('products', p_filters);
  -- Cast only after report_range has checked the ids' shape.
  v_category := (p_filters ->> 'categoryId')::uuid;
  v_brand := (p_filters ->> 'brandId')::uuid;
  with sold as (
    select oi.product_id, sum(oi.quantity) as units, sum(oi.line_total_minor) as revenue
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.placed_at >= r.range_start and o.placed_at < r.range_end and o.status <> 'cancelled'
    group by oi.product_id
  ),
  base as (
    select p.id, p.name, p.sku, c.name as category, b.name as brand, p.status::text as status,
           p.price_minor, p.stock_quantity, coalesce(s.units, 0) as units, coalesce(s.revenue, 0) as revenue
    from public.products p
    join public.categories c on c.id = p.category_id
    left join public.brands b on b.id = p.brand_id
    left join sold s on s.product_id = p.id
    where (v_status is null or p.status::text = v_status)
      and (v_category is null or p.category_id = v_category)
      and (v_brand is null or p.brand_id = v_brand)
      and (v_like is null or p.name ilike v_like or p.sku ilike v_like)
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', x.name, 'sku', x.sku, 'category', x.category, 'brand', x.brand,
               'status', x.status, 'price', x.price_minor, 'stock', x.stock_quantity,
               'unitsSold', x.units, 'revenue', x.revenue
             ) order by x.revenue desc, x.units desc, x.name, x.id)
      from (select * from base order by revenue desc, units desc, name, id limit p_limit offset p_offset) x
    ), '[]'::jsonb),
    'summary', case when p_summary then (
      select jsonb_build_object(
               'products', count(*),
               'unitsSold', coalesce(sum(units), 0),
               'revenue', coalesce(sum(revenue), 0)
             )
      from base
    ) end,
    'chart', case when p_summary then (
      select coalesce(jsonb_agg(jsonb_build_object('label', t.name, 'value', t.revenue) order by t.revenue desc, t.name), '[]'::jsonb)
      from (select name, revenue from base where revenue > 0 order by revenue desc, name limit 10) t
    ) end
  ) into v_result;
  return v_result;
end;
$$;

create function private.report_inventory(p_filters jsonb, p_limit integer, p_offset integer, p_summary boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_reason text := p_filters ->> 'status';
  v_category uuid;
  v_like text := private.report_like(p_filters);
  v_result jsonb;
begin
  select * into r from private.report_range('inventory', p_filters);
  v_category := (p_filters ->> 'categoryId')::uuid;
  with base as (
    select m.id, m.created_at, p.name as product, p.sku, m.change, m.stock_after, m.reason::text as reason,
           o.order_number, m.note,
           -- A customer's own order movements name no customer.
           case when m.actor_id is null then null
                when ur.role = 'customer' then 'Customer'
                else private.report_person(m.actor_id) end as actor
    from public.inventory_movements m
    join public.products p on p.id = m.product_id
    left join public.orders o on o.id = m.order_id
    left join public.user_roles ur on ur.user_id = m.actor_id
    where m.created_at >= r.range_start and m.created_at < r.range_end
      and (v_reason is null or m.reason::text = v_reason)
      and (v_category is null or p.category_id = v_category)
      and (v_like is null or p.name ilike v_like or p.sku ilike v_like)
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'at', x.created_at, 'product', x.product, 'sku', x.sku, 'change', x.change,
               'stockAfter', x.stock_after, 'reason', x.reason, 'orderNumber', x.order_number,
               'note', x.note, 'actor', x.actor
             ) order by x.created_at desc, x.id desc)
      from (select * from base order by created_at desc, id desc limit p_limit offset p_offset) x
    ), '[]'::jsonb),
    'summary', case when p_summary then (
      select jsonb_build_object(
               'movements', count(*),
               'unitsIn', coalesce(sum(change) filter (where change > 0), 0),
               'unitsOut', coalesce(-sum(change) filter (where change < 0), 0)
             )
      from base
    ) end,
    'chart', null
  ) into v_result;
  return v_result;
end;
$$;

create function private.report_customers(p_filters jsonb, p_limit integer, p_offset integer, p_summary boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_status text := p_filters ->> 'status';
  v_like text := private.report_like(p_filters);
  v_result jsonb;
begin
  select * into r from private.report_range('customers', p_filters);
  with base as (
    select p.id, p.full_name, p.email, p.created_at, p.status::text as status,
           coalesce(s.orders, 0) as orders, coalesce(s.spent, 0) as spent
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id and ur.role = 'customer'
    left join lateral (
      select count(*) filter (where o.status <> 'cancelled') as orders,
             coalesce(sum(o.total_minor) filter (where o.status <> 'cancelled'), 0) as spent
      from public.orders o
      where o.user_id = p.id
    ) s on true
    where p.created_at >= r.range_start and p.created_at < r.range_end
      and (v_status is null or p.status::text = v_status)
      and (v_like is null or p.full_name ilike v_like or p.email ilike v_like)
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', x.full_name, 'email', x.email,
               'joinedAt', to_char(x.created_at at time zone 'Asia/Dhaka', 'YYYY-MM-DD'),
               'orders', x.orders, 'spent', x.spent, 'status', x.status
             ) order by x.created_at desc, x.id)
      from (select * from base order by created_at desc, id limit p_limit offset p_offset) x
    ), '[]'::jsonb),
    'summary', case when p_summary then (
      select jsonb_build_object(
               'customers', count(*),
               'withOrders', count(*) filter (where orders > 0),
               'spent', coalesce(sum(spent), 0)
             )
      from base
    ) end,
    'chart', case when p_summary then (
      select coalesce(jsonb_agg(jsonb_build_object('label', to_char(d.day, 'YYYY-MM-DD'), 'value', coalesce(j.n, 0)) order by d.day), '[]'::jsonb)
      from (select g.d::date as day
            from generate_series(r.day_from::timestamp, r.day_to::timestamp, interval '1 day') as g (d)) d
      left join (select (created_at at time zone 'Asia/Dhaka')::date as day, count(*) as n from base group by 1) j
        on j.day = d.day
    ) end
  ) into v_result;
  return v_result;
end;
$$;

create function private.report_coupons(p_filters jsonb, p_limit integer, p_offset integer, p_summary boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_status text := p_filters ->> 'status';
  v_like text := private.report_like(p_filters);
  v_result jsonb;
begin
  select * into r from private.report_range('coupons', p_filters);
  with used as (
    select cr.coupon_id, count(*) as redemptions, sum(cr.discount_minor) as discount, sum(o.total_minor) as revenue
    from public.coupon_redemptions cr
    join public.orders o on o.id = cr.order_id
    where cr.redeemed_at >= r.range_start and cr.redeemed_at < r.range_end and o.status <> 'cancelled'
    group by cr.coupon_id
  ),
  base as (
    select c.id, c.code, c.kind, c.value, c.is_active,
           coalesce(u.redemptions, 0) as redemptions, coalesce(u.discount, 0) as discount,
           coalesce(u.revenue, 0) as revenue
    from public.coupons c
    left join used u on u.coupon_id = c.id
    where (v_status is null or (v_status = 'active') = c.is_active)
      and (v_like is null or c.code ilike v_like)
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', x.code, 'type', x.kind,
               'percentOff', case when x.kind = 'percent' then round(x.value::numeric / 100, 4) end,
               'amountOff', case when x.kind = 'fixed' then x.value end,
               'active', case when x.is_active then 'Yes' else 'No' end,
               'redemptions', x.redemptions, 'discountGiven', x.discount, 'orderRevenue', x.revenue
             ) order by x.redemptions desc, x.code)
      from (select * from base order by redemptions desc, code limit p_limit offset p_offset) x
    ), '[]'::jsonb),
    'summary', case when p_summary then (
      select jsonb_build_object(
               'coupons', count(*),
               'redemptions', coalesce(sum(redemptions), 0),
               'discountGiven', coalesce(sum(discount), 0)
             )
      from base
    ) end,
    'chart', case when p_summary then (
      select coalesce(jsonb_agg(jsonb_build_object('label', t.code, 'value', t.redemptions) order by t.redemptions desc, t.code), '[]'::jsonb)
      from (select code, redemptions from base where redemptions > 0 order by redemptions desc, code limit 10) t
    ) end
  ) into v_result;
  return v_result;
end;
$$;

create function private.report_cod_collections(p_filters jsonb, p_limit integer, p_offset integer, p_summary boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_like text := private.report_like(p_filters);
  v_result jsonb;
begin
  select * into r from private.report_range('cod_collections', p_filters);
  with base as (
    select o.order_number, o.payment_collected_at, o.payment_collected_by, o.ship_recipient_name,
           o.ship_district, o.total_minor
    from public.orders o
    where o.payment_status = 'collected'
      and o.payment_collected_at >= r.range_start and o.payment_collected_at < r.range_end
      and (v_like is null or o.order_number ilike v_like or o.ship_recipient_name ilike v_like)
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'orderNumber', x.order_number, 'collectedAt', x.payment_collected_at,
               'collectedBy', private.report_person(x.payment_collected_by),
               'customer', x.ship_recipient_name, 'district', x.ship_district, 'total', x.total_minor
             ) order by x.payment_collected_at desc, x.order_number desc)
      from (select * from base order by payment_collected_at desc, order_number desc limit p_limit offset p_offset) x
    ), '[]'::jsonb),
    'summary', case when p_summary then (
      select jsonb_build_object(
               'collections', (select count(*) from base),
               'collected', (select coalesce(sum(total_minor), 0) from base),
               'awaitingOrders', count(*),
               'awaitingAmount', coalesce(sum(o.total_minor), 0)
             )
      from public.orders o
      where o.status = 'delivered' and o.payment_status = 'pending'
    ) end,
    'chart', case when p_summary then (
      select coalesce(jsonb_agg(jsonb_build_object('label', to_char(d.day, 'YYYY-MM-DD'), 'value', coalesce(c.amount, 0)) order by d.day), '[]'::jsonb)
      from (select g.d::date as day
            from generate_series(r.day_from::timestamp, r.day_to::timestamp, interval '1 day') as g (d)) d
      left join (select (payment_collected_at at time zone 'Asia/Dhaka')::date as day, sum(total_minor) as amount
                 from base group by 1) c on c.day = d.day
    ) end
  ) into v_result;
  return v_result;
end;
$$;

create function private.report_moderation(p_filters jsonb, p_limit integer, p_offset integer, p_summary boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_status text := p_filters ->> 'status';
  v_like text := private.report_like(p_filters);
  v_result jsonb;
begin
  select * into r from private.report_range('moderation', p_filters);
  with base as (
    select t.id, p.name as product, p.sku, t.status::text as status, t.submitted_by, t.assigned_to,
           t.submitted_at, t.decided_at
    from public.moderation_tasks t
    join public.products p on p.id = t.product_id
    where t.submitted_at >= r.range_start and t.submitted_at < r.range_end
      and (v_status is null or t.status::text = v_status)
      and (v_like is null or p.name ilike v_like or p.sku ilike v_like)
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product', x.product, 'sku', x.sku, 'status', x.status,
               'submittedBy', private.report_person(x.submitted_by),
               'assignedTo', private.report_person(x.assigned_to),
               'submittedAt', x.submitted_at, 'decidedAt', x.decided_at
             ) order by x.submitted_at desc, x.id)
      from (select * from base order by submitted_at desc, id limit p_limit offset p_offset) x
    ), '[]'::jsonb),
    'summary', case when p_summary then (
      select jsonb_build_object(
               'submitted', count(*),
               'pending', count(*) filter (where status = 'pending'),
               'approved', count(*) filter (where status = 'approved'),
               'rejected', count(*) filter (where status in ('rejected', 'changes_requested'))
             )
      from base
    ) end,
    'chart', case when p_summary then (
      select coalesce(jsonb_agg(jsonb_build_object('label', s.status, 'value', s.n) order by s.n desc, s.status), '[]'::jsonb)
      from (select status, count(*) as n from base group by status) s
    ) end
  ) into v_result;
  return v_result;
end;
$$;

create function private.report_audit_logs(p_filters jsonb, p_limit integer, p_offset integer, p_summary boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_like text := private.report_like(p_filters);
  v_result jsonb;
begin
  select * into r from private.report_range('audit_logs', p_filters);
  -- Never the details: they can hold values an export must not carry.
  with base as (
    select a.id, a.created_at, a.action, a.actor_id, a.target_type, a.target_id
    from public.audit_log a
    where a.created_at >= r.range_start and a.created_at < r.range_end
      and (v_like is null or a.action ilike v_like)
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'at', x.created_at, 'action', x.action,
               'actor', coalesce(private.report_person(x.actor_id), 'System'),
               'targetType', x.target_type, 'targetId', x.target_id
             ) order by x.created_at desc, x.id desc)
      from (select * from base order by created_at desc, id desc limit p_limit offset p_offset) x
    ), '[]'::jsonb),
    'summary', case when p_summary then (select jsonb_build_object('entries', count(*)) from base) end,
    'chart', null
  ) into v_result;
  return v_result;
end;
$$;

/**
 * One page of a report for the CALLER, who must hold the kind's permission:
 * { rows, total, summary, chart } (summary and chart only when asked for).
 */
create function public.admin_report(
  p_kind text,
  p_filters jsonb,
  p_limit integer default 50,
  p_offset integer default 0,
  p_with_summary boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_permission text := private.report_permission(p_kind);
begin
  if v_permission is null then
    raise exception 'unknown report' using errcode = 'NZ412';
  end if;
  perform private.require_permission(v_permission);
  if p_limit is null or p_limit not between 1 and 5001
     or p_offset is null or p_offset not between 0 and 10000000 then
    raise exception 'invalid page' using errcode = 'NZ412';
  end if;
  return case p_kind
    when 'sales' then private.report_sales(p_filters, p_limit, p_offset, coalesce(p_with_summary, false))
    when 'orders' then private.report_orders(p_filters, p_limit, p_offset, coalesce(p_with_summary, false))
    when 'products' then private.report_products(p_filters, p_limit, p_offset, coalesce(p_with_summary, false))
    when 'inventory' then private.report_inventory(p_filters, p_limit, p_offset, coalesce(p_with_summary, false))
    when 'customers' then private.report_customers(p_filters, p_limit, p_offset, coalesce(p_with_summary, false))
    when 'coupons' then private.report_coupons(p_filters, p_limit, p_offset, coalesce(p_with_summary, false))
    when 'cod_collections' then private.report_cod_collections(p_filters, p_limit, p_offset, coalesce(p_with_summary, false))
    when 'moderation' then private.report_moderation(p_filters, p_limit, p_offset, coalesce(p_with_summary, false))
    when 'audit_logs' then private.report_audit_logs(p_filters, p_limit, p_offset, coalesce(p_with_summary, false))
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Direct downloads are audited (the filters only, never row data)
-- ---------------------------------------------------------------------------

create function public.admin_audit_export(
  p_kind text,
  p_format text,
  p_row_count integer,
  p_filters jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_permission text := private.report_permission(p_kind);
  v_actor uuid;
begin
  if v_permission is null then
    raise exception 'unknown report' using errcode = 'NZ412';
  end if;
  v_actor := private.require_permission(v_permission);
  if p_format is null or p_format not in ('csv', 'xlsx', 'pdf') or p_row_count is null or p_row_count < 0 then
    raise exception 'invalid export' using errcode = 'NZ412';
  end if;
  perform private.audit(v_actor, 'export.downloaded', 'report', p_kind,
    jsonb_build_object('kind', p_kind, 'format', p_format, 'rowCount', p_row_count,
      'filters', private.report_filters_echo(coalesce(p_filters, '{}'::jsonb))));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Order documents (invoice and packing slip)
-- ---------------------------------------------------------------------------

/**
 * Everything an invoice or packing slip shows, for staff who read orders. The delivery
 * address and phone are included because the parcel needs them. Each call is audited.
 */
create function public.admin_order_document(p_order_number text, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('orders.read');
  v_order public.orders;
  v_result jsonb;
begin
  if p_kind is null or p_kind not in ('invoice', 'packing_slip') then
    raise exception 'unknown document' using errcode = 'NZ412';
  end if;
  select * into v_order from public.orders where order_number = p_order_number;
  if not found then
    raise exception 'order not found' using errcode = 'NZ404';
  end if;

  v_result := jsonb_build_object(
    'store', coalesce((
      select jsonb_build_object(
               'name', s.display_name,
               'addressLine', s.address_line,
               'addressArea', s.address_area,
               'addressDistrict', s.address_district,
               'phone', coalesce(s.support_phone, s.contact_phone),
               'email', coalesce(s.support_email, s.contact_email)
             )
      from public.store_profile s where s.id
    ), jsonb_build_object('name', 'Nilzora', 'addressLine', null, 'addressArea', null,
         'addressDistrict', null, 'phone', null, 'email', null)),
    'order', jsonb_build_object(
      'orderNumber', v_order.order_number,
      'placedAt', v_order.placed_at,
      'status', v_order.status,
      'paymentMethod', v_order.payment_method,
      'paymentStatus', v_order.payment_status,
      'itemCount', v_order.item_count,
      'subtotalMinor', v_order.subtotal_minor,
      'discountMinor', v_order.discount_minor,
      'shippingFeeMinor', v_order.shipping_fee_minor,
      'totalMinor', v_order.total_minor,
      'customerNote', v_order.customer_note
    ),
    'delivery', jsonb_build_object(
      'recipientName', v_order.ship_recipient_name,
      'phone', v_order.ship_phone,
      'addressLine', v_order.ship_address_line,
      'area', v_order.ship_area,
      'district', v_order.ship_district,
      'division', v_order.ship_division,
      'postalCode', v_order.ship_postal_code,
      'landmark', v_order.ship_landmark,
      'zone', v_order.delivery_zone
    ),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', oi.product_name,
               'variantLabel', oi.variant_label,
               'sku', oi.sku,
               'quantity', oi.quantity,
               'unitPriceMinor', oi.unit_price_minor,
               'lineTotalMinor', oi.line_total_minor
             ) order by oi.id), '[]'::jsonb)
      from public.order_items oi where oi.order_id = v_order.id
    )
  );

  perform private.audit(v_actor,
    case p_kind when 'invoice' then 'order.invoice_downloaded' else 'order.packing_slip_downloaded' end,
    'order', v_order.order_number, jsonb_build_object('orderNumber', v_order.order_number));
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Export jobs
-- ---------------------------------------------------------------------------

create table public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (private.report_permission(kind) is not null),
  format text not null check (format in ('csv', 'xlsx', 'pdf')),
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed', 'expired')),
  progress integer not null default 0 check (progress between 0 and 100),
  row_count integer check (row_count is null or row_count >= 0),
  /** The finished file, at most 25 MB; cleared when the job expires. */
  file bytea check (file is null or octet_length(file) <= 26214400),
  file_name text check (file_name is null or file_name ~ '^[a-z0-9][a-z0-9._-]{0,119}$'),
  content_type text check (content_type is null or content_type in (
    'text/csv; charset=utf-8',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/pdf'
  )),
  /** Why the job failed, in words safe to show (never a database message). */
  error text check (error is null or char_length(error) <= 300),
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  constraint export_jobs_done_has_file check (status <> 'done' or file is not null)
);

comment on table public.export_jobs is
  'Background report exports. Reached only through the admin_*_export_job and export_* functions.';

create index export_jobs_creator_idx on public.export_jobs (created_by, created_at desc);
create index export_jobs_queue_idx on public.export_jobs (created_at) where status in ('queued', 'running');

alter table public.export_jobs enable row level security;
revoke all on table public.export_jobs from public, anon, authenticated;

/** A job as its creator sees it: never the file bytes. */
create function private.export_job_json(p_job public.export_jobs)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_job.id,
    'kind', p_job.kind,
    'format', p_job.format,
    'filters', private.report_filters_echo(p_job.filters),
    'status', case when p_job.status = 'done' and p_job.expires_at <= now() then 'expired' else p_job.status end,
    'progress', p_job.progress,
    'rowCount', p_job.row_count,
    'fileName', p_job.file_name,
    'contentType', p_job.content_type,
    'fileBytes', case when p_job.file is null then null else octet_length(p_job.file) end,
    'error', p_job.error,
    'createdAt', p_job.created_at,
    'startedAt', p_job.started_at,
    'finishedAt', p_job.finished_at,
    'expiresAt', p_job.expires_at
  );
$$;

/** Queues an export for the CALLER, who must hold the kind's permission now. */
create function public.admin_create_export_job(p_kind text, p_format text, p_filters jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_permission text := private.report_permission(p_kind);
  v_actor uuid;
  v_job public.export_jobs;
begin
  if v_permission is null then
    raise exception 'unknown report' using errcode = 'NZ412';
  end if;
  v_actor := private.require_permission(v_permission);
  if p_format is null or p_format not in ('csv', 'xlsx', 'pdf') then
    raise exception 'unknown format' using errcode = 'NZ412';
  end if;
  perform private.report_range(p_kind, p_filters);
  if (select count(*) from public.export_jobs j
      where j.created_by = v_actor and j.status in ('queued', 'running')) >= 5 then
    raise exception 'at most 5 exports may wait at a time' using errcode = 'NZ412';
  end if;

  insert into public.export_jobs (kind, format, filters, created_by)
  values (p_kind, p_format, private.report_filters_echo(p_filters), v_actor)
  returning * into v_job;
  perform private.audit(v_actor, 'export.created', 'export_job', v_job.id::text,
    jsonb_build_object('kind', p_kind, 'format', p_format, 'rowCount', null,
      'filters', private.report_filters_echo(p_filters)));
  return private.export_job_json(v_job);
end;
$$;

/** The caller's own jobs, newest first (at most 100). */
create function public.admin_list_export_jobs(p_limit integer default 50)
returns jsonb
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
  return coalesce((
    select jsonb_agg(private.export_job_json(j) order by j.created_at desc, j.id desc)
    from (select * from public.export_jobs
          where created_by = v_user
          order by created_at desc, id desc
          limit greatest(1, least(coalesce(p_limit, 50), 100))) j
  ), '[]'::jsonb);
end;
$$;

/** One of the caller's own jobs (NZ404 for anyone else's). */
create function public.admin_get_export_job(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_job public.export_jobs;
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  select * into v_job from public.export_jobs where id = p_id and created_by = v_user;
  if not found then
    raise exception 'export not found' using errcode = 'NZ404';
  end if;
  return private.export_job_json(v_job);
end;
$$;

/**
 * The finished file of one of the caller's own jobs. The caller must still hold the
 * report's permission (NZ403); the job must be done (NZ443) and not expired (NZ444).
 */
create function public.admin_download_export_job(p_id uuid)
returns table (file bytea, file_name text, content_type text, row_count integer, kind text, format text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_job public.export_jobs;
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  select * into v_job from public.export_jobs j where j.id = p_id and j.created_by = v_user;
  if not found then
    raise exception 'export not found' using errcode = 'NZ404';
  end if;
  perform private.require_permission(private.report_permission(v_job.kind));
  if v_job.status = 'expired' or (v_job.status = 'done' and v_job.expires_at <= now()) then
    raise exception 'the export has expired' using errcode = 'NZ444';
  end if;
  if v_job.status <> 'done' then
    raise exception 'the export is not ready' using errcode = 'NZ443';
  end if;
  perform private.audit(v_user, 'export.downloaded', 'export_job', v_job.id::text,
    jsonb_build_object('kind', v_job.kind, 'format', v_job.format, 'rowCount', v_job.row_count,
      'filters', private.report_filters_echo(v_job.filters)));
  return query select v_job.file, v_job.file_name, v_job.content_type, v_job.row_count, v_job.kind, v_job.format;
end;
$$;

-- Worker side (the API process, as service_role): never callable by signed-in accounts.

/** Claims the oldest queued job (or one whose run stopped for 15 minutes) for running. */
create function public.export_claim_job()
returns table (id uuid, kind text, format text, filters jsonb, created_by uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.export_jobs j
  set status = 'running', started_at = now(), progress = 0, error = null
  where j.id = (
    select q.id from public.export_jobs q
    where q.status = 'queued'
       or (q.status = 'running' and q.started_at < now() - interval '15 minutes')
    order by q.created_at
    for update skip locked
    limit 1
  )
  returning j.id, j.kind, j.format, j.filters, j.created_by;
end;
$$;

create function public.export_job_progress(p_id uuid, p_progress integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.export_jobs
  set progress = greatest(0, least(99, coalesce(p_progress, 0)))
  where id = p_id and status = 'running';
$$;

create function public.export_finish_job(
  p_id uuid,
  p_file bytea,
  p_file_name text,
  p_content_type text,
  p_row_count integer
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.export_jobs
  set status = 'done', progress = 100, file = p_file, file_name = p_file_name,
      content_type = p_content_type, row_count = p_row_count, finished_at = now(),
      expires_at = now() + interval '7 days', error = null
  where id = p_id and status = 'running';
$$;

create function public.export_fail_job(p_id uuid, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.export_jobs
  set status = 'failed', error = left(coalesce(p_error, 'The export failed'), 300), file = null,
      finished_at = now()
  where id = p_id and status in ('queued', 'running');
$$;

/** Marks finished and failed jobs past their 7 days expired and drops their files. */
create function public.export_expire_jobs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.export_jobs
  set status = 'expired', file = null
  where status in ('done', 'failed', 'queued') and expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function private.report_person(uuid) from public, anon, authenticated;
revoke execute on function private.report_sales(jsonb, integer, integer, boolean) from public, anon, authenticated;
revoke execute on function private.report_orders(jsonb, integer, integer, boolean) from public, anon, authenticated;
revoke execute on function private.report_products(jsonb, integer, integer, boolean) from public, anon, authenticated;
revoke execute on function private.report_inventory(jsonb, integer, integer, boolean) from public, anon, authenticated;
revoke execute on function private.report_customers(jsonb, integer, integer, boolean) from public, anon, authenticated;
revoke execute on function private.report_coupons(jsonb, integer, integer, boolean) from public, anon, authenticated;
revoke execute on function private.report_cod_collections(jsonb, integer, integer, boolean) from public, anon, authenticated;
revoke execute on function private.report_moderation(jsonb, integer, integer, boolean) from public, anon, authenticated;
revoke execute on function private.report_audit_logs(jsonb, integer, integer, boolean) from public, anon, authenticated;
revoke execute on function private.export_job_json(public.export_jobs) from public, anon, authenticated;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.admin_report(text, jsonb, integer, integer, boolean)',
    'public.admin_audit_export(text, text, integer, jsonb)',
    'public.admin_order_document(text, text)',
    'public.admin_create_export_job(text, text, jsonb)',
    'public.admin_list_export_jobs(integer)',
    'public.admin_get_export_job(uuid)',
    'public.admin_download_export_job(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;

  foreach v_fn in array array[
    'public.export_claim_job()',
    'public.export_job_progress(uuid, integer)',
    'public.export_finish_job(uuid, bytea, text, text, integer)',
    'public.export_fail_job(uuid, text)',
    'public.export_expire_jobs()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end;
$$;
