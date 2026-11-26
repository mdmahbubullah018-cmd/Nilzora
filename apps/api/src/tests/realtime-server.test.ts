import type { ChatMessage } from '@nilzora/contracts';
import { createServer, type Server as HttpServer } from 'node:http';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import type { OutboxEvent } from '../modules/events/store';
import { attachRealtime, type Realtime } from '../realtime/server';
import { createChatTicketSigner } from '../realtime/ticket';
import { CHAT_CONVERSATION_ID, CHAT_MESSAGE_ID, FakeChat } from './chat-fakes';
import { FakeIdentity } from './fakes';
import { captureLogs } from './helpers';

/*
 * Socket.IO, exercised over a real HTTP server with real clients.
 *
 * These tests hold down the parts a mocked call cannot: that a connection needs a verified
 * account, that a room is joined only after the store authorizes it, that an acknowledgement
 * is answered after the message is stored, and that the other member of the room receives
 * the message plus the presence and typing events.
 */

const TICKET_SECRET = 'test-chat-socket-secret-that-is-long-enough-01';

interface Harness {
  url: string;
  identity: FakeIdentity;
  chat: FakeChat;
  realtime: Realtime;
  server: HttpServer;
  customer: { id: string };
  staff: { id: string };
  cleanup: () => Promise<void>;
}

const open: ClientSocket[] = [];

