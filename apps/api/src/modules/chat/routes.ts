import type { RequestHandler } from 'express';
import { Router } from 'express';
import {
  addChatNoteRequestSchema,
  assignChatRequestSchema,
  chatConversationListQuerySchema,
  chatConversationListResponseSchema,
  chatConversationResponseSchema,
  chatMessagePageQuerySchema,
  chatMessagePageSchema,
  chatNotesResponseSchema,
  chatQueueQuerySchema,
  chatReportResponseSchema,
  chatSocketTicketSchema,
  chatUnreadCountSchema,
  markChatReadRequestSchema,
  reportChatMessageRequestSchema,
  sendChatMessageRequestSchema,
  sendChatMessageResponseSchema,
  setChatPriorityRequestSchema,
  setChatStatusRequestSchema,
  startChatConversationRequestSchema,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { z } from 'zod';
import { sendError } from '../../http/send-error';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { currentIdentity, requireAnyPermission } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import type { ChatNotifier } from '../../realtime/notifier';
import { noopNotifier } from '../../realtime/notifier';
import type { ChatTicketSigner } from '../../realtime/ticket';
import { noStore } from '../commerce/http';
import type { ChatAssistant } from './assistant-service';
import { silentAssistant } from './assistant-service';
import { sendChatFailure } from './errors';
import type { ChatStore } from './store';

/*
 * Unified communication REST surface
 * ----------------------------------
 * Realtime carries the live events; everything that must be durable, paginated or
 * authorized on demand is here. Each route takes the caller's identity from the verified
 * access token and nothing else: no route accepts "who am I" or "whose thread is this"
 * from the request. The coarse permission guards below are the outer bound; the database
 * functions decide the actual rows, so a staff member still cannot read a colleague's
 * private thread by reaching the right endpoint.
 */

const conversationParams = { params: z.object({ conversationId: uuidSchema }) };
const messageParams = { params: z.object({ messageId: uuidSchema }) };

export interface ChatRouteDependencies extends AuthDependencies {
  chat: ChatStore;
  /** Per-account message budget, separate from the general API limiter. */
  limiter: RequestHandler;
  /** Undefined when realtime is off: the ticket route then answers 503. */
  tickets?: ChatTicketSigner | undefined;
  /** Broadcasts a committed change to the live sockets; a no-op when realtime is off. */
  notify?: ChatNotifier | undefined;
  /** Answers a first customer message from store facts; a no-op when not configured. */
  assistant?: ChatAssistant | undefined;
}

export function chatRoutes(deps: ChatRouteDependencies): Router {
  const { chat, tickets } = deps;
  const notify = deps.notify ?? noopNotifier;
  const assistant = deps.assistant ?? silentAssistant;
  const requireUser = authenticate(deps);
  const router = Router();
  // Both workspaces may run a queue; a moderator reaches only moderation threads.
  const canWorkQueues = requireAnyPermission([
    'admin_workspace.access',
    'moderator_workspace.access',
  ]);

  /**
   * POST /chat/socket-ticket â€” a two-minute, single-account credential for the socket
   * handshake. Only the caller's own account is named, so a ticket cannot be used to act
   * as someone else, and no REST route accepts one.
   */
  router.post('/chat/socket-ticket', noStore, requireUser, (_req, res) => {
    if (!tickets) {
      sendError(res, 503, 'realtime_unavailable', 'Live updates are not available right now');
      return;
    }
    const identity = currentIdentity(res);
    const issued = tickets.issue(identity.userId);
    res.json(chatSocketTicketSchema.parse(issued));
  });

  router.post(
    '/chat/conversations',
    noStore,
    requireUser,
    validate({ body: startChatConversationRequestSchema }),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<{ body: typeof startChatConversationRequestSchema }>(res);
      try {
        const detail = await chat.start(identity.accessToken, identity.userId, body);
        res.status(201).json(chatConversationResponseSchema.parse(detail));
        // Staff watching the queue learn there is a new thread without waiting for a re-read.
        notify.queue();
        // A first message may deserve an immediate, factual answer. It is stored afterwards,
        // on its own, so opening a conversation never waits for it.
        if (body.body !== undefined && body.body.trim() !== '') {
          void assistant.respond({
            conversationId: detail.conversation.id,
            customerId: identity.userId,
            body: body.body,
          });
        }
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.get(
    '/chat/conversations',
    noStore,
    requireUser,
    validate({ query: chatConversationListQuerySchema }),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<{ query: typeof chatConversationListQuerySchema }>(res);
      try {
        const [{ conversations, total }, unread] = await Promise.all([
          chat.list(identity.accessToken, identity.userId, query),
          chat.unreadCount(identity.accessToken, identity.userId),
        ]);
        res.json({
          conversations,
          unread,
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
        });
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  /**
   * GET /chat/admin/queue — the operator inbox. Only the customer and moderation threads this
   * account may open, filtered, sorted and paged by the database; never a team thread.
   */
  router.get(
    '/chat/admin/queue',
    noStore,
    requireUser,
    canWorkQueues,
    validate({ query: chatQueueQuerySchema }),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<{ query: typeof chatQueueQuerySchema }>(res);
      try {
        const [{ conversations, total }, unread] = await Promise.all([
          chat.queue(identity.accessToken, identity.userId, query),
          chat.unreadCount(identity.accessToken, identity.userId),
        ]);
        res.json(
          chatConversationListResponseSchema.parse({
            conversations,
            unread,
            page: query.page,
            pageSize: query.pageSize,
            total,
            totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
          }),
        );
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.get('/chat/unread-count', noStore, requireUser, async (_req, res) => {
    const identity = currentIdentity(res);
    try {
      const unread = await chat.unreadCount(identity.accessToken, identity.userId);
      res.json(chatUnreadCountSchema.parse({ unread }));
    } catch (error) {
      sendChatFailure(res, error);
    }
  });

  router.get(
    '/chat/conversations/:conversationId',
    noStore,
    requireUser,
    validate(conversationParams),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof conversationParams>(res);
      try {
        const detail = await chat.detail(
          identity.accessToken,
          identity.userId,
          params.conversationId,
        );
        res.json(chatConversationResponseSchema.parse(detail));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.get(
    '/chat/conversations/:conversationId/messages',
    noStore,
    requireUser,
    validate({ ...conversationParams, query: chatMessagePageQuerySchema }),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, query } = requestInput<
        typeof conversationParams & { query: typeof chatMessagePageQuerySchema }
      >(res);
      try {
        const page = await chat.messages(
          identity.accessToken,
          identity.userId,
          params.conversationId,
          {
            before: query.before,
            limit: query.limit,
          },
        );
        res.json(chatMessagePageSchema.parse(page));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  /**
   * The authoritative way to send: a message is committed before it is answered, and the
   * same clientMessageId returns the stored message instead of a duplicate.
   */
  router.post(
    '/chat/conversations/:conversationId/messages',
    noStore,
    requireUser,
    deps.limiter,
    validate({ ...conversationParams, body: sendChatMessageRequestSchema }),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<
        typeof conversationParams & { body: typeof sendChatMessageRequestSchema }
      >(res);
      try {
        const result = await chat.send(
          identity.accessToken,
          identity.userId,
          params.conversationId,
          {
            clientMessageId: body.clientMessageId,
            body: body.body,
            replyToId: body.replyToId,
          },
        );
        // Broadcast only after the message is committed; the answer already means "stored".
        if (!result.duplicate) {
          notify.message(params.conversationId, result.message);
        }
        res.status(201).json(sendChatMessageResponseSchema.parse(result));
        // The assistant answers a customer's question from facts, once, after this response:
        // the send above must never wait for it, and it is stored as its own message.
        if (!result.duplicate && result.message.senderRole === 'customer') {
          void assistant.respond({
            conversationId: params.conversationId,
            customerId: identity.userId,
            body: result.message.body ?? '',
          });
        }
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.post(
    '/chat/conversations/:conversationId/read',
    noStore,
    requireUser,
    validate({ ...conversationParams, body: markChatReadRequestSchema }),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<
        typeof conversationParams & { body: typeof markChatReadRequestSchema }
      >(res);
      try {
        const unread = await chat.markRead(
          identity.accessToken,
          identity.userId,
          params.conversationId,
          body.seq,
        );
        notify.read(params.conversationId, identity.userId, body.seq);
        res.json(chatUnreadCountSchema.parse({ unread }));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.post(
    '/chat/conversations/:conversationId/status',
    noStore,
    requireUser,
    validate({ ...conversationParams, body: setChatStatusRequestSchema }),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<
        typeof conversationParams & { body: typeof setChatStatusRequestSchema }
      >(res);
      try {
        const detail = await chat.setStatus(
          identity.accessToken,
          identity.userId,
          params.conversationId,
          body.status,
        );
        notify.updated(params.conversationId, 'status');
        res.json(chatConversationResponseSchema.parse(detail));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.post(
    '/chat/conversations/:conversationId/assignee',
    noStore,
    requireUser,
    canWorkQueues,
    validate({ ...conversationParams, body: assignChatRequestSchema }),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<
        typeof conversationParams & { body: typeof assignChatRequestSchema }
      >(res);
      try {
        const detail = await chat.assign(
          identity.accessToken,
          identity.userId,
          params.conversationId,
          body.assigneeId,
          body.note,
        );
        notify.assigned(params.conversationId, body.assigneeId);
        res.json(chatConversationResponseSchema.parse(detail));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.post(
    '/chat/conversations/:conversationId/priority',
    noStore,
    requireUser,
    canWorkQueues,
    validate({ ...conversationParams, body: setChatPriorityRequestSchema }),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<
        typeof conversationParams & { body: typeof setChatPriorityRequestSchema }
      >(res);
      try {
        const detail = await chat.setPriority(
          identity.accessToken,
          identity.userId,
          params.conversationId,
          body.priority,
        );
        notify.updated(params.conversationId, 'priority');
        res.json(chatConversationResponseSchema.parse(detail));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.get(
    '/chat/conversations/:conversationId/notes',
    noStore,
    requireUser,
    canWorkQueues,
    validate({ ...conversationParams, query: chatMessagePageQuerySchema }),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, query } = requestInput<
        typeof conversationParams & { query: typeof chatMessagePageQuerySchema }
      >(res);
      try {
        const page = await chat.notes(
          identity.accessToken,
          identity.userId,
          params.conversationId,
          {
            before: query.before,
            limit: query.limit,
          },
        );
        res.json(chatNotesResponseSchema.parse(page));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.post(
    '/chat/conversations/:conversationId/notes',
    noStore,
    requireUser,
    canWorkQueues,
    validate({ ...conversationParams, body: addChatNoteRequestSchema }),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<
        typeof conversationParams & { body: typeof addChatNoteRequestSchema }
      >(res);
      try {
        const note = await chat.addNote(
          identity.accessToken,
          identity.userId,
          params.conversationId,
          body.body,
        );
        res.status(201).json(note);
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.post(
    '/chat/messages/:messageId/report',
    noStore,
    requireUser,
    validate({ ...messageParams, body: reportChatMessageRequestSchema }),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<
        typeof messageParams & { body: typeof reportChatMessageRequestSchema }
      >(res);
      try {
        const report = await chat.report(
          identity.accessToken,
          identity.userId,
          params.messageId,
          body.reason,
          body.details,
        );
        res.status(201).json(chatReportResponseSchema.parse(report));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  return router;
}
