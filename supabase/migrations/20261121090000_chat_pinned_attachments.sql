-- A pinned message carries its attachment context
-- ===============================================
-- `chat_pinned_messages` answered with the message body alone, so a pinned picture, recording or
-- document appeared as an empty line in the pinned strip. The attachment summary is derived from
-- `chat_attachments` — nothing is duplicated — and only the two fields a strip can render without
-- fetching bytes: the kind of file and its name (plus the length of a recording).
--
-- No object key and no URL are returned. A client renders a picture by asking
-- `GET /chat/attachments/<id>/media`, which authorizes the caller for the conversation first, so
-- a pinned attachment is exactly as private as it is in the thread.

-- The return type changes, so the function is replaced rather than re-declared in place.
drop function if exists public.chat_pinned_messages(uuid);

create function public.chat_pinned_messages(p_conversation_id uuid)
returns table (
  id uuid,
  body text,
  sender_name text,
  pinned_at timestamptz,
  pinned_by_name text,
  attachment_id uuid,
  attachment_name text,
  attachment_type text,
  attachment_duration_ms integer
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
  select
    m.id,
    m.body,
    s.full_name,
    m.pinned_at,
    p.full_name,
    a.id,
    a.file_name,
    a.content_type,
    a.duration_ms
  from public.chat_messages m
  left join public.profiles s on s.id = m.sender_id
  left join public.profiles p on p.id = m.pinned_by
  left join lateral (
    select att.id, att.file_name, att.content_type, att.duration_ms
    from public.chat_attachments att
    where att.message_id = m.id
      and att.status = 'attached'
    order by att.created_at
    limit 1
  ) a on true
  where m.conversation_id = p_conversation_id
    and m.pinned_at is not null
    and m.deleted_at is null
  order by m.pinned_at desc;
end;
$$;

comment on function public.chat_pinned_messages(uuid) is
  'Pinned messages of a thread with a safe summary of the first attached file, for the pinned strip.';

revoke execute on function public.chat_pinned_messages(uuid) from public, anon;
grant execute on function public.chat_pinned_messages(uuid) to authenticated;
