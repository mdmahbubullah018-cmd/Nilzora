import { IMAGE_SEARCH_RATE_LIMIT, imageSearchResponseSchema } from '@nilzora/contracts';
import { pino } from 'pino';
import sharp from 'sharp';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { ImageEmbeddingProvider } from '../modules/image-search/embedding/provider';
import { prepareQueryImage } from '../modules/image-search/image-input';
import {
  ImageSearchDisabledError,
  ImageSearchNoIndexError,
  createImageSearchService,
} from '../modules/image-search/service';
import type {
  ImageSearchSettingsRow,
  ImageSearchStore,
  NearestMatch,
} from '../modules/image-search/store';
import { FakeCommerce } from './commerce-fakes';
import { FakeIdentity } from './fakes';
import { testApp } from './helpers';

/** A real JPEG made by sharp: the checks below run on actual image bytes. */
async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 139, g: 92, b: 246 } },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#8b5cf6"/><circle cx="${Math.round(width / 2)}" cy="${Math.round(height / 2)}" r="${Math.round(width / 4)}" fill="#f59e0b"/></svg>`,
        ),
        top: 0,
        left: 0,
      },
    ])
    .jpeg()
    .toBuffer();
}

const SETTINGS: ImageSearchSettingsRow = {
  enabled: true,
  similarityThreshold: 0.7,
  maxResults: 60,
  model: 'test-model',
  modelVersion: '1',
  dimensions: 512,
  lastIndexedAt: null,
  updatedAt: new Date(0).toISOString(),
};

/** A provider with a fixed unit vector: no model, no download. */
function fakeProvider(): ImageEmbeddingProvider {
  const vector = new Float32Array(512);
  vector[0] = 1;
  return {
    id: 'test',
    model: 'test-model',
    modelVersion: '1',
    dimensions: 512,
    embed: () => Promise.resolve(vector),
  };
}

/** A commerce fake with one category, so products can be added. */
function shop(identity: FakeIdentity) {
  const commerce = new FakeCommerce(identity);
  const category = commerce.addCategory({ slug: 'test-category', name: 'Test category' });
  const add = (options: { slug: string; priceMinor?: number; stock?: number; sku?: string }) =>
    commerce.addProduct({
      slug: options.slug,
      name: options.slug,
      categoryId: category.id,
      priceMinor: options.priceMinor ?? 10_000,
      stock: options.stock ?? 5,
      ...(options.sku === undefined ? {} : { sku: options.sku }),
    });
  return { commerce, add };
}

interface FakeStoreOptions {
  matches?: NearestMatch[];
  settings?: Partial<ImageSearchSettingsRow>;
  stored?: boolean;
}

function fakeStore(options: FakeStoreOptions = {}) {
  const logged: Parameters<ImageSearchStore['logSearch']>[0][] = [];
  const later = <T>(value: T): Promise<T> => Promise.resolve(value);
  const store: ImageSearchStore = {
    available: () => later(true),
    countCandidates: () => later(0),
    settings: () => later({ ...SETTINGS, ...options.settings }),
    cachedVector: () => later(null),
    claim: () => later([]),
    recordIndexed: () => later(undefined),
    recordFailure: () => later(undefined),
    recordExclusion: () => later(undefined),
    recoverStale: () => later(0),
    syncJob: () => later(undefined),
    takeJob: () => later(null),
    activeJob: () => later(null),
    queueAll: () => later(0),
    nearest: () => later(options.matches ?? []),
    vectorForProductImage: () =>
      later(
        options.stored === false
          ? null
          : {
              vector: new Float32Array(512),
              contentHash: 'a'.repeat(64),
              model: 'test-model',
              width: 800,
              height: 800,
            },
      ),
    logSearch: (input) => {
      logged.push(input);
      return later('11111111-1111-4111-8111-111111111111');
    },
    recordClick: () => later(true),
    adminSettings: () => later(SETTINGS),
    adminSaveSettings: () => later(SETTINGS),
    adminStats: () =>
      later({
        indexed: 0,
        pending: 0,
        processing: 0,
        failed: 0,
        excluded: 0,
        eligible: 0,
        candidates: 0,
        uniqueVectors: 0,
        lastIndexedAt: null,
        products: 0,
        activeProducts: 0,
        vectorsByModel: {},
        settings: SETTINGS,
      }),
    adminMissingImages: () => later({ items: [], total: 0, limit: 10, offset: 0 }),
    adminActivity: () => later({ items: [], total: 0, limit: 10, offset: 0 }),
    adminJobs: () => later([]),
    adminStartJob: () =>
      later({
        id: '11111111-1111-4111-8111-111111111111',
        kind: 'backfill',
        status: 'queued',
        total: 0,
      }),
  };
  return { store, logged };
}

const logger = pino({ level: 'silent' });

function match(productId: string, similarity: number, imageId = '22222222-2222-4222-8222-222222222222'): NearestMatch {
  return { imageId, productId, kind: 'primary', isPrimary: true, similarity };
}

