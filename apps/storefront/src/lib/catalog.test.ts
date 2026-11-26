import type { Category, ProductDetail, ProductListResponse } from '@nilzora/contracts';
import { ApiError } from '@nilzora/web-session';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CATALOG_REVALIDATE_SECONDS,
  CATALOG_TAG,
  getCategories,
  getCategory,
  getProduct,
  listProducts,
  productTag,
  searchProducts,
} from './catalog';
import { category } from '@/testing/catalog-fixtures';

const api = vi.hoisted(() => ({
  listCategories: vi.fn(),
  listProducts: vi.fn(),
  getProduct: vi.fn(),
}));
const visitorApi = vi.hoisted(() => ({ listProducts: vi.fn() }));
const sessionMock = vi.hoisted(() => ({
  publicApi: vi.fn(),
  api: vi.fn(),
}));
const connection = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('@/lib/session', () => ({ session: sessionMock }));
vi.mock('next/server', () => ({ connection }));

const fashion: Category = category({ slug: 'fashion', name: 'Fashion', productCount: 3 });

const product: ProductDetail = {
  id: '0d000000-0000-4000-8000-000000000001',
  slug: 'mens-cotton-panjabi',
  sku: 'NZ-DEMO-005',
  name: "Men's Cotton Panjabi",
  summary: 'Comfortable cotton panjabi.',
  description: 'Lightweight cotton.',
  priceMinor: 185_000,
  compareAtPriceMinor: 225_000,
  availability: 'in_stock',
  maxOrderQuantity: 5,
  isFeatured: true,
  category: { slug: 'fashion', name: 'Fashion' },
  image: null,
  images: [],
  variants: [],
  campaign: null,
};

const page: ProductListResponse = {
  items: [product],
  page: 1,
  pageSize: 24,
  total: 1,
  totalPages: 1,
};

/** The fetch publicApi() was given, as the API client would call it. */
function cachedFetch(): (input: string, init?: RequestInit) => Promise<Response> {
  const options = sessionMock.publicApi.mock.lastCall?.[0] as
    { fetch?: (input: string, init?: RequestInit) => Promise<Response> } | undefined;
  if (!options?.fetch) throw new Error('publicApi() was not given a fetch');
  return options.fetch;
}

function expectNotFound(promise: Promise<unknown>) {
  return expect(promise).rejects.toMatchObject({
    digest: expect.stringContaining('404') as unknown,
  });
}

beforeEach(() => {
  sessionMock.publicApi.mockReturnValue(api);
  sessionMock.api.mockResolvedValue(visitorApi);
  api.listCategories.mockResolvedValue({ categories: [fashion] });
  api.listProducts.mockResolvedValue(page);
  api.getProduct.mockResolvedValue({ product });
  visitorApi.listProducts.mockResolvedValue(page);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('cached catalog reads', () => {
  it('reads categories through the public client, during a request', async () => {
    await expect(getCategories()).resolves.toEqual({ kind: 'ok', value: [fashion] });

    expect(connection).toHaveBeenCalled();
    expect(sessionMock.publicApi).toHaveBeenCalledTimes(1);
    // Nothing about the visitor: the per-request client is never used for browsing.
    expect(sessionMock.api).not.toHaveBeenCalled();
  });

  it('adds revalidation and the catalog tag to every cached fetch', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetchSpy);
    await getCategories();

    await cachedFetch()('http://api.test/api/v1/catalog/categories', {
      headers: { Accept: 'application/json' },
    });

    expect(fetchSpy).toHaveBeenCalledWith('http://api.test/api/v1/catalog/categories', {
      headers: { Accept: 'application/json' },
      next: { revalidate: CATALOG_REVALIDATE_SECONDS, tags: [CATALOG_TAG] },
    });
    expect(CATALOG_REVALIDATE_SECONDS).toBe(60);
  });

  it('caches product listings with the catalog tag', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetchSpy);
    await listProducts({ sort: 'featured', page: 1 });

    await cachedFetch()('http://api.test/api/v1/catalog/products');

    expect(fetchSpy).toHaveBeenCalledWith('http://api.test/api/v1/catalog/products', {
      next: { revalidate: CATALOG_REVALIDATE_SECONDS, tags: [CATALOG_TAG] },
    });
  });

  it('lists products with the listing page size by default', async () => {
    await expect(
      listProducts({ category: 'fashion', sort: 'price_asc', page: 2 }),
    ).resolves.toEqual({ kind: 'ok', value: page });

    expect(api.listProducts).toHaveBeenCalledWith({
      category: 'fashion',
      sort: 'price_asc',
      page: 2,
      pageSize: 24,
    });
    expect(sessionMock.api).not.toHaveBeenCalled();
  });

  it('tags a product detail with its own tag and the catalog tag', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(getProduct(product.slug)).resolves.toEqual({ kind: 'ok', value: product });
    expect(api.getProduct).toHaveBeenCalledWith(product.slug);

    await cachedFetch()('http://api.test/x');
    expect(fetchSpy).toHaveBeenCalledWith('http://api.test/x', {
      next: { revalidate: 60, tags: ['product:mens-cotton-panjabi', 'catalog'] },
    });
    expect(productTag('mug')).toBe('product:mug');
  });
});

