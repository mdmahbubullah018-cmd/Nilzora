-- The facts an automatic answer is allowed to use
-- ----------------------------------------------
-- The assistant has always answered from looked-up facts and never from a guess. It could only
-- look up three of them, though — the store's name and hours, and the customer's own order — so
-- most of the questions customers actually press still went unanswered.
--
-- This widens the fact set to every answer the store can honestly give from its own data, and
-- nothing more:
--
--   returnWindowDays  `store_settings.return_window_days` — how long a customer has to ask for a
--                     return. Quoted, never interpreted.
--   codEnabled        `store_settings.cod_enabled` — whether cash on delivery is on right now.
--   product           The product this thread is about, with its status and stock level, so
--                     "is it available?" is answered from the catalogue rather than from hope.
--
-- What is deliberately NOT added: delivery charges and delivery dates. The store keeps no fee or
-- transit time anywhere, so a question about either falls through to the human handoff instead
-- of being answered with a number this function would have had to invent.
--
-- The shape is otherwise byte-for-byte the function it replaces, and the grant is unchanged.

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
    ),
    -- The published return window, in days, or null when the store has not set one.
    'returnWindowDays', s.return_window_days,
    -- Whether cash on delivery is offered right now, or null when that has never been decided.
    'codEnabled', s.cod_enabled,
    -- The product this thread is about, as the catalogue holds it. Stock is the sellable level,
    -- so a customer asking "is it available?" is answered from the same number checkout uses.
    'product', (
      select jsonb_build_object(
        'name', pr.name,
        'slug', pr.slug,
        'status', pr.status,
        'stock', pr.stock_quantity
      )
      from public.products pr
      where pr.id = c.product_id
    )
  )
  from public.chat_conversations c
  left join public.store_profile p on p.id
  left join public.store_settings s on s.id
  where c.id = p_conversation_id
    and c.customer_id is not distinct from p_customer_id;
$$;

comment on function public.chat_assistant_facts(uuid, uuid, text) is
  'Everything the automatic support answer may say, for one conversation of one customer. A null fact means "not published", which the assistant turns into a handoff.';