function serviceWith(store: ImageSearchStore, commerce: FakeCommerce, enabled = true) {
  return createImageSearchService({
    store,
    catalog: commerce.catalog,
    provider: fakeProvider(),
    logger,
    enabled,
  });
}

describe('image input', () => {
  it('prepares a photo as a JPEG of at most 1024 px, without metadata', async () => {
    const prepared = await prepareQueryImage(await jpeg(2400, 1600));
    expect(Math.max(prepared.width, prepared.height)).toBe(1024);
    expect(prepared.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const meta = await sharp(prepared.jpeg).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
  });

  it('refuses bytes that are not an image, and an empty body', async () => {
    await expect(prepareQueryImage(Buffer.from('definitely not an image'))).rejects.toMatchObject({
      reason: 'corrupt',
    });
    await expect(prepareQueryImage(Buffer.alloc(0))).rejects.toMatchObject({ reason: 'empty' });
  });
});

describe('image search service', () => {
  it('keeps each product once, drops weak matches, and ranks available stock first', async () => {
    const { commerce, add } = shop(new FakeIdentity());
    const inStock = add({ slug: 'in-stock', stock: 5 });
    const soldOut = add({ slug: 'sold-out', stock: 0 });
    const { store, logged } = fakeStore({
      matches: [
        match(soldOut.id, 0.95),
        match(inStock.id, 0.9, '33333333-3333-4333-8333-333333333333'),
        match(inStock.id, 0.8, '44444444-4444-4444-8444-444444444444'),
      ],
    });
    const service = serviceWith(store, commerce);

    const answer = await service.search({
      image: await jpeg(600, 600),
      sort: 'best_match',
      page: 1,
      pageSize: 24,
      client: 'api',
    });

    expect(imageSearchResponseSchema.parse(answer)).toBeTruthy();
    expect(answer.items.map((item) => item.product.slug)).toEqual(['in-stock', 'sold-out']);
    // The best picture's score survives, not the last one seen.
    expect(answer.items[0]?.similarity).toBe(0.9);
    expect(answer.total).toBe(2);
    expect(logged[0]).toMatchObject({ resultCount: 2, outcome: 'results', client: 'api' });
  });

  it('applies the threshold and says so when nothing clears it', async () => {
    const { commerce, add } = shop(new FakeIdentity());
    const product = add({ slug: 'barely' });
    const { store, logged } = fakeStore({ matches: [match(product.id, 0.69)] });
    const answer = await serviceWith(store, commerce).search({
      image: await jpeg(400, 400),
      sort: 'best_match',
      page: 1,
      pageSize: 24,
      client: 'web',
    });
    expect(answer.items).toEqual([]);
    expect(answer.outcome).toBe('no_results');
    expect(logged[0]?.outcome).toBe('no_results');
  });

  it('sorts by the card price, both ways', async () => {
    const { commerce, add } = shop(new FakeIdentity());
    const cheap = add({ slug: 'cheap', priceMinor: 10_000, stock: 2 });
    const dear = add({ slug: 'dear', priceMinor: 90_000, stock: 2 });
    const { store } = fakeStore({ matches: [match(cheap.id, 0.9), match(dear.id, 0.9)] });
    const service = serviceWith(store, commerce);
    const image = await jpeg(300, 300);
    const ascending = await service.search({ image, sort: 'price_asc', page: 1, pageSize: 24, client: 'web' });
    const descending = await service.search({ image, sort: 'price_desc', page: 1, pageSize: 24, client: 'web' });
    expect(ascending.items.map((item) => item.product.slug)).toEqual(['cheap', 'dear']);
    expect(descending.items.map((item) => item.product.slug)).toEqual(['dear', 'cheap']);
  });

  it('pages a result set without repeating a product', async () => {
    const { commerce, add } = shop(new FakeIdentity());
    const products = Array.from({ length: 5 }, (_, index) => add({ slug: `product-${index}` }));
    const { store } = fakeStore({
      matches: products.map((product, index) => match(product.id, 0.9 - index * 0.01)),
    });
    const service = serviceWith(store, commerce);
    const image = await jpeg(300, 300);
    const first = await service.search({ image, sort: 'best_match', page: 1, pageSize: 2, client: 'web' });
    const last = await service.search({ image, sort: 'best_match', page: 3, pageSize: 2, client: 'web' });
    expect(first.total).toBe(5);
    expect(first.totalPages).toBe(3);
    expect(first.items).toHaveLength(2);
    expect(last.items).toHaveLength(1);
    expect(new Set([...first.items, ...last.items].map((item) => item.product.id)).size).toBe(3);
  });

  it('leaves the seeding product out of a similar search', async () => {
    const { commerce, add } = shop(new FakeIdentity());
    const seed = add({ slug: 'seed', stock: 4 });
    const other = add({ slug: 'other', stock: 4 });
    const { store } = fakeStore({ matches: [match(seed.id, 1), match(other.id, 0.88)] });
    const answer = await serviceWith(store, commerce).searchSimilar({
      productId: seed.id,
      imageId: null,
      sort: 'best_match',
      page: 1,
      pageSize: 24,
      client: 'android',
    });
    expect(answer.items.map((item) => item.product.slug)).toEqual(['other']);
  });

  it('refuses to search while the feature is switched off', async () => {
    const { commerce } = shop(new FakeIdentity());
    const { store } = fakeStore({ settings: { enabled: false } });
    await expect(
      serviceWith(store, commerce).search({
        image: await jpeg(300, 300),
        sort: 'best_match',
        page: 1,
        pageSize: 24,
        client: 'web',
      }),
    ).rejects.toBeInstanceOf(ImageSearchDisabledError);
  });

  it('reports an unindexed picture honestly instead of searching with nothing', async () => {
    const { commerce } = shop(new FakeIdentity());
    const { store } = fakeStore({ stored: false });
    await expect(
      serviceWith(store, commerce).searchSimilar({
        productId: '55555555-5555-4555-8555-555555555555',
        imageId: null,
        sort: 'best_match',
        page: 1,
        pageSize: 24,
        client: 'web',
      }),
    ).rejects.toBeInstanceOf(ImageSearchNoIndexError);
  });
});

describe('image search routes', () => {
  function appWith(options: FakeStoreOptions = {}, identity = new FakeIdentity()) {
    const { commerce } = shop(identity);
    const { store } = fakeStore(options);
    return testApp({
      auth: identity.deps,
      commerce: commerce.stores,
      imageSearch: {
        service: serviceWith(store, commerce),
        catalog: commerce.catalog,
        store,
        provider: {
          id: 'local',
          model: 'test-model',
          modelVersion: '1',
          dimensions: 512,
          timeoutMs: 1000,
        },
        indexer: null,
      },
    });
  }

  it('answers a multipart upload with product cards', async () => {
    const app = appWith();
    const response = await request(app)
      .post('/api/v1/search/image?client=web')
      .attach('file', await jpeg(500, 500), { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(response.status).toBe(200);
    expect(imageSearchResponseSchema.parse(response.body)).toBeTruthy();
  });

  it('refuses a request that carries no picture', async () => {
    const app = appWith();
    const empty = await request(app).post('/api/v1/search/image').send({ nothing: true });
    expect(empty.status).toBe(400);
  });

  it('rate limits one address and sends Retry-After with the 429', async () => {
    const app = appWith();
    const photo = await jpeg(320, 320);
    let limited: request.Response | undefined;
    for (let index = 0; index < IMAGE_SEARCH_RATE_LIMIT.limit + 3; index += 1) {
      const response = await request(app)
        .post('/api/v1/search/image')
        .attach('file', photo, { filename: 'photo.jpg', contentType: 'image/jpeg' });
      if (response.status === 429) {
        limited = response;
        break;
      }
    }
    const refused = limited?.body as { error?: { code?: string } } | undefined;
    expect(limited?.status).toBe(429);
    expect(refused?.error?.code).toBe('rate_limited');
    expect(Number(limited?.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('resolves a scanned SKU to a product, and unknown text to a search', async () => {
    const identity = new FakeIdentity();
    const { commerce, add } = shop(identity);
    const product = add({ slug: 'ledis-bag', sku: 'NZ-LEDIS-A', stock: 2 });
    const { store } = fakeStore();
    const app = testApp({
      auth: identity.deps,
      commerce: commerce.stores,
      imageSearch: {
        service: serviceWith(store, commerce),
        catalog: commerce.catalog,
        store,
        provider: {
          id: 'local',
          model: 'test-model',
          modelVersion: '1',
          dimensions: 512,
          timeoutMs: 1000,
        },
        indexer: null,
      },
    });

    const found = await request(app).post('/api/v1/scan/resolve').send({ value: 'NZ-LEDIS-A' });
    const resolved = found.body as { kind?: string; product?: { id?: string } };
    expect(found.status).toBe(200);
    expect(resolved.kind).toBe('product');
    expect(resolved.product?.id).toBe(product.id);

    const text = await request(app).post('/api/v1/scan/resolve').send({ value: 'wireless mouse' });
    const searched = text.body as { kind?: string; query?: string };
    expect(searched.kind).toBe('search');
    expect(searched.query).toBe('wireless mouse');
  });

  it('refuses the admin screen to an account without image_search.manage', async () => {
    const identity = new FakeIdentity();
    const staff = identity.addUser({ email: 'staff@example.com', role: 'staff' });
    const app = appWith({}, identity);
    const response = await request(app)
      .get('/api/v1/admin/image-search')
      .set('authorization', `Bearer ${identity.tokenFor(staff)}`);
    expect(response.status).toBe(403);
    expect((response.body as { error?: { code?: string } }).error?.code).toBe('forbidden');
  });
});
