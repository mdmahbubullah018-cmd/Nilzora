-- ---------------------------------------------------------------------------
-- M1 — Chat automation: retry-safe actions and clean per-job rule state
--
-- A scheduled job's actions used to restart from index zero on every retry. When a later
-- action failed (an `assign_to` naming an account that had since been deactivated, say),
-- the actions before it ran again and their side effects repeated: a second automatic
-- reply, a second system message, a second scheduled job, a second assignment row.
--
-- The fix gives every creating action a stable identity derived from the thing that is
-- retried — the run for an inline rule, the job for a scheduled one — plus its position in
-- the action list. The identities land on uniqueness the database already enforces or on
-- one new partial index:
--
--   * messages   → `chat_messages.client_message_id`, covered by the existing partial
--                  unique index (conversation_id, client_message_id); the same identity
--                  inserts once and the retry is a no-op.
--   * schedule   → a new `chat_automation_jobs.dedupe_key` with a partial unique index.
--   * assignment → no new column: a row is written only when the assignee actually changes,
--                  which is what the append-only history records anyway.
--   * set_status → only when the status actually changes, so resolved_at/closed_at are not
--                  pushed forward by a retry.
--
-- The identity travels in a transaction-local setting (`nilzora.chat_automation_lineage`),
-- the same mechanism `nilzora.chat_automation` already uses to stop an automatic reply from
-- starting another round. Nothing about a function signature, a grant or the queue's
-- concurrency protection changes: the drainer still claims with `for update skip locked`.
--
-- Also fixed here: `v_rule` is reset at the top of every job iteration. `chat_automation_jobs
-- .rule_id` is nullable, and without the reset a job with no rule would silently run the
-- previous job's rule against the wrong conversation. A missing rule is now reported as the
-- existing NZ523 failure instead.
--
-- Additive and replacement only. No row is deleted, no column is dropped, and the new
-- column is nullable so every existing row stays valid (the table holds no rows today).
--
-- Rollback
--   drop index public.chat_automation_jobs_dedupe_idx;
--   alter table public.chat_automation_jobs drop column dedupe_key;
--   -- then restore the three function bodies from 20261114091000_chat_phase2_functions.sql
-- ---------------------------------------------------------------------------

alter table public.chat_automation_jobs add column dedupe_key text;

comment on column public.chat_automation_jobs.dedupe_key is
  'Stable identity for a scheduled action, so a retried job cannot schedule it twice. Null on rows written before this column existed.';

create unique index chat_automation_jobs_dedupe_idx
  on public.chat_automation_jobs (dedupe_key)
  where dedupe_key is not null;

-- ---------------------------------------------------------------------------
-- One action, applied idempotently
-- ---------------------------------------------------------------------------

