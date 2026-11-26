import {
  CHAT_ATTACHMENT_MAX_BYTES,
  chatAnalyticsSchema,
  chatAutomationPreviewSchema,
  chatAutomationRulesResponseSchema,
  chatAutomationRunsResponseSchema,
  chatCsatResponseSchema,
  chatMyFeedbackResponseSchema,
  chatReactionResponseSchema,
  chatReportQueueResponseSchema,
  chatSavedRepliesResponseSchema,
  chatTagsResponseSchema,
  chatTeamResponseSchema,
  chatTemplateSchema,
  chatTemplatesResponseSchema,
  postedChatMessageSchema,
  PRODUCT_IMAGE_MAX_BYTES,
} from '@nilzora/contracts';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ChatAdminStore } from '../modules/chat/admin-store';
import { CHAT_IMAGE_MIN_SIZE } from '../modules/chat/attachments';
import { ChatRefusalError, toChatError } from '../modules/chat/errors';
import type { ChatNotifier } from '../realtime/notifier';
import { createMemoryObjectStore } from '../modules/media/object-store';
import { CHAT_CONVERSATION_ID, CHAT_MESSAGE_ID, FakeChat } from './chat-fakes';
import { errorOf } from './commerce-helpers';
import { FakeIdentity } from './fakes';
import { testApp } from './helpers';
import { FakeProductImages, makeAnimatedWebp, makeImage, makeNoisePng } from './media-fakes';

/*
 * The Phase 2 REST surface, against a fake store.
 *
 * These tests hold down the API's own part: every route needs a verified account, each
 * class of operation needs its own permission (so an inbox agent cannot edit the wording
 * every agent sends), the request body is validated, and a database refusal becomes the
 * right status and code. Which rows an account may actually touch is the database's
 * decision and lives in `supabase/tests/chat_automation.test.sql`.
 */

const TEMPLATE_ID = '66666666-6666-4666-8666-666666666666';
const RULE_ID = '77777777-7777-4777-8777-777777777777';
const REPORT_ID = '88888888-8888-4888-8888-888888888888';

/** The decision record `decide_chat_report` answers; typed here so the test is type-safe. */
const reportDecisionSchema = z.object({
  id: z.string(),
  status: z.string(),
  actionTaken: z.string().nullable(),
  resolvedAt: z.string().nullable(),
});

const TEMPLATE = {
  id: TEMPLATE_ID,
  name: 'Refund acknowledgement',
  category: 'returns' as const,
  locale: 'en' as const,
  body: 'Hello {customer_name}',
  description: null,
  variables: ['customer_name'],
  isActive: true,
  usageCount: 0,
  createdAt: '2026-11-03T10:00:00.000Z',
  updatedAt: '2026-11-03T10:00:00.000Z',
};

const RULE = {
  id: RULE_ID,
  name: 'Acknowledge refund questions',
  description: null,
  trigger: 'message_received' as const,
  conditions: { keywords: ['refund'] },
  actions: [{ type: 'pause_automation' as const }],
  position: 10,
  stopProcessing: false,
  cooldownSeconds: 900,
  isActive: true,
  runCount: 0,
  lastRunAt: null,
  createdAt: '2026-11-03T10:00:00.000Z',
  updatedAt: '2026-11-03T10:00:00.000Z',
};

function analytics() {
  return {
    range: { from: '2026-11-01T00:00:00.000Z', to: '2026-11-03T00:00:00.000Z' },
    conversations: {
      created: 4,
      byKind: { customer_support: 4 },
      byStatus: { open: 3, resolved: 1 },
      waitingNow: 1,
      unassignedNow: 2,
    },
    firstResponse: { answered: 3, averageSeconds: 120, p50Seconds: 90, p90Seconds: 300 },
    resolution: { resolved: 1, averageSeconds: 900 },
    messages: { total: 12, fromCustomers: 6, fromStaff: 4, automated: 2 },
    satisfaction: { responses: 1, average: 5, five: 1, four: 0, three: 0, two: 0, one: 0 },
    automation: { activeRules: 1, applied: 2, failed: 0, skipped: 0, pendingJobs: 0 },
    moderation: { openReports: 0, resolved: 1 },
    agents: [],
    daily: [{ date: '2026-11-03', created: 4, messages: 12 }],
  };
}

