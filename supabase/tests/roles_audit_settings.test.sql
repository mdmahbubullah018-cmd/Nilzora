-- Database-level checks for the roles matrix, audit-log search, store settings and the
-- coupons.create rule. Every function checks the CALLER's permission (NZ403) and validates
-- its input (NZ412). Fixtures use a `rq-` namespace and dates in 2033, so rows a local
-- database already holds never fall inside the ranges asserted here.
-- Runs inside a transaction that is rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(70);

-- ---------------------------------------------------------------------------
-- Fixtures (as the database owner)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000f0', 'rq-owner@example.com', now()),
  ('00000000-0000-4000-8000-0000000000f1', 'rq-admin@example.com', now()),
  ('00000000-0000-4000-8000-0000000000f2', 'rq-staff@example.com', now()),
  ('00000000-0000-4000-8000-0000000000f3', 'rq-staff2@example.com', now()),
  ('00000000-0000-4000-8000-0000000000f4', 'rq-mod@example.com', now()),
  ('00000000-0000-4000-8000-0000000000f5', 'rq-buyer@example.com', now());

update public.user_roles set role = 'super_admin' where user_id = '00000000-0000-4000-8000-0000000000f0';
update public.user_roles set role = 'admin' where user_id = '00000000-0000-4000-8000-0000000000f1';
update public.user_roles set role = 'staff'
  where user_id in ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f3');
update public.user_roles set role = 'moderator' where user_id = '00000000-0000-4000-8000-0000000000f4';
update public.profiles set full_name = 'RQ Actor' where id = '00000000-0000-4000-8000-0000000000f2';

-- staff 1 may change coupons but not create them; staff 2 may create them but not change them.
insert into public.user_permissions (user_id, permission, effect) values
  ('00000000-0000-4000-8000-0000000000f2', 'coupons.update', 'grant'),
  ('00000000-0000-4000-8000-0000000000f3', 'coupons.create', 'grant');

insert into public.audit_log (actor_id, action, target_type, target_id, details, created_at) values
  ('00000000-0000-4000-8000-0000000000f2', 'rq.alpha_beta', 'thing', 'rq-target-100%', '{"k": 1}', '2033-03-01 18:30:00+00'),
  ('00000000-0000-4000-8000-0000000000f2', 'rq.alpha_gamma', 'thing', 'rq-target-200', '{}', '2033-03-02 05:00:00+00'),
  ('00000000-0000-4000-8000-0000000000f1', 'rq.delta', 'thing', 'rq-target-300', '{}', '2033-03-05 05:00:00+00'),
  (null, 'rq.system', 'thing', 'rq-target-400', '{}', '2033-03-09 05:00:00+00');
insert into public.coupons (id, code, kind, value) values
  ('c0000000-0000-4000-8000-0000000000f1', 'RQ-EXISTING', 'percent', 10);

create temporary table t (key text primary key, value text) on commit drop;
grant select, insert on t to authenticated;

-- ---------------------------------------------------------------------------
-- 1. The roles matrix
-- ---------------------------------------------------------------------------

set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select throws_ok($$ select public.admin_list_roles() $$, '42501', null, 'the public cannot read the roles matrix');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f5", "role": "authenticated"}';
select throws_ok($$ select public.admin_list_roles() $$, 'NZ403', null, 'customers cannot');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f3", "role": "authenticated"}';
select throws_ok($$ select public.admin_list_roles() $$, 'NZ403', null, 'staff without the role permissions cannot');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f4", "role": "authenticated"}';
select throws_ok($$ select public.admin_list_roles() $$, 'NZ403', null, 'moderators cannot');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}';
insert into t values ('roles', public.admin_list_roles()::text);
select is((select jsonb_array_length(value::jsonb) from t where key = 'roles'), 5, 'an admin reads all five roles');
select is((select jsonb_agg(r ->> 'role') from t, jsonb_array_elements(t.value::jsonb) r where t.key = 'roles'),
  '["super_admin", "admin", "staff", "moderator", "customer"]'::jsonb, 'in order, the owner first');
