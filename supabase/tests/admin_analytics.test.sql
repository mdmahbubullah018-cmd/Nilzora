-- Database-level checks for the analytics overview and the monthly sales target:
-- who may call them, how ranges are validated, and that every figure is computed
-- from known fixture rows (Dhaka day boundaries, cancelled orders, withdrawn returns,
-- customers only, the comparison period). Fixtures live in March 2031 so the rows a
-- local database already holds never fall inside the ranges asserted here.
-- Runs inside a transaction that is rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(59);

-- ---------------------------------------------------------------------------
-- Accounts (as the database owner)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000b0', 'an-owner-t@example.com', now()),
  ('00000000-0000-4000-8000-0000000000b1', 'an-admin-t@example.com', now()),
  ('00000000-0000-4000-8000-0000000000b2', 'an-staff-t@example.com', now()),
  ('00000000-0000-4000-8000-0000000000b3', 'an-admin2-t@example.com', now()),
  ('00000000-0000-4000-8000-0000000000b5', 'an-buyer1-t@example.com', now()),
  ('00000000-0000-4000-8000-0000000000b6', 'an-buyer2-t@example.com', now()),
  ('00000000-0000-4000-8000-0000000000b7', 'an-buyer3-t@example.com', now());

update public.user_roles set role = 'super_admin' where user_id = '00000000-0000-4000-8000-0000000000b0';
update public.user_roles set role = 'admin'
  where user_id in ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b3');
update public.user_roles set role = 'staff' where user_id = '00000000-0000-4000-8000-0000000000b2';
-- The second admin may read finance but not customers.
insert into public.user_permissions (user_id, permission, effect)
  values ('00000000-0000-4000-8000-0000000000b3', 'customers.read', 'deny');

update public.profiles set full_name = 'Buyer One' where id = '00000000-0000-4000-8000-0000000000b5';
-- Customers sign up on the range's first Dhaka day, mid-range, and in the previous period.
update public.profiles set created_at = '2031-03-02 18:05:00+00' where id = '00000000-0000-4000-8000-0000000000b5';
update public.profiles set created_at = '2031-03-05 06:00:00+00' where id = '00000000-0000-4000-8000-0000000000b6';
update public.profiles set created_at = '2031-02-25 06:00:00+00' where id = '00000000-0000-4000-8000-0000000000b7';
-- Staff signing up in the range are not new customers.
update public.profiles set created_at = '2031-03-04 06:00:00+00' where id = '00000000-0000-4000-8000-0000000000b2';

create temporary table t (key text primary key, value jsonb) on commit drop;
grant select, insert, update on t to authenticated;

-- Figures that are not bound to the range, before this test adds anything.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b0", "role": "authenticated"}';
insert into t values ('before', public.admin_analytics_overview('2031-03-03', '2031-03-09'));
reset role;

-- ---------------------------------------------------------------------------
-- Catalogue, orders, returns, carts and checkouts
-- ---------------------------------------------------------------------------

insert into public.categories (id, slug, name) values
  ('ca000000-0000-4000-8000-0000000000f1', 'an-lamps', 'Analytics Lamps'),
  ('ca000000-0000-4000-8000-0000000000f2', 'an-clocks', 'Analytics Clocks');
insert into public.products (id, category_id, slug, sku, name, price_minor, stock_quantity, status) values
  ('0d000000-0000-4000-8000-0000000000f1', 'ca000000-0000-4000-8000-0000000000f1', 'an-lamp', 'AN-LAMP', 'Analytics Lamp', 10000, 50, 'active'),
  ('0d000000-0000-4000-8000-0000000000f2', 'ca000000-0000-4000-8000-0000000000f2', 'an-clock', 'AN-CLOCK', 'Analytics Clock', 50000, 50, 'active'),
  -- Low stock, sold out, and a sold-out draft that is not on sale.
  ('0d000000-0000-4000-8000-0000000000f3', 'ca000000-0000-4000-8000-0000000000f1', 'an-low', 'AN-LOW', 'Analytics Low', 1000, 3, 'active'),
  ('0d000000-0000-4000-8000-0000000000f4', 'ca000000-0000-4000-8000-0000000000f1', 'an-out', 'AN-OUT', 'Analytics Out', 1000, 0, 'active'),
  ('0d000000-0000-4000-8000-0000000000f5', 'ca000000-0000-4000-8000-0000000000f1', 'an-draft', 'AN-DRAFT', 'Analytics Draft', 1000, 0, 'draft');