describe('failures', () => {
  it.each([
    ['a network failure', new ApiError(0, 'network_error', 'Could not reach the Nilzora API')],
    ['a timeout', new ApiError(0, 'timeout', 'Request timed out')],
    ['a server error', new ApiError(500, 'internal_error', 'Internal error')],
    ['a 503', new ApiError(503, 'service_unavailable', 'Try again')],
    ['an unexpected answer', new ApiError(200, 'invalid_response', 'Unexpected response')],
  ])('turns %s into a calm unavailable state', async (_name, error) => {
    api.listCategories.mockRejectedValue(error);
    await expect(getCategories()).resolves.toEqual({ kind: 'unavailable' });
  });

  it('treats the shared limit on browsing reads as an outage, not as "searching too fast"', async () => {
    // Browsing reads count against the store server's address, not this visitor's.
    api.listProducts.mockRejectedValue(new ApiError(429, 'rate_limited', 'Slow down'));
    await expect(listProducts({ sort: 'featured', page: 1 })).resolves.toEqual({
      kind: 'unavailable',
    });
  });

  it('treats a 404 on a listing as an outage (a wrong API address), never as not found', async () => {
    api.listProducts.mockRejectedValue(new ApiError(404, 'not_found', 'Route not found'));
    await expect(listProducts({ sort: 'featured', page: 1 })).resolves.toEqual({
      kind: 'unavailable',
    });
    api.listCategories.mockRejectedValue(new ApiError(404, 'not_found', 'Route not found'));
    await expect(getCategories()).resolves.toEqual({ kind: 'unavailable' });
  });

  it('rethrows refused requests and other errors for the error boundary', async () => {
    const refused = new ApiError(400, 'validation_failed', 'Invalid query');
    api.listProducts.mockRejectedValue(refused);
    await expect(listProducts({ sort: 'featured', page: 1 })).rejects.toBe(refused);

    const bug = new TypeError('boom');
    api.listCategories.mockRejectedValue(bug);
    await expect(getCategories()).rejects.toBe(bug);
  });

  it('maps a missing product to notFound()', async () => {
    api.getProduct.mockRejectedValue(new ApiError(404, 'not_found', 'Product not found'));
    await expectNotFound(getProduct('no-such-product'));
  });

  it('refuses a malformed product slug without asking the API', async () => {
    for (const slug of ['', 'Upper-Case', '..', 'a/b', 'x'.repeat(121), '%2e%2e']) {
      await expectNotFound(getProduct(slug));
    }
    expect(api.getProduct).not.toHaveBeenCalled();
  });
});

describe('getCategory', () => {
  it('finds a visible category', async () => {
    await expect(getCategory('fashion')).resolves.toEqual({ kind: 'ok', value: fashion });
  });

  it('is not found when unknown, hidden or malformed', async () => {
    await expectNotFound(getCategory('electronics'));
    api.listCategories.mockClear();
    await expectNotFound(getCategory('../admin'));
    expect(api.listCategories).not.toHaveBeenCalled();
  });

  it('passes an outage through rather than claiming the category is missing', async () => {
    api.listCategories.mockRejectedValue(new ApiError(0, 'network_error', 'down'));
    await expect(getCategory('fashion')).resolves.toEqual({ kind: 'unavailable' });
  });
});

describe('searchProducts', () => {
  it('searches with the per-visitor client, uncached', async () => {
    await expect(
      searchProducts({ q: 'cotton', category: 'fashion', sort: 'relevance', page: 1 }),
    ).resolves.toEqual({ kind: 'ok', value: page });

    expect(visitorApi.listProducts).toHaveBeenCalledWith({
      q: 'cotton',
      category: 'fashion',
      sort: 'relevance',
      page: 1,
      pageSize: 24,
    });
    expect(sessionMock.publicApi).not.toHaveBeenCalled();
    expect(api.listProducts).not.toHaveBeenCalled();
  });

  it('matches nothing for blank text without asking the API', async () => {
    await expect(searchProducts({ q: '   ', sort: 'relevance', page: 1 })).resolves.toEqual({
      kind: 'ok',
      value: { items: [], page: 1, pageSize: 24, total: 0, totalPages: 0 },
    });
    expect(sessionMock.api).not.toHaveBeenCalled();
  });

  it('reports a visitor who searches too fast', async () => {
    visitorApi.listProducts.mockRejectedValue(new ApiError(429, 'rate_limited', 'Slow down'));
    await expect(searchProducts({ q: 'rice', sort: 'relevance', page: 1 })).resolves.toEqual({
      kind: 'rate_limited',
    });
  });
});
