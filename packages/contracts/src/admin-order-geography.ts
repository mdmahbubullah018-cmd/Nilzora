import { z } from 'zod';
import { moneyMinorSchema } from './catalog';
import { ORDER_STATUSES } from './orders';
import { ANALYTICS_MAX_DAYS, analyticsDaySchema } from './admin-analytics';

/*
 * Where orders come from, by division and district.
 * ------------------------------------------------
 * One aggregate read behind the Bangladesh Order Analytics page: the map, the KPI cards,
 * the rankings and every chart are drawn from this single result, so no two surfaces can
 * disagree about a total.
 *
 * Definitions (money in integer poisha, days in Asia/Dhaka) follow the analytics overview,
 * which is the established authority:
 *   - the population is every order placed in the range that matches the filters
 *     (`summary.totalOrders`), cancelled included — it is what the status split adds up to;
 *   - `summary.eligibleOrders` is that population minus the cancelled ones: the orders that
 *     count as demand, and the population the geography splits into mapped and unmapped;
 *   - revenue is the total of the non-cancelled orders (COD: owed or paid, delivery
 *     included), never net of refunds — the same figure the Analytics page reports;
 *   - the location is the order's own delivery snapshot (`ship_district`, `ship_division`),
 *     written at checkout; a customer's current address is never read for history;
 *   - an order whose snapshot does not name a district in the reference table is unmapped,
 *     counted in `unmapped` and never guessed into a district.
 */

/** What the choropleth is shaded by. The legend follows the same choice. */
export const ORDER_GEOGRAPHY_METRICS = ['orders', 'revenue', 'delivered'] as const;
export type OrderGeographyMetric = (typeof ORDER_GEOGRAPHY_METRICS)[number];

const isoDay = z.iso.date();
const count = z.number().int().min(0);
/** A share between 0 and 1, or null when its denominator is zero. */
const share = z.number().min(0).max(1).nullable();

function daysBetween(from: string, to: string): number {
  return (
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  );
}

/**
 * GET /admin/analytics/orders/geography?from&to&division&district&status&metric
 *
 * `district` may be sent alone: its division is taken from the reference table, so the two
 * can never be an impossible pair.
 */
export const orderGeographyQuerySchema = z
  .object({
    from: isoDay,
    to: isoDay,
    /** A canonical division name from bd_districts. */
    division: z.string().trim().min(1).max(40).optional(),
    /** A canonical district name from bd_districts. */
    district: z.string().trim().min(1).max(40).optional(),
    status: z.enum(ORDER_STATUSES).optional(),
    metric: z.enum(ORDER_GEOGRAPHY_METRICS).default('orders'),
  })
  .refine((query) => query.from <= query.to, {
    error: 'The range must not end before it starts',
    path: ['to'],
  })
  .refine((query) => daysBetween(query.from, query.to) <= ANALYTICS_MAX_DAYS, {
    error: `Choose at most ${String(ANALYTICS_MAX_DAYS)} days`,
    path: ['from'],
  });

export type OrderGeographyQuery = z.infer<typeof orderGeographyQuerySchema>;

/** One division, always all eight of them, so the chart never hides an empty one. */
export const orderGeographyDivisionSchema = z.object({
  division: z.string(),
  orderCount: count,
  deliveredCount: count,
  revenueMinor: moneyMinorSchema,
  /** Of the mapped eligible orders. */
  share,
});

/** One district, always all sixty-four, so the map shades "no orders" as a fact. */
export const orderGeographyDistrictSchema = z.object({
  district: z.string(),
  division: z.string(),
  orderCount: count,
  deliveredCount: count,
  revenueMinor: moneyMinorSchema,
  share,
});

export const orderGeographySummarySchema = z.object({
  /** Every order placed in the range that matches the filters, cancelled included. */
  totalOrders: count,
  /** That population without the cancelled orders: the demand the map is drawn from. */
  eligibleOrders: count,
  deliveredOrders: count,
  pendingOrders: count,
  processingOrders: count,
  shippedOrders: count,
  cancelledOrders: count,
  /** Orders with a return request that was not withdrawn. */
  returnedOrders: count,
  /** Non-cancelled orders' totals, delivery included. */
  revenueMinor: moneyMinorSchema,
  /** Revenue ÷ eligible orders (rounded); 0 when there were none. */
  averageOrderMinor: moneyMinorSchema,
  /** Delivered ÷ eligible orders; null when there were no eligible orders. */
  deliveredRate: share,
  mappedOrders: count,
  unmappedOrders: count,
});

/** The raw values that could not be placed, so stale source data can be found and fixed. */
export const orderGeographyUnmappedValueSchema = z.object({
  /** The snapshot as stored — never a customer address or any personal detail. */
  district: z.string(),
  division: z.string(),
  orderCount: count,
});

export const orderGeographySchema = z.object({
  generatedAt: z.string(),
  timezone: z.literal('Asia/Dhaka'),
  filters: z.object({
    from: isoDay,
    to: isoDay,
    division: z.string().nullable(),
    district: z.string().nullable(),
    status: z.enum(ORDER_STATUSES).nullable(),
    metric: z.enum(ORDER_GEOGRAPHY_METRICS),
  }),
  summary: orderGeographySummarySchema,
  divisions: z.array(orderGeographyDivisionSchema),
  districts: z.array(orderGeographyDistrictSchema),
  /** One entry per day of the range, oldest first; days without orders are zero, not missing. */
  timeline: z.array(
    analyticsDaySchema.pick({ day: true, orderCount: true, revenueMinor: true }).extend({
      deliveredCount: count,
    }),
  ),
  /** Adds up to summary.totalOrders: cancelled is a status, not a silent omission. */
  statusBreakdown: z.array(z.object({ status: z.enum(ORDER_STATUSES), count })),
  unmapped: z.object({
    orderCount: count,
    /** Revenue of those orders: it is in summary.revenueMinor but in no district row. */
    revenueMinor: moneyMinorSchema,
    /** Orders whose snapshot names no district at all. */
    missingDistrictCount: count,
    /** Orders whose district is not in the reference table (a stale or misspelt value). */
    unknownDistrictCount: count,
    /** Up to ten distinct offending values, largest first. */
    values: z.array(orderGeographyUnmappedValueSchema),
  }),
});

export type OrderGeography = z.infer<typeof orderGeographySchema>;
export type OrderGeographyDivision = z.infer<typeof orderGeographyDivisionSchema>;
export type OrderGeographyDistrict = z.infer<typeof orderGeographyDistrictSchema>;
export type OrderGeographySummary = z.infer<typeof orderGeographySummarySchema>;
export type OrderGeographyResponse = { geography: OrderGeography };

export const orderGeographyResponseSchema = z.object({ geography: orderGeographySchema });
