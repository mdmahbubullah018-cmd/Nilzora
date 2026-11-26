-- Chat delivery fixes (20261225090000_chat_delivery_fixes.sql): posting a message with files,
-- the idempotent retry, quoted replies, the pending-upload cap, message feedback and reactions.
-- Runs inside a transaction that is rolled back, so it leaves no data behind.

begin;

create extension if not exists pgtap with schema extensions;

select plan(33);

-- Fixtures ------------------------------------------------------------------
insert into public.profiles (id, email, full_name, status) values
  ('a2a2a2a2-0000-4000-8000-000000000001', 'deliv-cust1@example.com', 'Delivery Customer One', 'active'),
  ('a2a2a2a2-0000-4000-8000-000000000002', 'deliv-cust2@example.com', 'Delivery Customer Two', 'active'),
  ('b2b2b2b2-0000-4000-8000-000000000001', 'deliv-staff@example.com', 'Delivery Staff', 'active');

insert into public.user_roles (user_id, role) values
  ('a2a2a2a2-0000-4000-8000-000000000001', 'customer'),
  ('a2a2a2a2-0000-4000-8000-000000000002', 'customer'),
  ('b2b2b2b2-0000-4000-8000-000000000001', 'staff');

-- conversation A: customer one, open; B: customer two, open; R and R2: resolved threads.
insert into public.chat_conversations (id, kind, status, priority, subject, customer_id)
values
  ('d2d2d2d2-0000-4000-8000-00000000000a', 'customer_support', 'open', 'normal',
   'Delivery A', 'a2a2a2a2-0000-4000-8000-000000000001'),
  ('d2d2d2d2-0000-4000-8000-00000000000b', 'customer_support', 'open', 'normal',
   'Delivery B', 'a2a2a2a2-0000-4000-8000-000000000002'),
  ('d2d2d2d2-0000-4000-8000-0000000000e1', 'customer_support', 'resolved', 'normal',
   'Delivery resolved one', 'a2a2a2a2-0000-4000-8000-000000000001'),
  ('d2d2d2d2-0000-4000-8000-0000000000e2', 'customer_support', 'resolved', 'normal',
   'Delivery resolved two', 'a2a2a2a2-0000-4000-8000-000000000002');

insert into public.chat_conversation_participants (conversation_id, user_id, role) values
  ('d2d2d2d2-0000-4000-8000-00000000000a', 'a2a2a2a2-0000-4000-8000-000000000001', 'customer'),
  ('d2d2d2d2-0000-4000-8000-00000000000b', 'a2a2a2a2-0000-4000-8000-000000000002', 'customer');

-- A support reply in each thread (what a customer quotes, reacts to or rates).
insert into public.chat_messages (id, conversation_id, sender_id, sender_role, kind, body) values
  ('e2e2e2e2-0000-4000-8000-00000000000a', 'd2d2d2d2-0000-4000-8000-00000000000a',
   'b2b2b2b2-0000-4000-8000-000000000001', 'staff', 'text', 'Reply in A'),
  ('e2e2e2e2-0000-4000-8000-00000000000b', 'd2d2d2d2-0000-4000-8000-00000000000b',
   'b2b2b2b2-0000-4000-8000-000000000001', 'staff', 'text', 'Reply in B'),
  ('e2e2e2e2-0000-4000-8000-0000000000e1', 'd2d2d2d2-0000-4000-8000-0000000000e1',
   'b2b2b2b2-0000-4000-8000-000000000001', 'staff', 'text', 'Reply in resolved one'),
  ('e2e2e2e2-0000-4000-8000-0000000000e2', 'd2d2d2d2-0000-4000-8000-0000000000e2',
   'b2b2b2b2-0000-4000-8000-000000000001', 'staff', 'text', 'Reply in resolved two');

-- Five abandoned uploads, an hour old, that used to hold every slot of customer one for good.
insert into public.chat_attachments (
  conversation_id, uploader_id, object_key, file_name, content_type, byte_size, status, created_at
)
select 'd2d2d2d2-0000-4000-8000-00000000000a', 'a2a2a2a2-0000-4000-8000-000000000001',
       'chat/d2d2d2d2-0000-4000-8000-00000000000a/orphan-' || n, 'orphan-' || n || '.pdf',
       'application/pdf', 100, 'pending', now() - interval '1 hour'
from generate_series(1, 5) as n;

