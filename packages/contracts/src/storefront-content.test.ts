import { describe, expect, it } from 'vitest';
import {
  adminBannerSchema,
  bannerSchema,
  HOMEPAGE_SECTION_KEYS,
  menuHrefSchema,
  navigationSchema,
  publicStoreProfileSchema,
  reorderBannersRequestSchema,
  saveHomepageRequestSchema,
  saveMenuItemRequestSchema,
  saveSitePageRequestSchema,
  saveStoreProfileRequestSchema,
  SITE_PAGE_PATHS,
  SITE_PAGE_SLUGS,
} from './index';

const ID = '0f000000-0000-4000-8000-000000000001';

describe('store profile extras', () => {
  const profile = { displayName: 'Nilzora' };

  it('accepts a Bangladeshi WhatsApp number, store listings and social profiles', () => {
    const parsed = saveStoreProfileRequestSchema.parse({
      ...profile,
      whatsappNumber: '+8801712345678',
      playStoreUrl: 'https://play.google.com/store/apps/details?id=com.nilzora.app',
      appStoreUrl: 'https://apps.apple.com/bd/app/nilzora/id123456789',
      socialTiktok: 'https://www.tiktok.com/@nilzora',
      socialX: 'https://x.com/nilzora',
    });

    expect(parsed.whatsappNumber).toBe('+8801712345678');
  });

  it('leaves the extras undefined when a client does not send them, and keeps null to clear', () => {
    const parsed = saveStoreProfileRequestSchema.parse(profile);
    expect(parsed.whatsappNumber).toBeUndefined();
    expect(parsed.playStoreUrl).toBeUndefined();
    expect(saveStoreProfileRequestSchema.parse({ ...profile, socialX: null }).socialX).toBeNull();
  });

  it.each([
    { whatsappNumber: '01712345678' },
    { whatsappNumber: '+8801212345678' },
    { playStoreUrl: 'https://evil.example/app' },
    { playStoreUrl: 'https://play.google.com@evil.example/app' },
    { playStoreUrl: 'http://play.google.com/store' },
    { appStoreUrl: 'https://play.google.com/store/apps' },
    { socialTiktok: 'https://tiktok.com/video/1' },
    { socialX: 'https://x.evil.example/name' },
  ])('refuses %j', (extra) => {
    expect(saveStoreProfileRequestSchema.safeParse({ ...profile, ...extra }).success).toBe(false);
  });

  it('still parses a profile payload from before these fields existed', () => {
    const older = publicStoreProfileSchema.parse({
      displayName: 'Nilzora',
      logoUrl: null,
      ogImageUrl: null,
      updatedAt: '2026-10-01T00:00:00.000Z',
    });

    expect(older.whatsappNumber).toBeUndefined();
    expect(older.social).toEqual({ facebook: null, instagram: null, youtube: null });
  });
});

describe('banners', () => {
  const banner = {
    id: ID,
    placement: 'home_hero',
    title: 'Eid',
    subtitle: null,
    ctaLabel: null,
    ctaHref: null,
    image: null,
    categorySlug: null,
  };

  it('keeps the small-screen picture optional so older banners still parse', () => {
    expect(bannerSchema.safeParse(banner).success).toBe(true);
    const mobile = {
      url: 'https://media.nilzora.test/banners/b/m/full.webp',
      thumbUrl: 'https://media.nilzora.test/banners/b/m/thumb.webp',
    };
    expect(bannerSchema.parse({ ...banner, mobileImage: mobile }).mobileImage).toEqual(mobile);
    expect(
      adminBannerSchema.safeParse({
        ...banner,
        categoryId: null,
        sortOrder: 0,
        isActive: true,
        startsAt: null,
        endsAt: null,
      }).success,
    ).toBe(true);
  });

  it('orders a placement, with a category only for category banners', () => {
    expect(
      reorderBannersRequestSchema.safeParse({ placement: 'home_hero', ids: [ID] }).success,
    ).toBe(true);
    expect(
      reorderBannersRequestSchema.safeParse({ placement: 'category', ids: [ID] }).success,
    ).toBe(false);
    expect(
      reorderBannersRequestSchema.safeParse({ placement: 'category', categoryId: ID, ids: [ID] })
        .success,
    ).toBe(true);
    expect(
      reorderBannersRequestSchema.safeParse({ placement: 'home_hero', categoryId: ID, ids: [ID] })
        .success,
    ).toBe(false);
    expect(reorderBannersRequestSchema.safeParse({ placement: 'home_hero', ids: [] }).success).toBe(
      false,
    );
  });
});

