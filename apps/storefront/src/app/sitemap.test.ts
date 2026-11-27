import type { SitemapEntry } from '@nilzora/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sitemap from './sitemap';

/*
 * The sitemap lists what the store publishes. The catalogue read is faked: this test proves
 * the storefront adds exactly the rows the API returned — an unpublished product never
 * appears, because nothing invents one — and never drops its own fixed pages.
 */

const api = vi.hoisted(() => ({
  sitemap: vi.fn<() => Promise<{ entries: SitemapEntry[] }>>(),
  listBrands: vi.fn<() => Promise<{ brands: { slug: string }[] }>>(),
}));

vi.mock('@/lib/session', () => ({ session: { publicApi: () => api } }));

const SITE = 'https://nilzora.test';

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  api.sitemap.mockReset();
  api.listBrands.mockReset();
  api.listBrands.mockResolvedValue({ brands: [] });
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
  vi.restoreAllMocks();
});

const urls = (entries: Awaited<ReturnType<typeof sitemap>>) => entries.map((entry) => entry.url);

describe('sitemap', () => {
  it('lists the fixed pages the storefront always serves', async () => {
    api.sitemap.mockResolvedValue({ entries: [] });

    const entries = await sitemap();

    expect(urls(entries)).toStrictEqual([
      `${SITE}/`,
      `${SITE}/products`,
      `${SITE}/categories`,
      `${SITE}/brands`,
      `${SITE}/contact`,
      `${SITE}/about`,
      `${SITE}/help/faq`,
      `${SITE}/privacy`,
      `${SITE}/terms`,
    ]);
  });

  it('adds only the products and categories the API lists as public', async () => {
    api.sitemap.mockResolvedValue({
      entries: [
        { kind: 'product', slug: 'brass-table-lamp', lastModified: '2026-11-06T09:00:00.000Z' },
        { kind: 'category', slug: 'home', lastModified: '2026-11-05T09:00:00.000Z' },
      ],
    });

    const entries = await sitemap();
    const listed = entries.slice(9);

    expect(listed).toStrictEqual([
      {
        url: `${SITE}/products/brass-table-lamp`,
        lastModified: new Date('2026-11-06T09:00:00.000Z'),
        changeFrequency: 'weekly',
        priority: 0.7,
      },
      {
        url: `${SITE}/categories/home`,
        lastModified: new Date('2026-11-05T09:00:00.000Z'),
        changeFrequency: 'monthly',
        priority: 0.6,
      },
    ]);
    // A draft, hidden or unpublished product is simply absent: the API did not list it.
    expect(urls(entries)).not.toContain(`${SITE}/products/clay-mug`);
  });

  it('still serves its own pages when the catalogue cannot be read', async () => {
    api.sitemap.mockRejectedValue(new Error('API down'));

    const entries = await sitemap();

    expect(entries).toHaveLength(9);
    expect(urls(entries)).toContain(`${SITE}/products`);
  });

  it('lists each brand the API shows publicly, and survives a brand read that fails', async () => {
    api.sitemap.mockResolvedValue({ entries: [] });
    api.listBrands.mockResolvedValue({
      brands: [{ slug: 'test-brand-one' }, { slug: 'test-brand-two' }],
    });
    const listed = urls(await sitemap());
    expect(listed).toContain(`${SITE}/test-brand-one`);
    expect(listed).toContain(`${SITE}/test-brand-two`);

    api.listBrands.mockRejectedValue(new Error('API down'));
    expect(urls(await sitemap())).toContain(`${SITE}/brands`);
  });
});
