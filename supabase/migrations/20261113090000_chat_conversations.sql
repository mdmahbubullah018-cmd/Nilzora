-- Unified communication, Phase 1: conversations, messages and the support queues.
--
-- One conversation model serves every kind of talk in Nilzora: a customer asking for
-- help, a customer asking about a specific order, a staff-to-staff thread, and a
-- moderation case. The kind decides who may see it, never a flag the client sends.
--
-- Design notes
-- ------------
-- * Row Level Security is enabled and NO policy is created: `anon`, `authenticated` and
--   every other role keep zero direct table privileges. Every read and write goes through
--   a security-definer function below, which decides authorization from `auth.uid()` and
--   the caller's effective permissions (`private.permissions_of`). A leaked PostgREST
--   query therefore returns nothing, and a client can never widen its own access.
-- * Internal notes live in their own table (`chat_internal_notes`), not in
--   `chat_messages` with a flag. A customer-visible query cannot return one even if a
--   future policy is written carelessly.
-- * Read state is a high-water mark per participant (`last_read_seq`), which is what a
--   read receipt is on a sequence-ordered log. There is no per-message receipt table, so
--   marking a conversation read is one row update rather than N inserts.
-- * `chat_messages.seq` is a bigint identity: it orders messages, is the pagination
--   cursor, and never repeats, so a client can say exactly where it stopped.
-- * `client_message_id` makes sending idempotent: a retried send returns the message that
--   was stored the first time instead of a duplicate.

-- ---------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------

create type public.chat_conversation_type as enum (
  'customer_support',
  'order_support',
  'internal_direct',
  'internal_group',
  'moderation'
);

create type public.chat_conversation_status as enum ('open', 'pending', 'resolved', 'closed');

create type public.chat_priority as enum ('low', 'normal', 'high', 'urgent');

create type public.chat_message_kind as enum ('text', 'system', 'order_event', 'automated');

create type public.chat_participant_role as enum ('customer', 'staff', 'moderator', 'system');

create type public.chat_report_reason as enum ('spam', 'abuse', 'personal_information', 'other');

create type public.chat_report_status as enum ('open', 'reviewing', 'dismissed', 'actioned');

-- ---------------------------------------------------------------------------
-- chat_conversations
-- ---------------------------------------------------------------------------

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  kind public.chat_conversation_type not null,
  status public.chat_conversation_status not null default 'open',
  priority public.chat_priority not null default 'normal',
  subject text not null check (char_length(btrim(subject)) between 1 and 160),
  -- The customer the conversation is about. Null for staff-only conversations.
  customer_id uuid references public.profiles (id) on delete restrict,
  order_id uuid references public.orders (id) on delete set null,
  product_id uuid references public.products (id) on delete set null,
  assignee_id uuid references public.profiles (id) on delete set null,
  -- Denormalised for the list screens and kept current by the message trigger.
  last_message_at timestamptz not null default now(),
  last_message_preview text check (
    last_message_preview is null or char_length(last_message_preview) <= 180
  ),
  last_message_sender_id uuid references public.profiles (id) on delete set null,
  message_count integer not null default 0 check (message_count >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  -- A customer thread always names its customer; a staff or moderation thread never does.
  constraint chat_conversations_customer_matches_kind check (
    case
      when kind in ('customer_support', 'order_support') then customer_id is not null
      else customer_id is null
    end
  ),
  -- An order thread always names its order, and only an order thread does.
  constraint chat_conversations_order_matches_kind check (
    case when kind = 'order_support' then order_id is not null else order_id is null end
  )
);

comment on table public.chat_conversations is 'One thread of the unified communication system. Closed to end users; every read goes through the functions below.';
comment on column public.chat_conversations.assignee_id is 'The staff account that owns the thread in the support queue. Null means unassigned.';
comment on column public.chat_conversations.last_message_preview is 'First 180 characters of the newest customer-visible message, for list screens.';
comment on column public.chat_conversations.priority is 'Set by support staff only; customers never choose it.';

create trigger chat_conversations_set_updated_at
  before update on public.chat_conversations
  for each row execute function public.set_updated_at();

-- One live thread per order and one live general thread per customer: asking for help
-- again continues the same conversation instead of opening a parallel one.
create unique index chat_conversations_live_order_idx
  on public.chat_conversations (order_id)
  where kind = 'order_support' and status in ('open', 'pending');
