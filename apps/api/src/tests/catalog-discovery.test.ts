import { discoveryResponseSchema, type DiscoveryResponse } from '@nilzora/contracts';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { assembleSections, type DiscoveryRow } from '../modules/catalog/discovery';
import { testApp } from './helpers';

/** One ranked row as the database returns it, with sane defaults. */
function row(id: string, overrides: Partial<DiscoveryRow> = {}): DiscoveryRow {
  return {
    id,
    slug: `product-${id.slice(-2)}`,
    sku: `NZ-${id.slice(-2)}`,
    name: `Product ${id.slice(-2)}`,
    summary: null,
    price_minor: '65000',
    compare_at_price_minor: null,
    stock_quantity: 10,
    max_order_quantity: 5,
    is_featured: false,
    category_slug: 'home-kitchen',
    category_name: 'Home & Kitchen',
    brand_slug: null,
    brand_name: null,
    image_id: null,
    image_key: null,
    image_alt: null,
    image_width: null,
    image_height: null,
    image_position: null,
    average_rating: null,
    review_count: null,
    ...overrides,
  };
}

const A = '0a000000-0000-4000-8000-000000000001';
const B = '0b000000-0000-4000-8000-000000000002';
const C = '0c000000-0000-4000-8000-000000000003';
const D = '0d000000-0000-4000-8000-000000000004';
const E = '0e000000-0000-4000-8000-000000000005';

describe('assembleSections', () => {
  it('keeps every section in rank order and drops a repeat while an alternative exists', () => {
    const sections = assembleSections(
      [
        { key: 'best-selling', rows: [row(A), row(B), row(C)] },
        { key: 'trending', rows: [row(A), row(D), row(E)] },
      ],
      5,
      undefined,
    );

    expect(sections.map((section) => section.title)).toEqual(['Best Selling', 'Trending Now']);
    expect(sections[0]?.items.map((item) => item.product.id)).toEqual([A, B, C]);
    // A was already shown as a best seller, so trending shows only its two alternatives
    // rather than repeating it.
    expect(sections[1]?.items.map((item) => item.product.id)).toEqual([D, E]);
    expect(duplicateCount(sections)).toBe(0);
  });

  it('falls back to a repeat only when the catalogue genuinely has nothing else', () => {
    const sections = assembleSections(
      [
        { key: 'best-selling', rows: [row(A), row(B), row(C)] },
        { key: 'trending', rows: [row(A)] },
      ],
      5,
      undefined,
    );

    // One alternative is not enough to leave a section looking broken, so the ranked repeat
    // returns rather than showing a single lonely card.
    expect(sections[1]?.items.map((item) => item.product.id)).toEqual([A]);
  });

  it('omits a section with no eligible rows, so no label appears without evidence', () => {
    const sections = assembleSections(
      [
        { key: 'best-selling', rows: [] },
        { key: 'top-rated', rows: [row(A, { average_rating: '4.5', review_count: 8 })] },
        { key: 'new', rows: [] },
      ],
      5,
      undefined,
    );

    expect(sections.map((section) => section.key)).toEqual(['top-rated']);
    expect(sections[0]?.items[0]?.rating).toStrictEqual({
      averageRating: 4.5,
      reviewCount: 8,
    });
  });

  it('shows no rating and no image when neither exists, and builds URLs when they do', () => {
    const sections = assembleSections(
      [
        {
          key: 'new',
          rows: [
            row(A),
            row(B, {
              image_id: '123e4567-e89b-42d3-a456-426614174000',
              image_key: 'products/p/1',
              image_alt: 'A folded shirt',
              image_width: 1200,
              image_height: 1200,
              image_position: 0,
            }),
          ],
        },
      ],
      5,
      'https://media.nilzora.test',
    );

    expect(sections[0]?.items[0]?.rating).toBeNull();
    expect(sections[0]?.items[0]?.product.image).toBeNull();
    expect(sections[0]?.items[1]?.product.image).toStrictEqual({
      id: '123e4567-e89b-42d3-a456-426614174000',
      url: 'https://media.nilzora.test/products/p/1/full.webp',
      thumbUrl: 'https://media.nilzora.test/products/p/1/thumb.webp',
      alt: 'A folded shirt',
      width: 1200,
      height: 1200,
      position: 0,
    });
  });
});

/** Counts ids that appear in more than one section. */
function duplicateCount(sections: readonly { items: { product: { id: string } }[] }[]): number {
  const seen = new Set<string>();
  let repeats = 0;
  for (const section of sections) {
    for (const item of section.items) {
      if (seen.has(item.product.id)) repeats += 1;
      seen.add(item.product.id);
    }
  }
  return repeats;
}

describe('assembleSections colours', () => {
  it('carries the card colour preview for a product that has one, and nothing otherwise', () => {
    const colors = new Map([
      [
        A,
        [
          { valueSlug: 'black', value: 'Black', swatchHex: '#0F172A' },
          { valueSlug: 'navy', value: 'Navy', swatchHex: '#1E3A8A' },
        ],
      ],
    ]);

    const sections = assembleSections(
      [{ key: 'best-selling', rows: [row(A), row(B)] }],
      5,
      undefined,
      colors,
    );

    expect(sections[0]?.items[0]?.product.colors).toStrictEqual([
      { valueSlug: 'black', value: 'Black', swatchHex: '#0F172A' },
      { valueSlug: 'navy', value: 'Navy', swatchHex: '#1E3A8A' },
    ]);
    // A product with no choice carries no key at all, so the card draws no placeholder.
    expect(sections[0]?.items[1]?.product.colors).toBeUndefined();
  });
});

describe('GET /api/v1/catalog/discovery', () => {
  it('answers the store’s sections with short public caching', async () => {
    const body: DiscoveryResponse = {
      sections: [
        {
          key: 'best-selling',
          title: 'Best Selling',
          items: [
            {
              product: {
                id: A,
                slug: 'desk-lamp',
                sku: 'NZ-LAMP',
                name: 'Desk Lamp',
                summary: null,
                priceMinor: 10_000,
                compareAtPriceMinor: null,
                availability: 'in_stock',
                maxOrderQuantity: 3,
                isFeatured: true,
                category: { slug: 'home-kitchen', name: 'Home & Kitchen' },
                image: null,
                brand: null,
                campaign: null,
              },
              rating: { averageRating: 4.5, reviewCount: 2 },
            },
          ],
        },
      ],
    };
    const sections = vi.fn(() => Promise.resolve(body));
    const app = testApp({ discovery: { sections } });

    const response = await request(app).get('/api/v1/catalog/discovery');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    expect(discoveryResponseSchema.parse(response.body)).toStrictEqual(body);
    expect(sections).toHaveBeenCalledTimes(1);
  });
});
