import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  createProductRequestSchema,
  mediaAssetSchema,
  mediaKeySchema,
  mediaListQuerySchema,
  mediaUploadQuerySchema,
  productDetailSchema,
  productTagsSchema,
  sizeChartInputSchema,
  slugAvailabilityQuerySchema,
  slugAvailabilityResponseSchema,
  updateMediaRequestSchema,
  updateProductRequestSchema,
} from './index';

const CATEGORY = 'ca000000-0000-4000-8000-000000000001';
const ID = '0f000000-0000-4000-8000-000000000001';

describe('slug availability', () => {
  it('accepts the three kinds and checks the slug as typed', () => {
    expect(slugAvailabilityQuerySchema.parse({ kind: 'brand', slug: 'Desk Lamp' })).toEqual({
      kind: 'brand',
      slug: 'Desk Lamp',
    });
    expect(slugAvailabilityQuerySchema.safeParse({ kind: 'page', slug: 'x' }).success).toBe(false);
    expect(slugAvailabilityQuerySchema.safeParse({ kind: 'product', slug: '' }).success).toBe(
      false,
    );
    expect(
      slugAvailabilityQuerySchema.safeParse({ kind: 'product', slug: 'x', excludeId: 'me' })
        .success,
    ).toBe(false);
  });

  it('is available exactly when no reason is given', () => {
    expect(
      slugAvailabilityResponseSchema.safeParse({ available: true, reason: null, suggestion: null })
        .success,
    ).toBe(true);
    expect(
      slugAvailabilityResponseSchema.safeParse({
        available: false,
        reason: 'reserved',
        suggestion: 'shop-2',
      }).success,
    ).toBe(true);
    expect(
      slugAvailabilityResponseSchema.safeParse({
        available: true,
        reason: 'taken',
        suggestion: null,
      }).success,
    ).toBe(false);
    expect(
      slugAvailabilityResponseSchema.safeParse({
        available: false,
        reason: 'taken',
        suggestion: 'Not A Slug',
      }).success,
    ).toBe(false);
  });
});

