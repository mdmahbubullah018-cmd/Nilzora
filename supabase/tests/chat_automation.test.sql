-- Database-level checks for Phase 2 of the unified communication system: templates, the
-- automation engine, saved replies, tags, attachments, satisfaction, internal team chat,
-- the moderator review queue and the analytics report.
-- Runs inside a transaction that is rolled back, so it leaves no data behind.

begin;

create extension if not exists pgtap with schema extensions;

select plan(45);

-- Fixtures ------------------------------------------------------------------
insert into public.profiles (id, email, full_name, status) values
  ('a1000000-0000-4000-8000-000000000001', 'p2-cust1@example.com', 'P2 Customer One', 'active'),
  ('a1000000-0000-4000-8000-000000000002', 'p2-cust2@example.com', 'P2 Customer Two', 'active'),
  ('b1000000-0000-4000-8000-000000000001', 'p2-staff@example.com', 'P2 Staff One', 'active'),
  ('b1000000-0000-4000-8000-000000000002', 'p2-admin@example.com', 'P2 Admin One', 'active'),
  ('b1000000-0000-4000-8000-000000000003', 'p2-staff2@example.com', 'P2 Staff Two', 'active'),
  ('c1000000-0000-4000-8000-000000000001', 'p2-mod@example.com', 'P2 Mod One', 'active');

insert into public.user_roles (user_id, role) values
  ('a1000000-0000-4000-8000-000000000001', 'customer'),
  ('a1000000-0000-4000-8000-000000000002', 'customer'),
  ('b1000000-0000-4000-8000-000000000001', 'staff'),
  ('b1000000-0000-4000-8000-000000000002', 'admin'),
  ('b1000000-0000-4000-8000-000000000003', 'staff'),
  ('c1000000-0000-4000-8000-000000000001', 'moderator');

insert into public.orders (
  id, user_id, item_count, subtotal_minor, shipping_fee_minor, total_minor, delivery_zone,
  ship_recipient_name, ship_phone, ship_division, ship_district, ship_area, ship_address_line,
  idempotency_key, request_fingerprint, order_number
) values (
  'f1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
  1, 250000, 6000, 256000, 'inside_dhaka',
  'P2 Customer One', '+8801712345678', 'Dhaka', 'Dhaka', 'Gulshan', 'Road 1',
  'f1000000-0000-4000-8000-00000000a001', 'p2-automation', 'NZ-P2-1000'
);

insert into public.chat_tags (slug, label) values
  ('refund', 'Refund'),
  ('vip', 'VIP');

-- As the admin --------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "b1000000-0000-4000-8000-000000000002", "role": "authenticated"}';

-- The vocabulary guard is enforced when the template is stored, not when it is rendered.
select throws_ok(
  $sql$select public.save_chat_message_template(
    null, 'Broken', 'other', 'en', 'Hello {customer_name}, order {order_id}.', null, true
  )$sql$,
  'NZ512',
  null,
  'a template that names a variable outside the vocabulary is refused'
);

create temporary table p2_template on commit drop as
  select public.save_chat_message_template(
    null, 'Refund acknowledgement', 'returns', 'en',
    'Hello {customer_name}, we are looking at order {order_number} now.',
    'First reply for a refund question.'
  ) as payload;
grant select on p2_template to authenticated;
create temporary table p2_template_id on commit drop as
  select (payload ->> 'id')::uuid as id from p2_template;
grant select on p2_template_id to authenticated;

select is(
  (select (payload -> 'variables')::text from p2_template),
  '["customer_name", "order_number"]',
  'the variables a template uses are extracted when it is saved'
);

select is(
  jsonb_array_length((select payload -> 'variables' from p2_template)),
  2,
  'only the two placeholders the body actually uses are recorded'
);

create temporary table p2_rule on commit drop as
  select public.save_chat_automation_rule(
    null, 'Acknowledge refund questions', 'message_received',
    '{"kinds": ["customer_support"], "keywords": ["refund"]}'::jsonb,
    jsonb_build_array(
      jsonb_build_object('type', 'reply_template', 'templateId', (select id from p2_template_id)),
      jsonb_build_object('type', 'set_priority', 'value', 'high'),
      jsonb_build_object('type', 'set_tags', 'value', jsonb_build_array('refund'))
    ),
    'Answers a refund question once, immediately.',
    10, false, 900, true
  ) as payload;