/** A store that answers with the shapes the contract expects, and records the calls. */
function fakeAdmin(overrides: Partial<ChatAdminStore> = {}) {
  const mocks = {
    templates: vi.fn(() => Promise.resolve({ templates: [TEMPLATE] })),
    saveTemplate: vi.fn(() => Promise.resolve(TEMPLATE)),
    archiveTemplate: vi.fn(() => Promise.resolve()),
    renderTemplate: vi.fn(() =>
      Promise.resolve({
        templateId: TEMPLATE_ID,
        name: 'Refund acknowledgement',
        locale: 'en' as const,
        body: 'Hello Customer',
      }),
    ),
    savedReplies: vi.fn(() =>
      Promise.resolve({
        replies: [
          {
            id: '99999999-9999-4999-8999-999999999999',
            visibility: 'personal' as const,
            title: 'Refund opening',
            shortcut: '/refund',
            body: 'The refund is being processed.',
            usageCount: 0,
            isActive: true,
            createdAt: '2026-11-03T10:00:00.000Z',
            updatedAt: '2026-11-03T10:00:00.000Z',
          },
        ],
      }),
    ),
    saveSavedReply: vi.fn(() => Promise.resolve()),
    deleteSavedReply: vi.fn(() => Promise.resolve()),
    tags: vi.fn(() =>
      Promise.resolve({
        tags: [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            slug: 'refund',
            label: 'Refund',
            description: null,
            isActive: true,
            conversationCount: 1,
          },
        ],
      }),
    ),
    saveTag: vi.fn(() => Promise.resolve()),
    setConversationTags: vi.fn(() => Promise.resolve()),
    beginAttachment: vi.fn(() =>
      Promise.resolve({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        conversationId: CHAT_CONVERSATION_ID,
        objectKey: `chat/${CHAT_CONVERSATION_ID}/test`,
        fileName: 'receipt.png',
        contentType: 'image/webp',
        byteSize: 2048,
        width: 800,
        height: 600,
        status: 'pending' as const,
      }),
    ),
    attachmentMedia: vi.fn(() => Promise.reject(new ChatRefusalError('attachment_not_found'))),
    submitMessageFeedback: vi.fn(() =>
      Promise.resolve({
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        messageId: CHAT_MESSAGE_ID,
        verdict: 'helpful' as const,
        comment: null,
        createdAt: '2026-11-05T10:00:00.000Z',
        updatedAt: '2026-11-05T10:00:00.000Z',
      }),
    ),
    messageFeedback: vi.fn(() => Promise.resolve({ feedback: [] })),
    myMessageFeedback: vi.fn(() => Promise.resolve({ feedback: [] })),
    discardAttachment: vi.fn(() => Promise.resolve()),
    replySummary: vi.fn(() => Promise.resolve(null)),
    postMessage: vi.fn(() =>
      Promise.resolve({
        message: {
          id: CHAT_MESSAGE_ID,
          seq: 7,
          senderId: null,
          senderRole: 'staff',
          senderName: 'Staff One',
          kind: 'text',
          body: 'Here is the receipt',
          replyToId: null,
          metadata: {},
          createdAt: '2026-11-03T10:00:00.000Z',
        },
        duplicate: false,
        unreadCount: 1,
        attachments: [],
      }),
    ),
    submitCsat: vi.fn(() =>
      Promise.resolve({
        conversationId: CHAT_CONVERSATION_ID,
        rating: 5,
        comment: 'Fast',
        createdAt: '2026-11-03T10:00:00.000Z',
      }),
    ),
    reportQueue: vi.fn(() =>
      Promise.resolve({
        reports: [
          {
            id: REPORT_ID,
            status: 'open' as const,
            reason: 'spam',
            details: null,
            actionTaken: null,
            createdAt: '2026-11-03T10:00:00.000Z',
            resolvedAt: null,
            messageId: CHAT_MESSAGE_ID,
            messageBody: 'Buy my thing',
            messageSenderName: null,
            messageCreatedAt: '2026-11-03T10:00:00.000Z',
            conversationId: CHAT_CONVERSATION_ID,
            conversationSubject: 'Support request',
            conversationKind: 'customer_support',
            reporterId: null,
            reporterName: null,
          },
        ],
        totalCount: 1,
      }),
    ),
    decideReport: vi.fn(() =>
      Promise.resolve({
        id: REPORT_ID,
        status: 'actioned',
        actionTaken: 'message_deleted',
        resolvedAt: '2026-11-03T10:05:00.000Z',
      }),
    ),
    deleteMessage: vi.fn(() => Promise.resolve()),
    pinMessage: vi.fn(() => Promise.resolve()),
    unpinMessage: vi.fn(() => Promise.resolve()),
    pinnedMessages: vi.fn(() => Promise.resolve({ messages: [] })),
    toggleReaction: vi.fn(() =>
      Promise.resolve({ messageId: CHAT_MESSAGE_ID, emoji: 'thumbs_up', added: true, summary: [] }),
    ),
    reactionSummary: vi.fn(() => Promise.resolve({ reactions: [] })),
    startInternalChat: vi.fn(() => Promise.reject(new ChatRefusalError('forbidden'))),
    internalChannels: vi.fn(() =>
      Promise.resolve({
        channels: [
          {
            id: CHAT_CONVERSATION_ID,
            kind: 'internal_direct',
            status: 'open',
            subject: 'Refund queue',
            department: 'support',
            employeeCount: 2,
            lastMessageAt: '2026-11-03T10:00:00.000Z',
            lastMessagePreview: 'Can you cover?',
            unreadCount: 1,
          },
        ],
        totalCount: 1,
      }),
    ),
    search: vi.fn(() => Promise.resolve({ hits: [] })),
    team: vi.fn(() =>
      Promise.resolve({
        members: [
          {
            userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            name: 'Queue Agent',
            email: 'agent@example.com',
            role: 'staff',
            canSupport: true,
            canModerate: false,
            canUseInternal: true,
            openCount: 2,
            pendingCount: 1,
            resolvedRecentCount: 5,
          },
        ],
      }),
    ),
    analytics: vi.fn(() => Promise.resolve(analytics())),
    automationRules: vi.fn(() => Promise.resolve({ rules: [RULE] })),
    saveAutomationRule: vi.fn(() => Promise.resolve()),
    setAutomationRuleActive: vi.fn(() => Promise.resolve()),
    deleteAutomationRule: vi.fn(() => Promise.resolve()),
    automationRuns: vi.fn(() => Promise.resolve({ runs: [], totalCount: 0 })),
    previewAutomationRule: vi.fn(() =>
      Promise.resolve({
        ruleId: RULE_ID,
        conversationId: CHAT_CONVERSATION_ID,
        wouldRun: true,
        actions: [],
        reasons: [],
      }),
    ),
  };
  // The store is the mocks themselves; they already answer with the contract's shapes.
  const store = { ...mocks, ...overrides };
  return { store, mocks };
}

function setup(
  overrides: Partial<ChatAdminStore> = {},
  options: { storage?: boolean; notify?: ChatNotifier } = {},
) {
  const identity = new FakeIdentity();
  const customer = identity.addUser({ email: 'one@example.com' });
  const staff = identity.addUser({ email: 'staff@example.com', role: 'staff' });
  const admin = identity.addUser({ email: 'admin@example.com', role: 'admin' });
  const moderator = identity.addUser({ email: 'mod@example.com', role: 'moderator' });
  const { store, mocks } = fakeAdmin(overrides);
  const objects = createMemoryObjectStore();
  const app = testApp({
    auth: identity.deps,
    chat: {
      store: new FakeChat(),
      admin: store,
      ...(options.notify === undefined ? {} : { notify: options.notify }),
    },
    ...(options.storage
      ? {
          media: {
            images: new FakeProductImages(identity),
            storage: { objects, publicBaseUrl: 'https://media.example.com' },
          },
        }
      : {}),
  });
  return { identity, customer, staff, admin, moderator, mocks, app, objects };
}

type FakeUser = ReturnType<FakeIdentity['addUser']>;

function bearer(identity: FakeIdentity, user: FakeUser) {
  return { Authorization: ['Bearer', identity.tokenFor(user)].join(' ') };
}