describe('media library', () => {
  it('keeps only a label from the browser file name', () => {
    expect(mediaUploadQuerySchema.parse({ name: 'C:\\fakepath\\front<1>.jpg' }).name).toBe(
      'front 1 .jpg',
    );
    expect(mediaUploadQuerySchema.parse({ name: '../../etc/passwd' }).name).toBe('passwd');
    expect(mediaUploadQuerySchema.parse({ name: 'ছবি ১.png' }).name).toBe('ছবি ১.png');
    expect(mediaUploadQuerySchema.parse({ name: '\u0000\u0007' }).name).toBeUndefined();
    expect(mediaUploadQuerySchema.parse({ name: `${'a'.repeat(300)}.jpg` }).name).toHaveLength(200);
  });

  it('limits the description to 250 characters', () => {
    expect(mediaUploadQuerySchema.safeParse({ alt: 'x'.repeat(250) }).success).toBe(true);
    expect(mediaUploadQuerySchema.safeParse({ alt: 'x'.repeat(251) }).success).toBe(false);
    expect(updateMediaRequestSchema.parse({ alt: '  Till  ' })).toEqual({ alt: 'Till' });
    expect(updateMediaRequestSchema.safeParse({ alt: 'x', key: 'library/x' }).success).toBe(false);
  });

  it('pages the library like other admin lists', () => {
    expect(mediaListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(mediaListQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
  });

  it('describes an asset by its library key', () => {
    const asset = {
      id: ID,
      key: `library/${ID}`,
      url: `https://media.example.com/library/${ID}/full.webp`,
      thumbUrl: `https://media.example.com/library/${ID}/thumb.webp`,
      contentType: 'image/webp',
      width: 1600,
      height: 1200,
      bytes: 1,
      alt: null,
      originalName: null,
      uploadedBy: null,
      createdAt: '2026-11-02T10:00:00.000Z',
    };
    expect(mediaAssetSchema.safeParse(asset).success).toBe(true);
    expect(mediaAssetSchema.safeParse({ ...asset, key: `products/${ID}` }).success).toBe(false);
  });

  it('lets image fields store library keys, but nothing that could leave the folder', () => {
    expect(mediaKeySchema.safeParse(`library/${ID}`).success).toBe(true);
    expect(mediaKeySchema.safeParse('library/../secret').success).toBe(false);
    expect(mediaKeySchema.safeParse(`avatars/${ID}/${ID}`).success).toBe(false);
  });

  it('names the in-use refusals', () => {
    expect(API_ERROR_CODES).toContain('in_use');
    expect(API_ERROR_CODES).toContain('brand_in_use');
  });
});

describe('product tags and size charts', () => {
  const product = {
    categoryId: CATEGORY,
    slug: 'linen-shirt',
    sku: 'linen-shirt',
    name: 'Linen shirt',
    priceMinor: 45_000,
  };

  it('normalises tags: trimmed, lower-cased, single spaces, no repeats', () => {
    expect(productTagsSchema.parse(['  Summer   Sale ', 'summer sale', 'EID-2026'])).toEqual([
      'summer sale',
      'eid-2026',
    ]);
  });

  it('allows 15 distinct tags, and repeats do not count', () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => `tag ${String(i)}`);
    expect(productTagsSchema.safeParse(fifteen).success).toBe(true);
    expect(productTagsSchema.safeParse([...fifteen, 'TAG 0']).success).toBe(true);
    expect(productTagsSchema.safeParse([...fifteen, 'tag 15']).success).toBe(false);
  });

  it.each(['half_price', '-sale', 'sale-', 'x'.repeat(31), '   ', 'ঈদ'])(
    'refuses the tag %s',
    (tag) => {
      expect(productTagsSchema.safeParse([tag]).success).toBe(false);
    },
  );

  it('checks the size chart shape', () => {
    const chart = { columns: ['Size', 'Chest'], rows: [['M', '96']] };
    expect(sizeChartInputSchema.safeParse(chart).success).toBe(true);
    expect(sizeChartInputSchema.safeParse({ ...chart, rows: [['M']] }).success).toBe(false);
    expect(sizeChartInputSchema.safeParse({ columns: [], rows: [[]] }).success).toBe(false);
    expect(sizeChartInputSchema.safeParse({ columns: ['Size'], rows: [] }).success).toBe(false);
    expect(
      sizeChartInputSchema.safeParse({ columns: ['Size'], rows: [['x'.repeat(41)]] }).success,
    ).toBe(false);
    // A chart may say what its measurements are in; anything but cm, in or mm is refused.
    expect(sizeChartInputSchema.safeParse({ ...chart, unit: 'cm' }).success).toBe(true);
    expect(sizeChartInputSchema.safeParse({ ...chart, unit: 'in' }).success).toBe(true);
    expect(sizeChartInputSchema.safeParse({ ...chart, unit: 'ft' }).success).toBe(false);
    expect(sizeChartInputSchema.safeParse({ ...chart, colour: 'red' }).success).toBe(false);
  });

  it('accepts a picture instead of a table, and only a whole picture chart', () => {
    const picture = { columns: [], rows: [], mode: 'image', imageKey: 'library/abc-123' };
    expect(sizeChartInputSchema.safeParse(picture).success).toBe(true);
    // A picture chart needs its picture, takes no table, and the key must be a library key.
    expect(sizeChartInputSchema.safeParse({ ...picture, imageKey: undefined }).success).toBe(false);
    expect(
      sizeChartInputSchema.safeParse({ ...picture, columns: ['Size'], rows: [['M']] }).success,
    ).toBe(false);
    expect(sizeChartInputSchema.safeParse({ ...picture, imageKey: 'https://x.test/a.png' }).success).toBe(false);
    // A table chart cannot carry a picture.
    expect(
      sizeChartInputSchema.safeParse({ columns: ['Size'], rows: [['M']], imageKey: 'library/abc' }).success,
    ).toBe(false);
  });

  it('numeric, shoe and custom sizes are just entries: nothing assumes S, M, L, XL', () => {
    for (const sizes of [['28', '30', '32'], ['38', '39', '40', '41', '42', '43'], ['One Size'], ['Free']]) {
      const chart = {
        columns: ['Size', 'Length'],
        rows: sizes.map((size) => [size, '25']),
        unit: 'cm',
      };
      expect(sizeChartInputSchema.safeParse(chart).success).toBe(true);
    }
  });

  it('keeps both fields optional for older clients', () => {
    const created = createProductRequestSchema.parse(product);
    expect(created.tags).toBeUndefined();
    expect(created.sizeChart).toBeUndefined();
    const { sku: _sku, ...fields } = product;
    expect(updateProductRequestSchema.parse({ ...fields, sizeChart: null }).sizeChart).toBeNull();
  });

  it('shows shoppers the size chart, and older payloads without one still parse', () => {
    const detail = {
      id: ID,
      slug: 'linen-shirt',
      sku: 'LINEN-SHIRT',
      name: 'Linen shirt',
      summary: null,
      description: null,
      priceMinor: 45_000,
      compareAtPriceMinor: null,
      availability: 'in_stock',
      maxOrderQuantity: 3,
      isFeatured: false,
      category: { slug: 'clothing', name: 'Clothing' },
      image: null,
      images: [],
    };
    expect(productDetailSchema.parse(detail).sizeChart).toBeUndefined();
    expect(
      productDetailSchema.parse({ ...detail, sizeChart: { columns: ['Size'], rows: [['M']] } })
        .sizeChart,
    ).toEqual({ columns: ['Size'], rows: [['M']] });
  });
});