-- Range: Monday 3 to Sunday 9 March 2031 (Dhaka, UTC+6). Previous: 24 Feb to 2 Mar.
insert into public.orders (id, user_id, status, payment_status, payment_collected_at, item_count,
  subtotal_minor, shipping_fee_minor, total_minor, delivery_zone, ship_recipient_name, ship_phone,
  ship_division, ship_district, ship_area, ship_address_line, idempotency_key, request_fingerprint,
  placed_at, cancelled_at, cancel_reason) values
  -- O1: 00:30 on 3 March in Dhaka (18:30 UTC the day before): the range's first day.
  ('0e000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000b5', 'delivered', 'collected',
    '2031-03-05 08:00:00+00', 2, 20000, 6000, 26000, 'inside_dhaka', 'Buyer', '+8801712345678',
    'Dhaka', 'Dhaka', 'Mirpur', 'House 1', gen_random_uuid(), 'an-f1', '2031-03-02 18:30:00+00', null, null),
  -- O2 and O3: Tuesday 10:15 and 10:45 in Dhaka.
  ('0e000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000b5', 'delivered', 'pending',
    null, 1, 50000, 12000, 62000, 'outside_dhaka', 'Buyer', '+8801712345678',
    'Chattogram', 'Chattogram', 'Agrabad', 'House 2', gen_random_uuid(), 'an-f2', '2031-03-04 04:15:00+00', null, null),
  ('0e000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000b6', 'pending', 'pending',
    null, 1, 10000, 6000, 16000, 'inside_dhaka', 'Buyer', '+8801712345678',
    'Dhaka', 'Dhaka', 'Mirpur', 'House 3', gen_random_uuid(), 'an-f3', '2031-03-04 04:45:00+00', null, null),
  -- O4: cancelled, Wednesday 20:00 in Dhaka.
  ('0e000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000b6', 'cancelled', 'cancelled',
    null, 3, 150000, 6000, 156000, 'inside_dhaka', 'Buyer', '+8801712345678',
    'Dhaka', 'Dhaka', 'Mirpur', 'House 3', gen_random_uuid(), 'an-f4', '2031-03-05 14:00:00+00',
    '2031-03-05 15:00:00+00', 'Changed mind'),
  -- O5: 23:59 on 2 March in Dhaka: the previous period's last day.
  ('0e000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-0000000000b7', 'delivered', 'collected',
    '2031-03-04 08:00:00+00', 1, 10000, 6000, 16000, 'inside_dhaka', 'Buyer', '+8801712345678',
    'Dhaka', 'Dhaka', 'Mirpur', 'House 5', gen_random_uuid(), 'an-f5', '2031-03-02 17:59:00+00', null, null),
  -- O6: 23:30 on Sunday 9 March in Dhaka: the range's last day.
  ('0e000000-0000-4000-8000-0000000000f6', '00000000-0000-4000-8000-0000000000b7', 'shipped', 'pending',
    null, 5, 50000, 12000, 62000, 'outside_dhaka', 'Buyer', '+8801712345678',
    'Sylhet', 'Sylhet', 'Zindabazar', 'House 6', gen_random_uuid(), 'an-f6', '2031-03-09 17:30:00+00', null, null),
  -- O7: 00:10 on 10 March in Dhaka (still 9 March in UTC): after the range.
  ('0e000000-0000-4000-8000-0000000000f7', '00000000-0000-4000-8000-0000000000b5', 'pending', 'pending',
    null, 1, 10000, 6000, 16000, 'inside_dhaka', 'Buyer', '+8801712345678',
    'Dhaka', 'Dhaka', 'Mirpur', 'House 1', gen_random_uuid(), 'an-f7', '2031-03-09 18:10:00+00', null, null);

