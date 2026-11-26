import { z } from 'zod';
import { adminOrderSummarySchema } from './admin-orders';
import { DELIVERY_ZONES } from './locations';
import { moneyMinorSchema } from './money';
import { ORDER_STATUSES } from './orders';
import {
  bookingOutcomeSchema,
  courierProviderIdSchema,
  parcelWeightGramsSchema,
  shipmentStatusSchema,
} from './shipments';

/*
 * Bulk order actions
 * ------------------
 * Staff select orders in the admin list and act on them together. Every selected order is
 * validated and processed on its own, with the same permission and business rules as the
 * single-order action, and every order gets its own result: nothing is skipped silently and
 * one failure never undoes another order's success. Selecting orders never books a parcel;
 * booking needs its own explicit, confirmed request, with a booking key per order so a
 * retried request never books twice. Courier status never changes an order's payment.
 */

/** The most orders one bulk request may name. */
export const BULK_ORDER_LIMIT = 100;
/** The most parcels one bulk booking request may book. */
export const BULK_SHIPMENT_LIMIT = 50;

const orderNumberListSchema = (max: number) =>
  z
    .array(z.string().trim().min(1).max(40))
    .min(1, { error: 'Select at least one order' })
    .max(max, { error: `Select at most ${max} orders` })
    .refine((list) => new Set(list).size === list.length, {
      error: 'An order is selected twice',
    });

/** A per-order refusal, in the API's stable error vocabulary. */
export const bulkOrderErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

/** POST /admin/orders/bulk/status */
export const bulkOrderStatusRequestSchema = z
  .strictObject({
    orderNumbers: orderNumberListSchema(BULK_ORDER_LIMIT),
    status: z.enum(ORDER_STATUSES).exclude(['pending']),
    note: z
      .string()
      .trim()
      .max(300)
      .transform((value) => (value === '' ? undefined : value))
      .optional(),
  })
  .refine((body) => body.status !== 'cancelled' || (body.note?.length ?? 0) >= 5, {
    error: 'Give a reason of at least 5 characters to cancel orders',
    path: ['note'],
  });

export const bulkOrderStatusResultSchema = z.object({
  orderNumber: z.string(),
  ok: z.boolean(),
  /** The order's status after the request (on success). */
  status: z.enum(ORDER_STATUSES).nullable(),
  error: bulkOrderErrorSchema.nullable(),
});

export const bulkOrderStatusResponseSchema = z.object({
  results: z.array(bulkOrderStatusResultSchema),
  succeeded: z.number().int().min(0),
  failed: z.number().int().min(0),
});

/** POST /admin/orders/bulk/summaries — the selected orders' list rows (export, review). */
export const bulkOrderSummariesRequestSchema = z.strictObject({
  orderNumbers: orderNumberListSchema(BULK_ORDER_LIMIT),
});

export const bulkOrderSummariesResponseSchema = z.object({
  orders: z.array(adminOrderSummarySchema),
  /** Selected numbers the caller cannot see (or that do not exist). */
  missing: z.array(z.string()),
});

/** POST /admin/orders/bulk/courier-check — which selected orders could be booked now. */
export const bulkCourierCheckRequestSchema = z.strictObject({
  orderNumbers: orderNumberListSchema(BULK_ORDER_LIMIT),
});

export const BULK_COURIER_BLOCKERS = [
  'not_found',
  'order_status',
  'active_shipment',
  'forbidden',
  'unavailable',
] as const;

export const bulkCourierCheckResultSchema = z.object({
  orderNumber: z.string(),
  bookable: z.boolean(),
  /** Why it cannot be booked now (null when bookable). */
  blocker: z.enum(BULK_COURIER_BLOCKERS).nullable(),
  orderStatus: z.string().nullable(),
  codDueMinor: moneyMinorSchema.nullable(),
  district: z.string().nullable(),
  deliveryZone: z.enum(DELIVERY_ZONES).nullable(),
  /** The active parcel's status, when it has one. */
  shipmentStatus: shipmentStatusSchema.nullable(),
});

export const bulkCourierCheckResponseSchema = z.object({
  results: z.array(bulkCourierCheckResultSchema),
  bookable: z.number().int().min(0),
  defaultParcelWeightGrams: parcelWeightGramsSchema,
});

/**
 * POST /admin/orders/bulk/shipments — books one parcel per listed order with the chosen
 * courier, only after the explicit confirmation. Each order carries its own booking key
 * (created once by the admin screen and resent on retry).
 */
export const bulkShipmentBookingRequestSchema = z
  .strictObject({
    provider: courierProviderIdSchema,
    /** The same weight for every parcel; the courier default when left out. */
    weightGrams: parcelWeightGramsSchema.optional(),
    /** Must be true: staff confirmed this exact list. */
    confirm: z.literal(true),
    items: z
      .array(
        z.strictObject({ orderNumber: z.string().trim().min(1).max(40), bookingKey: z.uuid() }),
      )
      .min(1)
      .max(BULK_SHIPMENT_LIMIT),
  })
  .refine(
    (body) => new Set(body.items.map((item) => item.orderNumber)).size === body.items.length,
    {
      error: 'An order is listed twice',
      path: ['items'],
    },
  )
  .refine((body) => new Set(body.items.map((item) => item.bookingKey)).size === body.items.length, {
    error: 'Each order needs its own booking key',
    path: ['items'],
  });

export const bulkShipmentBookingResultSchema = z.object({
  orderNumber: z.string(),
  ok: z.boolean(),
  outcome: bookingOutcomeSchema.nullable(),
  shipmentId: z.uuid().nullable(),
  duplicate: z.boolean(),
  error: bulkOrderErrorSchema.nullable(),
});

export const bulkShipmentBookingResponseSchema = z.object({
  results: z.array(bulkShipmentBookingResultSchema),
  booked: z.number().int().min(0),
  failed: z.number().int().min(0),
  /** Bookings with no clear courier answer: check the portal, then resolve each one. */
  uncertain: z.number().int().min(0),
});

export type BulkOrderStatusRequest = z.input<typeof bulkOrderStatusRequestSchema>;
export type BulkOrderStatusResult = z.infer<typeof bulkOrderStatusResultSchema>;
export type BulkOrderStatusResponse = z.infer<typeof bulkOrderStatusResponseSchema>;
export type BulkOrderSummariesRequest = z.infer<typeof bulkOrderSummariesRequestSchema>;
export type BulkOrderSummariesResponse = z.infer<typeof bulkOrderSummariesResponseSchema>;
export type BulkCourierCheckRequest = z.infer<typeof bulkCourierCheckRequestSchema>;
export type BulkCourierCheckResult = z.infer<typeof bulkCourierCheckResultSchema>;
export type BulkCourierCheckResponse = z.infer<typeof bulkCourierCheckResponseSchema>;
export type BulkShipmentBookingRequest = z.input<typeof bulkShipmentBookingRequestSchema>;
export type BulkShipmentBookingResult = z.infer<typeof bulkShipmentBookingResultSchema>;
export type BulkShipmentBookingResponse = z.infer<typeof bulkShipmentBookingResponseSchema>;
