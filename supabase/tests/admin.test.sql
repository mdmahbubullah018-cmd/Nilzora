-- Database-level checks for permissions, overrides, the audit log, product
-- moderation and the privileged store operations. Every privileged function must
-- check the CALLER (auth.uid()), and staff reads must follow permissions.
-- Runs inside a transaction that is rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(109);

-- ---------------------------------------------------------------------------
-- Fixtures (as the database owner)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000a0', 'owner-t@example.com', now()),
  ('00000000-0000-4000-8000-0000000000a1', 'admin-t@example.com', now()),
  ('00000000-0000-4000-8000-0000000000a2', 'staff-t@example.com', now()),
  ('00000000-0000-4000-8000-0000000000a3', 'mod-t@example.com', now()),
  ('00000000-0000-4000-8000-0000000000a4', 'mod2-t@example.com', now()),
  ('00000000-0000-4000-8000-0000000000a5', 'buyer-t@example.com', now()),
  ('00000000-0000-4000-8000-0000000000a6', 'held-staff-t@example.com', now()),
  ('00000000-0000-4000-8000-0000000000a7', 'staff2-t@example.com', now()),
  ('00000000-0000-4000-8000-0000000000a8', 'invited-t@example.com', null);

update public.user_roles set role = 'super_admin' where user_id = '00000000-0000-4000-8000-0000000000a0';
update public.user_roles set role = 'admin' where user_id = '00000000-0000-4000-8000-0000000000a1';
update public.user_roles set role = 'staff' where user_id in ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a6',
  '00000000-0000-4000-8000-0000000000a7', '00000000-0000-4000-8000-0000000000a8');
update public.user_roles set role = 'moderator' where user_id in ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a4');
update public.profiles set status = 'suspended' where id = '00000000-0000-4000-8000-0000000000a6';

insert into public.delivery_charges (zone, amount_minor) values ('inside_dhaka', 6000), ('outside_dhaka', 12000)
  on conflict (zone) do update set amount_minor = excluded.amount_minor;
insert into public.categories (id, slug, name) values ('ca000000-0000-4000-8000-0000000000c1', 'adm-test', 'Admin test');
insert into public.products (id, category_id, slug, sku, name, price_minor, stock_quantity, status) values
  ('0d000000-0000-4000-8000-0000000000d1', 'ca000000-0000-4000-8000-0000000000c1', 'adm-live', 'ADM-LIVE', 'Live product', 10000, 10, 'active');
insert into public.addresses (id, user_id, recipient_name, phone, division, district, area, address_line) values
  ('ad000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a5', 'Buyer', '+8801712345678', 'Dhaka', 'Dhaka', 'Mirpur', 'House 1, Road 1');

create temporary table t (key text primary key, value text) on commit drop;
grant select, insert, update on t to authenticated;

select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'public.permissions'::regclass, 'public.role_permissions'::regclass, 'public.user_permissions'::regclass,
  'public.audit_log'::regclass, 'public.moderation_tasks'::regclass, 'public.moderation_events'::regclass
)), 'RLS is enabled on every new table');
select is((select count(*)::int from public.role_permissions where role = 'customer'), 0, 'customers hold no default permissions');
select ok((select moderation_status = 'approved' from public.products where id = '0d000000-0000-4000-8000-0000000000d1'),
  'a product inserted on sale counts as approved');
select throws_ok($$ update public.products set moderation_status = 'pending' where id = '0d000000-0000-4000-8000-0000000000d1' $$,
  '23514', null, 'a product on sale must keep approved content');

-- ---------------------------------------------------------------------------
-- Effective permissions
-- ---------------------------------------------------------------------------

set local role authenticated;

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a5", "role": "authenticated"}';
select is((public.my_access())->'permissions', '[]'::jsonb, 'a customer holds no permissions');
select is(public.has_permission('orders.read'), false, 'a customer cannot read orders');
select is_empty($$ select id from public.products where status <> 'active' $$, 'customers see no drafts');
select throws_ok($$ select id from public.audit_log $$, '42501', null, 'customers cannot read the audit log table');
select throws_ok($$ select public.admin_create_product('ca000000-0000-4000-8000-0000000000c1', 'x-prod', 'X-PROD', 'X', null, null, 100, null, 5, false, 0) $$,
  'NZ403', null, 'customers cannot create products');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}';