grant select on p2_rule to authenticated;
create temporary table p2_rule_id on commit drop as
  select (payload ->> 'id')::uuid as id from p2_rule;
grant select on p2_rule_id to authenticated;

select ok((select id from p2_rule_id) is not null, 'an admin can store an automation rule');

select throws_ok(
  $sql$select public.save_chat_automation_rule(
    null, 'Dangerous', 'message_received', '{}'::jsonb,
    '[{"type": "run_sql", "value": "drop table orders"}]'::jsonb, null, 100, false, 0, true
  )$sql$,
  'NZ509',
  null,
  'an action outside the closed vocabulary is refused'
);

select throws_ok(
  $sql$select public.save_chat_automation_rule(
    null, 'Odd condition', 'message_received', '{"sql": "drop table orders"}'::jsonb,
    '[{"type": "pause_automation"}]'::jsonb, null, 100, false, 0, true
  )$sql$,
  'NZ509',
  null,
  'a condition key outside the vocabulary is refused'
);

select is(
  jsonb_array_length(public.chat_analytics(now() - interval '1 day', now() + interval '1 day')
    -> 'daily'),
  3,
  'analytics answers one row per day of the period'
);

-- As customer one -----------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "a1000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select throws_ok(
  $sql$select * from public.chat_message_templates()$sql$,
  'NZ403',
  null,
  'a customer may not list the staff templates'
);

select throws_ok(
  $sql$select * from public.chat_automation_rules()$sql$,
  'NZ403',
  null,
  'a customer may not list the automation rules'
);

create temporary table p2_conv on commit drop as
  select (public.start_chat_conversation(
    'customer_support'::public.chat_conversation_type, null, null, null, null
  ) -> 'conversation' ->> 'id')::uuid as id;
grant select on p2_conv to authenticated;

select public.post_chat_message(
  (select id from p2_conv), 'a1000000-0000-4000-8000-0000000000f1', 'I would like a refund', null
);

reset role;

select is(
  (select count(*)::int from public.chat_messages m
   where m.conversation_id = (select id from p2_conv) and m.kind = 'automated'),
  1,
  'the automation rule answers a matching customer message once'
);

select is(
  (select priority::text from public.chat_conversations where id = (select id from p2_conv)),
  'high',
  'the rule also raised the priority'
);

select is(
  (select count(*)::int from public.chat_conversation_tags ct
   where ct.conversation_id = (select id from p2_conv)
     and ct.tag_id = (select id from public.chat_tags where slug = 'refund')),
  1,
  'the rule applied the refund tag'
);

select is(
  (select first_response_at is null from public.chat_conversations where id = (select id from p2_conv)),
  true,
  'an automatic reply does not count as a human first response'
);

select is(
  (select status::text from public.chat_automation_runs where conversation_id = (select id from p2_conv)),
  'applied',
  'the run is logged as applied'
);

-- The same event, replayed, must not answer twice.
reset role;
select private.chat_automation_apply(
  'message_received',
  (select id from p2_conv),
  'msg:' || (select m.id::text from public.chat_messages m
             where m.conversation_id = (select id from p2_conv) and m.sender_role = 'customer'
             limit 1),
  jsonb_build_object('body', 'I would like a refund')
);

select is(
  (select count(*)::int from public.chat_messages m
   where m.conversation_id = (select id from p2_conv) and m.kind = 'automated'),
  1,
  'replaying the same event does not send a second automatic reply'
);

set local role authenticated;
set local request.jwt.claims to '{"sub": "a1000000-0000-4000-8000-000000000001", "role": "authenticated"}';

-- Inside the cooldown window the rule stays quiet.
select public.post_chat_message(
  (select id from p2_conv), 'a1000000-0000-4000-8000-0000000000f2', 'Any refund update?', null
);
reset role;

select is(
  (select count(*)::int from public.chat_messages m
   where m.conversation_id = (select id from p2_conv) and m.kind = 'automated'),
  1,
  'the cooldown stops the rule from answering again straight away'
);

