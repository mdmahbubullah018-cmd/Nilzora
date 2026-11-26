-- chat_assistant_facts (20261119090000) found an order only when the message itself named
-- one, so in a conversation opened about an order the assistant still asked "Send your order
-- number". It now falls back to the conversation's own order (still only one that belongs to
-- the conversation's customer). Same signature and grants.

create or replace function public.chat_assistant_facts(
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
    -- Only an order of the conversation's own customer can ever be named here: one the
    -- message names, else the order the conversation was opened about.
    'order', coalesce(
      (
        select jsonb_build_object('orderNumber', o.order_number, 'status', o.status)
        from public.orders o
        where o.user_id = c.customer_id
          and p_order_number is not null
          and upper(o.order_number) = upper(btrim(p_order_number))
        limit 1
      ),
      (
        select jsonb_build_object('orderNumber', o.order_number, 'status', o.status)
        from public.orders o
        where o.id = c.order_id and o.user_id = c.customer_id
      )
    )
  )
  from public.chat_conversations c
  left join public.store_profile p on p.id
  where c.id = p_conversation_id
    and c.customer_id is not distinct from p_customer_id;
$$;

