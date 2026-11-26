import {
  chatJoinPayloadSchema,
  chatLeavePayloadSchema,
  chatReadPayloadSchema,
  chatSendPayloadSchema,
  chatTypingPayloadSchema,
  CHAT_CLIENT_EVENTS,
  CHAT_SERVER_EVENTS,
  DOMAIN_EVENT_SOCKET_EVENT,
  type ChatSendAck,
} from '@nilzora/contracts';
import type { Server as HttpServer } from 'node:http';
import type { Logger } from 'pino';
import { Server, type DefaultEventsMap, type Socket } from 'socket.io';
import type { AuthDependencies } from '../middleware/authenticate';
import type { ChatStore } from '../modules/chat/store';
import { chatRefusalAnswer } from '../modules/chat/errors';
import { resolveSocketIdentity, SocketAuthUnavailableError } from './auth';
import type { ChatNotifier } from './notifier';
import { createPresenceRegistry, type PresenceOptions } from './presence';
import type { ChatTicketSigner } from './ticket';
import type { OutboxEvent } from '../modules/events/store';

/*
 * The realtime layer
 * ------------------
 * Socket.IO carries what only exists in the moment: typing, presence, and the fan-out of
 * a message that has already been committed. It never stores anything, and it never
 * decides authorization on its own — every room join asks the database whether the account
 * may read that conversation, and every message send goes through the same function the
 * REST route uses.
 *
 * Rooms are server-controlled: a client asks to join a conversation and is either admitted
 * or refused. A client cannot name its own room, its own identity or its own role.
 *
 * One API instance is assumed. Several instances need `@socket.io/redis-adapter` so a
 * broadcast reaches sockets on the other processes, plus Redis-backed presence; nothing in
 * this file depends on the process being alone beyond the in-memory presence registry.
 */

const ROOM_PREFIX = 'conversation:';
/** A message burst above this is a script, not a shopper. */
const MESSAGE_BURST = 12;
const MESSAGE_WINDOW_MS = 10_000;
/** Joining is cheap but not free: each join is one authorization query. */
const JOIN_BURST = 30;
const JOIN_WINDOW_MS = 60_000;
const TYPING_MIN_INTERVAL_MS = 2_500;
const TYPING_EXPIRY_MS = 6_000;
const SWEEP_INTERVAL_MS = 15_000;
/** The room staff sockets share. Joining it is gated by the same permission as the queue route. */
const QUEUE_ROOM = 'staff:queue';
/** Bursts of changes (a busy minute) become one hint, so staff clients re-read once, not often. */
const QUEUE_SIGNAL_DELAY_MS = 400;

export interface RealtimeDependencies {
  chat: ChatStore;
  tickets: ChatTicketSigner;
  auth: AuthDependencies;
  corsOrigins: readonly string[];
  logger: Logger;
  presence?: PresenceOptions | undefined;
}

export interface Realtime {
  notifier: ChatNotifier;
  /**
   * Delivers a committed domain event to the sockets allowed to see it (its recipient's room and
   * its audience permission's room). Fire-and-forget: a client that was offline recovers it from
   * GET /me/events, so this is never the record of anything.
   */
  publishDomainEvent(event: OutboxEvent): void;
  /** Resolves once the Socket.IO server has closed its connections. */
  close(): Promise<void>;
}

interface SocketState {
  /** True once the handshake established an active account. */
  authenticated: boolean;
  /** Whether this account may work a customer queue (admin or moderator workspace). */
  canWorkQueue: boolean;
  /** The account's permissions at the handshake: they decide its event rooms. */
  permissions: readonly string[];
  userId: string;
  accessToken: string;
  conversations: Set<string>;
  messageBudget: Budget;
  joinBudget: Budget;
  lastTyping: Map<string, number>;
  typingTimers: Map<string, NodeJS.Timeout>;
}

/** A fixed-window counter: simple, monotonic and impossible to reset from the client. */
class Budget {
  private count = 0;
  private windowStart = Date.now();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  take(): boolean {
    const now = Date.now();
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.count = 0;
    }
    if (this.count >= this.limit) return false;
    this.count += 1;
    return true;
  }
}

function roomOf(conversationId: string): string {
  return `${ROOM_PREFIX}${conversationId}`;
}

/** An account's private event room. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** The event room of everyone holding a permission (staff alerts are addressed this way). */
export function permissionRoom(permission: string): string {
  return `perm:${permission}`;
}

/** The server-side socket this module works with: its `data` is the per-connection state. */
type ChatSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketState>;

function stateOf(socket: ChatSocket): SocketState {
  return socket.data;
}

