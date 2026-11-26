-- Unified communication, Phase 2: automation, templates, internal team chat, attachments,
-- analytics and the moderator review queue.
--
-- Phase 1 built the conversation log. Phase 2 adds the machinery that works on top of it
-- without changing how a message is stored or read:
--
--   * Message templates — approved wording, in English or Bangla, with a fixed variable
--     vocabulary so a template can never interpolate arbitrary data.
--   * Automation rules — declarative triggers plus a bounded action list, evaluated by one
--     function so a rule can never run arbitrary SQL.
--   * Automation runs and jobs — an audit trail of what fired, and a durable queue for the
--     actions a rule wants to run later.
--   * Internal team chat — the Phase 1 `internal_direct` / `internal_group` kinds gain a
--     department, so the same conversation model serves staff-to-staff talk.
--   * Attachments — object keys only. The bytes live in R2; the database records what was
--     promised, by whom, and whether the message that carries it was actually posted.
--   * Support quality — first response time, CSAT, tags, pins, saved replies and reactions,
--     all derived from rows that already exist rather than new mutable counters.
--
-- Design notes
-- ------------
-- * Same deny-by-default posture as Phase 1: RLS on, no policy, no table privilege for
--   `anon` or `authenticated`. Every read and write is a security-definer function.
-- * Automation is data, never code. A rule stores a trigger name, a small JSONB condition
--   document and a JSONB array of actions drawn from a closed vocabulary. The engine
--   interprets them; there is no dynamic SQL, no `execute format(...)` of a client value.
-- * The engine is `private.chat_automation_apply`, so it cannot be reached over PostgREST at
--   all. Only triggers and the permission-checked RPCs call it.
-- * A run is deduplicated by `dedupe_key`, which is what makes the trigger-driven engine
--   idempotent: a retried transaction or a double-fired event cannot send the same automatic
--   reply twice.
-- * Delayed actions are rows in `chat_automation_jobs`. The database can be relied on to
--   claim a job exactly once; the worker that drains it is a separate, optional process.

-- ---------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------

create type public.chat_template_category as enum (
  'greeting',
  'order_update',
  'shipping',
  'returns',
  'payment',
  'closing',
  'internal',
  'other'
);

create type public.chat_template_locale as enum ('en', 'bn');

create type public.chat_automation_trigger as enum (
  'conversation_created',
  'message_received',
  'conversation_resolved',
  'conversation_reopened',
  'priority_changed',
  'assignee_changed',
  'order_status_changed',
  'return_status_changed',
  'refund_status_changed',
  'csat_received'
);

create type public.chat_automation_run_status as enum ('applied', 'skipped', 'failed');

create type public.chat_automation_job_status as enum ('pending', 'running', 'done', 'failed');

create type public.chat_attachment_status as enum ('pending', 'attached', 'discarded');

create type public.chat_saved_reply_visibility as enum ('personal', 'shared');

-- ---------------------------------------------------------------------------
-- Chat permissions
--
-- Phase 1 reused `admin_workspace.access` / `moderator_workspace.access`, which is right for
-- "may open the inbox". Phase 2 separates the operations that change what the inbox does:
-- editing approved wording, editing automation, reading analytics and deciding a report are
-- four different kinds of trust and are granted separately.
-- ---------------------------------------------------------------------------

insert into public.permissions (name, description) values
  ('chat.templates.manage', 'Create, edit and archive customer-facing message templates.'),
  ('chat.automation.manage', 'Create, edit, test and disable automation rules.'),
  ('chat.analytics.read', 'Read conversation volume, response times and satisfaction reports.'),
  ('chat.reports.review', 'Review reported messages and decide the moderation outcome.'),
  ('chat.internal.use', 'Open and take part in internal staff conversations.')
on conflict (name) do nothing;

insert into public.role_permissions (role, permission) values
  ('super_admin', 'chat.templates.manage'),
  ('super_admin', 'chat.automation.manage'),
  ('super_admin', 'chat.analytics.read'),
  ('super_admin', 'chat.reports.review'),
  ('super_admin', 'chat.internal.use'),
  ('admin', 'chat.templates.manage'),
  ('admin', 'chat.automation.manage'),
  ('admin', 'chat.analytics.read'),
  ('admin', 'chat.reports.review'),
  ('admin', 'chat.internal.use'),
  ('staff', 'chat.internal.use'),
  ('moderator', 'chat.reports.review'),
  ('moderator', 'chat.internal.use')
