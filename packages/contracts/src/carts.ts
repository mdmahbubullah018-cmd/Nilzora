import { z } from 'zod';
import { moneyMinorSchema } from './catalog';
import { MAX_LINE_QUANTITY } from './cart';
import { orderNumberSchema } from './orders';

/*
 * Persisted carts and checkout tracking
 * -------------------------------------
 * The server keeps the cart; the storefront cookie and the Android store only identify it
 * (a guest handle, or the signed-in account). No price, discount or stock is ever sent by
 * a client: the existing quote and order functions stay the authority.
 */

export const CART_STATUSES = ['active', 'checkout', 'converted', 'expired'] as const;
export type CartStatus = (typeof CART_STATUSES)[number];
export const cartStatusSchema = z.enum(CART_STATUSES);

export const CHECKOUT_STATUSES = ['started', 'incomplete', 'converted', 'expired'] as const;
export type CheckoutStatus = (typeof CHECKOUT_STATUSES)[number];
export const checkoutStatusSchema = z.enum(CHECKOUT_STATUSES);

/** One saved line: a product, optionally one of its variants, and a quantity. */
export const savedCartLineSchema = z.object({
  productId: z.uuid(),
  variantId: z.uuid().nullable().default(null),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
});

export const cartResponseSchema = z.object({
  cart: z.object({
    id: z.uuid(),
    status: cartStatusSchema,
    lines: z.array(savedCartLineSchema),
    lastActivityAt: z.iso.datetime(),
  }),
});

/** PUT /me/cart/items — quantity 0 removes the line. */
export const cartSetItemRequestSchema = z.strictObject({
  productId: z.uuid(),
  variantId: z.uuid().nullable().default(null),
  quantity: z.number().int().min(0).max(MAX_LINE_QUANTITY),
});

/** POST /me/cart/merge — the guest handle the browser or device kept. */
export const guestCartRequestSchema = z.strictObject({ token: z.uuid() });

export const mergeGuestCartRequestSchema = guestCartRequestSchema;

/**
 * PUT /guest/cart/items — the same line rule as the signed-in cart, plus the handle.
 * Quantity 0 removes the line, so one shape covers add, update and remove.
 */
export const guestCartSetItemRequestSchema = z.strictObject({
  token: z.uuid(),
  productId: z.uuid(),
  variantId: z.uuid().nullable().default(null),
  quantity: z.number().int().min(0).max(MAX_LINE_QUANTITY),
});

/** POST /checkout/sessions — checkout genuinely starts here. */
export const checkoutStartRequestSchema = z.strictObject({
  addressId: z.uuid().nullable().optional(),
  couponCode: z.string().trim().min(1).max(40).optional(),
});

export const checkoutSessionResponseSchema = z.object({
  checkout: z.object({
    id: z.uuid(),
    status: checkoutStatusSchema,
    startedAt: z.iso.datetime(),
    lastActivityAt: z.iso.datetime(),
  }),
});

/** POST /checkout/sessions/:id/converted — sent only after the order really exists. */
export const checkoutConvertedRequestSchema = z.strictObject({
  orderNumber: orderNumberSchema,
});

/** GET /admin/checkouts */
export const adminCheckoutListQuerySchema = z.object({
  status: z.union([checkoutStatusSchema, z.literal('all')]).default('all'),
  q: z.string().trim().max(100).default(''),
  /** ISO date (yyyy-mm-dd) or full timestamp; the API widens dates to whole days. */
  from: z.string().trim().max(40).default(''),
  to: z.string().trim().max(40).default(''),
  sort: z.enum(['recent', 'started', 'value']).default('recent'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** What staff did about an abandoned checkout. Conversion is tracked by `status`. */
export const checkoutRecoveryStateSchema = z.enum(['open', 'contacted', 'dismissed']);

export const checkoutRecoveryChannelSchema = z.enum([
  'call',
  'whatsapp',
  'sms',
  'email',
  'in_person',
  'other',
]);

export const checkoutSummarySchema = z.object({
  id: z.uuid(),
  status: checkoutStatusSchema,
  recoveryState: checkoutRecoveryStateSchema.default('open'),
  customerName: z.string().nullable().default(null),
  customerPhone: z.string().nullable().default(null),
  itemCount: z.number().int().min(0),
  couponCode: z.string().nullable().default(null),
  /** Catalogue value of the lines in the cart, in poisha. Never a charged total. */
  cartValueMinor: moneyMinorSchema.default(0),
  startedAt: z.iso.datetime(),
  lastActivityAt: z.iso.datetime(),
  /** Set the first time the attempt was classified as abandoned. */
  abandonedAt: z.iso.datetime().nullable().default(null),
  convertedAt: z.iso.datetime().nullable().default(null),
  /** Present once the attempt became an order. */
  orderNumber: z.string().nullable().default(null),
  attemptCount: z.number().int().min(0).default(0),
});

export const checkoutListResponseSchema = z.object({
  checkouts: z.array(checkoutSummarySchema),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).default(25),
  total: z.number().int().min(0).default(0),
  totalPages: z.number().int().min(0).default(0),
});

export const checkoutDetailSchema = checkoutSummarySchema.extend({
  convertedAt: z.iso.datetime().nullable().default(null),
  customer: z
    .object({
      id: z.uuid(),
      name: z.string().nullable(),
      phone: z.string().nullable().default(null),
    })
    .optional(),
  items: z.array(
    z.object({
      productId: z.uuid().optional(),
      productName: z.string(),
      productSlug: z.string().optional(),
      /** Storage key of the product's primary picture; the API turns it into a URL. */
      imageKey: z.string().nullable().optional(),
      variantLabel: z.string().nullable().default(null),
      sku: z.string(),
      quantity: z.number().int().min(1),
      /** The catalog's current price, for context only — never a charged total. */
      unitPriceMinor: moneyMinorSchema,
    }),
  ),
  attempts: z
    .array(
      z.object({
        id: z.number().int(),
        channel: checkoutRecoveryChannelSchema,
        note: z.string().nullable().default(null),
        createdAt: z.iso.datetime(),
        adminName: z.string().nullable().default(null),
      }),
    )
    .default([]),
  /** The latest link for this checkout. The token itself is never returned again. */
  link: z
    .object({
      createdAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
      usedAt: z.iso.datetime().nullable().default(null),
      revokedAt: z.iso.datetime().nullable().default(null),
    })
    .nullable()
    .default(null),
});

export const checkoutRecoveryMetricsSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  abandonedCount: z.number().int().min(0).default(0),
  openCount: z.number().int().min(0).default(0),
  recentCount: z.number().int().min(0).default(0),
  potentialValueMinor: moneyMinorSchema.default(0),
  recoveredCount: z.number().int().min(0).default(0),
  /** Null when nothing was abandoned in the window: an empty denominator is not 0%. */
  recoveryRatePercent: z.number().nullable().default(null),
  attemptCount: z.number().int().min(0).default(0),
  contactedCount: z.number().int().min(0).default(0),
  dismissedCount: z.number().int().min(0).default(0),
  /** When checkout tracking began, so a short window is never mistaken for "no interest". */
  trackingSince: z.iso.datetime().nullable().default(null),
});

