import { z } from 'zod';
import { moneyMinorSchema } from './catalog';
import { appliedCouponSchema, optionalCouponCodeSchema } from './coupons';
import { appliedCampaignSchema } from './discounts';
import { DELIVERY_ZONES } from './locations';

/*
 * Cart contract
 * -------------
 * A cart is only product ids and quantities. The API prices it from the live
 * catalog (POST /cart/quote, and POST /checkout/quote with a delivery address);
 * order placement prices it again inside the order transaction.
 */

export const MAX_CART_LINES = 30;
export const MAX_LINE_QUANTITY = 100;

export const cartItemSchema = z.strictObject({
  productId: z.uuid(),
  /** The chosen variant of a product that sells as options; null for a simple product. */
  variantId: z.uuid().nullable().optional(),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
});

/** A line's identity: the same product may appear once per variant. */
const cartItemKey = (item: { productId: string; variantId?: string | null }) =>
  `${item.productId.toLowerCase()}:${(item.variantId ?? '').toLowerCase()}`;

export const cartItemsSchema = z
  .array(cartItemSchema)
  .min(1)
  .max(MAX_CART_LINES)
  .refine((items) => new Set(items.map(cartItemKey)).size === items.length, {
    error: 'Each product can appear in the cart only once per variant',
  });

/** POST /cart/quote */
export const cartQuoteRequestSchema = z.strictObject({ items: cartItemsSchema });

/** POST /checkout/quote — the address must be one of the caller's own. */
export const checkoutQuoteRequestSchema = z.strictObject({
  items: cartItemsSchema,
  addressId: z.uuid(),
  /** An optional coupon code; the database decides whether it applies. */
  couponCode: optionalCouponCodeSchema,
});

export const CART_LINE_PROBLEMS = [
  'unavailable',
  'quantity_limit',
  'insufficient_stock',
  /** The product sells as variants and none was chosen. */
  'variant_required',
  /** The chosen variant is unknown, inactive, or belongs to another product. */
  'variant_invalid',
] as const;
export type CartLineProblem = (typeof CART_LINE_PROBLEMS)[number];

/**
 * The picture a cart line shows: the chosen variant's own photo when it has one, otherwise
 * the product's primary image. URLs are built by the API; a stored key is never exposed.
 */
export const cartLineImageSchema = z.object({
  url: z.url(),
  /** A smaller copy for list rows; the same URL when the picture has no thumbnail. */
  thumbUrl: z.url(),
  /** The image's own description, when the catalog has one. */
  alt: z.string().nullable(),
});

/** One priced cart line. A product that is not on sale reveals only its id. */
export const cartLineSchema = z.object({
  productId: z.uuid(),
  /** The chosen variant; null for a simple product. */
  variantId: z.uuid().nullable().default(null),
  /** The option values of that variant, e.g. 'Size: M / Colour: Navy'. */
  variantLabel: z.string().nullable().default(null),
  slug: z.string().nullable(),
  name: z.string().nullable(),
  sku: z.string().nullable(),
  unitPriceMinor: moneyMinorSchema.nullable(),
  compareAtPriceMinor: moneyMinorSchema.nullable(),
  /**
   * The price a campaign discounts: the list price when a campaign holds this line,
   * otherwise the same `compareAtPriceMinor` the product already carries.
   */
  listPriceMinor: moneyMinorSchema.nullable().default(null),
  /** Poisha this line's campaign takes off one unit; 0 without a campaign. */
  campaignDiscountMinor: moneyMinorSchema.default(0),
  /** The campaign that priced this line, when one did. */
  campaign: appliedCampaignSchema.nullable().default(null),
  quantity: z.number().int().min(1),
  lineTotalMinor: moneyMinorSchema.nullable(),
  /** Most units this line may hold right now; null when the product is not on sale. */
  availableQuantity: z.number().int().min(0).nullable(),
  problem: z.enum(CART_LINE_PROBLEMS).nullable(),
  /** The line's picture; null when the product has none or media is not configured. */
  image: cartLineImageSchema.nullable().default(null),
});

export const cartQuoteSchema = z.object({
  lines: z.array(cartLineSchema),
  /** Units across the lines that can be ordered as they are. */
  itemCount: z.number().int().min(0),
  subtotalMinor: moneyMinorSchema,
  /** The promotional saving already included in `subtotalMinor`. */
  campaignDiscountMinor: moneyMinorSchema.default(0),
  /** The following are set only for a checkout quote (with an address). */
  deliveryZone: z.enum(DELIVERY_ZONES).nullable(),
  shippingFeeMinor: moneyMinorSchema.nullable(),
  totalMinor: moneyMinorSchema.nullable(),
  /** True when every line can be ordered as it is (and, with an address, delivery is set up). */
  purchasable: z.boolean(),
});

export const cartQuoteResponseSchema = z.object({ quote: cartQuoteSchema });

/**
 * A checkout quote may carry a coupon. `discountMinor` is always present (0 without a
 * coupon); `coupon` is the code that applied; `couponProblem` says why a code did not,
 * and is the only reason a code is ever silently ignored.
 */
export const checkoutQuoteSchema = cartQuoteSchema.extend({
  discountMinor: moneyMinorSchema.default(0),
  coupon: appliedCouponSchema.nullable().default(null),
  couponProblem: z.string().nullable().default(null),
});

export const checkoutQuoteResponseSchema = z.object({ quote: checkoutQuoteSchema });

export type CartItem = z.infer<typeof cartItemSchema>;
export type CartLineImage = z.infer<typeof cartLineImageSchema>;
export type CartLine = z.infer<typeof cartLineSchema>;
export type CartQuote = z.infer<typeof cartQuoteSchema>;
export type CheckoutQuote = z.infer<typeof checkoutQuoteSchema>;
export type CartQuoteRequest = z.input<typeof cartQuoteRequestSchema>;
export type CheckoutQuoteRequest = z.input<typeof checkoutQuoteRequestSchema>;
export type CartQuoteResponse = z.infer<typeof cartQuoteResponseSchema>;
export type CheckoutQuoteResponse = z.infer<typeof checkoutQuoteResponseSchema>;
