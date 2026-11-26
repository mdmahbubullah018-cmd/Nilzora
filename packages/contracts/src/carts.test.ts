import { describe, expect, it } from 'vitest';
import {
  adminCheckoutListQuerySchema,
  cartSetItemRequestSchema,
  checkoutDetailSchema,
  checkoutStartRequestSchema,
  guestCartRequestSchema,
  guestCartSetItemRequestSchema,
  mergeGuestCartRequestSchema,
} from './carts';

const PRODUCT = '0d000000-0000-4000-8000-000000000001';
const VARIANT = 'ee000000-0000-4000-8000-000000000001';
const TOKEN = '9f000000-0000-4000-8000-000000000001';

describe('cartSetItemRequestSchema', () => {
  it('accepts a simple product line and a variant line', () => {
    expect(cartSetItemRequestSchema.parse({ productId: PRODUCT, quantity: 2 })).toEqual({
      productId: PRODUCT,
      variantId: null,
      quantity: 2,
    });
    expect(
      cartSetItemRequestSchema.parse({ productId: PRODUCT, variantId: VARIANT, quantity: 1 })
        .variantId,
    ).toBe(VARIANT);
  });

  it('treats zero as a removal and refuses anything past the line limit', () => {
    expect(cartSetItemRequestSchema.parse({ productId: PRODUCT, quantity: 0 }).quantity).toBe(0);
    for (const quantity of [-1, 101, 1.5]) {
      expect(() => cartSetItemRequestSchema.parse({ productId: PRODUCT, quantity })).toThrow();
    }
  });

  it('refuses a client-supplied price, so the server alone prices a line', () => {
    expect(() =>
      cartSetItemRequestSchema.parse({ productId: PRODUCT, quantity: 1, unitPriceMinor: 1 }),
    ).toThrow();
  });
});

describe('mergeGuestCartRequestSchema', () => {
  it('needs a guest handle and nothing else', () => {
    expect(mergeGuestCartRequestSchema.parse({ token: TOKEN }).token).toBe(TOKEN);
    expect(() => mergeGuestCartRequestSchema.parse({})).toThrow();
    expect(() => mergeGuestCartRequestSchema.parse({ token: 'not-a-handle' })).toThrow();
  });
});

describe('checkoutStartRequestSchema', () => {
  it('allows an attempt without an address or coupon yet', () => {
    expect(checkoutStartRequestSchema.parse({})).toEqual({});
  });

  it('keeps the coupon as text for the order function to judge', () => {
    expect(
      checkoutStartRequestSchema.parse({ addressId: PRODUCT, couponCode: 'EID25' }).couponCode,
    ).toBe('EID25');
    expect(() => checkoutStartRequestSchema.parse({ couponCode: '' })).toThrow();
  });
});

describe('adminCheckoutListQuerySchema', () => {
  it('defaults to every status on the first page', () => {
    expect(adminCheckoutListQuerySchema.parse({})).toEqual({
      status: 'all',
      q: '',
      from: '',
      to: '',
      sort: 'recent',
      page: 1,
      pageSize: 25,
    });
  });

  it('accepts only the three sorts the queue can answer', () => {
    for (const sort of ['recent', 'started', 'value']) {
      expect(adminCheckoutListQuerySchema.parse({ sort }).sort).toBe(sort);
    }
    expect(() => adminCheckoutListQuerySchema.parse({ sort: 'customer' })).toThrow();
  });

  it('accepts only the four lifecycle states', () => {
    for (const status of ['started', 'incomplete', 'converted', 'expired', 'all']) {
      expect(adminCheckoutListQuerySchema.parse({ status }).status).toBe(status);
    }
    expect(() => adminCheckoutListQuerySchema.parse({ status: 'abandoned' })).toThrow();
  });
});

describe('checkoutDetailSchema', () => {
  it('reads an attempt with variant-labelled items', () => {
    const detail = checkoutDetailSchema.parse({
      id: TOKEN,
      status: 'incomplete',
      customerName: 'Rahim Uddin',
      itemCount: 2,
      couponCode: null,
      startedAt: '2026-11-01T10:00:00.000Z',
      lastActivityAt: '2026-11-01T10:05:00.000Z',
      orderNumber: null,
      items: [
        {
          productName: 'Cotton shirt',
          variantLabel: 'Colour: Red',
          sku: 'SHIRT-RED',
          quantity: 2,
          unitPriceMinor: 125_000,
        },
      ],
    });
    expect(detail.items[0]?.variantLabel).toBe('Colour: Red');
    expect(detail.convertedAt).toBeNull();
  });

  it('refuses a summary without its lifecycle status', () => {
    expect(() =>
      checkoutDetailSchema.parse({
        id: TOKEN,
        itemCount: 1,
        startedAt: '2026-11-01T10:00:00.000Z',
        lastActivityAt: '2026-11-01T10:05:00.000Z',
        items: [],
      }),
    ).toThrow();
  });
});
describe('guestCartSetItemRequestSchema', () => {
  it('accepts a guest line and defaults the variant to null', () => {
    const parsed = guestCartSetItemRequestSchema.parse({
      token: TOKEN,
      productId: PRODUCT,
      quantity: 2,
    });
    expect(parsed.variantId).toBeNull();
  });

  it('accepts quantity 0, which removes the line', () => {
    const parsed = guestCartSetItemRequestSchema.parse({
      token: TOKEN,
      productId: PRODUCT,
      variantId: VARIANT,
      quantity: 0,
    });
    expect(parsed.quantity).toBe(0);
  });

  it('requires the guest handle, so one cart is never addressed without it', () => {
    expect(() =>
      guestCartSetItemRequestSchema.parse({ productId: PRODUCT, quantity: 1 }),
    ).toThrow();
  });

  it('refuses unknown keys instead of silently dropping them', () => {
    expect(() =>
      guestCartSetItemRequestSchema.parse({
        token: TOKEN,
        productId: PRODUCT,
        quantity: 1,
        priceMinor: 1,
      }),
    ).toThrow();
  });
});

describe('guestCartRequestSchema', () => {
  it('is the merge shape, so a clear never needs a second token field', () => {
    expect(guestCartRequestSchema.parse({ token: TOKEN })).toEqual(
      mergeGuestCartRequestSchema.parse({ token: TOKEN }),
    );
  });
});