on conflict (role, permission) do nothing;

-- ---------------------------------------------------------------------------
-- chat_message_templates
-- ---------------------------------------------------------------------------

create table public.chat_message_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  category public.chat_template_category not null default 'other',
  locale public.chat_template_locale not null default 'en',
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  description text check (description is null or char_length(description) <= 300),
  -- The variables this template actually uses, extracted on write. A template may only use
  -- names from the closed vocabulary the API documents, which is what keeps rendering safe.
  variables text[] not null default '{}',
  is_active boolean not null default true,
  usage_count integer not null default 0 check (usage_count >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.chat_message_templates is 'Approved customer-facing wording. Staff pick one instead of typing the same answer again.';
comment on column public.chat_message_templates.variables is 'Variable names used by the body, as {name} placeholders. Filled by the server from the conversation, never from client input.';

create unique index chat_message_templates_name_locale_idx
  on public.chat_message_templates (lower(btrim(name)), locale);
create index chat_message_templates_active_idx
  on public.chat_message_templates (is_active, category, name);

create trigger chat_message_templates_set_updated_at
  before update on public.chat_message_templates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- chat_automation_rules
-- ---------------------------------------------------------------------------

create table public.chat_automation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (description is null or char_length(description) <= 300),
  trigger public.chat_automation_trigger not null,
  -- Conditions are an AND of the keys present: {"kinds": [...], "statuses": [...],
  -- "priorities": [...], "keywords": [...], "orderStatuses": [...], "minMessages": n}.
  conditions jsonb not null default '{}'::jsonb check (jsonb_typeof(conditions) = 'object'),
  -- Actions are an ordered list drawn from the closed vocabulary the engine understands.
  actions jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array'),
  -- Lower runs first. `stop_processing` lets a broad rule shadow the ones behind it.
  position integer not null default 100 check (position between 0 and 100000),
  stop_processing boolean not null default false,
  -- A rule cannot fire more than once per conversation inside this window.
  cooldown_seconds integer not null default 0 check (cooldown_seconds between 0 and 2592000),
  is_active boolean not null default true,
  run_count integer not null default 0 check (run_count >= 0),
  last_run_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.chat_automation_rules is 'Declarative when-this-then-that rules. The action vocabulary is closed: no rule can run arbitrary SQL.';
comment on column public.chat_automation_rules.conditions is 'An AND of the keys present. An absent key matches everything.';
comment on column public.chat_automation_rules.cooldown_seconds is 'Minimum gap between two automatic replies from this rule in the same conversation.';

create unique index chat_automation_rules_name_idx on public.chat_automation_rules (lower(btrim(name)));
create index chat_automation_rules_trigger_idx
  on public.chat_automation_rules (trigger, position) where is_active;

create trigger chat_automation_rules_set_updated_at
  before update on public.chat_automation_rules
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- chat_automation_runs — what fired, and what it did
-- ---------------------------------------------------------------------------

create table public.chat_automation_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.chat_automation_rules (id) on delete cascade,
  conversation_id uuid references public.chat_conversations (id) on delete cascade,
  trigger public.chat_automation_trigger not null,
  status public.chat_automation_run_status not null,
  -- "<trigger>:<rule>:<conversation>:<event key>". Unique, so a re-run of the same event is
  -- a no-op instead of a second automatic reply.
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 400),
  actions_taken jsonb not null default '[]'::jsonb,
  error text check (error is null or char_length(error) <= 500),
  created_at timestamptz not null default now()
);

comment on table public.chat_automation_runs is 'Append-only log of automation attempts, including the skipped and the failed ones.';

create unique index chat_automation_runs_dedupe_idx on public.chat_automation_runs (dedupe_key);
create index chat_automation_runs_recent_idx on public.chat_automation_runs (created_at desc);
create index chat_automation_runs_rule_idx on public.chat_automation_runs (rule_id, created_at desc);

-- ---------------------------------------------------------------------------
-- chat_automation_jobs — the actions a rule asked for later
-- ---------------------------------------------------------------------------

create table public.chat_automation_jobs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references public.chat_automation_rules (id) on delete cascade,
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  trigger public.chat_automation_trigger not null,
  actions jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array'),
  run_at timestamptz not null default now(),
  status public.chat_automation_job_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  locked_until timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  created_at timestamptz not null default now()
);