describe('chat administration access', () => {
  it('refuses every administration route without a verified account', async () => {
    const { app } = setup();
    const calls = [
      request(app).get('/api/v1/chat/admin/templates'),
      request(app).post('/api/v1/chat/admin/templates').send({}),
      request(app).get('/api/v1/chat/admin/analytics'),
      request(app).get('/api/v1/chat/admin/automation'),
      request(app).get('/api/v1/chat/admin/reports'),
      request(app).get('/api/v1/chat/internal'),
      request(app).get('/api/v1/chat/search?q=refund'),
      request(app).post('/api/v1/chat/messages').send({}),
    ];
    for (const call of calls) {
      const response = await call;
      expect(response.status).toBe(401);
    }
  });

  it('refuses template editing to an account that may only work the inbox', async () => {
    const { identity, staff, app } = setup();
    const response = await request(app)
      .post('/api/v1/chat/admin/templates')
      .set(bearer(identity, staff))
      .send({
        name: 'Refund acknowledgement',
        category: 'returns',
        locale: 'en',
        body: 'Hello {customer_name}',
      });
    expect(response.status).toBe(403);
    expect(errorOf(response.body).code).toBe('forbidden');
  });

  it('lets a staff member read the templates it may use but not change them', async () => {
    const { identity, staff, app } = setup();
    const response = await request(app)
      .get('/api/v1/chat/admin/templates')
      .set(bearer(identity, staff));
    expect(response.status).toBe(200);
    expect(chatTemplatesResponseSchema.parse(response.body).templates).toHaveLength(1);
  });

  it('refuses analytics to staff and allows it to an admin', async () => {
    const { identity, staff, admin, app } = setup();
    const refused = await request(app)
      .get('/api/v1/chat/admin/analytics')
      .set(bearer(identity, staff));
    expect(refused.status).toBe(403);

    const allowed = await request(app)
      .get('/api/v1/chat/admin/analytics')
      .set(bearer(identity, admin));
    expect(allowed.status).toBe(200);
    expect(chatAnalyticsSchema.parse(allowed.body).satisfaction.average).toBe(5);
  });

  it('allows the moderator workspace to review reports but not to read analytics', async () => {
    const { identity, moderator, app } = setup();
    const queue = await request(app)
      .get('/api/v1/chat/admin/reports')
      .set(bearer(identity, moderator));
    expect(queue.status).toBe(200);
    expect(chatReportQueueResponseSchema.parse(queue.body).reports).toHaveLength(1);

    const analyticsCall = await request(app)
      .get('/api/v1/chat/admin/analytics')
      .set(bearer(identity, moderator));
    expect(analyticsCall.status).toBe(403);
  });
});

describe('the team directory', () => {
  it('refuses the directory without an account and to a customer', async () => {
    const { identity, customer, app, mocks } = setup();
    const anonymous = await request(app).get('/api/v1/chat/admin/team');
    expect(anonymous.status).toBe(401);

    const refused = await request(app)
      .get('/api/v1/chat/admin/team')
      .set(bearer(identity, customer));
    expect(refused.status).toBe(403);
    expect(mocks.team).not.toHaveBeenCalled();
  });

  it('lists teammates for staff and for a moderator', async () => {
    const { identity, staff, moderator, app } = setup();
    for (const user of [staff, moderator]) {
      const response = await request(app)
        .get('/api/v1/chat/admin/team')
        .set(bearer(identity, user));
      expect(response.status).toBe(200);
      const body = chatTeamResponseSchema.parse(response.body);
      expect(body.members[0]).toEqual(
        expect.objectContaining({ name: 'Queue Agent', canSupport: true, openCount: 2 }),
      );
    }
  });
});

