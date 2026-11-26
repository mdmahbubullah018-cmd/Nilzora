import { z } from 'zod';
import { moneyMinorSchema } from './catalog';

/*
 * Customer insight
 * ----------------
 * What a customer has actually spent, derived from their orders and the refunds that were
 * really paid out. Nothing is stored, so a refund changes the number the moment it is
 * completed, and no summary can drift away from the orders it describes.
 *
 * Rules (fixed in the database function, stated here so the Admin UI can explain them):
 *   - a cancelled order contributes nothing to spending or to the order count;
 *   - an order counts once it leaves pending, so an unconfirmed order is not revenue;
 *   - every completed refund is subtracted, so returned goods are not counted as spend;
 *   - everything is integer poisha.
 */

export const CUSTOMER_SEGMENTS = [
  'new',
  'repeat',
  'high_spender',
  'inactive',
  'active',
] as const;
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];
export const customerSegmentSchema = z.enum(CUSTOMER_SEGMENTS);

/** How each segment is decided, so the UI never presents a label as a mystery. */
export const CUSTOMER_SEGMENT_LABELS: Readonly<Record<CustomerSegment, string>> = {
  new: 'First order or none yet',
  repeat: 'Has ordered again',
  high_spender: 'Spending above the store threshold',
  inactive: 'No order for a while',
  active: 'Ordered recently',
};

export const customerInsightSchema = z.object({
  id: z.uuid(),
  fullName: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  /** Orders that are not cancelled. */
  ordersCount: z.number().int().min(0),
  /** Orders that reached the customer. */
  completedOrders: z.number().int().min(0),
  /** Paid, minus everything refunded. */
  spendMinor: moneyMinorSchema,
  averageOrderMinor: moneyMinorSchema,
  firstOrderAt: z.iso.datetime().nullable().default(null),
  lastOrderAt: z.iso.datetime().nullable().default(null),
  segments: z.array(customerSegmentSchema),
});

export const customerInsightListResponseSchema = z.object({
  customers: z.array(customerInsightSchema),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).default(25),
  total: z.number().int().min(0).default(0),
  totalPages: z.number().int().min(0).default(0),
});

/** GET /admin/insights/customers */
export const customerInsightQuerySchema = z.object({
  segment: z.union([customerSegmentSchema, z.literal('all')]).default('all'),
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type CustomerInsight = z.infer<typeof customerInsightSchema>;
export type CustomerInsightListResponse = z.infer<typeof customerInsightListResponseSchema>;
export type CustomerInsightQuery = z.input<typeof customerInsightQuerySchema>;