-- 12 since 20261231090000_abandoned_checkout_recovery granted staff checkouts.recover.
select is(jsonb_array_length((public.my_access())->'permissions'), 12, 'staff hold their role defaults');
select is(public.has_permission('products.publish'), false, 'staff cannot publish by default');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a6", "role": "authenticated"}';
select is((public.my_access())->'permissions', '[]'::jsonb, 'a suspended staff account holds nothing');

-- ---------------------------------------------------------------------------
-- Overrides: grants, deny precedence, and who may change them
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';
select lives_ok($$ select public.admin_set_permission('00000000-0000-4000-8000-0000000000a2', 'orders.cancel', 'grant') $$,
  'an admin grants a staff member a permission the admin holds');
select lives_ok($$ select public.admin_set_permission('00000000-0000-4000-8000-0000000000a2', 'customers.read', 'deny') $$,
  'and denies one of the staff role defaults');
select throws_ok($$ select public.admin_set_permission('00000000-0000-4000-8000-0000000000a2', 'settings.manage', 'grant') $$,
  'NZ403', null, 'an admin cannot grant a permission it does not hold');
select throws_ok($$ select public.admin_set_permission('00000000-0000-4000-8000-0000000000a0', 'audit_logs.read', 'deny') $$,
  'NZ439', null, 'an admin cannot change an owner''s permissions');
select throws_ok($$ select public.admin_set_permission('00000000-0000-4000-8000-0000000000a1', 'orders.cancel', 'deny') $$,
  'NZ438', null, 'nobody changes their own permissions');
select throws_ok($$ select public.admin_set_permission('00000000-0000-4000-8000-0000000000a5', 'orders.read', 'grant') $$,
  'NZ439', null, 'customers cannot be granted permissions');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}';
select is(public.has_permission('orders.cancel'), true, 'a grant adds a permission');
select is(public.has_permission('customers.read'), false, 'a deny removes a role default');
select throws_ok($$ select public.admin_set_permission('00000000-0000-4000-8000-0000000000a3', 'orders.read', 'grant') $$,
  'NZ403', null, 'staff cannot manage permissions');

-- ---------------------------------------------------------------------------
-- Products and moderation
-- ---------------------------------------------------------------------------

insert into t select 'draft', public.admin_create_product('ca000000-0000-4000-8000-0000000000c1', 'adm-draft', 'ADM-DRAFT',
  'Draft lamp', 'Short', 'Long text', 25000, null, 5, false, 4)::text;
select results_eq($$ select status::text, moderation_status::text, stock_quantity from public.products where slug = 'adm-draft' $$,
  $$ values ('draft', 'not_submitted', 4) $$, 'staff create products as drafts awaiting review');
select is((select count(*)::int from public.inventory_movements where product_id = (select value::uuid from t where key = 'draft')), 1,
  'the initial stock is in the ledger');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a3", "role": "authenticated"}';
select throws_ok($$ select public.admin_create_product('ca000000-0000-4000-8000-0000000000c1', 'm-prod', 'M-PROD', 'M', null, null, 100, null, 5, false, 0) $$,
  'NZ403', null, 'moderators cannot create products');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}';
insert into t select 'task', public.submit_product_for_review((select value::uuid from t where key = 'draft'))::text;
select is((select moderation_status::text from public.products where slug = 'adm-draft'), 'pending', 'submitting opens a review');
select throws_ok($$ select public.admin_update_product((select value::uuid from t where key = 'draft'), 'ca000000-0000-4000-8000-0000000000c1',
    'adm-draft', 'Renamed under review', 'Short', 'Long text', 25000, null, 5, false) $$,
  'NZ431', null, 'content cannot change while under review');
select throws_ok($$ select public.admin_set_product_status((select value::uuid from t where key = 'draft'), 'active') $$,
  'NZ403', null, 'staff cannot publish');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';
select throws_ok($$ select public.admin_set_product_status((select value::uuid from t where key = 'draft'), 'active') $$,
  'NZ432', null, 'content under review cannot be published');
