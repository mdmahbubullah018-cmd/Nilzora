import { describe, expect, it } from 'vitest';
import { cartQuoteSchema, checkoutQuoteSchema } from './cart';
import { appliedCampaignSchema, productCampaignSchema } from './discounts';

/*
 * The exact shape quote_cart returns for a line priced by a live campaign (captured from the
 * database): PostgreSQL serialises `endsAt` with a "+00:00" offset, and the line's campaign
 * carries only id, title, endsAt and couponPolicy — the discount itself is on the line.
 * When the cart's campaign schema extended the product label's (which requires
 * discountKind/discountValue and a "Z" timestamp), every such cart failed validation and the
 * API answered 503 to both the cart and the checkout quote.
 */

const CAMPAIGN = {
  id: 'adf433ee-9f66-4e2a-9079-38983bcc72fd',
  title: 'Winter Collections 2026',
  endsAt: '2026-11-20T17:22:00+00:00',
  couponPolicy: 'stackable',
} as const;

function line(overrides: Record<string, unknown> = {}) {
  return {
    sku: null,
    name: 'Casual T Shirt',
    slug: 'casual-t-shirt',
    problem: null,
    campaign: CAMPAIGN,
    quantity: 2,
    productId: 'e61f0026-f136-45e6-94c2-bda2245edfbe',
    variantId: '216cc3c9-332f-4325-a3bd-4588c121090e',
    variantLabel: 'Size: M',
    lineTotalMinor: 110_000,
    listPriceMinor: 65_000,
    unitPriceMinor: 55_000,
    availableQuantity: 10,
    compareAtPriceMinor: 65_000,
    campaignDiscountMinor: 10_000,
    ...overrides,
  };
}

const QUOTE = {
  lines: [line(), line({ variantId: null, variantLabel: null, campaign: null, quantity: 1 })],
  itemCount: 3,
  totalMinor: 165_000,
  purchasable: true,
  deliveryZone: null,
  subtotalMinor: 165_000,
  shippingFeeMinor: null,
  campaignDiscountMinor: 20_000,
};

describe('cart quote from the database', () => {
  it('accepts a line priced by a live campaign, exactly as quote_cart builds it', () => {
    const parsed = cartQuoteSchema.safeParse(QUOTE);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.lines[0]?.campaign).toEqual(CAMPAIGN);
    expect(parsed.data?.lines[1]?.campaign).toBeNull();
  });

  it('accepts the same lines in a checkout quote', () => {
    const parsed = checkoutQuoteSchema.safeParse({
      ...QUOTE,
      discountMinor: 0,
      coupon: null,
      couponProblem: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a campaign end written with Z or with an offset, and an open-ended one', () => {
    for (const endsAt of ['2026-11-20T17:22:00Z', '2026-11-20T17:22:00.000+06:00', null]) {
      expect(appliedCampaignSchema.safeParse({ ...CAMPAIGN, endsAt }).success).toBe(true);
    }
  });

  it('still refuses a malformed campaign on a line', () => {
    expect(appliedCampaignSchema.safeParse({ ...CAMPAIGN, id: 'not-a-uuid' }).success).toBe(false);
    expect(appliedCampaignSchema.safeParse({ ...CAMPAIGN, endsAt: 'next week' }).success).toBe(
      false,
    );
    expect(appliedCampaignSchema.safeParse({ ...CAMPAIGN, couponPolicy: 'anything' }).success).toBe(
      false,
    );
  });

  it('keeps the product label strict: it still needs the discount it describes', () => {
    expect(productCampaignSchema.safeParse(CAMPAIGN).success).toBe(false);
  });
});