-- Satisfaction --------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "a1000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select throws_ok(
  format($sql$select public.submit_chat_csat(%L, 4::smallint, null)$sql$, (select id from p2_conv)),
  'NZ520',
  null,
  'an open conversation cannot be rated yet'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "b1000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select public.post_chat_message(
  (select id from p2_conv), 'a1000000-0000-4000-8000-0000000000f3', 'The refund is on its way.', null
);
select public.set_chat_conversation_status((select id from p2_conv), 'resolved');

reset role;
select is(
  (select first_response_at is not null from public.chat_conversations
   where id = (select id from p2_conv)),
  true,
  'a staff reply records the first response time'
);

set local role authenticated;
set local request.jwt.claims to '{"sub": "a1000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select is(
  (public.submit_chat_csat((select id from p2_conv), 5::smallint, 'Fast, thank you.') ->> 'rating'),
  '5',
  'the customer can rate a resolved conversation'
);

reset role;
select is(
  (select csat_rating::int from public.chat_conversations where id = (select id from p2_conv)),
  5,
  'the rating is mirrored onto the conversation for sorting'
);

set local role authenticated;
set local request.jwt.claims to '{"sub": "a1000000-0000-4000-8000-000000000002", "role": "authenticated"}';

select throws_ok(
  format($sql$select public.submit_chat_csat(%L, 1::smallint, null)$sql$, (select id from p2_conv)),
  'NZ501',
  null,
  'another customer cannot rate somebody else conversation'
);

-- Attachments ---------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "a1000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select throws_ok(
  format(
    $sql$select public.begin_chat_attachment(
      %L, 'elsewhere/photo.png', 'photo.png', 'image/png', 1024
    )$sql$,
    (select id from p2_conv)
  ),
  'NZ518',
  null,
  'an upload key outside the conversation prefix is refused'
);

select throws_ok(
  format(
    $sql$select public.begin_chat_attachment(
      %L, %L, 'payload.html', 'text/html', 1024
    )$sql$,
    (select id from p2_conv),
    'chat/' || (select id from p2_conv) || '/payload.html'
  ),
  'NZ516',
  null,
  'an unsupported content type is refused'
);

create temporary table p2_attachment on commit drop as
  select public.begin_chat_attachment(
    (select id from p2_conv),
    'chat/' || (select id from p2_conv) || '/receipt.png',
    'receipt.png', 'image/png', 2048, 800, 600
  ) as payload;
grant select on p2_attachment to authenticated;

select is(
  (select payload ->> 'status' from p2_attachment),
  'pending',
  'reserving an upload returns a pending attachment'
);

-- A voice message carries its length, and only a voice message may.

select throws_ok(
  format(
    $sql$select public.begin_chat_attachment(
      %L, %L, 'photo.png', 'image/png', 1024, null, null, 12500
    )$sql$,
    (select id from p2_conv),
    'chat/' || (select id from p2_conv) || '/photo.png'
  ),
  'NZ524',
  null,
  'a picture cannot carry a duration'
);

select throws_ok(
  format(
    $sql$select public.begin_chat_attachment(
      %L, %L, 'voice.webm', 'audio/webm', 1024, null, null, 300001
    )$sql$,
    (select id from p2_conv),
    'chat/' || (select id from p2_conv) || '/voice.webm'
  ),
  'NZ524',
  null,
  'a recording longer than five minutes is refused'
);

create temporary table p2_voice on commit drop as
  select public.begin_chat_attachment(
    (select id from p2_conv),
    'chat/' || (select id from p2_conv) || '/voice.webm',
    'voice.webm', 'audio/webm', 4096, null, null, 12500
  ) as payload;
grant select on p2_voice to authenticated;

select is(
  (select (payload ->> 'durationMs')::int from p2_voice),
  12500,
  'a recording stores the length it was measured at'
);

reset role;

-- The per-kind ceilings, checked type by type: the API and both clients read the same numbers
-- from the shared contract, so a disagreement here would refuse a file after its whole transfer.
-- The `private` schema is not readable by an authenticated caller, so these run as the owner.
select is(
  (select count(*)::int from unnest(private.chat_attachment_types()) as t
   where private.chat_attachment_max_bytes(t)
     <> case when t like 'image/%' or t like 'audio/%' then 10485760 else 20971520 end),
  0,
  'every allowed type carries the ceiling its kind has'
);

select is(
  (select private.chat_attachment_max_bytes('text/csv')),
  20971520::bigint,
  'a CSV shares the document ceiling rather than the picture one'
);