select throws_ok($$ select public.assign_moderation_task((select value::uuid from t where key = 'task'), '00000000-0000-4000-8000-0000000000a5') $$,
  'NZ436', null, 'a review cannot go to an account that cannot approve content');
select lives_ok($$ select public.assign_moderation_task((select value::uuid from t where key = 'task'), '00000000-0000-4000-8000-0000000000a3') $$,
  'an admin assigns the review to a moderator');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a4", "role": "authenticated"}';
select is_empty($$ select id from public.moderation_tasks $$, 'another moderator does not see the review');
select throws_ok($$ select public.decide_moderation_task((select value::uuid from t where key = 'task'), 'approved') $$,
  'NZ404', null, 'and cannot decide it');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a3", "role": "authenticated"}';
select is((select count(*)::int from public.moderation_tasks), 1, 'the assigned moderator sees the review');
select throws_ok($$ select public.decide_moderation_task((select value::uuid from t where key = 'task'), 'rejected', 'short') $$,
  'NZ412', null, 'a rejection needs a real reason');
select throws_ok($$ select public.assign_moderation_task((select value::uuid from t where key = 'task'), '00000000-0000-4000-8000-0000000000a3') $$,
  'NZ403', null, 'moderators cannot assign reviews');
select is(public.decide_moderation_task((select value::uuid from t where key = 'task'), 'approved')::text, 'approved',
  'the assigned moderator approves');
select throws_ok($$ select public.decide_moderation_task((select value::uuid from t where key = 'task'), 'rejected', 'Changed my mind about this') $$,
  'NZ436', null, 'a decided review is closed');
select throws_ok($$ select public.admin_adjust_stock((select value::uuid from t where key = 'draft'), 5, 'Counted') $$,
  'NZ403', null, 'moderators cannot change stock');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';
select is(public.admin_set_product_status((select value::uuid from t where key = 'draft'), 'active')::text, 'active',
  'approved content can be published');
select throws_ok($$ select public.admin_update_product((select value::uuid from t where key = 'draft'), 'ca000000-0000-4000-8000-0000000000c1',
    'adm-draft', 'Renamed while live', 'Short', 'Long text', 25000, null, 5, false) $$,
  'NZ430', null, 'live content cannot change');
select lives_ok($$ select public.admin_update_product((select value::uuid from t where key = 'draft'), 'ca000000-0000-4000-8000-0000000000c1',
    'adm-draft', 'Draft lamp', 'Short', 'Long text', 23000, 25000, 5, true) $$,
  'price and featuring can change while live');
select is((select moderation_status::text from public.products where slug = 'adm-draft'), 'approved',
  'operational changes keep the approval');

-- An admin's own submission is never reviewed by that admin.
insert into t select 'own', public.admin_create_product('ca000000-0000-4000-8000-0000000000c1', 'adm-own', 'ADM-OWN',
  'Own product', null, null, 1000, null, 5, false, 0)::text;
insert into t select 'own-task', public.submit_product_for_review((select value::uuid from t where key = 'own'))::text;
select throws_ok($$ select public.assign_moderation_task((select value::uuid from t where key = 'own-task'), '00000000-0000-4000-8000-0000000000a1') $$,
  'NZ437', null, 'nobody is assigned their own submission');

-- ---------------------------------------------------------------------------
-- Products on sale, separation of duties and withdrawals
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}';
select throws_ok($$ select public.admin_update_product((select value::uuid from t where key = 'draft'), 'ca000000-0000-4000-8000-0000000000c1',
    'adm-draft', 'Draft lamp', 'Short', 'Long text', 21000, 25000, 5, true) $$,
  'NZ403', null, 'staff cannot reprice a product on sale');
select throws_ok($$ select public.admin_update_product('0d000000-0000-4000-8000-0000000000d1', 'ca000000-0000-4000-8000-0000000000c1',
    'adm-live', 'Live product', null, null, 10000, null, 10, true) $$,
  'NZ403', null, 'staff cannot feature a product on sale');
insert into t select 'sod', public.admin_create_product('ca000000-0000-4000-8000-0000000000c1', 'adm-sod', 'ADM-SOD',
  'Shared lamp', null, null, 1000, null, 5, false, 0)::text;