select is((select jsonb_array_length(r -> 'permissions') from t, jsonb_array_elements(t.value::jsonb) r
  where t.key = 'roles' and r ->> 'role' = 'super_admin'), (select count(*)::int from public.permissions),
  'the owner is reported with every permission in the catalogue');
select ok((select r -> 'permissions' ? 'settings.manage' from t, jsonb_array_elements(t.value::jsonb) r
  where t.key = 'roles' and r ->> 'role' = 'super_admin'), 'including those no stored default gives');
select ok((select not (r -> 'permissions' ? 'settings.manage') from t, jsonb_array_elements(t.value::jsonb) r
  where t.key = 'roles' and r ->> 'role' = 'admin'), 'while the admin role lacks settings.manage');
select is((select r -> 'permissions' from t, jsonb_array_elements(t.value::jsonb) r
  where t.key = 'roles' and r ->> 'role' = 'customer'), '[]'::jsonb, 'customers hold nothing');
select is((select r -> 'permissions' from t, jsonb_array_elements(t.value::jsonb) r
  where t.key = 'roles' and r ->> 'role' = 'staff'),
  (select jsonb_agg(permission order by permission) from public.role_permissions where role = 'staff'),
  'other roles show their stored defaults, sorted');

reset role;
insert into public.permissions (name, description) values ('rq.future_permission', 'A permission added later');
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}';
select ok((select r -> 'permissions' ? 'rq.future_permission' from jsonb_array_elements(public.admin_list_roles()) r
  where r ->> 'role' = 'super_admin'), 'a permission added later is the owner''s at once');

reset role;
insert into public.user_permissions (user_id, permission, effect)
  values ('00000000-0000-4000-8000-0000000000f3', 'staff.permissions.manage', 'grant');
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f3", "role": "authenticated"}';
select lives_ok($$ select public.admin_list_roles() $$, 'either role permission is enough');
reset role;
insert into public.user_permissions (user_id, permission, effect) values
  ('00000000-0000-4000-8000-0000000000f1', 'staff.roles.assign', 'deny'),
  ('00000000-0000-4000-8000-0000000000f1', 'staff.permissions.manage', 'deny');
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}';
select throws_ok($$ select public.admin_list_roles() $$, 'NZ403', null, 'and denying both closes it for an admin');
reset role;
delete from public.user_permissions where user_id = '00000000-0000-4000-8000-0000000000f1';

-- ---------------------------------------------------------------------------
-- 2. Audit-log search
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f2", "role": "authenticated"}';
select throws_ok($$ select * from public.admin_audit_log_search() $$, 'NZ403', null, 'staff cannot search the audit log');
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f5", "role": "authenticated"}';
select throws_ok($$ select * from public.admin_audit_log_search() $$, 'NZ403', null, 'customers cannot');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}';
select is((select count(*)::int from public.admin_audit_log('rq.')), 4, 'the original function still answers');
select is((select count(*)::int from public.admin_audit_log_search('rq.')), 4, 'and the search with no filter agrees');
select is((select details from public.admin_audit_log_search('rq.alpha_beta')), '{"k": 1}'::jsonb,
  'an entry keeps its details');
select is((select count(*)::int from public.admin_audit_log_search('rq.', null, '2033-03-02', '2033-03-02')), 2,
  'a Dhaka day takes in what happened after midnight there (18:30 UTC is already the next day)');
select is((select count(*)::int from public.admin_audit_log_search('rq.', null, '2033-03-01', '2033-03-01')), 0,
  'and leaves it out of the day before');
select is((select count(*)::int from public.admin_audit_log_search('rq.', null, '2033-03-05', null)), 2,
  'a lower bound alone is open-ended');
select is((select count(*)::int from public.admin_audit_log_search('rq.', null, null, '2033-03-02')), 2,
  'and so is an upper bound');
select is((select count(*)::int from public.admin_audit_log_search('rq.', null, '2033-03-02', '2033-03-05')), 3,
  'both bounds are inclusive days');
