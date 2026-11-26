import type { HomepageSection, Navigation, PublicSitePage } from '@nilzora/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The managed content reads are optional by design: whatever goes wrong, they answer null
 * and the page shows what the site showed before. These tests pin both halves — what a
 * working API returns, and that no failure ever escapes.
 */

const api = vi.hoisted(() => ({
  publicSitePage: vi.fn(),
  publicNavigation: vi.fn(),
  publicHomepage: vi.fn(),
}));
const catalog = vi.hoisted(() => ({
  cachedApi: vi.fn(),
  attempt: vi.fn(),
}));
vi.mock('@/lib/catalog', () => catalog);

const page: PublicSitePage = {
  slug: 'about',
  title: 'About us',
  body: 'We sell lamps.',
  seoTitle: null,
  seoDescription: null,
  updatedAt: '2026-11-08T08:00:00.000Z',
};
const navigation: Navigation = {
  menus: { header: [{ label: 'Sale', href: '/products' }], footerShop: [], footerHelp: [] },
  pages: [],
};
const section: HomepageSection = { key: 'hero', title: null, itemLimit: null, config: {} };

beforeEach(() => {
  vi.resetModules();
  catalog.cachedApi.mockImplementation(() => api);
  // The real attempt() runs the call and wraps the answer; this stand-in does the same.
  catalog.attempt.mockImplementation(async (call: () => Promise<unknown>) => ({
    kind: 'ok',
    value: await call(),
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

async function load() {
  return import('./site-content');
}

describe('managed content reads', () => {
  it('returns a published page, the navigation and the homepage sections', async () => {
    api.publicSitePage.mockResolvedValue({ page });
    api.publicNavigation.mockResolvedValue({ navigation });
    api.publicHomepage.mockResolvedValue({ homepage: { sections: [section] } });
    const { getHomepageSections, getNavigation, getSitePage, SITE_CONTENT_TAG } = await load();

    await expect(getSitePage('about')).resolves.toEqual(page);
    await expect(getNavigation()).resolves.toEqual(navigation);
    await expect(getHomepageSections()).resolves.toEqual([section]);
    expect(api.publicSitePage).toHaveBeenCalledWith('about');
    expect(catalog.cachedApi).toHaveBeenCalledWith([SITE_CONTENT_TAG]);
  });

  it('answers null when the API says the page is not there (unpublished or unwritten)', async () => {
    catalog.attempt.mockResolvedValue({ kind: 'unavailable' });
    const { getSitePage } = await load();

    await expect(getSitePage('terms')).resolves.toBeNull();
  });

  it('answers null for an empty homepage, so the built-in order is used', async () => {
    api.publicHomepage.mockResolvedValue({ homepage: { sections: [] } });
    const { getHomepageSections } = await load();

    await expect(getHomepageSections()).resolves.toBeNull();
  });

  it('never throws: an unexpected failure is also "nothing managed"', async () => {
    api.publicNavigation.mockRejectedValue(new Error('refused'));
    api.publicHomepage.mockRejectedValue(new Error('refused'));
    catalog.attempt.mockImplementation(async (call: () => Promise<unknown>) => ({
      kind: 'ok',
      value: await call(),
    }));
    const { getHomepageSections, getNavigation } = await load();

    await expect(getNavigation()).resolves.toBeNull();
    await expect(getHomepageSections()).resolves.toBeNull();
  });
});
