-- Database-level checks for reports, exports and order documents: every report checks
-- its own permission for the caller and validates its filters; figures come from known
-- fixtures (March 2032, far from local data); personal data stays out of the report
-- rows; order documents and downloads are audited with their filters only; export jobs
-- belong to their creator, recheck permissions on download, and expire.
-- Runs inside a transaction that is rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(81);

-- ---------------------------------------------------------------------------
-- Fixtures (as the database owner)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000d0', 'rx-owner@example.com', now()),
  ('00000000-0000-4000-8000-0000000000d1', 'rx-admin@example.com', now()),
  ('00000000-0000-4000-8000-0000000000d2', 'rx-staff@example.com', now()),
  ('00000000-0000-4000-8000-0000000000d3', 'rx-mod@example.com', now()),
  ('00000000-0000-4000-8000-0000000000d5', 'rx-buyer1@example.com', now()),
  ('00000000-0000-4000-8000-0000000000d6', 'rx-buyer2@example.com', now());

update public.user_roles set role = 'super_admin' where user_id = '00000000-0000-4000-8000-0000000000d0';
update public.user_roles set role = 'admin' where user_id = '00000000-0000-4000-8000-0000000000d1';
update public.user_roles set role = 'staff' where user_id = '00000000-0000-4000-8000-0000000000d2';
update public.user_roles set role = 'moderator' where user_id = '00000000-0000-4000-8000-0000000000d3';
update public.profiles set full_name = 'RX Staff' where id = '00000000-0000-4000-8000-0000000000d2';
update public.profiles set full_name = 'RX Buyer', created_at = '2032-03-01 06:00:00+00'
  where id = '00000000-0000-4000-8000-0000000000d5';
update public.profiles set created_at = '2032-03-02 06:00:00+00' where id = '00000000-0000-4000-8000-0000000000d6';

insert into public.categories (id, slug, name) values ('ca000000-0000-4000-8000-0000000000d1', 'rx-cat', 'RX Category');
insert into public.products (id, category_id, slug, sku, name, price_minor, stock_quantity, status) values
  ('0d000000-0000-4000-8000-0000000000d1', 'ca000000-0000-4000-8000-0000000000d1', 'rx-lamp', 'RX-LAMP', 'RX Lamp', 10000, 8, 'active');

insert into public.orders (id, order_number, user_id, status, payment_status, payment_collected_at, payment_collected_by,
  item_count, subtotal_minor, shipping_fee_minor, total_minor, delivery_zone, ship_recipient_name, ship_phone,
  ship_division, ship_district, ship_area, ship_address_line, idempotency_key, request_fingerprint,
  placed_at, cancelled_at, cancel_reason) values
  ('0e000000-0000-4000-8000-0000000000d1', 'NZ2032000001', '00000000-0000-4000-8000-0000000000d5', 'delivered', 'collected',
    '2032-03-02 06:00:00+00', '00000000-0000-4000-8000-0000000000d2', 2, 20000, 6000, 26000, 'inside_dhaka',
    'Rahim 100% Ltd', '+8801712345678', 'Dhaka', 'Gazipur', 'Tongi', 'House 9, Road 4', gen_random_uuid(), 'rx-1',
    '2032-03-01 04:00:00+00', null, null),
  ('0e000000-0000-4000-8000-0000000000d2', 'NZ2032000002', '00000000-0000-4000-8000-0000000000d6', 'pending', 'pending',
    null, null, 1, 10000, 6000, 16000, 'outside_dhaka',
    'Karim', '+8801812345678', 'Sylhet', 'Sylhet', 'Zindabazar', 'House 2', gen_random_uuid(), 'rx-2',
    '2032-03-02 09:00:00+00', null, null),
  ('0e000000-0000-4000-8000-0000000000d3', 'NZ2032000003', '00000000-0000-4000-8000-0000000000d5', 'cancelled', 'cancelled',
    null, null, 5, 50000, 0, 50000, 'inside_dhaka',
    'Rahim', '+8801712345678', 'Dhaka', 'Dhaka', 'Mirpur', 'House 1', gen_random_uuid(), 'rx-3',
    '2032-03-03 03:00:00+00', '2032-03-03 04:00:00+00', 'Changed mind');
