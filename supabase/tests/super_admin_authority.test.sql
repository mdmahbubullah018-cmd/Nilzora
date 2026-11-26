-- Super admin authority: the owner publishes without a review, everyone else does not,
-- a super admin holds the whole permission catalogue (explicit denials still win), and an
-- independent review stays the rule for accounts that are not the owner.
-- Fixtures use a `zs-` namespace and fixed ids; everything runs in a transaction that is
-- rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

-- ---------------------------------------------------------------------------
-- Fixtures (as the database owner)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000d0', 'zs-owner@example.com', now()),
  ('00000000-0000-4000-8000-0000000000d1', 'zs-admin@example.com', now()),
  ('00000000-0000-4000-8000-0000000000d2', 'zs-moderator@example.com', now()),
  ('00000000-0000-4000-8000-0000000000d3', 'zs-buyer@example.com', now());

update public.user_roles set role = 'super_admin' where user_id = '00000000-0000-4000-8000-0000000000d0';
update public.user_roles set role = 'admin' where user_id = '00000000-0000-4000-8000-0000000000d1';
update public.user_roles set role = 'moderator' where user_id = '00000000-0000-4000-8000-0000000000d2';

insert into public.categories (id, slug, name) values
  ('ca000000-0000-4000-8000-0000000000d1', 'zs-authority', 'ZS Authority');

insert into public.products
  (id, category_id, slug, sku, name, price_minor, stock_quantity, status, moderation_status)
values
  ('0d000000-0000-4000-8000-0000000000f1', 'ca000000-0000-4000-8000-0000000000d1',
   'zs-draft', 'ZS-DRAFT', 'ZS Draft', 10000, 5, 'draft', 'not_submitted'),
  ('0d000000-0000-4000-8000-0000000000f2', 'ca000000-0000-4000-8000-0000000000d1',
   'zs-pending', 'ZS-PENDING', 'ZS Pending', 10000, 5, 'draft', 'pending'),
  ('0d000000-0000-4000-8000-0000000000f3', 'ca000000-0000-4000-8000-0000000000d1',
   'zs-approved', 'ZS-APPROVED', 'ZS Approved', 10000, 5, 'draft', 'approved'),
  ('0d000000-0000-4000-8000-0000000000f4', 'ca000000-0000-4000-8000-0000000000d1',
   'zs-admin-pending', 'ZS-ADMIN-PENDING', 'ZS Admin Pending', 10000, 5, 'draft', 'pending');

-- The review of the pending product, submitted by the owner.
insert into public.moderation_tasks (id, product_id, content, submitted_by, content_editor) values
  ('f1000000-0000-4000-8000-0000000000a1', '0d000000-0000-4000-8000-0000000000f2',
   '{"name": "ZS Pending"}'::jsonb,
   '00000000-0000-4000-8000-0000000000d0', '00000000-0000-4000-8000-0000000000d0');
-- A review an admin wrote, already assigned to that same admin: the self-review rule is what
-- stops it, not the assignment.
insert into public.moderation_tasks (id, product_id, content, submitted_by, content_editor, assigned_to) values
  ('f1000000-0000-4000-8000-0000000000a2', '0d000000-0000-4000-8000-0000000000f4',
   '{"name": "ZS Admin Pending"}'::jsonb,
   '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d1',
   '00000000-0000-4000-8000-0000000000d1');

-- ---------------------------------------------------------------------------
-- 1. The owner is a role, read from user_roles
-- ---------------------------------------------------------------------------

select ok(private.is_super_admin('00000000-0000-4000-8000-0000000000d0'),
  'the owner holds super_admin');
select ok(not private.is_super_admin('00000000-0000-4000-8000-0000000000d1'),
  'an admin does not hold super_admin');
select ok(not private.is_super_admin(null), 'nobody is the owner without an id');

-- ---------------------------------------------------------------------------
-- 2. Owner authority is the whole catalogue, and a denial still wins
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from private.permissions_of('00000000-0000-4000-8000-0000000000d0')),
  (select count(*)::int from public.permissions),
  'the owner holds every permission in the catalogue'
);
select ok(
  not exists (
    select 1 from private.permissions_of('00000000-0000-4000-8000-0000000000d1') as x (name)
    where x.name = 'settings.manage'
  ),
  'an admin does not hold the owner-only store settings'
);
select ok(
  exists (
    select 1 from private.permissions_of('00000000-0000-4000-8000-0000000000d0') as x (name)
    where x.name = 'settings.manage'
  ),
  'the owner holds store settings'
);

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d0", "role": "authenticated"}';
select is(public.has_permission('products.publish'), true, 'the owner may publish');
select is(public.has_permission('staff.roles.assign'), true, 'the owner may assign roles');