-- A customer cannot read these tables directly, so the checks below read them through this
-- test-only helper (created inside the rolled-back transaction).
create function public.deliv_scalar(p_sql text) returns text
language plpgsql security definer set search_path = '' as $f$
declare v text;
begin
  execute p_sql into v;
  return v;
end;
$f$;
grant execute on function public.deliv_scalar(text) to authenticated;

set local role authenticated;
set local request.jwt.claims to '{"sub": "a2a2a2a2-0000-4000-8000-000000000001", "role": "authenticated"}';

-- The cap ignores abandoned uploads --------------------------------------------
select lives_ok(
  $$ select public.begin_chat_attachment(
       'd2d2d2d2-0000-4000-8000-00000000000a',
       'chat/d2d2d2d2-0000-4000-8000-00000000000a/fresh-1/full.webp',
       'fresh-1.webp', 'image/webp', 2048, 800, 600) $$,
  'five hour-old orphans do not block a new upload'
);
select is(
  public.deliv_scalar($q$ select count(*) from public.chat_attachments where file_name = 'fresh-1.webp' $q$)::int,
  1,
  'the new upload is stored'
);

-- Posting with a file ---------------------------------------------------------
create temporary table delivery_probe (name text primary key, id uuid) on commit drop;
grant all on delivery_probe to authenticated;
insert into delivery_probe
  select 'fresh-1', public.deliv_scalar($q$ select id from public.chat_attachments where file_name = 'fresh-1.webp' $q$)::uuid;

select is(
  jsonb_array_length(
    public.post_chat_message(
      'd2d2d2d2-0000-4000-8000-00000000000a',
      '11111111-0000-4000-8000-000000000001',
      'Here is the photo',
      array[(select id from delivery_probe where name = 'fresh-1')]
    ) -> 'attachments'
  ),
  1,
  'a message posts with its attachment (a uuid[] argument)'
);
select is(
  public.deliv_scalar($q$ select status::text from public.chat_attachments where file_name = 'fresh-1.webp' $q$),
  'attached',
  'the upload is claimed by the message'
);

-- Idempotent retry -------------------------------------------------------------
select is(
  (select (public.post_chat_message(
      'd2d2d2d2-0000-4000-8000-00000000000a',
      '11111111-0000-4000-8000-000000000001',
      'Here is the photo',
      array[(select id from delivery_probe where name = 'fresh-1')]
    ) ->> 'duplicate')::boolean),
  true,
  'the same client id with the same files answers as a duplicate instead of failing'
);
select is(
  jsonb_array_length(
    public.post_chat_message(
      'd2d2d2d2-0000-4000-8000-00000000000a',
      '11111111-0000-4000-8000-000000000001',
      null,
      null
    ) -> 'attachments'
  ),
  1,
  'a retry that no longer names the files still answers with the stored message and its files'
);
select is(
  public.deliv_scalar($q$ select count(*) from public.chat_messages
   where client_message_id = '11111111-0000-4000-8000-000000000001' $q$)::int,
  1,
  'the retried send stored exactly one message'
);

-- Attachments that cannot be used get their own error, not the pending-cap code -----
select throws_ok(
  $$ select public.post_chat_message(
       'd2d2d2d2-0000-4000-8000-00000000000a',
       '11111111-0000-4000-8000-000000000002', 'Ghost',
       array['99999999-0000-4000-8000-000000000009']::uuid[]) $$,
  'NZ525', null,
  'an attachment that does not exist is refused with NZ525'
);
select throws_ok(
  format($$ select public.post_chat_message(
       'd2d2d2d2-0000-4000-8000-00000000000a',
       '11111111-0000-4000-8000-000000000003', 'Again',
       array[%L]::uuid[]) $$, (select id from delivery_probe where name = 'fresh-1')),
  'NZ525', null,
  'an attachment already claimed by a message is refused with NZ525'
);
select is(
  public.deliv_scalar($q$ select count(*) from public.chat_messages
   where client_message_id in ('11111111-0000-4000-8000-000000000002',
                               '11111111-0000-4000-8000-000000000003') $q$)::int,
  0,
  'a refused attachment stores no message'
);

