import { describe, expect, it } from 'vitest';
import { checkoutQuoteRequestSchema, checkoutQuoteSchema } from './cart';
import {
  COUPON_KINDS,
  couponCodeSchema,
  couponSaveRequestSchema,
  optionalCouponCodeSchema,
} from './coupons';
import { placeOrderRequestSchema } from './orders';
import { voucherSchema } from './vouchers';
import {
  COUPON_AUDIENCES,
  COUPON_RECIPIENT_LIMIT,
  couponTargetingInputSchema,
} from './vouchers';

/*
 * Coupon contracts. The database is the authority on whether a coupon applies; these
 * tests cover what a client may send and what shape comes back.
 */

const PRODUCT = '00000000-0000-4000-8000-000000000001';
const ADDRESS = '00000000-0000-4000-8000-000000000002';

const baseCoupon = {
  code: 'SAVE10',
  kind: 'percent' as const,
  value: 10,
};

describe('couponCodeSchema', () => {
  it('upper-cases a code and refuses impossible ones', () => {
    expect(couponCodeSchema.parse('save10')).toBe('SAVE10');
    expect(couponCodeSchema.parse('  Eid-2026 ')).toBe('EID-2026');
    for (const bad of ['ab', '', 'has space', 'dollar$', '-leading', 'x'.repeat(33)]) {
      expect(couponCodeSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('optionalCouponCodeSchema', () => {
  it('treats an empty field as no coupon', () => {
    expect(optionalCouponCodeSchema.parse('')).toBeUndefined();
    expect(optionalCouponCodeSchema.parse(undefined)).toBeUndefined();
    expect(optionalCouponCodeSchema.parse('save10')).toBe('SAVE10');
  });
});

describe('couponSaveRequestSchema', () => {
  it('fills in safe defaults', () => {
    const parsed = couponSaveRequestSchema.parse(baseCoupon);
    expect(parsed).toEqual({
      code: 'SAVE10',
      kind: 'percent',
      value: 10,
      minOrderMinor: 0,
      maxDiscountMinor: null,
      startsAt: null,
      endsAt: null,
      totalLimit: null,
      perCustomerLimit: 1,
      isActive: true,
    });
  });

  it('accepts a capped percentage and a plain fixed amount', () => {
    expect(
      couponSaveRequestSchema.safeParse({ ...baseCoupon, maxDiscountMinor: 50_000 }).success,
    ).toBe(true);
    expect(
      couponSaveRequestSchema.safeParse({ code: 'FLAT100', kind: 'fixed', value: 10_000 }).success,
    ).toBe(true);
  });

  it('refuses rules the database would refuse too', () => {
    // A percentage above 100 has no meaning.
    expect(couponSaveRequestSchema.safeParse({ ...baseCoupon, value: 101 }).success).toBe(false);
    // A cap on a fixed amount is contradictory.
    expect(
      couponSaveRequestSchema.safeParse({
        code: 'FLAT100',
        kind: 'fixed',
        value: 10_000,
        maxDiscountMinor: 5_000,
      }).success,
    ).toBe(false);
    // The window must move forward.
    expect(
      couponSaveRequestSchema.safeParse({
        ...baseCoupon,
        startsAt: '2026-12-01T00:00:00.000Z',
        endsAt: '2026-11-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
    // Zero-value and negative limits are meaningless.
    expect(couponSaveRequestSchema.safeParse({ ...baseCoupon, value: 0 }).success).toBe(false);
    expect(couponSaveRequestSchema.safeParse({ ...baseCoupon, perCustomerLimit: 0 }).success).toBe(
      false,
    );
  });

  it('refuses unknown fields rather than silently dropping them', () => {
    expect(couponSaveRequestSchema.safeParse({ ...baseCoupon, discountMinor: 1 }).success).toBe(
      false,
    );
  });
});

describe('checkout and order requests carry only the code', () => {
  const items = [{ productId: PRODUCT, quantity: 2 }];

  it('accepts a coupon code on the checkout quote', () => {
    const parsed = checkoutQuoteRequestSchema.parse({
      items,
      addressId: ADDRESS,
      couponCode: 'save10',
    });
    expect(parsed.couponCode).toBe('SAVE10');
    // Any short code is sent through: the database answers "not valid" in
    // couponProblem, which reads better than a form rejection for a typo.
    expect(
      checkoutQuoteRequestSchema.parse({ items, addressId: ADDRESS, couponCode: 'eid' }).couponCode,
    ).toBe('EID');
  });

  it('accepts an optional coupon code when placing the order, never an amount', () => {
    const parsed = placeOrderRequestSchema.parse({
      idempotencyKey: '00000000-0000-4000-8000-000000000003',
      addressId: ADDRESS,
      items,
      expectedTotalMinor: 245_000,
      couponCode: 'save10',
    });
    expect(parsed.couponCode).toBe('SAVE10');
    expect(
      placeOrderRequestSchema.safeParse({
        idempotencyKey: '00000000-0000-4000-8000-000000000003',
        addressId: ADDRESS,
        items,
        expectedTotalMinor: 245_000,
        discountMinor: 10_000,
      }).success,
    ).toBe(false);
  });
});

describe('checkoutQuoteSchema', () => {
  it('always reports a discount, defaulting an empty one', () => {
    const parsed = checkoutQuoteSchema.parse({
      lines: [],
      itemCount: 0,
      subtotalMinor: 0,
      deliveryZone: null,
      shippingFeeMinor: null,
      totalMinor: null,
      purchasable: false,
    });
    expect(parsed.discountMinor).toBe(0);
    expect(parsed.coupon).toBeNull();
    expect(parsed.couponProblem).toBeNull();
  });

  it('carries the applied coupon and the discount the database calculated', () => {
    const parsed = checkoutQuoteSchema.parse({
      lines: [],
      itemCount: 1,
      subtotalMinor: 100_000,
      deliveryZone: 'inside_dhaka',
      shippingFeeMinor: 6_000,
      totalMinor: 96_000,
      discountMinor: 10_000,
      coupon: { code: 'SAVE10', kind: 'percent', value: 10, maxDiscountMinor: null, description: null },
      couponProblem: null,
      purchasable: true,
    });
    expect(parsed.discountMinor).toBe(10_000);
    expect(parsed.coupon?.code).toBe('SAVE10');
  });
});

describe('coupons for chosen customers', () => {
  const customer = '3f1c9c5e-9a52-4a52-8f0a-2a3a6f0e5555';

  it('needs at least one named customer', () => {
    const empty = couponTargetingInputSchema.safeParse({ audience: 'selected_customers' });
    expect(empty.success).toBe(false);
    const named = couponTargetingInputSchema.parse({
      audience: 'selected_customers',
      customerIds: [customer],
    });
    expect(named.customerIds).toEqual([customer]);
  });

  it('refuses names that are not accounts and lists that are too long', () => {
    expect(
      couponTargetingInputSchema.safeParse({
        audience: 'selected_customers',
        customerIds: ['rahima'],
      }).success,
    ).toBe(false);
    const tooMany = Array.from({ length: COUPON_RECIPIENT_LIMIT + 1 }, () => customer);
    expect(
      couponTargetingInputSchema.safeParse({ audience: 'selected_customers', customerIds: tooMany })
        .success,
    ).toBe(false);
  });

  it('keeps the other audiences as they were', () => {
    expect(COUPON_AUDIENCES).toEqual(['all', 'new_customers', 'returning_customers', 'selected_customers']);
    expect(couponTargetingInputSchema.parse({}).customerIds).toEqual([]);
  });
});

describe('free delivery coupons', () => {
  it('is its own kind, valued 1, and carries no cap', () => {
    expect(COUPON_KINDS).toContain('free_delivery');
    expect(
      couponSaveRequestSchema.safeParse({ code: 'FREESHIP', kind: 'free_delivery', value: 1 }).success,
    ).toBe(true);
    // Like a fixed amount, it has nothing to cap.
    expect(
      couponSaveRequestSchema.safeParse({
        code: 'FREESHIP',
        kind: 'free_delivery',
        value: 1,
        maxDiscountMinor: 5_000,
      }).success,
    ).toBe(false);
  });

  it('is accepted in a collectable voucher and in a checkout quote', () => {
    expect(
      voucherSchema.shape.kind.safeParse('free_delivery').success,
    ).toBe(true);
  });
});
