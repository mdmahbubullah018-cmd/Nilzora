import {
  productReviewQuerySchema,
  reviewPromptDismissSchema,
  reviewSubmitRequestSchema,
  reviewVoteRequestSchema,
  type MyReview,
  type ProductReviewsResponse,
  type ReviewPromptResponse,
  type ReviewVoteResponse,
  type ReviewableItemsResponse,
} from '@nilzora/contracts';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { currentIdentity } from '../../middleware/authorize';
import {
  authenticate,
  optionalAuthenticate,
  type AuthDependencies,
} from '../../middleware/authenticate';
import { requestInput, validate } from '../../middleware/validate';
import { noStore, sendCommerceFailure } from '../commerce/http';
import { pageOf } from '../admin/shared';
import { ReviewRefusalError, type ReviewStore } from './store';

const publicSchemas = {
  params: z.object({ slug: z.string().min(1).max(120) }),
  query: productReviewQuerySchema,
};
const mySchemas = { params: z.object({ productId: z.uuid() }) };
const submitSchemas = { ...mySchemas, body: reviewSubmitRequestSchema };
const dismissSchemas = { body: reviewPromptDismissSchema };
const voteSchemas = {
  params: z.object({ reviewId: z.uuid() }),
  body: reviewVoteRequestSchema,
};

const REVIEW_ANSWERS: Readonly<Record<string, [number, string, string]>> = {
  review_invalid: [400, 'bad_request', 'Check the rating and the text of your review'],
  review_duplicate: [409, 'conflict', 'You have already reviewed this product'],
  review_not_eligible: [403, 'forbidden', 'Only customers who received this product can review it'],
  review_account_blocked: [403, 'forbidden', 'This account cannot post reviews'],
  review_own: [403, 'forbidden', 'You cannot moderate your own review'],
};

/** Answers a customer review refusal with fixed wording, or hands it to the commerce handler. */
function sendReviewFailure(res: Parameters<typeof sendCommerceFailure>[0], error: unknown) {
  if (error instanceof ReviewRefusalError) {
    const [status, code, message] = REVIEW_ANSWERS[error.refusal] ?? [
      400,
      'bad_request',
      'The review could not be saved',
    ];
    res.status(status).json({ error: { code, message } });
    return;
  }
  sendCommerceFailure(res, error);
}

export interface ReviewRouteDependencies extends AuthDependencies {
  reviews: ReviewStore;
}

/**
 * GET /catalog/products/:slug/reviews (anyone: approved reviews and the rating summary),
 * GET/POST /me/products/:productId/review (the signed-in customer's own review — the
 * database decides whether they bought and received the product), and, when the store is
 * mounted for the admin workspace, the moderation routes below.
 *
 * The public list also accepts a token when one is sent: the counts are the same for everybody,
 * but a signed-in reader is told which way *they* voted. Without a token the route behaves
 * exactly as before.
 */
export function reviewRoutes(deps: ReviewRouteDependencies): Router {
  const router = Router();
  const requireUser = authenticate(deps);
  const optionalUser = optionalAuthenticate(deps);

  /** The caller's own identity when the request carried a usable token, otherwise nothing. */
  function viewerOf(res: Response): { accessToken: string; userId: string } | undefined {
    const identity = (res.locals as { identity?: { accessToken: string; userId: string } })
      .identity;
    return identity === undefined ? undefined : identity;
  }

  router.get(
    '/catalog/products/:slug/reviews',
    optionalUser,
    validate(publicSchemas),
    async (_req, res) => {
      const { params, query } = requestInput<typeof publicSchemas>(res);
      try {
        const response: ProductReviewsResponse = await deps.reviews.publicForProduct(
          params.slug,
          pageOf(query),
          viewerOf(res),
        );
        res.json(response);
      } catch (error) {
        sendReviewFailure(res, error);
      }
    },
  );

  router.get(
    '/me/products/:productId/review',
    noStore,
    requireUser,
    validate(mySchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof mySchemas>(res);
      try {
        const response: MyReview = await deps.reviews.myReview(
          identity.accessToken,
          identity.userId,
          params.productId,
        );
        res.json(response);
      } catch (error) {
        sendReviewFailure(res, error);
      }
    },
  );

  router.post(
    '/me/products/:productId/review',
    noStore,
    requireUser,
    validate(submitSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof submitSchemas>(res);
      try {
        const reviewId = await deps.reviews.submit(
          identity.accessToken,
          identity.userId,
          params.productId,
          body,
        );
        res.status(201).json({ reviewId });
      } catch (error) {
        sendReviewFailure(res, error);
      }
    },
  );

  /**
   * GET /me/reviews/pending — the delivered lines the customer has not reviewed yet, newest
   * delivery first. It reads the customer's own orders, so a store that cannot reach them
   * says so instead of pretending there is nothing to review.
   */
  router.get('/me/reviews/pending', noStore, requireUser, async (_req, res) => {
    const identity = currentIdentity(res);
    try {
      const response: ReviewableItemsResponse = {
        items: await deps.reviews.reviewable(identity.accessToken, identity.userId),
      };
      res.json(response);
    } catch (error) {
      sendReviewFailure(res, error);
    }
  });

  /**
   * GET /me/reviews/prompt — the one delivered, unreviewed product the account page may ask
   * about (or null). Eligibility is the database's: a delivered order of this account.
   */
  router.get('/me/reviews/prompt', noStore, requireUser, async (_req, res) => {
    const identity = currentIdentity(res);
    try {
      const response: ReviewPromptResponse = {
        item: await deps.reviews.reviewPrompt(identity.accessToken, identity.userId),
      };
      res.json(response);
    } catch (error) {
      sendReviewFailure(res, error);
    }
  });

  /** POST /me/reviews/prompt/dismiss — "not now": the prompt is not shown again for it. */
  router.post(
    '/me/reviews/prompt/dismiss',
    noStore,
    requireUser,
    validate(dismissSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof dismissSchemas>(res);
      try {
        await deps.reviews.dismissReviewPrompt(
          identity.accessToken,
          identity.userId,
          body.productId,
        );
        res.status(204).end();
      } catch (error) {
        sendReviewFailure(res, error);
      }
    },
  );

  /**
   * PUT /me/reviews/:reviewId/vote — helpful / not helpful.
   *
   * `verdict: null` withdraws the caller's vote, which is the third action the control offers.
   * The database enforces one vote per account per review and refuses a vote on one's own review,
   * so a repeated or hostile request can only ever move the caller's own single row.
   */
  router.put(
    '/me/reviews/:reviewId/vote',
    noStore,
    requireUser,
    validate(voteSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof voteSchemas>(res);
      try {
        const answer: ReviewVoteResponse = await deps.reviews.vote(
          identity.accessToken,
          identity.userId,
          params.reviewId,
          body.verdict,
        );
        res.json(answer);
      } catch (error) {
        sendReviewFailure(res, error);
      }
    },
  );

  return router;
}
