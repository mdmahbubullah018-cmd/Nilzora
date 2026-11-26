import {
  chatAnalyticsQuerySchema,
  chatAnalyticsSchema,
  chatAttachmentTypeSchema,
  chatAttachmentUploadSchema,
  chatMediaKindOf,
  chatAutomationPreviewSchema,
  chatAutomationRulesResponseSchema,
  chatAutomationRunsResponseSchema,
  chatConversationResponseSchema,
  chatCsatResponseSchema,
  chatInternalChannelsResponseSchema,
  chatPinnedMessagesResponseSchema,
  chatReactionResponseSchema,
  chatReactionSummaryResponseSchema,
  chatReportQueueResponseSchema,
  chatSavedRepliesResponseSchema,
  chatSearchResponseSchema,
  chatTagsResponseSchema,
  chatTeamResponseSchema,
  chatTemplatesResponseSchema,
  chatMessageSchema,
  chatMessageFeedbackResponseSchema,
  chatMessageFeedbackSchema,
  chatMyFeedbackResponseSchema,
  decideChatReportSchema,
  postChatMessageSchema,
  postedChatMessageSchema,
  previewChatAutomationRuleSchema,
  renderedChatTemplateSchema,
  renderChatTemplateSchema,
  saveChatAutomationRuleSchema,
  saveChatSavedReplySchema,
  saveChatTagSchema,
  saveChatTemplateSchema,
  setChatConversationTagsSchema,
  startInternalChatSchema,
  submitChatCsatSchema,
  submitChatMessageFeedbackSchema,
  uploadChatAttachmentQuerySchema,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Router, type RequestHandler, type Response } from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import {
  currentIdentity,
  requireAnyPermission,
  requirePermission,
} from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { sendError } from '../../http/send-error';
import { noStore } from '../commerce/http';
import type { MediaStorage } from '../media/routes';
import { rawImageBody, requireStorage } from '../media/upload';
import type { UploadLimiters } from '../../middleware/upload-rate-limit';
import { CHAT_UPLOAD_MAX_BYTES, createChatAttachmentUploads } from './attachments';
import type { ChatNotifier } from '../../realtime/notifier';
import { noopNotifier } from '../../realtime/notifier';
import type { ChatAdminStore, ChatAttachmentMedia } from './admin-store';
import { sendChatFailure } from './errors';

/*
 * Phase 2 REST surface
 * --------------------
 * Templates, automation, saved replies, tags, attachments, satisfaction, internal team
 * chat, search, the moderator review queue and the analytics report.
 *
 * Three rules hold across every route here:
 *
 *   1. The caller's identity comes from the verified token and nothing else. No route
 *      accepts an actor, an owner or a permission from the request.
 *   2. The coarse permission guard below is the outer bound, and the database function
 *      checks the same permission again. Hiding a button is therefore not the control.
 *   3. A file is stored only after the picture pipeline has decoded and re-encoded it, and
 *      the key is generated here with the conversation's own prefix. A caller cannot aim an
 *      upload at another conversation.
 */

const messageParams = { params: z.object({ messageId: uuidSchema }) };
const templateParams = { params: z.object({ templateId: uuidSchema }) };
const ruleParams = { params: z.object({ ruleId: uuidSchema }) };
const replyParams = { params: z.object({ replyId: uuidSchema }) };
const attachmentParams = { params: z.object({ attachmentId: uuidSchema }) };

/** Which picture variant a reader asked for; anything else is a bad request. */
const chatMediaQuery = z.object({ variant: z.enum(['full', 'thumb']).optional() }).strict();

/**
 * The object key to read, built only from what the database returned. A key this API did not
 * generate is refused rather than passed to the bucket, so a stored value can never point the
 * stream at another object.
 */
