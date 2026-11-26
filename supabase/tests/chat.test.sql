-- Database-level checks for the unified communication system: authorization, idempotent
-- sending, read receipts, internal-note isolation and the deny-by-default tables.
-- Runs inside a transaction that is rolled back, so it leaves no data behind.

begin;

create extension if not exists pgtap with schema extensions;

select plan(36);

-- Fixtures ------------------------------------------------------------------
insert into public.profiles (id, email, full_name, status) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'chat-cust1@example.com', 'Customer One', 'active'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'chat-cust2@example.com', 'Customer Two', 'active'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'chat-staff@example.com', 'Staff One', 'active'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'chat-admin@example.com', 'Admin One', 'active'),
  ('cccccccc-0000-4000-8000-000000000001', 'chat-mod@example.com', 'Mod One', 'active');

insert into public.user_roles (user_id, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'customer'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'customer'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'staff'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'admin'),
  ('cccccccc-0000-4000-8000-000000000001', 'moderator');

insert into public.categories (id, name, slug) values
  ('dddddddd-0000-4000-8000-000000000001', 'Chat test bags', 'chat-test-bags');
insert into public.products (id, category_id, slug, sku, name, price_minor, status, published_at)
values ('eeeeeeee-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001',
        'chat-test-tote', 'NZ-CHAT-1', 'Chat Test Tote', 250000, 'active', now());

-- An order, inserted directly: placing one is covered by the commerce tests.
insert into public.orders (
  id, user_id, item_count, subtotal_minor, shipping_fee_minor, total_minor, delivery_zone,
  ship_recipient_name, ship_phone, ship_division, ship_district, ship_area, ship_address_line,
  idempotency_key, request_fingerprint
) values (
  'ffffffff-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
  1, 250000, 6000, 256000, 'inside_dhaka',
  'Customer One', '+8801712345678', 'Dhaka', 'Dhaka', 'Gulshan', 'Road 1',
  'ffffffff-0000-4000-8000-00000000a001', 'chat-test'
);
-- As customer one -----------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "aaaaaaaa-0000-4000-8000-000000000001", "role": "authenticated"}';

select is(
  public.start_chat_conversation(
    'customer_support'::public.chat_conversation_type, null, 'eeeeeeee-0000-4000-8000-000000000001',
    null, 'Do you ship to Sylhet?'
  ) -> 'conversation' ->> 'status',
  'open',
  'a customer opens their own support conversation'
);

create temporary table chat_probe on commit drop as
  select id as conv
  from public.my_chat_conversations('all', null, null, 20, 0);
grant select on chat_probe to authenticated;

select is((select count(*)::int from public.my_chat_conversations('all', null, null, 20, 0)), 1,
  'the conversation appears in the customer list');
select is(public.my_unread_chat_count(), 0::bigint,
  'a customer has nothing unread in a thread they just wrote in');

select is(
  (select seq from public.chat_messages((select conv from chat_probe), null, 30) limit 1) is not null,
  true,
  'the first message is stored'
);

-- Idempotent sending --------------------------------------------------------
select is(
  (public.send_chat_message(
    (select conv from chat_probe), 'f0000000-0000-4000-8000-000000000001', 'Second message'
  )).duplicate,
  false,
  'a new message is not a duplicate'
);
select is(
  (public.send_chat_message(
    (select conv from chat_probe), 'f0000000-0000-4000-8000-000000000001', 'Second message'
  )).duplicate,
  true,
  'retrying the same client message id is answered as a duplicate'
);
select is(
  (select count(*)::int from public.chat_messages((select conv from chat_probe), null, 30)),
  2,
  'a retried send stores the message once'
);

-- Another customer is refused ----------------------------------------------
set local request.jwt.claims to '{"sub": "aaaaaaaa-0000-4000-8000-000000000002", "role": "authenticated"}';

select is((select count(*)::int from public.my_chat_conversations('all', null, null, 20, 0)), 0,
  'another customer never sees the thread');
select throws_ok(
  format('select public.chat_conversation(%L)', (select conv from chat_probe)),
  'NZ501', null,
  'another customer is refused with conversation_not_found'
);
select throws_ok(
  format('select * from public.chat_messages(%L)', (select conv from chat_probe)),
  'NZ501', null,
  'another customer cannot page the messages'
);

-- The tables themselves stay closed ---------------------------------------
select ok(
  (select relrowsecurity from pg_class where oid = 'public.chat_conversations'::regclass),
  'RLS is enabled on chat_conversations'
);
-- The one exception (20261122090000): a customer reads their own message-feedback rows.
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename like 'chat\_%'
             and not (tablename = 'chat_message_feedback' and policyname = 'chat_message_feedback_own_read')), 0,
  'no policy opens the chat tables directly (beyond a customer''s own feedback)');
select throws_ok('select count(*) from public.chat_conversations', '42501', null,
  'a signed-in account cannot read the table directly');
select throws_ok('select count(*) from public.chat_messages', '42501', null,
  'a signed-in account cannot read messages directly');
select throws_ok('select count(*) from public.chat_internal_notes', '42501', null,
  'a signed-in account cannot read internal notes directly');

