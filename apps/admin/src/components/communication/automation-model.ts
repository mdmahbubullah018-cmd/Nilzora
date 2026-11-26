import type {
  ChatAutomationAction,
  ChatAutomationCondition,
  ChatAutomationRule,
  ChatAutomationTrigger,
} from '@nilzora/contracts';

/*
 * The automation editor's rules
 * -----------------------------
 * How a stored rule becomes an editable draft and back, and which actions are not complete.
 * The database validates the shape of a rule when it is saved, but it accepts several actions
 * without the value they need (a status change with no status, an assignment with no teammate),
 * and those would only fail when the rule ran on a real conversation. `actionProblem` refuses
 * them in the editor instead.
 */

export interface RuleDraft {
  id: string | undefined;
  name: string;
  description: string;
  trigger: ChatAutomationTrigger;
  keywords: string;
  statuses: string[];
  priorities: string[];
  kinds: string[];
  minMessages: string;
  actions: ChatAutomationAction[];
  cooldownMinutes: string;
  position: string;
  stopProcessing: boolean;
  isActive: boolean;
}

export function draftOf(rule: ChatAutomationRule): RuleDraft {
  const conditions = rule.conditions;
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description ?? '',
    trigger: rule.trigger,
    keywords: (conditions.keywords ?? []).join(', '),
    statuses: [...(conditions.statuses ?? [])],
    priorities: [...(conditions.priorities ?? [])],
    kinds: [...(conditions.kinds ?? [])],
    minMessages: conditions.minMessages === undefined ? '' : String(conditions.minMessages),
    actions: rule.actions.map((action) => ({ ...action })),
    cooldownMinutes: String(Math.round(rule.cooldownSeconds / 60)),
    position: String(rule.position),
    stopProcessing: rule.stopProcessing,
    isActive: rule.isActive,
  };
}

/** The condition document for a draft: only the conditions the operator actually set. */
export function conditionsOf(draft: RuleDraft): ChatAutomationCondition {
  const conditions: ChatAutomationCondition = {};
  const keywords = draft.keywords
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word !== '')
    .slice(0, 20);
  if (keywords.length > 0) conditions.keywords = keywords;
  if (draft.statuses.length > 0) conditions.statuses = [...draft.statuses];
  if (draft.priorities.length > 0) conditions.priorities = [...draft.priorities];
  if (draft.kinds.length > 0) conditions.kinds = [...draft.kinds];
  const minimum = Number(draft.minMessages);
  if (draft.minMessages.trim() !== '' && Number.isInteger(minimum) && minimum >= 0) {
    conditions.minMessages = minimum;
  }
  return conditions;
}

/** Why an action cannot run as written, or null when it is complete. */
export function actionProblem(action: ChatAutomationAction): string | null {
  switch (action.type) {
    case 'reply_template':
      return action.templateId === undefined && action.templateName === undefined
        ? 'Choose which template to send.'
        : null;
    case 'system_message': {
      const body = action.body?.trim() ?? '';
      return body === '' ? 'Write the line to add to the thread.' : null;
    }
    case 'set_status':
    case 'set_priority':
      return typeof action.value === 'string' && action.value !== ''
        ? null
        : action.type === 'set_status'
          ? 'Choose the new status.'
          : 'Choose the new priority.';
    case 'set_tags':
      return Array.isArray(action.value) && action.value.length > 0 ? null : 'Choose at least one tag.';
    case 'assign_to':
      return action.userId === undefined ? 'Choose the teammate to assign.' : null;
    case 'schedule':
      return action.actions === undefined || action.actions.length === 0
        ? 'A follow-up needs at least one action.'
        : null;
    case 'escalate':
    case 'notify_staff':
    case 'pause_automation':
      return null;
  }
}
