import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const read = vi.hoisted((): { answer: unknown; slugs: string[] } => ({
  answer: undefined,
  slugs: [],
}));

vi.mock('@/lib/catalog', () => ({
  readProductForCart: (slug: string) => {
    read.slugs.push(slug);
    return Promise.resolve(read.answer);
  },
}));

const product = {
  id: '0d000000-0000-4000-8000-000000000001',
  slug: 'cotton-shirt',
  name: 'Cotton shirt',
  summary: 'secret-ish extra field that is not needed',
  priceMinor: 125_000,
  compareAtPriceMinor: null,
  availability: 'in_stock',
  maxOrderQuantity: 4,
  variants: [],
};

function call(slug?: string): Promise<Response> {
  const query = slug === undefined ? '' : `?slug=${encodeURIComponent(slug)}`;
  return GET(new Request(`http://localhost/api/catalog/product-options${query}`));
}

beforeEach(() => {
  read.slugs = [];
});

describe('GET /api/catalog/product-options', () => {
  it('answers with the options a quick add needs and nothing else, never cached', async () => {
    read.answer = { kind: 'ok', value: product };

    const response = await call('cotton-shirt');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toStrictEqual({
      product: {
        id: product.id,
        slug: 'cotton-shirt',
        name: 'Cotton shirt',
        priceMinor: 125_000,
        compareAtPriceMinor: null,
        availability: 'in_stock',
        maxOrderQuantity: 4,
        variants: [],
      },
    });
  });

  it('refuses a missing or malformed address without reading the catalog', async () => {
    expect((await call()).status).toBe(400);
    expect((await call('../etc/passwd')).status).toBe(400);
    expect(read.slugs).toEqual([]);
  });

  it('says not found for an unknown product and 503 when the catalog cannot be read', async () => {
    read.answer = { kind: 'missing' };
    expect((await call('gone')).status).toBe(404);

    read.answer = { kind: 'unavailable' };
    const response = await call('cotton-shirt');
    expect(response.status).toBe(503);
    expect(await response.json()).toStrictEqual({ error: 'unavailable' });
  });
});
