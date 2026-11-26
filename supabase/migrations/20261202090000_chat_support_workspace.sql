-- Communication workspace: the operator queue and the team directory
-- ===================================================================
--
-- Two read-only functions for the Communication Center. Additive: nothing existing changes.
--
-- 1. `chat_support_queue` is the operator's inbox. `my_chat_conversations` serves customers and
--    operators alike, and for an operator it listed every customer thread — including threads
--    assigned to someone else, which `chat_can_read` then refused to open — and it mixed the
--    caller's internal team threads into the customer queue. The queue states the same
--    visibility as `chat_can_read`, keeps to the customer and moderation kinds, and adds the
--    priority filter and the sort orders the inbox offers.
--
-- 2. `chat_team_members` is the list of teammates who can take a conversation or join a team
--    thread, with their current workload. Assignment, the automation "assign to" action and the
--    team view all name a real account from it instead of a pasted id.

-- ---------------------------------------------------------------------------
-- The operator queue
-- ---------------------------------------------------------------------------

/**
 * One page of the operator queue.
 *
 *   p_scope     'all' (everything this account may work), 'mine' (assigned to the caller) or
 *               'unassigned' (open or pending threads nobody owns yet)
 *   p_sort      'queue'  — threads that need a person first (open, pending, or resolved with a
 *                          customer reply after it), then by priority, then most recent
 *               'recent' — most recent activity first
 *               'oldest' — least recent activity first
 *
 * Raises NZ403 for an account with neither workspace, NZ509 for an unknown scope or sort and
 * NZ412 for a page outside 1-100.
 */
create function public.chat_support_queue(
  p_scope text default 'all',
  p_status public.chat_conversation_status default null,
  p_priority public.chat_priority default null,
  p_search text default null,
  p_sort text default 'queue',
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  id uuid,
  kind public.chat_conversation_type,
  status public.chat_conversation_status,
  priority public.chat_priority,
  subject text,
  customer_id uuid,
  customer_name text,
  customer_email text,
  order_id uuid,
  order_number text,
  product_id uuid,
  product_name text,
  assignee_id uuid,
  assignee_name text,
  last_message_at timestamptz,
  last_message_preview text,
  last_message_sender_id uuid,
  message_count integer,
  unread_count bigint,
  latest_seq bigint,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := (select auth.uid());
  v_support boolean;
  v_moderate boolean;
  v_manager boolean;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_user and p.status = 'active') then
    raise exception 'account is not active' using errcode = 'NZ403';
  end if;

  v_support := private.chat_can_support(v_user);
  v_moderate := private.chat_can_moderate(v_user);
  if not (v_support or v_moderate) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;
  v_manager := private.chat_is_manager(v_user);

  if p_scope is null or p_scope not in ('all', 'mine', 'unassigned') then
    raise exception 'unknown scope' using errcode = 'NZ509';
  end if;
  if p_sort is null or p_sort not in ('queue', 'recent', 'oldest') then
    raise exception 'unknown sort' using errcode = 'NZ509';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset < 0 then
    raise exception 'limit must be 1-100' using errcode = 'NZ412';
  end if;

  return query
  select
    c.id,
    c.kind,
    c.status,
    c.priority,
    c.subject,
    c.customer_id,
    cu.full_name,
    cu.email,
    c.order_id,
    o.order_number,
    c.product_id,
    pr.name,
    c.assignee_id,
    a.full_name,
    c.last_message_at,
    c.last_message_preview,
    c.last_message_sender_id,
    c.message_count,
    (
      select count(*)
      from public.chat_messages m
      where m.conversation_id = c.id
        and m.seq > coalesce(me.last_read_seq, 0)
        and m.sender_id is distinct from v_user
        and m.deleted_at is null
    ) as unread_count,
    (
      select max(m.seq) from public.chat_messages m where m.conversation_id = c.id
    ) as latest_seq,
    c.created_at,
    c.updated_at,
    count(*) over () as total_count
  from public.chat_conversations c
  left join public.profiles cu on cu.id = c.customer_id
  left join public.profiles a on a.id = c.assignee_id
  left join public.orders o on o.id = c.order_id
  left join public.products pr on pr.id = c.product_id
  left join public.chat_conversation_participants me
    on me.conversation_id = c.id and me.user_id = v_user and me.left_at is null
  where
    c.kind in ('customer_support', 'order_support', 'moderation')
    -- Exactly what chat_can_read allows this account, stated once for the whole list.
    and (
      me.user_id is not null
      or (
        c.kind in ('customer_support', 'order_support')
        and v_support
        and (
          v_manager
          or c.assignee_id = v_user
          or (c.assignee_id is null and c.status in ('open', 'pending'))
        )
      )
      or (c.kind = 'moderation' and v_moderate)
    )
    and (
      p_scope = 'all'
      or (p_scope = 'mine' and c.assignee_id = v_user)
      or (p_scope = 'unassigned' and c.assignee_id is null and c.status in ('open', 'pending'))
    )
    and (p_status is null or c.status = p_status)
    and (p_priority is null or c.priority = p_priority)
    and (
      v_search is null
      or position(lower(v_search) in lower(c.subject)) > 0
      or position(lower(v_search) in lower(coalesce(c.last_message_preview, ''))) > 0
      or position(lower(v_search) in lower(coalesce(cu.full_name, ''))) > 0
      or position(lower(v_search) in lower(coalesce(cu.email, ''))) > 0
      or position(lower(v_search) in lower(coalesce(o.order_number, ''))) > 0
    )
  order by
    case when p_sort = 'queue' then
      case
        when c.status in ('open', 'pending') then 0
        -- A customer who wrote again after the thread was resolved is waiting for a person.
        when c.status = 'resolved' and c.last_message_sender_id = c.customer_id then 0
        else 1
      end
    end,
    case when p_sort = 'queue' then
      case c.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end
    end,
    case when p_sort = 'oldest' then c.last_message_at end asc nulls last,
    c.last_message_at desc,
    c.id
  limit p_limit offset p_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- The team directory