-- Another customer's pending upload --------------------------------------------
set local request.jwt.claims to '{"sub": "a2a2a2a2-0000-4000-8000-000000000002", "role": "authenticated"}';
select lives_ok(
  $$ select public.begin_chat_attachment(
       'd2d2d2d2-0000-4000-8000-00000000000b',
       'chat/d2d2d2d2-0000-4000-8000-00000000000b/theirs/full.webp',
       'theirs.webp', 'image/webp', 2048, 800, 600) $$,
  'customer two reserves an upload in their own thread'
);
insert into delivery_probe
  select 'theirs', public.deliv_scalar($q$ select id from public.chat_attachments where file_name = 'theirs.webp' $q$)::uuid;

set local request.jwt.claims to '{"sub": "a2a2a2a2-0000-4000-8000-000000000001", "role": "authenticated"}';
select throws_ok(
  format($$ select public.post_chat_message(
       'd2d2d2d2-0000-4000-8000-00000000000a',
       '11111111-0000-4000-8000-000000000004', 'Not mine',
       array[%L]::uuid[]) $$, (select id from delivery_probe where name = 'theirs')),
  'NZ525', null,
  'an upload that belongs to another customer cannot be attached'
);

-- Quoting a message with files (p_reply_to_id) -----------------------------------
select lives_ok(
  $$ select public.begin_chat_attachment(
       'd2d2d2d2-0000-4000-8000-00000000000a',
       'chat/d2d2d2d2-0000-4000-8000-00000000000a/fresh-2/full.webp',
       'fresh-2.webp', 'image/webp', 2048, 800, 600) $$,
  'a second upload is reserved'
);
insert into delivery_probe
  select 'fresh-2', public.deliv_scalar($q$ select id from public.chat_attachments where file_name = 'fresh-2.webp' $q$)::uuid;
select is(
  public.post_chat_message(
    'd2d2d2d2-0000-4000-8000-00000000000a',
    '11111111-0000-4000-8000-000000000005',
    'Quoting you',
    array[(select id from delivery_probe where name = 'fresh-2')],
    'e2e2e2e2-0000-4000-8000-00000000000a'
  ) -> 'message' ->> 'replyToId',
  'e2e2e2e2-0000-4000-8000-00000000000a',
  'a message with a file quotes the message it answers'
);
select is(
  (select count(*)::int from public.chat_message_summaries(
     'd2d2d2d2-0000-4000-8000-00000000000a',
     array['e2e2e2e2-0000-4000-8000-00000000000a']::uuid[])),
  1,
  'the quote resolves through a uuid[] argument'
);
select throws_ok(
  $$ select public.post_chat_message(
       'd2d2d2d2-0000-4000-8000-00000000000a',
       '11111111-0000-4000-8000-000000000006', 'Quoting another thread', null,
       'e2e2e2e2-0000-4000-8000-00000000000b') $$,
  'NZ503', null,
  'a quote from another conversation is refused'
);

-- The pending cap still holds for fresh uploads --------------------------------
select lives_ok(
  $$ select public.begin_chat_attachment('d2d2d2d2-0000-4000-8000-00000000000a',
       'chat/d2d2d2d2-0000-4000-8000-00000000000a/p1/full.webp', 'p1.webp', 'image/webp', 100, 20, 20),
     public.begin_chat_attachment('d2d2d2d2-0000-4000-8000-00000000000a',
       'chat/d2d2d2d2-0000-4000-8000-00000000000a/p2/full.webp', 'p2.webp', 'image/webp', 100, 20, 20),
     public.begin_chat_attachment('d2d2d2d2-0000-4000-8000-00000000000a',
       'chat/d2d2d2d2-0000-4000-8000-00000000000a/p3/full.webp', 'p3.webp', 'image/webp', 100, 20, 20),
     public.begin_chat_attachment('d2d2d2d2-0000-4000-8000-00000000000a',
       'chat/d2d2d2d2-0000-4000-8000-00000000000a/p4/full.webp', 'p4.webp', 'image/webp', 100, 20, 20),
     public.begin_chat_attachment('d2d2d2d2-0000-4000-8000-00000000000a',
       'chat/d2d2d2d2-0000-4000-8000-00000000000a/p5/full.webp', 'p5.webp', 'image/webp', 100, 20, 20) $$,
  'five fresh uploads can wait'
);
select throws_ok(
  $$ select public.begin_chat_attachment('d2d2d2d2-0000-4000-8000-00000000000a',
       'chat/d2d2d2d2-0000-4000-8000-00000000000a/p6/full.webp', 'p6.webp', 'image/webp', 100, 20, 20) $$,
  'NZ519', null,
  'a sixth fresh pending upload is refused'
);
select throws_ok(
  $$ select public.discard_chat_attachment('99999999-0000-4000-8000-000000000009') $$,
  'NZ525', null,
  'discarding an upload that is not there is NZ525'
);

