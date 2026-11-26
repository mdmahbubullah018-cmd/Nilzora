import {
  chatConversationListResponseSchema,
  chatConversationResponseSchema,
  chatMessagePageSchema,
  chatReportResponseSchema,
  chatSocketTicketSchema,
  sendChatMessageResponseSchema,
} from '@nilzora/contracts';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { AssistantRequest, ChatAssistant } from '../modules/chat/assistant-service';
import { createChatTicketSigner } from '../realtime/ticket';
import { CHAT_CONVERSATION_ID, CHAT_MESSAGE_ID, FakeChat } from './chat-fakes';
import { errorOf } from './commerce-helpers';
import { FakeIdentity } from './fakes';
import { testApp } from './helpers';

/*
 * The REST surface of the communication system, exercised against a fake store.
 *
 * What these tests hold down is the API's own part: that every route needs a verified
 * account, that the body and query are validated, that a database refusal becomes the right
 * status and code, and that a socket ticket is issued only to the caller's own account.
 * Who may read which thread is the database's decision and lives in the pgTAP suite.
 */

const SECRET = 'test-chat-socket-secret-that-is-long-enough-01';

function setup(options: { tickets?: boolean; assistant?: ChatAssistant } = {}) {
  const identity = new FakeIdentity();
  const customer = identity.addUser({ email: 'one@example.com' });
  const staff = identity.addUser({ email: 'staff@example.com', role: 'staff' });
  const moderator = identity.addUser({ email: 'mod@example.com', role: 'moderator' });
  const suspended = identity.addUser({ email: 'held@example.com', status: 'suspended' });
  const chat = new FakeChat();
  const app = testApp({
    auth: identity.deps,
    chat: {
      store: chat,
      ...(options.tickets === false ? {} : { tickets: createChatTicketSigner(SECRET) }),
      ...(options.assistant ? { assistant: options.assistant } : {}),
    },
  });
  return { identity, customer, staff, moderator, suspended, chat, app };
}

type FakeUser = ReturnType<FakeIdentity['addUser']>;

function bearer(identity: FakeIdentity, user: FakeUser) {
  return { Authorization: `Bearer ${identity.tokenFor(user)}` };
}

