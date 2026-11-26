-- Per-message feedback: was this answer helpful?
-- =============================================
-- Conversation-level CSAT already exists (`chat_csat_responses`) and stays exactly as it is.
-- This is a second, narrower signal: a customer can rate one support reply "helpful" or "not
-- helpful", with an optional short comment, so staff can see which answer missed the mark
-- instead of only that the whole conversation scored badly.
--
-- Rules, all enforced here rather than in a client:
--   * only the conversation's own customer may leave feedback;
--   * only on a message that customer did not write (a support reply), that still exists, and
--     that is a real message rather than a system line;
--   * one row per message per customer, updated in place when they change their mind.
--
-- Staff read it through `chat_message_feedback(uuid)`, which requires read access to the thread
-- *and* the support permission; an ordinary customer cannot call it for anyone but themselves.

create type public.chat_feedback_verdict as enum ('helpful', 'not_helpful');

create table public.chat_message_feedback (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  -- Denormalised so a report never has to walk back through the thread, and so the row can be
  -- authorized by the same conversation check as everything else.
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  customer_id uuid not null references public.profiles (id) on delete cascade,
  verdict public.chat_feedback_verdict not null,
  comment text check (comment is null or char_length(comment) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One verdict per customer per message: changing it updates this row.
  unique (message_id, customer_id)
);

comment on table public.chat_message_feedback is
  'A customer''s helpful / not-helpful verdict on one support reply, separate from conversation-level CSAT.';

-- Managers filter by verdict and by recency; the unique key already covers lookup by message.
create index chat_message_feedback_conversation_idx
  on public.chat_message_feedback (conversation_id, created_at desc);
create index chat_message_feedback_verdict_idx
  on public.chat_message_feedback (verdict, created_at desc);

alter table public.chat_message_feedback enable row level security;

-- A customer sees only their own rows. Reads for staff go through the function below, so no
-- policy has to guess who a staff member is.
create policy chat_message_feedback_own_read on public.chat_message_feedback
  for select to authenticated
  using (customer_id = (select auth.uid()));

revoke all on public.chat_message_feedback from public, anon;
grant select on public.chat_message_feedback to authenticated;

-- ---------------------------------------------------------------------------
-- Writing a verdict
-- ---------------------------------------------------------------------------

create function public.submit_chat_message_feedback(
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

  insert into public.chat_message_feedback as f
    (message_id, conversation_id, customer_id, verdict, comment)
  values (p_message_id, v_message.conversation_id, v_user, p_verdict, v_comment)
  on conflict (message_id, customer_id) do update
    set verdict = excluded.verdict,
        comment = excluded.comment,
        updated_at = now()
  returning * into v_row;

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

comment on function public.submit_chat_message_feedback(uuid, public.chat_feedback_verdict, text) is
  'Records or replaces the caller''s helpful / not-helpful verdict on one support reply.';

revoke execute on function public.submit_chat_message_feedback(uuid, public.chat_feedback_verdict, text)
  from public, anon;
grant execute on function public.submit_chat_message_feedback(uuid, public.chat_feedback_verdict, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Reading it, for support staff
-- ---------------------------------------------------------------------------

create function public.chat_message_feedback(p_conversation_id uuid)
returns table (
  id uuid,
  message_id uuid,
  customer_name text,
  verdict public.chat_feedback_verdict,
  comment text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_read(p_conversation_id);
begin
  -- Reading a thread is not the same as handling it: only support-side roles see feedback.
  if not (private.chat_can_support(v_user) or private.chat_holds(v_user, 'chat.reports.review')) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;

  return query
  select f.id, f.message_id, p.full_name, f.verdict, f.comment, f.created_at, f.updated_at
  from public.chat_message_feedback f
  left join public.profiles p on p.id = f.customer_id
  where f.conversation_id = p_conversation_id
  order by f.created_at desc;
end;
$$;

comment on function public.chat_message_feedback(uuid) is
  'Per-message feedback for one thread, for an account that may support it.';

revoke execute on function public.chat_message_feedback(uuid) from public, anon;
grant execute on function public.chat_message_feedback(uuid) to authenticated;
