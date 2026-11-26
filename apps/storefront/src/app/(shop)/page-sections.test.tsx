import type { Banner, HomepageSection } from '@nilzora/contracts';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categories, listing, summary } from '@/testing/catalog-fixtures';
import HomePage from './page';

/*
 * The home page follows the store's arrangement (order, visibility, titles, item counts, a
 * curated category or brand) and falls back to the page it always was when nothing is set up
 * or the settings cannot be read. page.test.tsx pins the content of that default page.
 */

const catalog = vi.hoisted(() => ({
  getCategories: vi.fn(),
  listProducts: vi.fn(),
  getBanners: vi.fn(),
  getBrands: vi.fn(),
  getCampaigns: vi.fn(),
  getShoppingZones: vi.fn(),
}));
vi.mock('@/lib/catalog', () => catalog);

const seo = vi.hoisted(() => ({
  storeProfile: vi.fn(),
  siteUrl: () => new URL('http://localhost:3000'),
}));
vi.mock('@/lib/seo', () => seo);

const content = vi.hoisted(() => ({ getHomepageSections: vi.fn() }));
vi.mock('@/lib/site-content', () => content);

const featured = summary({ name: 'Featured bottle', isFeatured: true });
const plain = summary({ name: 'Plain pan' });
const fresh = summary({ name: 'Fresh arrival' });

function section(
  key: HomepageSection['key'],
  overrides: Partial<HomepageSection> = {},
): HomepageSection {
  return { key, title: null, itemLimit: null, config: {}, ...overrides };
}

function banner(n: number): Banner {
  return {
    id: `0b000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    placement: 'home_hero',
    title: `Eid ${n}`,
    subtitle: null,
    ctaLabel: null,
    ctaHref: null,
    image: {
      url: `https://media.nilzora.test/banners/${n}/full.webp`,
      thumbUrl: `https://media.nilzora.test/banners/${n}/thumb.webp`,
    },
    mobileImage: {
      url: `https://media.nilzora.test/banners/${n}/mobile/full.webp`,
      thumbUrl: `https://media.nilzora.test/banners/${n}/mobile/thumb.webp`,
    },
    categorySlug: null,
  };
}

/** The ids of the page's sections, top to bottom. */
function sectionIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll('section[id]')].map((node) => node.id);
}