export const checkoutRecoveryMetricsResponseSchema = z.object({
  metrics: checkoutRecoveryMetricsSchema,
});

/** POST /admin/checkouts/:id/attempts */
export const recordCheckoutAttemptRequestSchema = z.strictObject({
  channel: checkoutRecoveryChannelSchema,
  note: z.string().trim().max(500).optional(),
});

/** POST /admin/checkouts/:id/state */
export const setCheckoutRecoveryStateRequestSchema = z.strictObject({
  state: checkoutRecoveryStateSchema,
});

/** POST /admin/checkouts/:id/link — the token is returned exactly once. */
export const checkoutRecoveryLinkResponseSchema = z.object({
  token: z.string().min(32).max(128),
  expiresAt: z.iso.datetime(),
  checkoutId: z.uuid(),
});

/** GET /checkout/recovery/:token — safe for anybody holding the link. */
export const checkoutRecoveryPreviewSchema = z.object({
  valid: z.boolean(),
  reason: z.enum(['not_found', 'revoked', 'used', 'expired', 'closed']).nullable().default(null),
  itemCount: z.number().int().min(0).default(0),
  cartValueMinor: moneyMinorSchema.default(0),
  expiresAt: z.iso.datetime().nullable().default(null),
});

export const checkoutRecoveryRestoreResponseSchema = z.object({
  checkoutId: z.uuid(),
  /** How many of the saved lines were put back into the customer's cart. */
  restoredLines: z.number().int().min(0).default(0),
  /**
   * The lines that were restored, so a browser cart can show them too. Ids and quantities
   * only: no prices travel here, and the quote prices the cart again.
   */
  lines: z
    .array(
      z.object({
        productId: z.uuid(),
        variantId: z.uuid().nullable(),
        quantity: z.number().int().min(1),
      }),
    )
    .default([]),
});

export const checkoutResponseSchema = z.object({ checkout: checkoutDetailSchema });

export type SavedCartLine = z.infer<typeof savedCartLineSchema>;
export type CartResponse = z.infer<typeof cartResponseSchema>;
export type CartSetItemRequest = z.infer<typeof cartSetItemRequestSchema>;
export type MergeGuestCartRequest = z.infer<typeof mergeGuestCartRequestSchema>;
export type GuestCartRequest = z.infer<typeof guestCartRequestSchema>;
export type GuestCartSetItemRequest = z.infer<typeof guestCartSetItemRequestSchema>;
export type CheckoutStartRequest = z.infer<typeof checkoutStartRequestSchema>;
export type CheckoutSessionResponse = z.infer<typeof checkoutSessionResponseSchema>;
export type AdminCheckoutListQuery = z.input<typeof adminCheckoutListQuerySchema>;
export type CheckoutSummary = z.infer<typeof checkoutSummarySchema>;
export type CheckoutListResponse = z.infer<typeof checkoutListResponseSchema>;
export type CheckoutDetail = z.infer<typeof checkoutDetailSchema>;
export type CheckoutResponse = z.infer<typeof checkoutResponseSchema>;
export type CheckoutRecoveryState = z.infer<typeof checkoutRecoveryStateSchema>;
export type CheckoutRecoveryChannel = z.infer<typeof checkoutRecoveryChannelSchema>;
export type CheckoutRecoveryMetrics = z.infer<typeof checkoutRecoveryMetricsSchema>;
export type CheckoutRecoveryLink = z.infer<typeof checkoutRecoveryLinkResponseSchema>;
export type CheckoutRecoveryPreview = z.infer<typeof checkoutRecoveryPreviewSchema>;
export type CheckoutRecoveryRestore = z.infer<typeof checkoutRecoveryRestoreResponseSchema>;