reset role;
insert into public.user_permissions (user_id, permission, effect)
values ('00000000-0000-4000-8000-0000000000d0', 'products.publish', 'deny');

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d0", "role": "authenticated"}';
select is(public.has_permission('products.publish'), false,
  'an explicit denial takes the permission away from the owner too');
select throws_ok(
  $$ select public.admin_set_product_status('0d000000-0000-4000-8000-0000000000f1', 'active') $$,
  'NZ403', null, 'a denied owner cannot publish either');

reset role;
delete from public.user_permissions
 where user_id = '00000000-0000-4000-8000-0000000000d0' and permission = 'products.publish';

-- ---------------------------------------------------------------------------
-- 3. The owner publishes content no review has approved
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d0", "role": "authenticated"}';

select lives_ok(
  $$ select public.admin_set_product_status('0d000000-0000-4000-8000-0000000000f1', 'active') $$,
  'the owner publishes a product that was never submitted');
select is(
  (select status::text from public.products where id = '0d000000-0000-4000-8000-0000000000f1'),
  'active', 'the product is on sale');
select is(
  (select moderation_status::text from public.products where id = '0d000000-0000-4000-8000-0000000000f2'),
  'pending', 'publishing one product leaves another review untouched');

select lives_ok(
  $$ select public.admin_set_product_status('0d000000-0000-4000-8000-0000000000f2', 'active') $$,
  'the owner publishes a product that was under review');
select is(
  (select moderation_status::text from public.products where id = '0d000000-0000-4000-8000-0000000000f2'),
  'approved', 'publishing approved the content as it stood');
select is(
  (select status::text from public.moderation_tasks where id = 'f1000000-0000-4000-8000-0000000000a1'),
  'approved', 'the pending review of that product was closed as approved');

-- ---------------------------------------------------------------------------
-- 4. An admin with products.publish still follows the review workflow
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d1", "role": "authenticated"}';

select throws_ok(
  $$ select public.admin_set_product_status('0d000000-0000-4000-8000-0000000000f4', 'active') $$,
  'NZ432', null, 'an admin cannot publish content no review has approved');
select lives_ok(
  $$ select public.admin_set_product_status('0d000000-0000-4000-8000-0000000000f3', 'active') $$,
  'an admin publishes content a review approved');

-- A moderator holds no products.publish at all.
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d2", "role": "authenticated"}';
select throws_ok(
  $$ select public.admin_set_product_status('0d000000-0000-4000-8000-0000000000f4', 'active') $$,
  'NZ403', null, 'a moderator cannot publish products');

-- ---------------------------------------------------------------------------
-- 5. Independent review: the owner may decide their own, an admin may not
-- ---------------------------------------------------------------------------

-- Publishing closed the review, so reopen it to exercise the owner's own review path.
reset role;
update public.moderation_tasks
   set status = 'pending', decided_by = null, decided_at = null, decision_note = null
 where id = 'f1000000-0000-4000-8000-0000000000a1';

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d0", "role": "authenticated"}';
select lives_ok(
  $$ select public.assign_moderation_task('f1000000-0000-4000-8000-0000000000a1',
       '00000000-0000-4000-8000-0000000000d0') $$,
  'the owner may take the review of their own submission');

select lives_ok(
  $$ select public.decide_moderation_task('f1000000-0000-4000-8000-0000000000a1', 'approved') $$,
  'the owner decides the review of their own submission');

set local request.jwt.claims to '{"sub": "00000000-0000-4000-8000-0000000000d1", "role": "authenticated"}';
select throws_ok(
  $$ select public.decide_moderation_task('f1000000-0000-4000-8000-0000000000a2', 'approved') $$,
  'NZ437', null, 'nobody else reviews content they submitted or wrote');

-- ---------------------------------------------------------------------------
-- 6. The audit trail records an owner publish as an approval
-- ---------------------------------------------------------------------------

reset role;
select is(
  (select count(*)::int from public.audit_log
    where action = 'moderation.approved'
      and target_id = '0d000000-0000-4000-8000-0000000000f2'
      and (details ->> 'implicit') = 'true'),
  1, 'the owner publish is audited as an implicit approval');
select is(
  (select count(*)::int from public.audit_log
    where action = 'product.status_changed'
      and target_id = '0d000000-0000-4000-8000-0000000000f2'
      and (details ->> 'approvedOnPublish') = 'true'),
  1, 'the status change records that publishing approved the content');
select isnt(
  (select details from public.audit_log
    where action = 'product.status_changed'
      and target_id = '0d000000-0000-4000-8000-0000000000f3'
      and (details ->> 'to') = 'active'),
  null, 'a normal publish is audited without the owner flag');

select * from finish();
rollback;