insert into public.order_items (order_id, product_id, product_name, product_slug, sku, unit_price_minor, quantity, line_total_minor) values
  ('0e000000-0000-4000-8000-0000000000f1', '0d000000-0000-4000-8000-0000000000f1', 'Old lamp name', 'an-lamp', 'AN-LAMP', 10000, 2, 20000),
  ('0e000000-0000-4000-8000-0000000000f2', '0d000000-0000-4000-8000-0000000000f2', 'Analytics Clock', 'an-clock', 'AN-CLOCK', 50000, 1, 50000),
  ('0e000000-0000-4000-8000-0000000000f3', '0d000000-0000-4000-8000-0000000000f1', 'Analytics Lamp', 'an-lamp', 'AN-LAMP', 10000, 1, 10000),
  ('0e000000-0000-4000-8000-0000000000f4', '0d000000-0000-4000-8000-0000000000f2', 'Analytics Clock', 'an-clock', 'AN-CLOCK', 50000, 3, 150000),
  ('0e000000-0000-4000-8000-0000000000f5', '0d000000-0000-4000-8000-0000000000f1', 'Analytics Lamp', 'an-lamp', 'AN-LAMP', 10000, 1, 10000),
  ('0e000000-0000-4000-8000-0000000000f6', '0d000000-0000-4000-8000-0000000000f1', 'Analytics Lamp', 'an-lamp', 'AN-LAMP', 10000, 5, 50000),
  ('0e000000-0000-4000-8000-0000000000f7', '0d000000-0000-4000-8000-0000000000f1', 'Analytics Lamp', 'an-lamp', 'AN-LAMP', 10000, 1, 10000);

-- O1 has an open return; O2's return was withdrawn and does not count.
insert into public.return_requests (order_id, user_id, status, reason, item_count) values
  ('0e000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000b5', 'requested', 'Arrived damaged', 1),
  ('0e000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000b5', 'cancelled', 'Wrong colour', 1);

insert into public.carts (id, user_id, guest_token, status, created_at) values
  ('0c000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000b5', null, 'converted', '2031-03-02 18:20:00+00'),
  ('0c000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000b6', null, 'expired', '2031-03-04 04:00:00+00'),
  ('0c000000-0000-4000-8000-0000000000f3', null, gen_random_uuid(), 'active', '2031-03-06 10:00:00+00'),
  ('0c000000-0000-4000-8000-0000000000f4', null, gen_random_uuid(), 'active', '2031-03-09 18:30:00+00');
insert into public.checkout_sessions (cart_id, user_id, status, started_at, converted_at) values
  ('0c000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000b5', 'converted', '2031-03-02 18:25:00+00', '2031-03-02 18:30:00+00'),
  ('0c000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000b6', 'expired', '2031-03-04 04:10:00+00', null),
  ('0c000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000b6', 'expired', '2031-02-20 04:10:00+00', null);

-- ---------------------------------------------------------------------------
-- Who may read the overview
-- ---------------------------------------------------------------------------

set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select throws_ok($$ select public.admin_analytics_overview('2031-03-03', '2031-03-09') $$,
  '42501', null, 'the public cannot call the overview');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b5", "role": "authenticated"}';
select throws_ok($$ select public.admin_analytics_overview('2031-03-03', '2031-03-09') $$,
  'NZ403', null, 'customers cannot read analytics');
select throws_ok($$ select private.analytics_totals(now() - interval '1 day', now()) $$,
  '42501', null, 'the totals helper is not callable directly');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b2", "role": "authenticated"}';
select throws_ok($$ select public.admin_analytics_overview('2031-03-03', '2031-03-09') $$,
  'NZ403', null, 'staff without finance.read cannot read analytics');

-- ---------------------------------------------------------------------------
-- Range validation
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b0", "role": "authenticated"}';
select throws_ok($$ select public.admin_analytics_overview('2031-03-09', '2031-03-03') $$,
  'NZ412', null, 'a range must not end before it starts');
select throws_ok($$ select public.admin_analytics_overview('2031-01-01', '2032-01-02') $$,
  'NZ412', null, 'a range is at most 366 days');
select throws_ok($$ select public.admin_analytics_overview(null, '2031-03-03') $$,
  'NZ412', null, 'a range needs both ends');
select is((public.admin_analytics_overview('2032-01-01', '2032-12-31', false))->'range'->>'days', '366',
  'a whole leap year is allowed');

-- ---------------------------------------------------------------------------
-- The figures, as the owner
-- ---------------------------------------------------------------------------

insert into t values ('owner', public.admin_analytics_overview('2031-03-03', '2031-03-09'));

select is((select value->'range' from t where key = 'owner'),
  '{"from": "2031-03-03", "to": "2031-03-09", "days": 7}'::jsonb, 'the range is echoed with its length');
select is((select value->'previousRange' from t where key = 'owner'),
  '{"from": "2031-02-24", "to": "2031-03-02"}'::jsonb, 'the previous period is the 7 days before');
