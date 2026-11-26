import type { SeoMetadata, SitemapEntry, StoreProfileResponse } from '@nilzora/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pageMetadata, rootMetadata, siteUrl, storeMetadata, storeProfile } from './seo';

/*
 * Metadata resolution. The API is faked here: these tests decide what the storefront says
 * about a page, not what the database holds. A row the API would refuse (an off-site
 * canonical) is simulated directly to prove the reader ignores it rather than trusting it.
 */

const api = vi.hoisted(() => ({
  publicSeo: vi.fn<(kind: string, slug: string) => Promise<{ seo: SeoMetadata | null }>>(),
  publicStoreProfile: vi.fn<() => Promise<StoreProfileResponse>>(),
  sitemap: vi.fn<() => Promise<{ entries: SitemapEntry[] }>>(),
}));

vi.mock('@/lib/session', () => ({ session: { publicApi: () => api } }));

const SITE = 'https://nilzora.test';

function seo(overrides: Partial<SeoMetadata> = {}): SeoMetadata {
  return {
    kind: 'product',
    slug: 'brass-table-lamp',
    title: 'Brass Table Lamp — warm light, solid brass',
    description: 'A hand-finished brass lamp for reading corners.',
    ogTitle: 'Brass Table Lamp',
    ogDescription: 'A hand-finished brass lamp for reading corners.',
    ogImageKey: null,
    ogImageUrl: null,
    canonicalPath: '/products/brass-table-lamp',
    noIndex: false,
    defaultSeoTitle: 'Nilzora',
    defaultSeoDescription: 'Everyday essentials from Dhaka.',
    updatedAt: '2026-11-06T09:00:00.000Z',
    ...overrides,
  };
}

function profile(overrides: Partial<StoreProfileResponse['profile']> = {}): StoreProfileResponse {
  return {
    profile: {
      displayName: 'Nilzora',
      tagline: 'Everyday essentials from Dhaka.',
      description: null,
      logoKey: null,
      logoUrl: null,
      codAvailable: true,
      contactEmail: null,
      contactPhone: null,
      addressLine: null,
      addressArea: null,
      addressDistrict: null,
      businessHours: null,
      supportEmail: null,
      supportPhone: null,
      social: { facebook: null, instagram: null, youtube: null },
      defaultSeoTitle: 'Nilzora — carefully chosen everyday things',
      defaultSeoDescription: 'One shop, a small catalogue, delivered across Bangladesh.',
      ogImageKey: null,
      ogImageUrl: null,
      updatedAt: '2026-11-06T09:00:00.000Z',
      ...overrides,
    },
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  api.publicSeo.mockReset();
  api.publicStoreProfile.mockReset();
  api.sitemap.mockReset();
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
  vi.restoreAllMocks();
});

describe('siteUrl', () => {
  it('uses the configured site address', () => {
    expect(siteUrl().toString()).toBe(`${SITE}/`);
  });

  it('falls back to local development when nothing is configured', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;

    expect(siteUrl().toString()).toBe('http://localhost:3000/');
  });

  it('ignores a blank configuration', () => {
    process.env.NEXT_PUBLIC_SITE_URL = '   ';

    expect(siteUrl().toString()).toBe('http://localhost:3000/');
  });
});