beforeEach(() => {
  seo.storeProfile.mockResolvedValue(null);
  content.getHomepageSections.mockResolvedValue(null);
  catalog.getCategories.mockResolvedValue({ kind: 'ok', value: categories });
  catalog.getBanners.mockResolvedValue([]);
  catalog.getCampaigns.mockResolvedValue([]);
  catalog.getBrands.mockResolvedValue({ kind: 'ok', value: [] });
  catalog.getShoppingZones.mockResolvedValue([]);
  catalog.listProducts.mockImplementation(({ sort }: { sort: string }) =>
    Promise.resolve({
      kind: 'ok',
      value: sort === 'newest' ? listing([fresh], { total: 3 }) : listing([featured, plain]),
    }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('HomePage arrangement', () => {
  it('shows the built-in order when the store has arranged nothing', async () => {
    const { container } = render(await HomePage());

    expect(sectionIds(container)).toEqual(['categories', 'new-arrivals', 'featured']);
  });

  it('shows the built-in order when the settings cannot be read', async () => {
    content.getHomepageSections.mockRejectedValue(new Error('unreachable'));
    // getHomepageSections never rejects in production; this proves the page needs no more.
    content.getHomepageSections.mockResolvedValue(null);
    const { container } = render(await HomePage());

    expect(sectionIds(container)).toEqual(['categories', 'new-arrivals', 'featured']);
  });

  it('follows the store’s order and leaves out sections it switched off', async () => {
    content.getHomepageSections.mockResolvedValue([
      section('featured'),
      section('new_arrivals'),
      section('hero'),
    ]);
    const { container } = render(await HomePage());

    // The featured row closes the page, above the brands that follow it.
    expect(sectionIds(container)).toEqual(['new-arrivals', 'featured']);
  });

  it('orders New Arrivals, Shop by Brand, Collections and Featured Products exactly', async () => {
    content.getHomepageSections.mockResolvedValue([
      section('hero'),
      section('services'),
      section('promotions'),
      section('categories'),
      section('new_arrivals'),
      section('brands'),
      section('featured'),
    ]);
    catalog.getBanners.mockResolvedValue([
      { ...banner(1), placement: 'home_secondary', mobileImage: null },
    ]);
    catalog.getCampaigns.mockResolvedValue([
      {
        id: '3f5669dc-bade-41f5-88d7-f31024f6d8fc',
        title: 'Winter Sale',
        scope: 'storewide',
        discountKind: 'percent',
        discountValue: 40,
        maxDiscountMinor: null,
        endsAt: null,
        banner: null,
        productCount: 2,
      },
    ]);
    catalog.getBrands.mockResolvedValue({
      kind: 'ok',
      value: [
        {
          slug: 'north-star',
          name: 'North Star',
          description: null,
          logo: null,
          banner: null,
          productCount: 2,
        },
      ],
    });
    catalog.getShoppingZones.mockResolvedValue([
      {
        id: '6a000000-0000-4000-8000-000000000001',
        slug: 'winter-layers',
        name: 'Winter layers',
        description: null,
        audience: null,
        banner: null,
        bannerAlt: null,
        productCount: 3,
      },
    ]);
    const { container } = render(await HomePage());

    const order = [...container.querySelectorAll('section[id], section[aria-label="Promotions"]')];
    expect(order.map((node) => node.id || node.getAttribute('aria-label'))).toEqual([
      'Promotions',
      'categories',
      'campaigns',
      'new-arrivals',
      'brands',
      'collections',
      'featured',
    ]);
  });

  it('keeps the collections band when the store switched Featured Products off', async () => {
    content.getHomepageSections.mockResolvedValue([
      section('categories'),
      section('new_arrivals'),
      section('brands'),
    ]);
    catalog.getBrands.mockResolvedValue({
      kind: 'ok',
      value: [
        {
          slug: 'north-star',
          name: 'North Star',
          description: null,
          logo: null,
          banner: null,
          productCount: 2,
        },
      ],
    });
    catalog.getShoppingZones.mockResolvedValue([
      {
        id: '6a000000-0000-4000-8000-000000000001',
        slug: 'winter-layers',
        name: 'Winter layers',
        description: null,
        audience: null,
        banner: null,
        bannerAlt: null,
        productCount: 3,
      },
    ]);
    const { container } = render(await HomePage());

    expect(sectionIds(container)).toEqual(['categories', 'new-arrivals', 'brands', 'collections']);
  });

  it('shows the sale band directly after the categories, whatever order was saved', async () => {
    content.getHomepageSections.mockResolvedValue([
      section('hero'),
      section('categories'),
      section('featured'),
      section('promotions'),
    ]);
    catalog.getCampaigns.mockResolvedValue([
      {
        id: '3f5669dc-bade-41f5-88d7-f31024f6d8fc',
        title: 'Winter Sale',
        scope: 'storewide',
        discountKind: 'percent',
        discountValue: 40,
        maxDiscountMinor: null,
        endsAt: null,
        banner: null,
        productCount: 2,
      },
    ]);
    const { container } = render(await HomePage());

    // Categories first, then the discount campaigns they belong to.
    expect(sectionIds(container)).toEqual(['categories', 'campaigns', 'featured']);
  });

  it('shows no campaign band when the store switched promotions off', async () => {
    content.getHomepageSections.mockResolvedValue([section('categories'), section('featured')]);
    catalog.getCampaigns.mockResolvedValue([
      {
        id: '3f5669dc-bade-41f5-88d7-f31024f6d8fc',
        title: 'Winter Sale',
        scope: 'storewide',
        discountKind: 'percent',
        discountValue: 40,
        maxDiscountMinor: null,
        endsAt: null,
        banner: null,
        productCount: 2,
      },
    ]);
    const { container } = render(await HomePage());

    expect(sectionIds(container)).toEqual(['categories', 'featured']);
  });

  it('draws the promotional banners above the categories and the sale band below them', async () => {
    content.getHomepageSections.mockResolvedValue([
      section('hero'),
      section('services'),
      section('promotions'),
      section('categories'),
      section('featured'),
    ]);
    catalog.getBanners.mockResolvedValue([
      { ...banner(1), placement: 'home_secondary', mobileImage: null },
    ]);
    catalog.getCampaigns.mockResolvedValue([
      {
        id: '3f5669dc-bade-41f5-88d7-f31024f6d8fc',
        title: 'Winter Sale',
        scope: 'storewide',
        discountKind: 'percent',
        discountValue: 40,
        maxDiscountMinor: null,
        endsAt: null,
        banner: null,
        productCount: 2,
      },
    ]);
    const { container } = render(await HomePage());

    const order = [...container.querySelectorAll('section[id], section[aria-label="Promotions"]')];
    // Promotional banners, then the categories, then the discount campaigns band.
    expect(order.map((node) => node.id || node.getAttribute('aria-label'))).toEqual([
      'Promotions',
      'categories',
      'campaigns',
      'featured',
    ]);
  });

  it('keeps the store’s order when no sale is running', async () => {
    content.getHomepageSections.mockResolvedValue([
      section('hero'),
      section('categories'),
      section('featured'),
      section('promotions'),
    ]);
    const { container } = render(await HomePage());

    expect(sectionIds(container)).toEqual(['categories', 'featured']);
  });

  it('uses the store’s section titles', async () => {
    content.getHomepageSections.mockResolvedValue([
      section('categories', { title: 'Browse departments' }),
      section('new_arrivals', { title: 'Fresh this week' }),
      section('featured', { title: 'Eid picks' }),
    ]);
    const { container } = render(await HomePage());

    const headings = [...container.querySelectorAll('section[id] h2')].map(
      (heading) => heading.textContent,
    );
    expect(headings).toEqual(['Browse departments', 'Fresh this week', 'Eid picks']);
  });

  it('asks for the store’s item counts and curated category or brand', async () => {
    content.getHomepageSections.mockResolvedValue([
      section('featured', { itemLimit: 6, config: { categorySlug: 'eid', brandSlug: 'acme' } }),
      section('new_arrivals', { itemLimit: 8, config: { categorySlug: 'fashion' } }),
    ]);
    render(await HomePage());

    const calls = catalog.listProducts.mock.calls.map(
      ([query]) => query as Record<string, unknown>,
    );
    const featuredCall = calls.find((call) => call.sort === 'featured');
    const newestCall = calls.find((call) => call.sort === 'newest');
    expect(featuredCall).toMatchObject({
      pageSize: 6,
      category: 'eid',
      filters: { brand: 'acme' },
    });
    expect(newestCall).toMatchObject({ pageSize: 8, category: 'fashion' });
  });

  it('keeps the built-in counts and asks for no category when nothing is curated', async () => {
    render(await HomePage());

    const calls = catalog.listProducts.mock.calls.map(
      ([query]) => query as Record<string, unknown>,
    );
    expect(calls.find((call) => call.sort === 'featured')).toEqual({
      sort: 'featured',
      page: 1,
      pageSize: 10,
    });
    expect(calls.find((call) => call.sort === 'newest')).toEqual({
      sort: 'newest',
      page: 1,
      pageSize: 4,
    });
  });

  it('shows a curated row as asked, flagged featured or not, and the default row flagged only', async () => {
    content.getHomepageSections.mockResolvedValue([
      section('featured', { config: { categorySlug: 'eid' } }),
    ]);
    const curated = render(await HomePage());
    expect(curated.container.textContent).toContain('Plain pan');
    curated.unmount();

    content.getHomepageSections.mockResolvedValue(null);
    const normal = render(await HomePage());
    expect(normal.container.textContent).toContain('Featured bottle');
    expect(normal.container.textContent).not.toContain('Plain pan');
  });
});

describe('HomePage hero artwork', () => {
  it('serves a banner’s small-screen picture to phones and the main one elsewhere', async () => {
    catalog.getBanners.mockImplementation((placement: string) =>
      Promise.resolve(placement === 'home_hero' ? [banner(1)] : []),
    );
    const { container } = render(await HomePage());

    const source = container.querySelector('picture source');
    expect(source?.getAttribute('media')).toBe('(max-width: 767px)');
    expect(source?.getAttribute('srcset')).toBe(
      'https://media.nilzora.test/banners/1/mobile/full.webp',
    );
    expect(container.querySelector('picture img')?.getAttribute('src')).toBe(
      'https://media.nilzora.test/banners/1/full.webp',
    );
  });

  it('shows the single main picture for a banner without a small-screen one', async () => {
    const { mobileImage: _unused, ...plainBanner } = banner(2);
    catalog.getBanners.mockImplementation((placement: string) =>
      Promise.resolve(placement === 'home_hero' ? [plainBanner] : []),
    );
    const { container } = render(await HomePage());

    expect(container.querySelector('picture source')).toBeNull();
    expect(container.querySelector('picture img')?.getAttribute('src')).toBe(
      'https://media.nilzora.test/banners/2/full.webp',
    );
  });
});

describe('HomePage app area', () => {
  it('shows the app panel once the profile publishes a Play Store listing', async () => {
    seo.storeProfile.mockResolvedValue({
      displayName: 'Nilzora',
      tagline: null,
      playStoreUrl: 'https://play.google.com/store/apps/details?id=com.nilzora.app',
      appStoreUrl: null,
      social: {},
    });
    const { container } = render(await HomePage());

    expect(
      [...container.querySelectorAll('a')].some((link) =>
        link.getAttribute('href')?.startsWith('https://play.google.com/'),
      ),
    ).toBe(true);
  });
});