create or replace function private.chat_automation_action(
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
  -- The run or job this action belongs to. A direct call without one gets a random value,
  -- which simply means "no deduplication", exactly as before this change.
  v_lineage text := coalesce(
    nullif(current_setting('nilzora.chat_automation_lineage', true), ''),
    gen_random_uuid()::text
  );
  v_action_key text;
  v_message_id uuid;
  v_new_status public.chat_conversation_status;
  v_previous_assignee uuid;
begin
  select * into v_conversation from public.chat_conversations c where c.id = p_conversation_id;
  if v_conversation.id is null then
    raise exception 'conversation not found' using errcode = 'NZ501';
  end if;

  v_action_key := v_lineage || ':action:' || coalesce(p_index, 0)::text;

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
      -- Same identity, same conversation: the partial unique index makes a retry a no-op.
      insert into public.chat_messages (
        conversation_id, sender_id, sender_role, kind, body, metadata, client_message_id
      )
      values (
        p_conversation_id, null, 'system', 'automated', v_body,
        jsonb_build_object('templateId', v_template.id, 'templateName', v_template.name),
        md5(v_action_key)::uuid
      )
      on conflict (conversation_id, client_message_id) where client_message_id is not null
      do nothing
      returning id into v_message_id;
      -- Only a message that was really written counts as a use of the template.
      if v_message_id is not null then
        update public.chat_message_templates t set usage_count = t.usage_count + 1
        where t.id = v_template.id;
      end if;

    when 'system_message' then
      v_body := btrim(coalesce(p_action ->> 'body', ''));
      if v_body = '' or char_length(v_body) > 1000 then
        raise exception 'system message must be 1-1000 characters' using errcode = 'NZ412';
      end if;
      insert into public.chat_messages (
        conversation_id, sender_id, sender_role, kind, body, client_message_id
      )
      values (p_conversation_id, null, 'system', 'system', v_body, md5(v_action_key)::uuid)
      on conflict (conversation_id, client_message_id) where client_message_id is not null
      do nothing;

    when 'set_status' then
      v_new_status := (p_action ->> 'value')::public.chat_conversation_status;
      -- A retry must not move resolved_at/closed_at forward, so only a real change is written.
      update public.chat_conversations c
      set status = v_new_status,
          resolved_at = case when v_new_status = 'resolved' then now() else c.resolved_at end,
          closed_at = case when v_new_status = 'closed' then now() else c.closed_at end
      where c.id = p_conversation_id
        and c.status is distinct from v_new_status;

    when 'set_priority' then
      update public.chat_conversations c
      set priority = (p_action ->> 'value')::public.chat_priority
      where c.id = p_conversation_id
        and c.priority is distinct from (p_action ->> 'value')::public.chat_priority;

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
      select c.assignee_id into v_previous_assignee
      from public.chat_conversations c where c.id = p_conversation_id;
      update public.chat_conversations c set assignee_id = v_target
      where c.id = p_conversation_id;
      -- The history records changes of owner; a retry that assigns the same person again
      -- is not a change, and writing a second row would misreport it as one.
      if v_previous_assignee is distinct from v_target then
        insert into public.chat_assignments (conversation_id, assigned_to, note)
        values (p_conversation_id, v_target, 'automation: ' || p_rule.name);
      end if;

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
      insert into public.chat_automation_jobs (
        rule_id, conversation_id, trigger, actions, run_at, dedupe_key
      )
      values (
        p_rule.id, p_conversation_id, p_rule.trigger,
        coalesce(p_action -> 'actions', '[]'::jsonb),
        now() + make_interval(secs => v_delay),
        v_action_key
      )
      on conflict (dedupe_key) where dedupe_key is not null do nothing;

    else
      raise exception 'unsupported automation action: %', v_type using errcode = 'NZ509';
  end case;

  return jsonb_build_object('type', v_type, 'ok', true);
end;
$$;

revoke execute on function private.chat_automation_action(
  public.chat_automation_rules, uuid, jsonb, jsonb, integer
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The rule runner stamps the run it is applying
-- ---------------------------------------------------------------------------

create or replace function private.chat_automation_apply(
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

      -- Every action of this run shares one identity, so a replayed action is recognised.
      perform set_config('nilzora.chat_automation_lineage', 'run:' || v_run_id::text, true);

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
  perform set_config('nilzora.chat_automation_lineage', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- The drainer: clean rule state per job, one identity per job, and a failure path that
-- actually counts the attempt
--
-- Two defects were found by executing the previous body, and are fixed here:
--
--   1. The failure handler assigned `case … end` (typed `text`) to an enum column, which
--      raises 42804 inside the handler itself. The drain therefore aborted with its own
--      error instead of recording the failure.
--   2. The `attempts` increment happened inside the block that the exception handler rolls
--      back, so it never survived a failure: `attempts` stayed 0, the three-attempt limit was
--      never reached, and a job whose action always throws retried for ever. The handler now
--      writes the incremented count itself, and decides "failed" from it.
-- ---------------------------------------------------------------------------

create or replace function public.run_due_chat_automation_jobs(p_limit integer default 20)
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
  v_attempt integer;
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
    -- This attempt's number, kept here because the increment below is undone when the block
    -- rolls back and the handler has to write it again.
    v_attempt := coalesce(v_job.attempts, 0) + 1;

    update public.chat_automation_jobs j
    set status = 'running', attempts = v_attempt, locked_until = now() + interval '60 seconds'
    where j.id = v_job.id;

    begin
      -- Reset first: a job whose rule is gone must fail on its own, never inherit the rule
      -- the previous iteration left behind.
      v_rule := null;
      if v_job.rule_id is not null then
        select * into v_rule from public.chat_automation_rules r where r.id = v_job.rule_id;
      end if;
      if v_rule.id is null then
        raise exception 'automation rule not found' using errcode = 'NZ523';
      end if;

      -- One identity for this job, shared by every action it runs and by every retry.
      perform set_config('nilzora.chat_automation_lineage', 'job:' || v_job.id::text, true);

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
        -- The block rolled back, taking the increment with it, so it is written again here.
        -- The cast is explicit: a CASE over two literals is typed `text`, and an assignment
        -- from text to an enum is not implicit.
        update public.chat_automation_jobs j
        set status = (case when v_attempt >= 3 then 'failed' else 'pending' end)
                       ::public.chat_automation_job_status,
            attempts = v_attempt,
            locked_until = null,
            last_error = left(sqlerrm, 500),
            run_at = now() + make_interval(secs => 60 * v_attempt)
        where j.id = v_job.id;
        v_failed := v_failed + 1;
    end;
  end loop;

  -- The identity is transaction-local; clearing it keeps a later call in the same
  -- transaction from inheriting this batch's last job.
  perform set_config('nilzora.chat_automation_lineage', '', true);

  return jsonb_build_object('ran', v_ran, 'failed', v_failed);
end;
$$;