async function harness(options: { tokenFreeAccounts?: boolean } = {}): Promise<Harness> {
  const identity = new FakeIdentity();
  const customer = identity.addUser({ email: 'one@example.com' });
  const staff = identity.addUser({ email: 'staff@example.com', role: 'staff' });
  const chat = new FakeChat();
  const server = createServer();
  const base = identity.deps;
  /*
   * `createPostgresAccountStore.loadAccess` reads the account from its id, not from the
   * token, because the direct connection carries the identity itself. A socket opened with
   * a ticket has no access token, so that is the store realtime runs against; the fake above
   * is token-scoped, so it is adapted here for the ticket case.
   */
  const auth = options.tokenFreeAccounts
    ? {
        ...base,
        accounts: {
          ...base.accounts,
          loadAccess: (_token: string, userId: string) => {
            const user = identity.users.get(userId);
            return user
              ? base.accounts.loadAccess(identity.tokenFor(user), userId)
              : Promise.resolve(null);
          },
        },
      }
    : base;
  const realtime = attachRealtime(server, {
    chat,
    tickets: createChatTicketSigner(TICKET_SECRET),
    auth,
    corsOrigins: ['http://localhost:3000'],
    logger: captureLogs('silent').logger,
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');

  return {
    url: `http://127.0.0.1:${address.port}`,
    identity,
    chat,
    realtime,
    server,
    customer,
    staff,
    cleanup: async () => {
      for (const socket of open.splice(0)) socket.disconnect();
      await realtime.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function client(target: Harness, auth: Record<string, unknown>): ClientSocket {
  const socket = connect(target.url, {
    auth,
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  open.push(socket);
  return socket;
}

function next<T>(socket: ClientSocket, event: string, timeoutMs = 4000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function connected(socket: ClientSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out connecting')), 4000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function send(socket: ClientSocket, event: string, payload: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (answer: unknown) => resolve(answer));
  });
}

let running: Harness | undefined;

afterEach(async () => {
  await running?.cleanup();
  running = undefined;
});

describe('realtime authentication', () => {
  it('refuses a connection without any credential', async () => {
    running = await harness();
    const socket = client(running, {});
    await expect(connected(socket)).rejects.toThrow(/unauthorized/);
  });

  it('refuses a forged ticket', async () => {
    running = await harness();
    const socket = client(running, { ticket: 'v1.forged.forged' });
    await expect(connected(socket)).rejects.toThrow(/unauthorized/);
  });

  it('accepts the account access token the mobile app uses', async () => {
    running = await harness();
    const token = running.identity.tokenFor(running.customer as never);
    const socket = client(running, { token });
    await connected(socket);
    expect(socket.connected).toBe(true);
  });

  it('accepts the short-lived ticket the web apps use', async () => {
    running = await harness({ tokenFreeAccounts: true });
    const ticket = createChatTicketSigner(TICKET_SECRET).issue(running.customer.id).ticket;
    const socket = client(running, { ticket });
    await connected(socket);
    expect(socket.connected).toBe(true);
  });
});

describe('realtime rooms and messages', () => {
  it('joins a conversation it is allowed to see, and delivers the message to the other member', async () => {
    running = await harness();
    const customerToken = running.identity.tokenFor(running.customer as never);
    const staffToken = running.identity.tokenFor(running.staff as never);
    const customer = client(running, { token: customerToken });
    const staff = client(running, { token: staffToken });
    await Promise.all([connected(customer), connected(staff)]);

    const customerJoined = next<{ conversationId: string }>(customer, 'conversation:joined');
    customer.emit('conversation:join', { conversationId: CHAT_CONVERSATION_ID });
    expect((await customerJoined).conversationId).toBe(CHAT_CONVERSATION_ID);

    const staffJoined = next<{ conversationId: string }>(staff, 'conversation:joined');
    staff.emit('conversation:join', { conversationId: CHAT_CONVERSATION_ID });
    await staffJoined;

    const delivered = next<{ message: ChatMessage }>(staff, 'message:new');
    const ack = (await send(customer, 'message:send', {
      conversationId: CHAT_CONVERSATION_ID,
      clientMessageId: CHAT_MESSAGE_ID,
      body: 'Do you deliver to Sylhet?',
    })) as { ok: boolean; message?: ChatMessage };

    expect(ack.ok).toBe(true);
    expect(ack.message?.body).toBe('Do you deliver to Sylhet?');
    expect((await delivered).message.body).toBe('Do you deliver to Sylhet?');
    expect(running.chat.sends).toHaveLength(1);
  });

  it('refuses to join a room the store does not authorize', async () => {
    running = await harness();
    running.chat.allowAccess = false;
    const token = running.identity.tokenFor(running.customer as never);
    const socket = client(running, { token });
    await connected(socket);

    const failed = next<{ code: string }>(socket, 'message:failed');
    socket.emit('conversation:join', { conversationId: CHAT_CONVERSATION_ID });
    expect((await failed).code).toBe('conversation_not_found');
  });

  it('refuses to send into a conversation the socket has not joined', async () => {
    running = await harness();
    const token = running.identity.tokenFor(running.customer as never);
    const socket = client(running, { token });
    await connected(socket);

    const ack = (await send(socket, 'message:send', {
      conversationId: CHAT_CONVERSATION_ID,
      clientMessageId: CHAT_MESSAGE_ID,
      body: 'Sneaky',
    })) as { ok: boolean; code?: string };

    expect(ack.ok).toBe(false);
    expect(ack.code).toBe('forbidden');
    expect(running.chat.sends).toHaveLength(0);
  });

  it('rejects a malformed payload without touching the store', async () => {
    running = await harness();
    const token = running.identity.tokenFor(running.customer as never);
    const socket = client(running, { token });
    await connected(socket);

    const ack = (await send(socket, 'message:send', {
      conversationId: 'not-a-uuid',
      clientMessageId: 'nope',
      body: '',
    })) as { ok: boolean; code?: string };

    expect(ack.ok).toBe(false);
    expect(ack.code).toBe('validation_failed');
    expect(running.chat.sends).toHaveLength(0);
  });

  it('tells the other member that someone is typing', async () => {
    running = await harness();
    const customerToken = running.identity.tokenFor(running.customer as never);
    const staffToken = running.identity.tokenFor(running.staff as never);
    const customer = client(running, { token: customerToken });
    const staff = client(running, { token: staffToken });
    await Promise.all([connected(customer), connected(staff)]);

    for (const socket of [customer, staff]) {
      const joined = next<{ conversationId: string }>(socket, 'conversation:joined');
      socket.emit('conversation:join', { conversationId: CHAT_CONVERSATION_ID });
      await joined;
    }

    const typing = next<{ typing: boolean; userId: string }>(staff, 'typing:update');
    customer.emit('typing:start', { conversationId: CHAT_CONVERSATION_ID });
    const update = await typing;
    expect(update.typing).toBe(true);
    expect(update.userId).toBe(running.customer.id);
  });

  it('announces presence when a member joins and leaves', async () => {
    running = await harness();
    const customerToken = running.identity.tokenFor(running.customer as never);
    const staffToken = running.identity.tokenFor(running.staff as never);
    const customer = client(running, { token: customerToken });
    const staff = client(running, { token: staffToken });
    await Promise.all([connected(customer), connected(staff)]);

    const firstJoin = next<{ conversationId: string }>(customer, 'conversation:joined');
    customer.emit('conversation:join', { conversationId: CHAT_CONVERSATION_ID });
    await firstJoin;

    const presence = next<{ online: boolean; userId: string }>(customer, 'presence:update');
    const staffJoin = next<{ conversationId: string }>(staff, 'conversation:joined');
    staff.emit('conversation:join', { conversationId: CHAT_CONVERSATION_ID });
    await staffJoin;

    const seen = await presence;
    expect(seen).toMatchObject({ online: true, userId: running.staff.id });

    const gone = next<{ online: boolean; userId: string }>(customer, 'presence:update');
    staff.emit('conversation:leave', { conversationId: CHAT_CONVERSATION_ID });
    expect(await gone).toMatchObject({ online: false, userId: running.staff.id });
  });

  it('records a read receipt for the room', async () => {
    running = await harness();
    const customerToken = running.identity.tokenFor(running.customer as never);
    const customer = client(running, { token: customerToken });
    await connected(customer);

    const joined = next<{ conversationId: string }>(customer, 'conversation:joined');
    customer.emit('conversation:join', { conversationId: CHAT_CONVERSATION_ID });
    await joined;

    const receipt = next<{ seq: number; userId: string }>(customer, 'message:read');
    customer.emit('message:read', { conversationId: CHAT_CONVERSATION_ID, seq: 7 });
    expect(await receipt).toMatchObject({ seq: 7, userId: running.customer.id });
  });
});

describe('the staff queue feed', () => {
  it('tells a staff socket the queue changed, once for a burst, without any conversation content', async () => {
    running = await harness();
    const staff = client(running, { token: running.identity.tokenFor(running.staff as never) });
    const customer = client(running, {
      token: running.identity.tokenFor(running.customer as never),
    });
    await Promise.all([connected(staff), connected(customer)]);

    const joined = next<Record<string, never>>(staff, 'queue:joined');
    staff.emit('queue:join');
    await joined;

    const changes: unknown[] = [];
    staff.on('queue:changed', (payload: unknown) => changes.push(payload));

    // A customer message is a change; so are three quick notifications.
    const customerJoined = next(customer, 'conversation:joined');
    customer.emit('conversation:join', { conversationId: CHAT_CONVERSATION_ID });
    await customerJoined;
    const ack = (await send(customer, 'message:send', {
      conversationId: CHAT_CONVERSATION_ID,
      clientMessageId: CHAT_MESSAGE_ID,
      body: 'Is the blue bag back in stock?',
    })) as { ok: boolean };
    expect(ack.ok).toBe(true);
    running.realtime.notifier.queue();
    running.realtime.notifier.queue();
    await new Promise((resolve) => setTimeout(resolve, 900));

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({});
  });

  it('refuses a customer the feed and never sends them a signal', async () => {
    running = await harness();
    const customer = client(running, {
      token: running.identity.tokenFor(running.customer as never),
    });
    await connected(customer);
    const signals: unknown[] = [];
    customer.on('queue:changed', (payload: unknown) => signals.push(payload));

    const refused = next<{ code: string }>(customer, 'message:failed');
    customer.emit('queue:join');
    expect((await refused).code).toBe('forbidden');

    running.realtime.notifier.queue();
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(signals).toHaveLength(0);
  });
});

describe('domain events over the socket', () => {
  const event = (overrides: Partial<OutboxEvent> = {}) => ({
    seq: 41,
    id: '0e000000-0000-4000-8000-0000000000e1',
    type: 'order.confirmed',
    version: 1,
    aggregateType: 'order',
    aggregateId: 'NZ-1001',
    payload: { orderNumber: 'NZ-1001', status: 'confirmed' },
    occurredAt: new Date().toISOString(),
    recipientUserId: null,
    audiencePermission: null,
    attempts: 1,
    ...overrides,
  });

  it('reaches only the recipient: another customer never hears about it', async () => {
    running = await harness();
    const other = running.identity.addUser({ email: 'two@example.com' });
    const mine = client(running, { token: running.identity.tokenFor(running.customer as never) });
    const theirs = client(running, { token: running.identity.tokenFor(other) });
    await Promise.all([connected(mine), connected(theirs)]);

    const heard: unknown[] = [];
    theirs.on('nilzora:event', (payload: unknown) => heard.push(payload));
    const received = next<{ seq: number; type: string; payload: Record<string, unknown> }>(
      mine,
      'nilzora:event',
    );
    running.realtime.publishDomainEvent(event({ recipientUserId: running.customer.id }));

    expect(await received).toMatchObject({
      seq: 41,
      type: 'order.confirmed',
      payload: { orderNumber: 'NZ-1001' },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(heard).toEqual([]);
  });

  it('reaches every staff socket holding the audience permission, once each, and no customer', async () => {
    running = await harness();
    const desk = client(running, { token: running.identity.tokenFor(running.staff as never) });
    const phone = client(running, { token: running.identity.tokenFor(running.staff as never) });
    const customer = client(running, {
      token: running.identity.tokenFor(running.customer as never),
    });
    await Promise.all([connected(desk), connected(phone), connected(customer)]);

    const deskEvents: unknown[] = [];
    desk.on('nilzora:event', (payload: unknown) => deskEvents.push(payload));
    const customerEvents: unknown[] = [];
    customer.on('nilzora:event', (payload: unknown) => customerEvents.push(payload));
    const phoneHeard = next(phone, 'nilzora:event');

    // Addressed both to the staff member and to a permission they hold: still delivered once.
    running.realtime.publishDomainEvent(
      event({
        type: 'staff_notification.created',
        recipientUserId: running.staff.id,
        audiencePermission: 'orders.read',
      }),
    );
    await phoneHeard;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(deskEvents).toHaveLength(1);
    expect(customerEvents).toEqual([]);
  });
});
