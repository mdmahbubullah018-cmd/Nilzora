import { z } from 'zod';
import { moneyMinorSchema } from './catalog';
import { orderNumberSchema } from './orders';

/*
 * Returns contract
 * ----------------
 * A customer returns units of a delivered order. Amounts are in poisha and are always the
 * ones the server computed: a client never says what an item is worth.
 */

export const RETURN_STATUSES = [
  'requested',
  'approved',
  'rejected',
  'received',
  'completed',
  'cancelled',
] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];
export const returnStatusSchema = z.enum(RETURN_STATUSES);

/** A decision a member of staff may take; the server decides which are allowed when. */
export const RETURN_DECISIONS = [
  'approved',
  'rejected',
  'received',
  'completed',
  'cancelled',
] as const;
export const returnDecisionSchema = z.enum(RETURN_DECISIONS);

export const returnReasonSchema = z.string().trim().min(3).max(120);
export const returnDescriptionSchema = z.string().trim().max(1000);

/** One order line and how many units of it to return. */
export const returnRequestItemSchema = z.strictObject({
  orderItemId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(100),
});

export const returnRequestSchema = z.strictObject({
  orderNumber: orderNumberSchema,
  items: z.array(returnRequestItemSchema).min(1).max(30),
  reason: returnReasonSchema,
  description: returnDescriptionSchema.optional(),
});

export const returnItemSchema = z.object({
  orderItemId: z.number().int().positive(),
  productName: z.string(),
  variantLabel: z.string().nullable().default(null),
  sku: z.string(),
  quantity: z.number().int().min(1),
  /** How many of this line the order held, so staff can compare. */
  orderedQuantity: z.number().int().min(1).optional(),
  lineTotalMinor: moneyMinorSchema,
});

export const returnHistoryEntrySchema = z.object({
  fromStatus: returnStatusSchema.nullable(),
  toStatus: returnStatusSchema,
  actorKind: z.enum(['customer', 'staff', 'system']),
  note: z.string().nullable(),
  at: z.iso.datetime(),
});

export const returnSummarySchema = z.object({
  id: z.uuid(),
  orderNumber: z.string(),
  status: returnStatusSchema,
  itemCount: z.number().int().min(1),
  /** The cash collected for these units: the most a refund may be. */
  refundableMinor: moneyMinorSchema,
  reason: z.string(),
  requestedAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable().default(null),
  decisionNote: z.string().nullable().default(null),
});

export const returnDetailSchema = returnSummarySchema.extend({
  description: z.string().nullable().default(null),
  receivedAt: z.iso.datetime().nullable().default(null),
  restockedAt: z.iso.datetime().nullable().default(null),
  items: z.array(returnItemSchema),
  history: z.array(returnHistoryEntrySchema),
  /** Only the admin view carries the order and customer it belongs to. */
  order: z
    .object({
      number: z.string(),
      totalMinor: moneyMinorSchema,
      status: z.string(),
      paymentStatus: z.string(),
      placedAt: z.iso.datetime(),
      deliveredAt: z.iso.datetime().nullable(),
    })
    .optional(),
  customer: z
    .object({ id: z.uuid(), name: z.string().nullable(), phone: z.string().nullable() })
    .optional(),
  refunds: z
    .array(
      z.object({
        id: z.uuid(),
        amountMinor: moneyMinorSchema,
        status: z.string(),
        method: z.string(),
        requestedAt: z.iso.datetime(),
        completedAt: z.iso.datetime().nullable(),
      }),
    )
    .optional(),
});

export const returnListResponseSchema = z.object({
  returns: z.array(returnSummarySchema),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).default(25),
  total: z.number().int().min(0).default(0),
  totalPages: z.number().int().min(0).default(0),
});
export const returnResponseSchema = z.object({ return: returnDetailSchema });

/** GET /admin/returns */
export const adminReturnListQuerySchema = z.object({
  status: z.union([returnStatusSchema, z.literal('all')]).default('all'),
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** POST /admin/returns/:returnId/status */
export const returnDecisionRequestSchema = z.strictObject({
  status: returnDecisionSchema,
  note: z.string().trim().max(300).optional(),
});

export type ReturnItem = z.infer<typeof returnItemSchema>;
export type ReturnSummary = z.infer<typeof returnSummarySchema>;
export type ReturnDetail = z.infer<typeof returnDetailSchema>;
export type ReturnListResponse = z.infer<typeof returnListResponseSchema>;
export type ReturnResponse = z.infer<typeof returnResponseSchema>;
export type ReturnRequest = z.input<typeof returnRequestSchema>;
export type AdminReturnListQuery = z.input<typeof adminReturnListQuerySchema>;
export type ReturnDecisionRequest = z.infer<typeof returnDecisionRequestSchema>;