-- ---------------------------------------------------------------------------

/**
 * Every active teammate who can take a conversation (admin or moderator workspace) or use the
 * internal team chat, with what each can do and the conversations they currently hold.
 *
 * Staff accounts only: a customer never appears, and only an account that itself works a queue
 * or uses team chat may read the list (NZ403 otherwise). Contact details are limited to the
 * name and the work email the admin already shows on the staff screens.
 */
create function public.chat_team_members()
returns table (
  user_id uuid,
  full_name text,
  email text,
  role text,
  can_support boolean,
  can_moderate boolean,
  can_use_internal boolean,
  open_count bigint,
  pending_count bigint,
  resolved_recent_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  if not (
    private.chat_can_support(v_user)
    or private.chat_can_moderate(v_user)
    or private.chat_holds(v_user, 'chat.internal.use')
  ) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;

  return query
  with members as (
    select
      p.id,
      p.full_name,
      p.email,
      r.role::text as role,
      private.chat_can_support(p.id) as can_support,
      private.chat_can_moderate(p.id) as can_moderate,
      private.chat_holds(p.id, 'chat.internal.use') as can_use_internal
    from public.profiles p
    join public.user_roles r on r.user_id = p.id
    where p.status = 'active' and r.role <> 'customer'
  )
  select
    m.id,
    m.full_name,
    m.email,
    m.role,
    m.can_support,
    m.can_moderate,
    m.can_use_internal,
    (
      select count(*) from public.chat_conversations c
      where c.assignee_id = m.id and c.status = 'open'
        and c.kind in ('customer_support', 'order_support', 'moderation')
    ),
    (
      select count(*) from public.chat_conversations c
      where c.assignee_id = m.id and c.status = 'pending'
        and c.kind in ('customer_support', 'order_support', 'moderation')
    ),
    (
      select count(*) from public.chat_conversations c
      where c.assignee_id = m.id and c.status in ('resolved', 'closed')
        -- Closing a thread clears resolved_at, so a closed one is dated by closed_at.
        and coalesce(c.resolved_at, c.closed_at) > now() - interval '30 days'
        and c.kind in ('customer_support', 'order_support', 'moderation')
    )
  from members m
  where m.can_support or m.can_moderate or m.can_use_internal
  order by lower(coalesce(nullif(btrim(m.full_name), ''), m.email, '')), m.id;
end;
$$;

revoke execute on function public.chat_support_queue(
  text, public.chat_conversation_status, public.chat_priority, text, text, integer, integer
) from public, anon;
revoke execute on function public.chat_team_members() from public, anon;

grant execute on function public.chat_support_queue(
  text, public.chat_conversation_status, public.chat_priority, text, text, integer, integer
) to authenticated;
grant execute on function public.chat_team_members() to authenticated;