describe('chat authentication and validation', () => {
  it('refuses every route without a verified account', async () => {
    const { app } = setup();
    const calls = [
      request(app).get('/api/v1/chat/conversations'),
      request(app).get('/api/v1/chat/unread-count'),
      request(app).get(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}`),
      request(app).get(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/messages`),
      request(app)
        .post('/api/v1/chat/conversations')
        .send({ kind: 'customer_support', body: 'Hi' }),
      request(app).post('/api/v1/chat/socket-ticket'),
    ];
    for (const call of calls) {
      const response = await call;
      expect(response.status).toBe(401);
      expect(errorOf(response.body).code).toBe('unauthenticated');
    }
  });

  it('refuses a suspended account', async () => {
    const { app, identity, suspended } = setup();
    const response = await request(app)
      .get('/api/v1/chat/conversations')
      .set(bearer(identity, suspended));
    expect(response.status).toBe(403);
    expect(errorOf(response.body).code).toBe('account_suspended');
  });

  it('rejects a conversation request with neither a message nor an order', async () => {
    const { app, identity, customer } = setup();
    const response = await request(app)
      .post('/api/v1/chat/conversations')
      .set(bearer(identity, customer))
      .send({ kind: 'customer_support' });
    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
  });

  it('rejects unknown fields instead of ignoring them', async () => {
    const { app, identity, customer } = setup();
    const response = await request(app)
      .post('/api/v1/chat/conversations')
      .set(bearer(identity, customer))
      .send({ kind: 'customer_support', body: 'Hello', priority: 'urgent', customerId: 'x' });
    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
  });

  it('rejects a conversation id that is not a uuid', async () => {
    const { app, identity, customer } = setup();
    const response = await request(app)
      .get('/api/v1/chat/conversations/not-a-uuid')
      .set(bearer(identity, customer));
    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
  });

  it('rejects a message longer than the limit', async () => {
    const { app, identity, customer } = setup();
    const response = await request(app)
      .post(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/messages`)
      .set(bearer(identity, customer))
      .send({ clientMessageId: CHAT_MESSAGE_ID, body: 'x'.repeat(4001) });
    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
  });
});

describe('chat reads and writes', () => {
  it('lists conversations with the unread count and pagination', async () => {
    const { app, identity, customer } = setup();
    const response = await request(app)
      .get('/api/v1/chat/conversations?scope=all&pageSize=10')
      .set(bearer(identity, customer));

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = chatConversationListResponseSchema.parse(response.body);
    expect(body.total).toBe(1);
    expect(body.unread).toBe(2);
    expect(body.conversations[0]?.id).toBe(CHAT_CONVERSATION_ID);
  });

  it('starts a conversation and answers 201 with the thread', async () => {
    const { app, identity, customer, chat } = setup();
    const response = await request(app)
      .post('/api/v1/chat/conversations')
      .set(bearer(identity, customer))
      .send({ kind: 'customer_support', subject: 'Delivery', body: 'How long to Sylhet?' });

    expect(response.status).toBe(201);
    chatConversationResponseSchema.parse(response.body);
    expect(chat.starts).toEqual([
      { kind: 'customer_support', subject: 'Delivery', body: 'How long to Sylhet?' },
    ]);
  });

  it('answers a retried send with the stored message and says it is a duplicate', async () => {
    const { app, identity, customer, chat } = setup();
    chat.duplicateNextSend = true;
    const response = await request(app)
      .post(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/messages`)
      .set(bearer(identity, customer))
      .send({ clientMessageId: CHAT_MESSAGE_ID, body: 'Same message' });

    expect(response.status).toBe(201);
    expect(sendChatMessageResponseSchema.parse(response.body).duplicate).toBe(true);
    expect(chat.sends).toHaveLength(1);
  });

  it('asks the assistant after storing a customer message, and never for a duplicate', async () => {
    const respond = vi.fn<(request: AssistantRequest) => Promise<void>>(() => Promise.resolve());
    const assistant: ChatAssistant = { respond };
    const { app, identity, customer } = setup({ assistant });

    await request(app)
      .post(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/messages`)
      .set(bearer(identity, customer))
      .send({ clientMessageId: CHAT_MESSAGE_ID, body: 'Where is NZ1042?' });

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toMatchObject({
      conversationId: CHAT_CONVERSATION_ID,
      body: 'Where is NZ1042?',
      customerId: customer.id,
    });
  });

  it('leaves a retried send to the stored message', async () => {
    const respond = vi.fn<(request: AssistantRequest) => Promise<void>>(() => Promise.resolve());
    const { app, identity, customer, chat } = setup({ assistant: { respond } });
    chat.duplicateNextSend = true;

    await request(app)
      .post(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/messages`)
      .set(bearer(identity, customer))
      .send({ clientMessageId: CHAT_MESSAGE_ID, body: 'Same message' });

    expect(respond).not.toHaveBeenCalled();
  });

  it('asks the assistant when a conversation opens with a message', async () => {
    const respond = vi.fn<(request: AssistantRequest) => Promise<void>>(() => Promise.resolve());
    const { app, identity, customer } = setup({ assistant: { respond } });

    await request(app)
      .post('/api/v1/chat/conversations')
      .set(bearer(identity, customer))
      .send({ kind: 'customer_support', body: 'Hello' });

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toMatchObject({ body: 'Hello' });
  });

  it('pages messages and returns the cursor of the page before', async () => {
    const { app, identity, customer } = setup();
    const response = await request(app)
      .get(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/messages?limit=1`)
      .set(bearer(identity, customer));

    expect(response.status).toBe(200);
    expect(chatMessagePageSchema.parse(response.body).messages).toHaveLength(1);
    expect(chatMessagePageSchema.parse(response.body).nextCursor).toBe(1);
  });

  it('records a read receipt', async () => {
    const { app, identity, customer } = setup();
    const response = await request(app)
      .post(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/read`)
      .set(bearer(identity, customer))
      .send({ seq: 12 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ unread: 0 });
  });

  it('reports a message', async () => {
    const { app, identity, customer } = setup();
    const response = await request(app)
      .post(`/api/v1/chat/messages/${CHAT_MESSAGE_ID}/report`)
      .set(bearer(identity, customer))
      .send({ reason: 'abuse' });

    expect(response.status).toBe(201);
    expect(chatReportResponseSchema.parse(response.body)).toMatchObject({
      messageId: CHAT_MESSAGE_ID,
      status: 'open',
    });
  });

  it('maps a database refusal to its status and code', async () => {
    const { app, identity, customer, chat } = setup();
    chat.refusals.set('send', 'conversation_closed');
    const response = await request(app)
      .post(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/messages`)
      .set(bearer(identity, customer))
      .send({ clientMessageId: CHAT_MESSAGE_ID, body: 'Hello' });

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('conversation_closed');
  });

  it('answers a thread the caller may not see exactly like a missing one', async () => {
    const { app, identity, customer, chat } = setup();
    chat.refusals.set('detail', 'conversation_not_found');
    const response = await request(app)
      .get(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}`)
      .set(bearer(identity, customer));

    expect(response.status).toBe(404);
    expect(errorOf(response.body).code).toBe('conversation_not_found');
  });
});