select is((select value->'totals' from t where key = 'owner'),
  '{"orderCount": 4, "cancelledCount": 1, "revenueMinor": 166000, "averageOrderMinor": 41500,
    "newCustomers": 2, "collectedMinor": 26000, "deliveredCount": 2, "returnedOrderCount": 1}'::jsonb,
  'totals count Dhaka days, exclude cancelled orders, staff sign-ups and withdrawn returns');
select is((select value->'previousTotals' from t where key = 'owner'),
  '{"orderCount": 1, "cancelledCount": 0, "revenueMinor": 16000, "averageOrderMinor": 16000,
    "newCustomers": 1, "collectedMinor": 16000, "deliveredCount": 1, "returnedOrderCount": 0}'::jsonb,
  'the previous period holds the order placed at 23:59 on its last Dhaka day');

select is((select jsonb_array_length(value->'daily') from t where key = 'owner'), 7, 'one daily entry per day');
select is((select value->'daily'->0 from t where key = 'owner'),
  '{"day": "2031-03-03", "revenueMinor": 26000, "orderCount": 1, "newCustomers": 1, "byStatus": {"delivered": 1}}'::jsonb,
  'an order at 00:30 Dhaka time belongs to that Dhaka day');
select is((select value->'daily'->1 from t where key = 'owner'),
  '{"day": "2031-03-04", "revenueMinor": 78000, "orderCount": 2, "newCustomers": 0, "byStatus": {"delivered": 1, "pending": 1}}'::jsonb,
  'a day sums its orders');
select is((select value->'daily'->2 from t where key = 'owner'),
  '{"day": "2031-03-05", "revenueMinor": 0, "orderCount": 0, "newCustomers": 1, "byStatus": {"cancelled": 1}}'::jsonb,
  'a cancelled order shows in the status split but not in revenue');
select is((select value->'daily'->3 from t where key = 'owner'),
  '{"day": "2031-03-06", "revenueMinor": 0, "orderCount": 0, "newCustomers": 0, "byStatus": {}}'::jsonb,
  'days without orders are included');
select is((select value->'daily'->6 from t where key = 'owner'),
  '{"day": "2031-03-09", "revenueMinor": 62000, "orderCount": 1, "newCustomers": 0, "byStatus": {"shipped": 1}}'::jsonb,
  'the last day ends at midnight Dhaka time');

select is((select jsonb_array_length(value->'previousDaily') from t where key = 'owner'), 7,
  'the previous period has one entry per day');
select is((select value->'previousDaily'->6 from t where key = 'owner'),
  '{"day": "2031-03-02", "revenueMinor": 16000, "orderCount": 1}'::jsonb, 'and its own daily revenue');
select is((select value->'previousDaily'->0 from t where key = 'owner'),
  '{"day": "2031-02-24", "revenueMinor": 0, "orderCount": 0}'::jsonb, 'oldest first');

select is((select value->'statusSplit' from t where key = 'owner'),
  '{"delivered": 2, "pending": 1, "shipped": 1, "cancelled": 1}'::jsonb, 'the status split counts every order of the range');
select is((select value->'paymentSplit' from t where key = 'owner'),
  '{"pendingMinor": 140000, "pendingCount": 3, "collectedMinor": 26000, "collectedCount": 1}'::jsonb,
  'the payment split covers non-cancelled orders');
select is((select value->'deliveryZones' from t where key = 'owner'),
  '[{"zone": "inside_dhaka", "orderCount": 2, "revenueMinor": 42000},
    {"zone": "outside_dhaka", "orderCount": 2, "revenueMinor": 124000}]'::jsonb,
  'every delivery zone, with non-cancelled orders only');
select is((select value->'salesByCategory' from t where key = 'owner'),
  '[{"categoryId": "ca000000-0000-4000-8000-0000000000f1", "categoryName": "Analytics Lamps", "unitsSold": 8, "revenueMinor": 80000},
    {"categoryId": "ca000000-0000-4000-8000-0000000000f2", "categoryName": "Analytics Clocks", "unitsSold": 1, "revenueMinor": 50000}]'::jsonb,
  'category sales, largest first, without the cancelled order');
select is((select value->'topProducts' from t where key = 'owner'),
  '[{"productId": "0d000000-0000-4000-8000-0000000000f1", "productName": "Analytics Lamp", "unitsSold": 8, "revenueMinor": 80000},
    {"productId": "0d000000-0000-4000-8000-0000000000f2", "productName": "Analytics Clock", "unitsSold": 1, "revenueMinor": 50000}]'::jsonb,
  'best sellers by units, under the product''s current name');