-- Staff work the queue ------------------------------------------------------
set local request.jwt.claims to '{"sub": "bbbbbbbb-0000-4000-8000-000000000001", "role": "authenticated"}';

-- Counted by this test's own thread, not by the table: a database that already holds threads
-- (a developer's local data) must not change the result.
select is((select count(*)::int from public.my_chat_conversations('unassigned', null, null, 20, 0)
             where id = (select conv from chat_probe)), 1,
  'an unassigned thread appears in the staff queue');
select is(
  public.chat_can_access((select conv from chat_probe)),
  true,
  'the database authorizes the staff account for the realtime room'
);
select is(
  (public.add_chat_internal_note((select conv from chat_probe), 'Repeat buyer')).author_name,
  'Staff One',
  'staff can leave an internal note'
);
select is(
  (public.send_chat_message(
    (select conv from chat_probe), 'f0000000-0000-4000-8000-000000000002', 'Yes, two days to Sylhet.'
  )).sender_role::text,
  'staff',
  'staff replies as staff'
);
select is(
  (public.chat_conversation((select conv from chat_probe)) -> 'conversation' ->> 'assigneeId')::uuid,
  'bbbbbbbb-0000-4000-8000-000000000001'::uuid,
  'replying to an unassigned thread takes ownership of it'
);
select is(
  public.assign_chat_conversation(
    (select conv from chat_probe), 'bbbbbbbb-0000-4000-8000-000000000002', 'Escalated'
  ) -> 'conversation' ->> 'assigneeId',
  'bbbbbbbb-0000-4000-8000-000000000002',
  'staff can hand the thread to an admin'
);
select is(
  public.set_chat_conversation_priority((select conv from chat_probe), 'high'::public.chat_priority)
    -> 'conversation' ->> 'priority',
  'high',
  'staff can set the priority'
);
select is(
  (select count(*)::int from public.chat_internal_notes((select conv from chat_probe), null, 30)),
  1,
  'staff can read the internal notes'
);

-- The customer sees the reply, never the note ------------------------------
set local request.jwt.claims to '{"sub": "aaaaaaaa-0000-4000-8000-000000000001", "role": "authenticated"}';

select is(
  (select count(*)::int from public.chat_messages((select conv from chat_probe), null, 30)),
  3,
  'the customer sees every customer-visible message'
);
select throws_ok(
  format('select * from public.chat_internal_notes(%L)', (select conv from chat_probe)),
  'NZ403', null,
  'internal notes are refused to the customer'
);
select is(public.my_unread_chat_count(), 1::bigint, 'the staff reply is unread for the customer');
select is(public.mark_chat_read((select conv from chat_probe), 999999::bigint), 0::bigint,
  'marking read clears the unread count');

-- A customer cannot use staff controls -------------------------------------
select throws_ok(
  format('select public.assign_chat_conversation(%L, null, null)', (select conv from chat_probe)),
  'NZ403', null,
  'a customer cannot assign a conversation'
);
select throws_ok(
  format('select public.set_chat_conversation_priority(%L, %L)',
         (select conv from chat_probe), 'urgent'),
  'NZ403', null,
  'a customer cannot set the priority'
);
select throws_ok(
  format('select public.set_chat_conversation_status(%L, %L)',
         (select conv from chat_probe), 'pending'),
  'NZ403', null,
  'a customer cannot move a thread into the staff queue states'
);
select throws_ok(
  format('select public.add_chat_internal_note(%L, %L)', (select conv from chat_probe), 'note'),
  'NZ403', null,
  'a customer cannot write an internal note'
);

-- Closing a thread stops new messages --------------------------------------
select is(
  public.set_chat_conversation_status(
    (select conv from chat_probe), 'closed'::public.chat_conversation_status
  ) -> 'conversation' ->> 'status',
  'closed',
  'a customer can close their own conversation'
);
select throws_ok(
  format('select public.send_chat_message(%L, gen_random_uuid(), %L)',
         (select conv from chat_probe), 'after close'),
  'NZ502', null,
  'a closed conversation refuses new messages'
);

-- Moderators never reach the support queue --------------------------------
set local request.jwt.claims to '{"sub": "cccccccc-0000-4000-8000-000000000001", "role": "authenticated"}';

select is((select count(*)::int from public.my_chat_conversations('all', null, null, 20, 0)), 0,
  'a moderator does not see customer support threads');

-- An order thread is created only for the caller's own order ---------------
set local request.jwt.claims to '{"sub": "aaaaaaaa-0000-4000-8000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$ select public.start_chat_conversation(
       'order_support'::public.chat_conversation_type,
       (select order_number from public.orders where id = 'ffffffff-0000-4000-8000-000000000001'),
       null, null, 'Where is my order?'
     ) $$,
  'NZ507', null,
  'another customer cannot open a thread on this order'
);

-- Signing out is not a way in ---------------------------------------------
set local request.jwt.claims to '{"role": "anon"}';

select throws_ok(
  format('select public.chat_conversation(%L)', (select conv from chat_probe)),
  '42501', null,
  'a request without an account is refused'
);

select * from finish();
rollback;
