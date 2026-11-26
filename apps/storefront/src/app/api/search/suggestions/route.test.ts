// @vitest-environment node
import { ApiError } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSuggestionResponse } from '@/lib/search-suggestions';
import { summary, productImage, listing } from '@/testing/catalog-fixtures';
import { GET } from './route';

const listProducts = vi.hoisted(() => vi.fn());
vi.mock('@/lib/session', () => ({
  session: { api: () => Promise.resolve({ listProducts }) },
}));

beforeEach(() => {
  listProducts.mockReset();
});

const ask = (q: string) =>
  GET(new Request(`http://localhost:3000/api/search/suggestions?q=${encodeURIComponent(q)}`));

describe('GET /api/search/suggestions', () => {
  it('answers with the first products the real search finds, never cached', async () => {
    const image = productImage();
    listProducts.mockResolvedValue(
      listing(
        [
          summary({
            slug: 'nakshi-shawl',
            name: 'Nakshi Shawl',
            priceMinor: 250_000,
            image,
            brand: { slug: 'aarong', name: 'Aarong' },
            category: { slug: 'fashion', name: 'Fashion' },
            availability: 'out_of_stock',
          }),
        ],
        { total: 14 },
      ),
    );

    const response = await ask('  shawl ');

    expect(listProducts).toHaveBeenCalledWith({ q: 'shawl', page: 1, pageSize: 6 });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = parseSuggestionResponse(await response.json());
    expect(body).toEqual({
      query: 'shawl',
      total: 14,
      items: [
        {
          slug: 'nakshi-shawl',
          name: 'Nakshi Shawl',
          priceMinor: 250_000,
          compareAtPriceMinor: null,
          categoryName: 'Fashion',
          brandName: 'Aarong',
          imageUrl: image.thumbUrl,
          soldOut: true,
        },
      ],
    });
  });

  it('asks nothing for text shorter than two characters', async () => {
    const response = await ask(' a ');
    expect(listProducts).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ query: 'a', items: [], total: 0 });
  });

  it('cuts very long text to what the search accepts', async () => {
    listProducts.mockResolvedValue(listing([]));
    await ask('x'.repeat(500));
    expect(listProducts).toHaveBeenCalledWith(expect.objectContaining({ q: 'x'.repeat(100) }));
  });

  it('passes the visitor’s rate limit on as such', async () => {
    listProducts.mockRejectedValue(new ApiError(429, 'rate_limited', 'Too many requests'));
    const response = await ask('rice');
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: 'rate_limited' });
  });

  it('keeps every other failure’s details on the server', async () => {
    listProducts.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:4000'));
    const response = await ask('rice');
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('ECONNREFUSED');
  });
});

describe('parseSuggestionResponse', () => {
  it('refuses anything that is not a suggestion answer', () => {
    expect(parseSuggestionResponse(null)).toBeNull();
    expect(parseSuggestionResponse({ query: 'x', total: 1 })).toBeNull();
    expect(
      parseSuggestionResponse({ query: 'x', total: 1, items: [{ slug: 'a', name: 5 }] }),
    ).toBeNull();
  });
});