select is((select value->'heatmap' from t where key = 'owner'),
  '[{"weekday": 1, "hour": 0, "orderCount": 1}, {"weekday": 2, "hour": 10, "orderCount": 2},
    {"weekday": 3, "hour": 20, "orderCount": 1}, {"weekday": 7, "hour": 23, "orderCount": 1}]'::jsonb,
  'the heatmap uses Dhaka weekdays (Monday = 1) and hours, omitting empty cells');
select is((select value->'funnel' from t where key = 'owner'),
  '{"carts": 3, "checkouts": 2, "orders": 5}'::jsonb, 'the funnel counts carts, checkouts and orders of the range');
select is((select value->'rates' from t where key = 'owner'),
  '{"fulfillment": 0.5, "returns": 0.5}'::jsonb, 'delivered ÷ orders, and returned ÷ delivered');

select is((select jsonb_array_length(value->'topCustomers') from t where key = 'owner'), 3,
  'exactly three customers bought in the range');
select is((select value->'topCustomers'->0 from t where key = 'owner'),
  '{"customerId": "00000000-0000-4000-8000-0000000000b5", "name": "Buyer One", "email": "an-buyer1-t@example.com",
    "orderCount": 2, "revenueMinor": 88000, "daily": [26000, 62000, 0, 0, 0, 0, 0]}'::jsonb,
  'the top customer comes first with a revenue value for every day');
select is((select jsonb_agg(c.entry->>'customerId' order by c.n)
    from t, jsonb_array_elements(t.value->'topCustomers') with ordinality as c (entry, n) where t.key = 'owner'),
  '["00000000-0000-4000-8000-0000000000b5", "00000000-0000-4000-8000-0000000000b7", "00000000-0000-4000-8000-0000000000b6"]'::jsonb,
  'customers are ordered by revenue, cancelled orders excluded');

-- Snapshot figures are not bound to the range: compare with the values before the fixtures.
select is((select ((a.value->'snapshot'->>'codPendingCount')::int - (b.value->'snapshot'->>'codPendingCount')::int)
  from t a, t b where a.key = 'owner' and b.key = 'before'), 1, 'one more delivered order awaits its cash');
select is((select ((a.value->'snapshot'->>'codPendingMinor')::bigint - (b.value->'snapshot'->>'codPendingMinor')::bigint)
  from t a, t b where a.key = 'owner' and b.key = 'before'), 62000::bigint, 'with its total');
select is((select ((a.value->'snapshot'->>'lowStockCount')::int - (b.value->'snapshot'->>'lowStockCount')::int)
  from t a, t b where a.key = 'owner' and b.key = 'before'), 2, 'low stock counts products on sale at or below 5, sold out included');
select is((select ((a.value->'snapshot'->>'outOfStockCount')::int - (b.value->'snapshot'->>'outOfStockCount')::int)
  from t a, t b where a.key = 'owner' and b.key = 'before'), 1, 'sold out counts products on sale only');

-- Without a comparison
insert into t values ('single', public.admin_analytics_overview('2031-03-03', '2031-03-09', false));
select ok((select value->'previousTotals' = 'null'::jsonb and value->'previousRange' = 'null'::jsonb
  and value->'previousDaily' = '[]'::jsonb from t where key = 'single'), 'compare=false leaves the previous period out');
select is((select value->'totals' from t where key = 'single'), (select value->'totals' from t where key = 'owner'),
  'and changes nothing else');

-- ---------------------------------------------------------------------------
-- Top customers need customers.read
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b1", "role": "authenticated"}';
select is(jsonb_array_length((public.admin_analytics_overview('2031-03-03', '2031-03-09'))->'topCustomers'), 3,
  'an admin with customers.read sees top customers');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b3", "role": "authenticated"}';
insert into t values ('no-customers', public.admin_analytics_overview('2031-03-03', '2031-03-09'));
select is((select value->'topCustomers' from t where key = 'no-customers'), 'null'::jsonb,
  'without customers.read the top customers are null');
select is((select value->'totals' from t where key = 'no-customers'), (select value->'totals' from t where key = 'owner'),
  'while the finance figures are the same');

-- ---------------------------------------------------------------------------
-- The monthly target and this month's revenue
-- ---------------------------------------------------------------------------

