import { z } from 'zod';
import { moneyMinorSchema } from './catalog';
import { orderNumberSchema } from './orders';

/*
 * Refunds contract
 * ----------------
 * Nilzora is Cash on Delivery: a refund is money handed back by the store, so it is
 * recorded explicitly — requested, approved by someone authorised, then completed with a
 * receipt reference. Nothing here assumes an online payment gateway.
 */

export const REFUND_METHODS = ['cod_manual', 'bank_transfer'] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];
export const refundMethodSchema = z.enum(REFUND_METHODS);

export const REFUND_STATUSES = [
  'requested',
  'approved',
  'completed',
  'rejected',
  'cancelled',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];
export const refundStatusSchema = z.enum(REFUND_STATUSES);

export const refundSummarySchema = z.object({
  id: z.uuid(),
  orderNumber: z.string(),
  /** Null when the listing hides customer names from the caller's role. */
  customerName: z.string().nullable().default(null),
  amountMinor: moneyMinorSchema,
  method: refundMethodSchema,
  status: refundStatusSchema,
  reason: z.string(),
  requestedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable().default(null),
});

export const refundHistoryEntrySchema = z.object({
  fromStatus: refundStatusSchema.nullable(),
  toStatus: refundStatusSchema,
  note: z.string().nullable(),
  at: z.iso.datetime(),
});

export const refundDetailSchema = refundSummarySchema.extend({
  reference: z.string().nullable().default(null),
  note: z.string().nullable().default(null),
  decidedAt: z.iso.datetime().nullable().default(null),
  returnRequestId: z.uuid().nullable().default(null),
  /** What is left to refund on the order right now. */
  refundableMinor: moneyMinorSchema,
  order: z.object({
    number: z.string(),
    totalMinor: moneyMinorSchema,
    status: z.string(),
    paymentStatus: z.string(),
    placedAt: z.iso.datetime(),
  }),
  customer: z.object({
    id: z.uuid(),
    name: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  history: z.array(refundHistoryEntrySchema),
});

export const refundListResponseSchema = z.object({
  refunds: z.array(refundSummarySchema),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).default(25),
  total: z.number().int().min(0).default(0),
  totalPages: z.number().int().min(0).default(0),
});
export const refundResponseSchema = z.object({ refund: refundDetailSchema });

/** GET /admin/refunds */
export const adminRefundListQuerySchema = z.object({
  status: z.union([refundStatusSchema, z.literal('all')]).default('all'),
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** POST /admin/refunds — the amount and the method are checked again in the database. */
export const refundRequestSchema = z.strictObject({
  orderNumber: orderNumberSchema,
  amountMinor: moneyMinorSchema.refine((value) => value > 0, {
    error: 'Enter the amount to refund',
  }),
  reason: z.string().trim().min(3).max(200),
  method: refundMethodSchema.default('cod_manual'),
  returnRequestId: z.uuid().optional(),
});

/** POST /admin/refunds/:refundId/decision */
export const refundDecisionRequestSchema = z.strictObject({
  approve: z.boolean(),
  note: z.string().trim().max(300).optional(),
});

/**
 * POST /admin/refunds/:refundId/completion — recording that the money went back. The
 * reference is evidence (a receipt or transfer id), so it is never optional.
 */
export const refundCompletionRequestSchema = z.strictObject({
  reference: z.string().trim().min(3).max(120),
  note: z.string().trim().max(500).optional(),
});

/** POST /admin/refunds/:refundId/cancel */
export const refundCancelRequestSchema = z.strictObject({
  note: z.string().trim().min(5).max(300),
});

/** How a customer sees a refund of their own order. */
export const myRefundSchema = z.object({
  id: z.uuid(),
  amountMinor: moneyMinorSchema,
  method: refundMethodSchema,
  status: refundStatusSchema,
  reason: z.string(),
  reference: z.string().nullable().default(null),
  requestedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable().default(null),
});

export const myRefundsResponseSchema = z.object({ refunds: z.array(myRefundSchema) });

export type RefundSummary = z.infer<typeof refundSummarySchema>;
export type RefundDetail = z.infer<typeof refundDetailSchema>;
export type RefundListResponse = z.infer<typeof refundListResponseSchema>;
export type RefundResponse = z.infer<typeof refundResponseSchema>;
export type RefundRequest = z.input<typeof refundRequestSchema>;
export type AdminRefundListQuery = z.input<typeof adminRefundListQuerySchema>;
export type RefundDecisionRequest = z.infer<typeof refundDecisionRequestSchema>;
export type RefundCompletionRequest = z.infer<typeof refundCompletionRequestSchema>;
export type MyRefund = z.infer<typeof myRefundSchema>;
export type MyRefundsResponse = z.infer<typeof myRefundsResponseSchema>;
