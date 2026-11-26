-- Chat delivery fixes (local first; the owner applies it to the hosted project later)
-- ====================================================================================
-- 1. `post_chat_message` is idempotent on `client_message_id`: a send whose response was lost and
--    is retried returns the message already stored, with its files, instead of failing because the
--    uploads were already claimed (it used to answer NZ519) or storing it twice. It also refuses
--    an attachment that is missing, not the caller's, or no longer pending with its own code,
--    NZ525, instead of reusing NZ519, which means "too many pending uploads".
-- 2. `begin_chat_attachment` counts only pending uploads younger than 30 minutes towards its cap
--    of five, so abandoned uploads cannot lock a customer out of attaching files.
-- 3. `discard_chat_attachment` answers NZ525 for an upload that is not there to discard.
-- 4. `submit_chat_message_feedback` refuses a thread that is not resolved or closed (NZ520) and
--    keeps the FIRST verdict: a later submission returns the stored row unchanged.
-- 5. `chat_my_message_feedback` lets a customer read their own verdicts (no comments, nobody
--    else's) so the "was this helpful?" prompt stays hidden across reloads and devices.
--
-- Every function keeps its signature, so `create or replace` keeps its grants; they are restated.

-- ---------------------------------------------------------------------------
-- 1. Posting a message with files
-- ---------------------------------------------------------------------------

create or replace function public.post_chat_message(
  p_conversation_id uuid,
  p_client_message_id uuid,
  p_body text,
  p_attachment_ids uuid[] default null,
  p_reply_to_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_user uuid;
  v_ids uuid[];
  v_body text := btrim(coalesce(p_body, ''));
  v_message record;
  v_files text;
  v_found integer;
  v_stored public.chat_messages;
begin
  if v_caller is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;

  -- A retried send: the message is already stored for this sender. It is answered as a duplicate
  -- before anything about the uploads is checked, because they were claimed the first time.
  if p_client_message_id is not null then
    select * into v_stored
    from public.chat_messages m
    where m.conversation_id = p_conversation_id
      and m.client_message_id = p_client_message_id
      and m.sender_id = v_caller;
  end if;

  if v_stored.id is not null then
    v_ids := array[]::uuid[];
    v_body := v_stored.body;
  else
    select coalesce(array_agg(distinct x), array[]::uuid[]) into v_ids
    from unnest(coalesce(p_attachment_ids, array[]::uuid[])) as x
    where x is not null;

    if cardinality(v_ids) > 5 then
      raise exception 'a message may carry at most 5 attachments' using errcode = 'NZ412';
    end if;

    if cardinality(v_ids) > 0 then
      select string_agg(a.file_name, ', ' order by a.created_at), count(*)::integer
        into v_files, v_found
      from public.chat_attachments a
      where a.id = any (v_ids)
        and a.conversation_id = p_conversation_id
        and a.uploader_id = v_caller
        and a.status = 'pending';
      if v_found is distinct from cardinality(v_ids) then
        raise exception 'attachment not found' using errcode = 'NZ525';
      end if;
    end if;

    if v_body = '' then
      if v_files is null then
        raise exception 'message too long' using errcode = 'NZ508';
      end if;
      v_body := v_files;
    end if;
  end if;

  -- The quoted message is validated by `send_chat_message`: it must belong to this conversation.
  select * into v_message
  from public.send_chat_message(
    p_conversation_id, p_client_message_id, v_body, p_reply_to_id
  ) as m;

  if v_message.id is null then
    raise exception 'message not stored' using errcode = 'NZ503';
  end if;

  v_user := v_message.sender_id;

  if cardinality(v_ids) > 0 then
    update public.chat_attachments a
    set message_id = v_message.id,
        status = 'attached',
        attached_at = now()
    where a.id = any (v_ids)
      and a.conversation_id = p_conversation_id
      and a.uploader_id = v_user
      and a.status = 'pending';
  end if;

  return jsonb_build_object(
    'message', jsonb_build_object(
      'id', v_message.id,
      'seq', v_message.seq,
      'senderId', v_message.sender_id,
      'senderRole', v_message.sender_role,
      'senderName', v_message.sender_name,
      'kind', v_message.kind,
      'body', v_message.body,
      'replyToId', v_message.reply_to_id,
      'metadata', v_message.metadata,
      'createdAt', v_message.created_at
    ),
    'duplicate', v_message.duplicate,
    'unreadCount', v_message.unread_count,
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'fileName', a.file_name,
        'contentType', a.content_type,
        'byteSize', a.byte_size,
        'width', a.width,
        'height', a.height,
        'durationMs', a.duration_ms,
        'objectKey', a.object_key
      ) order by a.created_at)
      from public.chat_attachments a
      where a.message_id = v_message.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.post_chat_message(uuid, uuid, text, uuid[], uuid) from public, anon;
grant execute on function public.post_chat_message(uuid, uuid, text, uuid[], uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The pending-upload cap
-- ---------------------------------------------------------------------------

create or replace function public.begin_chat_attachment(
  p_conversation_id uuid,
  p_object_key text,
  p_file_name text,
  p_content_type text,
  p_byte_size bigint,
  p_width integer default null,
  p_height integer default null,
  p_duration_ms integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_read(p_conversation_id);
  v_type text := lower(btrim(coalesce(p_content_type, '')));
  v_key text := btrim(coalesce(p_object_key, ''));
  v_limit bigint;
  v_pending integer;
  v_row public.chat_attachments;
begin
  if not private.chat_can_reply(v_user, p_conversation_id) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;
  if v_type <> all (private.chat_attachment_types()) then
    raise exception 'unsupported attachment type' using errcode = 'NZ516';
  end if;
  v_limit := private.chat_attachment_max_bytes(v_type);
  if p_byte_size is null or p_byte_size <= 0 or p_byte_size > v_limit then
    raise exception 'attachment is larger than the limit for its type' using errcode = 'NZ517';
  end if;
  if p_file_name is null or char_length(btrim(p_file_name)) not between 1 and 200 then
    raise exception 'file name must be 1-200 characters' using errcode = 'NZ412';
  end if;
  -- A length belongs to a recording. Anything else that arrives with one is refused rather than
  -- silently storing a number that means nothing.
  if p_duration_ms is not null then
    if v_type not like 'audio/%' then
      raise exception 'only a voice message carries a duration' using errcode = 'NZ524';
    end if;
    if p_duration_ms not between 1 and 300000 then
      raise exception 'voice message must be 1-300000 milliseconds' using errcode = 'NZ524';
    end if;
  end if;
  -- The key is scoped to this conversation. A key that escapes the prefix is refused here rather
  -- than trusted because the client asked for it.
  if v_key = '' or position('chat/' || p_conversation_id::text || '/' in v_key) <> 1 then
    raise exception 'attachment key must stay inside the conversation prefix' using errcode = 'NZ518';
  end if;

  select count(*) into v_pending
  from public.chat_attachments a
  where a.conversation_id = p_conversation_id
    and a.uploader_id = v_user
    and a.status = 'pending'
    -- An upload that was never attached is abandoned after half an hour: it must not hold a
    -- slot forever, or a few orphaned files would block this person's uploads for good.
    and a.created_at > now() - interval '30 minutes';
  if v_pending >= 5 then
    raise exception 'too many pending attachments' using errcode = 'NZ519';
  end if;

  insert into public.chat_attachments (
    conversation_id, uploader_id, object_key, file_name, content_type, byte_size, width, height,
    duration_ms
  ) values (
    p_conversation_id, v_user, v_key, btrim(p_file_name), v_type, p_byte_size, p_width, p_height,
    p_duration_ms
  )
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'conversationId', v_row.conversation_id,
    'objectKey', v_row.object_key,
    'fileName', v_row.file_name,
    'contentType', v_row.content_type,
    'byteSize', v_row.byte_size,
    'width', v_row.width,
    'height', v_row.height,
    'durationMs', v_row.duration_ms,
    'status', v_row.status
  );
end;
$$;

revoke execute on function public.begin_chat_attachment(uuid, text, text, text, bigint, integer, integer, integer) from public, anon;
grant execute on function public.begin_chat_attachment(uuid, text, text, text, bigint, integer, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Discarding an upload that is not there
-- ---------------------------------------------------------------------------

create or replace function public.discard_chat_attachment(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  update public.chat_attachments a
  set status = 'discarded'
  where a.id = p_id and a.uploader_id = v_user and a.status = 'pending';
  if not found then
    raise exception 'attachment not found' using errcode = 'NZ525';
  end if;
end;
$$;

revoke execute on function public.discard_chat_attachment(uuid) from public, anon;
grant execute on function public.discard_chat_attachment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Message feedback: only once the thread is resolved, and the first verdict stands
-- ---------------------------------------------------------------------------

create or replace function public.submit_chat_message_feedback(
  p_message_id uuid,
  p_verdict public.chat_feedback_verdict,
  p_comment text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_message public.chat_messages;
  v_conversation public.chat_conversations;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_row public.chat_message_feedback;
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  if p_verdict is null then
    raise exception 'choose helpful or not helpful' using errcode = 'NZ412';
  end if;
  if v_comment is not null and char_length(v_comment) > 500 then
    raise exception 'comment too long' using errcode = 'NZ412';
  end if;

  select * into v_message from public.chat_messages m where m.id = p_message_id;
  if v_message.id is null or v_message.deleted_at is not null then
    raise exception 'message not found' using errcode = 'NZ503';
  end if;

  select * into v_conversation
  from public.chat_conversations c where c.id = v_message.conversation_id;
  -- Only the customer whose conversation this is may judge it.
  if v_conversation.id is null or v_conversation.customer_id is distinct from v_user then
    raise exception 'message not found' using errcode = 'NZ503';
  end if;

  -- A customer cannot rate their own words, and a system line is not an answer.
  if v_message.sender_id = v_user or v_message.kind = 'system' then
    raise exception 'this message cannot be rated' using errcode = 'NZ412';
  end if;

  -- Feedback is asked for when the thread has ended, not while it is being worked.
  if v_conversation.status not in ('resolved', 'closed') then
    raise exception 'conversation is still open' using errcode = 'NZ520';
  end if;

  -- The first verdict stands; a second submission answers with the stored row.
  insert into public.chat_message_feedback as f
    (message_id, conversation_id, customer_id, verdict, comment)
  values (p_message_id, v_message.conversation_id, v_user, p_verdict, v_comment)
  on conflict (message_id, customer_id) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row
    from public.chat_message_feedback f
    where f.message_id = p_message_id and f.customer_id = v_user;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'messageId', v_row.message_id,
    'verdict', v_row.verdict,
    'comment', v_row.comment,
    'createdAt', v_row.created_at,
    'updatedAt', v_row.updated_at
  );
end;
$$;

revoke execute on function public.submit_chat_message_feedback(uuid, public.chat_feedback_verdict, text)
  from public, anon;
grant execute on function public.submit_chat_message_feedback(uuid, public.chat_feedback_verdict, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5. A customer's own verdicts in one thread
-- ---------------------------------------------------------------------------

create function public.chat_my_message_feedback(p_conversation_id uuid)
returns table (message_id uuid, verdict public.chat_feedback_verdict)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_read(p_conversation_id);
begin
  -- Rows are the caller's own (the same rule as the table's own_read policy), in a thread the
  -- caller may read. No comment and no other customer's verdict leaves this function.
  return query
  select f.message_id, f.verdict
  from public.chat_message_feedback f
  where f.conversation_id = p_conversation_id
    and f.customer_id = v_user
  order by f.created_at;
end;
$$;

comment on function public.chat_my_message_feedback(uuid) is
  'The caller''s own helpful / not-helpful verdicts in one thread they may read.';

revoke execute on function public.chat_my_message_feedback(uuid) from public, anon;
grant execute on function public.chat_my_message_feedback(uuid) to authenticated;
