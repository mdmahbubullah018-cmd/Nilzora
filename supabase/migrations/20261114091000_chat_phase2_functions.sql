-- Unified communication, Phase 2: the functions behind templates, saved replies, tags,
-- attachments, satisfaction, automation, analytics and the moderator review queue.
--
-- Everything here follows the Phase 1 contract: security definer, `set search_path = ''`,
-- authorization from `auth.uid()` plus `private.permissions_of`, and a custom SQLSTATE for
-- every refusal so the API can answer with a stable code instead of a message.

-- ---------------------------------------------------------------------------
-- Authorization helpers
-- ---------------------------------------------------------------------------

/** The caller, once they are known to hold `p_permission`. Raises NZ403 otherwise. */
create function private.chat_require_permission(p_permission text)
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
  if not exists (
    select 1 from public.profiles p where p.id = v_user and p.status = 'active'
  ) then
    raise exception 'account suspended' using errcode = 'NZ410';
  end if;
  if not private.chat_holds(v_user, p_permission) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;
  return v_user;
end;
$$;

/** Whether one of the permissions in the list is held. */
create function private.chat_holds_any(p_user uuid, p_permissions text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from unnest(coalesce(p_permissions, array[]::text[])) as want (name)
    where private.chat_holds(p_user, want.name)
  );
$$;

-- ---------------------------------------------------------------------------
-- Templates: a closed variable vocabulary, so rendering is never string substitution of
-- client data
-- ---------------------------------------------------------------------------

/**
 * The variables a template may name. Keeping this list in one place is what makes
 * `private.chat_render` safe: anything outside it is rejected when the template is saved,
 * so a stored template can only ever interpolate a value the server itself put in the
 * context.
 */
create function private.chat_template_vocabulary()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'customer_name',
    'agent_name',
    'store_name',
    'order_number',
    'order_status',
    'payment_status',
    'product_name',
    'return_status',
    'refund_status',
    'support_hours'
  ]::text[];
$$;

/** The `{name}` placeholders a body uses, deduplicated and sorted. */
create function private.chat_template_variables(p_body text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    array(
      select distinct m[1]
      from regexp_matches(coalesce(p_body, ''), '\{([a-z_]{2,32})\}', 'g') as m
      order by m[1]
    ),
    array[]::text[]
  );
$$;

/**
 * Rejects a body that names a variable the vocabulary does not define, so a stale
 * `{order_id}` can never leak a raw placeholder to a customer. Raises NZ512.
 */
create function private.chat_check_template_body(p_body text)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_used text[] := private.chat_template_variables(p_body);
  v_unknown text[];
begin
  if p_body is null or btrim(p_body) = '' then
    raise exception 'template body is required' using errcode = 'NZ508';
  end if;
  select coalesce(array_agg(v order by v), array[]::text[]) into v_unknown
  from unnest(v_used) as v
  where v <> all (private.chat_template_vocabulary());
  if cardinality(v_unknown) > 0 then
    raise exception 'unknown template variable: %', array_to_string(v_unknown, ', ')
      using errcode = 'NZ512';
  end if;
  return v_used;
end;
$$;

/**
 * Fills a template body from a context the server built. A placeholder with no value in the
 * context renders as the empty string rather than the literal braces, and any placeholder
 * that survives means the stored template drifted from the vocabulary: NZ512.
 */