insert into public.order_items (order_id, product_id, product_name, product_slug, sku, unit_price_minor, quantity, line_total_minor) values
  ('0e000000-0000-4000-8000-0000000000d1', '0d000000-0000-4000-8000-0000000000d1', 'RX Lamp', 'rx-lamp', 'RX-LAMP', 10000, 2, 20000);
insert into public.inventory_movements (product_id, change, stock_after, reason, order_id, actor_id, note, created_at) values
  ('0d000000-0000-4000-8000-0000000000d1', -2, 8, 'order_placed', '0e000000-0000-4000-8000-0000000000d1',
    '00000000-0000-4000-8000-0000000000d5', null, '2032-03-01 04:00:00+00'),
  ('0d000000-0000-4000-8000-0000000000d1', 3, 11, 'adjustment', null,
    '00000000-0000-4000-8000-0000000000d2', 'Recount', '2032-03-02 05:00:00+00');
insert into public.audit_log (actor_id, action, target_type, target_id, details, created_at) values
  ('00000000-0000-4000-8000-0000000000d2', 'rx.secret_rotated', 'setting', 'rx', '{"value": "do-not-export"}', '2032-03-02 05:00:00+00');

create temporary table t (key text primary key, value text) on commit drop;
grant select, insert, update on t to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Permissions and validation
-- ---------------------------------------------------------------------------

set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select throws_ok($$ select public.admin_report('orders', '{"from": "2032-03-01", "to": "2032-03-03"}') $$,
  '42501', null, 'the public cannot read reports');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d5", "role": "authenticated"}';
select throws_ok($$ select public.admin_report('orders', '{"from": "2032-03-01", "to": "2032-03-03"}') $$,
  'NZ403', null, 'customers cannot read reports');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d2", "role": "authenticated"}';
select throws_ok($$ select public.admin_report('sales', '{"from": "2032-03-01", "to": "2032-03-03"}') $$,
  'NZ403', null, 'staff without finance.read cannot read sales');
select throws_ok($$ select public.admin_report('audit_logs', '{"from": "2032-03-01", "to": "2032-03-03"}') $$,
  'NZ403', null, 'or the audit log');
select lives_ok($$ select public.admin_report('orders', '{"from": "2032-03-01", "to": "2032-03-03"}') $$,
  'staff with orders.read read the orders report');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d3", "role": "authenticated"}';
select throws_ok($$ select public.admin_report('orders', '{"from": "2032-03-01", "to": "2032-03-03"}') $$,
  'NZ403', null, 'moderators cannot read orders');
select throws_ok($$ select public.admin_report('customers', '{"from": "2032-03-01", "to": "2032-03-03"}') $$,
  'NZ403', null, 'or customers');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d0", "role": "authenticated"}';
select throws_ok($$ select public.admin_report('payroll', '{"from": "2032-03-01", "to": "2032-03-03"}') $$,
  'NZ412', null, 'an unknown kind is refused');
select throws_ok($$ select public.admin_report('sales', '{"from": "2032-01-01", "to": "2033-01-02"}') $$,
  'NZ412', null, 'a range is at most 366 days');
select throws_ok($$ select public.admin_report('sales', '{"from": "2032-03-03", "to": "2032-03-01"}') $$,
  'NZ412', null, 'a range must not end before it starts');
select throws_ok($$ select public.admin_report('sales', '{"from": "2032-02-30", "to": "2032-03-01"}') $$,
  'NZ412', null, 'an impossible date is refused');
select throws_ok($$ select public.admin_report('sales', '{"to": "2032-03-01"}') $$,
  'NZ412', null, 'a range needs both ends');
select throws_ok($$ select public.admin_report('sales', '{"from": "2032-03-01", "to": "2032-03-03", "status": "pending"}') $$,
  'NZ412', null, 'a filter the kind does not take is refused');
select throws_ok($$ select public.admin_report('orders', '{"from": "2032-03-01", "to": "2032-03-03", "status": "lost"}') $$,
  'NZ412', null, 'an unknown status is refused');
select throws_ok($$ select public.admin_report('products', '{"from": "2032-03-01", "to": "2032-03-03", "categoryId": "x"}') $$,
  'NZ412', null, 'a malformed id is refused');
select throws_ok($$ select public.admin_report('orders', '{"from": "2032-03-01", "to": "2032-03-03", "q": 5}') $$,
  'NZ412', null, 'filters are text');