describe('pageMetadata', () => {
  it('uses a product’s saved metadata for title, description, canonical and sharing', async () => {
    api.publicSeo.mockResolvedValue({ seo: seo() });

    const metadata = await pageMetadata('product', 'brass-table-lamp', {
      title: 'Brass Table Lamp',
      description: 'Catalogue summary',
    });

    expect(api.publicSeo).toHaveBeenCalledWith('product', 'brass-table-lamp');
    expect(metadata.title).toBe('Brass Table Lamp — warm light, solid brass');
    expect(metadata.description).toBe('A hand-finished brass lamp for reading corners.');
    expect(metadata.alternates).toStrictEqual({
      canonical: `${SITE}/products/brass-table-lamp`,
    });
    expect(metadata.robots).toStrictEqual({ index: true, follow: true });
    expect(metadata.openGraph).toMatchObject({
      title: 'Brass Table Lamp',
      description: 'A hand-finished brass lamp for reading corners.',
      url: `${SITE}/products/brass-table-lamp`,
      siteName: 'Nilzora',
      type: 'website',
    });
  });

  it('uses a category’s saved metadata', async () => {
    api.publicSeo.mockResolvedValue({
      seo: seo({
        kind: 'category',
        slug: 'home',
        title: 'Home and lighting',
        canonicalPath: '/categories/home',
      }),
    });

    const metadata = await pageMetadata('category', 'home', { title: 'Home' });

    expect(metadata.title).toBe('Home and lighting');
    expect(metadata.alternates).toStrictEqual({ canonical: `${SITE}/categories/home` });
  });

  it('publishes a twitter card that matches the page it describes', async () => {
    api.publicSeo.mockResolvedValue({
      seo: seo({ ogImageUrl: 'https://media.nilzora.test/products/lamp/og/full.webp' }),
    });

    const metadata = await pageMetadata('product', 'brass-table-lamp', {
      title: 'Brass Table Lamp',
      description: 'Catalogue summary',
    });

    expect(metadata.twitter).toStrictEqual({
      card: 'summary_large_image',
      title: 'Brass Table Lamp',
      description: 'A hand-finished brass lamp for reading corners.',
      images: ['https://media.nilzora.test/products/lamp/og/full.webp'],
    });
  });

  it('falls back to a plain card when the page has no picture to show', async () => {
    api.publicSeo.mockResolvedValue({ seo: seo({ ogImageKey: null, ogImageUrl: null }) });

    const metadata = await pageMetadata('product', 'brass-table-lamp', { title: 'Lamp' });

    expect(metadata.twitter).toMatchObject({ card: 'summary' });
    expect(metadata.twitter).not.toHaveProperty('images');
  });

  it('publishes the page’s share image, at the address the API resolved', async () => {
    api.publicSeo.mockResolvedValue({
      seo: seo({ ogImageUrl: 'https://media.nilzora.test/products/lamp/og/full.webp' }),
    });

    const metadata = await pageMetadata('product', 'brass-table-lamp', { title: 'Lamp' });

    expect(metadata.openGraph).toMatchObject({
      images: [{ url: 'https://media.nilzora.test/products/lamp/og/full.webp' }],
    });
  });

  it('publishes no share image when the page has none', async () => {
    api.publicSeo.mockResolvedValue({ seo: seo({ ogImageKey: null, ogImageUrl: null }) });

    const metadata = await pageMetadata('product', 'brass-table-lamp', { title: 'Lamp' });

    expect(metadata.openGraph).not.toHaveProperty('images');
  });

  it.each([
    ['a relative path', '/products/lamp/og/full.webp'],
    ['a script URL', 'javascript:alert(1)'],
    ['a data URL', 'data:image/png;base64,AAAA'],
    ['a URL with credentials', 'https://user:pass@media.nilzora.test/x.webp'],
  ])('drops %s a row might carry instead of an image', async (_label, ogImageUrl) => {
    api.publicSeo.mockResolvedValue({ seo: seo({ ogImageUrl }) });

    const metadata = await pageMetadata('product', 'brass-table-lamp', { title: 'Lamp' });

    expect(metadata.openGraph).not.toHaveProperty('images');
  });

  it('keeps the catalogue wording when the page has no saved metadata', async () => {
    api.publicSeo.mockResolvedValue({ seo: null });

    const metadata = await pageMetadata('product', 'clay-mug', {
      title: 'Clay Mug',
      description: 'Thrown in Kushtia.',
    });

    expect(metadata).toStrictEqual({ title: 'Clay Mug', description: 'Thrown in Kushtia.' });
  });

  it('omits a description the page does not have', async () => {
    api.publicSeo.mockResolvedValue({ seo: null });

    expect(await pageMetadata('product', 'clay-mug', { title: 'Clay Mug' })).toStrictEqual({
      title: 'Clay Mug',
    });
  });

  it('hides a page the store marked as not indexed', async () => {
    api.publicSeo.mockResolvedValue({ seo: seo({ noIndex: true }) });

    const metadata = await pageMetadata('product', 'brass-table-lamp', { title: 'Lamp' });

    expect(metadata.robots).toStrictEqual({ index: false, follow: false });
  });

  it.each(['//elsewhere.example/steal', '/\\elsewhere.example', 'https://elsewhere.example/x'])(
    'refuses the off-site canonical %s instead of publishing it',
    async (canonicalPath) => {
      api.publicSeo.mockResolvedValue({ seo: seo({ canonicalPath }) });

      const metadata = await pageMetadata('product', 'brass-table-lamp', { title: 'Lamp' });

      expect(metadata.alternates).toBeUndefined();
      expect(metadata.openGraph).toBeUndefined();
      // No trustworthy address means no share card either — not even a title-only one.
      expect(metadata.twitter).toBeUndefined();
      // The saved title and description are still the store's own words, so they stand.
      expect(metadata.title).toBe('Brass Table Lamp — warm light, solid brass');
    },
  );

  it('describes the page itself when the metadata read fails', async () => {
    api.publicSeo.mockRejectedValue(new Error('API down'));

    const metadata = await pageMetadata('product', 'clay-mug', { title: 'Clay Mug' });

    expect(metadata).toStrictEqual({ title: 'Clay Mug' });
  });
});