select lives_ok($$ select public.admin_update_product((select value::uuid from t where key = 'sod'), 'ca000000-0000-4000-8000-0000000000c1',
    'adm-sod', 'Shared lamp', null, null, 1200, null, 5, false) $$,
  'staff still price drafts');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';
select lives_ok($$ select public.admin_update_product((select value::uuid from t where key = 'sod'), 'ca000000-0000-4000-8000-0000000000c1',
    'adm-sod', 'Shared lamp, revised', null, null, 1200, null, 5, false) $$,
  'an admin rewrites the draft');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}';
insert into t select 'sod-task', public.submit_product_for_review((select value::uuid from t where key = 'sod'))::text;
insert into t select 'self', public.admin_create_product('ca000000-0000-4000-8000-0000000000c1', 'adm-self', 'ADM-SELF',
  'Desk fan', null, null, 3000, null, 5, false, 0)::text;
insert into t select 'self-task', public.submit_product_for_review((select value::uuid from t where key = 'self'))::text;

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a7", "role": "authenticated"}';
select throws_ok($$ select public.withdraw_moderation_task((select value::uuid from t where key = 'sod-task')) $$,
  'NZ403', null, 'another editor cannot withdraw someone else''s submission');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a0", "role": "authenticated"}';
select throws_ok($$ select public.assign_moderation_task((select value::uuid from t where key = 'sod-task'), '00000000-0000-4000-8000-0000000000a1') $$,
  'NZ437', null, 'whoever last wrote the content is not assigned its review');
select lives_ok($$ select public.assign_moderation_task((select value::uuid from t where key = 'sod-task'), '00000000-0000-4000-8000-0000000000a0') $$,
  'an owner may take a review themselves');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';
select throws_ok($$ select public.assign_moderation_task((select value::uuid from t where key = 'self-task'), '00000000-0000-4000-8000-0000000000a1') $$,
  'NZ437', null, 'an admin does not assign a review to themselves');
select lives_ok($$ select public.withdraw_moderation_task((select value::uuid from t where key = 'self-task')) $$,
  'an assigner withdraws any open review');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}';
select lives_ok($$ select public.withdraw_moderation_task((select value::uuid from t where key = 'sod-task')) $$,
  'the submitter withdraws their own submission');

-- ---------------------------------------------------------------------------
-- Who reads what
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a4", "role": "authenticated"}';
select is_empty($$ select id from public.moderation_events where task_id = (select value::uuid from t where key = 'task') $$,
  'review history stays with the assigned moderator');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a3", "role": "authenticated"}';
select is_empty($$ select user_id from public.user_permissions $$, 'other accounts'' overrides are hidden');
select is_empty($$ select id from public.inventory_movements $$, 'moderators do not read the stock ledger');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}';
select ok((select count(*) from public.inventory_movements) > 0, 'stock editors read the stock ledger');
select throws_ok($$ select * from public.admin_list_staff() $$, 'NZ403', null, 'staff cannot list the staff');
select throws_ok($$ select public.admin_save_category(null, 'staff-cat', 'Staff category', null, 0, true) $$,
  'NZ403', null, 'staff cannot change categories');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a5", "role": "authenticated"}';
select throws_ok($$ select * from public.admin_account_names(array['00000000-0000-4000-8000-0000000000a1'::uuid]) $$,
  'NZ403', null, 'customers cannot look up account names');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';
select is_empty($$ select id from public.profiles where id = '00000000-0000-4000-8000-0000000000a2' $$,
  'customer staff do not read staff profiles');
select is((select count(*)::int from public.profiles where id = '00000000-0000-4000-8000-0000000000a5'), 1,
  'customer staff read customer profiles');

set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select throws_ok($$ select created_by from public.products $$, '42501', null, 'the public cannot see who created products');
select lives_ok($$ select id, name, price_minor from public.products $$, 'the public still reads the catalogue');
set local role authenticated;

-- ---------------------------------------------------------------------------
-- Stock
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}';
select is(public.admin_adjust_stock('0d000000-0000-4000-8000-0000000000d1', 5, 'Delivery received'), 15,
  'staff adjust stock with a reason');
select throws_ok($$ select public.admin_adjust_stock('0d000000-0000-4000-8000-0000000000d1', -1000, 'Shrinkage') $$,
  'NZ433', null, 'stock cannot go below zero');