select throws_ok($$ select public.admin_report('orders', '{"from": "2032-03-01", "to": "2032-03-03"}', 0, 0) $$,
  'NZ412', null, 'a page holds at least one row');
select throws_ok($$ select public.admin_report('orders', '{"from": "2032-03-01", "to": "2032-03-03"}', 5002, 0) $$,
  'NZ412', null, 'and at most 5,001');

-- ---------------------------------------------------------------------------
-- Figures and personal data
-- ---------------------------------------------------------------------------

insert into t values ('sales', public.admin_report('sales', '{"from": "2032-03-01", "to": "2032-03-03"}')::text);
select is((select value::jsonb -> 'rows' from t where key = 'sales'),
  '[{"day": "2032-03-01", "orders": 1, "cancelled": 0, "revenue": 26000, "averageOrder": 26000, "collected": 26000},
    {"day": "2032-03-02", "orders": 1, "cancelled": 0, "revenue": 16000, "averageOrder": 16000, "collected": 0},
    {"day": "2032-03-03", "orders": 0, "cancelled": 1, "revenue": 0, "averageOrder": 0, "collected": 0}]'::jsonb,
  'sales has one row per Dhaka day, cancelled orders apart');
select is((select value::jsonb -> 'summary' from t where key = 'sales'),
  '{"revenue": 42000, "orders": 2, "averageOrder": 21000, "collected": 26000, "cancelled": 1}'::jsonb,
  'with a summary of the range');
select is((select jsonb_array_length(value::jsonb -> 'chart') from t where key = 'sales'), 3, 'and a point per day');
select is((select (public.admin_report('sales', '{"from": "2032-03-01", "to": "2032-03-03"}', 1, 1, false)) -> 'rows' -> 0 ->> 'day'),
  '2032-03-02', 'rows page with limit and offset');
select is((public.admin_report('sales', '{"from": "2032-03-01", "to": "2032-03-03"}', 1, 0, false)) -> 'summary',
  'null'::jsonb, 'the summary is left out when not asked for');

insert into t values ('orders', public.admin_report('orders', '{"from": "2032-03-01", "to": "2032-03-03"}')::text);
select is((select (value::jsonb ->> 'total')::int from t where key = 'orders'), 3, 'the orders report counts every order of the range');
select is((select array_agg(k order by k) from t, jsonb_object_keys(t.value::jsonb -> 'rows' -> 0) k where t.key = 'orders'),
  array['customer', 'delivery', 'discount', 'district', 'items', 'orderNumber', 'paymentStatus', 'placedAt', 'status',
        'subtotal', 'total', 'zone'],
  'order rows carry the district and zone but no phone or street address');
select is((select value::jsonb -> 'rows' -> 0 ->> 'orderNumber' from t where key = 'orders'), 'NZ2032000003', 'newest first');
select is((select value::jsonb -> 'summary' from t where key = 'orders'),
  '{"orders": 3, "revenue": 42000, "cancelled": 1, "averageOrder": 21000}'::jsonb, 'with its summary');
select is((public.admin_report('orders', '{"from": "2032-03-01", "to": "2032-03-03", "status": "pending"}') ->> 'total')::int, 1,
  'orders filter by status');
select is((public.admin_report('orders', '{"from": "2032-03-01", "to": "2032-03-03", "paymentStatus": "collected"}') ->> 'total')::int, 1,
  'and by payment status');
select is((public.admin_report('orders', '{"from": "2032-03-01", "to": "2032-03-03", "q": "100%"}') -> 'rows' -> 0 ->> 'orderNumber'),
  'NZ2032000001', 'the search is literal (a percent sign matches itself)');
select is((public.admin_report('orders', '{"from": "2032-03-01", "to": "2032-03-03", "q": "%"}') ->> 'total')::int, 1,
  'and never a wildcard');

insert into t values ('customers', public.admin_report('customers', '{"from": "2032-03-01", "to": "2032-03-03"}')::text);
select is((select (value::jsonb ->> 'total')::int from t where key = 'customers'), 2, 'customers who joined in the range');
select is((select array_agg(k order by k) from t, jsonb_object_keys(t.value::jsonb -> 'rows' -> 0) k where t.key = 'customers'),
  array['email', 'joinedAt', 'name', 'orders', 'spent', 'status'], 'customer rows hold no phone or address');
