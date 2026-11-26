-- ---------------------------------------------------------------------------
-- The support assistant's two calls
-- ---------------------------------------------------------------------------
-- The API answers a customer's first message from facts it can check: their own order, the
-- store profile, and whether a person has taken the thread over. It cannot read the chat
-- tables directly — `service_role` holds no grants on them, and that stays true — so the two
-- things it needs are functions here, following the same pattern as the automation engine:
-- security definer, `search_path` pinned, execute granted to `service_role` alone.
--
-- Nothing here widens what a customer or an agent can do. The facts function answers only for
-- the thread's own customer, and the reply function re-checks every condition that makes an
-- automatic answer appropriate at the moment it writes, under a row lock — so two requests
-- that arrive together cannot produce two automatic answers.

create function public.chat_assistant_facts(
  p_conversation_id uuid,
  p_customer_id uuid,
  p_order_number text default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', c.kind,
    'status', c.status,
    'assigneeId', c.assignee_id,
    'automationPaused', c.automation_paused,
    'storeName', coalesce(nullif(btrim(p.display_name), ''), 'Nilzora'),
    'businessHours', p.business_hours,
    'supportEmail', p.support_email,
    'supportPhone', p.support_phone,
    'customerMessages', (
      select count(*) from public.chat_messages m
      where m.conversation_id = c.id and m.sender_role = 'customer' and m.deleted_at is null
    ),
    'humanReplies', (
      select count(*) from public.chat_messages m
      where m.conversation_id = c.id
        and m.sender_role in ('staff', 'moderator')
        and m.deleted_at is null
    ),
    -- True once an automatic answer has already gone out for the newest customer message.
    'answered', exists (
      select 1 from public.chat_messages m
      where m.conversation_id = c.id
        and m.sender_role = 'system'
        and m.kind = 'automated'
        and m.deleted_at is null
        and m.created_at >= coalesce(c.last_customer_message_at, c.created_at)
    ),
    -- Only an order of the conversation's own customer can ever be named here.
    'order', (
      select jsonb_build_object('orderNumber', o.order_number, 'status', o.status)
      from public.orders o
      where o.user_id = c.customer_id
        and p_order_number is not null
        and upper(o.order_number) = upper(btrim(p_order_number))
      limit 1
    )
  )
  from public.chat_conversations c
  left join public.store_profile p on p.id
  where c.id = p_conversation_id
    and c.customer_id is not distinct from p_customer_id;
$$;

comment on function public.chat_assistant_facts(uuid, uuid, text) is
  'The facts the support assistant may use for one thread: its state, the store profile, and the customer''s own order. Null when the thread is not that customer''s.';

create function public.chat_assistant_reply(
  p_conversation_id uuid,
  p_customer_id uuid,
  p_body text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_conversation public.chat_conversations;
  v_row public.chat_messages;
  v_body text := btrim(coalesce(p_body, ''));
begin
  -- The lock serialises two answers for the same thread, so the checks below cannot be true
  -- for both of them.
  select * into v_conversation
  from public.chat_conversations c
  where c.id = p_conversation_id
    and c.customer_id is not distinct from p_customer_id
  for update;

  if v_conversation.id is null then
    return null;
  end if;
  if v_conversation.kind not in ('customer_support', 'order_support') then
    return null;
  end if;
  if v_conversation.status in ('resolved', 'closed') then
    return null;
  end if;
  -- A paused thread, or one a teammate has taken, is theirs: the assistant stays out of it.
  if v_conversation.automation_paused or v_conversation.assignee_id is not null then
    return null;
  end if;
  if exists (
    select 1 from public.chat_messages m
    where m.conversation_id = p_conversation_id
      and m.sender_role in ('staff', 'moderator')
      and m.deleted_at is null
  ) then
    return null;
  end if;
  if exists (
    select 1 from public.chat_messages m
    where m.conversation_id = p_conversation_id
      and m.sender_role = 'system'
      and m.kind = 'automated'
      and m.deleted_at is null
      and m.created_at >= coalesce(v_conversation.last_customer_message_at, v_conversation.created_at)
  ) then
    return null;
  end if;
  if v_body = '' or char_length(v_body) > 4000 then
    return null;
  end if;

  -- No sender: this is the store speaking, exactly like a rule's automatic reply.
  insert into public.chat_messages (conversation_id, sender_id, sender_role, kind, body, metadata)
  values (p_conversation_id, null, 'system', 'automated', v_body, coalesce(p_metadata, '{}'::jsonb))
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'seq', v_row.seq,
    'kind', v_row.kind,
    'body', v_row.body,
    'metadata', v_row.metadata,
    'createdAt', v_row.created_at
  );
end;
$$;

comment on function public.chat_assistant_reply(uuid, uuid, text, jsonb) is
  'Stores one automatic answer for a customer thread, or nothing when a person is involved or one was already sent.';

-- New functions are executable by everyone by default; these two are for the server alone.
revoke all on function public.chat_assistant_facts(uuid, uuid, text) from public;
revoke all on function public.chat_assistant_reply(uuid, uuid, text, jsonb) from public;
grant execute on function public.chat_assistant_facts(uuid, uuid, text) to service_role;
grant execute on function public.chat_assistant_reply(uuid, uuid, text, jsonb) to service_role;
