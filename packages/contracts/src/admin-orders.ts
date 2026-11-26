import { z } from 'zod';
import { adminPageQueryShape, adminSearchSchema, pageInfoShape } from './admin-common';
import { moneyMinorSchema } from './catalog';
import { DELIVERY_ZONES } from './locations';
import {
  ORDER_STATUSES,
  orderDetailSchema,
  orderSummarySchema,
  PAYMENT_STATUSES,
  type OrderStatus,
} from './orders';
import { shipmentStatusSchema } from './shipments';

/*
 * Admin orders: every customer's Cash-on-Delivery orders, their fulfilment and the
 * recording of collected cash. Order status and payment status are separate: an
 * order is delivered first, then its cash is recorded as collected, once. Cancelling
 * returns the order's stock in the same database transaction.
 */

/**
 * The fulfilment steps the database allows from each status (any open order can also
 * be cancelled until it ships). The database enforces them; the API uses this table
 * only to tell the interface which actions to offer.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

export const ORDER_ACTOR_KINDS = ['customer', 'staff', 'system'] as const;
export type OrderActorKind = (typeof ORDER_ACTOR_KINDS)[number];

/** How the admin order list is ordered (newest first by default). */
export const ADMIN_ORDER_SORTS = ['newest', 'oldest', 'total_high', 'total_low'] as const;
export type AdminOrderSort = (typeof ADMIN_ORDER_SORTS)[number];

/** GET /admin/orders — newest first. Dates are Bangladesh calendar days, both inclusive. */
export const adminOrderListQuerySchema = z
  .object({
    status: z.enum(ORDER_STATUSES).optional(),
    /** Delivery zone of the order's address. */
    deliveryZone: z.enum(DELIVERY_ZONES).optional(),
    sort: z.enum(ADMIN_ORDER_SORTS).optional(),
    paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
    /** An order number (or its start), a phone number (or part of it), or a recipient's name. */
    q: adminSearchSchema.optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    /** One customer's orders only. */
    customerId: z.uuid().optional(),
    /** "archived" lists archived (test) orders only; by default they are left out. */
    view: z.enum(['archived']).optional(),
    ...adminPageQueryShape,
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    error: 'The start date must not be after the end date',
    path: ['from'],
  });

/**
 * The coupon or collected voucher that priced an order, with the discount recorded when the
 * order was placed (never recomputed from the coupon's current settings).
 */
export const adminOrderCouponSchema = z.object({
  couponId: z.uuid(),
  code: z.string(),
  title: z.string().nullable(),
  isVoucher: z.boolean(),
  discountMinor: moneyMinorSchema,
});
export type AdminOrderCoupon = z.infer<typeof adminOrderCouponSchema>;

export const adminOrderSummarySchema = orderSummarySchema.extend({
  customerId: z.uuid(),
  recipientName: z.string(),
  phone: z.string(),
  deliveryZone: z.enum(DELIVERY_ZONES),
  /** The order's coupon discount, in poisha (0 without one). */
  discountMinor: moneyMinorSchema.default(0),
  /** The coupon or voucher used, when the caller's read could resolve it. */
  coupon: adminOrderCouponSchema.nullable().default(null),
  /**
   * The order's latest delivery parcel, for staff who may read shipments (null otherwise,
   * or when nothing was booked). The courier's status never changes the order's own.
   */
  shipment: z
    .object({
      shipmentId: z.uuid(),
      status: shipmentStatusSchema,
      provider: z.string(),
      providerName: z.string(),
      trackingCode: z.string().nullable(),
      bookingUncertain: z.boolean(),
      isMock: z.boolean(),
    })
    .nullable()
    .default(null),
});

/** One step of an order's history, as staff see it. */
export const adminOrderEventSchema = z.object({
  fromStatus: z.enum(ORDER_STATUSES).nullable(),
  toStatus: z.enum(ORDER_STATUSES),
  actorKind: z.enum(ORDER_ACTOR_KINDS),
  note: z.string().nullable(),
  at: z.iso.datetime(),
});