export function attachRealtime(server: HttpServer, deps: RealtimeDependencies): Realtime {
  const { chat, logger } = deps;
  const presence = createPresenceRegistry(deps.presence);
  const io = new Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketState>(server, {
    // Room membership is decided server-side, so the adapter never sees a client-chosen room.
    cors: { origin: [...deps.corsOrigins], methods: ['GET', 'POST'], credentials: false },
    // A chat message is at most 4000 characters; anything larger is refused by the transport.
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 25_000,
    pingTimeout: 20_000,
    connectTimeout: 20_000,
  });

  let queueSignal: NodeJS.Timeout | null = null;
  /** Coalesced, content-free: staff clients answer it by re-reading the queue over REST. */
  function signalQueue(): void {
    if (queueSignal) return;
    queueSignal = setTimeout(() => {
      queueSignal = null;
      io.to(QUEUE_ROOM).emit(CHAT_SERVER_EVENTS.queueChanged, {});
    }, QUEUE_SIGNAL_DELAY_MS);
    queueSignal.unref();
  }

  io.use((socket, next) => {
    const handshake = socket.handshake.auth as Record<string, unknown> | undefined;
    resolveSocketIdentity(deps, { token: handshake?.token, ticket: handshake?.ticket })
      .then((identity) => {
        if (!identity) {
          next(new Error('unauthorized'));
          return;
        }
        const state: SocketState = {
          authenticated: true,
          canWorkQueue:
            identity.permissions.has('admin_workspace.access') ||
            identity.permissions.has('moderator_workspace.access'),
          permissions: [...identity.permissions],
          userId: identity.userId,
          accessToken: identity.accessToken,
          conversations: new Set(),
          messageBudget: new Budget(MESSAGE_BURST, MESSAGE_WINDOW_MS),
          joinBudget: new Budget(JOIN_BURST, JOIN_WINDOW_MS),
          lastTyping: new Map(),
          typingTimers: new Map(),
        };
        socket.data = state;
        next();
      })
      .catch((error: unknown) => {
        if (error instanceof SocketAuthUnavailableError) {
          next(new Error('unavailable'));
          return;
        }
        logger.error(
          { errorName: error instanceof Error ? error.name : 'UnknownError' },
          'Realtime handshake failed',
        );
        next(new Error('unauthorized'));
      });
  });

  function announcePresence(conversationId: string, userId: string, online: boolean): void {
    io.to(roomOf(conversationId)).emit(CHAT_SERVER_EVENTS.presence, {
      conversationId,
      userId,
      online,
    });
  }

  function stopTyping(socket: ChatSocket, conversationId: string): void {
    const state = stateOf(socket);
    const timer = state.typingTimers.get(conversationId);
    if (timer) clearTimeout(timer);
    state.typingTimers.delete(conversationId);
    state.lastTyping.delete(conversationId);
  }

  io.on('connection', (socket) => {
    const state = stateOf(socket);
    // Domain-event rooms, decided here from the verified identity, never asked for by the client:
    // the account's own room, and one room per permission it holds (staff alerts are addressed
    // to a permission). A customer therefore only ever hears about their own orders.
    void socket.join([userRoom(state.userId), ...state.permissions.map(permissionRoom)]);

    socket.on(CHAT_CLIENT_EVENTS.heartbeat, () => {
      presence.touch(socket.id);
    });

    socket.on(CHAT_CLIENT_EVENTS.joinQueue, () => {
      // The room carries only "something changed"; still, only accounts that may open the queue
      // are admitted, decided from the permissions read at the handshake.
      if (!state.canWorkQueue) {
        socket.emit(CHAT_SERVER_EVENTS.failed, {
          code: 'forbidden',
          message: 'That live feed is not available to this account',
        });
        return;
      }
      void socket.join(QUEUE_ROOM);
      socket.emit(CHAT_SERVER_EVENTS.queueJoined, {});
    });

    socket.on(CHAT_CLIENT_EVENTS.join, async (payload: unknown) => {
      const parsed = chatJoinPayloadSchema.safeParse(payload);
      if (!parsed.success) return;
      const { conversationId } = parsed.data;
      if (state.conversations.has(conversationId)) {
        socket.emit(CHAT_SERVER_EVENTS.joined, { conversationId });
        return;
      }
      if (!state.joinBudget.take()) {
        socket.emit(CHAT_SERVER_EVENTS.failed, {
          conversationId,
          code: 'rate_limited',
          message: 'Too many conversations opened at once',
        });
        return;
      }

      try {
        // The authorization decision is the database's, made for this account right now.
        const allowed = await chat.canAccess(state.accessToken, state.userId, conversationId);
        if (!allowed) {
          socket.emit(CHAT_SERVER_EVENTS.failed, {
            conversationId,
            code: 'conversation_not_found',
            message: 'That conversation is not available',
          });
          return;
        }
        const detail = await chat.detail(state.accessToken, state.userId, conversationId);
        await socket.join(roomOf(conversationId));
        state.conversations.add(conversationId);
        presence.add(socket.id, state.userId, conversationId);

        socket.emit(CHAT_SERVER_EVENTS.joined, {
          conversationId,
          online: presence.onlineIn(
            conversationId,
            detail.participants.map((participant) => participant.userId),
          ),
        });
        announcePresence(conversationId, state.userId, true);
      } catch (error) {
        const answer = chatRefusalAnswer(error);
        if (answer) {
          socket.emit(CHAT_SERVER_EVENTS.failed, { conversationId, ...answer });
          return;
        }
        logger.error(
          { errorName: error instanceof Error ? error.name : 'UnknownError' },
          'Realtime join failed',
        );
        socket.emit(CHAT_SERVER_EVENTS.failed, {
          conversationId,
          code: 'service_unavailable',
          message: 'Live updates are unavailable right now',
        });
      }
    });

    socket.on(CHAT_CLIENT_EVENTS.leave, (payload: unknown) => {
      const parsed = chatLeavePayloadSchema.safeParse(payload);
      if (!parsed.success) return;
      const { conversationId } = parsed.data;
      stopTyping(socket, conversationId);
      void socket.leave(roomOf(conversationId));
      state.conversations.delete(conversationId);
      presence.remove(socket.id, conversationId);
      if (!presence.isOnline(conversationId, state.userId)) {
        announcePresence(conversationId, state.userId, false);
      }
    });

    socket.on(CHAT_CLIENT_EVENTS.send, async (payload: unknown, ack?: unknown) => {
      const parsed = chatSendPayloadSchema.safeParse(payload);
      const answer = (result: ChatSendAck): void => {
        if (typeof ack === 'function') {
          (ack as (value: ChatSendAck) => void)(result);
          return;
        }
        // A client that joined without a callback still gets a definitive answer.
        socket.emit(
          result.ok ? CHAT_SERVER_EVENTS.ack : CHAT_SERVER_EVENTS.failed,
          result.ok
            ? { message: result.message, duplicate: result.duplicate, unread: result.unread }
            : { code: result.code, message: result.error },
        );
      };

      if (!parsed.success) {
        answer({ ok: false, code: 'validation_failed', error: 'That message cannot be sent' });
        return;
      }
      const { conversationId, clientMessageId, body, replyToId } = parsed.data;

      if (!state.conversations.has(conversationId)) {
        answer({
          ok: false,
          code: 'forbidden',
          error: 'Join the conversation before sending to it',
        });
        return;
      }
      if (!state.messageBudget.take()) {
        answer({
          ok: false,
          code: 'rate_limited',
          error: 'Too many messages. Wait a moment and try again.',
        });
        return;
      }

      try {
        // Persist first: the acknowledgement means "stored", never "probably stored".
        const result = await chat.send(state.accessToken, state.userId, conversationId, {
          clientMessageId,
          body,
          replyToId,
        });
        stopTyping(socket, conversationId);
        socket.to(roomOf(conversationId)).emit(CHAT_SERVER_EVENTS.typing, {
          conversationId,
          userId: state.userId,
          name: result.message.senderName,
          typing: false,
        });
        io.to(roomOf(conversationId)).emit(CHAT_SERVER_EVENTS.newMessage, {
          conversationId,
          message: result.message,
        });
        io.to(roomOf(conversationId)).emit(CHAT_SERVER_EVENTS.updated, {
          conversationId,
          change: 'message',
        });
        signalQueue();
        answer({
          ok: true,
          message: result.message,
          duplicate: result.duplicate,
          unread: result.unread,
        });
      } catch (error) {
        const refusal = chatRefusalAnswer(error);
        if (refusal) {
          answer({ ok: false, code: refusal.code, error: refusal.message });
          return;
        }
        logger.error(
          { errorName: error instanceof Error ? error.name : 'UnknownError' },
          'Realtime message send failed',
        );
        answer({
          ok: false,
          code: 'service_unavailable',
          error: 'The message could not be sent. Try again.',
        });
      }
    });

    socket.on(CHAT_CLIENT_EVENTS.read, async (payload: unknown) => {
      const parsed = chatReadPayloadSchema.safeParse(payload);
      if (!parsed.success) return;
      const { conversationId, seq } = parsed.data;
      if (!state.conversations.has(conversationId)) return;
      try {
        const unread = await chat.markRead(state.accessToken, state.userId, conversationId, seq);
        io.to(roomOf(conversationId)).emit(CHAT_SERVER_EVENTS.read, {
          conversationId,
          userId: state.userId,
          seq,
          unread,
        });
      } catch {
        // A read receipt is not worth an error event: the next join re-reads it.
      }
    });

    socket.on(CHAT_CLIENT_EVENTS.typingStart, (payload: unknown) => {
      const parsed = chatTypingPayloadSchema.safeParse(payload);
      if (!parsed.success) return;
      const { conversationId } = parsed.data;
      if (!state.conversations.has(conversationId)) return;

      // Typing is ephemeral: it never touches the database and is throttled here.
      const now = Date.now();
      const last = state.lastTyping.get(conversationId) ?? 0;
      const timer = state.typingTimers.get(conversationId);
      if (timer) clearTimeout(timer);
      state.typingTimers.set(
        conversationId,
        setTimeout(() => {
          state.typingTimers.delete(conversationId);
          state.lastTyping.delete(conversationId);
          socket.to(roomOf(conversationId)).emit(CHAT_SERVER_EVENTS.typing, {
            conversationId,
            userId: state.userId,
            name: null,
            typing: false,
          });
        }, TYPING_EXPIRY_MS),
      );
      if (now - last < TYPING_MIN_INTERVAL_MS) return;
      state.lastTyping.set(conversationId, now);
      socket.to(roomOf(conversationId)).emit(CHAT_SERVER_EVENTS.typing, {
        conversationId,
        userId: state.userId,
        name: null,
        typing: true,
      });
    });

    socket.on(CHAT_CLIENT_EVENTS.typingStop, (payload: unknown) => {
      const parsed = chatTypingPayloadSchema.safeParse(payload);
      if (!parsed.success) return;
      const { conversationId } = parsed.data;
      if (!state.conversations.has(conversationId)) return;
      stopTyping(socket, conversationId);
      socket.to(roomOf(conversationId)).emit(CHAT_SERVER_EVENTS.typing, {
        conversationId,
        userId: state.userId,
        name: null,
        typing: false,
      });
    });

    socket.on('disconnect', () => {
      for (const timer of state.typingTimers.values()) clearTimeout(timer);
      state.typingTimers.clear();
      const left = presence.removeAll(socket.id);
      if (!left) return;
      for (const conversationId of left.conversationIds) {
        if (!presence.isOnline(conversationId, left.userId)) {
          announcePresence(conversationId, left.userId, false);
        }
      }
    });
  });

  // A socket that stops heartbeating is closed, which fires its disconnect handler and
  // tells the other members it left. Claiming to be online is therefore not enough.
  const sweeper = setInterval(() => {
    for (const socketId of presence.expired()) {
      io.sockets.sockets.get(socketId)?.disconnect(true);
    }
  }, SWEEP_INTERVAL_MS);
  sweeper.unref();

  const notifier: ChatNotifier = {
    queue() {
      signalQueue();
    },
    message(conversationId, message) {
      signalQueue();
      io.to(roomOf(conversationId)).emit(CHAT_SERVER_EVENTS.newMessage, {
        conversationId,
        message,
      });
      io.to(roomOf(conversationId)).emit(CHAT_SERVER_EVENTS.updated, {
        conversationId,
        change: 'message',
      });
    },
    read(conversationId, userId, seq) {
      io.to(roomOf(conversationId)).emit(CHAT_SERVER_EVENTS.read, { conversationId, userId, seq });
    },
    updated(conversationId, change) {
      signalQueue();
      io.to(roomOf(conversationId)).emit(CHAT_SERVER_EVENTS.updated, { conversationId, change });
    },
    assigned(conversationId, assigneeId) {
      signalQueue();
      io.to(roomOf(conversationId)).emit(CHAT_SERVER_EVENTS.assigned, {
        conversationId,
        assigneeId,
      });
      io.to(roomOf(conversationId)).emit(CHAT_SERVER_EVENTS.updated, {
        conversationId,
        change: 'assigned',
      });
    },
  };

  logger.info('Realtime is listening for chat sockets');

  return {
    notifier,
    publishDomainEvent(event) {
      const rooms = [
        ...(event.recipientUserId ? [userRoom(event.recipientUserId)] : []),
        ...(event.audiencePermission ? [permissionRoom(event.audiencePermission)] : []),
      ];
      if (rooms.length === 0) return;
      // One broadcast to the union of rooms: a socket in two of them receives it once.
      io.to(rooms).emit(DOMAIN_EVENT_SOCKET_EVENT, {
        seq: event.seq,
        id: event.id,
        type: event.type,
        version: event.version,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload,
        occurredAt: event.occurredAt,
      });
    },
    async close() {
      clearInterval(sweeper);
      if (queueSignal) clearTimeout(queueSignal);
      await io.close();
    },
  };
}
