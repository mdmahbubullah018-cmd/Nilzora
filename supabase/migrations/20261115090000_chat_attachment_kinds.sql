-- ---------------------------------------------------------------------------
-- Chat attachments beyond pictures
--
-- Until now a message could carry a picture and nothing else: `chat_attachment_types()` listed
-- three image types and every row was capped at 10 MB. The composers now offer File Upload and a
-- voice message as well, so this widens exactly three things and nothing else:
--
--   * the allowlist gains the business documents (PDF, TXT, CSV, DOCX, XLSX) and the audio types
--     a browser or a phone actually records;
--   * the size ceiling becomes per kind — 20 MB for a document, 10 MB otherwise;
--   * a voice message records how long it runs, and every attachment answer now includes the
--     object key, because only the API knows the bucket's public address and it cannot build a
--     playable URL without it.
--
-- One function is replaced rather than redefined: `begin_chat_attachment` gains a defaulted
-- argument for the recording's length, and PostgreSQL cannot add an argument in place, so it is
-- dropped and created again with the same body plus the new column — its grants are restated in
-- the same breath. No existing row changes meaning: every value the old checks accepted is still
-- accepted, so every existing attachment stays valid. The API enforces the same numbers
-- (packages/contracts/src/chat-media.ts) and checks each file's own signature, so the database
-- still refuses a type it was not told about even if a client invents a Content-Type.
--
-- Status: PENDING. It has not been applied to any database.
-- ---------------------------------------------------------------------------

-- The kinds a message may carry. Kept a function, as the picture-only version was, so the RPC
-- and any future check read one list.
create or replace function private.chat_attachment_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    -- pictures: the API decodes these, turns them upright, strips metadata and re-encodes as WebP
    'image/jpeg', 'image/png', 'image/webp',
    -- business documents: stored exactly as sent, checked by signature in the API
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    -- voice messages: stored exactly as sent
    'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'
  ]::text[];
$$;

/** The largest a single attachment of one type may be: 20 MB for a document, else 10 MB. */
create or replace function private.chat_attachment_max_bytes(p_content_type text)
returns bigint
language sql
immutable
set search_path = ''
as $$
  -- Every one of the five document types is listed: PDF, plain text and CSV share the document
  -- ceiling with the two Office formats, which is what the API and both clients enforce. Leaving
  -- text/plain and text/csv to the fallback refused a 12 MB CSV the rest of the system allows.
  select case
    when lower(btrim(coalesce(p_content_type, ''))) in (
      'application/pdf',
      'text/plain',
      'text/csv',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ) then 20971520
    else 10485760
  end::bigint;
$$;

-- A voice message records how long it runs, so its player can show the length before the audio
-- has loaded. Null for every other kind, and the ceiling matches the API's five-minute rule.
alter table public.chat_attachments
  add column if not exists duration_ms integer
    check (duration_ms is null or duration_ms between 1 and 300000);

-- The table's own 10 MB check would refuse a 20 MB PDF the RPC now accepts, so it becomes a
-- backstop at the largest value any kind allows. The RPC stays the authority per kind.
alter table public.chat_attachments
  drop constraint if exists chat_attachments_byte_size_check;
alter table public.chat_attachments
  add constraint chat_attachments_byte_size_check
    check (byte_size > 0 and byte_size <= 20971520);

/**
 * Records an upload the API has already stored under `chat/<conversation id>/`. The signature
 * grows by the recording's length: a voice message carries how long it runs, which is what its
 * player shows before the audio has loaded. The extra argument has a default, so a caller that
 * does not send it keeps working.
 */
drop function if exists public.begin_chat_attachment(uuid, text, text, text, bigint, integer, integer);

create function public.begin_chat_attachment(
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
    and a.status = 'pending';
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

-- A function that is dropped and created again comes back with PostgreSQL's default grant to
-- PUBLIC, so the revokes the applied migration stated are restated here.
revoke execute on function public.begin_chat_attachment(uuid, text, text, text, bigint, integer, integer, integer) from public, anon;
grant execute on function public.begin_chat_attachment(uuid, text, text, text, bigint, integer, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- The answers that carry an object key
--
-- A client cannot build a public URL: only the API knows the bucket's address and only the API
-- validates a key before turning it into one. Both functions below therefore include `objectKey`
-- (and a voice message's `durationMs`), which the API resolves into `url`/`thumbnailUrl` before
-- the answer leaves the server. A picture is stored as `<key>/full.webp` and `<key>/thumb.webp`,
-- so the key returned is the base one.
-- ---------------------------------------------------------------------------

/** The attachments of one conversation, oldest first, as the thread renders them. */
-- Its column list grows by `duration_ms` and `object_key`, and PostgreSQL cannot change the
-- return type of an existing function, so it is replaced rather than redefined. Nothing depends
-- on it but the API (it is an RPC, not a view), and the grants are restored immediately below.
drop function if exists public.chat_attachments(uuid);

create function public.chat_attachments(p_conversation_id uuid)
returns table (
  id uuid,
  message_id uuid,
  file_name text,
  content_type text,
  byte_size bigint,
  width integer,
  height integer,
  duration_ms integer,
  object_key text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_read(p_conversation_id);
begin
  return query
  select a.id, a.message_id, a.file_name, a.content_type, a.byte_size, a.width, a.height,
         a.duration_ms, a.object_key, a.created_at
  from public.chat_attachments a
  where a.conversation_id = p_conversation_id
    and a.status = 'attached'
  order by a.attached_at, a.id;
end;
$$;

-- A dropped function comes back with PostgreSQL's default grant to PUBLIC, so the revokes
-- that the original carried are re-stated here rather than assumed.
revoke execute on function public.chat_attachments(uuid) from public, anon;
grant execute on function public.chat_attachments(uuid) to authenticated;

revoke execute on function public.post_chat_message(uuid, uuid, text, uuid[]) from public, anon;
grant execute on function public.post_chat_message(uuid, uuid, text, uuid[]) to authenticated;

create or replace function public.post_chat_message(
  p_conversation_id uuid,
  p_client_message_id uuid,
  p_body text,
  p_attachment_ids uuid[] default null
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

  select * into v_message
  from public.send_chat_message(p_conversation_id, p_client_message_id, v_body, null) as m;

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
