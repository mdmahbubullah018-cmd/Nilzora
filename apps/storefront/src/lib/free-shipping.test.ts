import { afterEach, describe, expect, it, vi } from 'vitest';
import { listing, summary } from '@/testing/catalog-fixtures';
import {
  FREE_SHIPPING_CLAIM_MINOR,
  freeDeliveryPolicy,
  freeShippingDetail,
  isQualifyingProduct,
  policyCoversClaim,
  showFreeShippingClaim,
  type FreeDeliveryPolicy,
} from './free-shipping';

const catalog = vi.hoisted(() => ({ listProducts: vi.fn() }));
vi.mock('@/lib/catalog', () => catalog);

afterEach(() => {
  vi.clearAllMocks();
});

/** A waiver that would make the claim true: ৳1,999+ orders free, in every zone. */
const waiver: FreeDeliveryPolicy = { minSubtotalMinor: FREE_SHIPPING_CLAIM_MINOR, allZones: true };

const premium = summary({ name: 'Leather bag', priceMinor: 249_900 });
const exactly = summary({ name: 'Watch', priceMinor: 199_900 });
const cheap = summary({ name: 'Socks', priceMinor: 19_900 });
const premiumSoldOut = summary({
  name: 'Sold-out jacket',
  priceMinor: 349_900,
  availability: 'out_of_stock',
  maxOrderQuantity: 0,
});

function catalogWith(...items: ReturnType<typeof summary>[]) {
  catalog.listProducts.mockResolvedValue({ kind: 'ok', value: listing(items) });
}

describe('freeDeliveryPolicy', () => {
  it('reports no policy, because checkout always charges the zone delivery fee today', () => {
    expect(freeDeliveryPolicy()).toBeNull();
  });
});

describe('showFreeShippingClaim', () => {
  it('stays hidden when checkout does not waive delivery, even with ৳1,999+ products on sale', async () => {
    catalogWith(premium, exactly);

    await expect(showFreeShippingClaim(null)).resolves.toBe(false);
    await expect(showFreeShippingClaim(freeDeliveryPolicy())).resolves.toBe(false);
    // Without a waiver the catalog is not even read.
    expect(catalog.listProducts).not.toHaveBeenCalled();
  });

  it('appears when checkout waives delivery and a purchasable ৳1,999+ product exists', async () => {
    catalogWith(premium, cheap);

    await expect(showFreeShippingClaim(waiver)).resolves.toBe(true);
    expect(catalog.listProducts).toHaveBeenCalledWith({
      sort: 'price_desc',
      page: 1,
      pageSize: 24,
    });
  });

  it('counts a product priced exactly at ৳1,999', async () => {
    catalogWith(exactly, cheap);
    await expect(showFreeShippingClaim(waiver)).resolves.toBe(true);
  });

  it('stays hidden when no published product reaches ৳1,999', async () => {
    catalogWith(cheap, summary({ priceMinor: 199_899 }));
    await expect(showFreeShippingClaim(waiver)).resolves.toBe(false);
  });

  it('stays hidden when the only ৳1,999+ products cannot be bought', async () => {
    catalogWith(premiumSoldOut, cheap);
    await expect(showFreeShippingClaim(waiver)).resolves.toBe(false);
  });

  it('stays hidden when the catalog cannot be read', async () => {
    catalog.listProducts.mockResolvedValue({ kind: 'unavailable' });
    await expect(showFreeShippingClaim(waiver)).resolves.toBe(false);
  });

  it('stays hidden when the waiver starts above ৳1,999 or skips a delivery zone', async () => {
    catalogWith(premium);

    await expect(
      showFreeShippingClaim({ minSubtotalMinor: 250_000, allZones: true }),
    ).resolves.toBe(false);
    await expect(
      showFreeShippingClaim({ minSubtotalMinor: FREE_SHIPPING_CLAIM_MINOR, allZones: false }),
    ).resolves.toBe(false);
    expect(catalog.listProducts).not.toHaveBeenCalled();
  });
});

describe('claim rules', () => {
  it('accepts a waiver at or below the advertised threshold, in every zone', () => {
    expect(policyCoversClaim(waiver)).toBe(true);
    expect(policyCoversClaim({ minSubtotalMinor: 150_000, allZones: true })).toBe(true);
    expect(policyCoversClaim({ minSubtotalMinor: 199_901, allZones: true })).toBe(false);
    expect(policyCoversClaim({ minSubtotalMinor: -1, allZones: true })).toBe(false);
    expect(policyCoversClaim(null)).toBe(false);
  });

  it('qualifies only purchasable products at or above the threshold', () => {
    expect(isQualifyingProduct(premium)).toBe(true);
    expect(isQualifyingProduct(summary({ priceMinor: 199_900, availability: 'low_stock' }))).toBe(
      true,
    );
    expect(isQualifyingProduct(cheap)).toBe(false);
    expect(isQualifyingProduct(premiumSoldOut)).toBe(false);
    expect(isQualifyingProduct(summary({ priceMinor: 299_900, maxOrderQuantity: 0 }))).toBe(false);
  });

  it('words the claim from the same threshold', () => {
    expect(freeShippingDetail()).toBe('On orders ৳1,999+');
  });
});
