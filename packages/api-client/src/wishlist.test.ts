import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';

const TOKEN = 'customer-access-token';
const PRODUCT = '0d000000-0000-4000-8000-000000000001';
const AT = '2026-11-05T10:00:00.000Z';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(response: () => Response) {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(response()));
  const client = createApiClient({ baseUrl: 'http://localhost:4000/', fetch: fetchMock });
  const sent = () => {
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const request = url instanceof Request ? url : undefined;
    return {
      url: request ? request.url : url instanceof URL ? url.href : typeof url === 'string' ? url : '',
      method: init?.method ?? request?.method ?? 'GET',
      headers: new Headers(init?.headers ?? request?.headers),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
  };
  return { client, sent };
}

const savedProduct = {
  id: PRODUCT,
  slug: 'casual-t-shirt',
  sku: 'CST-5',
  name: 'Casual T Shirt',
  summary: 'Soft cotton',
  priceMinor: 10000,
  compareAtPriceMinor: null,
  availability: 'in_stock' as const,
  maxOrderQuantity: 5,
  isFeatured: false,
  category: { slug: 't-shirt', name: 'T Shirt' },
  image: null,
  brand: null,
  campaign: null,
};

const wishlist = {
  items: [{ productId: PRODUCT, savedAt: AT, product: savedProduct }],
};

describe('wishlist', () => {
  it('reads the signed-in customer’s list with their token', async () => {
    const { client, sent } = setup(() => jsonResponse(wishlist));

    const result = await client.myWishlist(TOKEN);

    expect(result.items).toEqual(wishlist.items);
    expect(sent()).toMatchObject({ url: 'http://localhost:4000/api/v1/me/wishlist', method: 'GET' });
    expect(sent().headers.get('Authorization')).toBe(['Bearer', TOKEN].join(' '));
  });

  it('saves a product by id, never by anything the browser typed', async () => {
    const { client, sent } = setup(() => jsonResponse(wishlist));

    await client.addToWishlist(TOKEN, PRODUCT);

    expect(sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/me/wishlist',
      method: 'POST',
      body: { productId: PRODUCT },
    });
  });

  it('removes one product by its id in the path', async () => {
    const { client, sent } = setup(() => jsonResponse({ items: [] }));

    const result = await client.removeFromWishlist(TOKEN, PRODUCT);

    expect(result.items).toEqual([]);
    expect(sent()).toMatchObject({
      url: `http://localhost:4000/api/v1/me/wishlist/${PRODUCT}`,
      method: 'DELETE',
    });
  });

  it('sends only slugs when folding a guest list into the account', async () => {
    const { client, sent } = setup(() => jsonResponse(wishlist));

    await client.mergeWishlist(TOKEN, ['casual-t-shirt']);

    expect(sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/me/wishlist/merge',
      method: 'POST',
      body: { slugs: ['casual-t-shirt'] },
    });
  });

  it('refuses an answer that is not a wishlist', async () => {
    const { client } = setup(() => jsonResponse({ items: [{ productId: 'not-a-uuid' }] }));

    await expect(client.myWishlist(TOKEN)).rejects.toThrow();
  });
});
