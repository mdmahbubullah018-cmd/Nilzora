import { describe, expect, it } from 'vitest';
import { toWishlist } from '../modules/wishlist/store';

/*
 * A saved product is a card like any other, so it carries the same colour preview: the API
 * reads the colours for the whole list in one call and hands them to this builder.
 */

const PRODUCT_ID = '0a000000-0000-4000-8000-000000000001';

function savedProduct() {
  return {
    productId: PRODUCT_ID,
    savedAt: '2026-11-20T10:00:00Z',
    product: {
      id: PRODUCT_ID,
      slug: 'premium-panjabi',
      sku: 'NZ-1',
      name: 'Premium panjabi',
      summary: null,
      priceMinor: '102000',
      compareAtPriceMinor: null,
      stockQuantity: 8,
      maxOrderQuantity: 4,
      isFeatured: false,
      publishedAt: '2026-11-01T00:00:00Z',
      categorySlug: 'fashion',
      categoryName: 'Fashion',
      brandSlug: null,
      brandName: null,
      image: null,
    },
  };
}

describe('wishlist colour preview', () => {
  it('builds the list exactly as before when no colours were read', () => {
    const list = toWishlist([savedProduct()], undefined);

    expect(list.items[0]?.product?.colors).toBeUndefined();
    expect(list.items[0]?.product?.name).toBe('Premium panjabi');
  });

  it('adds the colours the card shows, and only for the products that have them', () => {
    const colors = new Map([
      [
        PRODUCT_ID,
        [
          { valueSlug: 'black', value: 'Black', swatchHex: '#0F172A' },
          { valueSlug: 'white', value: 'White', swatchHex: '#F1F5F9' },
        ],
      ],
    ]);

    const list = toWishlist([savedProduct()], undefined, colors);

    expect(list.items[0]?.product?.colors).toStrictEqual([
      { valueSlug: 'black', value: 'Black', swatchHex: '#0F172A' },
      { valueSlug: 'white', value: 'White', swatchHex: '#F1F5F9' },
    ]);
  });
});