select is((select value->'monthTarget'->>'month' from t where key = 'owner'),
  to_char(now() at time zone 'Asia/Dhaka', 'YYYY-MM'), 'the target is for the current Dhaka month');

reset role;
insert into public.orders (user_id, status, payment_status, item_count, subtotal_minor, shipping_fee_minor,
  total_minor, delivery_zone, ship_recipient_name, ship_phone, ship_division, ship_district, ship_area,
  ship_address_line, idempotency_key, request_fingerprint, placed_at, cancelled_at, cancel_reason) values
  ('00000000-0000-4000-8000-0000000000b6', 'confirmed', 'pending', 1, 12345, 0, 12345, 'inside_dhaka', 'Buyer',
    '+8801712345678', 'Dhaka', 'Dhaka', 'Mirpur', 'House 3', gen_random_uuid(), 'an-now', now(), null, null),
  ('00000000-0000-4000-8000-0000000000b6', 'cancelled', 'cancelled', 1, 99999, 0, 99999, 'inside_dhaka', 'Buyer',
    '+8801712345678', 'Dhaka', 'Dhaka', 'Mirpur', 'House 3', gen_random_uuid(), 'an-now-c', now(), now(), 'Test');
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b0", "role": "authenticated"}';
select is(((public.admin_analytics_overview('2031-03-03', '2031-03-09'))->'monthTarget'->>'revenueMinor')::bigint
  - (select (value->'monthTarget'->>'revenueMinor')::bigint from t where key = 'owner'), 12345::bigint,
  'this month''s revenue counts orders placed now, whatever the range, and not cancelled ones');

-- ---------------------------------------------------------------------------
-- Setting the target
-- ---------------------------------------------------------------------------

set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select throws_ok($$ select public.admin_set_sales_target(100) $$, '42501', null, 'the public cannot set a target');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b2", "role": "authenticated"}';
select throws_ok($$ select public.admin_set_sales_target(100) $$, 'NZ403', null, 'staff cannot set a target');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b1", "role": "authenticated"}';
select throws_ok($$ select public.admin_set_sales_target(100) $$, 'NZ403', null,
  'an admin without settings.manage cannot set a target');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000b0", "role": "authenticated"}';
select throws_ok($$ select public.admin_set_sales_target(-1) $$, 'NZ412', null, 'a target cannot be negative');
select throws_ok($$ select public.admin_set_sales_target(100000000001) $$, 'NZ412', null,
  'a target is at most 1,000,000,000 taka');

insert into t values ('first', public.admin_set_sales_target(5000000));
insert into t values ('second', public.admin_set_sales_target(7500000));
select is((select value->'targetMinor' from t where key = 'second'), '7500000'::jsonb, 'the owner sets a target');
select ok((select (value->>'updatedAt')::timestamptz is not null from t where key = 'second'), 'with the time it changed');
select is(((public.admin_analytics_overview('2031-03-03', '2031-03-09'))->'monthTarget'->'targetMinor'), '7500000'::jsonb,
  'the overview reports the target');
select is(public.admin_set_sales_target(0)->'targetMinor', '0'::jsonb, 'a zero target is allowed');
select is(public.admin_set_sales_target(null)->'targetMinor', 'null'::jsonb, 'null clears the target');
select is(((public.admin_analytics_overview('2031-03-03', '2031-03-09'))->'monthTarget'->'targetMinor'), 'null'::jsonb,
  'and the overview shows no target');

reset role;
select is((select count(*)::int from public.audit_log
  where action = 'settings.sales_target_changed' and actor_id = '00000000-0000-4000-8000-0000000000b0'), 4,
  'every change is audited');
select is((select details from public.audit_log
  where action = 'settings.sales_target_changed' and actor_id = '00000000-0000-4000-8000-0000000000b0'
  order by id offset 1 limit 1), '{"before": 5000000, "after": 7500000}'::jsonb, 'with the value before and after');
select is((select target_type || ':' || target_id from public.audit_log
  where action = 'settings.sales_target_changed' order by id desc limit 1), 'store_settings:settings',
  'against the store settings');
select is((select updated_by from public.store_settings where id), '00000000-0000-4000-8000-0000000000b0'::uuid,
  'the settings row records who changed it');
select throws_ok($$ update public.store_settings set monthly_sales_target_minor = -5 where id $$, '23514', null,
  'the column refuses a negative target');

select * from finish();
rollback;
