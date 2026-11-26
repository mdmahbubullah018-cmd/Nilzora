import { z } from 'zod';
import {
  accountRefSchema,
  adminPageQueryShape,
  adminSearchSchema,
  pageInfoShape,
} from './admin-common';
import { moneyMinorSchema } from './catalog';
import { DELIVERY_ZONES } from './locations';
import { ORDER_STATUSES } from './orders';

/*
 * Admin reports and settings: the audit log, sales figures, the workspace dashboard
 * and the delivery charges. Money is always an integer number of poisha.
 */

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/** The longest range the audit log may be asked for (a leap year). */
export const AUDIT_LOG_MAX_DAYS = 366;

const auditDay = z.iso.date();

function auditDaysBetween(from: string, to: string): number {
  return (
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  );
}

/**
 * GET /admin/audit-log — newest first.
 *
 * Every filter is optional and they combine. `from` and `to` are Bangladesh calendar days,
 * both inclusive; with both given the range may not end before it starts and spans at most
 * 366 days, and either alone leaves that side open. `q` is a plain-text search (nothing in
 * it is a wildcard) over the action, the acting account's name and email, and the target's
 * id. The log does not record IP addresses, so there is nothing to filter or show for them.
 */
export const auditLogQuerySchema = z
  .object({
    /** Actions starting with this text, e.g. `order.` or `staff.permission_changed`. */
    action: z
      .string()
      .regex(/^[a-z_.]{1,60}$/, { error: 'Use lower-case letters, dots and underscores' })
      .optional(),
    actorId: z.uuid().optional(),
    from: auditDay.optional(),
    to: auditDay.optional(),
    q: adminSearchSchema.optional(),
    ...adminPageQueryShape,
  })
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    error: 'The range must not end before it starts',
    path: ['to'],
  })
  .refine(
    (query) =>
      query.from === undefined ||
      query.to === undefined ||
      Number.isNaN(auditDaysBetween(query.from, query.to)) ||
      auditDaysBetween(query.from, query.to) <= AUDIT_LOG_MAX_DAYS,
    { error: `Choose at most ${String(AUDIT_LOG_MAX_DAYS)} days`, path: ['from'] },
  );

export const auditEntrySchema = z.object({
  id: z.number().int().min(1),
  /** Null when the acting account no longer exists. */
  actor: accountRefSchema.nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  /** What changed (never passwords or tokens). */
  details: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});

export const auditLogResponseSchema = z.object({
  entries: z.array(auditEntrySchema),
  ...pageInfoShape,
});

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export const SALES_PERIODS = [7, 30, 90] as const;

/** GET /admin/analytics/sales?days= — the last 1 to 365 Bangladesh calendar days. */
export const salesOverviewQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

const countSchema = z.number().int().min(0);

/**
 * Sales of the period. Cancelled orders are counted separately and never as sales;
 * `awaitingCollectionMinor` is all delivered orders whose cash is not yet recorded,
 * whenever they were placed, and `byStatus` covers every order ever placed.
 */
export const salesOverviewSchema = z.object({
  days: z.number().int().min(1),
  orderCount: countSchema,
  cancelledCount: countSchema,
  salesMinor: moneyMinorSchema,
  collectedMinor: moneyMinorSchema,
  awaitingCollectionMinor: moneyMinorSchema,
  averageOrderMinor: moneyMinorSchema,
  byStatus: z.partialRecord(z.enum(ORDER_STATUSES), countSchema),
  daily: z.array(
    z.object({ day: z.iso.date(), orderCount: countSchema, salesMinor: moneyMinorSchema }),
  ),
  topProducts: z.array(
    z.object({
      productId: z.uuid(),
      productName: z.string(),
      unitsSold: countSchema,
      salesMinor: moneyMinorSchema,
    }),
  ),
});

export const salesOverviewResponseSchema = z.object({ overview: salesOverviewSchema });

// ---------------------------------------------------------------------------
// Dashboard: each section is present only when the caller holds its permission.
// ---------------------------------------------------------------------------

export const dashboardResponseSchema = z.object({
  /** Orders waiting at each fulfilment step (orders.read). */
  orders: z
    .object({
      pending: countSchema,
      confirmed: countSchema,
      processing: countSchema,
      shipped: countSchema,
      /** Delivered orders whose cash is not yet recorded. */
      awaitingCollection: countSchema,
    })
    .nullable(),
  /** Products on sale that are low on or out of stock, lowest first (products.read). */
  stock: z
    .object({
      lowStockCount: countSchema,
      products: z.array(
        z.object({
          id: z.uuid(),
          name: z.string(),
          sku: z.string(),
          stockQuantity: countSchema,
        }),
      ),
    })
    .nullable(),
  /** Open content reviews (content.approve: assigned to the caller; moderation.assign: the rest). */
  moderation: z
    .object({
      assignedToMe: countSchema,
      unassigned: countSchema.nullable(),
      pending: countSchema.nullable(),
    })
    .nullable(),
  /** The last 7 days' sales (finance.read). */
  sales: z
    .object({
      days: z.number().int().min(1),
      orderCount: countSchema,
      salesMinor: moneyMinorSchema,
      awaitingCollectionMinor: moneyMinorSchema,
    })
    .nullable(),
});

// ---------------------------------------------------------------------------
// Delivery charges
// ---------------------------------------------------------------------------

export const deliveryChargeSchema = z.object({
  zone: z.enum(DELIVERY_ZONES),
  /** Null until the store sets it; orders to the zone are refused until then. */
  amountMinor: moneyMinorSchema.nullable(),
  updatedAt: z.iso.datetime().nullable(),
});

export const deliveryChargeListResponseSchema = z.object({
  charges: z.array(deliveryChargeSchema),
});

/** PUT /admin/settings/delivery-charges/:zone — 0 to 100,000 taka. */
export const deliveryChargeRequestSchema = z.strictObject({
  amountMinor: moneyMinorSchema.max(10_000_000, { error: 'The charge is at most 100,000 taka' }),
});

export const deliveryChargeResponseSchema = z.object({ charge: deliveryChargeSchema });

export type AuditLogQuery = z.input<typeof auditLogQuerySchema>;
export type AuditEntry = z.infer<typeof auditEntrySchema>;
export type AuditLogResponse = z.infer<typeof auditLogResponseSchema>;
export type SalesOverviewQuery = z.input<typeof salesOverviewQuerySchema>;
export type SalesOverview = z.infer<typeof salesOverviewSchema>;
export type SalesOverviewResponse = z.infer<typeof salesOverviewResponseSchema>;
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
export type DeliveryCharge = z.infer<typeof deliveryChargeSchema>;
export type DeliveryChargeListResponse = z.infer<typeof deliveryChargeListResponseSchema>;
export type DeliveryChargeRequest = z.input<typeof deliveryChargeRequestSchema>;
export type DeliveryChargeResponse = z.infer<typeof deliveryChargeResponseSchema>;