describe('storeMetadata', () => {
  it('uses the store’s default metadata for every page', async () => {
    api.publicStoreProfile.mockResolvedValue(profile());

    const metadata = await storeMetadata();

    expect(metadata.metadataBase?.toString()).toBe(`${SITE}/`);
    expect(metadata.title).toStrictEqual({
      default: 'Nilzora — carefully chosen everyday things',
      template: '%s · Nilzora',
    });
    expect(metadata.description).toBe('One shop, a small catalogue, delivered across Bangladesh.');
    // Global only: the site name and card type, never a page's own title, URL or canonical.
    expect(metadata.openGraph).toStrictEqual({ siteName: 'Nilzora', type: 'website' });
    expect(metadata.alternates).toBeUndefined();
  });

  it('falls back to the tagline and the store name when no defaults are set', async () => {
    api.publicStoreProfile.mockResolvedValue(
      profile({ displayName: 'Nilzora BD', defaultSeoTitle: null, defaultSeoDescription: null }),
    );

    const metadata = await storeMetadata();

    expect(metadata.title).toStrictEqual({ default: 'Nilzora BD', template: '%s · Nilzora BD' });
    expect(metadata.description).toBe('Everyday essentials from Dhaka.');
    expect(metadata.openGraph).toStrictEqual({ siteName: 'Nilzora BD', type: 'website' });
  });

  it('still describes the site when the profile cannot be read', async () => {
    api.publicStoreProfile.mockRejectedValue(new Error('API down'));

    const metadata = await storeMetadata();

    expect(metadata.title).toStrictEqual({ default: 'Nilzora', template: '%s · Nilzora' });
    expect(metadata.description).toBeUndefined();
  });
});

describe('rootMetadata', () => {
  it('publishes the store’s own defaults', async () => {
    api.publicStoreProfile.mockResolvedValue(profile());

    const metadata = await rootMetadata();

    expect(metadata.title).toStrictEqual({
      default: 'Nilzora — carefully chosen everyday things',
      template: '%s · Nilzora',
    });
    expect(metadata.description).toBe('One shop, a small catalogue, delivered across Bangladesh.');
    expect(metadata.metadataBase?.toString()).toBe(`${SITE}/`);
  });

  it('keeps a description when the store has published none', async () => {
    api.publicStoreProfile.mockResolvedValue(
      profile({ defaultSeoDescription: null, tagline: null }),
    );

    const metadata = await rootMetadata();

    expect(metadata.description).toBe(
      'Nilzora — online shopping for Bangladesh with Cash on Delivery.',
    );
    // The title still comes from the store.
    expect(metadata.title).toStrictEqual({
      default: 'Nilzora — carefully chosen everyday things',
      template: '%s · Nilzora',
    });
  });

  it('keeps a description when the profile cannot be read at all', async () => {
    api.publicStoreProfile.mockRejectedValue(new Error('API down'));

    const metadata = await rootMetadata();

    expect(metadata.description).toBe(
      'Nilzora — online shopping for Bangladesh with Cash on Delivery.',
    );
    expect(metadata.title).toStrictEqual({ default: 'Nilzora', template: '%s · Nilzora' });
  });
});

describe('storeMetadata share cards', () => {
  it.each(['brand/logo', 'products/lamp/og'])(
    'never turns the stored key %s into a URL itself',
    async (ogImageKey) => {
      api.publicStoreProfile.mockResolvedValue(profile({ ogImageKey }));

      const metadata = await rootMetadata();

      // Only the API knows the media address; a key on its own stays untouched, and no
      // third-party domain is invented.
      expect(metadata.openGraph).toStrictEqual({ siteName: 'Nilzora', type: 'website' });
    },
  );

  it('publishes the default share image the API resolved', async () => {
    api.publicStoreProfile.mockResolvedValue(
      profile({
        ogImageKey: 'brand/logo',
        ogImageUrl: 'https://media.nilzora.test/brand/logo/full.webp',
      }),
    );

    const metadata = await rootMetadata();

    expect(metadata.openGraph).toStrictEqual({
      siteName: 'Nilzora',
      type: 'website',
      images: [{ url: 'https://media.nilzora.test/brand/logo/full.webp' }],
    });
  });

  it('drops a share image that is not an absolute http(s) address', async () => {
    api.publicStoreProfile.mockResolvedValue(
      // A row edited outside the app could carry anything; the tag must stay clean.
      profile({ ogImageUrl: 'javascript:alert(1)' }),
    );

    const metadata = await rootMetadata();

    expect(metadata.openGraph).toStrictEqual({ siteName: 'Nilzora', type: 'website' });
    expect(JSON.stringify(metadata)).not.toContain('javascript:');
  });
});

describe('storeProfile', () => {
  it('returns the published profile', async () => {
    api.publicStoreProfile.mockResolvedValue(profile());

    await expect(storeProfile()).resolves.toMatchObject({ displayName: 'Nilzora' });
  });

  it('returns null when the profile cannot be read', async () => {
    api.publicStoreProfile.mockRejectedValue(new Error('API down'));

    await expect(storeProfile()).resolves.toBeNull();
  });
});