select is((select r from t, jsonb_array_elements(t.value::jsonb -> 'rows') r where t.key = 'customers' and r ->> 'name' = 'RX Buyer'),
  '{"name": "RX Buyer", "email": "rx-buyer1@example.com", "joinedAt": "2032-03-01", "orders": 1, "spent": 26000, "status": "active"}'::jsonb,
  'with orders and spending that leave out cancelled orders');

insert into t values ('products', public.admin_report('products', '{"from": "2032-03-01", "to": "2032-03-03", "q": "RX-LAMP"}')::text);
select is((select value::jsonb -> 'rows' -> 0 from t where key = 'products'),
  '{"name": "RX Lamp", "sku": "RX-LAMP", "category": "RX Category", "brand": null, "status": "active", "price": 10000,
    "stock": 8, "unitsSold": 2, "revenue": 20000}'::jsonb, 'products show the range''s sales');
select is((public.admin_report('products', '{"from": "2032-03-01", "to": "2032-03-03", "categoryId": "ca000000-0000-4000-8000-0000000000d1"}') ->> 'total')::int,
  1, 'and filter by category');

insert into t values ('inventory', public.admin_report('inventory', '{"from": "2032-03-01", "to": "2032-03-03", "q": "RX-LAMP"}')::text);
select is((select jsonb_agg(r ->> 'actor' order by r ->> 'at') from t, jsonb_array_elements(t.value::jsonb -> 'rows') r where t.key = 'inventory'),
  '["Customer", "RX Staff"]'::jsonb, 'stock movements name staff but never the customer');
select is((select value::jsonb -> 'summary' from t where key = 'inventory'),
  '{"movements": 2, "unitsIn": 3, "unitsOut": 2}'::jsonb, 'with units in and out');

insert into t values ('cod', public.admin_report('cod_collections', '{"from": "2032-03-01", "to": "2032-03-03"}')::text);
select is((select value::jsonb -> 'rows' from t where key = 'cod'),
  '[{"orderNumber": "NZ2032000001", "collectedAt": "2032-03-02T06:00:00+00:00", "collectedBy": "RX Staff",
     "customer": "Rahim 100% Ltd", "district": "Gazipur", "total": 26000}]'::jsonb,
  'collections list who recorded the cash');

insert into t values ('audit', public.admin_report('audit_logs', '{"from": "2032-03-01", "to": "2032-03-03", "q": "rx."}')::text);
select is((select value::jsonb -> 'rows' from t where key = 'audit'),
  '[{"at": "2032-03-02T05:00:00+00:00", "action": "rx.secret_rotated", "actor": "RX Staff", "targetType": "setting", "targetId": "rx"}]'::jsonb,
  'the audit-log report never carries an entry''s details');
select is((public.admin_report('coupons', '{"from": "2032-03-01", "to": "2032-03-03", "status": "active", "q": "RX-NONE"}') ->> 'total')::int,
  0, 'coupons filter by state and code');
select is((public.admin_report('moderation', '{"from": "2032-03-01", "to": "2032-03-03"}') ->> 'total')::int,
  0, 'the moderation report runs for assigners');

-- ---------------------------------------------------------------------------
-- Order documents and direct downloads
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d2", "role": "authenticated"}';
insert into t values ('invoice', public.admin_order_document('NZ2032000001', 'invoice')::text);
select is((select value::jsonb -> 'delivery' ->> 'phone' from t where key = 'invoice'), '+8801712345678',
  'an invoice carries the delivery phone the parcel needs');
select is((select value::jsonb -> 'items' from t where key = 'invoice'),
  '[{"name": "RX Lamp", "variantLabel": null, "sku": "RX-LAMP", "quantity": 2, "unitPriceMinor": 10000, "lineTotalMinor": 20000}]'::jsonb,
  'and every item with its price');