-- Message feedback --------------------------------------------------------------
select throws_ok(
  $$ select public.submit_chat_message_feedback(
       'e2e2e2e2-0000-4000-8000-00000000000a', 'helpful', 'too early') $$,
  'NZ520', null,
  'feedback on an open conversation is refused'
);
select is(
  public.submit_chat_message_feedback(
    'e2e2e2e2-0000-4000-8000-0000000000e1', 'helpful', 'It worked') ->> 'verdict',
  'helpful',
  'feedback on a resolved conversation is stored'
);
select is(
  public.submit_chat_message_feedback(
    'e2e2e2e2-0000-4000-8000-0000000000e1', 'not_helpful', 'Changed my mind') ->> 'verdict',
  'helpful',
  'a second submission returns the first verdict'
);
select is(
  public.deliv_scalar($q$ select comment from public.chat_message_feedback
   where message_id = 'e2e2e2e2-0000-4000-8000-0000000000e1' $q$),
  'It worked',
  'the stored comment is the first one'
);
select throws_ok(
  $$ select public.submit_chat_message_feedback(
       'e2e2e2e2-0000-4000-8000-0000000000e2', 'helpful', null) $$,
  'NZ503', null,
  'feedback on another customer''s message is refused'
);

-- The customer reads their own verdicts, and only those ------------------------------
set local request.jwt.claims to '{"sub": "a2a2a2a2-0000-4000-8000-000000000002", "role": "authenticated"}';
select is(
  public.submit_chat_message_feedback(
    'e2e2e2e2-0000-4000-8000-0000000000e2', 'not_helpful', 'Private note') ->> 'verdict',
  'not_helpful',
  'customer two rates their own resolved thread'
);
select throws_ok(
  $$ select * from public.chat_my_message_feedback('d2d2d2d2-0000-4000-8000-0000000000e1') $$,
  'NZ501', null,
  'another customer''s thread cannot be read'
);
set local request.jwt.claims to '{"sub": "a2a2a2a2-0000-4000-8000-000000000001", "role": "authenticated"}';
select is(
  (select string_agg(f.message_id::text || ':' || f.verdict::text, ',')
   from public.chat_my_message_feedback('d2d2d2d2-0000-4000-8000-0000000000e1') f),
  'e2e2e2e2-0000-4000-8000-0000000000e1:helpful',
  'a customer reads only their own verdicts, without comments'
);
set local request.jwt.claims to '{"sub": "b2b2b2b2-0000-4000-8000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$ select * from public.chat_my_message_feedback('d2d2d2d2-0000-4000-8000-0000000000e1') $$,
  'NZ501', null,
  'staff who cannot read the thread are refused, and never see its verdicts'
);

-- Reactions ------------------------------------------------------------------------
set local request.jwt.claims to '{"sub": "a2a2a2a2-0000-4000-8000-000000000001", "role": "authenticated"}';
select is(
  (public.toggle_chat_message_reaction('e2e2e2e2-0000-4000-8000-00000000000a', 'thumbs_up') ->> 'added')::boolean,
  true,
  'a reaction is added'
);
select is(
  public.toggle_chat_message_reaction('e2e2e2e2-0000-4000-8000-00000000000a', 'heart') -> 'summary' -> 0 ->> 'emoji',
  'heart',
  'choosing another emoji changes the reaction'
);
select is(
  public.deliv_scalar($q$ select count(*) from public.chat_message_reactions
   where message_id = 'e2e2e2e2-0000-4000-8000-00000000000a' $q$)::int,
  1,
  'a person holds one reaction per message'
);
select is(
  (public.toggle_chat_message_reaction('e2e2e2e2-0000-4000-8000-00000000000a', 'heart') ->> 'added')::boolean,
  false,
  'the same emoji again removes it'
);
set local request.jwt.claims to '{"sub": "a2a2a2a2-0000-4000-8000-000000000002", "role": "authenticated"}';
select throws_ok(
  $$ select public.toggle_chat_message_reaction('e2e2e2e2-0000-4000-8000-00000000000a', 'heart') $$,
  'NZ501', null,
  'another customer cannot react in a conversation they cannot read'
);

select * from finish();

rollback;
