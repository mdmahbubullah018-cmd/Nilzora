-- The operator queue and the team directory (20261202090000_chat_support_workspace.sql).
-- Runs inside a transaction that is rolled back, so it leaves no data behind.

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

-- Fixtures ------------------------------------------------------------------
insert into public.profiles (id, email, full_name, status) values
  ('a1a1a1a1-0000-4000-8000-000000000001', 'queue-cust1@example.com', 'Queue Customer', 'active'),
  ('a1a1a1a1-0000-4000-8000-000000000002', 'queue-cust2@example.com', 'Queue Customer Two', 'active'),
  ('a1a1a1a1-0000-4000-8000-000000000003', 'queue-cust3@example.com', 'Queue Customer Three', 'active'),
  ('b1b1b1b1-0000-4000-8000-000000000001', 'queue-staff1@example.com', 'Queue Staff One', 'active'),
  ('b1b1b1b1-0000-4000-8000-000000000002', 'queue-staff2@example.com', 'Queue Staff Two', 'active'),
  ('b1b1b1b1-0000-4000-8000-000000000003', 'queue-admin@example.com', 'Queue Admin', 'active'),
  ('b1b1b1b1-0000-4000-8000-000000000004', 'queue-gone@example.com', 'Queue Suspended', 'suspended'),
  ('c1c1c1c1-0000-4000-8000-000000000001', 'queue-mod@example.com', 'Queue Moderator', 'active');

insert into public.user_roles (user_id, role) values
  ('a1a1a1a1-0000-4000-8000-000000000001', 'customer'),
  ('a1a1a1a1-0000-4000-8000-000000000002', 'customer'),
  ('a1a1a1a1-0000-4000-8000-000000000003', 'customer'),
  ('b1b1b1b1-0000-4000-8000-000000000001', 'staff'),
  ('b1b1b1b1-0000-4000-8000-000000000002', 'staff'),
  ('b1b1b1b1-0000-4000-8000-000000000003', 'admin'),
  ('b1b1b1b1-0000-4000-8000-000000000004', 'staff'),
  ('c1c1c1c1-0000-4000-8000-000000000001', 'moderator');

-- Three customers' threads: one unassigned, one assigned to staff two, one resolved and unowned.
insert into public.chat_conversations (id, kind, status, priority, subject, customer_id, assignee_id, last_message_at)
values
  ('d1d1d1d1-0000-4000-8000-000000000001', 'customer_support', 'open', 'normal',
   'Queue: unassigned question', 'a1a1a1a1-0000-4000-8000-000000000001', null, now() - interval '3 hours'),
  ('d1d1d1d1-0000-4000-8000-000000000002', 'customer_support', 'pending', 'urgent',
   'Queue: owned by staff two', 'a1a1a1a1-0000-4000-8000-000000000002',
   'b1b1b1b1-0000-4000-8000-000000000002', now() - interval '2 hours'),
  ('d1d1d1d1-0000-4000-8000-000000000003', 'customer_support', 'resolved', 'high',
   'Queue: resolved earlier', 'a1a1a1a1-0000-4000-8000-000000000003', null, now() - interval '1 hour');

-- An internal team thread staff one is part of: it belongs to the team view, not the queue.
insert into public.chat_conversations (id, kind, status, priority, subject, last_message_at)
values ('d1d1d1d1-0000-4000-8000-000000000004', 'internal_group', 'open', 'normal',
        'Queue: team thread', now());
insert into public.chat_conversation_participants (conversation_id, user_id, role)
values ('d1d1d1d1-0000-4000-8000-000000000004', 'b1b1b1b1-0000-4000-8000-000000000001', 'staff');

set local role authenticated;

-- A staff member sees only what chat_can_read lets them open --------------
set local request.jwt.claims to '{"sub": "b1b1b1b1-0000-4000-8000-000000000001", "role": "authenticated"}';

select is(
  (select count(*)::int from public.chat_support_queue('all', null, null, 'Queue:', 'queue', 30, 0)),
  1,
  'staff see the unassigned open thread and nothing assigned to someone else or closed out'
);
select is(
  (select subject from public.chat_support_queue('all', null, null, 'Queue:', 'queue', 30, 0) limit 1),
  'Queue: unassigned question',
  'the visible thread is the unassigned one'
);
select is(
  (select count(*)::int from public.chat_support_queue('all', null, null, 'team thread', 'queue', 30, 0)),
  0,
  'an internal team thread never appears in the customer queue'
);
select is(
  (select count(*)::int from public.chat_support_queue('mine', null, null, 'Queue:', 'queue', 30, 0)),
  0,
  'mine is empty for a staff member with nothing assigned'
);

-- An admin sees the whole queue, sorted as asked --------------------------
set local request.jwt.claims to '{"sub": "b1b1b1b1-0000-4000-8000-000000000003", "role": "authenticated"}';

select is(
  (select count(*)::int from public.chat_support_queue('all', null, null, 'Queue:', 'queue', 30, 0)),
  3,
  'an admin sees every customer thread'
);
select is(
  (select subject from public.chat_support_queue('all', null, null, 'Queue:', 'queue', 30, 0) limit 1),
  'Queue: owned by staff two',
  'the queue order puts active threads first, most urgent first'
);
select is(
  (select subject from public.chat_support_queue('all', null, null, 'Queue:', 'recent', 30, 0) limit 1),
  'Queue: resolved earlier',
  'recent puts the latest activity first'
);
select is(
  (select subject from public.chat_support_queue('all', null, null, 'Queue:', 'oldest', 30, 0) limit 1),
  'Queue: unassigned question',
  'oldest puts the least recent activity first'
);
select is(
  (select count(*)::int from public.chat_support_queue('all', null, 'urgent', 'Queue:', 'queue', 30, 0)),
  1,
  'the priority filter keeps only that priority'
);
select throws_ok(
  $$ select * from public.chat_support_queue('all', null, null, null, 'loudest', 30, 0) $$,
  'NZ509', null,
  'an unknown sort is refused'
);

-- A moderator reaches no customer thread ------------------------------------
set local request.jwt.claims to '{"sub": "c1c1c1c1-0000-4000-8000-000000000001", "role": "authenticated"}';

select is(
  (select count(*)::int from public.chat_support_queue('all', null, null, 'Queue:', 'queue', 30, 0)),
  0,
  'a moderator does not see customer support threads'
);

-- The team directory --------------------------------------------------------
select is(
  (select count(*)::int from public.chat_team_members() t
   where t.email in ('queue-staff1@example.com', 'queue-staff2@example.com',
                     'queue-admin@example.com', 'queue-mod@example.com')),
  4,
  'a moderator with team chat reads the directory of active teammates'
);
select is(
  (select count(*)::int from public.chat_team_members() t
   where t.email in ('queue-cust1@example.com', 'queue-gone@example.com')),
  0,
  'customers and suspended accounts are never listed'
);
select is(
  (select t.pending_count::int from public.chat_team_members() t
   where t.email = 'queue-staff2@example.com'),
  1,
  'the workload counts the threads a teammate holds'
);
select is(
  (select t.can_support from public.chat_team_members() t where t.email = 'queue-mod@example.com'),
  false,
  'a moderator is not offered as a support assignee'
);

-- A customer is refused ----------------------------------------------------
set local request.jwt.claims to '{"sub": "a1a1a1a1-0000-4000-8000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$ select * from public.chat_team_members() $$,
  'NZ403', null,
  'a customer cannot read the team directory'
);

select * from finish();
rollback;