select is((select value::jsonb -> 'order' ->> 'totalMinor' from t where key = 'invoice'), '26000', 'and the total');
select lives_ok($$ select public.admin_order_document('NZ2032000001', 'packing_slip') $$, 'staff print a packing slip');
select throws_ok($$ select public.admin_order_document('NZ2032999999', 'invoice') $$, 'NZ404', null, 'an unknown order is not found');
select throws_ok($$ select public.admin_order_document('NZ2032000001', 'receipt') $$, 'NZ412', null, 'an unknown document is refused');
select lives_ok($$ select public.admin_audit_export('orders', 'csv', 3, '{"from": "2032-03-01", "to": "2032-03-03", "secret": "x"}') $$,
  'a direct download is audited');
select throws_ok($$ select public.admin_audit_export('sales', 'csv', 3, '{}') $$, 'NZ403', null,
  'only by someone who may read the report');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d3", "role": "authenticated"}';
select throws_ok($$ select public.admin_order_document('NZ2032000001', 'invoice') $$, 'NZ403', null,
  'moderators cannot print order documents');

reset role;
select results_eq($$ select action, details from public.audit_log
    where actor_id = '00000000-0000-4000-8000-0000000000d2' and action like 'order.%_downloaded' order by id $$,
  $$ values ('order.invoice_downloaded', '{"orderNumber": "NZ2032000001"}'::jsonb),
            ('order.packing_slip_downloaded', '{"orderNumber": "NZ2032000001"}'::jsonb) $$,
  'each document download is audited with the order number only');
select is((select details from public.audit_log
    where actor_id = '00000000-0000-4000-8000-0000000000d2' and action = 'export.downloaded' order by id desc limit 1),
  '{"kind": "orders", "format": "csv", "rowCount": 3, "filters": {"from": "2032-03-01", "to": "2032-03-03"}}'::jsonb,
  'an export download records its kind, format, rows and known filters only');

-- ---------------------------------------------------------------------------
-- Export jobs
-- ---------------------------------------------------------------------------

select ok((select relrowsecurity from pg_class where oid = 'public.export_jobs'::regclass), 'export jobs have row level security');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d2", "role": "authenticated"}';
select throws_ok($$ select id from public.export_jobs $$, '42501', null, 'the table is not readable directly');
select throws_ok($$ select * from public.export_claim_job() $$, '42501', null, 'signed-in accounts cannot run the worker');
select throws_ok($$ select public.admin_create_export_job('sales', 'csv', '{"from": "2032-03-01", "to": "2032-03-03"}') $$,
  'NZ403', null, 'a job needs the report''s permission');
select throws_ok($$ select public.admin_create_export_job('orders', 'docx', '{"from": "2032-03-01", "to": "2032-03-03"}') $$,
  'NZ412', null, 'and a known format');
select throws_ok($$ select public.admin_create_export_job('orders', 'csv', '{"from": "2032-03-01", "to": "2033-03-03"}') $$,
  'NZ412', null, 'and valid filters');
insert into t values ('job', public.admin_create_export_job('orders', 'xlsx', '{"from": "2032-03-01", "to": "2032-03-03", "status": "pending"}')::text);
select is((select value::jsonb - 'id' - 'createdAt' - 'expiresAt' from t where key = 'job'),
  '{"kind": "orders", "format": "xlsx", "filters": {"from": "2032-03-01", "to": "2032-03-03", "status": "pending"},
    "status": "queued", "progress": 0, "rowCount": null, "fileName": null, "contentType": null, "fileBytes": null,
    "error": null, "startedAt": null, "finishedAt": null}'::jsonb, 'staff queue an export');
select is((select jsonb_array_length(public.admin_list_export_jobs())), 1, 'and see it in their list');
select throws_ok($$ select * from public.admin_download_export_job((select (value::jsonb ->> 'id')::uuid from t where key = 'job')) $$,
  'NZ443', null, 'a queued job has no file yet');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d1", "role": "authenticated"}';
select is((select jsonb_array_length(public.admin_list_export_jobs())), 0, 'another account does not see it');
select throws_ok($$ select public.admin_get_export_job((select (value::jsonb ->> 'id')::uuid from t where key = 'job')) $$,
  'NZ404', null, 'cannot read it');
select throws_ok($$ select * from public.admin_download_export_job((select (value::jsonb ->> 'id')::uuid from t where key = 'job')) $$,
  'NZ404', null, 'and cannot download it');

-- The worker claims, reports progress and finishes.
set local role service_role;
select is((select id::text from public.export_claim_job()), (select value::jsonb ->> 'id' from t where key = 'job'),
  'the worker claims the queued job');
