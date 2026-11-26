import { z } from 'zod';
import { MODERATION_STATUSES, MODERATION_TASK_STATUSES, PRODUCT_STATUSES } from './admin-catalog';
import { accountRefSchema, adminPageQueryShape, pageInfoShape } from './admin-common';
import { moneyMinorSchema } from './catalog';

/*
 * Product content moderation. Staff submit a draft product's content for review
 * (POST /admin/products/:productId/submit); the submission keeps a snapshot of the
 * content, so the decision is about exactly what was reviewed. An assigner hands the
 * review to a moderator, and only that moderator decides it, never on their own
 * submission. A review assigned to someone else reads as not found.
 */

export const MODERATION_DECISIONS = ['approved', 'rejected', 'changes_requested'] as const;
export type ModerationDecision = (typeof MODERATION_DECISIONS)[number];

export const MODERATION_EVENT_KINDS = [
  'submitted',
  'assigned',
  'approved',
  'rejected',
  'changes_requested',
  'withdrawn',
] as const;
export type ModerationEventKind = (typeof MODERATION_EVENT_KINDS)[number];

/** Which reviews an assigner lists: their own, the unassigned ones, or all. */
export const MODERATION_SCOPES = ['mine', 'unassigned', 'all'] as const;
export type ModerationScope = (typeof MODERATION_SCOPES)[number];

/**
 * GET /moderator/queue — the caller's assigned reviews. Pending reviews come oldest
 * first (a queue); other statuses newest first.
 */
export const moderatorQueueQuerySchema = z.object({
  status: z.enum(MODERATION_TASK_STATUSES).optional(),
  ...adminPageQueryShape,
});

/** GET /admin/moderation — every review, for those who assign them. */
export const moderationListQuerySchema = moderatorQueueQuerySchema.extend({
  scope: z.enum(MODERATION_SCOPES).default('all'),
});

/** The product content as submitted for review. */
export const moderationContentSchema = z.object({
  name: z.string(),
  summary: z.string().nullable(),
  description: z.string().nullable(),
  slug: z.string(),
  sku: z.string(),
  categoryId: z.uuid(),
  categoryName: z.string().nullable(),
  priceMinor: moneyMinorSchema,
  compareAtPriceMinor: moneyMinorSchema.nullable(),
});

export const moderationTaskSummarySchema = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  productName: z.string(),
  productSku: z.string(),
  status: z.enum(MODERATION_TASK_STATUSES),
  submittedBy: accountRefSchema.nullable(),
  submittedAt: z.iso.datetime(),
  assignedTo: accountRefSchema.nullable(),
  assignedAt: z.iso.datetime().nullable(),
  decidedAt: z.iso.datetime().nullable(),
});

export const moderationEventSchema = z.object({
  kind: z.enum(MODERATION_EVENT_KINDS),
  actor: accountRefSchema.nullable(),
  note: z.string().nullable(),
  at: z.iso.datetime(),
});

export const moderationTaskDetailSchema = moderationTaskSummarySchema.extend({
  content: moderationContentSchema,
  decidedBy: accountRefSchema.nullable(),
  decisionNote: z.string().nullable(),
  events: z.array(moderationEventSchema),
  /** The product as it is now (it may have changed since the submission). */
  product: z
    .object({
      status: z.enum(PRODUCT_STATUSES),
      moderationStatus: z.enum(MODERATION_STATUSES),
    })
    .nullable(),
  /** Whether the caller may decide this review now (shapes the interface only). */
  canDecide: z.boolean(),
});

/** POST /admin/moderation/:taskId/assignment — (re)assigns an open review. */
export const moderationAssignmentRequestSchema = z.strictObject({ moderatorId: z.uuid() });

/**
 * POST /moderator/tasks/:taskId/decision — approving may carry a note; rejecting or
 * requesting changes needs an explanation of at least 10 characters.
 */
export const moderationDecisionRequestSchema = z
  .strictObject({
    decision: z.enum(MODERATION_DECISIONS),
    note: z
      .string()
      .trim()
      .max(1000, { error: 'Keep the note under 1,000 characters' })
      .transform((value) => (value === '' ? undefined : value))
      .optional(),
  })
  .refine((body) => body.decision === 'approved' || (body.note?.length ?? 0) >= 10, {
    error: 'Explain the decision in at least 10 characters',
    path: ['note'],
  });

export const moderationTaskListResponseSchema = z.object({
  tasks: z.array(moderationTaskSummarySchema),
  ...pageInfoShape,
});

export const moderationTaskResponseSchema = z.object({ task: moderationTaskDetailSchema });

/** An active account that holds content.approve, as offered for assignment. */
export const moderationReviewerSchema = accountRefSchema.extend({
  /** Pending reviews assigned to the account now. */
  openReviews: z.number().int().min(0),
});

/** GET /admin/moderation/reviewers — active accounts that can be assigned reviews. */
export const moderationReviewerListResponseSchema = z.object({
  reviewers: z.array(moderationReviewerSchema),
});

export type ModeratorQueueQuery = z.input<typeof moderatorQueueQuerySchema>;
export type ModerationListQuery = z.input<typeof moderationListQuerySchema>;
export type ModerationContent = z.infer<typeof moderationContentSchema>;
export type ModerationTaskSummary = z.infer<typeof moderationTaskSummarySchema>;
export type ModerationEvent = z.infer<typeof moderationEventSchema>;
export type ModerationTaskDetail = z.infer<typeof moderationTaskDetailSchema>;
export type ModerationAssignmentRequest = z.input<typeof moderationAssignmentRequestSchema>;
export type ModerationDecisionRequest = z.input<typeof moderationDecisionRequestSchema>;
export type ModerationTaskListResponse = z.infer<typeof moderationTaskListResponseSchema>;
export type ModerationTaskResponse = z.infer<typeof moderationTaskResponseSchema>;
export type ModerationReviewer = z.infer<typeof moderationReviewerSchema>;
export type ModerationReviewerListResponse = z.infer<typeof moderationReviewerListResponseSchema>;
