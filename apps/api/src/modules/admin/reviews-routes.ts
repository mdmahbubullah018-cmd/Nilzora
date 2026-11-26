import {
  adminReviewListQuerySchema,
  reviewModerationRequestSchema,
  reviewReplyRequestSchema,
  type AdminReviewListResponse,
  type ReviewReply,
} from '@nilzora/contracts';
import { Router } from 'express';
import { z } from 'zod';
import { currentIdentity, requirePermission } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { noStore } from '../commerce/http';
import { sendAdminFailure } from './errors';
import type { AdminRouteDependencies } from './routes';
import { pageInfo, pageOf } from './shared';

const listSchemas = { query: adminReviewListQuerySchema };
const moderationSchemas = {
  params: z.object({ reviewId: z.uuid() }),
  body: reviewModerationRequestSchema,
};
const replySchemas = {
  params: z.object({ reviewId: z.uuid() }),
  body: reviewReplyRequestSchema,
};

/**
 * Customer product review moderation. Both routes need `reviews.moderate`, and the
 * database checks it again inside the function, so the API is never the only guard.
 * Approving or rejecting also changes what the storefront shows, so nothing is cached.
 *
 * Answering a review in public is a *different* right (`reviews.reply`): reading and deciding
 * are separate powers, and an account that may hide a review is not automatically allowed to
 * speak for the shop.
 */
export function adminReviewRoutes(deps: AdminRouteDependencies): Router {
  const router = Router();
  const { reviews } = deps.stores;
  const { requireUser, limiter } = deps;
  const canModerate = requirePermission('reviews.moderate');
  const canReply = requirePermission('reviews.reply');

  router.get(
    '/admin/product-reviews',
    noStore,
    requireUser,
    canModerate,
    validate(listSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof listSchemas>(res);
      try {
        const { reviews: rows, total } = await reviews.list(
          identity.accessToken,
          identity.userId,
          { status: query.status, q: query.q },
          pageOf(query),
        );
        const response: AdminReviewListResponse = { reviews: rows, ...pageInfo(query, total) };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.post(
    '/admin/product-reviews/:reviewId/status',
    noStore,
    requireUser,
    canModerate,
    limiter,
    validate(moderationSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof moderationSchemas>(res);
      try {
        await reviews.moderate(identity.accessToken, identity.userId, params.reviewId, body);
        res.status(204).end();
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.post(
    '/admin/product-reviews/:reviewId/reply',
    noStore,
    requireUser,
    canReply,
    limiter,
    validate(replySchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof replySchemas>(res);
      try {
        const reply: ReviewReply = await reviews.reply(
          identity.accessToken,
          identity.userId,
          params.reviewId,
          body.body,
        );
        res.json(reply);
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.delete(
    '/admin/product-reviews/:reviewId/reply',
    noStore,
    requireUser,
    canReply,
    limiter,
    validate({ params: replySchemas.params }),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<{ params: typeof replySchemas.params }>(res);
      try {
        await reviews.clearReply(identity.accessToken, identity.userId, params.reviewId);
        res.status(204).end();
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  return router;
}