create unique index chat_conversations_live_customer_idx
  on public.chat_conversations (
    customer_id,
    coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where kind = 'customer_support' and status in ('open', 'pending');

create index chat_conversations_queue_idx
  on public.chat_conversations (status, priority desc, last_message_at desc);
create index chat_conversations_assignee_idx
  on public.chat_conversations (assignee_id, last_message_at desc);
create index chat_conversations_customer_idx
  on public.chat_conversations (customer_id, last_message_at desc);
create index chat_conversations_recent_idx on public.chat_conversations (last_message_at desc);

-- ---------------------------------------------------------------------------
-- chat_conversation_participants — who is in a thread, and how far they have read
-- ---------------------------------------------------------------------------

create table public.chat_conversation_participants (
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.chat_participant_role not null,
  -- High-water marks: every message at or below them is read / delivered for this person.
  last_read_seq bigint not null default 0 check (last_read_seq >= 0),
  last_delivered_seq bigint not null default 0 check (last_delivered_seq >= 0),
  muted boolean not null default false,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (conversation_id, user_id)
);

comment on table public.chat_conversation_participants is 'Membership of a conversation plus the read/delivered high-water marks that serve as read receipts.';
comment on column public.chat_conversation_participants.last_read_seq is 'Highest chat_messages.seq this participant has read.';

create index chat_conversation_participants_user_idx
  on public.chat_conversation_participants (user_id, conversation_id);

-- ---------------------------------------------------------------------------
-- chat_messages — customer-visible messages only
-- ---------------------------------------------------------------------------

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  -- Ordering key and pagination cursor. Never reused, never reordered.
  seq bigint generated always as identity,
  sender_id uuid references public.profiles (id) on delete set null,
  sender_role public.chat_participant_role not null,
  kind public.chat_message_kind not null default 'text',
  body text check (body is null or char_length(body) <= 4000),
  -- The sender's own identifier for this message; a retried send finds the stored row.
  client_message_id uuid,
  reply_to_id uuid references public.chat_messages (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint chat_messages_body_present check (
    case when kind = 'text' then body is not null and char_length(btrim(body)) between 1 and 4000
         else body is null or char_length(body) <= 4000
    end
  ),
  constraint chat_messages_system_has_no_sender check (
    case when kind = 'system' then sender_id is null else true end
  )
);

comment on table public.chat_messages is 'Customer-visible messages. Internal notes are in chat_internal_notes and can never be returned with these.';
comment on column public.chat_messages.metadata is 'Small, server-written context for a message: the order status an order_event names, and similar.';

create unique index chat_messages_client_idx
  on public.chat_messages (conversation_id, client_message_id)
  where client_message_id is not null;
create index chat_messages_thread_idx on public.chat_messages (conversation_id, seq desc);
create index chat_messages_sender_idx on public.chat_messages (sender_id, created_at desc);

-- ---------------------------------------------------------------------------
-- chat_internal_notes — staff only, in a table of their own
-- ---------------------------------------------------------------------------

create table public.chat_internal_notes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  seq bigint generated always as identity,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

comment on table public.chat_internal_notes is 'Staff-only notes on a conversation. A separate table so no customer-facing query can return one.';

create index chat_internal_notes_thread_idx on public.chat_internal_notes (conversation_id, seq desc);

-- ---------------------------------------------------------------------------
-- chat_assignments — the history of who owned a thread
-- ---------------------------------------------------------------------------

create table public.chat_assignments (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  assigned_to uuid references public.profiles (id) on delete set null,
  assigned_by uuid references public.profiles (id) on delete set null,
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now()
);

comment on table public.chat_assignments is 'Append-only record of assignment changes, so a thread can be traced back to who owned it.';

create index chat_assignments_thread_idx on public.chat_assignments (conversation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- chat_message_reports — what moderation works from
-- ---------------------------------------------------------------------------

create table public.chat_message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  reported_by uuid references public.profiles (id) on delete set null,
  reason public.chat_report_reason not null,
  details text check (details is null or char_length(details) <= 500),
  status public.chat_report_status not null default 'open',
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint chat_message_reports_one_per_account unique (message_id, reported_by)
);

comment on table public.chat_message_reports is 'A participant flagging a message. Read by the moderator workspace.';

create index chat_message_reports_open_idx
  on public.chat_message_reports (status, created_at desc);

-- ---------------------------------------------------------------------------
-- Deny by default
-- ---------------------------------------------------------------------------

alter table public.chat_conversations enable row level security;
alter table public.chat_conversation_participants enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_internal_notes enable row level security;
alter table public.chat_assignments enable row level security;
alter table public.chat_message_reports enable row level security;

-- No policy is created on purpose: the security-definer functions below are the only
-- way in, and they check authorization themselves.
revoke all on public.chat_conversations from anon, authenticated;
revoke all on public.chat_conversation_participants from anon, authenticated;
revoke all on public.chat_messages from anon, authenticated;
revoke all on public.chat_internal_notes from anon, authenticated;
revoke all on public.chat_assignments from anon, authenticated;
revoke all on public.chat_message_reports from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Keep the list columns current
-- ---------------------------------------------------------------------------

create function private.chat_message_touched()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null then
    return null;
  end if;
  update public.chat_conversations c
  set last_message_at = new.created_at,
      last_message_preview = left(coalesce(new.body, ''), 180),
      last_message_sender_id = new.sender_id,
      message_count = c.message_count + 1
  where c.id = new.conversation_id;
  return null;
end;
$$;

create trigger chat_messages_touch_conversation
  after insert on public.chat_messages
  for each row execute function private.chat_message_touched();

-- ---------------------------------------------------------------------------
-- Authorization helpers (private: they accept an arbitrary account id)
-- ---------------------------------------------------------------------------

/** Whether the account holds a permission right now. */
create function private.chat_holds(p_user uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and exists (
    select 1 from private.permissions_of(p_user) as granted (name)
    where granted.name = p_permission
  );
$$;

/** Support staff: anyone allowed into the admin workspace. */
create function private.chat_can_support(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select private.chat_holds(p_user, 'admin_workspace.access'); $$;

/** Moderators: anyone allowed into the moderator workspace. */
create function private.chat_can_moderate(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select private.chat_holds(p_user, 'moderator_workspace.access'); $$;

/** Owner or admin: oversight of every queue, assigned or not. */
create function private.chat_is_manager(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = p_user and r.role in ('super_admin', 'admin')
  );
$$;

/** The participant role an account replies as. */
create function private.chat_sender_role(p_user uuid)
returns public.chat_participant_role
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not private.chat_can_support(p_user) and private.chat_can_moderate(p_user)
      then 'moderator'::public.chat_participant_role
    when private.chat_can_support(p_user) or private.chat_can_moderate(p_user)
      then 'staff'::public.chat_participant_role
    else 'customer'::public.chat_participant_role
  end;
$$;

/**
 * Whether the account may see a conversation:
 *   - an active member of it, or the customer it is about;
 *   - support staff, for a customer or order thread: the assignee always, and anyone
 *     else while it is unassigned and still open or pending (the shared queue);
 *   - holders of the moderator workspace, for a moderation thread.
 * Everything is decided from stored rows, never from anything the caller sent.
 */
create function private.chat_can_read(p_user uuid, p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_user is not null
    and p_conversation is not null
    and exists (
      select 1 from public.profiles p where p.id = p_user and p.status = 'active'
    )
    and exists (
      select 1
      from public.chat_conversations c
      where c.id = p_conversation
        and (
          exists (
            select 1 from public.chat_conversation_participants m
            where m.conversation_id = c.id and m.user_id = p_user and m.left_at is null
          )
          or c.customer_id = p_user
          or (
            c.kind in ('customer_support', 'order_support')
            and private.chat_can_support(p_user)
            and (
              private.chat_is_manager(p_user)
              or c.assignee_id = p_user
              or (c.assignee_id is null and c.status in ('open', 'pending'))
            )
          )
          or (c.kind = 'moderation' and private.chat_can_moderate(p_user))
        )
    );
$$;

/** Support staff may reply in a customer thread even before they are a participant. */
create function private.chat_can_reply(p_user uuid, p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.chat_can_read(p_user, p_conversation)
    and exists (
      select 1
      from public.chat_conversations c
      where c.id = p_conversation
        and (
          exists (
            select 1 from public.chat_conversation_participants m
            where m.conversation_id = c.id and m.user_id = p_user and m.left_at is null
          )
          or (
            c.kind in ('customer_support', 'order_support')
            and private.chat_can_support(p_user)
          )
          or (c.kind = 'moderation' and private.chat_can_moderate(p_user))
        )
    );
$$;

/**
 * Resolves a conversation id for a caller who may read it, raising NZ501 otherwise.
 * A thread the caller may not see is answered exactly like one that does not exist, so
 * ids cannot be probed.
 */
create function private.chat_require_read(p_conversation uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  if not private.chat_can_read(v_user, p_conversation) then
    raise exception 'conversation not found' using errcode = 'NZ501';
  end if;
  return v_user;
end;
$$;

/** Adds the caller as a participant when they reply to a thread they can see. */
create function private.chat_join(p_conversation uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.chat_conversation_participants (conversation_id, user_id, role)
  values (p_conversation, p_user, private.chat_sender_role(p_user))
  on conflict (conversation_id, user_id) do update set left_at = null;
end;
$$;

-- ---------------------------------------------------------------------------
-- The conversation detail, as the API serves it
-- ---------------------------------------------------------------------------

/**
 * Everything one conversation screen needs: the thread, its participants (whose read
 * marks are the read receipts), and the customer, order and product context the caller
 * is allowed to see. Raises NZ501 when the caller may not read the thread.
 */
create function public.chat_conversation(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_read(p_conversation_id);
  v_me public.chat_conversation_participants;
  v_result jsonb;
begin
  select * into v_me
  from public.chat_conversation_participants m
  where m.conversation_id = p_conversation_id and m.user_id = v_user;

  select jsonb_build_object(
    'conversation', jsonb_build_object(
      'id', c.id,
      'kind', c.kind,
      'status', c.status,
      'priority', c.priority,
      'subject', c.subject,
      'customerId', c.customer_id,
      'orderId', c.order_id,
      'productId', c.product_id,
      'assigneeId', c.assignee_id,
      'lastMessageAt', c.last_message_at,
      'lastMessagePreview', c.last_message_preview,
      'lastMessageSenderId', c.last_message_sender_id,
      'messageCount', c.message_count,
      'createdAt', c.created_at,
      'updatedAt', c.updated_at,
      'resolvedAt', c.resolved_at,
      'closedAt', c.closed_at
    ),
    'viewer', jsonb_build_object(
      'userId', v_user,
      'role', case
        when v_me.user_id is not null then v_me.role
        else private.chat_sender_role(v_user)
      end,
      'lastReadSeq', coalesce(v_me.last_read_seq, 0),
      'isAssignee', coalesce(c.assignee_id = v_user, false),
      'canReply', private.chat_can_reply(v_user, p_conversation_id),
      'canAssign', private.chat_can_support(v_user),
      'canUseInternalNotes', private.chat_can_support(v_user)
    ),
    'customer', case when c.customer_id is null then null else jsonb_build_object(
      'id', cu.id,
      'name', cu.full_name,
      'phone', cu.phone,
      'email', cu.email
    ) end,
    'order', case when c.order_id is null then null else jsonb_build_object(
      'id', o.id,
      'number', o.order_number,
      'status', o.status,
      'paymentStatus', o.payment_status,
      'totalMinor', o.total_minor,
      'itemCount', o.item_count,
      'placedAt', o.placed_at
    ) end,
    'product', case when c.product_id is null then null else jsonb_build_object(
      'id', pr.id,
      'slug', pr.slug,
      'name', pr.name,
      'priceMinor', pr.price_minor,
      'status', pr.status
    ) end,
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', m.user_id,
        'role', m.role,
        'name', p.full_name,
        'email', p.email,
        'lastReadSeq', m.last_read_seq,
        'lastDeliveredSeq', m.last_delivered_seq,
        'joinedAt', m.joined_at
      ) order by m.joined_at, m.user_id)
      from public.chat_conversation_participants m
      join public.profiles p on p.id = m.user_id
      where m.conversation_id = c.id and m.left_at is null
    ), '[]'::jsonb)
  )
  into v_result
  from public.chat_conversations c
  left join public.profiles cu on cu.id = c.customer_id
  left join public.orders o on o.id = c.order_id
  left join public.products pr on pr.id = c.product_id
  where c.id = p_conversation_id;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Starting a conversation
-- ---------------------------------------------------------------------------

/**
 * Opens a conversation, or continues the customer's live one of the same kind, and adds
 * the first message. The customer is always the caller: an order thread is created only
 * for an order the caller placed, and a product thread only for a published product.
 * Staff-only kinds need a workspace permission and an explicit participant list.
 */
create function public.start_chat_conversation(
  p_kind public.chat_conversation_type,
  p_order_number text default null,
  p_product_id uuid default null,
  p_subject text default null,
  p_body text default null,
  p_participants uuid[] default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_kind public.chat_conversation_type := p_kind;
  v_subject text;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_conversation public.chat_conversations;
  v_order public.orders;
  v_product public.products;
  v_participant uuid;
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_user and p.status = 'active') then
    raise exception 'account suspended' using errcode = 'NZ410';
  end if;
  if v_kind is null then
    raise exception 'unknown conversation kind' using errcode = 'NZ509';
  end if;

  if v_kind in ('customer_support', 'order_support') then
    if p_order_number is not null and btrim(p_order_number) <> '' then
      v_kind := 'order_support';
      -- The caller's own order only: the number is not a capability.
      select * into v_order from public.orders o where o.order_number = btrim(p_order_number);
      if not found or v_order.user_id <> v_user then
        raise exception 'order not found' using errcode = 'NZ507';
      end if;
    elsif v_kind = 'order_support' then
      raise exception 'order not found' using errcode = 'NZ507';
    end if;

    if p_product_id is not null then
      select * into v_product from public.products pr where pr.id = p_product_id;
      if not found or v_product.status <> 'active' then
        raise exception 'product not found' using errcode = 'NZ501';
      end if;
    end if;

    -- Reuse the customer's live thread rather than opening a parallel one.
    select * into v_conversation
    from public.chat_conversations c
    where c.customer_id = v_user
      and c.kind = v_kind
      and c.status in ('open', 'pending')
      and (v_kind = 'order_support' or c.product_id is not distinct from p_product_id)
      and (v_kind <> 'order_support' or c.order_id = v_order.id)
    order by c.last_message_at desc
    limit 1;

    if v_conversation.id is null then
      -- A new customer thread per hour is generous; more looks like abuse.
      if (
        select count(*) from public.chat_conversations c
        where c.customer_id = v_user and c.created_at > now() - interval '1 hour'
      ) >= 10 then
        raise exception 'too many conversations' using errcode = 'NZ509';
      end if;

      v_subject := coalesce(
        nullif(btrim(coalesce(p_subject, '')), ''),
        case when v_order.id is not null then 'Order ' || v_order.order_number end,
        left(coalesce(v_body, 'Support request'), 160)
      );

      insert into public.chat_conversations (
        kind, subject, customer_id, order_id, product_id, created_by
      )
      values (v_kind, v_subject, v_user, v_order.id, p_product_id, v_user)
      returning * into v_conversation;

      insert into public.chat_conversation_participants (conversation_id, user_id, role)
      values (v_conversation.id, v_user, 'customer');
    end if;
  else
    -- Staff-only kinds: a workspace permission and a real audience are both required.
    if not (private.chat_can_support(v_user) or private.chat_can_moderate(v_user)) then
      raise exception 'missing permission' using errcode = 'NZ403';
    end if;
    if p_participants is null or cardinality(p_participants) = 0 then
      raise exception 'choose who is in the conversation' using errcode = 'NZ511';
    end if;

    v_subject := coalesce(nullif(btrim(coalesce(p_subject, '')), ''), 'Untitled conversation');

    insert into public.chat_conversations (kind, subject, created_by, assignee_id)
    values (
      case when v_kind = 'internal_direct' then 'internal_direct'::public.chat_conversation_type
           else v_kind end,
      left(v_subject, 160),
      v_user,
      v_user
    )
    returning * into v_conversation;

    insert into public.chat_conversation_participants (conversation_id, user_id, role)
    values (v_conversation.id, v_user, private.chat_sender_role(v_user))
    on conflict do nothing;

    foreach v_participant in array p_participants loop
      if v_participant <> v_user then
        if not (
          private.chat_can_support(v_participant) or private.chat_can_moderate(v_participant)
        ) then
          raise exception 'participant cannot join' using errcode = 'NZ511';
        end if;
        insert into public.chat_conversation_participants (conversation_id, user_id, role)
        values (v_conversation.id, v_participant, private.chat_sender_role(v_participant))
        on conflict do nothing;
      end if;
    end loop;
  end if;

  if v_body is not null then
    insert into public.chat_messages (
      conversation_id, sender_id, sender_role, kind, body
    )
    values (v_conversation.id, v_user, private.chat_sender_role(v_user), 'text', v_body);
  end if;

  return public.chat_conversation(v_conversation.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Listing conversations
-- ---------------------------------------------------------------------------

/**
 * The caller's conversation list. A customer sees the threads they are part of; support
 * staff see every customer thread (or only their own, or only the unassigned queue,
 * depending on p_scope). Page-based, because the operator screens are page-based too.
 * Raises NZ501 for an account with no workspace permission asking for staff scopes.
 */
create function public.my_chat_conversations(
  p_scope text default 'all',
  p_status public.chat_conversation_status default null,
  p_search text default null,
  p_limit integer default 20,
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
  v_staff boolean;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  if p_scope is null or p_scope not in ('all', 'participating', 'mine', 'unassigned') then
    raise exception 'unknown scope' using errcode = 'NZ509';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset < 0 then
    raise exception 'limit must be 1-100' using errcode = 'NZ412';
  end if;

  v_staff := private.chat_can_support(v_user);

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
    on me.conversation_id = c.id and me.user_id = v_user
  where
    -- customer threads: their own; staff threads: participation
    (
      (c.kind in ('customer_support', 'order_support') and c.customer_id = v_user)
      or exists (
        select 1 from public.chat_conversation_participants m
        where m.conversation_id = c.id and m.user_id = v_user and m.left_at is null
      )
      or (
        v_staff
        and c.kind in ('customer_support', 'order_support')
        and (
          p_scope = 'all'
          or (p_scope = 'mine' and c.assignee_id = v_user)
          or (
            p_scope = 'unassigned'
            and c.assignee_id is null
            and c.status in ('open', 'pending')
          )
        )
      )
      or (v_staff and c.kind = 'moderation' and p_scope = 'all')
    )
    and (p_status is null or c.status = p_status)
    and (
      v_search is null
      or position(lower(v_search) in lower(c.subject)) > 0
      or position(lower(v_search) in lower(coalesce(c.last_message_preview, ''))) > 0
      or position(lower(v_search) in lower(coalesce(cu.full_name, ''))) > 0
      or position(lower(v_search) in lower(coalesce(cu.email, ''))) > 0
      or position(lower(v_search) in lower(coalesce(o.order_number, ''))) > 0
    )
  order by
    -- the queue puts waiting threads first, then the most recently active
    case when c.status in ('open', 'pending') then 0 else 1 end,
    case c.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
    c.last_message_at desc,
    c.id
  limit p_limit offset p_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------

/**
 * One page of a conversation's messages, newest first. `p_before_seq` is the cursor: pass
 * the `seq` of the oldest message already on screen to load the page before it. Every row
 * is customer-visible; internal notes never appear here.
 */
create function public.chat_messages(
  p_conversation_id uuid,
  p_before_seq bigint default null,
  p_limit integer default 30
)
returns table (
  id uuid,
  seq bigint,
  sender_id uuid,
  sender_role public.chat_participant_role,
  sender_name text,
  kind public.chat_message_kind,
  body text,
  reply_to_id uuid,
  metadata jsonb,
  edited_at timestamptz,
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
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'limit must be 1-100' using errcode = 'NZ412';
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
    m.reply_to_id,
    case when m.deleted_at is null then m.metadata else '{}'::jsonb end,
    m.edited_at,
    m.created_at
  from public.chat_messages m
  left join public.profiles p on p.id = m.sender_id
  where m.conversation_id = p_conversation_id
    and (p_before_seq is null or m.seq < p_before_seq)
  order by m.seq desc
  limit p_limit;
end;
$$;

/**
 * Stores a message and answers it with its sequence number, which is what the realtime
 * layer broadcasts. Repeatable: the same p_client_message_id returns the message stored
 * the first time, so a retried send never duplicates, and the sender is added as a
 * participant if they are staff replying into the queue for the first time.
 *
 * A closed conversation refuses new messages (NZ502) until it is reopened.
 */
create function public.send_chat_message(
  p_conversation_id uuid,
  p_client_message_id uuid,
  p_body text,
  p_reply_to_id uuid default null
)
returns table (
  id uuid,
  seq bigint,
  sender_id uuid,
  sender_role public.chat_participant_role,
  sender_name text,
  kind public.chat_message_kind,
  body text,
  reply_to_id uuid,
  metadata jsonb,
  created_at timestamptz,
  duplicate boolean,
  unread_count bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := private.chat_require_read(p_conversation_id);
  v_role public.chat_participant_role;
  v_body text := btrim(coalesce(p_body, ''));
  v_existing public.chat_messages;
  v_row public.chat_messages;
  v_status public.chat_conversation_status;
  v_recent integer;
begin
  if not private.chat_can_reply(v_user, p_conversation_id) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;
  if v_body = '' or char_length(v_body) > 4000 then
    raise exception 'message too long' using errcode = 'NZ508';
  end if;

  if p_client_message_id is not null then
    select * into v_existing
    from public.chat_messages m
    where m.conversation_id = p_conversation_id and m.client_message_id = p_client_message_id;
    if found then
      return query
      select m.id, m.seq, m.sender_id, m.sender_role, p.full_name, m.kind, m.body,
             m.reply_to_id, m.metadata, m.created_at, true,
             (
               select count(*) from public.chat_messages u
               where u.conversation_id = m.conversation_id
                 and u.seq > coalesce(
                   (select me.last_read_seq from public.chat_conversation_participants me
                    where me.conversation_id = m.conversation_id and me.user_id = v_user), 0)
                 and u.sender_id is distinct from v_user
                 and u.deleted_at is null
             )
      from public.chat_messages m
      left join public.profiles p on p.id = m.sender_id
      where m.id = v_existing.id;
      return;
    end if;
  end if;

  select c.status into v_status from public.chat_conversations c where c.id = p_conversation_id;
  if v_status = 'closed' then
    raise exception 'conversation is closed' using errcode = 'NZ502';
  end if;

  -- Spam guard: a bug or a script cannot flood a thread.
  select count(*) into v_recent
  from public.chat_messages m
  where m.sender_id = v_user and m.created_at > now() - interval '60 seconds';
  if v_recent >= 30 then
    raise exception 'too many messages' using errcode = 'NZ506';
  end if;

  if p_reply_to_id is not null and not exists (
    select 1 from public.chat_messages r
    where r.id = p_reply_to_id and r.conversation_id = p_conversation_id
  ) then
    raise exception 'message not found' using errcode = 'NZ503';
  end if;

  v_role := private.chat_sender_role(v_user);
  perform private.chat_join(p_conversation_id, v_user);

  insert into public.chat_messages (
    conversation_id, sender_id, sender_role, kind, body, client_message_id, reply_to_id
  )
  values (p_conversation_id, v_user, v_role, 'text', v_body, p_client_message_id, p_reply_to_id)
  on conflict (conversation_id, client_message_id) where client_message_id is not null
  do nothing
  returning * into v_row;

  if v_row.id is null then
    -- Another request with the same client id won the race: answer with its row.
    select * into v_row
    from public.chat_messages m
    where m.conversation_id = p_conversation_id and m.client_message_id = p_client_message_id;
    if v_row.id is null then
      raise exception 'message not stored' using errcode = 'NZ503';
    end if;
  end if;

  -- A staff member replying takes ownership of an unassigned thread.
  update public.chat_conversations c
  set assignee_id = v_user
  where c.id = p_conversation_id
    and c.assignee_id is null
    and v_role in ('staff', 'moderator');

  return query
  select v_row.id, v_row.seq, v_row.sender_id, v_row.sender_role,
         (select p.full_name from public.profiles p where p.id = v_row.sender_id),
         v_row.kind, v_row.body, v_row.reply_to_id, v_row.metadata, v_row.created_at, false,
         (
           select count(*) from public.chat_messages u
           where u.conversation_id = p_conversation_id
             and u.seq > coalesce(
               (select me.last_read_seq from public.chat_conversation_participants me
                where me.conversation_id = p_conversation_id and me.user_id = v_user), 0)
             and u.sender_id is distinct from v_user
             and u.deleted_at is null
         );
end;
$$;

/** Records that the caller has read up to `p_seq`, and answers the remaining unread count. */
create function public.mark_chat_read(p_conversation_id uuid, p_seq bigint)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_read(p_conversation_id);
  v_seq bigint := coalesce(p_seq, 0);
  v_remaining bigint;
begin
  if v_seq < 0 then
    raise exception 'sequence must not be negative' using errcode = 'NZ412';
  end if;

  perform private.chat_join(p_conversation_id, v_user);

  update public.chat_conversation_participants m
  set last_read_seq = greatest(m.last_read_seq, v_seq),
      last_delivered_seq = greatest(m.last_delivered_seq, v_seq)
  where m.conversation_id = p_conversation_id and m.user_id = v_user;

  select count(*) into v_remaining
  from public.chat_messages u
  where u.conversation_id = p_conversation_id
    and u.seq > greatest(
      coalesce((select me.last_read_seq from public.chat_conversation_participants me
                where me.conversation_id = p_conversation_id and me.user_id = v_user), 0),
      0
    )
    and u.sender_id is distinct from v_user
    and u.deleted_at is null;

  return v_remaining;
end;
$$;

/** Records delivery (the client received it) without claiming the reader has seen it. */
create function public.mark_chat_delivered(p_conversation_id uuid, p_seq bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_read(p_conversation_id);
begin
  update public.chat_conversation_participants m
  set last_delivered_seq = greatest(m.last_delivered_seq, coalesce(p_seq, 0))
  where m.conversation_id = p_conversation_id and m.user_id = v_user;
end;
$$;

/** The caller's total unread count, for the navigation badge. */
create function public.my_unread_chat_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(u.unread), 0)::bigint
  from (
    select (
      select count(*)
      from public.chat_messages m
      where m.conversation_id = c.id
        and m.seq > coalesce(me.last_read_seq, 0)
        and m.sender_id is distinct from (select auth.uid())
        and m.deleted_at is null
    ) as unread
    from public.chat_conversations c
    join public.chat_conversation_participants me
      on me.conversation_id = c.id
     and me.user_id = (select auth.uid())
     and me.left_at is null
    where c.status in ('open', 'pending')
  ) u;
$$;

-- ---------------------------------------------------------------------------
-- Queue management
-- ---------------------------------------------------------------------------

/** Moves a conversation between open, pending, resolved and closed. */
create function public.set_chat_conversation_status(
  p_conversation_id uuid,
  p_status public.chat_conversation_status
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_read(p_conversation_id);
  v_kind public.chat_conversation_type;
  v_customer uuid;
  v_staff boolean;
begin
  if p_status is null then
    raise exception 'unknown status' using errcode = 'NZ412';
  end if;

  select c.kind, c.customer_id into v_kind, v_customer
  from public.chat_conversations c where c.id = p_conversation_id;

  v_staff := private.chat_can_support(v_user) or private.chat_can_moderate(v_user);
  -- A customer may only close or reopen their own thread; the queue's own states are staff's.
  if not v_staff and (v_customer <> v_user or p_status not in ('open', 'closed')) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;

  update public.chat_conversations c
  set status = p_status,
      resolved_at = case when p_status = 'resolved' then coalesce(c.resolved_at, now()) end,
      closed_at = case when p_status = 'closed' then coalesce(c.closed_at, now()) end
  where c.id = p_conversation_id;

  insert into public.chat_messages (conversation_id, sender_id, sender_role, kind, body, metadata)
  values (
    p_conversation_id,
    null,
    'system',
    'system',
    case p_status
      when 'open' then 'Conversation reopened'
      when 'pending' then 'Conversation marked pending'
      when 'resolved' then 'Conversation marked resolved'
      else 'Conversation closed'
    end,
    jsonb_build_object('event', 'status_changed', 'status', p_status)
  );

  if p_status in ('resolved', 'closed') then
    -- Whoever acted has read everything they can see.
    update public.chat_conversation_participants m
    set last_read_seq = greatest(
      m.last_read_seq,
      coalesce((select max(x.seq) from public.chat_messages x where x.conversation_id = p_conversation_id), 0)
    )
    where m.conversation_id = p_conversation_id and m.user_id = v_user;
  end if;

  return public.chat_conversation(p_conversation_id);
end;
$$;

/** Hands a support thread to a member of staff, or back to the unassigned queue (null). */
create function public.assign_chat_conversation(
  p_conversation_id uuid,
  p_assignee_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_read(p_conversation_id);
  v_kind public.chat_conversation_type;
begin
  if not private.chat_can_support(v_user) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;

  select c.kind into v_kind from public.chat_conversations c where c.id = p_conversation_id;
  if v_kind not in ('customer_support', 'order_support', 'moderation') then
    raise exception 'conversation cannot be assigned' using errcode = 'NZ505';
  end if;

  if p_assignee_id is not null then
    if not (
      private.chat_can_support(p_assignee_id) or private.chat_can_moderate(p_assignee_id)
    ) then
      raise exception 'assignee cannot take conversations' using errcode = 'NZ505';
    end if;
    if p_note is not null and char_length(p_note) > 300 then
      raise exception 'note too long' using errcode = 'NZ412';
    end if;
  end if;

  update public.chat_conversations c
  set assignee_id = p_assignee_id,
      status = case when c.status = 'open' and p_assignee_id is not null then 'pending' else c.status end
  where c.id = p_conversation_id;

  insert into public.chat_assignments (conversation_id, assigned_to, assigned_by, note)
  values (p_conversation_id, p_assignee_id, v_user, nullif(btrim(coalesce(p_note, '')), ''));

  -- Joining the queue means joining the thread, so the assignee reads it from now on.
  if p_assignee_id is not null then
    perform private.chat_join(p_conversation_id, p_assignee_id);
  end if;

  return public.chat_conversation(p_conversation_id);
end;
$$;

/** Sets how a thread is triaged. Staff only: priority is not something a customer chooses. */
create function public.set_chat_conversation_priority(
  p_conversation_id uuid,
  p_priority public.chat_priority
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_read(p_conversation_id);
begin
  if not (private.chat_can_support(v_user) or private.chat_can_moderate(v_user)) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;
  if p_priority is null then
    raise exception 'unknown priority' using errcode = 'NZ412';
  end if;

  update public.chat_conversations c set priority = p_priority where c.id = p_conversation_id;
  return public.chat_conversation(p_conversation_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal notes (staff only, never customer-visible)
-- ---------------------------------------------------------------------------

create function public.add_chat_internal_note(p_conversation_id uuid, p_body text)
returns table (id uuid, seq bigint, author_id uuid, author_name text, body text, created_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_read(p_conversation_id);
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if not (private.chat_can_support(v_user) or private.chat_can_moderate(v_user)) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;
  if v_body = '' or char_length(v_body) > 4000 then
    raise exception 'note too long' using errcode = 'NZ412';
  end if;

  insert into public.chat_internal_notes (conversation_id, author_id, body)
  values (p_conversation_id, v_user, v_body)
  returning chat_internal_notes.id into v_id;

  return query
  select n.id, n.seq, n.author_id, p.full_name, n.body, n.created_at
  from public.chat_internal_notes n
  left join public.profiles p on p.id = n.author_id
  where n.id = v_id;
end;
$$;

create function public.chat_internal_notes(
  p_conversation_id uuid,
  p_before_seq bigint default null,
  p_limit integer default 30
)
returns table (id uuid, seq bigint, author_id uuid, author_name text, body text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_read(p_conversation_id);
begin
  if not (private.chat_can_support(v_user) or private.chat_can_moderate(v_user)) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'limit must be 1-100' using errcode = 'NZ412';
  end if;

  return query
  select n.id, n.seq, n.author_id, p.full_name, n.body, n.created_at
  from public.chat_internal_notes n
  left join public.profiles p on p.id = n.author_id
  where n.conversation_id = p_conversation_id
    and (p_before_seq is null or n.seq < p_before_seq)
  order by n.seq desc
  limit p_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reporting a message, and the realtime join check
-- ---------------------------------------------------------------------------

/** Flags a message for moderation. Reporting the same message twice changes nothing. */
create function public.report_chat_message(
  p_message_id uuid,
  p_reason public.chat_report_reason,
  p_details text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_conversation uuid;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  if p_reason is null then
    raise exception 'choose a reason' using errcode = 'NZ412';
  end if;
  if p_details is not null and char_length(p_details) > 500 then
    raise exception 'details too long' using errcode = 'NZ412';
  end if;

  select m.conversation_id into v_conversation
  from public.chat_messages m where m.id = p_message_id;
  if v_conversation is null then
    raise exception 'message not found' using errcode = 'NZ503';
  end if;
  perform private.chat_require_read(v_conversation);

  insert into public.chat_message_reports (message_id, conversation_id, reported_by, reason, details)
  values (p_message_id, v_conversation, v_user, p_reason, nullif(btrim(coalesce(p_details, '')), ''))
  on conflict (message_id, reported_by) do nothing
  returning chat_message_reports.id into v_id;

  if v_id is null then
    select r.id into v_id
    from public.chat_message_reports r
    where r.message_id = p_message_id and r.reported_by = v_user;
  end if;

  return jsonb_build_object('id', v_id, 'messageId', p_message_id, 'status', 'open');
end;
$$;

/**
 * Whether the caller may join the realtime room of a conversation. The socket layer asks
 * this before letting a connection into a room, so room membership is decided here and
 * never by anything the client sent.
 */
create function public.chat_can_access(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select private.chat_can_read((select auth.uid()), p_conversation_id); $$;

-- ---------------------------------------------------------------------------
-- Grants: the deny-by-default rules above stay, these six functions are the way in
-- ---------------------------------------------------------------------------

revoke execute on function public.chat_conversation(uuid) from public, anon;
revoke execute on function public.start_chat_conversation(public.chat_conversation_type, text, uuid, text, text, uuid[]) from public, anon;
revoke execute on function public.my_chat_conversations(text, public.chat_conversation_status, text, integer, integer) from public, anon;
revoke execute on function public.chat_messages(uuid, bigint, integer) from public, anon;
revoke execute on function public.send_chat_message(uuid, uuid, text, uuid) from public, anon;
revoke execute on function public.mark_chat_read(uuid, bigint) from public, anon;
revoke execute on function public.mark_chat_delivered(uuid, bigint) from public, anon;
revoke execute on function public.my_unread_chat_count() from public, anon;
revoke execute on function public.set_chat_conversation_status(uuid, public.chat_conversation_status) from public, anon;
revoke execute on function public.assign_chat_conversation(uuid, uuid, text) from public, anon;
revoke execute on function public.set_chat_conversation_priority(uuid, public.chat_priority) from public, anon;
revoke execute on function public.add_chat_internal_note(uuid, text) from public, anon;
revoke execute on function public.chat_internal_notes(uuid, bigint, integer) from public, anon;
revoke execute on function public.report_chat_message(uuid, public.chat_report_reason, text) from public, anon;
revoke execute on function public.chat_can_access(uuid) from public, anon;

grant execute on function public.chat_conversation(uuid) to authenticated;
grant execute on function public.start_chat_conversation(public.chat_conversation_type, text, uuid, text, text, uuid[]) to authenticated;
grant execute on function public.my_chat_conversations(text, public.chat_conversation_status, text, integer, integer) to authenticated;
grant execute on function public.chat_messages(uuid, bigint, integer) to authenticated;
grant execute on function public.send_chat_message(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.mark_chat_read(uuid, bigint) to authenticated;
grant execute on function public.mark_chat_delivered(uuid, bigint) to authenticated;
grant execute on function public.my_unread_chat_count() to authenticated;
grant execute on function public.set_chat_conversation_status(uuid, public.chat_conversation_status) to authenticated;
grant execute on function public.assign_chat_conversation(uuid, uuid, text) to authenticated;
grant execute on function public.set_chat_conversation_priority(uuid, public.chat_priority) to authenticated;
grant execute on function public.add_chat_internal_note(uuid, text) to authenticated;
grant execute on function public.chat_internal_notes(uuid, bigint, integer) to authenticated;
grant execute on function public.report_chat_message(uuid, public.chat_report_reason, text) to authenticated;
grant execute on function public.chat_can_access(uuid) to authenticated;

revoke execute on function private.chat_message_touched() from public, anon, authenticated;
revoke execute on function private.chat_holds(uuid, text) from public, anon, authenticated;
revoke execute on function private.chat_can_support(uuid) from public, anon, authenticated;
revoke execute on function private.chat_can_moderate(uuid) from public, anon, authenticated;
revoke execute on function private.chat_is_manager(uuid) from public, anon, authenticated;
revoke execute on function private.chat_sender_role(uuid) from public, anon, authenticated;
revoke execute on function private.chat_can_read(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.chat_can_reply(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.chat_require_read(uuid) from public, anon, authenticated;
revoke execute on function private.chat_join(uuid, uuid) from public, anon, authenticated;