select is((select action from public.admin_audit_log_search('rq.', null, null, null, 'target-200')), 'rq.alpha_gamma',
  'q matches the target id');
select is((select count(*)::int from public.admin_audit_log_search('rq.', null, null, null, 'ALPHA')), 2,
  'and the action, ignoring case');
select is((select count(*)::int from public.admin_audit_log_search('rq.', null, null, null, 'rq actor')), 2,
  'and the actor''s name');
select is((select count(*)::int from public.admin_audit_log_search('rq.', null, null, null, 'rq-admin@')), 1,
  'and the actor''s email');
select is((select count(*)::int from public.admin_audit_log_search('rq.', null, null, null, '100%')), 1,
  'a percent sign in q matches itself');
select is((select count(*)::int from public.admin_audit_log_search('rq.', null, null, null, '%')), 1,
  'and is never a wildcard');
select is((select count(*)::int from public.admin_audit_log_search('rq.', null, null, null, 'alpha_b')), 1,
  'an underscore matches itself');
select is((select count(*)::int from public.admin_audit_log_search('rq.', null, null, null, 'al_ha')), 0,
  'and is never a single-character wildcard');
select is((select count(*)::int from public.admin_audit_log_search('rq.', '00000000-0000-4000-8000-0000000000f2', null, null, 'alpha')), 2,
  'filters combine with the actor filter');
select is((select total_count::int from public.admin_audit_log_search('rq.', null, null, null, null, 1, 0)), 4,
  'the total counts every match, not the page');
select throws_ok($$ select * from public.admin_audit_log_search(null, null, '2033-03-05', '2033-03-01') $$, 'NZ412', null,
  'a range must not end before it starts');
select throws_ok($$ select * from public.admin_audit_log_search(null, null, '2033-01-01', '2034-01-02') $$, 'NZ412', null,
  'a range is at most 366 days');
select lives_ok($$ select * from public.admin_audit_log_search(null, null, '2032-01-01', '2032-12-31') $$,
  'a whole leap year is allowed');
select throws_ok($$ select * from public.admin_audit_log_search(null, null, null, null, '   ') $$, 'NZ412', null,
  'a blank search is refused');
select throws_ok($$ select * from public.admin_audit_log_search(null, null, null, null, repeat('x', 101)) $$, 'NZ412', null,
  'a search is at most 100 characters');
select throws_ok($$ select * from public.admin_audit_log_search('RQ.') $$, 'NZ412', null,
  'the action prefix keeps its rule');

-- ---------------------------------------------------------------------------
-- 3. Store settings
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}';
select throws_ok($$ select public.admin_store_settings() $$, 'NZ403', null, 'an admin without settings.manage cannot read the settings');
select throws_ok($$ select public.admin_save_store_settings(7, 120, null, null, null) $$, 'NZ403', null, 'or save them');
select throws_ok($$ select public.admin_save_insight_thresholds(3, null, null) $$, 'NZ403', null, 'or the thresholds');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f0", "role": "authenticated"}';
select ok((select public.admin_store_settings() ?& array['returnWindowDays', 'cartInactivityMinutes', 'repeatOrderThreshold',
  'highSpendThresholdMinor', 'inactiveDays', 'monthlySalesTargetMinor', 'updatedAt']), 'the owner reads every setting');
select is((public.admin_save_store_settings(10, 240, 3, 800000, 90)) ->> 'returnWindowDays', '10', 'the owner saves all five together');
select is((public.admin_store_settings() ->> 'repeatOrderThreshold') || '/' || (public.admin_store_settings() ->> 'highSpendThresholdMinor')
  || '/' || (public.admin_store_settings() ->> 'inactiveDays') || '/' || (public.admin_store_settings() ->> 'cartInactivityMinutes'),
  '3/800000/90/240', 'and every value is stored');
select lives_ok($$ select public.admin_save_store_settings(14, 300, null, null, null) $$, 'null thresholds keep their values');
select is((public.admin_store_settings() ->> 'repeatOrderThreshold') || '/' || (public.admin_store_settings() ->> 'returnWindowDays'),
  '3/14', 'while the settings change');
