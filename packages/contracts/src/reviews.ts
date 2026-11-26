import { z } from 'zod';
import { adminPageQueryShape, pageInfoShape } from './admin-common';
import { orderItemImageSchema } from './orders';
import { reviewImageSchema } from './uploads';

/*
 * Product reviews
 * ---------------
 * A customer's rating and review of a product they received. Eligibility, one review
 * per customer and the moderation decision are enforced by the database; these schemas
 * describe what may be sent and what comes back. The rating average is never sent by a
 * client: it is counted from approved reviews on every read.
 */

export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/**
 * A review's timestamps, as the database hands them back.
 *
 * The review functions build their answer with `jsonb_build_object`, so PostgreSQL
 * serialises a `timestamptz` itself — `2026-11-10T14:27:03.575796+00:00`, with its
 * fractional seconds and a UTC offset. That is a valid ISO 8601 instant, but a schema
 * that accepts only a trailing `Z` refuses it, and the read (the customer's own review,
 * the public list, the moderation queue) then fails as a whole. Accepting the offset is
 * what `adminBannerSchema` already does for its window; both spellings are allowed here.
 */
export const reviewTimestampSchema = z.iso.datetime({ offset: true });

/** One to five whole stars. */
export const reviewRatingSchema = z.number().int().min(1).max(5);

/** POST /me/products/:productId/review */
export const reviewSubmitRequestSchema = z.strictObject({
  rating: reviewRatingSchema,
  title: z
    .string()
    .trim()
    .max(120, { error: 'Keep the title under 120 characters' })
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
  body: z
    .string()
    .trim()
    .min(10, { error: 'Write at least 10 characters' })
    .max(2000, { error: 'Keep the review under 2000 characters' }),
});

/** GET /me/products/:productId/review — may the customer review, and what they wrote. */
export const myReviewSchema = z.object({
  eligible: z.boolean(),
  review: z
    .object({
      id: z.uuid(),
      rating: reviewRatingSchema,
      title: z.string().nullable(),
      body: z.string(),
      status: z.enum(REVIEW_STATUSES),
      /** The moderator's explanation, when they gave one. */
      moderationNote: z.string().nullable(),
      /** The customer's own photos, whatever the review's status. */
      images: z.array(reviewImageSchema).default([]),
      createdAt: reviewTimestampSchema,
      updatedAt: reviewTimestampSchema,
    })
    .nullable(),
});

/** GET /catalog/products/:slug/reviews — approved reviews only. */
export const productReviewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(200).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

/**
 * The store's public answer to a review.
 *
 * Written once per review and shown under it. `authorName` is always the shop, not a person:
 * a review is answered by Nilzora, and the account that typed it is kept for the audit trail
 * only.
 */
export const reviewReplySchema = z.object({
  body: z.string(),
  authorName: z.string(),
  createdAt: reviewTimestampSchema,
  updatedAt: reviewTimestampSchema,
});
export type ReviewReply = z.infer<typeof reviewReplySchema>;

/** How a customer found a review. */
export const REVIEW_VOTE_VERDICTS = ['helpful', 'not_helpful'] as const;
export type ReviewVoteVerdict = (typeof REVIEW_VOTE_VERDICTS)[number];
export const reviewVoteVerdictSchema = z.enum(REVIEW_VOTE_VERDICTS);

export const publicReviewSchema = z.object({
  id: z.uuid(),
  rating: reviewRatingSchema,
  title: z.string().nullable(),
  body: z.string(),
  /** First name and initial, e.g. "Ayesha R."; never an email address. */
  authorName: z.string(),
  /** Always true for a published review: only buyers can review. */
  verified: z.boolean(),
  /** Photos the customer attached; shown only because the review itself is approved. */
  images: z.array(reviewImageSchema).default([]),
  createdAt: reviewTimestampSchema,
  /** The store's public answer, or null when nobody has replied. */
  reply: reviewReplySchema.nullable().default(null),
  /** How many customers found it helpful. Defaults keep older readers parsing. */
  helpfulCount: z.number().int().nonnegative().default(0),
  notHelpfulCount: z.number().int().nonnegative().default(0),
  /** The caller's own verdict, or null when they have not voted (or are not signed in). */
  viewerVote: reviewVoteVerdictSchema.nullable().default(null),
});

/** Counts per star, keyed "1"…"5"; a star with no reviews may be absent. */
export const ratingSummarySchema = z.object({
  /** The mean to two decimals; 0 when nothing is approved yet. */
  averageRating: z.number().min(0).max(5),
  reviewCount: z.number().int().min(0),
  distribution: z.record(z.enum(['1', '2', '3', '4', '5']), z.number().int().min(0)),
});

export const productReviewsResponseSchema = z.object({
  summary: ratingSummarySchema,
  reviews: z.array(publicReviewSchema),
  ...pageInfoShape,
});

/*
 * Waiting for a review
 * --------------------
 * A delivered order line whose product has no review from this customer yet. The answer is
 * built from the order's own snapshot of the line, so the reminder names the product exactly
 * as it was bought, and it disappears by itself once the review exists.
 */

