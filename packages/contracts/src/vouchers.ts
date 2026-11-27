import { z } from 'zod';
import { moneyMinorSchema } from './money';

/*
 * Vouchers: coupons a customer collects in the Voucher Center and redeems at checkout.
 * The same server-side coupon step prices both, and an order carries one coupon only, so
 * an order uses either one voucher or one typed code. Targeting (scope, audience) applies
 * to vouchers and codes alike.
 */

export const COUPON_SCOPES = ['storewide', 'categories', 'products'] as const;
/**
 * Who may use a coupon. `selected_customers` limits it to the accounts an admin chose; the
 * database checks the list on every listing, collection, preview and order.
 */
export const COUPON_AUDIENCES = [
  'all',
  'new_customers',
  'returning_customers',
  'selected_customers',
] as const;
export type CouponAudience = (typeof COUPON_AUDIENCES)[number];

/** How many customers one targeted coupon may name. */
export const COUPON_RECIPIENT_LIMIT = 500;

/** A voucher's state for the signed-in customer (or for everyone when signed out). */
export const VOUCHER_STATES = [
  'available',
  'collected',
  'used',
  'expired',
  'upcoming',
  'fully_collected',
] as const;
export type VoucherState = (typeof VOUCHER_STATES)[number];

const linkSchema = z.object({ slug: z.string(), name: z.string() });

export const voucherSchema = z.object({
  id: z.uuid(),
  /** Revealed only once the customer collected it; it is what checkout applies. */
  code: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  kind: z.enum(['percent', 'fixed', 'free_delivery']),
  value: z.number().int().min(1),
  maxDiscountMinor: moneyMinorSchema.nullable(),
  minOrderMinor: moneyMinorSchema,
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  scope: z.enum(COUPON_SCOPES),
  audience: z.enum(COUPON_AUDIENCES),
  categories: z.array(linkSchema),
  products: z.array(linkSchema),
  state: z.enum(VOUCHER_STATES),
  collectedAt: z.iso.datetime().nullable(),
  usedCount: z.number().int().min(0),
  perCustomerLimit: z.number().int().min(1),
});
export type Voucher = z.infer<typeof voucherSchema>;

/** GET /vouchers and GET /me/vouchers */
export const voucherListResponseSchema = z.object({ vouchers: z.array(voucherSchema) });
export type VoucherListResponse = z.infer<typeof voucherListResponseSchema>;

/** POST /vouchers/:voucherId/collect */
export const voucherResponseSchema = z.object({ voucher: voucherSchema });
export type VoucherResponse = z.infer<typeof voucherResponseSchema>;

/** Where "Use" takes a customer: the qualifying category or product, else the catalogue. */
export function voucherUsePath(
  voucher: Pick<Voucher, 'scope' | 'categories' | 'products'>,
): string {
  if (voucher.scope === 'categories' && voucher.categories[0]) {
    return `/categories/${voucher.categories[0].slug}`;
  }
  if (voucher.scope === 'products' && voucher.products.length === 1 && voucher.products[0]) {
    return `/products/${voucher.products[0].slug}`;
  }
  return '/products';
}

/** One customer a targeted coupon is meant for, as the admin sees them. */
export const couponRecipientSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});
export type CouponRecipient = z.infer<typeof couponRecipientSchema>;

/** Admin: who and what a coupon or voucher applies to. */
export const couponTargetingInputSchema = z
  .strictObject({
    isVoucher: z.boolean().default(false),
    title: z.string().trim().max(80).nullable().default(null),
    scope: z.enum(COUPON_SCOPES).default('storewide'),
    categoryIds: z.array(z.uuid()).max(50).default([]),
    productIds: z.array(z.uuid()).max(200).default([]),
    audience: z.enum(COUPON_AUDIENCES).default('all'),
    collectLimit: z.number().int().min(1).max(1_000_000).nullable().default(null),
    /** The recipients when `audience` is `selected_customers`; ignored otherwise. */
    customerIds: z.array(z.uuid()).max(COUPON_RECIPIENT_LIMIT).default([]),
  })
  .refine((t) => t.audience !== 'selected_customers' || t.customerIds.length > 0, {
    error: 'Choose at least one customer',
    path: ['customerIds'],
  })
  .refine((t) => t.scope !== 'categories' || t.categoryIds.length > 0, {
    error: 'Choose at least one category',
    path: ['categoryIds'],
  })
  .refine((t) => t.scope !== 'products' || t.productIds.length > 0, {
    error: 'Choose at least one product',
    path: ['productIds'],
  });
export type CouponTargetingInput = z.input<typeof couponTargetingInputSchema>;

export const couponTargetingSchema = z.object({
  isVoucher: z.boolean(),
  title: z.string().nullable(),
  scope: z.enum(COUPON_SCOPES),
  categoryIds: z.array(z.uuid()),
  productIds: z.array(z.uuid()),
  audience: z.enum(COUPON_AUDIENCES),
  collectLimit: z.number().int().nullable(),
  collectionCount: z.number().int().min(0),
  products: z.array(z.object({ id: z.uuid(), name: z.string(), sku: z.string() })),
  /**
   * The chosen customers (audience `selected_customers`). Email and phone are null unless the
   * caller may read customers.
   */
  customers: z.array(couponRecipientSchema).default([]),
});
export type CouponTargeting = z.infer<typeof couponTargetingSchema>;
