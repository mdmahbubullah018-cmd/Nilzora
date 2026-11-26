-- Private chat media and one reaction per person
-- ================================================
-- Two corrections to the messaging schema, both forward-only:
--
-- 1. Customer support media must not be readable by anyone who happens to hold a URL. Chat
--    attachments are now resolved through `public.chat_attachment_media(uuid)`, which answers
--    only to an account that may read the parent conversation, and only for an attachment that
--    is attached to a message in that thread. The API streams the object with this answer; the
--    object key never leaves the server. The public bucket base stays in use for shopfront
--    media (products, categories, brands, banners), which is public by design.
--
-- 2. The reactions table documented "one emoji per person per message" but its key allowed one
--    row per emoji, so a person could hold several reactions at once. The key becomes
--    (message_id, user_id); existing duplicates are reconciled deterministically, keeping the
--    newest reaction and dropping the older ones, before the constraint is replaced.

-- ---------------------------------------------------------------------------
-- 1. Authorized chat media
-- ---------------------------------------------------------------------------

/*
 * Resolves one attachment to the object the server must stream.
 *
 * The caller is the account asking; the answer is the same "conversation not found" for a
 * thread they may not read as for one that does not exist, so an id cannot be probed. Only
 * attached attachments resolve: a pending upload that no message carries is invisible, and a
 * deleted message takes its files with it.
 */
create or replace function public.chat_attachment_media(p_attachment_id uuid)
returns table (
  attachment_id uuid,
  conversation_id uuid,
  object_key text,
  content_type text,
  file_name text,
  byte_size bigint,
  message_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.chat_attachments;
  v_message public.chat_messages;
begin
  if p_attachment_id is null then
    raise exception 'attachment not found' using errcode = 'NZ503';
  end if;

  select * into v_row from public.chat_attachments a where a.id = p_attachment_id;
  if v_row.id is null or v_row.message_id is null or v_row.status <> 'attached' then
    raise exception 'attachment not found' using errcode = 'NZ503';
  end if;

  -- Trusted authorization: the database decides, never a header or a client value.
  perform private.chat_require_read(v_row.conversation_id);

  select * into v_message from public.chat_messages m where m.id = v_row.message_id;
  if v_message.id is null or v_message.deleted_at is not null then
    raise exception 'attachment not found' using errcode = 'NZ503';
  end if;

  return query
  select v_row.id, v_row.conversation_id, v_row.object_key, v_row.content_type,
         v_row.file_name, v_row.byte_size, v_row.message_id;
end;
$$;

comment on function public.chat_attachment_media(uuid) is
  'The private object behind one attached chat file, for an account that may read its conversation.';

revoke execute on function public.chat_attachment_media(uuid) from public, anon;
grant execute on function public.chat_attachment_media(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. One reaction per person per message
-- ---------------------------------------------------------------------------

-- Deterministic reconciliation: keep the newest reaction per (message, person). Ties on the
-- timestamp are broken by the emoji so the same data always produces the same survivor.
delete from public.chat_message_reactions r
using (
  select message_id, user_id,
         row_number() over (
           partition by message_id, user_id
           order by created_at desc, emoji collate "C" desc
         ) as position
  from public.chat_message_reactions
) duplicate
where r.message_id = duplicate.message_id
  and r.user_id = duplicate.user_id
  and duplicate.position > 1;

alter table public.chat_message_reactions
  drop constraint if exists chat_message_reactions_pkey;

alter table public.chat_message_reactions
  add constraint chat_message_reactions_pkey primary key (message_id, user_id);

comment on table public.chat_message_reactions is
  'One emoji per person per message. Changing it replaces the row; tapping the same emoji removes it.';

/*
 * Toggles a reaction with the corrected invariant: a person has at most one reaction on a
 * message. Tapping their current emoji removes it; tapping another replaces it atomically.
 */
create or replace function public.toggle_chat_message_reaction(p_message_id uuid, p_emoji text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_conversation uuid;
  v_user uuid;
  v_emoji text := btrim(coalesce(p_emoji, ''));
  v_existing text;
  v_added boolean;
begin
  select m.conversation_id into v_conversation
  from public.chat_messages m where m.id = p_message_id and m.deleted_at is null;
  if v_conversation is null then
    raise exception 'message not found' using errcode = 'NZ503';
  end if;
  v_user := private.chat_require_read(v_conversation);
  if v_emoji = '' or char_length(v_emoji) > 16 then
    raise exception 'invalid reaction' using errcode = 'NZ412';
  end if;

  select r.emoji into v_existing
  from public.chat_message_reactions r
  where r.message_id = p_message_id and r.user_id = v_user;

  if v_existing = v_emoji then
    delete from public.chat_message_reactions r
    where r.message_id = p_message_id and r.user_id = v_user;
    v_added := false;
  else
    insert into public.chat_message_reactions (message_id, user_id, emoji)
    values (p_message_id, v_user, v_emoji)
    on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
    v_added := true;
  end if;

  return jsonb_build_object(
    'messageId', p_message_id,
    'emoji', v_emoji,
    'added', v_added,
    'summary', (
      select coalesce(
        jsonb_agg(jsonb_build_object('emoji', s.emoji, 'count', s.n) order by s.n desc, s.emoji),
        '[]'::jsonb
      )
      from (
        select r.emoji, count(*) as n
        from public.chat_message_reactions r
        where r.message_id = p_message_id
        group by r.emoji
      ) s
    )
  );
end;
$$;

revoke execute on function public.toggle_chat_message_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_chat_message_reaction(uuid, text) to authenticated;
