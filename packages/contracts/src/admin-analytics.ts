import { z } from 'zod';
import { moneyMinorSchema } from './catalog';
import { DELIVERY_ZONES } from './locations';
import { ORDER_STATUSES } from './orders';

/*
 * Analytics overview
 * ------------------
 * One aggregate read for the dashboard and analytics pages, over a date range of
 * Bangladesh calendar days, optionally compared with the equally long period right
 * before it. Every figure is computed by the database from real orders, accounts,
 * carts and returns — nothing is estimated, and a figure the data cannot support is
 * null, never zero.
 *
 * Money is integer poisha. "Revenue" is the total of orders that were not cancelled
 * (COD: what customers owe or paid, including delivery). Times are Asia/Dhaka.
 */

/** The longest range one request may ask for (a leap year). */
export const ANALYTICS_MAX_DAYS = 366;

const isoDay = z.iso.date();
const count = z.number().int().min(0);
/** A share between 0 and 1, or null when its denominator is zero. */
const ratio = z.number().min(0).max(1).nullable();

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** GET /admin/analytics/overview?from=YYYY-MM-DD&to=YYYY-MM-DD&compare=true */
export const analyticsOverviewQuerySchema = z
  .object({
    from: isoDay,
    to: isoDay,
    /** Also compute the previous period of the same length (default on). */
    compare: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
  })
  .refine((query) => query.from <= query.to, {
    error: 'The range must not end before it starts',
    path: ['to'],
  })
  .refine((query) => daysBetween(query.from, query.to) <= ANALYTICS_MAX_DAYS, {
    error: `Choose at most ${String(ANALYTICS_MAX_DAYS)} days`,
    path: ['from'],
  });

/** Totals for one period. */
export const analyticsTotalsSchema = z.object({
  /** Orders placed in the period that were not cancelled. */
  orderCount: count,
  cancelledCount: count,
  revenueMinor: moneyMinorSchema,
  /** Revenue ÷ orders (rounded); 0 when there were no orders. */
  averageOrderMinor: moneyMinorSchema,
  /** Customer accounts created in the period. */
  newCustomers: count,
  /** Cash recorded as collected for orders placed in the period. */
  collectedMinor: moneyMinorSchema,
  /** Orders placed in the period that are now delivered. */
  deliveredCount: count,
  /** Orders placed in the period with a return request (any outcome except withdrawn). */
  returnedOrderCount: count,
});

export const analyticsDaySchema = z.object({
  day: isoDay,
  revenueMinor: moneyMinorSchema,
  orderCount: count,
  newCustomers: count,
  /** Orders placed that day, by their current status (cancelled included). */
  byStatus: z.partialRecord(z.enum(ORDER_STATUSES), count),
});

export const analyticsOverviewSchema = z.object({
  range: z.object({ from: isoDay, to: isoDay, days: z.number().int().min(1) }),
  /** The comparison period, when one was asked for. */
  previousRange: z.object({ from: isoDay, to: isoDay }).nullable(),
  totals: analyticsTotalsSchema,
  previousTotals: analyticsTotalsSchema.nullable(),
  /** One entry per day of the range, oldest first (days without orders included). */
  daily: z.array(analyticsDaySchema),
  /** The previous period's daily revenue and orders, oldest first (for comparison lines). */
  previousDaily: z.array(
    z.object({ day: isoDay, revenueMinor: moneyMinorSchema, orderCount: count }),
  ),
  /** Figures for right now, not bound to the range. */
  snapshot: z.object({
    /** Delivered orders whose cash is not yet recorded, whenever placed. */
    codPendingMinor: moneyMinorSchema,
    codPendingCount: count,
    /** Products on sale at or below the low-stock threshold, and those sold out. */
    lowStockCount: count,
    outOfStockCount: count,
  }),
  /** Orders placed in the range, by current status. */
  statusSplit: z.partialRecord(z.enum(ORDER_STATUSES), count),
  /** Cash of the range's non-cancelled orders: still owed vs collected. */
  paymentSplit: z.object({
    pendingMinor: moneyMinorSchema,
    pendingCount: count,
    collectedMinor: moneyMinorSchema,
    collectedCount: count,
  }),
  /** Non-cancelled orders of the range by delivery zone. */
  deliveryZones: z.array(
    z.object({ zone: z.enum(DELIVERY_ZONES), orderCount: count, revenueMinor: moneyMinorSchema }),
  ),
  /** Item sales of the range by the product's current category, largest first (up to 10). */
  salesByCategory: z.array(
    z.object({
      categoryId: z.uuid().nullable(),
      /** "Uncategorised" when the product has no category. */
      categoryName: z.string(),
      unitsSold: count,
      revenueMinor: moneyMinorSchema,
    }),
  ),
  /** The range's best sellers by units, up to 10. */
  topProducts: z.array(
    z.object({
      productId: z.uuid(),
      productName: z.string(),
      unitsSold: count,
      revenueMinor: moneyMinorSchema,
    }),
  ),
  /** Orders placed in the range by Dhaka weekday (1 = Monday … 7 = Sunday) and hour; zero cells omitted. */
  heatmap: z.array(
    z.object({
      weekday: z.number().int().min(1).max(7),
      hour: z.number().int().min(0).max(23),
      orderCount: z.number().int().min(1),
    }),
  ),
  /**
   * Shopping journey of the range from what the store records: carts created, checkouts
   * started, and orders placed. Product views are not tracked, so there is no views stage.
   */
  funnel: z.object({ carts: count, checkouts: count, orders: count }),
  rates: z.object({
    /** Delivered ÷ non-cancelled orders placed in the range. */
    fulfillment: ratio,
    /** Orders with a return request ÷ delivered orders, both placed in the range. */
    returns: ratio,
  }),
  /** This calendar month's revenue against the target set in store settings. */
  monthTarget: z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    targetMinor: moneyMinorSchema.nullable(),
    revenueMinor: moneyMinorSchema,
  }),
  /**
   * The range's top customers by revenue, up to 10, with each one's daily revenue for a
   * sparkline. Null unless the caller may read customers (customers.read).
   */
  topCustomers: z
    .array(
      z.object({
        customerId: z.uuid(),
        name: z.string().nullable(),
        email: z.string().nullable(),
        orderCount: count,
        revenueMinor: moneyMinorSchema,
        daily: z.array(moneyMinorSchema),
      }),
    )
    .nullable(),
});

export const analyticsOverviewResponseSchema = z.object({ overview: analyticsOverviewSchema });

/** PUT /admin/settings/sales-target — the monthly revenue target, or null to clear it. */
export const salesTargetRequestSchema = z.strictObject({
  targetMinor: moneyMinorSchema
    .max(100_000_000_000, { error: 'The target is at most 1,000,000,000 taka' })
    .nullable(),
});

export const salesTargetResponseSchema = z.object({
  target: z.object({ targetMinor: moneyMinorSchema.nullable(), updatedAt: z.iso.datetime().nullable() }),
});

export type AnalyticsOverviewQuery = z.input<typeof analyticsOverviewQuerySchema>;
export type AnalyticsTotals = z.infer<typeof analyticsTotalsSchema>;
export type AnalyticsDay = z.infer<typeof analyticsDaySchema>;
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>;
export type AnalyticsOverviewResponse = z.infer<typeof analyticsOverviewResponseSchema>;
export type SalesTargetRequest = z.input<typeof salesTargetRequestSchema>;
export type SalesTargetResponse = z.infer<typeof salesTargetResponseSchema>;