export const reviewableItemSchema = z.object({
  productId: z.uuid(),
  /** The name as sold, from the order line. */
  productName: z.string(),
  productSlug: z.string(),
  variantLabel: z.string().nullable(),
  /** The line's picture as it was bought, or null when there was none. */
  image: orderItemImageSchema.nullable(),
  orderNumber: z.string(),
  /** When the parcel was marked delivered; the reminder counts from here. */
  deliveredAt: reviewTimestampSchema,
});

export const reviewableItemsResponseSchema = z.object({
  items: z.array(reviewableItemSchema),
});

export type ReviewableItem = z.infer<typeof reviewableItemSchema>;
export type ReviewableItemsResponse = z.infer<typeof reviewableItemsResponseSchema>;

/**
 * GET /me/reviews/prompt — the one delivered product the account visit may ask about: the most
 * recently delivered product not yet reviewed and whose prompt the customer has not closed.
 * `null` when there is nothing to ask (or the prompt cannot be dismissed on this database).
 */
export const reviewPromptResponseSchema = z.object({ item: reviewableItemSchema.nullable() });
export type ReviewPromptResponse = z.infer<typeof reviewPromptResponseSchema>;

/** POST /me/reviews/prompt/dismiss — the prompt is not shown again for this product. */
export const reviewPromptDismissSchema = z.strictObject({ productId: z.uuid() });
export type ReviewPromptDismiss = z.infer<typeof reviewPromptDismissSchema>;

/**
 * How long a customer waits before the store asks again. The option to review is there from
 * the day the parcel arrives; this is only the point at which the reminder stops being a
 * suggestion and starts pointing at the customer's own order.
 */
export const REVIEW_REMINDER_DAYS = 3;

/*
 * Admin moderation
 */

/** GET /admin/product-reviews */
export const adminReviewListQuerySchema = z.object({
  status: z.enum(['all', ...REVIEW_STATUSES]).default('pending'),
  q: z.string().trim().max(100).optional(),
  ...adminPageQueryShape,
});

export const adminReviewSchema = publicReviewSchema
  .omit({ authorName: true, verified: true })
  .extend({
    productId: z.uuid(),
    productName: z.string(),
    productSlug: z.string(),
    authorId: z.uuid(),
    authorName: z.string().nullable(),
    authorEmail: z.string().nullable(),
    status: z.enum(REVIEW_STATUSES),
    moderatedAt: reviewTimestampSchema.nullable(),
    moderationNote: z.string().nullable(),
  });

export const adminReviewListResponseSchema = z.object({
  reviews: z.array(adminReviewSchema),
  ...pageInfoShape,
});

/** POST /admin/product-reviews/:reviewId/status */
export const reviewModerationRequestSchema = z.strictObject({
  status: z.enum(REVIEW_STATUSES),
  note: z
    .string()
    .trim()
    .max(300, { error: 'Keep the note under 300 characters' })
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
});

export type ReviewSubmitRequest = z.input<typeof reviewSubmitRequestSchema>;
export type MyReview = z.infer<typeof myReviewSchema>;
export type PublicReview = z.infer<typeof publicReviewSchema>;
export type RatingSummary = z.infer<typeof ratingSummarySchema>;
export type ProductReviewQuery = z.input<typeof productReviewQuerySchema>;
export type ProductReviewsResponse = z.infer<typeof productReviewsResponseSchema>;
export type AdminReviewListQuery = z.input<typeof adminReviewListQuerySchema>;
export type AdminReview = z.infer<typeof adminReviewSchema>;
export type AdminReviewListResponse = z.infer<typeof adminReviewListResponseSchema>;
export type ReviewModerationRequest = z.input<typeof reviewModerationRequestSchema>;

/*
 * The store's public answer
 * -------------------------
 * Its own permission (`reviews.reply`), because answering in public is a different right from
 * deciding whether a review may be shown (`reviews.moderate`). The database checks it again.
 */

/** POST /admin/product-reviews/:reviewId/reply */
export const reviewReplyRequestSchema = z.strictObject({
  body: z
    .string()
    .trim()
    .min(2, { error: 'Write at least two characters' })
    .max(1000, { error: 'Keep the answer under 1000 characters' }),
});
export type ReviewReplyRequest = z.input<typeof reviewReplyRequestSchema>;

/*
 * Helpful / not helpful
 * ---------------------
 * PUT /me/reviews/:reviewId/vote — `verdict: null` withdraws the caller's vote, which is the
 * third thing the control offers. One row per account per review, so this can only move a
 * customer's own vote, never add a second one.
 */
export const reviewVoteRequestSchema = z.strictObject({
  verdict: reviewVoteVerdictSchema.nullable(),
});
export type ReviewVoteRequest = z.input<typeof reviewVoteRequestSchema>;

export const reviewVoteResponseSchema = z.object({
  reviewId: z.uuid(),
  helpfulCount: z.coerce.number().int().nonnegative(),
  notHelpfulCount: z.coerce.number().int().nonnegative(),
  viewerVote: reviewVoteVerdictSchema.nullable(),
});
export type ReviewVoteResponse = z.infer<typeof reviewVoteResponseSchema>;
