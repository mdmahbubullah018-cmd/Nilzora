-- The automation "test" button said a rule would run for a conversation even when the engine
-- would skip it. The engine (`private.chat_automation_apply`) leaves a rule alone while it has an
-- applied run on the same conversation inside the rule's cooldown window; the preview ignored that
-- window, so an operator who tested a rule right after it fired was told "would run" and then saw
-- nothing happen.
--
-- The preview now applies the same cooldown rule and says so in its reasons. Same signature and
-- grants as before, so this is a plain redefinition; nothing it reads or writes changes.

create or replace function public.preview_chat_automation_rule(p_rule_id uuid, p_conversation_id uuid)
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
  v_cooling boolean := false;
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

  -- The same test the engine makes before it runs a rule.
  if v_rule.cooldown_seconds > 0 then
    select exists (
      select 1 from public.chat_automation_runs x
      where x.rule_id = v_rule.id
        and x.conversation_id = p_conversation_id
        and x.status = 'applied'
        and x.created_at > now() - make_interval(secs => v_rule.cooldown_seconds)
    ) into v_cooling;
  end if;

  if not v_rule.is_active then
    v_reasons := v_reasons || to_jsonb('The rule is switched off.'::text);
  end if;
  if v_conversation.automation_paused then
    v_reasons := v_reasons || to_jsonb('Automation is paused on this conversation.'::text);
  end if;
  if not v_matches then
    v_reasons := v_reasons || to_jsonb('The conversation does not match the conditions.'::text);
  end if;
  if v_cooling then
    v_reasons := v_reasons || to_jsonb('The rule already ran on this conversation inside its cooldown window.'::text);
  end if;

  return jsonb_build_object(
    'ruleId', v_rule.id,
    'conversationId', p_conversation_id,
    'wouldRun', v_rule.is_active and not v_conversation.automation_paused and v_matches and not v_cooling,
    'actions', v_rule.actions,
    'reasons', v_reasons
  );
end;
$$;