export const adminOrderDetailSchema = orderDetailSchema
  .omit({ history: true, canCancel: true })
  .extend({
    customer: z.object({
      id: z.uuid(),
      /** Null when the caller may not see customer accounts. */
      fullName: z.string().nullable(),
      phone: z.string().nullable(),
    }),
    history: z.array(adminOrderEventSchema),
    /** The coupon or voucher behind `discountMinor`, when there is one. */
    coupon: adminOrderCouponSchema.nullable().default(null),
    paymentCollectedAt: z.iso.datetime().nullable(),
    /** Statuses the caller may move the order to now (shapes the interface only). */
    allowedStatuses: z.array(z.enum(ORDER_STATUSES)),
    /** Whether the caller may record the cash as collected now. */
    canRecordCollection: z.boolean(),
  });

/**
 * POST /admin/orders/:orderNumber/status — one fulfilment step, or a cancellation
 * (which needs a reason of at least 5 characters and returns the stock).
 */
export const orderStatusChangeRequestSchema = z
  .strictObject({
    status: z.enum(ORDER_STATUSES).exclude(['pending']),
    note: z
      .string()
      .trim()
      .max(300, { error: 'Keep the note under 300 characters' })
      .transform((value) => (value === '' ? undefined : value))
      .optional(),
  })
  .refine((body) => body.status !== 'cancelled' || (body.note?.length ?? 0) >= 5, {
    error: 'Give a reason of at least 5 characters to cancel an order',
    path: ['note'],
  });

/**
 * POST /admin/orders/:orderNumber/cod-collection — records that the courier handed
 * over the order's cash. `amountMinor` must equal the order total, so a miscounted
 * collection is refused instead of being recorded as paid in full.
 */
export const codCollectionRequestSchema = z.strictObject({ amountMinor: moneyMinorSchema });

export const adminOrderListResponseSchema = z.object({
  orders: z.array(adminOrderSummarySchema),
  ...pageInfoShape,
});

export const adminOrderResponseSchema = z.object({ order: adminOrderDetailSchema });

export type AdminOrderListQuery = z.input<typeof adminOrderListQuerySchema>;
export type AdminOrderSummary = z.infer<typeof adminOrderSummarySchema>;
export type AdminOrderEvent = z.infer<typeof adminOrderEventSchema>;
export type AdminOrderDetail = z.infer<typeof adminOrderDetailSchema>;
export type OrderStatusChangeRequest = z.input<typeof orderStatusChangeRequestSchema>;
export type CodCollectionRequest = z.input<typeof codCollectionRequestSchema>;
export type AdminOrderListResponse = z.infer<typeof adminOrderListResponseSchema>;
export type AdminOrderResponse = z.infer<typeof adminOrderResponseSchema>;

/** A staff-only note on an order. */
export const orderNoteSchema = z.object({
  id: z.uuid(),
  body: z.string(),
  author: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type OrderNote = z.infer<typeof orderNoteSchema>;

/** GET /admin/orders/:orderNumber/internal: notes, and whether the order is archived. */
export const orderInternalResponseSchema = z.object({
  notes: z.array(orderNoteSchema),
  archive: z.object({ archivedAt: z.iso.datetime(), reason: z.string().nullable() }).nullable(),
});
export type OrderInternalResponse = z.infer<typeof orderInternalResponseSchema>;

/** POST /admin/orders/:orderNumber/notes */
export const orderNoteRequestSchema = z.strictObject({ body: z.string().trim().min(1).max(1000) });

/** POST /admin/orders/:orderNumber/archive: archive (with a reason) or restore. */
export const orderArchiveRequestSchema = z
  .strictObject({ archive: z.boolean(), reason: z.string().trim().max(300).optional() })
  .refine((body) => !body.archive || (body.reason?.length ?? 0) >= 3, {
    error: 'Give a reason of at least 3 characters',
    path: ['reason'],
  });
export type OrderArchiveRequest = z.input<typeof orderArchiveRequestSchema>;