comment on table public.chat_automation_jobs is 'Actions scheduled for later. Claimed with a row lock so two workers never run the same job.';

create index chat_automation_jobs_due_idx
  on public.chat_automation_jobs (run_at) where status = 'pending';

-- ---------------------------------------------------------------------------
-- chat_saved_replies — a staff member's own shortcuts, plus shared ones
-- ---------------------------------------------------------------------------

create table public.chat_saved_replies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles (id) on delete cascade,
  visibility public.chat_saved_reply_visibility not null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  shortcut text check (shortcut is null or shortcut ~ '^/[a-z0-9_-]{1,24}$'),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  usage_count integer not null default 0 check (usage_count >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A personal reply always has an owner; a shared one never does.
  constraint chat_saved_replies_owner_matches_visibility check (
    (visibility = 'personal' and owner_id is not null)
    or (visibility = 'shared' and owner_id is null)
  )
);

comment on table public.chat_saved_replies is 'Canned answers. A personal reply is re-usable by its owner only; a shared reply by anyone who can reply in the queue.';

create unique index chat_saved_replies_shared_shortcut_idx
  on public.chat_saved_replies (shortcut)
  where visibility = 'shared' and shortcut is not null;
create unique index chat_saved_replies_personal_shortcut_idx
  on public.chat_saved_replies (owner_id, shortcut)
  where owner_id is not null and shortcut is not null;
create index chat_saved_replies_scope_idx
  on public.chat_saved_replies (visibility, is_active, title);

create trigger chat_saved_replies_set_updated_at
  before update on public.chat_saved_replies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------------

create table public.chat_tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (slug ~ '^[a-z0-9-]{2,32}$'),
  label text not null check (char_length(btrim(label)) between 1 and 40),
  description text check (description is null or char_length(description) <= 200),
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.chat_tags is 'Operational labels for a conversation: vip, refund, delivery-delay. Chosen by staff, never by the customer.';

create unique index chat_tags_slug_idx on public.chat_tags (lower(slug));

create table public.chat_conversation_tags (
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  tag_id uuid not null references public.chat_tags (id) on delete cascade,
  added_by uuid references public.profiles (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (conversation_id, tag_id)
);

comment on table public.chat_conversation_tags is 'Which tags a conversation carries, and who applied them.';

create index chat_conversation_tags_tag_idx on public.chat_conversation_tags (tag_id);

-- ---------------------------------------------------------------------------
-- Attachments — the record, never the bytes
-- ---------------------------------------------------------------------------

create table public.chat_attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  -- Null until the message that carries this attachment is posted, so an orphan never
  -- becomes visible in a thread.
  message_id uuid references public.chat_messages (id) on delete cascade,
  uploader_id uuid references public.profiles (id) on delete set null,
  object_key text not null check (char_length(object_key) between 1 and 300),
  file_name text not null check (char_length(btrim(file_name)) between 1 and 200),
  content_type text not null check (content_type ~ '^[a-z]+/[a-z0-9.+-]+$'),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 10485760),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  status public.chat_attachment_status not null default 'pending',
  created_at timestamptz not null default now(),
  attached_at timestamptz,
  constraint chat_attachments_attached_has_message check (
    (status = 'attached' and message_id is not null and attached_at is not null)
    or (status <> 'attached')
  )
);

comment on table public.chat_attachments is 'One uploaded file promised to a conversation. The bytes are in Cloudflare R2 under object_key; only an attached row is shown in a thread.';

create unique index chat_attachments_object_key_idx on public.chat_attachments (object_key);
create index chat_attachments_message_idx on public.chat_attachments (message_id);
create index chat_attachments_pending_idx
  on public.chat_attachments (uploader_id, created_at desc) where status = 'pending';

-- ---------------------------------------------------------------------------
-- CSAT — one rating per conversation, from its customer
-- ---------------------------------------------------------------------------

create table public.chat_csat_responses (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  customer_id uuid references public.profiles (id) on delete set null,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  constraint chat_csat_responses_one_per_conversation unique (conversation_id)
);

comment on table public.chat_csat_responses is 'The customer satisfaction rating for one conversation. One per conversation, and only the customer may leave it.';

create index chat_csat_responses_recent_idx on public.chat_csat_responses (created_at desc);