select is(
  (select private.chat_attachment_max_bytes('text/plain')),
  20971520::bigint,
  'a plain-text file shares the document ceiling'
);

select is(
  (select count(*)::int from public.chat_attachments
   where conversation_id = (select id from p2_conv) and status = 'attached'),
  0,
  'a pending upload is not visible in the thread'
);

-- Internal team chat --------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "b1000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select ok(
  (public.start_internal_chat(
    'internal_direct'::public.chat_conversation_type, null, 'Can you cover the refund queue?',
    array['b1000000-0000-4000-8000-000000000003']::uuid[], 'support'
  ) -> 'conversation' ->> 'id') is not null,
  'a staff member can open an internal conversation'
);

select is(
  (select count(*)::int from public.my_internal_channels(30, 0)),
  1,
  'the internal conversation appears in the staff member channel list'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "a1000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select throws_ok(
  $sql$select public.start_internal_chat(
    'internal_group'::public.chat_conversation_type, 'Ops', 'hello',
    array['b1000000-0000-4000-8000-000000000001']::uuid[], null
  )$sql$,
  'NZ403',
  null,
  'a customer cannot open an internal staff conversation'
);

-- Saved replies -------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "b1000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select public.save_chat_saved_reply(
  null, 'personal', 'Refund opening', 'The refund is being processed today.', '/refund', true
);

select is(
  (select count(*)::int from public.my_chat_saved_replies()),
  1,
  'a staff member sees their own saved reply'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "b1000000-0000-4000-8000-000000000003", "role": "authenticated"}';

select is(
  (select count(*)::int from public.my_chat_saved_replies()),
  0,
  'a personal saved reply is not offered to another staff member'
);

-- Moderator review queue ----------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "b1000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select throws_ok(
  $sql$select * from public.chat_report_queue('open'::public.chat_report_status, 20, 0)$sql$,
  'NZ403',
  null,
  'staff without the review permission cannot open the report queue'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "c1000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select is(
  (select count(*)::int from public.chat_report_queue('open'::public.chat_report_status, 20, 0)),
  0,
  'a moderator can open the review queue'
);

-- Analytics is a separate permission from the inbox.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "b1000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select throws_ok(
  $sql$select public.chat_analytics()$sql$,
  'NZ403',
  null,
  'a staff member without the analytics permission cannot read the report'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "b1000000-0000-4000-8000-000000000002", "role": "authenticated"}';

select is(
  (public.chat_analytics(now() - interval '2 days', now() + interval '1 day')
    -> 'conversations' ->> 'created')::int >= 1,
  true,
  'an admin sees the conversations created in the period'
);

select is(
  (public.chat_analytics(now() - interval '2 days', now() + interval '1 day')
    -> 'automation' ->> 'applied')::int,
  1,
  'the report counts the automation run that actually applied'
);

select is(
  (public.chat_analytics(now() - interval '2 days', now() + interval '1 day')
    -> 'satisfaction' ->> 'average'),
  '5.00',
  'the report averages the satisfaction ratings'
);

-- Right after the rule fired, the engine is inside the rule's cooldown, so a preview must say the
-- rule would be skipped (it used to say it would run).
select ok(
  (public.preview_chat_automation_rule(
    (select id from p2_rule_id), (select id from p2_conv)
  ) ->> 'wouldRun')::boolean = false,
  'previewing inside the cooldown reports that the rule would be skipped'
);
select ok(
  (public.preview_chat_automation_rule(
    (select id from p2_rule_id), (select id from p2_conv)
  ) -> 'reasons')::text like '%cooldown%',
  'the preview names the cooldown as the reason'
);

-- Once the earlier run is older than the cooldown, the same rule would run again.
reset role;
update public.chat_automation_runs set created_at = now() - interval '2 hours'
 where rule_id = (select id from p2_rule_id) and conversation_id = (select id from p2_conv);
set local role authenticated;
set local request.jwt.claims to '{"sub": "b1000000-0000-4000-8000-000000000002", "role": "authenticated"}';

select ok(
  (public.preview_chat_automation_rule(
    (select id from p2_rule_id), (select id from p2_conv)
  ) ->> 'wouldRun')::boolean = true,
  'previewing a rule against the conversation reports that it would run'
);

select * from finish();

rollback;