select throws_ok($$ select public.admin_adjust_stock('0d000000-0000-4000-8000-0000000000d1', 1, '') $$,
  'NZ412', null, 'an adjustment needs a reason');
select is((select reason::text || ' ' || change || ' ' || note from public.inventory_movements
  where product_id = '0d000000-0000-4000-8000-0000000000d1' order by id desc limit 1),
  'adjustment 5 Delivery received', 'the adjustment is in the ledger');

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a5", "role": "authenticated"}';
insert into t select 'order', (public.place_cod_order(gen_random_uuid(), 'ad000000-0000-4000-8000-0000000000e1',
  '[{"productId": "0d000000-0000-4000-8000-0000000000d1", "quantity": 2}]'))->>'orderNumber';
insert into t select 'order2', (public.place_cod_order(gen_random_uuid(), 'ad000000-0000-4000-8000-0000000000e1',
  '[{"productId": "0d000000-0000-4000-8000-0000000000d1", "quantity": 1}]'))->>'orderNumber';

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a3", "role": "authenticated"}';
select is_empty($$ select id from public.orders $$, 'moderators cannot read orders');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}';
select is((select count(*)::int from public.orders where order_number in (select value from t where key like 'order%')), 2,
  'order staff read every order');
select throws_ok($$ select public.admin_record_cod_collection((select value from t where key = 'order')) $$,
  'NZ435', null, 'cash cannot be recorded before delivery');
select is(public.admin_update_order_status((select value from t where key = 'order'), 'confirmed')::text, 'confirmed',
  'staff confirm an order');
select throws_ok($$ select public.admin_update_order_status((select value from t where key = 'order'), 'delivered') $$,
  'NZ434', null, 'steps cannot be skipped');
select lives_ok($$ select public.admin_update_order_status((select value from t where key = 'order'), s)
  from unnest(array['processing', 'shipped', 'delivered']::public.order_status[]) as s $$,
  'and move it through fulfilment');
select is((select payment_status::text from public.orders where order_number = (select value from t where key = 'order')), 'pending',
  'a delivered COD order still awaits payment');
select is(public.admin_record_cod_collection((select value from t where key = 'order'))::text, 'collected',
  'staff record the cash collection');
select throws_ok($$ select public.admin_record_cod_collection((select value from t where key = 'order')) $$,
  'NZ435', null, 'cash is recorded once');
select throws_ok($$ select public.admin_update_order_status((select value from t where key = 'order'), 'cancelled', 'Customer refused') $$,
  'NZ434', null, 'a delivered order cannot be cancelled');

-- The staff member was granted orders.cancel above.
select throws_ok($$ select public.admin_update_order_status((select value from t where key = 'order2'), 'cancelled') $$,
  'NZ412', null, 'a cancellation needs a reason');
select is(public.admin_update_order_status((select value from t where key = 'order2'), 'cancelled', 'Customer asked by phone')::text,
  'cancelled', 'staff with the permission cancel an order');

reset role;
select is((select stock_quantity from public.products where id = '0d000000-0000-4000-8000-0000000000d1'), 13,
  'cancelling returned the stock (15 - 2 - 1 + 1)');
select results_eq($$ select actor_kind::text, to_status::text from public.order_status_history
  where order_id = (select id from public.orders where order_number = (select value from t where key = 'order2')) order by id $$,
  $$ values ('customer', 'pending'), ('staff', 'cancelled') $$, 'staff steps are in the order history');

-- ---------------------------------------------------------------------------
-- Customers, settings, analytics and the audit log
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}';
select throws_ok($$ select * from public.admin_list_customers() $$, 'NZ403', null,
  'a denied customers.read applies to the customer list too');
select throws_ok($$ select public.admin_sales_overview(30) $$, 'NZ403', null, 'staff cannot see sales figures');
select throws_ok($$ select * from public.admin_audit_log() $$, 'NZ403', null, 'staff cannot read the audit log');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';
select ok((select count(*) from public.admin_list_customers('buyer-t@')) = 1, 'an admin finds a customer by email');
select throws_ok($$ select public.admin_set_account_status('00000000-0000-4000-8000-0000000000a5', 'suspended', '') $$,
  'NZ412', null, 'suspending needs a reason');