select lives_ok($$ select public.admin_save_store_settings(20, 400) $$, 'the two-argument save still works');
select is(public.admin_store_settings() ->> 'inactiveDays', '90', 'and leaves the thresholds alone');
select lives_ok($$ select public.admin_save_insight_thresholds(null, 1234, null) $$, 'one threshold can change alone');
select is(public.admin_store_settings() ->> 'highSpendThresholdMinor', '1234', 'which is then stored');
select throws_ok($$ select public.admin_save_store_settings(30, 500, 99, null, null) $$, 'NZ412', null,
  'an invalid threshold refuses the whole save');
select is(public.admin_store_settings() ->> 'returnWindowDays', '20', 'so the settings did not change either');
select throws_ok($$ select public.admin_save_store_settings(0, 500, null, null, null) $$, 'NZ412', null, 'the return window is 1 to 90 days');
select throws_ok($$ select public.admin_save_insight_thresholds(1, null, null) $$, 'NZ412', null, 'a repeat customer has 2 to 20 orders');
select throws_ok($$ select public.admin_save_insight_thresholds(null, 0, null) $$, 'NZ412', null, 'the high-spend threshold is at least 1 poisha');
select throws_ok($$ select public.admin_save_insight_thresholds(null, null, 6) $$, 'NZ412', null, 'inactivity is 7 to 730 days');

reset role;
select is((select count(*)::int from public.audit_log
  where actor_id = '00000000-0000-4000-8000-0000000000f0' and action = 'settings.insight_thresholds_saved'), 2,
  'threshold saves are audited');
select ok((select count(*) >= 3 from public.audit_log
  where actor_id = '00000000-0000-4000-8000-0000000000f0' and action = 'settings.saved'), 'and so are settings saves');

-- ---------------------------------------------------------------------------
-- 4. Creating a coupon needs coupons.create
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f2", "role": "authenticated"}';
select throws_ok($$ select public.admin_save_coupon(null, 'RQ-NEW', 'percent', 10) $$, 'NZ403', null,
  'coupons.update alone cannot create a coupon');
select lives_ok($$ select public.admin_save_coupon('c0000000-0000-4000-8000-0000000000f1', 'RQ-EXISTING', 'percent', 15) $$,
  'but can still change one');
select lives_ok($$ select public.admin_set_coupon_active('c0000000-0000-4000-8000-0000000000f1', false) $$, 'and switch one on or off');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f3", "role": "authenticated"}';
select lives_ok($$ select public.admin_save_coupon(null, 'RQ-NEW', 'fixed', 5000) $$, 'coupons.create alone creates a coupon');
select throws_ok($$ select public.admin_save_coupon('c0000000-0000-4000-8000-0000000000f1', 'RQ-EXISTING', 'percent', 20) $$,
  'NZ403', null, 'but cannot change one');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}';
select lives_ok($$ select public.admin_save_coupon(null, 'RQ-ADMIN', 'percent', 5) $$, 'an admin holds both and creates coupons');
select lives_ok($$ select public.admin_save_coupon('c0000000-0000-4000-8000-0000000000f1', 'RQ-EXISTING', 'percent', 25) $$,
  'and changes them');
select throws_ok($$ select public.admin_save_coupon(null, 'rq', 'percent', 5) $$, 'NZ412', null, 'a new coupon''s fields are still validated');

reset role;
select is((select count(*)::int from public.audit_log where action = 'coupon.created'
  and details ->> 'code' in ('RQ-NEW', 'RQ-ADMIN')), 2, 'coupon creations are audited');
select results_eq($$ select r.role::text, count(*)::int from public.role_permissions rp
    join (select unnest(enum_range(null::public.app_role)) as role) r on r.role = rp.role
    where rp.permission in ('coupons.create', 'coupons.update') group by r.role order by r.role $$,
  $$ values ('super_admin', 2), ('admin', 2) $$,
  'only admin and the owner hold coupons by default, and both hold create and update');

select * from finish();
rollback;
