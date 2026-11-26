import { ApiError } from '@nilzora/api-client';
import { describe, expect, it, vi } from 'vitest';
import { CSRF_FIELD } from './csrf';
import type { SessionCall } from './session';
import type { SupportSession } from './support';
import { createSupportGateway } from './support';

/*
 * The Phase 2 half of the support gateway.
 *
 * What is held down here is the gateway's own contract, not the API's: that a read goes
 * through `read` and a write through `act` (so the CSRF field is attached and the request's
 * origin is checked before the API is reached), that the caller's own token is the only
 * identity used, and that an API error becomes one of the gateway's fixed messages rather
 * than the API's own text.
 */

const TOKEN = 'at.test-token';
const CONVERSATION = '44444444-4444-4444-8444-444444444444';
const MESSAGE = '55555555-5555-4555-8555-555555555555';
const RULE = '77777777-7777-4777-8777-777777777777';

type Phase2Method = Exclude<
  keyof ReturnType<typeof createSupportGateway>,
  | 'listConversations'
  | 'conversation'
  | 'messages'
  | 'unreadCount'
  | 'startConversation'
  | 'sendMessage'
  | 'markRead'
  | 'reportMessage'
  | 'socketTicket'
  | 'queue'
  | 'team'
  | 'setStatus'
  | 'assign'
  | 'setPriority'
  | 'notes'
  | 'addNote'
>;

/** A session whose `read`/`act` answer from a single stubbed API client. */
function setup(overrides: Partial<Record<keyof SupportSession, unknown>> = {}) {
  const api = {
    listChatQueue: vi.fn(() => Promise.resolve({ conversations: [], unread: 0 })),
    listChatTeam: vi.fn(() => Promise.resolve({ members: [] })),
    listChatTemplates: vi.fn(() => Promise.resolve({ templates: [] })),
    saveChatTemplate: vi.fn(() =>
      Promise.resolve({
        id: '66666666-6666-4666-8666-666666666666',
        name: 'T',
        category: 'other',
        locale: 'en',
        body: 'b',
        description: null,
        variables: [],
        isActive: true,
        usageCount: 0,
        createdAt: '2026-11-04T00:00:00.000Z',
        updatedAt: '2026-11-04T00:00:00.000Z',
      }),
    ),
    archiveChatTemplate: vi.fn(() => Promise.resolve(undefined)),
    renderChatTemplate: vi.fn(() =>
      Promise.resolve({ templateId: MESSAGE, name: 'T', locale: 'en', body: 'Hi' }),
    ),
    listChatSavedReplies: vi.fn(() => Promise.resolve({ replies: [] })),
    saveChatSavedReply: vi.fn(() => Promise.resolve(undefined)),
    deleteChatSavedReply: vi.fn(() => Promise.resolve(undefined)),
    listChatTags: vi.fn(() => Promise.resolve({ tags: [] })),
    saveChatTag: vi.fn(() => Promise.resolve(undefined)),
    setChatConversationTags: vi.fn(() => Promise.resolve(undefined)),
    uploadChatAttachment: vi.fn(() => Promise.resolve({ id: MESSAGE, status: 'pending' })),
    discardChatAttachment: vi.fn(() => Promise.resolve(undefined)),
    postChatMessage: vi.fn(() => Promise.resolve({ message: { seq: 1 }, duplicate: false })),
    submitChatCsat: vi.fn(() => Promise.resolve({ rating: 5 })),
    listChatReports: vi.fn(() => Promise.resolve({ reports: [], totalCount: 0 })),
    decideChatReport: vi.fn(() => Promise.resolve({ id: MESSAGE, status: 'actioned' })),
    deleteChatMessage: vi.fn(() => Promise.resolve(undefined)),
    pinChatMessage: vi.fn(() => Promise.resolve(undefined)),
    unpinChatMessage: vi.fn(() => Promise.resolve(undefined)),
    listChatPinnedMessages: vi.fn(() => Promise.resolve({ messages: [] })),
    toggleChatMessageReaction: vi.fn(() =>
      Promise.resolve({ messageId: MESSAGE, emoji: 'x', added: true, summary: [] }),
    ),
    listChatReactionSummary: vi.fn(() => Promise.resolve({ reactions: [] })),
    startInternalChat: vi.fn(() => Promise.resolve({ conversation: { id: CONVERSATION } })),
    listInternalChannels: vi.fn(() => Promise.resolve({ channels: [], totalCount: 0 })),
    searchChatMessages: vi.fn(() => Promise.resolve({ hits: [] })),
    getChatAnalytics: vi.fn(() => Promise.resolve({ conversations: { created: 0 } })),
    listChatAutomationRules: vi.fn(() => Promise.resolve({ rules: [] })),
    saveChatAutomationRule: vi.fn(() => Promise.resolve(undefined)),
    setChatAutomationRuleActive: vi.fn(() => Promise.resolve(undefined)),
    deleteChatAutomationRule: vi.fn(() => Promise.resolve(undefined)),
    listChatAutomationRuns: vi.fn(() => Promise.resolve({ runs: [], totalCount: 0 })),
    previewChatAutomationRule: vi.fn(() =>
      Promise.resolve({ ruleId: RULE, conversationId: CONVERSATION, wouldRun: true, actions: [], reasons: [] }),
    ),
  };

  const act = vi.fn(async (formData: FormData, call: SessionCall<unknown>): Promise<unknown> => {
    expect(formData.get(CSRF_FIELD)).toBe('csrf-value');
    const value = await call(api as never, TOKEN);
    return { kind: 'ok', value };
  });
  const read = vi.fn(
    async (call: SessionCall<unknown>): Promise<unknown> => {
      const value = await call(api as never, TOKEN);
      return { kind: 'ok', value };
    },
  );

  const session: SupportSession = {
    csrfToken: () => Promise.resolve('csrf-value'),
    read: read as SupportSession['read'],
    act: act as SupportSession['act'],
    ...(overrides as Partial<SupportSession>),
  };

  return { api, act, read, gateway: createSupportGateway(session) };
}

