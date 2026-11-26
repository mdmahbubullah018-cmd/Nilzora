import { z } from 'zod';
import { couponTargetingInputSchema, couponTargetingSchema } from './vouchers';
import { adminPageQueryShape, pageInfoShape } from './admin-common';
import { moneyMinorSchema } from './catalog';

/*
 * Coupons
 * -------
 * A coupon is a code the store issues to reduce an order. Every amount here is in
 * poisha (integer minor units); the discount itself is only ever calculated by the
 * database inside the order transaction, so these schemas describe what an admin
 * enters and what the API returns — never a discount a client may assert.
 */

export const COUPON_KINDS = ['percent', 'fixed', 'free_delivery'] as const;
export type CouponKind = (typeof COUPON_KINDS)[number];

/** Where a coupon stands right now, as the database reports it. */
export const COUPON_STATES = ['active', 'scheduled', 'expired', 'inactive', 'exhausted'] as const;
export type CouponState = (typeof COUPON_STATES)[number];

/**
 * A code shoppers type. Stored upper-case; 3-32 letters, digits, dashes or
 * underscores, so a code is safe in a URL and never confused with a word.
 */
export const couponCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/, {
    error: 'Use 3-32 letters, digits, dashes or underscores',
  })
  .transform((value) => value.toUpperCase());

/** The `?coupon=` form value: the same code, but empty means "no coupon". */
export const optionalCouponCodeSchema = z
  .string()
  .trim()
  .max(32)
  .transform((value) => (value === '' ? undefined : value.toUpperCase()))
  .optional();

/** One coupon as the admin lists it, with its usage figures. */
export const adminCouponSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  description: z.string().nullable(),
  kind: z.enum(COUPON_KINDS),
  /** Percentage (1-100) for `percent`, poisha for `fixed`; always 1 for `free_delivery`, which waives the delivery fee. */
  value: z.number().int().min(1),
  minOrderMinor: moneyMinorSchema,
  maxDiscountMinor: moneyMinorSchema.nullable(),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  /** Null means unlimited redemptions. */
  totalLimit: z.number().int().min(1).nullable(),
  perCustomerLimit: z.number().int().min(1),
  isActive: z.boolean(),
  state: z.enum(COUPON_STATES),
  redemptionCount: z.number().int().min(0),
  totalDiscountMinor: moneyMinorSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Voucher, scope and audience settings; present on the single-coupon answer. */
  targeting: couponTargetingSchema.optional(),
});

/** GET /admin/coupons */
export const adminCouponListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  state: z.enum(['all', ...COUPON_STATES]).default('all'),
  ...adminPageQueryShape,
});

export const adminCouponListResponseSchema = z.object({
  coupons: z.array(adminCouponSchema),
  ...pageInfoShape,
});

/** GET /admin/coupons/:couponId */
export const adminCouponResponseSchema = z.object({ coupon: adminCouponSchema });

/**
 * POST /admin/coupons and PUT /admin/coupons/:couponId.
 *
 * The rules mirror the database's own checks: a percentage is 1-100 and may carry a
 * cap; a fixed amount has no cap; the window must move forward in time.
 */
export const couponSaveRequestSchema = z
  .strictObject({
    code: couponCodeSchema,
    description: z
      .string()
      .trim()
      .max(200, { error: 'Keep the description under 200 characters' })
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .optional(),
    kind: z.enum(COUPON_KINDS),
    value: z.number().int().min(1).max(10_000_000),
    minOrderMinor: moneyMinorSchema.default(0),
    maxDiscountMinor: moneyMinorSchema.nullable().default(null),
    startsAt: z.iso.datetime().nullable().default(null),
    endsAt: z.iso.datetime().nullable().default(null),
    totalLimit: z.number().int().min(1).max(1_000_000).nullable().default(null),
    perCustomerLimit: z.number().int().min(1).max(1000).default(1),
    isActive: z.boolean().default(true),
    /** Voucher, scope and audience settings; left out, a new coupon is a storewide code for everyone. */
    targeting: couponTargetingInputSchema.optional(),
  })
  .refine((coupon) => coupon.kind !== 'percent' || coupon.value <= 100, {
    error: 'A percentage cannot exceed 100',
    path: ['value'],
  })
  .refine((coupon) => coupon.kind === 'percent' || coupon.maxDiscountMinor === null, {
    error: 'A fixed discount needs no cap',
    path: ['maxDiscountMinor'],
  })
  .refine((coupon) => !coupon.startsAt || !coupon.endsAt || coupon.endsAt > coupon.startsAt, {
    error: 'The end must be after the start',
    path: ['endsAt'],
  });

/** PATCH /admin/coupons/:couponId/active */
export const couponActiveRequestSchema = z.strictObject({ isActive: z.boolean() });

/** GET /admin/coupons/:couponId/redemptions */
export const couponRedemptionQuerySchema = z.object({
  ...adminPageQueryShape,
});

export const couponRedemptionSchema = z.object({
  id: z.number().int().min(1),
  orderNumber: z.string(),
  discountMinor: moneyMinorSchema,
  redeemedAt: z.iso.datetime(),
  customerId: z.uuid(),
  customerName: z.string().nullable(),
  customerEmail: z.string().nullable(),
});

export const couponRedemptionListResponseSchema = z.object({
  redemptions: z.array(couponRedemptionSchema),
  ...pageInfoShape,
});

/*
 * What a coupon added to a checkout quote (POST /checkout/quote?coupon=CODE). An
 * unusable code never fails the quote: `couponProblem` explains it and the totals are
 * the undiscounted ones, so a cart keeps working while the shopper fixes the code.
 */
export const appliedCouponSchema = z.object({
  code: z.string(),
  kind: z.enum(COUPON_KINDS),
  value: z.number().int().min(1),
  maxDiscountMinor: moneyMinorSchema.nullable(),
  description: z.string().nullable(),
  /** True when the code belongs to a collected voucher. Absent from older answers. */
  isVoucher: z.boolean().optional(),
  /** The voucher's title, when it has one. */
  title: z.string().nullable().optional(),
});

export type AdminCoupon = z.infer<typeof adminCouponSchema>;
export type AdminCouponListQuery = z.input<typeof adminCouponListQuerySchema>;
export type AdminCouponListResponse = z.infer<typeof adminCouponListResponseSchema>;
export type AdminCouponResponse = z.infer<typeof adminCouponResponseSchema>;
export type CouponSaveRequest = z.input<typeof couponSaveRequestSchema>;
export type CouponActiveRequest = z.input<typeof couponActiveRequestSchema>;
export type CouponRedemption = z.infer<typeof couponRedemptionSchema>;
export type CouponRedemptionListResponse = z.infer<typeof couponRedemptionListResponseSchema>;
export type AppliedCoupon = z.infer<typeof appliedCouponSchema>;