function mediaKeyFor(
  media: ChatAttachmentMedia,
  variant: 'full' | 'thumb' | undefined,
): string | null {
  const shape =
    /^chat\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\/(?:full|thumb)\.webp)?$/i;
  if (!shape.test(media.objectKey)) return null;
  if (media.contentType.startsWith('image/')) {
    const base = media.objectKey.replace(/\/(?:full|thumb)\.webp$/i, '');
    return variant === 'thumb' ? `${base}/thumb.webp` : `${base}/full.webp`;
  }
  // A recording or a document has one object and no variants.
  return variant === 'thumb' ? null : media.objectKey;
}

/** Pictures and recordings render in place; a document downloads with its own name. */
function dispositionFor(media: ChatAttachmentMedia): string {
  const inline = media.contentType.startsWith('image/') || media.contentType.startsWith('audio/');
  const ascii = media.fileName.replace(/["\\\r\n]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(media.fileName)}`;
}

const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const reportQueueQuerySchema = z.object({
  status: z.enum(['open', 'reviewing', 'dismissed', 'actioned', 'all']).default('open'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const templateListQuerySchema = z.object({
  includeArchived: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((value) => value === 'true'),
});

// Combined request shapes, named so both `validate` and `requestInput` read the same
// schemas and the handler body stays typed.
// schemas and the handler body stays typed.
const tagUpdateRequest = {
  params: z.object({ conversationId: uuidSchema }),
  body: setChatConversationTagsSchema.omit({ conversationId: true }),
};
const ratingRequest = {
  params: z.object({ conversationId: uuidSchema }),
  body: submitChatCsatSchema.omit({ conversationId: true }),
};
const reportDecisionRequest = {
  params: z.object({ reportId: uuidSchema }),
  body: decideChatReportSchema.omit({ reportId: true }),
};
const ruleActiveRequest = {
  params: z.object({ ruleId: uuidSchema }),
  body: z.object({ isActive: z.boolean() }),
};
const uploadRequest = {
  params: z.object({ conversationId: uuidSchema }),
  query: uploadChatAttachmentQuerySchema,
};
const conversationParams = { params: z.object({ conversationId: uuidSchema }) };
const messageInConversationParams = {
  params: z.object({ conversationId: uuidSchema, messageId: uuidSchema }),
};
const reactionRequest = {
  params: z.object({ conversationId: uuidSchema, messageId: uuidSchema }),
  body: z.object({ emoji: z.string().trim().min(1).max(16) }),
};

/**
 * A chat attachment may be a picture, a document or a voice recording, so the body reader is
 * sized for the largest kind and `createChatAttachmentUploads` enforces each kind's own limit
 * after the type is known. CHAT_UPLOAD_MAX_BYTES is the document ceiling — the largest single
 * upload the contract allows.
 */
const readAttachmentBody = rawImageBody(CHAT_UPLOAD_MAX_BYTES);

export interface ChatAdminRouteDependencies extends AuthDependencies {
  chatAdmin: ChatAdminStore;
  /** Per-account budget for chat writes, shared with the Phase 1 routes. */
  limiter: RequestHandler;
  /**
   * Budgets for attachments, which are the expensive chat writes: a picture is decoded and
   * re-encoded, and a document or a recording is written straight to object storage. Both the
   * total and the per-kind counters are charged, so switching the entry point cannot escape
   * either of them.
   */
  uploadLimiters?: UploadLimiters | undefined;
  /** Undefined when R2 is not configured: attachment uploads then answer 503. */
  storage: MediaStorage | undefined;
  /** Broadcasts a committed change to the live sockets; a no-op when realtime is off. */
  notify?: ChatNotifier | undefined;
  logger: Logger;
}

export function chatAdminRoutes(deps: ChatAdminRouteDependencies): Router {
  const { chatAdmin, limiter, storage, logger, uploadLimiters } = deps;
  const notify = deps.notify ?? noopNotifier;
  const requireUser = authenticate(deps);
  const needStorage = requireStorage(storage);
  const attachments = createChatAttachmentUploads(storage, logger);
  const router = Router();

  // Templates are looked after by whoever may change approved wording.
  const manageTemplates = requirePermission('chat.templates.manage');
  const manageAutomation = requirePermission('chat.automation.manage');
  const readAnalytics = requirePermission('chat.analytics.read');
  const reviewReports = requirePermission('chat.reports.review');
  const useInternalChat = requirePermission('chat.internal.use');
  // Saved replies and tags belong to everyone who works the queue.
  const workQueue = requireAnyPermission(['admin_workspace.access', 'moderator_workspace.access']);

  function callerOf(res: Response): { accessToken: string; userId: string } {
    const identity = currentIdentity(res);
    return { accessToken: identity.accessToken, userId: identity.userId };
  }

  // ------------------------------------------------------------- templates

  router.get(
    '/chat/admin/templates',
    noStore,
    requireUser,
    workQueue,
    validate({ query: templateListQuerySchema }),
    async (_req, res) => {
      const caller = callerOf(res);
      const { query } = requestInput<{ query: typeof templateListQuerySchema }>(res);
      try {
        const templates = await chatAdmin.templates(
          caller.accessToken,
          caller.userId,
          query.includeArchived,
        );
        res.json(chatTemplatesResponseSchema.parse(templates));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.post(
    '/chat/admin/templates',
    noStore,
    limiter,
    requireUser,
    manageTemplates,
    validate({ body: saveChatTemplateSchema }),
    async (_req, res) => {
      const caller = callerOf(res);
      const { body } = requestInput<{ body: typeof saveChatTemplateSchema }>(res);
      try {
        const template = await chatAdmin.saveTemplate(caller.accessToken, caller.userId, body);
        res.status(body.id === undefined ? 201 : 200).json(template);
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.delete(
    '/chat/admin/templates/:templateId',
    noStore,
    limiter,
    requireUser,
    manageTemplates,
    validate(templateParams),
    async (_req, res) => {
      const caller = callerOf(res);
      const { params } = requestInput<typeof templateParams>(res);
      try {
        await chatAdmin.archiveTemplate(caller.accessToken, caller.userId, params.templateId);
        res.status(204).end();
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.post(
    '/chat/admin/templates/render',
    noStore,
    requireUser,
    workQueue,
    validate({ body: renderChatTemplateSchema }),
    async (_req, res) => {
      const caller = callerOf(res);
      const { body } = requestInput<{ body: typeof renderChatTemplateSchema }>(res);
      try {
        const rendered = await chatAdmin.renderTemplate(caller.accessToken, caller.userId, body);
        res.json(renderedChatTemplateSchema.parse(rendered));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  // --------------------------------------------------------- saved replies

  router.get('/chat/admin/saved-replies', noStore, requireUser, workQueue, async (_req, res) => {
    const caller = callerOf(res);
    try {
      const replies = await chatAdmin.savedReplies(caller.accessToken, caller.userId);
      res.json(chatSavedRepliesResponseSchema.parse(replies));
    } catch (error) {
      sendChatFailure(res, error);
    }
  });

  router.post(
    '/chat/admin/saved-replies',
    noStore,
    limiter,
    requireUser,
    workQueue,
    validate({ body: saveChatSavedReplySchema }),
    async (_req, res) => {
      const caller = callerOf(res);
      const { body } = requestInput<{ body: typeof saveChatSavedReplySchema }>(res);
      try {
        await chatAdmin.saveSavedReply(caller.accessToken, caller.userId, body);
        res.status(body.id === undefined ? 201 : 204).end();
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.delete(
    '/chat/admin/saved-replies/:replyId',
    noStore,
    limiter,
    requireUser,
    workQueue,
    validate(replyParams),
    async (_req, res) => {
      const caller = callerOf(res);
      const { params } = requestInput<typeof replyParams>(res);
      try {
        await chatAdmin.deleteSavedReply(caller.accessToken, caller.userId, params.replyId);
        res.status(204).end();
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  // ------------------------------------------------------------------ tags

  router.get('/chat/admin/tags', noStore, requireUser, workQueue, async (_req, res) => {
    const caller = callerOf(res);
    try {
      const tags = await chatAdmin.tags(caller.accessToken, caller.userId);
      res.json(chatTagsResponseSchema.parse(tags));
    } catch (error) {
      sendChatFailure(res, error);
    }
  });

  router.post(
    '/chat/admin/tags',
    noStore,
    limiter,
    requireUser,
    workQueue,
    validate({ body: saveChatTagSchema }),
    async (_req, res) => {
      const caller = callerOf(res);
      const { body } = requestInput<{ body: typeof saveChatTagSchema }>(res);
      try {
        await chatAdmin.saveTag(caller.accessToken, caller.userId, body);
        res.status(204).end();
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.put(
    '/chat/conversations/:conversationId/tags',
    noStore,
    limiter,
    requireUser,
    workQueue,
    validate(tagUpdateRequest),
    async (_req, res) => {
      const caller = callerOf(res);
      const { body, params } = requestInput<typeof tagUpdateRequest>(res);
      try {
        await chatAdmin.setConversationTags(
          caller.accessToken,
          caller.userId,
          params.conversationId,
          body.tagIds,
        );
        res.status(204).end();
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  // ----------------------------------------------------------- attachments

  /**
   * POST /chat/conversations/:conversationId/attachments — the file is the request body, and
   * its Content-Type says which kind it is: a picture (processed to WebP), a document or a voice
   * recording. The key is generated here under the conversation's own prefix; the database
   * records it as a pending slot, and the message that carries it is what makes it visible.
   */
  router.post(
    '/chat/conversations/:conversationId/attachments',
    noStore,
    limiter,
    // The expensive operation gets its own budgets, charged by the kind of file this request
    // carries. Both run after authentication, so the counter is keyed by the account.
    requireUser,
    (req, res, next) => {
      const contentType = (req.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
      const kind = chatMediaKindOf(contentType);
      const kindLimiter =
        kind === 'image' || kind === 'audio' || kind === 'document'
          ? uploadLimiters?.forKind(kind)
          : undefined;
      if (kindLimiter === undefined) {
        next();
        return;
      }
      kindLimiter(req, res, next);
    },
    needStorage,
    readAttachmentBody,
    validate(uploadRequest),
    async (req, res) => {
      const caller = callerOf(res);
      const { params, query } = requestInput<typeof uploadRequest>(res);
      const contentType = (req.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';

      const stored = await attachments.store(req.body, res, params.conversationId, {
        contentType,
        fileName: query.fileName,
      });
      if (stored === null) return;

      // Only a recording has a length; a picture or a document that arrives with one is a client
      // bug the database refuses, so it is dropped here rather than sent on.
      const durationMs = contentType.startsWith('audio/') ? query.durationMs : undefined;

      try {
        const upload = await chatAdmin.beginAttachment(caller.accessToken, caller.userId, {
          conversationId: params.conversationId,
          objectKey: stored.objectKey,
          fileName: stored.fileName,
          contentType: chatAttachmentTypeSchema.parse(stored.contentType),
          byteSize: stored.byteSize,
          ...(stored.width === null ? {} : { width: stored.width }),
          ...(stored.height === null ? {} : { height: stored.height }),
          ...(durationMs === undefined ? {} : { durationMs }),
        });
        res.status(201).json(chatAttachmentUploadSchema.parse(upload));
      } catch (error) {
        // The record did not survive, so the object must not either.
        await attachments.remove(stored.objectKey, res);
        sendChatFailure(res, error);
      }
    },
  );

  router.delete(
    '/chat/attachments/:attachmentId',
    noStore,
    limiter,
    requireUser,
    validate(attachmentParams),
    async (_req, res) => {
      const caller = callerOf(res);
      const { params } = requestInput<typeof attachmentParams>(res);
      try {
        await chatAdmin.discardAttachment(caller.accessToken, caller.userId, params.attachmentId);
        res.status(204).end();
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  /**
   * GET /chat/attachments/:attachmentId/media — the bytes of one attached file.
   *
   * Chat media is private: this route asks the database (through the caller's own token)
   * whether the account may read the conversation, and only then reads the object the database
   * named. The object key never comes from the client, never leaves the server, and no public
   * bucket address exists for these objects. Caching is private because the same URL answers
   * different accounts differently.
   */
  router.get(
    '/chat/attachments/:attachmentId/media',
    noStore,
    limiter,
    requireUser,
    needStorage,
    validate({ ...attachmentParams, query: chatMediaQuery }),
    async (req, res) => {
      const caller = callerOf(res);
      const { params, query } = requestInput<
        typeof attachmentParams & { query: typeof chatMediaQuery }
      >(res);
      let media;
      try {
        media = await chatAdmin.attachmentMedia(
          caller.accessToken,
          caller.userId,
          params.attachmentId,
        );
      } catch (error) {
        sendChatFailure(res, error);
        return;
      }

      const storage = deps.storage;
      if (storage === undefined) {
        sendError(res, 503, 'media_unavailable', 'Attachments are not available right now.');
        return;
      }
      const key = mediaKeyFor(media, query.variant);
      if (key === null) {
        sendError(res, 404, 'not_found', 'That file is not available');
        return;
      }

      let object;
      try {
        const objects = storage.objects;
        object =
          objects.get === undefined
            ? null
            : await objects.get(key, {
                range: typeof req.headers.range === 'string' ? req.headers.range : undefined,
              });
      } catch (error) {
        logger.warn({ err: error }, 'Chat media read failed');
        sendError(res, 502, 'service_unavailable', 'That file could not be read right now');
        return;
      }
      if (object === null) {
        sendError(res, 404, 'not_found', 'That file is not available');
        return;
      }

      res.status(object.contentRange === null ? 200 : 206);
      res.setHeader('Content-Type', media.contentType);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', dispositionFor(media));
      res.setHeader('Accept-Ranges', object.acceptRanges ?? 'bytes');
      if (object.contentRange !== null) res.setHeader('Content-Range', object.contentRange);
      if (object.contentLength !== null) res.setHeader('Content-Length', object.contentLength);

      object.body.on('error', () => {
        res.destroy();
      });
      object.body.pipe(res);
    },
  );

  // --------------------------------------------------------------- messages

  /** POST /chat/messages — a message with the attachments it carries, stored atomically. */
  router.post(
    '/chat/messages',
    noStore,
    limiter,
    requireUser,
    validate({ body: postChatMessageSchema }),
    async (_req, res) => {
      const caller = callerOf(res);
      const { body } = requestInput<{ body: typeof postChatMessageSchema }>(res);
      try {
        const posted = await chatAdmin.postMessage(caller.accessToken, caller.userId, body);
        const answer = postedChatMessageSchema.parse(posted);
        // The quote is resolved from the conversation rather than the page the sender happens to
        // hold, so a reply to an older message still shows what it answers the moment it is sent.
        const replyTo =
          answer.message.replyToId === null
            ? null
            : await chatAdmin.replySummary(
                caller.accessToken,
                caller.userId,
                body.conversationId,
                answer.message.replyToId,
              );
        const quoted = { ...answer, message: { ...answer.message, replyTo } };
        // A message that carries files only ever travels through this route, so without this
        // broadcast the other side of the conversation hears nothing about a picture or a
        // recording until it reloads. The event carries the attachments with their resolved URLs.
        if (!quoted.duplicate) {
          notify.message(
            body.conversationId,
            chatMessageSchema.parse({
              ...quoted.message,
              editedAt: null,
              attachments: quoted.attachments,
            }),
          );
        }
        res.status(201).json(quoted);
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.post(
    '/chat/messages/:messageId/feedback',
    noStore,
    limiter,
    requireUser,
    validate({ ...messageParams, body: submitChatMessageFeedbackSchema }),
    async (_req, res) => {
      const caller = callerOf(res);
      const { params, body } = requestInput<
        typeof messageParams & { body: typeof submitChatMessageFeedbackSchema }
      >(res);
      try {
        const feedback = await chatAdmin.submitMessageFeedback(
          caller.accessToken,
          caller.userId,
          params.messageId,
          body,
        );
        res.status(201).json(chatMessageFeedbackSchema.parse(feedback));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.get(
    '/chat/conversations/:conversationId/feedback',
    noStore,
    requireUser,
    validate(conversationParams),
    async (_req, res) => {
      const caller = callerOf(res);
      const { params } = requestInput<typeof conversationParams>(res);
      try {
        const feedback = await chatAdmin.messageFeedback(
          caller.accessToken,
          caller.userId,
          params.conversationId,
        );
        res.json(chatMessageFeedbackResponseSchema.parse(feedback));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.get(
    '/chat/conversations/:conversationId/my-feedback',
    noStore,
    requireUser,
    validate(conversationParams),
    async (_req, res) => {
      const caller = callerOf(res);
      const { params } = requestInput<typeof conversationParams>(res);
      try {
        const feedback = await chatAdmin.myMessageFeedback(
          caller.accessToken,
          caller.userId,
          params.conversationId,
        );
        res.json(chatMyFeedbackResponseSchema.parse(feedback));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  // ----------------------------------------------------------- satisfaction

  router.post(
    '/chat/conversations/:conversationId/rating',
    noStore,
    limiter,
    requireUser,
    validate(ratingRequest),
    async (_req, res) => {
      const caller = callerOf(res);
      const { body, params } = requestInput<typeof ratingRequest>(res);
      try {
        const rating = await chatAdmin.submitCsat(
          caller.accessToken,
          caller.userId,
          params.conversationId,
          body.rating,
          body.comment,
        );
        notify.updated(params.conversationId, 'rating');
        res.status(201).json(chatCsatResponseSchema.parse(rating));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  // ------------------------------------------------------ pins and reactions

  router.get(
    '/chat/conversations/:conversationId/pins',
    noStore,
    requireUser,
    validate(conversationParams),
    async (_req, res) => {
      const caller = callerOf(res);
      const { params } = requestInput<typeof conversationParams>(res);
      try {
        const pins = await chatAdmin.pinnedMessages(
          caller.accessToken,
          caller.userId,
          params.conversationId,
        );
        res.json(chatPinnedMessagesResponseSchema.parse(pins));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.post(
    '/chat/conversations/:conversationId/messages/:messageId/pin',
    noStore,
    limiter,
    requireUser,
    validate(messageInConversationParams),
    async (_req, res) => {
      const caller = callerOf(res);
      const { params } = requestInput<typeof messageInConversationParams>(res);
      try {
        await chatAdmin.pinMessage(caller.accessToken, caller.userId, params.messageId);
        notify.updated(params.conversationId, 'pin');
        res.status(204).end();
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.delete(
    '/chat/conversations/:conversationId/messages/:messageId/pin',
    noStore,
    limiter,
    requireUser,
    validate(messageInConversationParams),
    async (_req, res) => {
      const caller = callerOf(res);
      const { params } = requestInput<typeof messageInConversationParams>(res);
      try {
        await chatAdmin.unpinMessage(caller.accessToken, caller.userId, params.messageId);
        notify.updated(params.conversationId, 'pin');
        res.status(204).end();
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.get(
    '/chat/conversations/:conversationId/reactions',
    noStore,
    requireUser,
    validate(conversationParams),
    async (_req, res) => {
      const caller = callerOf(res);
      const { params } = requestInput<typeof conversationParams>(res);
      try {
        const summary = await chatAdmin.reactionSummary(
          caller.accessToken,
          caller.userId,
          params.conversationId,
        );
        res.json(chatReactionSummaryResponseSchema.parse(summary));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.post(
    '/chat/conversations/:conversationId/messages/:messageId/reactions',
    noStore,
    limiter,
    requireUser,
    validate(reactionRequest),
    async (_req, res) => {
      const caller = callerOf(res);
      const { body, params } = requestInput<typeof reactionRequest>(res);
      try {
        const reaction = await chatAdmin.toggleReaction(
          caller.accessToken,
          caller.userId,
          params.messageId,
          body.emoji,
        );
        notify.updated(params.conversationId, 'reaction');
        res.json(chatReactionResponseSchema.parse(reaction));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  // ---------------------------------------------------------- internal notes

  router.get(
    '/chat/admin/reports',
    noStore,
    requireUser,
    reviewReports,
    validate({ query: reportQueueQuerySchema }),
    async (_req, res) => {
      const caller = callerOf(res);
      const { query } = requestInput<{ query: typeof reportQueueQuerySchema }>(res);
      try {
        const queue = await chatAdmin.reportQueue(caller.accessToken, caller.userId, query.status, {
          limit: query.limit,
          offset: query.offset,
        });
        res.json(chatReportQueueResponseSchema.parse(queue));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.post(
    '/chat/admin/reports/:reportId/decide',
    noStore,
    limiter,
    requireUser,
    reviewReports,
    validate(reportDecisionRequest),
    async (_req, res) => {
      const caller = callerOf(res);
      const { body, params } = requestInput<typeof reportDecisionRequest>(res);
      try {
        const decision = await chatAdmin.decideReport(caller.accessToken, caller.userId, {
          reportId: params.reportId,
          status: body.status,
          actionTaken: body.actionTaken,
          note: body.note,
        });
        res.json(decision);
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.delete(
    '/chat/messages/:messageId',
    noStore,
    limiter,
    requireUser,
    validate(messageParams),
    async (_req, res) => {
      const caller = callerOf(res);
      const { params } = requestInput<typeof messageParams>(res);
      try {
        await chatAdmin.deleteMessage(caller.accessToken, caller.userId, params.messageId);
        res.status(204).end();
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  // ------------------------------------------------------ internal team chat

  router.post(
    '/chat/internal',
    noStore,
    limiter,
    requireUser,
    useInternalChat,
    validate({ body: startInternalChatSchema }),
    async (_req, res) => {
      const caller = callerOf(res);
      const { body } = requestInput<{ body: typeof startInternalChatSchema }>(res);
      try {
        const detail = await chatAdmin.startInternalChat(caller.accessToken, caller.userId, body);
        res.status(201).json(chatConversationResponseSchema.parse(detail));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.get(
    '/chat/internal',
    noStore,
    requireUser,
    useInternalChat,
    validate({ query: pageQuerySchema }),
    async (_req, res) => {
      const caller = callerOf(res);
      const { query } = requestInput<{ query: typeof pageQuerySchema }>(res);
      try {
        const channels = await chatAdmin.internalChannels(caller.accessToken, caller.userId, query);
        res.json(chatInternalChannelsResponseSchema.parse(channels));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  // ---------------------------------------------------------------- search

  router.get(
    '/chat/search',
    noStore,
    requireUser,
    validate({ query: searchQuerySchema }),
    async (_req, res) => {
      const caller = callerOf(res);
      const { query } = requestInput<{ query: typeof searchQuerySchema }>(res);
      try {
        const hits = await chatAdmin.search(caller.accessToken, caller.userId, query);
        res.json(chatSearchResponseSchema.parse(hits));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  // ------------------------------------------------------------------ team

  /**
   * GET /chat/admin/team — the teammates who can take a conversation or join a team thread, with
   * the threads each holds now. For assignment, the automation "assign to" action and the team
   * view; the database refuses anyone who neither works a queue nor uses team chat.
   */
  router.get(
    '/chat/admin/team',
    noStore,
    requireUser,
    requireAnyPermission([
      'admin_workspace.access',
      'moderator_workspace.access',
      'chat.internal.use',
    ]),
    async (_req, res) => {
      const caller = callerOf(res);
      try {
        const team = await chatAdmin.team(caller.accessToken, caller.userId);
        res.json(chatTeamResponseSchema.parse(team));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  // ------------------------------------------------------------- analytics

  router.get(
    '/chat/admin/analytics',
    noStore,
    requireUser,
    readAnalytics,
    validate({ query: chatAnalyticsQuerySchema }),
    async (_req, res) => {
      const caller = callerOf(res);
      const { query } = requestInput<{ query: typeof chatAnalyticsQuerySchema }>(res);
      try {
        const report = await chatAdmin.analytics(caller.accessToken, caller.userId, query);
        res.json(chatAnalyticsSchema.parse(report));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  // ------------------------------------------------------------ automation

  router.get(
    '/chat/admin/automation',
    noStore,
    requireUser,
    manageAutomation,
    async (_req, res) => {
      const caller = callerOf(res);
      try {
        const rules = await chatAdmin.automationRules(caller.accessToken, caller.userId);
        res.json(chatAutomationRulesResponseSchema.parse(rules));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.post(
    '/chat/admin/automation',
    noStore,
    limiter,
    requireUser,
    manageAutomation,
    validate({ body: saveChatAutomationRuleSchema }),
    async (_req, res) => {
      const caller = callerOf(res);
      const { body } = requestInput<{ body: typeof saveChatAutomationRuleSchema }>(res);
      try {
        await chatAdmin.saveAutomationRule(caller.accessToken, caller.userId, body);
        res.status(body.id === undefined ? 201 : 204).end();
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.post(
    '/chat/admin/automation/:ruleId/active',
    noStore,
    limiter,
    requireUser,
    manageAutomation,
    validate(ruleActiveRequest),
    async (_req, res) => {
      const caller = callerOf(res);
      const { body, params } = requestInput<typeof ruleActiveRequest>(res);
      try {
        await chatAdmin.setAutomationRuleActive(
          caller.accessToken,
          caller.userId,
          params.ruleId,
          body.isActive,
        );
        res.status(204).end();
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.delete(
    '/chat/admin/automation/:ruleId',
    noStore,
    limiter,
    requireUser,
    manageAutomation,
    validate(ruleParams),
    async (_req, res) => {
      const caller = callerOf(res);
      const { params } = requestInput<typeof ruleParams>(res);
      try {
        await chatAdmin.deleteAutomationRule(caller.accessToken, caller.userId, params.ruleId);
        res.status(204).end();
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.get(
    '/chat/admin/automation/runs',
    noStore,
    requireUser,
    manageAutomation,
    validate({ query: pageQuerySchema }),
    async (_req, res) => {
      const caller = callerOf(res);
      const { query } = requestInput<{ query: typeof pageQuerySchema }>(res);
      try {
        const runs = await chatAdmin.automationRuns(caller.accessToken, caller.userId, query);
        res.json(chatAutomationRunsResponseSchema.parse(runs));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  router.post(
    '/chat/admin/automation/preview',
    noStore,
    requireUser,
    manageAutomation,
    validate({ body: previewChatAutomationRuleSchema }),
    async (_req, res) => {
      const caller = callerOf(res);
      const { body } = requestInput<{ body: typeof previewChatAutomationRuleSchema }>(res);
      try {
        const preview = await chatAdmin.previewAutomationRule(
          caller.accessToken,
          caller.userId,
          body,
        );
        res.json(chatAutomationPreviewSchema.parse(preview));
      } catch (error) {
        sendChatFailure(res, error);
      }
    },
  );

  return router;
}