select lives_ok($$ select public.export_job_progress((select (value::jsonb ->> 'id')::uuid from t where key = 'job'), 40) $$,
  'and reports progress');
select lives_ok($$ select public.export_finish_job((select (value::jsonb ->> 'id')::uuid from t where key = 'job'),
    '\x504b0304'::bytea, 'nilzora-orders-2032-03-01-to-2032-03-03.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1) $$, 'then stores the file');
select is((select count(*)::int from public.export_claim_job()), 0, 'nothing else is queued');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d2", "role": "authenticated"}';
select is((select public.admin_get_export_job((select (value::jsonb ->> 'id')::uuid from t where key = 'job')) ->> 'status'),
  'done', 'the creator sees it done');
select is((select (public.admin_get_export_job((select (value::jsonb ->> 'id')::uuid from t where key = 'job')) ->> 'fileBytes')::int),
  4, 'with the file size but never the bytes');
select is((select file from public.admin_download_export_job((select (value::jsonb ->> 'id')::uuid from t where key = 'job'))),
  '\x504b0304'::bytea, 'and downloads the file');

-- A permission revoked after the job was made stops the download.
reset role;
insert into public.user_permissions (user_id, permission, effect)
  values ('00000000-0000-4000-8000-0000000000d2', 'orders.read', 'deny');
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d2", "role": "authenticated"}';
select throws_ok($$ select * from public.admin_download_export_job((select (value::jsonb ->> 'id')::uuid from t where key = 'job')) $$,
  'NZ403', null, 'a download rechecks the report permission');
reset role;
delete from public.user_permissions where user_id = '00000000-0000-4000-8000-0000000000d2';

-- After seven days the file is gone.
update public.export_jobs set expires_at = now() - interval '1 minute'
  where id = (select (value::jsonb ->> 'id')::uuid from t where key = 'job');
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d2", "role": "authenticated"}';
select throws_ok($$ select * from public.admin_download_export_job((select (value::jsonb ->> 'id')::uuid from t where key = 'job')) $$,
  'NZ444', null, 'an expired export cannot be downloaded');
set local role service_role;
select is(public.export_expire_jobs() >= 1, true, 'the worker expires old jobs');
reset role;
select is((select status || ':' || (file is null)::text from public.export_jobs
  where id = (select (value::jsonb ->> 'id')::uuid from t where key = 'job')), 'expired:true', 'and drops their files');
select results_eq($$ select action from public.audit_log
    where target_type = 'export_job' and target_id = (select value::jsonb ->> 'id' from t where key = 'job') order by id $$,
  $$ values ('export.created'), ('export.downloaded') $$, 'job creation and download are audited');

-- A failed job keeps a safe message.
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d2", "role": "authenticated"}';
insert into t values ('job2', public.admin_create_export_job('orders', 'csv', '{"from": "2032-03-01", "to": "2032-03-03"}')::text);
set local role service_role;
select lives_ok($$ select public.export_fail_job((select (value::jsonb ->> 'id')::uuid from t where key = 'job2'),
    'The account that created this export can no longer run this report.') $$, 'the worker records a failure');
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d2", "role": "authenticated"}';
select is((select public.admin_get_export_job((select (value::jsonb ->> 'id')::uuid from t where key = 'job2')) ->> 'status'),
  'failed', 'which the creator sees');
select lives_ok($$ select public.admin_create_export_job('orders', 'csv', '{"from": "2032-03-01", "to": "2032-03-03"}'),
    public.admin_create_export_job('orders', 'csv', '{"from": "2032-03-01", "to": "2032-03-03"}'),
    public.admin_create_export_job('orders', 'csv', '{"from": "2032-03-01", "to": "2032-03-03"}'),
    public.admin_create_export_job('orders', 'csv', '{"from": "2032-03-01", "to": "2032-03-03"}'),
    public.admin_create_export_job('orders', 'csv', '{"from": "2032-03-01", "to": "2032-03-03"}') $$,
  'five exports may wait at a time');
select throws_ok($$ select public.admin_create_export_job('orders', 'csv', '{"from": "2032-03-01", "to": "2032-03-03"}') $$,
  'NZ412', null, 'but not a sixth');

select * from finish();
rollback;