describe('staff-only queue operations', () => {
  it('refuses assignment to an account outside a workspace', async () => {
    const { app, identity, customer } = setup();
    const response = await request(app)
      .post(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/assignee`)
      .set(bearer(identity, customer))
      .send({ assigneeId: null });

    expect(response.status).toBe(403);
    expect(errorOf(response.body).code).toBe('forbidden');
  });

  it('refuses internal notes to a customer', async () => {
    const { app, identity, customer } = setup();
    const response = await request(app)
      .get(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/notes`)
      .set(bearer(identity, customer));

    expect(response.status).toBe(403);
  });

  it('lets staff assign, reprioritise and note', async () => {
    const { app, identity, staff, chat } = setup();
    const assigned = await request(app)
      .post(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/assignee`)
      .set(bearer(identity, staff))
      .send({ assigneeId: null, note: 'Back to the queue' });
    expect(assigned.status).toBe(200);
    expect(chat.assignments).toEqual([{ assigneeId: null }]);

    const prioritised = await request(app)
      .post(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/priority`)
      .set(bearer(identity, staff))
      .send({ priority: 'urgent' });
    expect(prioritised.status).toBe(200);
    expect(chat.priorities).toEqual(['urgent']);

    const noted = await request(app)
      .post(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/notes`)
      .set(bearer(identity, staff))
      .send({ body: 'Customer called too' });
    expect(noted.status).toBe(201);
    expect(chat.noteLog).toHaveLength(1);
  });

  it('lets a moderator use the queue controls the workspace guard allows', async () => {
    const { app, identity, moderator } = setup();
    const response = await request(app)
      .get(`/api/v1/chat/conversations/${CHAT_CONVERSATION_ID}/notes`)
      .set(bearer(identity, moderator));
    expect(response.status).toBe(200);
  });
});

describe('the operator queue', () => {
  it('refuses the queue to a customer', async () => {
    const { app, identity, customer, chat } = setup();
    const response = await request(app)
      .get('/api/v1/chat/admin/queue')
      .set(bearer(identity, customer));

    expect(response.status).toBe(403);
    expect(errorOf(response.body).code).toBe('forbidden');
    expect(chat.queueQueries).toHaveLength(0);
  });

  it('passes the filters and the sort through and answers with the list shape', async () => {
    const { app, identity, staff, chat } = setup();
    const response = await request(app)
      .get('/api/v1/chat/admin/queue?scope=unassigned&priority=urgent&sort=oldest&search=refund&page=2&pageSize=5')
      .set(bearer(identity, staff));

    expect(response.status).toBe(200);
    const body = chatConversationListResponseSchema.parse(response.body);
    expect(body.unread).toBe(2);
    expect(body.page).toBe(2);
    expect(chat.queueQueries).toEqual([
      expect.objectContaining({
        scope: 'unassigned',
        priority: 'urgent',
        sort: 'oldest',
        search: 'refund',
        page: 2,
        pageSize: 5,
      }),
    ]);
  });

  it('defaults to the queue order and rejects an unknown sort', async () => {
    const { app, identity, staff, chat } = setup();
    const fine = await request(app).get('/api/v1/chat/admin/queue').set(bearer(identity, staff));
    expect(fine.status).toBe(200);
    expect(chat.queueQueries[0]).toEqual(expect.objectContaining({ scope: 'all', sort: 'queue' }));

    const refused = await request(app)
      .get('/api/v1/chat/admin/queue?sort=loudest')
      .set(bearer(identity, staff));
    expect(refused.status).toBe(400);
  });
});

describe('socket tickets', () => {
  it('answers 503 when the server has no realtime key', async () => {
    const { app, identity, customer } = setup({ tickets: false });
    const response = await request(app)
      .post('/api/v1/chat/socket-ticket')
      .set(bearer(identity, customer));
    expect(response.status).toBe(503);
    expect(errorOf(response.body).code).toBe('realtime_unavailable');
  });

  it('issues a ticket that names only the caller', async () => {
    const { app, identity, customer } = setup();
    const response = await request(app)
      .post('/api/v1/chat/socket-ticket')
      .set(bearer(identity, customer));

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const signer = createChatTicketSigner(SECRET);
    expect(signer.verify(chatSocketTicketSchema.parse(response.body).ticket)).toBe(customer.id);
  });
});
