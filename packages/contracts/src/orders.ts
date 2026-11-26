import { z } from 'zod';
import { cartItemsSchema } from './cart';
import { moneyMinorSchema } from './catalog';
import { optionalCouponCodeSchema } from './coupons';
import { BD_DIVISIONS, DELIVERY_ZONES } from './locations';

/*
 * Cash-on-Delivery orders
 * -----------------------
 * The client sends what to buy and where to deliver, never prices or totals. The
 * server prices the cart, checks stock and limits, and writes the order in one
 * database transaction. `expectedTotalMinor` is the total the customer reviewed: it
 * is compared, never used, so a price change since the review is refused
 * (price_changed) instead of silently charging a different amount.
 *
 * `idempotencyKey` identifies one checkout attempt. Sending the same request again
 * (a double click, a retry after a timeout) returns the original order. After a
 * timeout, network failure or 503 the order may already exist, so a retry must reuse
 * the same key; only a deliberately new checkout gets a new one.
 */

export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ['pending', 'collected', 'cancelled'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Human-facing order reference, e.g. NZ100042. */
export const orderNumberSchema = z
  .string()
  .regex(/^NZ\d{6,12}$/, { error: 'Not a valid order number' });

/** POST /orders */
export const placeOrderRequestSchema = z.strictObject({
  idempotencyKey: z.uuid(),
  addressId: z.uuid(),
  items: cartItemsSchema,
  note: z
    .string()
    .trim()
    .max(500, { error: 'Keep the note under 500 characters' })
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
  expectedTotalMinor: moneyMinorSchema,
  /** The code the customer reviewed; the order transaction prices it again. */
  couponCode: optionalCouponCodeSchema,
});

/** POST /orders/:orderNumber/cancel — customers may cancel only pending orders. */
export const cancelOrderRequestSchema = z.strictObject({
  reason: z
    .string()
    .trim()
    .max(300)
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
});

/** GET /orders */
export const orderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

/**
 * The picture of an ordered line, as the API resolved it from the base key stored with the
 * line. It is the picture the customer saw when they ordered, so it keeps working after the
 * product is re-photographed, unpublished or deleted.
 */
export const orderItemImageSchema = z.object({
  url: z.url(),
  thumbUrl: z.url(),
  alt: z.string().nullable(),
});
export type OrderItemImage = z.infer<typeof orderItemImageSchema>;

/**
 * One option the customer chose on a line (Colour: Black, Size: L), as it was when ordered. The
 * snapshot is written inside the order transaction, so it never changes with the product.
 */
export const orderItemOptionSchema = z.object({
  name: z.string().min(1).max(80),
  value: z.string().min(1).max(120),
});
export type OrderItemOption = z.infer<typeof orderItemOptionSchema>;

/**
 * One line of an order as the order *list* shows it: enough to recognise what was bought
 * without opening the order. A list of orders carries at most three, plus the item count.
 */
export const orderPreviewItemSchema = z.object({
  productName: z.string(),
  variantLabel: z.string().nullable(),
  /** The same choice as data; empty for a simple product and for orders that predate it. */
  variantOptions: z.array(orderItemOptionSchema).optional(),
  quantity: z.number().int().min(1),
  image: orderItemImageSchema.nullable(),
});
export type OrderPreviewItem = z.infer<typeof orderPreviewItemSchema>;

export const orderSummarySchema = z.object({
  orderNumber: orderNumberSchema,
  status: z.enum(ORDER_STATUSES),
  paymentMethod: z.literal('cod'),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  itemCount: z.number().int().min(1),
  totalMinor: moneyMinorSchema,
  placedAt: z.iso.datetime(),
  /**
   * The first lines of the order, so the list can show what was bought. At most three;
   * `itemCount` still says how many units the whole order holds.
   */
  preview: z.array(orderPreviewItemSchema).max(3).default([]),
});

export const orderItemSchema = z.object({
  /** The order line's own id; a return request names the lines it sends back. */
  orderItemId: z.number().int().positive(),
  productId: z.uuid(),
  /** The variant bought; null for a simple product. */
  variantId: z.uuid().nullable().default(null),
  /** The options as sold, e.g. 'Size: M / Colour: Navy'. */
  variantLabel: z.string().nullable().default(null),
  /** The chosen options as data (Colour, Size, ...); empty when there were none. */
  variantOptions: z.array(orderItemOptionSchema).optional(),
  productName: z.string(),
  productSlug: z.string(),
  sku: z.string(),
  unitPriceMinor: moneyMinorSchema,
  quantity: z.number().int().min(1),
  lineTotalMinor: moneyMinorSchema,
  /** The line's picture at purchase, or null when there was none (or media is unconfigured). */
  image: orderItemImageSchema.nullable().default(null),
  /**
   * The list price the line was sold against. Equal to `unitPriceMinor` when no campaign
   * priced it. Absent from orders placed before campaigns existed.
   */
  regularPriceMinor: moneyMinorSchema.nullable().default(null),
  /** The product's own sale price at purchase, before any campaign. */
  catalogPriceMinor: moneyMinorSchema.nullable().default(null),
  /** The campaign that priced the line, kept even after it is archived. */
  campaignId: z.uuid().nullable().default(null),
  campaignTitle: z.string().nullable().default(null),
  /** Poisha the campaign took off one unit. */
  campaignDiscountMinor: moneyMinorSchema.default(0),
});

export const orderEventSchema = z.object({
  fromStatus: z.enum(ORDER_STATUSES).nullable(),
  toStatus: z.enum(ORDER_STATUSES),
  at: z.iso.datetime(),
});

export const orderDetailSchema = orderSummarySchema.extend({
  currency: z.literal('BDT'),
  subtotalMinor: moneyMinorSchema,
  shippingFeeMinor: moneyMinorSchema,
  discountMinor: moneyMinorSchema,
  deliveryZone: z.enum(DELIVERY_ZONES),
  shippingAddress: z.object({
    recipientName: z.string(),
    phone: z.string(),
    division: z.enum(BD_DIVISIONS),
    district: z.string(),
    area: z.string(),
    addressLine: z.string(),
    postalCode: z.string().nullable(),
    landmark: z.string().nullable(),
  }),
  customerNote: z.string().nullable(),
  cancelReason: z.string().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  items: z.array(orderItemSchema).min(1),
  history: z.array(orderEventSchema),
  /** Whether the customer may still cancel (only while pending). */
  canCancel: z.boolean(),
});

export const orderListResponseSchema = z.object({
  orders: z.array(orderSummarySchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});

export const orderResponseSchema = z.object({ order: orderDetailSchema });

/** 201 for a new order; 200 with created: false when the idempotency key was seen before. */
export const placeOrderResponseSchema = z.object({
  order: orderDetailSchema,
  created: z.boolean(),
});

/**
 * `details` of the `order_confirmation_pending` answer: the order was saved, but the API
 * could not read it back to answer in full. The number is the caller's own order, so a
 * client can open its receipt instead of asking the customer to order again.
 */
export const orderConfirmationPendingDetailsSchema = z.object({
  orderNumber: orderNumberSchema,
});

export type PlaceOrderRequest = z.input<typeof placeOrderRequestSchema>;
export type CancelOrderRequest = z.input<typeof cancelOrderRequestSchema>;
export type OrderListQuery = z.input<typeof orderListQuerySchema>;
export type OrderSummary = z.infer<typeof orderSummarySchema>;
export type OrderItem = z.infer<typeof orderItemSchema>;
export type OrderDetail = z.infer<typeof orderDetailSchema>;
export type OrderListResponse = z.infer<typeof orderListResponseSchema>;
export type OrderResponse = z.infer<typeof orderResponseSchema>;
export type PlaceOrderResponse = z.infer<typeof placeOrderResponseSchema>;