describe('support gateway, Phase 2', () => {
  it('reads a template list with the caller’s own token', async () => {
    const { api, read, gateway } = setup();

    const result = await gateway.listTemplates({ includeArchived: true });

    expect(result).toEqual({ ok: true, value: { templates: [] } });
    expect(read).toHaveBeenCalledOnce();
    expect(api.listChatTemplates).toHaveBeenCalledWith(TOKEN, { includeArchived: true });
  });

  it('sends a template write through act, with the CSRF field attached', async () => {
    const { api, act, gateway } = setup();

    const result = await gateway.saveTemplate({
      name: 'Refund',
      category: 'returns',
      locale: 'en',
      body: 'Hello {customer_name}',
    });

    expect(result.ok).toBe(true);
    expect(act).toHaveBeenCalledOnce();
    expect(api.saveChatTemplate).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({ name: 'Refund' }),
    );
  });

  it('pins, unpins and reacts through act', async () => {
    const { api, act, gateway } = setup();

    await gateway.pinMessage(CONVERSATION, MESSAGE);
    await gateway.unpinMessage(CONVERSATION, MESSAGE);
    const reaction = await gateway.toggleReaction(CONVERSATION, MESSAGE, '👍');

    expect(act).toHaveBeenCalledTimes(3);
    expect(api.pinChatMessage).toHaveBeenCalledWith(TOKEN, CONVERSATION, MESSAGE);
    expect(api.unpinChatMessage).toHaveBeenCalledWith(TOKEN, CONVERSATION, MESSAGE);
    expect(api.toggleChatMessageReaction).toHaveBeenCalledWith(TOKEN, CONVERSATION, MESSAGE, '👍');
    expect(reaction).toEqual({
      ok: true,
      value: { messageId: MESSAGE, emoji: 'x', added: true, summary: [] },
    });
  });

  it('passes an attachment through with its declared type', async () => {
    const { api, gateway } = setup();
    const body = new Uint8Array([1, 2, 3]);

    await gateway.uploadAttachment({
      conversationId: CONVERSATION,
      fileName: 'receipt.png',
      contentType: 'image/png',
      body,
    });

    expect(api.uploadChatAttachment).toHaveBeenCalledWith(
      TOKEN,
      CONVERSATION,
      'receipt.png',
      body,
      'image/png',
      undefined,
    );
  });

  it('carries a recording length through to the API', async () => {
    const { api, gateway } = setup();
    const body = new Uint8Array([4, 5, 6]);

    await gateway.uploadAttachment({
      conversationId: CONVERSATION,
      fileName: 'voice.webm',
      contentType: 'audio/webm',
      body,
      durationMs: 12_500,
    });

    expect(api.uploadChatAttachment).toHaveBeenCalledWith(
      TOKEN,
      CONVERSATION,
      'voice.webm',
      body,
      'audio/webm',
      12_500,
    );
  });

  it('reads analytics, run history and the report queue', async () => {
    const { api, read, gateway } = setup();

    await gateway.analytics({ from: '2026-11-01T00:00:00.000Z' });
    await gateway.automationRuns({ limit: 10 });
    await gateway.reports({ status: 'open' });

    expect(read).toHaveBeenCalledTimes(3);
    expect(api.getChatAnalytics).toHaveBeenCalledWith(TOKEN, {
      from: '2026-11-01T00:00:00.000Z',
    });
    expect(api.listChatAutomationRuns).toHaveBeenCalledWith(TOKEN, { limit: 10 });
    expect(api.listChatReports).toHaveBeenCalledWith(TOKEN, { status: 'open' });
  });

  it('reads the operator queue and the team directory with the caller’s own token', async () => {
    const { api, read, act, gateway } = setup();

    await gateway.queue({ scope: 'mine', sort: 'oldest', priority: 'urgent' });
    const team = await gateway.team();

    expect(read).toHaveBeenCalledTimes(2);
    expect(act).not.toHaveBeenCalled();
    expect(api.listChatQueue).toHaveBeenCalledWith(TOKEN, {
      scope: 'mine',
      sort: 'oldest',
      priority: 'urgent',
    });
    expect(api.listChatTeam).toHaveBeenCalledWith(TOKEN);
    expect(team).toEqual({ ok: true, value: { members: [] } });
  });

  it('answers an API refusal with a fixed message, never the API’s own text', async () => {
    const { gateway } = setup({
      act: () =>
        Promise.reject(
          new ApiError(400, 'template_variable_invalid', 'raw upstream detail: {order_id}'),
        ),
    });

    const result = await gateway.saveTemplate({
      name: 'Broken',
      category: 'other',
      locale: 'en',
      body: 'Hi {order_id}',
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      code: 'template_variable_invalid',
      message: 'This template names a value Nilzora cannot fill in.',
    });
  });

  it('reports a permission refusal as forbidden', async () => {
    const { gateway } = setup({
      read: () => Promise.reject(new ApiError(403, 'forbidden', 'no')),
    });

    const result = await gateway.automationRules();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.status).toBe(403);
    expect(result.code).toBe('forbidden');
  });

  it('reports a signed-out session without calling the API', async () => {
    const { gateway } = setup({
      read: () => Promise.resolve({ kind: 'signed_out' }),
    });

    const result = await gateway.tags();

    expect(result).toEqual({
      ok: false,
      status: 401,
      code: 'signed_out',
      message: 'Sign in to use chat.',
    });
  });

  it('covers every Phase 2 method', () => {
    const { gateway } = setup();
    const expected: Phase2Method[] = [
      'listTemplates',
      'saveTemplate',
      'archiveTemplate',
      'renderTemplate',
      'savedReplies',
      'saveSavedReply',
      'deleteSavedReply',
      'tags',
      'saveTag',
      'setConversationTags',
      'uploadAttachment',
      'discardAttachment',
      'postMessage',
      'submitRating',
      'reports',
      'decideReport',
      'deleteMessage',
      'pinMessage',
      'unpinMessage',
      'pinnedMessages',
      'toggleReaction',
      'reactionSummary',
      'startInternalChat',
      'internalChannels',
      'search',
      'analytics',
      'automationRules',
      'saveAutomationRule',
      'setAutomationRuleActive',
      'deleteAutomationRule',
      'automationRuns',
      'previewAutomationRule',
    ];
    for (const name of expected) expect(typeof gateway[name]).toBe('function');
  });
});
