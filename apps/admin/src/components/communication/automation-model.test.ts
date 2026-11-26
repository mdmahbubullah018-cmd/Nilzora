import type { ChatAutomationRule } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import { actionProblem, conditionsOf, draftOf } from './automation-model';

const RULE: ChatAutomationRule = {
  id: '77777777-7777-4777-8777-777777777777',
  name: 'Raise urgent questions',
  description: null,
  trigger: 'message_received',
  conditions: { keywords: ['urgent', 'asap'], statuses: ['open'], minMessages: 2 },
  actions: [{ type: 'set_priority', value: 'urgent' }],
  position: 20,
  stopProcessing: true,
  cooldownSeconds: 900,
  isActive: true,
  runCount: 3,
  lastRunAt: null,
  createdAt: '2026-11-03T10:00:00.000Z',
  updatedAt: '2026-11-03T10:00:00.000Z',
};

describe('automation drafts', () => {
  it('round-trips a stored rule through the editor without losing a condition', () => {
    const draft = draftOf(RULE);
    expect(draft.keywords).toBe('urgent, asap');
    expect(draft.cooldownMinutes).toBe('15');
    expect(conditionsOf(draft)).toEqual(RULE.conditions);
  });

  it('sends only the conditions that were set', () => {
    const draft = { ...draftOf(RULE), keywords: ' , ', statuses: [], minMessages: '' };
    expect(conditionsOf(draft)).toEqual({});
  });
});

describe('incomplete actions', () => {
  it('refuses actions that would fail when the rule runs', () => {
    expect(actionProblem({ type: 'set_status' })).toMatch(/status/);
    expect(actionProblem({ type: 'set_priority', value: '' })).toMatch(/priority/);
    expect(actionProblem({ type: 'assign_to' })).toMatch(/teammate/);
    expect(actionProblem({ type: 'reply_template' })).toMatch(/template/);
    expect(actionProblem({ type: 'system_message', body: '   ' })).toMatch(/line/);
    expect(actionProblem({ type: 'set_tags', value: [] })).toMatch(/tag/);
  });

  it('accepts complete actions and the ones that need no value', () => {
    expect(actionProblem({ type: 'set_status', value: 'pending' })).toBeNull();
    expect(actionProblem({ type: 'assign_to', userId: RULE.id })).toBeNull();
    expect(actionProblem({ type: 'reply_template', templateId: RULE.id })).toBeNull();
    expect(actionProblem({ type: 'set_tags', value: ['refund'] })).toBeNull();
    expect(actionProblem({ type: 'escalate' })).toBeNull();
    expect(actionProblem({ type: 'pause_automation' })).toBeNull();
  });
});
