import {
  categoryListResponseSchema,
  MAX_CATALOG_OFFSET,
  productListResponseSchema,
  productResponseSchema,
} from '@nilzora/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { CatalogStore } from '../modules/catalog/store';
import { commerceSetup, errorOf } from './commerce-helpers';
import { testApp } from './helpers';

describe('GET /api/v1/catalog/categories', () => {
  it('lists active categories only, with short public caching', async () => {
    const { app } = commerceSetup();
    const response = await request(app).get('/api/v1/catalog/categories');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    expect(categoryListResponseSchema.parse(response.body).categories).toStrictEqual([
      {
        slug: 'home-kitchen',
        name: 'Home & Kitchen',
        description: 'Everyday home essentials.',
        productCount: 4,
        image: null,
        parentSlug: null,
        depth: 1,
        isFeatured: false,
        totalProductCount: 4,
      },
    ]);
  });
});

describe('GET /api/v1/catalog/products', () => {
  it('lists products on sale, featured first, without drafts or hidden categories', async () => {
    const { app } = commerceSetup();
    const response = await request(app).get('/api/v1/catalog/products');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    const body = productListResponseSchema.parse(response.body);
    expect(body.items.map((item) => item.slug)).toEqual([
      'desk-lamp',
      'dinner-plate',
      'gel-pen',
      'ceramic-mug',
    ]);
    expect(body).toMatchObject({ page: 1, pageSize: 24, total: 4, totalPages: 1 });
    expect(response.text).not.toMatch(/smart-watch|paper-lantern/);
  });

  it('shows a stock band and an order limit, never the stock level', async () => {
    const { app } = commerceSetup();
    const response = await request(app).get('/api/v1/catalog/products');
    const bySlug = Object.fromEntries(
      productListResponseSchema
        .parse(response.body)
        .items.map((item) => [item.slug, [item.availability, item.maxOrderQuantity]]),
    );

    expect(bySlug).toStrictEqual({
      // stock 5 (at the low-stock threshold), per-order limit 3
      'desk-lamp': ['low_stock', 3],
      // stock 1, limit 10: capped by stock
      'ceramic-mug': ['low_stock', 1],
      'gel-pen': ['in_stock', 10],
      'dinner-plate': ['out_of_stock', 0],
    });
    expect(response.text).not.toMatch(/stock_?quantity|"stock"/i);
  });

  it('filters by category and pages through the results', async () => {
    const { app } = commerceSetup();
    const response = await request(app).get(
      '/api/v1/catalog/products?category=home-kitchen&sort=price_asc&page=2&pageSize=3',
    );

    const body = productListResponseSchema.parse(response.body);
    expect(body.items.map((item) => item.slug)).toEqual(['desk-lamp']);
    expect(body).toMatchObject({ page: 2, pageSize: 3, total: 4, totalPages: 2 });

    const hidden = await request(app).get('/api/v1/catalog/products?category=seasonal');
    expect(productListResponseSchema.parse(hidden.body)).toMatchObject({ items: [], total: 0 });
  });

  it('searches with a prepared prefix query, by relevance unless a sort is chosen', async () => {
    const { app, commerce } = commerceSetup();
    const response = await request(app).get('/api/v1/catalog/products?q=DESK%20la');

    expect(productListResponseSchema.parse(response.body).items.map((item) => item.slug)).toEqual([
      'desk-lamp',
    ]);
    expect(commerce.searches.at(-1)).toMatchObject({
      prefixQuery: "'desk':* & 'la':*",
      sort: 'relevance',
    });

    await request(app).get('/api/v1/catalog/products?q=pen&sort=newest');
    expect(commerce.searches.at(-1)).toMatchObject({ prefixQuery: "'pen':*", sort: 'newest' });
  });

  it('passes no tsquery operators from the visitor to the database', async () => {
    const { app, commerce } = commerceSetup();
    await request(app).get('/api/v1/catalog/products').query({ q: "lamp':* | !'watch & (x)" });

    expect(commerce.searches.at(-1)?.prefixQuery).toBe("'lamp':* & 'watch':* & 'x':*");
  });

  it('answers a search with no usable words with an empty page, without a query', async () => {
    const { app, commerce } = commerceSetup();
    const response = await request(app)
      .get('/api/v1/catalog/products')
      .query({ q: "&|!():*'\\<>" });

    expect(response.status).toBe(200);
    expect(productListResponseSchema.parse(response.body)).toStrictEqual({
      items: [],
      page: 1,
      pageSize: 24,
      total: 0,
      totalPages: 0,
    });
    expect(commerce.searches).toEqual([]);
  });

  it.each([
    ['an unknown sort', 'sort=random()'],
    ['page 0', 'page=0'],
    ['an oversized page', 'pageSize=61'],
    ['a category that is not a slug', 'category=Home%20Kitchen'],
    ['an empty search', 'q=%20%20'],
    ['an overlong search', `q=${'a'.repeat(101)}`],
    ['a page beyond the deepest offset', 'page=418'],
    ['a deep page of a larger page size', 'page=168&pageSize=60'],
    ['a huge page number', 'page=999999999999'],
  ])('rejects %s', async (_label, query) => {
    const { app, commerce } = commerceSetup();
    const response = await request(app).get(`/api/v1/catalog/products?${query}`);

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(commerce.searches).toEqual([]);
  });
});