create function private.chat_render(p_body text, p_context jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_body text := coalesce(p_body, '');
  v_name text;
  v_value text;
begin
  foreach v_name in array private.chat_template_vocabulary() loop
    v_value := coalesce(nullif(btrim(p_context ->> v_name), ''), '');
    v_body := replace(v_body, '{' || v_name || '}', v_value);
  end loop;
  if position('{' in v_body) > 0 and private.chat_template_variables(v_body) <> array[]::text[] then
    raise exception 'template has an unresolved variable' using errcode = 'NZ512';
  end if;
  return btrim(v_body);
end;
$$;

/**
 * The values a template may use for one conversation. Built from rows, never from the
 * request body, so `{order_number}` is the thread's real order or nothing at all.
 */
create function private.chat_template_context(p_conversation_id uuid, p_viewer uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
begin
  select jsonb_build_object(
    'customer_name', coalesce(cu.full_name, ''),
    'agent_name', coalesce(me.full_name, ''),
    'store_name', coalesce((select sp.display_name from public.store_profile sp limit 1), 'Nilzora'),
    'order_number', coalesce(o.order_number, ''),
    'order_status', coalesce(o.status::text, ''),
    'payment_status', coalesce(o.payment_status::text, ''),
    'product_name', coalesce(pr.name, ''),
    'return_status', coalesce((
      select r.status::text from public.return_requests r
      where r.order_id = c.order_id order by r.requested_at desc limit 1
    ), ''),
    'refund_status', coalesce((
      select f.status::text from public.refunds f
      where f.order_id = c.order_id order by f.requested_at desc limit 1
    ), ''),
    'support_hours', coalesce((select sp.business_hours from public.store_profile sp limit 1), '')
  )
  into v_context
  from public.chat_conversations c
  left join public.profiles cu on cu.id = c.customer_id
  left join public.profiles me on me.id = p_viewer
  left join public.orders o on o.id = c.order_id
  left join public.products pr on pr.id = c.product_id
  where c.id = p_conversation_id;

  return coalesce(v_context, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Templates, as staff use them
-- ---------------------------------------------------------------------------

/** Every template, archived ones included only when asked for. */
create function public.chat_message_templates(p_include_archived boolean default false)
returns table (
  id uuid,
  name text,
  category public.chat_template_category,
  locale public.chat_template_locale,
  body text,
  description text,
  variables text[],
  is_active boolean,
  usage_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_permission('admin_workspace.access');
begin
  return query
  select t.id, t.name, t.category, t.locale, t.body, t.description, t.variables,
         t.is_active, t.usage_count, t.created_at, t.updated_at
  from public.chat_message_templates t
  where coalesce(p_include_archived, false) or t.is_active
  order by t.category, t.name;
end;
$$;

/**
 * Creates or updates a template. The body is validated before it is stored, so a template
 * that names an unknown variable is refused rather than saved and broken later.
 */
create function public.save_chat_message_template(
  p_id uuid,
  p_name text,
  p_category public.chat_template_category,
  p_locale public.chat_template_locale,
  p_body text,
  p_description text default null,
  p_is_active boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_permission('chat.templates.manage');
  v_variables text[] := private.chat_check_template_body(p_body);
  v_row public.chat_message_templates;
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 then
    raise exception 'template name must be 1-120 characters' using errcode = 'NZ412';
  end if;
  -- The unique index is on (lower(name), locale); checking here keeps a duplicate a clear
  -- refusal instead of an unexplained 503.
  if exists (
    select 1 from public.chat_message_templates t
    where lower(btrim(t.name)) = lower(btrim(p_name))
      and t.locale = coalesce(p_locale, 'en')
      and (p_id is null or t.id <> p_id)
  ) then
    raise exception 'template not found' using errcode = 'NZ513';
  end if;

  if p_id is null then
    insert into public.chat_message_templates (
      name, category, locale, body, description, variables, is_active, created_by, updated_by
    )
    values (
      btrim(p_name), coalesce(p_category, 'other'), coalesce(p_locale, 'en'),
      btrim(p_body), nullif(btrim(coalesce(p_description, '')), ''),
      v_variables, coalesce(p_is_active, true), v_user, v_user
    )
    returning * into v_row;
  else
    update public.chat_message_templates t
    set name = btrim(p_name),
        category = coalesce(p_category, t.category),
        locale = coalesce(p_locale, t.locale),
        body = btrim(p_body),
        description = nullif(btrim(coalesce(p_description, '')), ''),
        variables = v_variables,
        is_active = coalesce(p_is_active, t.is_active),
        updated_by = v_user
    where t.id = p_id
    returning * into v_row;
    if v_row.id is null then
      raise exception 'template not found' using errcode = 'NZ513';
    end if;
  end if;

  perform private.audit(
    v_user,
    'chat_template.saved',
    'chat_message_template',
    v_row.id::text,
    jsonb_build_object('name', v_row.name, 'locale', v_row.locale, 'active', v_row.is_active)
  );

  return jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'category', v_row.category,
    'locale', v_row.locale,
    'body', v_row.body,
    'description', v_row.description,
    'variables', to_jsonb(v_row.variables),
    'isActive', v_row.is_active,
    'usageCount', v_row.usage_count,
    'createdAt', v_row.created_at,
    'updatedAt', v_row.updated_at
  );
end;
$$;

/** Archives a template. The row stays so old messages that used it remain explainable. */
create function public.archive_chat_message_template(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_permission('chat.templates.manage');
begin
  update public.chat_message_templates t
  set is_active = false, updated_by = v_user
  where t.id = p_id and t.is_active;
  if not found then
    raise exception 'template not found' using errcode = 'NZ513';
  end if;
  perform private.audit(v_user, 'chat_template.archived', 'chat_message_template', p_id::text);
end;
$$;

/**
 * Renders one template for one conversation, for a staff member about to send it. The
 * caller still sends the result as an ordinary message, so nothing reaches the customer
 * without a human pressing send.
 */
create function public.render_chat_template(p_template_id uuid, p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_read(p_conversation_id);
  v_template public.chat_message_templates;
  v_body text;
begin
  select * into v_template
  from public.chat_message_templates t
  where t.id = p_template_id and t.is_active;
  if v_template.id is null then
    raise exception 'template not found' using errcode = 'NZ513';
  end if;
  if not private.chat_can_reply(v_user, p_conversation_id) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;

  v_body := private.chat_render(
    v_template.body,
    private.chat_template_context(p_conversation_id, v_user)
  );

  return jsonb_build_object(
    'templateId', v_template.id,
    'name', v_template.name,
    'locale', v_template.locale,
    'body', v_body
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Saved replies
-- ---------------------------------------------------------------------------

/** The caller's own shortcuts plus the shared ones, which is what the composer offers. */
create function public.my_chat_saved_replies()
returns table (
  id uuid,
  visibility public.chat_saved_reply_visibility,
  title text,
  shortcut text,
  body text,
  usage_count integer,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_permission('admin_workspace.access');
begin
  return query
  select r.id, r.visibility, r.title, r.shortcut, r.body, r.usage_count, r.is_active,
         r.created_at, r.updated_at
  from public.chat_saved_replies r
  where r.is_active
    and (r.visibility = 'shared' or r.owner_id = v_user)
  order by r.visibility desc, r.title;
end;
$$;

/**
 * Creates or updates a saved reply. A personal reply belongs to the caller; publishing a
 * shared one needs the templates permission, because a shared reply is wording every staff
 * member will send.
 */
create function public.save_chat_saved_reply(
  p_id uuid,
  p_visibility public.chat_saved_reply_visibility,
  p_title text,
  p_body text,
  p_shortcut text default null,
  p_is_active boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_visibility public.chat_saved_reply_visibility := coalesce(p_visibility, 'personal');
  v_owner uuid;
  v_row public.chat_saved_replies;
begin
  if v_visibility = 'shared' then
    v_user := private.chat_require_permission('chat.templates.manage');
  else
    v_user := private.chat_require_permission('admin_workspace.access');
    v_owner := v_user;
  end if;

  if p_title is null or char_length(btrim(p_title)) not between 1 and 120 then
    raise exception 'title must be 1-120 characters' using errcode = 'NZ412';
  end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 2000 then
    raise exception 'body must be 1-2000 characters' using errcode = 'NZ412';
  end if;

  if p_id is null then
    insert into public.chat_saved_replies (
      owner_id, visibility, title, shortcut, body, is_active
    )
    values (
      v_owner, v_visibility, btrim(p_title),
      nullif(btrim(lower(coalesce(p_shortcut, ''))), ''),
      btrim(p_body), coalesce(p_is_active, true)
    )
    returning * into v_row;
  else
    update public.chat_saved_replies r
    set title = btrim(p_title),
        shortcut = nullif(btrim(lower(coalesce(p_shortcut, ''))), ''),
        body = btrim(p_body),
        is_active = coalesce(p_is_active, r.is_active)
    where r.id = p_id
      and (
        (r.visibility = 'personal' and r.owner_id = v_user)
        or (r.visibility = 'shared' and v_visibility = 'shared')
      )
    returning * into v_row;
    if v_row.id is null then
      raise exception 'saved reply not found' using errcode = 'NZ514';
    end if;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'visibility', v_row.visibility,
    'title', v_row.title,
    'shortcut', v_row.shortcut,
    'body', v_row.body,
    'usageCount', v_row.usage_count,
    'isActive', v_row.is_active,
    'createdAt', v_row.created_at,
    'updatedAt', v_row.updated_at
  );
end;
$$;

/** Removes a saved reply the caller is allowed to remove. */
create function public.delete_chat_saved_reply(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_permission('admin_workspace.access');
begin
  delete from public.chat_saved_replies r
  where r.id = p_id
    and (
      r.owner_id = v_user
      or (r.visibility = 'shared' and private.chat_holds(v_user, 'chat.templates.manage'))
    );
  if not found then
    raise exception 'saved reply not found' using errcode = 'NZ514';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------------

/** The tag catalogue, with how many conversations currently carry each one. */
create function public.chat_tags()
returns table (
  id uuid,
  slug text,
  label text,
  description text,
  is_active boolean,
  conversation_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_permission('admin_workspace.access');
begin
  return query
  select t.id, t.slug, t.label, t.description, t.is_active,
         (select count(*) from public.chat_conversation_tags ct where ct.tag_id = t.id)
  from public.chat_tags t
  order by t.label;
end;
$$;

/** Creates or updates a tag. Any support agent may add one, because a tag is an observation. */
create function public.save_chat_tag(
  p_id uuid,
  p_slug text,
  p_label text,
  p_description text default null,
  p_is_active boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_permission('admin_workspace.access');
  v_row public.chat_tags;
begin
  if p_slug is null or lower(btrim(p_slug)) !~ '^[a-z0-9-]{2,32}$' then
    raise exception 'slug must be 2-32 lowercase letters, digits or dashes' using errcode = 'NZ412';
  end if;
  if p_label is null or char_length(btrim(p_label)) not between 1 and 40 then
    raise exception 'label must be 1-40 characters' using errcode = 'NZ412';
  end if;
  -- The unique index is on `lower(slug)`, so a clash is checked here rather than surfacing
  -- as a raw constraint violation the API cannot explain.
  if exists (
    select 1 from public.chat_tags t
    where lower(t.slug) = lower(btrim(p_slug)) and (p_id is null or t.id <> p_id)
  ) then
    raise exception 'tag not found' using errcode = 'NZ515';
  end if;

  if p_id is null then
    insert into public.chat_tags (slug, label, description, is_active, created_by)
    values (
      lower(btrim(p_slug)), btrim(p_label),
      nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_is_active, true), v_user
    )
    returning * into v_row;
  else
    update public.chat_tags t
    set slug = lower(btrim(p_slug)),
        label = btrim(p_label),
        description = nullif(btrim(coalesce(p_description, '')), ''),
        is_active = coalesce(p_is_active, t.is_active)
    where t.id = p_id
    returning * into v_row;
    if v_row.id is null then
      raise exception 'tag not found' using errcode = 'NZ515';
    end if;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'slug', v_row.slug,
    'label', v_row.label,
    'description', v_row.description,
    'isActive', v_row.is_active
  );
end;
$$;

/** Replaces the whole tag set of a conversation, which is what a chip editor sends. */
create function public.set_chat_conversation_tags(p_conversation_id uuid, p_tag_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_read(p_conversation_id);
  v_wanted uuid[] := coalesce(p_tag_ids, array[]::uuid[]);
begin
  if not (private.chat_can_support(v_user) or private.chat_holds(v_user, 'chat.reports.review')) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;
  if cardinality(v_wanted) > 12 then
    raise exception 'a conversation may carry at most 12 tags' using errcode = 'NZ412';
  end if;
  if exists (
    select 1 from unnest(v_wanted) as w (id)
    where not exists (select 1 from public.chat_tags t where t.id = w.id)
  ) then
    raise exception 'tag not found' using errcode = 'NZ515';
  end if;

  delete from public.chat_conversation_tags ct
  where ct.conversation_id = p_conversation_id
    and ct.tag_id <> all (v_wanted);

  insert into public.chat_conversation_tags (conversation_id, tag_id, added_by)
  select p_conversation_id, w.id, v_user
  from unnest(v_wanted) as w (id)
  on conflict (conversation_id, tag_id) do nothing;

  return private.chat_tag_list(p_conversation_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Tags on a conversation, as JSONB, for the conversation payload
-- ---------------------------------------------------------------------------

create function private.chat_tag_list(p_conversation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('id', t.id, 'slug', t.slug, 'label', t.label) order by t.label),
    '[]'::jsonb
  )
  from public.chat_conversation_tags ct
  join public.chat_tags t on t.id = ct.tag_id
  where ct.conversation_id = p_conversation_id;
$$;

-- ---------------------------------------------------------------------------
-- Attachments
--
-- The API signs an upload for the key this function hands back, so the object key is
-- decided by the server inside the conversation's own prefix. A caller therefore cannot
-- aim an upload at another conversation or at somebody else's file.
-- ---------------------------------------------------------------------------

create function private.chat_attachment_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  -- Exactly what the API's picture pipeline can decode and re-encode. Listing a type here
  -- that the pipeline cannot handle would let a record exist for a file nothing produced.
  select array['image/jpeg', 'image/png', 'image/webp']::text[];
$$;

/** Reserves one attachment slot and answers the object key the upload must use. */
create function public.begin_chat_attachment(
  p_conversation_id uuid,
  p_object_key text,
  p_file_name text,
  p_content_type text,
  p_byte_size bigint,
  p_width integer default null,
  p_height integer default null
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
  v_pending integer;
  v_row public.chat_attachments;
begin
  if not private.chat_can_reply(v_user, p_conversation_id) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;
  if v_type <> all (private.chat_attachment_types()) then
    raise exception 'unsupported attachment type' using errcode = 'NZ516';
  end if;
  if p_byte_size is null or p_byte_size <= 0 or p_byte_size > 10485760 then
    raise exception 'attachment must be between 1 byte and 10 MB' using errcode = 'NZ517';
  end if;
  if p_file_name is null or char_length(btrim(p_file_name)) not between 1 and 200 then
    raise exception 'file name must be 1-200 characters' using errcode = 'NZ412';
  end if;
  -- The key is scoped to this conversation. A key that escapes the prefix is refused here
  -- rather than trusted because the client asked for it.
  if v_key = '' or position('chat/' || p_conversation_id::text || '/' in v_key) <> 1 then
    raise exception 'attachment key must stay inside the conversation prefix' using errcode = 'NZ518';
  end if;

  select count(*) into v_pending
  from public.chat_attachments a
  where a.conversation_id = p_conversation_id
    and a.uploader_id = v_user
    and a.status = 'pending';
  if v_pending >= 5 then
    raise exception 'too many pending attachments' using errcode = 'NZ506';
  end if;

  insert into public.chat_attachments (
    conversation_id, uploader_id, object_key, file_name, content_type, byte_size, width, height
  )
  values (
    p_conversation_id, v_user, v_key, btrim(p_file_name), v_type, p_byte_size,
    nullif(p_width, 0), nullif(p_height, 0)
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
    'status', v_row.status
  );
end;
$$;

/** Drops an upload slot the caller decided not to use. */
create function public.discard_chat_attachment(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  update public.chat_attachments a
  set status = 'discarded'
  where a.id = p_id and a.uploader_id = v_user and a.status = 'pending';
  if not found then
    raise exception 'attachment not found' using errcode = 'NZ519';
  end if;
end;
$$;

/** The attachments carried by a conversation, oldest first, as the thread renders them. */
create function public.chat_attachments(p_conversation_id uuid)
returns table (
  id uuid,
  message_id uuid,
  file_name text,
  content_type text,
  byte_size bigint,
  width integer,
  height integer,
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
         a.created_at
  from public.chat_attachments a
  where a.conversation_id = p_conversation_id
    and a.status = 'attached'
  order by a.attached_at, a.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Pins and reactions
-- ---------------------------------------------------------------------------

/** Pins a message to the top of the thread. Support staff and moderators only. */
create function public.pin_chat_message(p_message_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_conversation uuid;
  v_user uuid;
begin
  select m.conversation_id into v_conversation
  from public.chat_messages m where m.id = p_message_id;
  if v_conversation is null then
    raise exception 'message not found' using errcode = 'NZ503';
  end if;
  v_user := private.chat_require_read(v_conversation);
  if not (private.chat_can_support(v_user) or private.chat_holds(v_user, 'chat.reports.review')) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;
  update public.chat_messages m
  set pinned_at = now(), pinned_by = v_user
  where m.id = p_message_id and m.pinned_at is null;
end;
$$;

/** Removes a pin. */
create function public.unpin_chat_message(p_message_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_conversation uuid;
  v_user uuid;
begin
  select m.conversation_id into v_conversation
  from public.chat_messages m where m.id = p_message_id;
  if v_conversation is null then
    raise exception 'message not found' using errcode = 'NZ503';
  end if;
  v_user := private.chat_require_read(v_conversation);
  if not (private.chat_can_support(v_user) or private.chat_holds(v_user, 'chat.reports.review')) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;
  update public.chat_messages m
  set pinned_at = null, pinned_by = null
  where m.id = p_message_id;
end;
$$;

/** The pinned messages of a thread, newest pin first. */
create function public.chat_pinned_messages(p_conversation_id uuid)
returns table (id uuid, body text, sender_name text, pinned_at timestamptz, pinned_by_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_read(p_conversation_id);
begin
  return query
  select m.id, m.body, s.full_name, m.pinned_at, p.full_name
  from public.chat_messages m
  left join public.profiles s on s.id = m.sender_id
  left join public.profiles p on p.id = m.pinned_by
  where m.conversation_id = p_conversation_id
    and m.pinned_at is not null
    and m.deleted_at is null
  order by m.pinned_at desc;
end;
$$;

/** Adds the caller's emoji reaction, or removes it if it is already there. */
create function public.toggle_chat_message_reaction(p_message_id uuid, p_emoji text)
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

  delete from public.chat_message_reactions r
  where r.message_id = p_message_id and r.user_id = v_user and r.emoji = v_emoji;

  if found then
    v_added := false;
  else
    insert into public.chat_message_reactions (message_id, user_id, emoji)
    values (p_message_id, v_user, v_emoji);
    v_added := true;
  end if;

  return jsonb_build_object(
    'messageId', p_message_id,
    'emoji', v_emoji,
    'added', v_added,
    'summary', (
      select coalesce(jsonb_agg(jsonb_build_object('emoji', s.emoji, 'count', s.n) order by s.n desc), '[]'::jsonb)
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

/** Reaction totals for a whole thread, so one call decorates a page of messages. */
create function public.chat_message_reaction_summary(p_conversation_id uuid)
returns table (message_id uuid, emoji text, reaction_count bigint, mine boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_read(p_conversation_id);
begin
  return query
  select r.message_id, r.emoji, count(*), bool_or(r.user_id = v_user)
  from public.chat_message_reactions r
  join public.chat_messages m on m.id = r.message_id
  where m.conversation_id = p_conversation_id
  group by r.message_id, r.emoji
  order by r.message_id, count(*) desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Satisfaction
-- ---------------------------------------------------------------------------

/**
 * Records the customer's rating of a resolved conversation. Only the conversation's own
 * customer may rate it, and only once: the first answer is kept, so a complaint about the
 * rating cannot become a second rating.
 */
create function public.submit_chat_csat(
  p_conversation_id uuid,
  p_rating smallint,
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
  v_conversation public.chat_conversations;
  v_row public.chat_csat_responses;
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'rating must be 1-5' using errcode = 'NZ412';
  end if;

  select * into v_conversation from public.chat_conversations c where c.id = p_conversation_id;
  if v_conversation.id is null or v_conversation.customer_id is distinct from v_user then
    raise exception 'conversation not found' using errcode = 'NZ501';
  end if;
  if v_conversation.status not in ('resolved', 'closed') then
    raise exception 'conversation is still open' using errcode = 'NZ520';
  end if;

  insert into public.chat_csat_responses (conversation_id, customer_id, rating, comment)
  values (
    p_conversation_id, v_user, p_rating,
    nullif(btrim(coalesce(p_comment, '')), '')
  )
  on conflict (conversation_id) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row
    from public.chat_csat_responses r where r.conversation_id = p_conversation_id;
    if v_row.id is null then
      raise exception 'rating not stored' using errcode = 'NZ521';
    end if;
  end if;

  update public.chat_conversations c
  set csat_rating = v_row.rating
  where c.id = p_conversation_id and c.csat_rating is null;

  perform private.chat_automation_apply(
    'csat_received',
    p_conversation_id,
    'csat:' || v_row.id::text,
    jsonb_build_object('rating', v_row.rating, 'hasComment', v_row.comment is not null)
  );

  return jsonb_build_object(
    'conversationId', p_conversation_id,
    'rating', v_row.rating,
    'comment', v_row.comment,
    'createdAt', v_row.created_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The automation engine
--
-- One interpreter, one closed vocabulary. A rule can change the conversation, post
-- approved wording, tag, assign, escalate, notify a team, pause itself, or schedule any of
-- those for later. It cannot run SQL, call a function by name, or reach a row outside the
-- conversation it matched.
-- ---------------------------------------------------------------------------

/** Whether every condition key present in the rule holds for this event. */
create function private.chat_automation_conditions_ok(
  p_conditions jsonb,
  p_conversation public.chat_conversations,
  p_payload jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conditions jsonb := coalesce(p_conditions, '{}'::jsonb);
  v_names text[];
  v_keywords text[];
  v_text text;
  v_order_status text;
begin
  if v_conditions ? 'kinds' then
    if not exists (
      select 1 from jsonb_array_elements_text(v_conditions -> 'kinds') as k (name)
      where k.name = p_conversation.kind::text
    ) then
      return false;
    end if;
  end if;

  if v_conditions ? 'statuses' then
    if not exists (
      select 1 from jsonb_array_elements_text(v_conditions -> 'statuses') as s (name)
      where s.name = p_conversation.status::text
    ) then
      return false;
    end if;
  end if;

  if v_conditions ? 'priorities' then
    if not exists (
      select 1 from jsonb_array_elements_text(v_conditions -> 'priorities') as p (name)
      where p.name = p_conversation.priority::text
    ) then
      return false;
    end if;
  end if;

  if v_conditions ? 'minMessages' then
    if p_conversation.message_count < (v_conditions ->> 'minMessages')::integer then
      return false;
    end if;
  end if;

  if v_conditions ? 'maxMessages' then
    if p_conversation.message_count > (v_conditions ->> 'maxMessages')::integer then
      return false;
    end if;
  end if;

  if v_conditions ? 'orderStatuses' then
    v_order_status := coalesce(
      p_payload ->> 'orderStatus',
      (select o.status::text from public.orders o where o.id = p_conversation.order_id)
    );
    if v_order_status is null
      or not exists (
        select 1 from jsonb_array_elements_text(v_conditions -> 'orderStatuses') as s (name)
        where s.name = v_order_status
      ) then
      return false;
    end if;
  end if;

  if v_conditions ? 'keywords' then
    select coalesce(array_agg(lower(k.name)), array[]::text[]) into v_keywords
    from jsonb_array_elements_text(v_conditions -> 'keywords') as k (name);
    if cardinality(v_keywords) > 0 then
      v_text := lower(
        coalesce(p_payload ->> 'body', '') || ' ' || coalesce(p_conversation.subject, '')
      );
      if not exists (
        select 1 from unnest(v_keywords) as k (word)
        where position(k.word in v_text) > 0
      ) then
        return false;
      end if;
    end if;
  end if;

  return true;
end;
$$;

/** Records a team notification, deduplicated by a key derived from the triggering event. */
create function private.chat_notify_staff(
  p_recipient uuid,
  p_permission text,
  p_kind public.staff_notification_kind,
  p_title text,
  p_body text,
  p_conversation uuid,
  p_dedupe_seed text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.staff_notifications (
    recipient_id, audience_permission, kind, title, body, entity_type, entity_id,
    action_path, dedupe_key
  )
  values (
    p_recipient,
    case when p_recipient is null then coalesce(p_permission, 'admin_workspace.access') end,
    p_kind,
    left(coalesce(p_title, 'Conversation needs attention'), 120),
    left(p_body, 500),
    'conversation',
    p_conversation::text,
    '/admin/communication?conversation=' || p_conversation::text,
    'chat-auto-' || md5(p_dedupe_seed)
  )
  on conflict (dedupe_key) do nothing;
end;
$$;

/**
 * Applies one action of one rule. Answers a small JSONB record of what happened, which is
 * what the run log stores; an unsupported action is reported rather than silently dropped.
 */
create function private.chat_automation_action(
  p_rule public.chat_automation_rules,
  p_conversation_id uuid,
  p_action jsonb,
  p_payload jsonb,
  p_index integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_type text := lower(btrim(coalesce(p_action ->> 'type', '')));
  v_conversation public.chat_conversations;
  v_template public.chat_message_templates;
  v_body text;
  v_target uuid;
  v_slug text;
  v_delay integer;
begin
  select * into v_conversation from public.chat_conversations c where c.id = p_conversation_id;
  if v_conversation.id is null then
    raise exception 'conversation not found' using errcode = 'NZ501';
  end if;

  case v_type
    when 'reply_template' then
      if p_action ? 'templateId' then
        select * into v_template
        from public.chat_message_templates t
        where t.id = (p_action ->> 'templateId')::uuid and t.is_active;
      else
        select * into v_template
        from public.chat_message_templates t
        where lower(t.name) = lower(coalesce(p_action ->> 'templateName', ''))
          and t.locale = coalesce((p_action ->> 'locale')::public.chat_template_locale, 'en')
          and t.is_active;
      end if;
      if v_template.id is null then
        raise exception 'template not found' using errcode = 'NZ513';
      end if;
      v_body := private.chat_render(
        v_template.body,
        -- An automatic reply speaks to the customer, so the customer's details fill it.
        private.chat_template_context(p_conversation_id, v_conversation.customer_id)
      );
      insert into public.chat_messages (conversation_id, sender_id, sender_role, kind, body, metadata)
      values (
        p_conversation_id, null, 'system', 'automated', v_body,
        jsonb_build_object('templateId', v_template.id, 'templateName', v_template.name)
      );
      update public.chat_message_templates t set usage_count = t.usage_count + 1
      where t.id = v_template.id;

    when 'system_message' then
      v_body := btrim(coalesce(p_action ->> 'body', ''));
      if v_body = '' or char_length(v_body) > 1000 then
        raise exception 'system message must be 1-1000 characters' using errcode = 'NZ412';
      end if;
      insert into public.chat_messages (conversation_id, sender_id, sender_role, kind, body)
      values (p_conversation_id, null, 'system', 'system', v_body);

    when 'set_status' then
      update public.chat_conversations c
      set status = (p_action ->> 'value')::public.chat_conversation_status,
          resolved_at = case when p_action ->> 'value' = 'resolved' then now() else c.resolved_at end,
          closed_at = case when p_action ->> 'value' = 'closed' then now() else c.closed_at end
      where c.id = p_conversation_id;

    when 'set_priority' then
      update public.chat_conversations c
      set priority = (p_action ->> 'value')::public.chat_priority
      where c.id = p_conversation_id;

    when 'set_tags' then
      for v_slug in
        select jsonb_array_elements_text(coalesce(p_action -> 'value', '[]'::jsonb))
      loop
        insert into public.chat_conversation_tags (conversation_id, tag_id)
        select p_conversation_id, t.id
        from public.chat_tags t
        where lower(t.slug) = lower(v_slug) and t.is_active
        on conflict (conversation_id, tag_id) do nothing;
      end loop;

    when 'assign_to' then
      v_target := (p_action ->> 'userId')::uuid;
      if not exists (
        select 1 from public.profiles p where p.id = v_target and p.status = 'active'
      ) then
        raise exception 'assignee invalid' using errcode = 'NZ505';
      end if;
      update public.chat_conversations c set assignee_id = v_target where c.id = p_conversation_id;
      insert into public.chat_assignments (conversation_id, assigned_to, note)
      values (p_conversation_id, v_target, 'automation: ' || p_rule.name);

    when 'escalate' then
      update public.chat_conversations c
      set priority = 'urgent', escalated_at = coalesce(c.escalated_at, now())
      where c.id = p_conversation_id;
      perform private.chat_notify_staff(
        null,
        coalesce(p_action ->> 'permission', 'admin_workspace.access'),
        'chat_escalation',
        coalesce(p_action ->> 'title', 'Conversation escalated'),
        coalesce(p_action ->> 'body', v_conversation.subject),
        p_conversation_id,
        p_conversation_id::text || ':' || p_rule.id::text || ':escalate:' || p_index::text
      );

    when 'notify_staff' then
      perform private.chat_notify_staff(
        null,
        coalesce(p_action ->> 'permission', 'admin_workspace.access'),
        'chat_message',
        coalesce(p_action ->> 'title', 'New message in a conversation'),
        coalesce(p_action ->> 'body', v_conversation.subject),
        p_conversation_id,
        p_conversation_id::text || ':' || p_rule.id::text || ':notify:' || p_index::text
      );

    when 'pause_automation' then
      update public.chat_conversations c set automation_paused = true where c.id = p_conversation_id;

    when 'schedule' then
      v_delay := greatest(0, least(2592000, coalesce((p_action ->> 'delaySeconds')::integer, 0)));
      insert into public.chat_automation_jobs (rule_id, conversation_id, trigger, actions, run_at)
      values (
        p_rule.id, p_conversation_id, p_rule.trigger,
        coalesce(p_action -> 'actions', '[]'::jsonb),
        now() + make_interval(secs => v_delay)
      );

    else
      raise exception 'unsupported automation action: %', v_type using errcode = 'NZ509';
  end case;

  return jsonb_build_object('type', v_type, 'ok', true);
end;
$$;

/**
 * Runs every active rule for one event. Called from triggers and from the functions above,
 * never from a client request directly.
 *
 * `p_event_key` makes the call idempotent: the run log has a unique key per
 * (trigger, rule, conversation, event), so replaying the same event cannot send the same
 * automatic reply twice.
 */
create function private.chat_automation_apply(
  p_trigger public.chat_automation_trigger,
  p_conversation_id uuid,
  p_event_key text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_conversation public.chat_conversations;
  v_rule public.chat_automation_rules;
  v_run_id uuid;
  v_action jsonb;
  v_index integer;
  v_taken jsonb;
  v_key text;
begin
  -- An automatic reply is itself a message in the thread. The flag stops that message from
  -- starting another round of automation.
  if coalesce(current_setting('nilzora.chat_automation', true), '') = '1' then
    return;
  end if;
  perform set_config('nilzora.chat_automation', '1', true);

  begin
    select * into v_conversation
    from public.chat_conversations c where c.id = p_conversation_id;
    if v_conversation.id is null or v_conversation.automation_paused then
      perform set_config('nilzora.chat_automation', '', true);
      return;
    end if;

    for v_rule in
      select * from public.chat_automation_rules r
      where r.is_active and r.trigger = p_trigger
      order by r.position, r.created_at
    loop
      if not private.chat_automation_conditions_ok(v_rule.conditions, v_conversation, coalesce(p_payload, '{}'::jsonb)) then
        continue;
      end if;

      if v_rule.cooldown_seconds > 0 and exists (
        select 1 from public.chat_automation_runs x
        where x.rule_id = v_rule.id
          and x.conversation_id = p_conversation_id
          and x.status = 'applied'
          and x.created_at > now() - make_interval(secs => v_rule.cooldown_seconds)
      ) then
        continue;
      end if;

      v_key := left(
        p_trigger::text || ':' || v_rule.id::text || ':' || p_conversation_id::text || ':'
          || coalesce(nullif(btrim(p_event_key), ''), 'event'),
        400
      );

      -- The insert is the deduplication lock: a second call with the same key inserts
      -- nothing and leaves the rule alone.
      insert into public.chat_automation_runs (
        rule_id, conversation_id, trigger, status, dedupe_key
      )
      values (v_rule.id, p_conversation_id, p_trigger, 'skipped', v_key)
      on conflict (dedupe_key) do nothing
      returning id into v_run_id;

      if v_run_id is null then
        continue;
      end if;

      begin
        v_taken := '[]'::jsonb;
        v_index := 0;
        for v_action in
          select value from jsonb_array_elements(coalesce(v_rule.actions, '[]'::jsonb))
        loop
          v_taken := v_taken || jsonb_build_array(
            private.chat_automation_action(v_rule, p_conversation_id, v_action, coalesce(p_payload, '{}'::jsonb), v_index)
          );
          v_index := v_index + 1;
        end loop;

        update public.chat_automation_runs x
        set status = 'applied', actions_taken = v_taken
        where x.id = v_run_id;

        update public.chat_automation_rules r
        set run_count = r.run_count + 1, last_run_at = now()
        where r.id = v_rule.id;

        -- Reload: an action may have changed status, priority or the paused flag, and the
        -- next rule must see the conversation as it is now.
        select * into v_conversation
        from public.chat_conversations c where c.id = p_conversation_id;
        exit when v_conversation.automation_paused;
        exit when v_rule.stop_processing;
      exception
        when others then
          update public.chat_automation_runs x
          set status = 'failed', error = left(sqlerrm, 500)
          where x.id = v_run_id;
          if v_rule.stop_processing then
            exit;
          end if;
      end;
    end loop;
  exception
    when others then
      perform set_config('nilzora.chat_automation', '', true);
      raise;
  end;

  perform set_config('nilzora.chat_automation', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Sending a message with attachments, in one transaction
-- ---------------------------------------------------------------------------

/**
 * Posts a message and attaches the uploads it carries. Doing both in one function is what
 * keeps a thread honest: either the message exists and its files are attached, or neither
 * happened. An attachment-only message borrows the file name as its body.
 */
create function public.post_chat_message(
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
        'height', a.height
      ) order by a.created_at)
      from public.chat_attachments a
      where a.message_id = v_message.id
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers: keep the measures current and start the automation
-- ---------------------------------------------------------------------------

/**
 * Maintains the two clocks support is measured on and asks the automation engine to look at
 * a customer message. Named so it runs after `chat_messages_touch_conversation`, which means
 * `message_count` is already current when a rule tests `minMessages`.
 */
create function private.chat_message_watch()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null then
    return null;
  end if;

  if new.sender_role = 'customer' then
    update public.chat_conversations c
    set last_customer_message_at = new.created_at
    where c.id = new.conversation_id;
  elsif new.sender_role in ('staff', 'moderator') then
    update public.chat_conversations c
    set last_staff_message_at = new.created_at,
        first_response_at = coalesce(c.first_response_at, new.created_at)
    where c.id = new.conversation_id;
  end if;

  if new.sender_role = 'customer' then
    perform private.chat_automation_apply(
      'message_received',
      new.conversation_id,
      'msg:' || new.id::text,
      jsonb_build_object('body', coalesce(new.body, ''), 'messageId', new.id)
    );
  end if;

  return null;
end;
$$;

create trigger chat_messages_watch
  after insert on public.chat_messages
  for each row execute function private.chat_message_watch();

create function private.chat_conversation_watch_created()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.chat_automation_apply(
    'conversation_created',
    new.id,
    'created:' || new.id::text,
    jsonb_build_object('kind', new.kind, 'subject', new.subject)
  );
  return null;
end;
$$;

create trigger chat_conversations_watch_created
  after insert on public.chat_conversations
  for each row execute function private.chat_conversation_watch_created();

create function private.chat_conversation_watch_updated()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status then
    if new.status = 'resolved' then
      perform private.chat_automation_apply(
        'conversation_resolved', new.id, 'resolved:' || new.id::text || ':' || new.updated_at::text,
        jsonb_build_object('status', new.status, 'fromStatus', old.status)
      );
    elsif old.status in ('resolved', 'closed') and new.status in ('open', 'pending') then
      perform private.chat_automation_apply(
        'conversation_reopened', new.id, 'reopened:' || new.id::text || ':' || new.updated_at::text,
        jsonb_build_object('status', new.status, 'fromStatus', old.status)
      );
    end if;
  end if;

  if old.priority is distinct from new.priority then
    perform private.chat_automation_apply(
      'priority_changed', new.id, 'priority:' || new.priority::text || ':' || new.updated_at::text,
      jsonb_build_object('priority', new.priority, 'fromPriority', old.priority)
    );
  end if;

  if old.assignee_id is distinct from new.assignee_id then
    if new.assignee_id is not null then
      perform private.chat_notify_staff(
        new.assignee_id, null, 'chat_message',
        'A conversation was assigned to you',
        new.subject,
        new.id,
        new.id::text || ':assigned:' || new.updated_at::text
      );
    end if;
    perform private.chat_automation_apply(
      'assignee_changed', new.id, 'assignee:' || new.id::text || ':' || new.updated_at::text,
      jsonb_build_object('assigneeId', new.assignee_id, 'fromAssigneeId', old.assignee_id)
    );
  end if;

  return null;
end;
$$;

create trigger chat_conversations_watch_updated
  after update on public.chat_conversations
  for each row execute function private.chat_conversation_watch_updated();

/**
 * Mirrors an order's progress into the live order conversation and lets automation react to
 * it. Commerce must never fail because communication did, so this trigger records a warning
 * and lets the order update commit.
 */
create function private.chat_order_event()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_conversation uuid;
  v_number text;
begin
  select c.id into v_conversation
  from public.chat_conversations c
  where c.order_id = new.order_id
    and c.kind = 'order_support'
  order by c.last_message_at desc
  limit 1;

  if v_conversation is null then
    return null;
  end if;

  select o.order_number into v_number from public.orders o where o.id = new.order_id;

  insert into public.chat_messages (conversation_id, sender_id, sender_role, kind, body, metadata)
  values (
    v_conversation, null, 'system', 'order_event',
    format('Order %s is now %s.', coalesce(v_number, ''), new.to_status),
    jsonb_build_object(
      'orderStatus', new.to_status,
      'fromStatus', new.from_status,
      'historyId', new.id
    )
  );

  perform private.chat_automation_apply(
    'order_status_changed', v_conversation, 'order-history:' || new.id::text,
    jsonb_build_object('orderStatus', new.to_status, 'fromStatus', new.from_status)
  );

  return null;
exception
  when others then
    raise warning 'chat order event skipped for history %: %', new.id, sqlerrm;
    return null;
end;
$$;

create trigger order_status_history_chat_event
  after insert on public.order_status_history
  for each row execute function private.chat_order_event();

/** The same mirror for a return decision, on the order's live conversation. */
create function private.chat_return_event()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_conversation uuid;
begin
  select c.id into v_conversation
  from public.chat_conversations c
  where c.order_id = new.order_id and c.kind = 'order_support'
  order by c.last_message_at desc
  limit 1;

  if v_conversation is null then
    return null;
  end if;

  insert into public.chat_messages (conversation_id, sender_id, sender_role, kind, body, metadata)
  values (
    v_conversation, null, 'system', 'order_event',
    format('The return request is now %s.', new.status),
    jsonb_build_object('returnStatus', new.status, 'historyId', new.id)
  );

  perform private.chat_automation_apply(
    'return_status_changed', v_conversation, 'return-history:' || new.id::text,
    jsonb_build_object('returnStatus', new.status, 'fromStatus', new.from_status)
  );

  return null;
exception
  when others then
    raise warning 'chat return event skipped for history %: %', new.id, sqlerrm;
    return null;
end;
$$;

create trigger return_status_history_chat_event
  after insert on public.return_status_history
  for each row execute function private.chat_return_event();

/** The same mirror for a refund decision. */
create function private.chat_refund_event()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_conversation uuid;
  v_order uuid;
begin
  select f.order_id into v_order from public.refunds f where f.id = new.refund_id;
  if v_order is null then
    return null;
  end if;

  select c.id into v_conversation
  from public.chat_conversations c
  where c.order_id = v_order and c.kind = 'order_support'
  order by c.last_message_at desc
  limit 1;

  if v_conversation is null then
    return null;
  end if;

  insert into public.chat_messages (conversation_id, sender_id, sender_role, kind, body, metadata)
  values (
    v_conversation, null, 'system', 'order_event',
    format('The refund is now %s.', new.status),
    jsonb_build_object('refundStatus', new.status, 'historyId', new.id)
  );

  perform private.chat_automation_apply(
    'refund_status_changed', v_conversation, 'refund-history:' || new.id::text,
    jsonb_build_object('refundStatus', new.status, 'fromStatus', new.from_status)
  );

  return null;
exception
  when others then
    raise warning 'chat refund event skipped for history %: %', new.id, sqlerrm;
    return null;
end;
$$;

create trigger refund_status_history_chat_event
  after insert on public.refund_status_history
  for each row execute function private.chat_refund_event();

-- ---------------------------------------------------------------------------
-- The moderator review queue
-- ---------------------------------------------------------------------------

/** Reported messages, oldest first, with the message and thread they belong to. */
create function public.chat_report_queue(
  p_status public.chat_report_status default 'open',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  status public.chat_report_status,
  reason public.chat_report_reason,
  details text,
  action_taken text,
  created_at timestamptz,
  resolved_at timestamptz,
  message_id uuid,
  message_body text,
  message_sender_name text,
  message_created_at timestamptz,
  conversation_id uuid,
  conversation_subject text,
  conversation_kind public.chat_conversation_type,
  reporter_id uuid,
  reporter_name text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_permission('chat.reports.review');
begin
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset < 0 then
    raise exception 'limit must be 1-100' using errcode = 'NZ412';
  end if;

  return query
  select rep.id, rep.status, rep.reason, rep.details, rep.action_taken, rep.created_at,
         rep.resolved_at, rep.message_id, m.body, s.full_name, m.created_at,
         rep.conversation_id, c.subject, c.kind,
         rep.reported_by, rp.full_name,
         count(*) over () as total_count
  from public.chat_message_reports rep
  join public.chat_messages m on m.id = rep.message_id
  join public.chat_conversations c on c.id = rep.conversation_id
  left join public.profiles s on s.id = m.sender_id
  left join public.profiles rp on rp.id = rep.reported_by
  where p_status is null or rep.status = p_status
  order by rep.created_at, rep.id
  limit p_limit offset p_offset;
end;
$$;

/**
 * Closes a report. Deleting the message is an explicit part of the decision rather than a
 * side effect, so the record always says what the reviewer did.
 */
create function public.decide_chat_report(
  p_report_id uuid,
  p_status public.chat_report_status,
  p_action_taken text default null,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_permission('chat.reports.review');
  v_report public.chat_message_reports;
begin
  if p_status is null or p_status not in ('reviewing', 'dismissed', 'actioned') then
    raise exception 'a report is closed as dismissed or actioned' using errcode = 'NZ412';
  end if;
  if p_action_taken is not null
    and p_action_taken not in ('message_deleted', 'member_warned', 'no_action', 'escalated') then
    raise exception 'unknown report action' using errcode = 'NZ509';
  end if;

  select * into v_report from public.chat_message_reports r where r.id = p_report_id;
  if v_report.id is null then
    raise exception 'report not found' using errcode = 'NZ522';
  end if;

  if p_action_taken = 'message_deleted' then
    update public.chat_messages m
    set deleted_at = now()
    where m.id = v_report.message_id and m.deleted_at is null;
  end if;

  update public.chat_message_reports r
  set status = p_status,
      action_taken = p_action_taken,
      resolved_by = case when p_status = 'reviewing' then r.resolved_by else v_user end,
      resolved_at = case when p_status = 'reviewing' then r.resolved_at else now() end
  where r.id = p_report_id
  returning * into v_report;

  perform private.audit(
    v_user,
    'chat_report.' || p_status::text,
    'chat_message_report',
    p_report_id::text,
    jsonb_build_object(
      'conversationId', v_report.conversation_id,
      'actionTaken', p_action_taken,
      'note', left(coalesce(p_note, ''), 300)
    )
  );

  return jsonb_build_object(
    'id', v_report.id,
    'status', v_report.status,
    'actionTaken', v_report.action_taken,
    'resolvedAt', v_report.resolved_at
  );
end;
$$;

/** Hides a message from a thread. Reviewers and managers only. */
create function public.delete_chat_message(p_message_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_conversation uuid;
  v_user uuid;
begin
  select m.conversation_id into v_conversation
  from public.chat_messages m where m.id = p_message_id;
  if v_conversation is null then
    raise exception 'message not found' using errcode = 'NZ503';
  end if;
  v_user := private.chat_require_read(v_conversation);
  if not private.chat_holds_any(v_user, array['chat.reports.review', 'moderation.assign']) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;
  update public.chat_messages m
  set deleted_at = now()
  where m.id = p_message_id and m.deleted_at is null;
  perform private.audit(
    v_user, 'chat_message.deleted', 'chat_message', p_message_id::text,
    jsonb_build_object('conversationId', v_conversation)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal team chat
-- ---------------------------------------------------------------------------

/**
 * Opens a staff-only conversation. A direct thread is reused while it is still live, so two
 * colleagues keep one history instead of starting a new thread every time.
 */
create function public.start_internal_chat(
  p_kind public.chat_conversation_type,
  p_subject text,
  p_body text,
  p_participants uuid[],
  p_department text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_permission('chat.internal.use');
  v_kind public.chat_conversation_type := coalesce(p_kind, 'internal_direct');
  v_subject text := btrim(coalesce(p_subject, ''));
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_people uuid[];
  v_existing uuid;
  v_conversation public.chat_conversations;
  v_person uuid;
begin
  if v_kind not in ('internal_direct', 'internal_group') then
    raise exception 'not an internal conversation kind' using errcode = 'NZ509';
  end if;

  select coalesce(array_agg(distinct t.id order by t.id), array[]::uuid[]) into v_people
  from unnest(coalesce(p_participants, array[]::uuid[]) || v_user) as t (id)
  where t.id <> v_user;

  if exists (
    select 1 from unnest(v_people) as p (id)
    where not exists (
      select 1 from public.profiles pr where pr.id = p.id and pr.status = 'active'
    )
  ) then
    raise exception 'participant invalid' using errcode = 'NZ511';
  end if;

  if v_kind = 'internal_direct' then
    if cardinality(v_people) <> 1 then
      raise exception 'a direct conversation has exactly one other member' using errcode = 'NZ511';
    end if;
    select c.id into v_existing
    from public.chat_conversations c
    where c.kind = 'internal_direct'
      and c.status in ('open', 'pending')
      and exists (
        select 1 from public.chat_conversation_participants m
        where m.conversation_id = c.id and m.user_id = v_user
      )
      and exists (
        select 1 from public.chat_conversation_participants m
        where m.conversation_id = c.id and m.user_id = v_people[1]
      )
    limit 1;

    if v_existing is not null then
      if v_body is not null then
        perform 1;
        insert into public.chat_messages (conversation_id, sender_id, sender_role, kind, body)
        values (v_existing, v_user, private.chat_sender_role(v_user), 'text', v_body);
      end if;
      return public.chat_conversation(v_existing);
    end if;
  elsif cardinality(v_people) = 0 then
    raise exception 'a group conversation needs another member' using errcode = 'NZ511';
  end if;

  if v_subject = '' then
    if v_kind = 'internal_direct' then
      select coalesce(pr.full_name, 'Conversation') into v_subject
      from public.profiles pr where pr.id = v_people[1] or pr.id = v_user
      order by pr.id = v_user limit 1;
    else
      v_subject := 'Team conversation';
    end if;
  end if;

  insert into public.chat_conversations (
    kind, status, subject, department, created_by
  )
  values (
    v_kind, 'open', left(v_subject, 160), nullif(btrim(coalesce(p_department, '')), ''), v_user
  )
  returning * into v_conversation;

  insert into public.chat_conversation_participants (conversation_id, user_id, role)
  values (v_conversation.id, v_user, private.chat_sender_role(v_user))
  on conflict do nothing;

  foreach v_person in array v_people loop
    insert into public.chat_conversation_participants (conversation_id, user_id, role)
    values (v_conversation.id, v_person, private.chat_sender_role(v_person))
    on conflict do nothing;
  end loop;

  if v_body is not null then
    insert into public.chat_messages (conversation_id, sender_id, sender_role, kind, body)
    values (v_conversation.id, v_user, private.chat_sender_role(v_user), 'text', v_body);
  end if;

  return public.chat_conversation(v_conversation.id);
end;
$$;

/** The staff-only threads the caller is in, newest activity first. */
create function public.my_internal_channels(p_limit integer default 30, p_offset integer default 0)
returns table (
  id uuid,
  kind public.chat_conversation_type,
  status public.chat_conversation_status,
  subject text,
  department text,
  employee_count bigint,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_permission('chat.internal.use');
begin
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset < 0 then
    raise exception 'limit must be 1-100' using errcode = 'NZ412';
  end if;

  return query
  select c.id, c.kind, c.status, c.subject, c.department,
         (select count(*) from public.chat_conversation_participants m2
          where m2.conversation_id = c.id and m2.left_at is null),
         c.last_message_at, c.last_message_preview,
         (select count(*) from public.chat_messages msg
          where msg.conversation_id = c.id
            and msg.seq > coalesce(me.last_read_seq, 0)
            and msg.sender_id is distinct from v_user
            and msg.deleted_at is null),
         count(*) over ()
  from public.chat_conversations c
  join public.chat_conversation_participants me
    on me.conversation_id = c.id and me.user_id = v_user and me.left_at is null
  where c.kind in ('internal_direct', 'internal_group')
  order by c.last_message_at desc, c.id
  limit p_limit offset p_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- Search
-- ---------------------------------------------------------------------------

/**
 * Full-text-ish search over message bodies, limited to conversations the caller may read.
 * A customer searching therefore reaches only their own threads; staff reach the queue they
 * are entitled to.
 */
create function public.search_chat_messages(p_query text, p_limit integer default 20)
returns table (
  message_id uuid,
  conversation_id uuid,
  conversation_subject text,
  body text,
  sender_name text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_staff boolean;
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  if char_length(v_query) < 2 then
    raise exception 'search needs at least 2 characters' using errcode = 'NZ412';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'limit must be 1-100' using errcode = 'NZ412';
  end if;

  v_staff := private.chat_holds_any(
    v_user,
    array[
      'admin_workspace.access',
      'moderator_workspace.access',
      'chat.analytics.read',
      'chat.reports.review'
    ]
  );

  return query
  select m.id, m.conversation_id, c.subject, m.body, s.full_name, m.created_at
  from public.chat_messages m
  join public.chat_conversations c on c.id = m.conversation_id
  left join public.profiles s on s.id = m.sender_id
  where m.deleted_at is null
    and m.body is not null
    and position(v_query in lower(m.body)) > 0
    and (
      (
        c.kind in ('customer_support', 'order_support')
        and (c.customer_id = v_user or v_staff)
      )
      or (
        c.kind in ('internal_direct', 'internal_group')
        and exists (
          select 1 from public.chat_conversation_participants p
          where p.conversation_id = c.id and p.user_id = v_user and p.left_at is null
        )
      )
      or (c.kind = 'moderation' and v_staff)
    )
  order by m.seq desc
  limit p_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Analytics
-- ---------------------------------------------------------------------------

/**
 * One report for the communication dashboard: what came in, how fast it was answered, how
 * it ended, how satisfied the customers were, how much automation did, and the daily shape
 * of the period. Every number comes from rows the triggers already maintain.
 */
create function public.chat_analytics(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_permission('chat.analytics.read');
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
  v_result jsonb;
begin
  if v_from >= v_to then
    raise exception 'the period must end after it starts' using errcode = 'NZ412';
  end if;
  if v_to - v_from > interval '400 days' then
    raise exception 'the period may not exceed 400 days' using errcode = 'NZ412';
  end if;

  select jsonb_build_object(
    'range', jsonb_build_object('from', v_from, 'to', v_to),
    'conversations', jsonb_build_object(
      'created', (
        select count(*) from public.chat_conversations c
        where c.created_at between v_from and v_to
      ),
      'byKind', coalesce((
        select jsonb_object_agg(k.kind, k.n)
        from (
          select c.kind::text as kind, count(*) as n
          from public.chat_conversations c
          where c.created_at between v_from and v_to
          group by c.kind
        ) k
      ), '{}'::jsonb),
      'byStatus', coalesce((
        select jsonb_object_agg(s.status, s.n)
        from (
          select c.status::text as status, count(*) as n
          from public.chat_conversations c
          where c.created_at between v_from and v_to
          group by c.status
        ) s
      ), '{}'::jsonb),
      'waitingNow', (
        select count(*) from public.chat_conversations c
        where c.status in ('open', 'pending') and c.first_response_at is null
      ),
      'unassignedNow', (
        select count(*) from public.chat_conversations c
        where c.status in ('open', 'pending')
          and c.assignee_id is null
          and c.kind in ('customer_support', 'order_support')
      )
    ),
    'firstResponse', jsonb_build_object(
      'answered', (
        select count(*) from public.chat_conversations c
        where c.first_response_at between v_from and v_to
      ),
      'averageSeconds', coalesce((
        select round(avg(extract(epoch from (c.first_response_at - c.created_at))))::bigint
        from public.chat_conversations c
        where c.first_response_at between v_from and v_to
      ), 0),
      'p50Seconds', coalesce((
        select round(percentile_cont(0.5) within group (
          order by extract(epoch from (c.first_response_at - c.created_at))
        ))::bigint
        from public.chat_conversations c
        where c.first_response_at between v_from and v_to
      ), 0),
      'p90Seconds', coalesce((
        select round(percentile_cont(0.9) within group (
          order by extract(epoch from (c.first_response_at - c.created_at))
        ))::bigint
        from public.chat_conversations c
        where c.first_response_at between v_from and v_to
      ), 0)
    ),
    'resolution', jsonb_build_object(
      'resolved', (
        select count(*) from public.chat_conversations c
        where c.resolved_at between v_from and v_to
      ),
      'averageSeconds', coalesce((
        select round(avg(extract(epoch from (c.resolved_at - c.created_at))))::bigint
        from public.chat_conversations c
        where c.resolved_at between v_from and v_to
      ), 0)
    ),
    'messages', jsonb_build_object(
      'total', (
        select count(*) from public.chat_messages m
        where m.created_at between v_from and v_to and m.deleted_at is null
      ),
      'fromCustomers', (
        select count(*) from public.chat_messages m
        where m.created_at between v_from and v_to
          and m.deleted_at is null and m.sender_role = 'customer'
      ),
      'fromStaff', (
        select count(*) from public.chat_messages m
        where m.created_at between v_from and v_to
          and m.deleted_at is null and m.sender_role in ('staff', 'moderator')
      ),
      'automated', (
        select count(*) from public.chat_messages m
        where m.created_at between v_from and v_to and m.kind = 'automated'
      )
    ),
    'satisfaction', jsonb_build_object(
      'responses', (
        select count(*) from public.chat_csat_responses r
        where r.created_at between v_from and v_to
      ),
      'average', coalesce((
        select round(avg(r.rating)::numeric, 2)
        from public.chat_csat_responses r
        where r.created_at between v_from and v_to
      ), 0),
      'five', (
        select count(*) from public.chat_csat_responses r
        where r.rating = 5 and r.created_at between v_from and v_to
      ),
      'four', (
        select count(*) from public.chat_csat_responses r
        where r.rating = 4 and r.created_at between v_from and v_to
      ),
      'three', (
        select count(*) from public.chat_csat_responses r
        where r.rating = 3 and r.created_at between v_from and v_to
      ),
      'two', (
        select count(*) from public.chat_csat_responses r
        where r.rating = 2 and r.created_at between v_from and v_to
      ),
      'one', (
        select count(*) from public.chat_csat_responses r
        where r.rating = 1 and r.created_at between v_from and v_to
      )
    ),
    'automation', jsonb_build_object(
      'activeRules', (
        select count(*) from public.chat_automation_rules r where r.is_active
      ),
      'applied', (
        select count(*) from public.chat_automation_runs x
        where x.status = 'applied' and x.created_at between v_from and v_to
      ),
      'failed', (
        select count(*) from public.chat_automation_runs x
        where x.status = 'failed' and x.created_at between v_from and v_to
      ),
      'skipped', (
        select count(*) from public.chat_automation_runs x
        where x.status = 'skipped' and x.created_at between v_from and v_to
      ),
      'pendingJobs', (
        select count(*) from public.chat_automation_jobs j where j.status = 'pending'
      )
    ),
    'moderation', jsonb_build_object(
      'openReports', (
        select count(*) from public.chat_message_reports r where r.status = 'open'
      ),
      'resolved', (
        select count(*) from public.chat_message_reports r
        where r.status in ('dismissed', 'actioned') and r.resolved_at between v_from and v_to
      )
    ),
    'agents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', a.id,
        'name', a.full_name,
        'conversations', a.handled,
        'resolved', a.resolved,
        'averageFirstResponseSeconds', a.avg_seconds
      ) order by a.handled desc, a.full_name)
      from (
        select p.id, p.full_name,
               count(*) as handled,
               count(*) filter (where c.status in ('resolved', 'closed')) as resolved,
               coalesce(round(avg(extract(epoch from (c.first_response_at - c.created_at))))::bigint, 0)
                 as avg_seconds
        from public.chat_conversations c
        join public.profiles p on p.id = c.assignee_id
        where c.created_at between v_from and v_to
        group by p.id, p.full_name
        order by count(*) desc
        limit 10
      ) a
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', d.day,
        'created', d.created,
        'messages', d.messages
      ) order by d.day)
      from (
        select g.day::date as day,
               (select count(*) from public.chat_conversations c where c.created_at::date = g.day::date) as created,
               (select count(*) from public.chat_messages m where m.created_at::date = g.day::date) as messages
        from generate_series(v_from::date::timestamp, v_to::date::timestamp, interval '1 day') as g (day)
        order by g.day
        limit 401
      ) d
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Automation, as the admin screen uses it
-- ---------------------------------------------------------------------------

/** The action types the engine understands. Anything else is refused when a rule is saved. */
create function private.chat_automation_action_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'reply_template',
    'system_message',
    'set_status',
    'set_priority',
    'set_tags',
    'assign_to',
    'escalate',
    'notify_staff',
    'pause_automation',
    'schedule'
  ]::text[];
$$;

/** The condition keys a rule may use. */
create function private.chat_automation_condition_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'kinds', 'statuses', 'priorities', 'keywords', 'orderStatuses', 'minMessages', 'maxMessages'
  ]::text[];
$$;

/**
 * Validates a rule before it is stored: known condition keys, known action types, templates
 * that exist, enum values that parse. A rule that cannot be interpreted never reaches the
 * table, so the engine can trust what it reads.
 */
create function private.chat_validate_automation_rule(p_conditions jsonb, p_actions jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_action jsonb;
  v_type text;
begin
  if jsonb_typeof(coalesce(p_conditions, '{}'::jsonb)) <> 'object' then
    raise exception 'conditions must be an object' using errcode = 'NZ412';
  end if;
  if jsonb_typeof(coalesce(p_actions, '[]'::jsonb)) <> 'array' then
    raise exception 'actions must be a list' using errcode = 'NZ412';
  end if;
  if jsonb_array_length(coalesce(p_actions, '[]'::jsonb)) = 0 then
    raise exception 'a rule needs at least one action' using errcode = 'NZ412';
  end if;
  if jsonb_array_length(p_actions) > 10 then
    raise exception 'a rule may have at most 10 actions' using errcode = 'NZ412';
  end if;

  for v_key in select jsonb_object_keys(coalesce(p_conditions, '{}'::jsonb)) loop
    if v_key <> all (private.chat_automation_condition_keys()) then
      raise exception 'unknown condition: %', v_key using errcode = 'NZ509';
    end if;
  end loop;

  if p_conditions ? 'statuses' then
    perform (s.name)::public.chat_conversation_status
    from jsonb_array_elements_text(p_conditions -> 'statuses') as s (name);
  end if;

  if p_conditions ? 'priorities' then
    perform (p.name)::public.chat_priority
    from jsonb_array_elements_text(p_conditions -> 'priorities') as p (name);
  end if;

  for v_action in select value from jsonb_array_elements(p_actions) loop
    if jsonb_typeof(v_action) <> 'object' then
      raise exception 'each action must be an object' using errcode = 'NZ412';
    end if;
    v_type := lower(btrim(coalesce(v_action ->> 'type', '')));
    if v_type <> all (private.chat_automation_action_types()) then
      raise exception 'unknown action: %', v_type using errcode = 'NZ509';
    end if;

    if v_type = 'reply_template' then
      if v_action ? 'templateId' then
        if not exists (
          select 1 from public.chat_message_templates t
          where t.id = (v_action ->> 'templateId')::uuid
        ) then
          raise exception 'template not found' using errcode = 'NZ513';
        end if;
      elsif not exists (
        select 1 from public.chat_message_templates t
        where lower(t.name) = lower(coalesce(v_action ->> 'templateName', ''))
      ) then
        raise exception 'template not found' using errcode = 'NZ513';
      end if;
    elsif v_type = 'set_status' then
      perform (v_action ->> 'value')::public.chat_conversation_status;
    elsif v_type = 'set_priority' then
      perform (v_action ->> 'value')::public.chat_priority;
    elsif v_type = 'schedule' then
      if jsonb_typeof(coalesce(v_action -> 'actions', '[]'::jsonb)) <> 'array'
        or jsonb_array_length(coalesce(v_action -> 'actions', '[]'::jsonb)) = 0 then
        raise exception 'a scheduled action needs nested actions' using errcode = 'NZ412';
      end if;
      perform private.chat_validate_automation_rule('{}'::jsonb, v_action -> 'actions');
    end if;
  end loop;
end;
$$;

/** Every automation rule, in the order the engine evaluates them. */
create function public.chat_automation_rules()
returns table (
  id uuid,
  name text,
  description text,
  trigger public.chat_automation_trigger,
  conditions jsonb,
  actions jsonb,
  "position" integer,
  stop_processing boolean,
  cooldown_seconds integer,
  is_active boolean,
  run_count integer,
  last_run_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_permission('chat.automation.manage');
begin
  return query
  select r.id, r.name, r.description, r.trigger, r.conditions, r.actions, r.position,
         r.stop_processing, r.cooldown_seconds, r.is_active, r.run_count, r.last_run_at,
         r.created_at, r.updated_at
  from public.chat_automation_rules r
  order by r.position, r.created_at;
end;
$$;

/** Creates or updates a rule. */
create function public.save_chat_automation_rule(
  p_id uuid,
  p_name text,
  p_trigger public.chat_automation_trigger,
  p_conditions jsonb,
  p_actions jsonb,
  p_description text default null,
  p_position integer default 100,
  p_stop_processing boolean default false,
  p_cooldown_seconds integer default 0,
  p_is_active boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_permission('chat.automation.manage');
  v_row public.chat_automation_rules;
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 then
    raise exception 'rule name must be 1-120 characters' using errcode = 'NZ412';
  end if;
  if p_trigger is null then
    raise exception 'a rule needs a trigger' using errcode = 'NZ412';
  end if;

  perform private.chat_validate_automation_rule(p_conditions, p_actions);

  if p_id is null then
    insert into public.chat_automation_rules (
      name, description, trigger, conditions, actions, position, stop_processing,
      cooldown_seconds, is_active, created_by, updated_by
    )
    values (
      btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_trigger,
      coalesce(p_conditions, '{}'::jsonb), p_actions, coalesce(p_position, 100),
      coalesce(p_stop_processing, false), coalesce(p_cooldown_seconds, 0),
      coalesce(p_is_active, true), v_user, v_user
    )
    returning * into v_row;
  else
    update public.chat_automation_rules r
    set name = btrim(p_name),
        description = nullif(btrim(coalesce(p_description, '')), ''),
        trigger = p_trigger,
        conditions = coalesce(p_conditions, '{}'::jsonb),
        actions = p_actions,
        position = coalesce(p_position, r.position),
        stop_processing = coalesce(p_stop_processing, r.stop_processing),
        cooldown_seconds = coalesce(p_cooldown_seconds, r.cooldown_seconds),
        is_active = coalesce(p_is_active, r.is_active),
        updated_by = v_user
    where r.id = p_id
    returning * into v_row;
    if v_row.id is null then
      raise exception 'automation rule not found' using errcode = 'NZ523';
    end if;
  end if;

  perform private.audit(
    v_user, 'chat_automation_rule.saved', 'chat_automation_rule', v_row.id::text,
    jsonb_build_object('name', v_row.name, 'trigger', v_row.trigger, 'active', v_row.is_active)
  );

  return jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'description', v_row.description,
    'trigger', v_row.trigger,
    'conditions', v_row.conditions,
    'actions', v_row.actions,
    'position', v_row.position,
    'stopProcessing', v_row.stop_processing,
    'cooldownSeconds', v_row.cooldown_seconds,
    'isActive', v_row.is_active,
    'runCount', v_row.run_count,
    'lastRunAt', v_row.last_run_at,
    'createdAt', v_row.created_at,
    'updatedAt', v_row.updated_at
  );
end;
$$;

/** Turns a rule on or off without editing it. */
create function public.set_chat_automation_rule_active(p_id uuid, p_is_active boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_permission('chat.automation.manage');
begin
  update public.chat_automation_rules r
  set is_active = coalesce(p_is_active, r.is_active), updated_by = v_user
  where r.id = p_id;
  if not found then
    raise exception 'automation rule not found' using errcode = 'NZ523';
  end if;
  perform private.audit(
    v_user, 'chat_automation_rule.toggled', 'chat_automation_rule', p_id::text,
    jsonb_build_object('active', p_is_active)
  );
end;
$$;

/** Removes a rule and the run history that belongs to it. */
create function public.delete_chat_automation_rule(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_permission('chat.automation.manage');
begin
  delete from public.chat_automation_rules r where r.id = p_id;
  if not found then
    raise exception 'automation rule not found' using errcode = 'NZ523';
  end if;
  perform private.audit(v_user, 'chat_automation_rule.deleted', 'chat_automation_rule', p_id::text);
end;
$$;

/** The run log, newest first, with the rule name so the screen needs one call. */
create function public.chat_automation_runs(p_limit integer default 30, p_offset integer default 0)
returns table (
  id uuid,
  rule_id uuid,
  rule_name text,
  trigger public.chat_automation_trigger,
  conversation_id uuid,
  status public.chat_automation_run_status,
  actions_taken jsonb,
  error text,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_permission('chat.automation.manage');
begin
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset < 0 then
    raise exception 'limit must be 1-100' using errcode = 'NZ412';
  end if;

  return query
  select x.id, x.rule_id, r.name, x.trigger, x.conversation_id, x.status, x.actions_taken,
         x.error, x.created_at, count(*) over ()
  from public.chat_automation_runs x
  left join public.chat_automation_rules r on r.id = x.rule_id
  order by x.created_at desc, x.id
  limit p_limit offset p_offset;
end;
$$;

/**
 * Answers whether a rule would fire for one conversation, without changing anything. This is
 * what the "test" button on the automation screen calls, so an operator can check a rule
 * against a real thread before enabling it.
 */
create function public.preview_chat_automation_rule(p_rule_id uuid, p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.chat_require_permission('chat.automation.manage');
  v_rule public.chat_automation_rules;
  v_conversation public.chat_conversations;
  v_matches boolean;
  v_reasons jsonb := '[]'::jsonb;
begin
  select * into v_rule from public.chat_automation_rules r where r.id = p_rule_id;
  if v_rule.id is null then
    raise exception 'automation rule not found' using errcode = 'NZ523';
  end if;

  select * into v_conversation
  from public.chat_conversations c where c.id = p_conversation_id;
  if v_conversation.id is null then
    raise exception 'conversation not found' using errcode = 'NZ501';
  end if;

  v_matches := private.chat_automation_conditions_ok(
    v_rule.conditions,
    v_conversation,
    -- The preview judges the rule against what the customer actually wrote, so a keyword
    -- rule can be checked without inventing a message.
    jsonb_build_object('body', coalesce((
      select string_agg(coalesce(rec.body, ''), ' ' order by rec.seq desc)
      from (
        select m.seq, m.body
        from public.chat_messages m
        where m.conversation_id = p_conversation_id
          and m.sender_role = 'customer'
          and m.deleted_at is null
        order by m.seq desc
        limit 5
      ) rec
    ), ''))
  );

  if not v_rule.is_active then
    v_reasons := v_reasons || to_jsonb('The rule is switched off.'::text);
  end if;
  if v_conversation.automation_paused then
    v_reasons := v_reasons || to_jsonb('Automation is paused on this conversation.'::text);
  end if;
  if not v_matches then
    v_reasons := v_reasons || to_jsonb('The conversation does not match the conditions.'::text);
  end if;

  return jsonb_build_object(
    'ruleId', v_rule.id,
    'conversationId', p_conversation_id,
    'wouldRun', v_rule.is_active and not v_conversation.automation_paused and v_matches,
    'actions', v_rule.actions,
    'reasons', v_reasons
  );
end;
$$;

/**
 * Drains automation jobs that are due. Called by the API worker, never by a user request:
 * the grant below gives it to `service_role` only.
 */
create function public.run_due_chat_automation_jobs(p_limit integer default 20)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_rule public.chat_automation_rules;
  v_action jsonb;
  v_index integer;
  v_ran integer := 0;
  v_failed integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'limit must be 1-100' using errcode = 'NZ412';
  end if;

  for v_job in
    select j.id, j.rule_id, j.conversation_id, j.actions, j.attempts
    from public.chat_automation_jobs j
    where j.status = 'pending'
      and j.run_at <= now()
      and (j.locked_until is null or j.locked_until < now())
    order by j.run_at, j.id
    limit p_limit
    for update skip locked
  loop
    update public.chat_automation_jobs j
    set status = 'running', attempts = j.attempts + 1, locked_until = now() + interval '60 seconds'
    where j.id = v_job.id;

    begin
      if v_job.rule_id is not null then
        select * into v_rule from public.chat_automation_rules r where r.id = v_job.rule_id;
      end if;
      if v_rule.id is null then
        raise exception 'automation rule not found' using errcode = 'NZ523';
      end if;

      v_index := 0;
      for v_action in select value from jsonb_array_elements(coalesce(v_job.actions, '[]'::jsonb)) loop
        perform private.chat_automation_action(
          v_rule, v_job.conversation_id, v_action, '{}'::jsonb, v_index
        );
        v_index := v_index + 1;
      end loop;

      update public.chat_automation_jobs j
      set status = 'done', locked_until = null, last_error = null
      where j.id = v_job.id;
      v_ran := v_ran + 1;
    exception
      when others then
        update public.chat_automation_jobs j
        set status = case when j.attempts >= 3 then 'failed' else 'pending' end,
            locked_until = null,
            last_error = left(sqlerrm, 500),
            run_at = now() + make_interval(secs => 60 * (j.attempts + 1))
        where j.id = v_job.id;
        v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object('ran', v_ran, 'failed', v_failed);
end;
$$;

-- ---------------------------------------------------------------------------
-- The conversation payload gains the Phase 2 measures
-- ---------------------------------------------------------------------------

/**
 * Same contract as Phase 1, with the fields Phase 2 measures: the two response clocks,
 * satisfaction, escalation, tags, pins and attachment counts, plus the permissions the
 * detail panel needs to decide which controls to show.
 */
create or replace function public.chat_conversation(p_conversation_id uuid)
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
      'department', c.department,
      'lastMessageAt', c.last_message_at,
      'lastMessagePreview', c.last_message_preview,
      'lastMessageSenderId', c.last_message_sender_id,
      'messageCount', c.message_count,
      'createdAt', c.created_at,
      'updatedAt', c.updated_at,
      'resolvedAt', c.resolved_at,
      'closedAt', c.closed_at,
      'firstResponseAt', c.first_response_at,
      'lastCustomerMessageAt', c.last_customer_message_at,
      'lastStaffMessageAt', c.last_staff_message_at,
      'csatRating', c.csat_rating,
      'escalatedAt', c.escalated_at,
      'automationPaused', c.automation_paused,
      'tags', private.chat_tag_list(c.id),
      'pinnedCount', (
        select count(*) from public.chat_messages m
        where m.conversation_id = c.id and m.pinned_at is not null and m.deleted_at is null
      ),
      'attachmentCount', (
        select count(*) from public.chat_attachments a
        where a.conversation_id = c.id and a.status = 'attached'
      )
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
      'canUseInternalNotes', private.chat_can_support(v_user),
      'canTag', private.chat_can_support(v_user) or private.chat_holds(v_user, 'chat.reports.review'),
      'canReviewReports', private.chat_holds(v_user, 'chat.reports.review'),
      'canManageAutomation', private.chat_holds(v_user, 'chat.automation.manage')
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
-- Privileges
--
-- Every function below is granted to `authenticated` and checks the caller itself. The
-- worker entry point is the one exception: it has no caller identity to check, so it is
-- granted to `service_role` only and is never reachable from a signed-in session.
-- ---------------------------------------------------------------------------

revoke execute on function public.chat_message_templates(boolean) from public, anon;
revoke execute on function public.save_chat_message_template(uuid, text, public.chat_template_category, public.chat_template_locale, text, text, boolean) from public, anon;
revoke execute on function public.archive_chat_message_template(uuid) from public, anon;
revoke execute on function public.render_chat_template(uuid, uuid) from public, anon;
revoke execute on function public.my_chat_saved_replies() from public, anon;
revoke execute on function public.save_chat_saved_reply(uuid, public.chat_saved_reply_visibility, text, text, text, boolean) from public, anon;
revoke execute on function public.delete_chat_saved_reply(uuid) from public, anon;
revoke execute on function public.chat_tags() from public, anon;
revoke execute on function public.save_chat_tag(uuid, text, text, text, boolean) from public, anon;
revoke execute on function public.set_chat_conversation_tags(uuid, uuid[]) from public, anon;
revoke execute on function public.begin_chat_attachment(uuid, text, text, text, bigint, integer, integer) from public, anon;
revoke execute on function public.discard_chat_attachment(uuid) from public, anon;
revoke execute on function public.chat_attachments(uuid) from public, anon;
revoke execute on function public.pin_chat_message(uuid) from public, anon;
revoke execute on function public.unpin_chat_message(uuid) from public, anon;
revoke execute on function public.chat_pinned_messages(uuid) from public, anon;
revoke execute on function public.toggle_chat_message_reaction(uuid, text) from public, anon;
revoke execute on function public.chat_message_reaction_summary(uuid) from public, anon;
revoke execute on function public.submit_chat_csat(uuid, smallint, text) from public, anon;
revoke execute on function public.post_chat_message(uuid, uuid, text, uuid[]) from public, anon;
revoke execute on function public.chat_report_queue(public.chat_report_status, integer, integer) from public, anon;
revoke execute on function public.decide_chat_report(uuid, public.chat_report_status, text, text) from public, anon;
revoke execute on function public.delete_chat_message(uuid) from public, anon;
revoke execute on function public.start_internal_chat(public.chat_conversation_type, text, text, uuid[], text) from public, anon;
revoke execute on function public.my_internal_channels(integer, integer) from public, anon;
revoke execute on function public.search_chat_messages(text, integer) from public, anon;
revoke execute on function public.chat_analytics(timestamptz, timestamptz) from public, anon;
revoke execute on function public.chat_automation_rules() from public, anon;
revoke execute on function public.save_chat_automation_rule(uuid, text, public.chat_automation_trigger, jsonb, jsonb, text, integer, boolean, integer, boolean) from public, anon;
revoke execute on function public.set_chat_automation_rule_active(uuid, boolean) from public, anon;
revoke execute on function public.delete_chat_automation_rule(uuid) from public, anon;
revoke execute on function public.chat_automation_runs(integer, integer) from public, anon;
revoke execute on function public.preview_chat_automation_rule(uuid, uuid) from public, anon;
revoke execute on function public.run_due_chat_automation_jobs(integer) from public, anon, authenticated;

grant execute on function public.chat_message_templates(boolean) to authenticated;
grant execute on function public.save_chat_message_template(uuid, text, public.chat_template_category, public.chat_template_locale, text, text, boolean) to authenticated;
grant execute on function public.archive_chat_message_template(uuid) to authenticated;
grant execute on function public.render_chat_template(uuid, uuid) to authenticated;
grant execute on function public.my_chat_saved_replies() to authenticated;
grant execute on function public.save_chat_saved_reply(uuid, public.chat_saved_reply_visibility, text, text, text, boolean) to authenticated;
grant execute on function public.delete_chat_saved_reply(uuid) to authenticated;
grant execute on function public.chat_tags() to authenticated;
grant execute on function public.save_chat_tag(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.set_chat_conversation_tags(uuid, uuid[]) to authenticated;
grant execute on function public.begin_chat_attachment(uuid, text, text, text, bigint, integer, integer) to authenticated;
grant execute on function public.discard_chat_attachment(uuid) to authenticated;
grant execute on function public.chat_attachments(uuid) to authenticated;
grant execute on function public.pin_chat_message(uuid) to authenticated;
grant execute on function public.unpin_chat_message(uuid) to authenticated;
grant execute on function public.chat_pinned_messages(uuid) to authenticated;
grant execute on function public.toggle_chat_message_reaction(uuid, text) to authenticated;
grant execute on function public.chat_message_reaction_summary(uuid) to authenticated;
grant execute on function public.submit_chat_csat(uuid, smallint, text) to authenticated;
grant execute on function public.post_chat_message(uuid, uuid, text, uuid[]) to authenticated;
grant execute on function public.chat_report_queue(public.chat_report_status, integer, integer) to authenticated;
grant execute on function public.decide_chat_report(uuid, public.chat_report_status, text, text) to authenticated;
grant execute on function public.delete_chat_message(uuid) to authenticated;
grant execute on function public.start_internal_chat(public.chat_conversation_type, text, text, uuid[], text) to authenticated;
grant execute on function public.my_internal_channels(integer, integer) to authenticated;
grant execute on function public.search_chat_messages(text, integer) to authenticated;
grant execute on function public.chat_analytics(timestamptz, timestamptz) to authenticated;
grant execute on function public.chat_automation_rules() to authenticated;
grant execute on function public.save_chat_automation_rule(uuid, text, public.chat_automation_trigger, jsonb, jsonb, text, integer, boolean, integer, boolean) to authenticated;
grant execute on function public.set_chat_automation_rule_active(uuid, boolean) to authenticated;
grant execute on function public.delete_chat_automation_rule(uuid) to authenticated;
grant execute on function public.chat_automation_runs(integer, integer) to authenticated;
grant execute on function public.preview_chat_automation_rule(uuid, uuid) to authenticated;
grant execute on function public.run_due_chat_automation_jobs(integer) to service_role;

revoke execute on function private.chat_require_permission(text) from public, anon, authenticated;
revoke execute on function private.chat_holds_any(uuid, text[]) from public, anon, authenticated;
revoke execute on function private.chat_template_vocabulary() from public, anon, authenticated;
revoke execute on function private.chat_template_variables(text) from public, anon, authenticated;
revoke execute on function private.chat_check_template_body(text) from public, anon, authenticated;
revoke execute on function private.chat_render(text, jsonb) from public, anon, authenticated;
revoke execute on function private.chat_template_context(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.chat_tag_list(uuid) from public, anon, authenticated;
revoke execute on function private.chat_attachment_types() from public, anon, authenticated;
revoke execute on function private.chat_automation_conditions_ok(jsonb, public.chat_conversations, jsonb) from public, anon, authenticated;
revoke execute on function private.chat_notify_staff(uuid, text, public.staff_notification_kind, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function private.chat_automation_action(public.chat_automation_rules, uuid, jsonb, jsonb, integer) from public, anon, authenticated;
revoke execute on function private.chat_automation_apply(public.chat_automation_trigger, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function private.chat_message_watch() from public, anon, authenticated;
revoke execute on function private.chat_conversation_watch_created() from public, anon, authenticated;
revoke execute on function private.chat_conversation_watch_updated() from public, anon, authenticated;
revoke execute on function private.chat_order_event() from public, anon, authenticated;
revoke execute on function private.chat_return_event() from public, anon, authenticated;
revoke execute on function private.chat_refund_event() from public, anon, authenticated;
revoke execute on function private.chat_automation_action_types() from public, anon, authenticated;
revoke execute on function private.chat_automation_condition_keys() from public, anon, authenticated;
revoke execute on function private.chat_validate_automation_rule(jsonb, jsonb) from public, anon, authenticated;