select throws_ok($$ select public.admin_set_account_status('00000000-0000-4000-8000-0000000000a2', 'suspended', 'Not a customer') $$,
  'NZ404', null, 'staff accounts are not suspended through the customer tools');
select is(public.admin_set_account_status('00000000-0000-4000-8000-0000000000a5', 'suspended', 'Repeated refused deliveries')::text,
  'suspended', 'an admin suspends a customer');
select throws_ok($$ select public.admin_set_delivery_charge('inside_dhaka', 5000) $$, 'NZ403', null,
  'admins cannot change store settings');
select is(((public.admin_sales_overview(7))->>'orderCount')::int >= 1, true, 'admins see sales figures');
select ok((select count(*) from public.admin_audit_log('order.')) >= 6, 'order actions are in the audit log');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a0", "role": "authenticated"}';
select lives_ok($$ select public.admin_set_delivery_charge('inside_dhaka', 5000) $$, 'the owner changes a delivery charge');

reset role;
select is((select actor_id from public.audit_log where action = 'settings.delivery_charge_changed' order by id desc limit 1),
  '00000000-0000-4000-8000-0000000000a0'::uuid, 'the audit log records who acted');
select is((public.assign_user_role('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000a2', 'customer')).role::text,
  'customer', 'the owner demotes the staff member');
select is((select count(*)::int from public.user_permissions where user_id = '00000000-0000-4000-8000-0000000000a2'), 0,
  'a demoted account loses its overrides');

-- Reviewer list, one customer, literal audit prefixes
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';
select ok((select count(*) from public.admin_list_reviewers() where id in (
  '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a4')) = 2,
  'assigners list the accounts that can review content');
select is((select email from public.admin_get_customer('00000000-0000-4000-8000-0000000000a5')), 'buyer-t@example.com',
  'customer staff read one customer with the email');
select is_empty($$ select id from public.admin_get_customer('00000000-0000-4000-8000-0000000000a3') $$,
  'staff accounts are not customers');
select is_empty($$ select id from public.admin_audit_log('order_') $$, 'an underscore in the action filter is literal');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a3", "role": "authenticated"}';
select throws_ok($$ select * from public.admin_list_reviewers() $$, 'NZ403', null, 'moderators cannot list reviewers');
select throws_ok($$ select * from public.admin_get_customer('00000000-0000-4000-8000-0000000000a5') $$, 'NZ403', null,
  'moderators cannot read customers');

-- Resending an invitation that was never accepted
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';
select results_eq($$ select invitation_pending from public.admin_list_staff()
    where id in ('00000000-0000-4000-8000-0000000000a7', '00000000-0000-4000-8000-0000000000a8') order by id $$,
  $$ values (false), (true) $$, 'the staff list shows which invitations are pending');
select is(public.admin_prepare_invitation_resend('00000000-0000-4000-8000-0000000000a8'), 'invited-t@example.com',
  'an admin resends a pending staff invitation');
select throws_ok($$ select public.admin_prepare_invitation_resend('00000000-0000-4000-8000-0000000000a7') $$,
  'NZ412', null, 'an accepted invitation is not resent');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a7", "role": "authenticated"}';
select throws_ok($$ select public.admin_prepare_invitation_resend('00000000-0000-4000-8000-0000000000a8') $$,
  'NZ403', null, 'staff cannot resend invitations');

-- A denied role permission also stops role changes made by the server.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a0", "role": "authenticated"}';
select lives_ok($$ select public.admin_set_permission('00000000-0000-4000-8000-0000000000a1', 'staff.roles.assign', 'deny'),
    public.admin_set_permission('00000000-0000-4000-8000-0000000000a1', 'staff.invite', 'deny') $$,
  'the owner removes an admin''s role permissions');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';
select throws_ok($$ select public.admin_prepare_invitation_resend('00000000-0000-4000-8000-0000000000a8') $$,
  'NZ403', null, 'a denied staff.invite stops resending too');
reset role;
select throws_ok($$ select public.assign_user_role('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a7', 'moderator') $$,
  'NZ002', null, 'an admin without role permissions cannot assign roles');

select * from finish();
rollback;