describe('catalog paging limits', () => {
  it('serves the deepest page and refuses the next one before asking the database', async () => {
    const { app, commerce } = commerceSetup();
    // 24 per page: page 417 starts at offset 9,984, within the limit; page 418 is past it.
    const deepest = Math.floor(MAX_CATALOG_OFFSET / 24) + 1;
    expect(deepest).toBe(417);

    const last = await request(app).get(`/api/v1/catalog/products?page=${deepest}`);
    expect(last.status).toBe(200);
    expect(commerce.searches.at(-1)).toMatchObject({ limit: 24, offset: 9_984 });

    const beyond = await request(app).get(`/api/v1/catalog/products?page=${deepest + 1}`);
    expect(beyond.status).toBe(400);
    expect(errorOf(beyond.body)).toMatchObject({
      code: 'validation_failed',
      details: { issues: [{ location: 'query', path: 'page' }] },
    });
    expect(commerce.searches).toHaveLength(1);
  });

  it('never reports more pages than can be requested, however many products match', async () => {
    const { identity, commerce } = commerceSetup();
    const catalog: CatalogStore = {
      ...commerce.catalog,
      listProducts: async (search) => ({
        ...(await commerce.catalog.listProducts(search)),
        total: 1_000_000,
      }),
    };
    const app = testApp({ auth: identity.deps, commerce: { ...commerce.stores, catalog } });

    for (const [pageSize, reachable] of [
      [24, 417],
      [60, 167],
      [1, 10_001],
    ] as const) {
      const label = `pageSize ${pageSize}`;
      const first = await request(app).get(`/api/v1/catalog/products?pageSize=${pageSize}`);
      expect(productListResponseSchema.parse(first.body), label).toMatchObject({
        total: 1_000_000,
        totalPages: reachable,
      });

      // The last page it points to can be requested; the one after it cannot.
      const last = await request(app).get(
        `/api/v1/catalog/products?pageSize=${pageSize}&page=${reachable}`,
      );
      expect(last.status, label).toBe(200);
      expect(productListResponseSchema.parse(last.body).totalPages, label).toBe(reachable);
      const next = await request(app).get(
        `/api/v1/catalog/products?pageSize=${pageSize}&page=${reachable + 1}`,
      );
      expect(next.status, label).toBe(400);
    }
  });
});

describe('GET /api/v1/catalog/products/:slug', () => {
  it('returns a product on sale with its description', async () => {
    const { app, products } = commerceSetup();
    const response = await request(app).get('/api/v1/catalog/products/gel-pen');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    expect(productResponseSchema.parse(response.body).product).toStrictEqual({
      id: products.pen.id,
      slug: 'gel-pen',
      sku: 'GEL-PEN',
      name: 'Gel Pen',
      summary: null,
      description: 'Smooth blue ink.',
      priceMinor: 1_000,
      compareAtPriceMinor: null,
      availability: 'in_stock',
      maxOrderQuantity: 10,
      isFeatured: false,
      category: { slug: 'home-kitchen', name: 'Home & Kitchen' },
      image: null,
      images: [],
      variants: [],
      campaign: null,
    });
  });

  it.each(['smart-watch', 'paper-lantern', 'no-such-product'])(
    'answers 404 for %s (draft, hidden category, unknown)',
    async (slug) => {
      const { app } = commerceSetup();
      const response = await request(app).get(`/api/v1/catalog/products/${slug}`);

      expect(response.status).toBe(404);
      expect(errorOf(response.body)).toMatchObject({
        code: 'not_found',
        message: 'Product not found',
      });
      expect(response.headers['cache-control']).toBeUndefined();
    },
  );

  it.each(['Gel-Pen', '..%2F..%2Fadmin', 'gel_pen', `${'a'.repeat(121)}`])(
    'rejects the malformed slug %s',
    async (slug) => {
      const { app } = commerceSetup();
      const response = await request(app).get(`/api/v1/catalog/products/${slug}`);

      expect(response.status).toBe(400);
      expect(errorOf(response.body).code).toBe('validation_failed');
    },
  );
});

describe('catalog when the database is unavailable', () => {
  it.each([
    '/api/v1/catalog/categories',
    '/api/v1/catalog/products',
    '/api/v1/catalog/products/gel-pen',
  ])('%s answers 503 without internal details', async (path) => {
    const { app, commerce } = commerceSetup();
    commerce.unavailable = true;
    const response = await request(app).get(path);

    expect(response.status).toBe(503);
    expect(errorOf(response.body)).toMatchObject({
      code: 'service_unavailable',
      requestId: response.headers['x-request-id'],
    });
    expect(response.text).not.toMatch(/fetch failed|secret_table|db\.internal|5432/);
    expect(response.headers['cache-control']).toBeUndefined();
  });
});
