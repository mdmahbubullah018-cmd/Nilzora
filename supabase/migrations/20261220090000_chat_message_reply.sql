-- Quoting a message from the file path
-- -----------------------------------
-- `send_chat_message` has taken a `p_reply_to_id` since the first chat migration, so a text
-- message could always answer another one. A message that carries files travels a different
-- route — `post_chat_message`, which stores the message and claims the uploads in one call — and
-- that function had no way to name the message it answers. A picture, a document or a voice note
-- could therefore never be a reply.
--
-- This adds the same argument and hands it to the 4th parameter `send_chat_message` already
-- exposes, so the existing rule applies unchanged: the quoted message must belong to the
-- conversation the new one is written into (NZ503 otherwise). Nothing else about posting changes.
--
-- `post_chat_message` is dropped rather than replaced because a new argument with a default
-- creates a second, overlapping signature; leaving the four-argument function in place would make
-- every four-argument call ambiguous. Nothing in the database calls this function (the API reaches
-- it through PostgREST), so the drop has no dependents. A dropped function comes back with
-- PostgreSQL's default grant to PUBLIC, so the revoke and grant are re-stated rather than assumed.

drop function public.post_chat_message(uuid, uuid, text, uuid[]);

create function public.post_chat_message(
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
  v_user uuid;
  v_ids uuid[] := coalesce(p_attachment_ids, array[]::uuid[]);
  v_body text := btrim(coalesce(p_body, ''));
  v_message record;
  v_files text;
begin
  if cardinality(v_ids) > 5 then
    raise exception 'a message may carry at most 5 attachments' using errcode = 'NZ412';
  end if;

  if cardinality(v_ids) > 0 then
    select string_agg(a.file_name, ', ' order by a.created_at) into v_files
    from public.chat_attachments a
    where a.id = any (v_ids)
      and a.conversation_id = p_conversation_id
      and a.status = 'pending';
    if v_files is null then
      raise exception 'attachment not found' using errcode = 'NZ519';
    end if;
  end if;

  if v_body = '' then
    if v_files is null then
      raise exception 'message too long' using errcode = 'NZ508';
    end if;
    v_body := v_files;
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

/*
 * The one line a quoted message shows
 * -----------------------------------
 * A reply quotes something that may sit on a page the reader never loaded, so a quote cannot be
 * resolved from the page alone. This answers the smallest set of facts a quote needs — who wrote
 * it, what kind of message it was, its text, and whether it carried a file — for messages in one
 * conversation the caller may read. A message that has been deleted answers with `deleted = true`
 * and no body, so quoting it degrades into "message unavailable" instead of disappearing.
 */
create function public.chat_message_summaries(p_conversation_id uuid, p_message_ids uuid[])
returns table (
  id uuid,
  seq bigint,
  sender_id uuid,
  sender_role public.chat_participant_role,
  sender_name text,
  kind public.chat_message_kind,
  body text,
  has_attachment boolean,
  deleted boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_read(p_conversation_id);
  v_ids uuid[] := coalesce(p_message_ids, array[]::uuid[]);
begin
  if cardinality(v_ids) = 0 then
    return;
  end if;
  if cardinality(v_ids) > 100 then
    raise exception 'ask for at most 100 messages' using errcode = 'NZ412';
  end if;

  return query
  select
    m.id,
    m.seq,
    m.sender_id,
    m.sender_role,
    p.full_name,
    m.kind,
    case when m.deleted_at is null then m.body end,
    exists (select 1 from public.chat_attachments a where a.message_id = m.id),
    m.deleted_at is not null,
    m.created_at
  from public.chat_messages m
  left join public.profiles p on p.id = m.sender_id
  where m.conversation_id = p_conversation_id
    and m.id = any (v_ids);
end;
$$;

revoke execute on function public.chat_message_summaries(uuid, uuid[]) from public, anon;
grant execute on function public.chat_message_summaries(uuid, uuid[]) to authenticated;