describe('static pages', () => {
  it('places every page at an address no brand can take', () => {
    expect(SITE_PAGE_SLUGS).toEqual(['about', 'privacy', 'terms', 'returns', 'shipping', 'faq']);
    for (const slug of SITE_PAGE_SLUGS) {
      const first = SITE_PAGE_PATHS[slug].split('/')[1];
      expect(['about', 'privacy', 'terms', 'help']).toContain(first);
    }
  });

  it('needs text to publish, and refuses control characters and markup fields', () => {
    const page = { title: 'About', body: 'Text', isPublished: true };
    expect(saveSitePageRequestSchema.safeParse(page).success).toBe(true);
    expect(saveSitePageRequestSchema.safeParse({ ...page, body: '  ' }).success).toBe(false);
    expect(
      saveSitePageRequestSchema.safeParse({ ...page, isPublished: false, body: '' }).success,
    ).toBe(true);
    expect(saveSitePageRequestSchema.safeParse({ ...page, body: 'a\u0001b' }).success).toBe(false);
    expect(saveSitePageRequestSchema.safeParse({ ...page, html: '<b>' }).success).toBe(false);
    expect(saveSitePageRequestSchema.safeParse({ ...page, body: 'x'.repeat(20_001) }).success).toBe(
      false,
    );
  });
});

describe('navigation', () => {
  it.each([
    ['/products', true],
    ['/categories/eid?sort=newest', true],
    ['https://blog.nilzora.example/latest', true],
    ['http://plain.example', false],
    ['//evil.example', false],
    ['javascript:alert(1)', false],
    ['products', false],
  ])('menuHref %s is accepted: %s', (href, accepted) => {
    expect(menuHrefSchema.safeParse(href).success).toBe(accepted);
  });

  it('limits labels to 40 characters and knows only three menus', () => {
    const link = { menu: 'header', label: 'Sale', href: '/products' };
    expect(saveMenuItemRequestSchema.parse(link).isActive).toBe(true);
    expect(saveMenuItemRequestSchema.safeParse({ ...link, label: 'x'.repeat(41) }).success).toBe(
      false,
    );
    expect(saveMenuItemRequestSchema.safeParse({ ...link, menu: 'sidebar' }).success).toBe(false);
  });

  it('describes the public navigation', () => {
    expect(
      navigationSchema.safeParse({
        menus: { header: [], footerShop: [], footerHelp: [] },
        pages: [{ slug: 'about', title: 'About us' }],
      }).success,
    ).toBe(true);
  });
});

describe('homepage sections', () => {
  const all = HOMEPAGE_SECTION_KEYS.map((key) => ({ key, isEnabled: true }));

  it('takes every section once, with limits and curated rows only where they make sense', () => {
    expect(saveHomepageRequestSchema.safeParse({ sections: all }).success).toBe(true);
    expect(saveHomepageRequestSchema.safeParse({ sections: all.slice(1) }).success).toBe(false);
    expect(
      saveHomepageRequestSchema.safeParse({ sections: [...all.slice(1), all[1]] }).success,
    ).toBe(false);
    const withLimit = (key: string, itemLimit: number) =>
      all.map((section) => (section.key === key ? { ...section, itemLimit } : section));
    expect(
      saveHomepageRequestSchema.safeParse({ sections: withLimit('featured', 24) }).success,
    ).toBe(true);
    expect(
      saveHomepageRequestSchema.safeParse({ sections: withLimit('featured', 25) }).success,
    ).toBe(false);
    const curated = (key: string) =>
      all.map((section) =>
        section.key === key ? { ...section, config: { categorySlug: 'eid' } } : section,
      );
    expect(saveHomepageRequestSchema.safeParse({ sections: curated('featured') }).success).toBe(
      true,
    );
    expect(saveHomepageRequestSchema.safeParse({ sections: curated('brands') }).success).toBe(
      false,
    );
  });
});