-- ---------------------------------------------------------------------------
-- Reactions — a small, bounded acknowledgement
-- ---------------------------------------------------------------------------

create table public.chat_message_reactions (
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

comment on table public.chat_message_reactions is 'One emoji per person per message. Removed by deleting the row.';

-- ---------------------------------------------------------------------------
-- Phase 1 tables gain the columns Phase 2 measures
-- ---------------------------------------------------------------------------

alter table public.chat_conversations
  add column first_response_at timestamptz,
  add column last_customer_message_at timestamptz,
  add column last_staff_message_at timestamptz,
  add column csat_rating smallint check (csat_rating is null or csat_rating between 1 and 5),
  add column escalated_at timestamptz,
  add column closed_by uuid references public.profiles (id) on delete set null,
  -- Automation can be paused on a single thread without disabling a global rule.
  add column automation_paused boolean not null default false,
  -- Which team a staff-only thread belongs to. Null for customer and moderation threads.
  add column department text check (department is null or department ~ '^[a-z0-9-]{1,40}$');

comment on column public.chat_conversations.first_response_at is 'When a staff or moderator member first replied. Null while the customer is still waiting.';
comment on column public.chat_conversations.csat_rating is 'Denormalised copy of chat_csat_responses.rating, so the queue can sort by satisfaction.';
comment on column public.chat_conversations.department is 'Team a staff-only thread belongs to. Customer threads are routed by the support queue instead.';

create index chat_conversations_waiting_idx
  on public.chat_conversations (created_at)
  where first_response_at is null and status in ('open', 'pending');
create index chat_conversations_department_idx
  on public.chat_conversations (department, last_message_at desc)
  where department is not null;

alter table public.chat_messages
  add column pinned_at timestamptz,
  add column pinned_by uuid references public.profiles (id) on delete set null,
  -- Accounts named with @ inside an internal thread. Filled by the server from the body.
  add column mentions uuid[];

comment on column public.chat_messages.pinned_at is 'Set when staff pin the message to the top of the thread.';
comment on column public.chat_messages.mentions is 'Internal threads only: the participants named in the body, for notification and highlighting.';

create index chat_messages_pinned_idx
  on public.chat_messages (conversation_id, pinned_at desc)
  where pinned_at is not null;

-- The moderator workspace already had a report table; Phase 2 adds the decision it needs to
-- actually close a case.
alter table public.chat_message_reports
  add column action_taken text check (
    action_taken is null or action_taken in ('message_deleted', 'member_warned', 'no_action', 'escalated')
  );

comment on column public.chat_message_reports.action_taken is 'What the reviewer did, when they closed the report.';

-- Internal staff notifications need two new kinds and one new entity type.
alter type public.staff_notification_kind add value if not exists 'chat_message';
alter type public.staff_notification_kind add value if not exists 'chat_escalation';

alter table public.staff_notifications drop constraint staff_notifications_entity_type_check;
alter table public.staff_notifications
  add constraint staff_notifications_entity_type_check
  check (entity_type in ('order', 'product', 'return', 'refund', 'conversation'));

-- ---------------------------------------------------------------------------
-- Deny by default
-- ---------------------------------------------------------------------------

alter table public.chat_message_templates enable row level security;
alter table public.chat_automation_rules enable row level security;
alter table public.chat_automation_runs enable row level security;
alter table public.chat_automation_jobs enable row level security;
alter table public.chat_saved_replies enable row level security;
alter table public.chat_tags enable row level security;
alter table public.chat_conversation_tags enable row level security;
alter table public.chat_attachments enable row level security;
alter table public.chat_csat_responses enable row level security;
alter table public.chat_message_reactions enable row level security;

revoke all on public.chat_message_templates from anon, authenticated;
revoke all on public.chat_automation_rules from anon, authenticated;
revoke all on public.chat_automation_runs from anon, authenticated;
revoke all on public.chat_automation_jobs from anon, authenticated;
revoke all on public.chat_saved_replies from anon, authenticated;
revoke all on public.chat_tags from anon, authenticated;
revoke all on public.chat_conversation_tags from anon, authenticated;
revoke all on public.chat_attachments from anon, authenticated;
revoke all on public.chat_csat_responses from anon, authenticated;
revoke all on public.chat_message_reactions from anon, authenticated;