describe('chat administration requests', () => {
  it('creates a template and validates the wording', async () => {
    const { identity, admin, mocks, app } = setup();
    const created = await request(app)
      .post('/api/v1/chat/admin/templates')
      .set(bearer(identity, admin))
      .send({
        name: 'Refund acknowledgement',
        category: 'returns',
        locale: 'en',
        body: 'Hello {customer_name}',
      });
    expect(created.status).toBe(201);
    expect(chatTemplateSchema.parse(created.body).id).toBe(TEMPLATE_ID);
    expect(mocks.saveTemplate).toHaveBeenCalledTimes(1);

    const invalid = await request(app)
      .post('/api/v1/chat/admin/templates')
      .set(bearer(identity, admin))
      .send({ name: '', category: 'returns', locale: 'en', body: '' });
    expect(invalid.status).toBe(400);
  });

  it('answers a template refusal with the code the client understands', async () => {
    const { identity, admin, app } = setup({
      saveTemplate: vi.fn(() => Promise.reject(new ChatRefusalError('template_variable_invalid'))),
    });
    const response = await request(app)
      .post('/api/v1/chat/admin/templates')
      .set(bearer(identity, admin))
      .send({
        name: 'Broken',
        category: 'other',
        locale: 'en',
        body: 'Hello {order_id}',
      });
    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('template_variable_invalid');
  });

  it('lists saved replies and tags for the queue', async () => {
    const { identity, staff, app } = setup();
    const replies = await request(app)
      .get('/api/v1/chat/admin/saved-replies')
      .set(bearer(identity, staff));
    expect(chatSavedRepliesResponseSchema.parse(replies.body).replies).toHaveLength(1);

    const tags = await request(app).get('/api/v1/chat/admin/tags').set(bearer(identity, staff));
    expect(chatTagsResponseSchema.parse(tags.body).tags[0]?.slug).toBe('refund');
  });

  it('posts a message with its attachments', async () => {
    const { identity, staff, app } = setup();
    const response = await request(app)
      .post('/api/v1/chat/messages')
      .set(bearer(identity, staff))
      .send({
        conversationId: CHAT_CONVERSATION_ID,
        clientMessageId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        body: 'Here is the receipt',
      });
    expect(response.status).toBe(201);
    expect(postedChatMessageSchema.parse(response.body).message.seq).toBe(7);
  });

  it('broadcasts a message that carries files, with the files attached', async () => {
    // A message with attachments only travels through this route, so this broadcast is the only
    // way the other side of the conversation learns a picture or a recording arrived.
    const messageSent = vi.fn();
    const notify = {
      message: messageSent,
      updated: vi.fn(),
      assign: vi.fn(),
      read: vi.fn(),
      typing: vi.fn(),
      unread: vi.fn(),
    } as unknown as ChatNotifier;
    const attachment = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      fileName: 'receipt.webp',
      contentType: 'image/webp',
      byteSize: 2048,
      width: 800,
      height: 600,
      durationMs: null,
      url: 'https://media.example.com/chat/x/full.webp',
      thumbnailUrl: 'https://media.example.com/chat/x/thumb.webp',
    };
    const { identity, customer, app } = setup(
      {
        postMessage: vi.fn(() =>
          Promise.resolve({
            message: {
              id: CHAT_MESSAGE_ID,
              seq: 9,
              senderId: null,
              senderRole: 'customer',
              senderName: 'Customer',
              kind: 'text',
              body: 'Is this the right one?',
              replyToId: null,
              metadata: {},
              createdAt: '2026-11-05T10:00:00.000Z',
            },
            duplicate: false,
            unreadCount: 1,
            attachments: [attachment],
          }),
        ),
      },
      { notify },
    );

    const response = await request(app)
      .post('/api/v1/chat/messages')
      .set(bearer(identity, customer))
      .send({
        conversationId: CHAT_CONVERSATION_ID,
        clientMessageId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        attachmentIds: [attachment.id],
      });

    expect(response.status).toBe(201);
    expect(messageSent).toHaveBeenCalledTimes(1);
    const [conversationId, message] = messageSent.mock.calls[0] as [
      string,
      { attachments: { url: string }[] },
    ];
    expect(conversationId).toBe(CHAT_CONVERSATION_ID);
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]?.url).toBe(attachment.url);
  });

  it('carries the quoted message on a file message and answers with the quote', async () => {
    const messageSent = vi.fn();
    const notify = { message: messageSent } as unknown as ChatNotifier;
    const replyTo = {
      id: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
      seq: 3,
      senderId: null,
      senderRole: 'staff' as const,
      senderName: 'Staff One',
      kind: 'text' as const,
      body: 'Which parcel?',
      hasAttachment: false,
      deleted: false,
    };
    const postMessage = vi.fn(() =>
      Promise.resolve({
        message: {
          id: CHAT_MESSAGE_ID,
          seq: 9,
          senderId: null,
          senderRole: 'customer',
          senderName: 'Customer',
          kind: 'text',
          body: 'The blue one',
          replyToId: replyTo.id,
          metadata: {},
          createdAt: '2026-11-05T10:00:00.000Z',
        },
        duplicate: false,
        unreadCount: 1,
        attachments: [],
      }),
    );
    const replySummary = vi.fn(() => Promise.resolve(replyTo));
    const { identity, customer, app } = setup({ postMessage, replySummary }, { notify });

    const response = await request(app)
      .post('/api/v1/chat/messages')
      .set(bearer(identity, customer))
      .send({
        conversationId: CHAT_CONVERSATION_ID,
        clientMessageId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        body: 'The blue one',
        replyToId: replyTo.id,
      });

    expect(response.status).toBe(201);
    // The reply id is handed to the store, which passes it to the database.
    const posted = postMessage.mock.calls as unknown as [
      string,
      string,
      { replyToId?: string | null },
    ][];
    expect(posted[0]?.[2]).toMatchObject({ replyToId: replyTo.id });
    // The quote is resolved from the conversation, not from whatever page the sender held.
    expect(replySummary).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      CHAT_CONVERSATION_ID,
      replyTo.id,
    );
    expect((response.body as { message: { replyTo: unknown } }).message.replyTo).toEqual(replyTo);
    // The realtime event carries the quote too, so the other side renders it immediately.
    expect(messageSent.mock.calls[0]?.[1]).toMatchObject({ replyToId: replyTo.id, replyTo });
  });

  it('does not broadcast a duplicate send again', async () => {
    const messageSent = vi.fn();
    const notify = { message: messageSent } as unknown as ChatNotifier;
    const { identity, customer, app } = setup(
      {
        postMessage: vi.fn(() =>
          Promise.resolve({
            message: {
              id: CHAT_MESSAGE_ID,
              seq: 9,
              senderId: null,
              senderRole: 'customer',
              senderName: 'Customer',
              kind: 'text',
              body: 'Already sent',
              replyToId: null,
              metadata: {},
              createdAt: '2026-11-05T10:00:00.000Z',
            },
            duplicate: true,
            unreadCount: 0,
            attachments: [],
          }),
        ),
      },
      { notify },
    );

    const response = await request(app)
      .post('/api/v1/chat/messages')
      .set(bearer(identity, customer))
      .send({
        conversationId: CHAT_CONVERSATION_ID,
        clientMessageId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        body: 'Already sent',
      });

    expect(response.status).toBe(201);
    expect(messageSent).not.toHaveBeenCalled();
  });

  it('refuses a message body that is not a uuid request', async () => {
    const { identity, staff, app } = setup();
    const response = await request(app)
      .post('/api/v1/chat/messages')
      .set(bearer(identity, staff))
      .send({ conversationId: 'not-a-uuid', clientMessageId: 'also-not' });
    expect(response.status).toBe(400);
  });

  it('streams an attachment to an authorized account with private cache headers', async () => {
    const attachmentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const uploadId = '22222222-2222-4222-8222-222222222222';
    const key = `chat/${CHAT_CONVERSATION_ID}/${uploadId}/full.webp`;
    const { identity, customer, app, objects } = setup(
      {
        attachmentMedia: vi.fn(() =>
          Promise.resolve({
            attachmentId,
            conversationId: CHAT_CONVERSATION_ID,
            objectKey: key,
            contentType: 'image/webp',
            fileName: 'receipt.webp',
            byteSize: 11,
          }),
        ),
      },
      { storage: true },
    );
    await objects.put({
      key,
      body: Buffer.from('image-bytes'),
      contentType: 'image/webp',
      cacheControl: 'public, max-age=1',
    });

    const response = await request(app)
      .get(`/api/v1/chat/attachments/${attachmentId}/media`)
      .set(bearer(identity, customer));

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/webp');
    // The same URL answers different accounts, so it may never enter a shared cache.
    expect(response.headers['cache-control']).toBe('private, max-age=300');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-disposition']).toContain('inline');
    expect(response.body).toEqual(Buffer.from('image-bytes'));
  });

  it('serves the thumbnail variant for a picture', async () => {
    const attachmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const uploadId = '33333333-3333-4333-8333-333333333333';
    const base = `chat/${CHAT_CONVERSATION_ID}/${uploadId}`;
    const { identity, customer, app, objects } = setup(
      {
        attachmentMedia: vi.fn(() =>
          Promise.resolve({
            attachmentId,
            conversationId: CHAT_CONVERSATION_ID,
            objectKey: `${base}/full.webp`,
            contentType: 'image/webp',
            fileName: 'receipt.webp',
            byteSize: 5,
          }),
        ),
      },
      { storage: true },
    );
    await objects.put({
      key: `${base}/thumb.webp`,
      body: Buffer.from('thumb'),
      contentType: 'image/webp',
      cacheControl: 'public',
    });

    const response = await request(app)
      .get(`/api/v1/chat/attachments/${attachmentId}/media?variant=thumb`)
      .set(bearer(identity, customer));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(Buffer.from('thumb'));
  });

  it('refuses an attachment the database will not resolve, without leaking a key', async () => {
    const { identity, customer, app } = setup({}, { storage: true });
    const response = await request(app)
      .get('/api/v1/chat/attachments/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/media')
      .set(bearer(identity, customer));

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('chat/');
    expect(JSON.stringify(response.body)).not.toContain('object');
  });

  it('refuses chat media without an account', async () => {
    const { app } = setup({}, { storage: true });
    const response = await request(app).get(
      '/api/v1/chat/attachments/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/media',
    );
    expect(response.status).toBe(401);
  });

  it('records a customer verdict on one support reply', async () => {
    const { identity, customer, mocks, app } = setup();
    const response = await request(app)
      .post(`/api/v1/chat/messages/${CHAT_MESSAGE_ID}/feedback`)
      .set(bearer(identity, customer))
      .send({ verdict: 'not_helpful', comment: '  The link expired.  ' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ verdict: 'helpful' });
    // The comment is trimmed before it reaches the database, and never trusted as sent.
    expect(mocks.submitMessageFeedback).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      CHAT_MESSAGE_ID,
      { verdict: 'not_helpful', comment: 'The link expired.' },
    );
  });

  it('refuses a verdict that is not one of the two', async () => {
    const { identity, customer, app } = setup();
    const response = await request(app)
      .post(`/api/v1/chat/messages/${CHAT_MESSAGE_ID}/feedback`)
      .set(bearer(identity, customer))
      .send({ verdict: 'amazing' });
    expect(response.status).toBe(400);
  });

  it('refuses feedback without an account', async () => {
    const { app } = setup();
    const response = await request(app)
      .post(`/api/v1/chat/messages/${CHAT_MESSAGE_ID}/feedback`)
      .send({ verdict: 'helpful' });
    expect(response.status).toBe(401);
  });

  it('lists a thread’s feedback for an authorized account', async () => {
    const messageFeedback = vi.fn(() =>
      Promise.resolve({
        feedback: [
          {
            id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            messageId: CHAT_MESSAGE_ID,
            customerName: 'Customer One',
            verdict: 'not_helpful' as const,
            comment: 'The link expired.',
            createdAt: '2026-11-05T10:00:00.000Z',
            updatedAt: '2026-11-05T10:05:00.000Z',
          },
        ],
      }),
    );
    const { identity, staff, app } = setup({ messageFeedback });

    const response = await request(app)
      .get(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/feedback`)
      .set(bearer(identity, staff));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      feedback: [{ verdict: 'not_helpful', comment: 'The link expired.' }],
    });
    expect(messageFeedback).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      CHAT_CONVERSATION_ID,
    );
  });

  it('answers a refused feedback read with the permission code, not a list', async () => {
    const { identity, customer, app } = setup({
      messageFeedback: vi.fn(() => Promise.reject(new ChatRefusalError('forbidden'))),
    });
    const response = await request(app)
      .get(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/feedback`)
      .set(bearer(identity, customer));

    expect(response.status).toBe(403);
    expect(errorOf(response.body).code).toBe('forbidden');
  });

  it('answers 503 when attachment uploads are not configured', async () => {
    const { identity, customer, app } = setup();
    const response = await request(app)
      .post(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/attachments?fileName=a.png`)
      .set(bearer(identity, customer))
      .set('Content-Type', 'image/png')
      .send(Buffer.from('not really a png'));
    expect(response.status).toBe(503);
    expect(errorOf(response.body).code).toBe('media_unavailable');
  });

  it('accepts an attachment between the picture limit and the chat-attachment limit', async () => {
    const { identity, customer, mocks, app, objects } = setup({}, { storage: true });
    const body = await makeNoisePng();
    // The bug this covers: the route used the 5 MB picture reader, so a 5-10 MB picture that
    // the contract, the web client and the app all allow was refused with 413 after upload.
    expect(body.length).toBeGreaterThan(PRODUCT_IMAGE_MAX_BYTES);
    expect(body.length).toBeLessThan(CHAT_ATTACHMENT_MAX_BYTES);

    const response = await request(app)
      .post(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/attachments?fileName=large.png`)
      .set(bearer(identity, customer))
      .set('Content-Type', 'image/png')
      .send(body);

    expect(response.status).toBe(201);
    expect(mocks.beginAttachment).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        conversationId: CHAT_CONVERSATION_ID,
        // A picture is re-encoded, so its stored name carries the extension of what was stored.
        fileName: 'large.webp',
        contentType: 'image/webp',
      }),
    );
    // The key is generated by the API under the conversation's own prefix.
    for (const key of objects.objects.keys()) {
      expect(key.startsWith(`chat/${CHAT_CONVERSATION_ID}/`)).toBe(true);
    }
    expect(objects.objects.size).toBe(2);
  });

  it('passes a recording length through, and only for a recording', async () => {
    const { identity, customer, mocks, app } = setup({}, { storage: true });
    const recording = Buffer.concat([Buffer.from('OggS', 'latin1'), Buffer.alloc(64)]);

    const voice = await request(app)
      .post(
        `/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/attachments?fileName=voice.ogg&durationMs=12500`,
      )
      .set(bearer(identity, customer))
      .set('Content-Type', 'audio/ogg')
      .send(recording);

    expect(voice.status).toBe(201);
    expect(mocks.beginAttachment).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ contentType: 'audio/ogg', durationMs: 12500 }),
    );

    // The same parameter on a picture is dropped rather than sent to a database that would
    // refuse it: a length belongs to a recording.
    const picture = await request(app)
      .post(
        `/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/attachments?fileName=shot.png&durationMs=12500`,
      )
      .set(bearer(identity, customer))
      .set('Content-Type', 'image/png')
      .send(await makeNoisePng(600, 600));

    expect(picture.status).toBe(201);
    // The same parameter on a picture is dropped rather than sent to a database that would
    // refuse it: a length belongs to a recording.
    const inputs = mocks.beginAttachment.mock.calls as unknown as Array<
      [string, string, { durationMs?: number }]
    >;
    expect(inputs.at(-1)?.[2].durationMs).toBeUndefined();
  });

  it('answers the five-pending-uploads refusal with 409 rather than 404', async () => {
    const { identity, customer, mocks, app } = setup({}, { storage: true });
    // The bug this covers: the database's NZ519 (five uploads already waiting in the thread)
    // used to be classified as "that upload is not available" with a 404, which told the
    // operator nothing about what to do and looked like a lost record.
    mocks.beginAttachment.mockRejectedValueOnce(new ChatRefusalError('attachment_pending_limit'));

    const response = await request(app)
      .post(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/attachments?fileName=note.txt`)
      .set(bearer(identity, customer))
      .set('Content-Type', 'text/plain')
      .send(Buffer.from('Return slip', 'utf8'));

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('attachment_invalid');
    expect(errorOf(response.body).message).toContain('already waiting');
  });

  it('refuses a recording length the contract does not allow', async () => {
    const { identity, customer, mocks, app } = setup({}, { storage: true });
    const response = await request(app)
      .post(
        `/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/attachments?fileName=voice.ogg&durationMs=300001`,
      )
      .set(bearer(identity, customer))
      .set('Content-Type', 'audio/ogg')
      .send(Buffer.concat([Buffer.from('OggS', 'latin1'), Buffer.alloc(64)]));

    expect(response.status).toBe(400);
    expect(mocks.beginAttachment).not.toHaveBeenCalled();
  });

  it('refuses an attachment above the chat-attachment limit', async () => {
    const { identity, customer, mocks, app, objects } = setup({}, { storage: true });
    const response = await request(app)
      .post(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/attachments?fileName=huge.png`)
      .set(bearer(identity, customer))
      .set('Content-Type', 'image/png')
      .send(Buffer.alloc(CHAT_ATTACHMENT_MAX_BYTES + 1));

    expect(response.status).toBe(413);
    expect(errorOf(response.body).code).toBe('payload_too_large');
    expect(mocks.beginAttachment).not.toHaveBeenCalled();
    expect(objects.objects.size).toBe(0);
  });

  it.each([
    ['application/pdf', () => Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n', 'latin1')],
    ['text/plain', () => Buffer.from('Return slip: one lamp', 'utf8')],
    ['text/csv', () => Buffer.from('sku,qty\nlamp,2', 'utf8')],
    ['audio/ogg', () => Buffer.concat([Buffer.from('OggS', 'latin1'), Buffer.alloc(40)])],
  ])('stores a %s attachment exactly as sent, in one object', async (type, make) => {
    const { identity, customer, mocks, app, objects } = setup({}, { storage: true });
    const body = make();

    const response = await request(app)
      .post(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/attachments?fileName=note.pdf`)
      .set(bearer(identity, customer))
      .set('Content-Type', type)
      .send(body);

    expect(response.status).toBe(201);
    // A document or a recording is never re-encoded: the stored bytes are the sent bytes.
    const stored = [...objects.objects.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.body.equals(body)).toBe(true);
    expect(stored[0]?.contentType).toBe(type);
    for (const key of objects.objects.keys()) {
      expect(key.startsWith(`chat/${CHAT_CONVERSATION_ID}/`)).toBe(true);
    }
    expect(mocks.beginAttachment).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ contentType: type, byteSize: body.length }),
    );
  });

  it('keeps a picture re-encoded as WebP, two variants, never the sent bytes', async () => {
    const { identity, customer, mocks, app, objects } = setup({}, { storage: true });
    const sent = await makeNoisePng(600, 600);

    const response = await request(app)
      .post(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/attachments?fileName=photo.png`)
      .set(bearer(identity, customer))
      .set('Content-Type', 'image/png')
      .send(sent);

    expect(response.status).toBe(201);
    const stored = [...objects.objects.values()];
    expect(stored).toHaveLength(2);
    for (const object of stored) expect(object.contentType).toBe('image/webp');
    expect(stored.every((object) => !object.body.equals(sent))).toBe(true);
    expect(mocks.beginAttachment).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ contentType: 'image/webp' }),
    );
  });

  it('refuses a document whose bytes are not what its type claims', async () => {
    const { identity, customer, mocks, app, objects } = setup({}, { storage: true });
    const response = await request(app)
      .post(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/attachments?fileName=evil.pdf`)
      .set(bearer(identity, customer))
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('MZ\u0090\u0000\u0003 this is a Windows executable', 'latin1'));

    expect(response.status).toBe(400);
    expect(errorOf(response.body)).toMatchObject({
      code: 'image_invalid',
      details: { reason: 'signature_mismatch' },
    });
    expect(mocks.beginAttachment).not.toHaveBeenCalled();
    expect(objects.objects.size).toBe(0);
  });

  it.each(['application/zip', 'application/x-msdownload', 'image/gif', 'audio/flac'])(
    'refuses the unsupported type %s before storing anything',
    async (type) => {
      const { identity, customer, mocks, app, objects } = setup({}, { storage: true });
      const response = await request(app)
        .post(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/attachments?fileName=x.bin`)
        .set(bearer(identity, customer))
        .set('Content-Type', type)
        .send(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]));

      expect(response.status).toBe(415);
      expect(errorOf(response.body).code).toBe('unsupported_media_type');
      expect(mocks.beginAttachment).not.toHaveBeenCalled();
      expect(objects.objects.size).toBe(0);
    },
  );

  it('cleans the uploaded name and never lets it shape the object key', async () => {
    const { identity, customer, mocks, app, objects } = setup({}, { storage: true });

    await request(app)
      .post(
        `/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/attachments?fileName=${encodeURIComponent('../../etc/passwd.pdf')}`,
      )
      .set(bearer(identity, customer))
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('%PDF-1.4\n', 'latin1'));

    expect(mocks.beginAttachment).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ fileName: 'passwd.pdf' }),
    );
    for (const key of objects.objects.keys()) {
      expect(key).toMatch(new RegExp(`^chat/${CHAT_CONVERSATION_ID}/[0-9a-f-]{36}/[0-9a-f-]{36}$`));
      expect(key).not.toContain('..');
    }
  });

  it('records a customer rating of a resolved conversation', async () => {
    const { identity, customer, mocks, app } = setup();
    const response = await request(app)
      .post(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/rating`)
      .set(bearer(identity, customer))
      .send({ rating: 5, comment: 'Fast' });
    expect(response.status).toBe(201);
    expect(chatCsatResponseSchema.parse(response.body).rating).toBe(5);
    expect(mocks.submitCsat).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      CHAT_CONVERSATION_ID,
      5,
      'Fast',
    );
  });

  it('decides a report and validates the decision', async () => {
    const { identity, moderator, mocks, app } = setup();
    const accepted = await request(app)
      .post(`/api/v1/chat/admin/reports/${REPORT_ID}/decide`)
      .set(bearer(identity, moderator))
      .send({ status: 'actioned', actionTaken: 'message_deleted' });
    expect(accepted.status).toBe(200);
    expect(reportDecisionSchema.parse(accepted.body).actionTaken).toBe('message_deleted');
    expect(mocks.decideReport).toHaveBeenCalledTimes(1);

    const refused = await request(app)
      .post(`/api/v1/chat/admin/reports/${REPORT_ID}/decide`)
      .set(bearer(identity, moderator))
      .send({ status: 'not-a-status' });
    expect(refused.status).toBe(400);
  });

  it('saves and previews an automation rule', async () => {
    const { identity, admin, mocks, app } = setup();
    const rules = await request(app)
      .get('/api/v1/chat/admin/automation')
      .set(bearer(identity, admin));
    expect(chatAutomationRulesResponseSchema.parse(rules.body).rules[0]?.cooldownSeconds).toBe(900);

    const saved = await request(app)
      .post('/api/v1/chat/admin/automation')
      .set(bearer(identity, admin))
      .send({
        name: 'Acknowledge refund questions',
        trigger: 'message_received',
        conditions: { keywords: ['refund'] },
        actions: [{ type: 'set_priority', value: 'high' }],
      });
    expect(saved.status).toBe(201);
    expect(mocks.saveAutomationRule).toHaveBeenCalledTimes(1);

    const preview = await request(app)
      .post('/api/v1/chat/admin/automation/preview')
      .set(bearer(identity, admin))
      .send({ ruleId: RULE_ID, conversationId: CHAT_CONVERSATION_ID });
    expect(preview.status).toBe(200);
    expect(chatAutomationPreviewSchema.parse(preview.body).wouldRun).toBe(true);
  });

  it('refuses an automation action outside the closed vocabulary', async () => {
    const { identity, admin, app } = setup();
    const response = await request(app)
      .post('/api/v1/chat/admin/automation')
      .set(bearer(identity, admin))
      .send({
        name: 'Dangerous',
        trigger: 'message_received',
        conditions: {},
        actions: [{ type: 'run_sql' }],
      });
    expect(response.status).toBe(400);
  });

  it('lists the automation run log', async () => {
    const { identity, admin, app } = setup();
    const response = await request(app)
      .get('/api/v1/chat/admin/automation/runs?limit=10&offset=0')
      .set(bearer(identity, admin));
    expect(response.status).toBe(200);
    expect(chatAutomationRunsResponseSchema.parse(response.body).runs).toEqual([]);
  });

  it('opens and lists internal staff conversations', async () => {
    const { identity, staff, app } = setup();
    const channels = await request(app).get('/api/v1/chat/internal').set(bearer(identity, staff));
    expect(channels.status).toBe(200);

    const created = await request(app)
      .post('/api/v1/chat/internal')
      .set(bearer(identity, staff))
      .send({ kind: 'internal_direct', participantIds: [CHAT_MESSAGE_ID] });
    // The fake answers with a refusal, which must arrive as its own status and code.
    expect(created.status).toBe(403);
    expect(errorOf(created.body).code).toBe('forbidden');
  });
});

const REACTION_URL = `/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/messages/${CHAT_MESSAGE_ID}/reactions`;

describe('message reactions', () => {
  /** The notifier the route broadcasts a changed thread through. */
  function notifier() {
    const updated = vi.fn();
    return { updated, notify: { updated } as unknown as ChatNotifier };
  }

  it('answers on the nested route every client calls, not the old flat one (it was a 404)', async () => {
    const { identity, customer, app } = setup();
    const flat = await request(app)
      .post(`/api/v1/chat/messages/${CHAT_MESSAGE_ID}/reactions`)
      .set(bearer(identity, customer))
      .send({ emoji: 'thumbs_up' });
    expect(flat.status).toBe(404);

    const nested = await request(app)
      .post(REACTION_URL)
      .set(bearer(identity, customer))
      .send({ emoji: 'thumbs_up' });
    expect(nested.status).toBe(200);
  });

  it('adds, changes and removes a reaction, and tells the thread which conversation changed', async () => {
    const answers = [
      {
        messageId: CHAT_MESSAGE_ID,
        emoji: 'thumbs_up',
        added: true,
        summary: [{ emoji: 'thumbs_up', count: 1 }],
      },
      {
        messageId: CHAT_MESSAGE_ID,
        emoji: 'heart',
        added: true,
        summary: [{ emoji: 'heart', count: 1 }],
      },
      { messageId: CHAT_MESSAGE_ID, emoji: 'heart', added: false, summary: [] },
    ];
    const toggleReaction = vi.fn(() => Promise.resolve(answers.shift() ?? answers[0]!));
    const { updated, notify } = notifier();
    const { identity, customer, app } = setup({ toggleReaction }, { notify });

    const add = await request(app)
      .post(REACTION_URL)
      .set(bearer(identity, customer))
      .send({ emoji: 'thumbs_up' });
    expect(add.status).toBe(200);
    expect(chatReactionResponseSchema.parse(add.body)).toMatchObject({
      added: true,
      emoji: 'thumbs_up',
    });

    const change = await request(app)
      .post(REACTION_URL)
      .set(bearer(identity, customer))
      .send({ emoji: 'heart' });
    expect(chatReactionResponseSchema.parse(change.body)).toMatchObject({
      added: true,
      emoji: 'heart',
    });

    const remove = await request(app)
      .post(REACTION_URL)
      .set(bearer(identity, customer))
      .send({ emoji: 'heart' });
    expect(chatReactionResponseSchema.parse(remove.body)).toMatchObject({
      added: false,
      summary: [],
    });

    expect(toggleReaction).toHaveBeenCalledTimes(3);
    expect(toggleReaction).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.any(String),
      CHAT_MESSAGE_ID,
      'thumbs_up',
    );
    expect(updated).toHaveBeenCalledTimes(3);
    expect(updated).toHaveBeenCalledWith(CHAT_CONVERSATION_ID, 'reaction');
  });

  it('refuses a bad emoji or a bad id before touching the store', async () => {
    const { updated, notify } = notifier();
    const { identity, customer, mocks, app } = setup({}, { notify });
    for (const emoji of ['', '   ', 'x'.repeat(17), 7]) {
      const response = await request(app)
        .post(REACTION_URL)
        .set(bearer(identity, customer))
        .send({ emoji });
      expect(response.status).toBe(400);
    }
    const noBody = await request(app).post(REACTION_URL).set(bearer(identity, customer)).send({});
    expect(noBody.status).toBe(400);
    const badId = await request(app)
      .post(`/api/v1/chat/conversations/not-a-uuid/messages/${CHAT_MESSAGE_ID}/reactions`)
      .set(bearer(identity, customer))
      .send({ emoji: 'heart' });
    expect(badId.status).toBe(400);
    expect(mocks.toggleReaction).not.toHaveBeenCalled();
    expect(updated).not.toHaveBeenCalled();
  });

  it('refuses an anonymous reaction', async () => {
    const { mocks, app } = setup();
    const response = await request(app).post(REACTION_URL).send({ emoji: 'heart' });
    expect(response.status).toBe(401);
    expect(mocks.toggleReaction).not.toHaveBeenCalled();
  });

  it('answers a conversation the caller cannot read like a missing one, without a broadcast', async () => {
    const { updated, notify } = notifier();
    const { identity, customer, app } = setup(
      {
        toggleReaction: vi.fn(() => Promise.reject(new ChatRefusalError('conversation_not_found'))),
      },
      { notify },
    );
    const response = await request(app)
      .post(REACTION_URL)
      .set(bearer(identity, customer))
      .send({ emoji: 'heart' });
    expect(response.status).toBe(404);
    expect(errorOf(response.body).code).toBe('conversation_not_found');
    expect(updated).not.toHaveBeenCalled();
  });
});

describe('a customer reading their own feedback', () => {
  const URL = `/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/my-feedback`;

  it('answers with the callers verdicts only, for the conversation in the path', async () => {
    const myMessageFeedback = vi.fn(() =>
      Promise.resolve({ feedback: [{ messageId: CHAT_MESSAGE_ID, verdict: 'helpful' as const }] }),
    );
    const { identity, customer, app } = setup({ myMessageFeedback });
    const response = await request(app).get(URL).set(bearer(identity, customer));
    expect(response.status).toBe(200);
    expect(chatMyFeedbackResponseSchema.parse(response.body).feedback).toEqual([
      { messageId: CHAT_MESSAGE_ID, verdict: 'helpful' },
    ]);
    expect((response.body as { feedback: object[] }).feedback[0]).not.toHaveProperty('comment');
    expect(myMessageFeedback).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      CHAT_CONVERSATION_ID,
    );
  });

  it('refuses an anonymous caller and a malformed id', async () => {
    const { identity, customer, mocks, app } = setup();
    expect((await request(app).get(URL)).status).toBe(401);
    const bad = await request(app)
      .get('/api/v1/chat/conversations/not-a-uuid/my-feedback')
      .set(bearer(identity, customer));
    expect(bad.status).toBe(400);
    expect(mocks.myMessageFeedback).not.toHaveBeenCalled();
  });

  it('answers a thread the caller may not read like a missing one', async () => {
    const { identity, customer, app } = setup({
      myMessageFeedback: vi.fn(() =>
        Promise.reject(new ChatRefusalError('conversation_not_found')),
      ),
    });
    const response = await request(app).get(URL).set(bearer(identity, customer));
    expect(response.status).toBe(404);
    expect(errorOf(response.body).code).toBe('conversation_not_found');
  });
});

describe('sending a message whose upload is gone', () => {
  it('answers with the missing-upload message, not the too-many-uploads one', async () => {
    const { identity, customer, app } = setup({
      postMessage: vi.fn(() => Promise.reject(new ChatRefusalError('attachment_not_found'))),
    });
    const response = await request(app)
      .post('/api/v1/chat/messages')
      .set(bearer(identity, customer))
      .send({
        conversationId: CHAT_CONVERSATION_ID,
        clientMessageId: CHAT_MESSAGE_ID,
        body: 'Here',
        attachmentIds: ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
      });
    expect(response.status).toBe(404);
    expect(errorOf(response.body)).toMatchObject({
      code: 'attachment_not_found',
      message: 'That upload is no longer available. Attach the file again.',
    });
  });

  it('maps the database codes apart: NZ525 is a missing upload, NZ519 is the pending limit', () => {
    expect(toChatError({ code: 'NZ525', message: '', details: null }, 'x')).toMatchObject({
      refusal: 'attachment_not_found',
    });
    expect(toChatError({ code: 'NZ519', message: '', details: null }, 'x')).toMatchObject({
      refusal: 'attachment_pending_limit',
    });
  });
});

describe('chat picture size rules', () => {
  const upload = (name: string) =>
    `/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/attachments?fileName=${name}`;

  it('accepts an ordinary screenshot or crop below the product-photo minimum', async () => {
    const { identity, customer, mocks, app, objects } = setup({}, { storage: true });
    const small = await makeImage('png', 120, 90);
    const response = await request(app)
      .post(upload('crop.png'))
      .set(bearer(identity, customer))
      .set('Content-Type', 'image/png')
      .send(small);
    expect(response.status).toBe(201);
    expect(objects.objects.size).toBe(2);
    expect(mocks.beginAttachment).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ contentType: 'image/webp', width: 120, height: 90 }),
    );
  });

  it('still refuses a picture too tiny to see, with wording that matches the real limit', async () => {
    const { identity, customer, mocks, app, objects } = setup({}, { storage: true });
    const tiny = await makeImage('png', 8, 8);
    const response = await request(app)
      .post(upload('dot.png'))
      .set(bearer(identity, customer))
      .set('Content-Type', 'image/png')
      .send(tiny);
    expect(response.status).toBe(400);
    expect(errorOf(response.body)).toMatchObject({
      code: 'image_invalid',
      details: { reason: 'too_small' },
    });
    expect(errorOf(response.body).message).toContain(`${CHAT_IMAGE_MIN_SIZE} pixels`);
    expect(errorOf(response.body).message).not.toContain('400');
    expect(mocks.beginAttachment).not.toHaveBeenCalled();
    expect(objects.objects.size).toBe(0);
  });

  it('refuses a picture above the largest dimension', async () => {
    const { identity, customer, mocks, app } = setup({}, { storage: true });
    const wide = await makeImage('png', 8100, 20);
    const response = await request(app)
      .post(upload('wide.png'))
      .set(bearer(identity, customer))
      .set('Content-Type', 'image/png')
      .send(wide);
    expect(response.status).toBe(400);
    expect(errorOf(response.body)).toMatchObject({
      code: 'image_invalid',
      details: { reason: 'too_large' },
    });
    expect(mocks.beginAttachment).not.toHaveBeenCalled();
  });

  it('refuses an animated picture and a picture of another type', async () => {
    const { identity, customer, mocks, app } = setup({}, { storage: true });
    const animated = await request(app)
      .post(upload('moving.webp'))
      .set(bearer(identity, customer))
      .set('Content-Type', 'image/webp')
      .send(await makeAnimatedWebp());
    expect(animated.status).toBe(400);
    expect(errorOf(animated.body).details).toMatchObject({ reason: 'animated' });

    const mismatch = await request(app)
      .post(upload('pic.jpg'))
      .set(bearer(identity, customer))
      .set('Content-Type', 'image/jpeg')
      .send(await makeImage('png', 200, 200));
    expect(mismatch.status).toBe(400);
    expect(errorOf(mismatch.body).details).toMatchObject({ reason: 'signature_mismatch' });

    const gif = await request(app)
      .post(upload('a.gif'))
      .set(bearer(identity, customer))
      .set('Content-Type', 'image/gif')
      .send(Buffer.from('GIF89a'));
    expect(gif.status).toBe(415);
    expect(mocks.beginAttachment).not.toHaveBeenCalled();
  });
});
