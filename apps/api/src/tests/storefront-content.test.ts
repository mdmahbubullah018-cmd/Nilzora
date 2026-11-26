import {
  adminBannerListResponseSchema,
  adminHomepageResponseSchema,
  adminSitePageResponseSchema,
  HOMEPAGE_SECTION_KEYS,
  homepageResponseSchema,
  menuItemListResponseSchema,
  menuItemResponseSchema,
  navigationResponseSchema,
  sitePageResponseSchema,
  storeProfileResponseSchema,
  type PublicStoreProfile,
  type SaveStoreProfileRequest,
} from '@nilzora/contracts';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Pool, PoolClient } from 'pg';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AdminRefusalError } from '../modules/admin/errors';
import { StoreUnavailableError } from '../modules/commerce/errors';
import { PUBLIC_CATALOG_CACHE } from '../modules/commerce/http';
import { variantKeys } from '../modules/media/images';
import { merchandisingRouter } from '../modules/merchandising/routes';
import {
  createPostgresMerchandisingStore,
  type MerchandisingStore,
} from '../modules/merchandising/store';
import {
  createPostgresSiteContentStore,
  createSupabaseSiteContentStore,
} from '../modules/site/content-store';
import { adminSiteRoutes, publicSiteRoutes } from '../modules/site/routes';
import type { SiteStore } from '../modules/site/store';
import type { SupabaseClients } from '../supabase/clients';
import { adminSetup, errorOf } from './admin-helpers';
import { FakeContent } from './content-fakes';
import { FakeIdentity } from './fakes';
import { captureLogs, testApp } from './helpers';
import { failingObjectStore, makeImage } from './media-fakes';

/*
 * The storefront's managed content: static pages, navigation links, homepage sections, the
 * store-profile extras, and banners with a small-screen picture and an order. Permissions
 * per route are in admin-access.test.ts; the SQL rules are in
 * supabase/tests/storefront_management.test.sql.
 */

const noLimit: RequestHandler = (_req, _res, next) => next();
const AT = '2026-11-08T08:00:00.000Z';

const profile: PublicStoreProfile = {
  displayName: 'Nilzora',
  tagline: null,
  description: null,
  logoKey: null,
  logoUrl: null,
  contactEmail: null,
  contactPhone: null,
  addressLine: null,
  addressArea: null,
  addressDistrict: null,
  businessHours: null,
  supportEmail: null,
  supportPhone: null,
  social: { facebook: null, instagram: null, youtube: null },
  defaultSeoTitle: null,
  defaultSeoDescription: null,
  ogImageKey: null,
  ogImageUrl: null,
  codAvailable: true,
  whatsappNumber: '+8801712345678',
  playStoreUrl: 'https://play.google.com/store/apps/details?id=com.nilzora.app',
  appStoreUrl: null,
  updatedAt: AT,
};

// ---------------------------------------------------------------------------
// Public reads and the profile extras, over the site routes
// ---------------------------------------------------------------------------

function siteApp() {
  const identity = new FakeIdentity();
  const owner = identity.addUser({ email: 'owner@example.com', role: 'super_admin' });
  const staff = identity.addUser({ email: 'staff@example.com', role: 'staff' });
  const content = new FakeContent(identity, () => undefined);
  const saved: SaveStoreProfileRequest[] = [];
  let failure: Error | undefined;
  const partial: Partial<SiteStore> = {
    publicProfile: () => Promise.resolve(profile),
    publicPage: (slug) => {
      if (failure) return Promise.reject(failure);
      return Promise.resolve(content.publicPage(slug));
    },
    publicNavigation: () => {
      if (failure) return Promise.reject(failure);
      return Promise.resolve(content.publicNavigation());
    },
    publicHomepage: () => {
      if (failure) return Promise.reject(failure);
      return Promise.resolve(content.publicHomepage());
    },
    adminProfile: () => Promise.resolve(profile),
    saveProfile: (_token, _user, input) => {
      saved.push(input);
      return Promise.resolve({ ...profile, displayName: input.displayName });
    },
  };
  const site = partial as SiteStore;
  const deps = { ...identity.deps, site };
  const app = testApp({
    auth: identity.deps,
    modules: [publicSiteRoutes(deps), adminSiteRoutes(deps)],
  });
  return {
    app,
    content,
    saved,
    tokens: { owner: identity.tokenFor(owner), staff: identity.tokenFor(staff) },
    breakStore: (error: Error) => {
      failure = error;
    },
  };
}

describe('GET /api/v1/store/pages/:slug', () => {
  it('serves a published page with the public cache header', async () => {
    const s = siteApp();
    await s.content.savePage(s.tokens.owner, '', 'about', {
      title: 'About us',
      body: '# Who we are\n\nWe sell lamps.',
      isPublished: true,
      seoTitle: 'About Nilzora',
      seoDescription: null,
    });
    const response = await request(s.app).get('/api/v1/store/pages/about');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe(PUBLIC_CATALOG_CACHE);
    expect(sitePageResponseSchema.parse(response.body).page).toMatchObject({
      slug: 'about',
      title: 'About us',
      seoTitle: 'About Nilzora',
    });
  });

  it('answers 404 for a draft and for a page never written, without leaking which', async () => {
    const s = siteApp();
    await s.content.savePage(s.tokens.owner, '', 'terms', {
      title: 'Terms',
      body: 'Draft text',
      isPublished: false,
      seoTitle: null,
      seoDescription: null,
    });
    for (const slug of ['terms', 'privacy']) {
      const response = await request(s.app).get(`/api/v1/store/pages/${slug}`);
      expect(response.status).toBe(404);
      expect(errorOf(response.body).code).toBe('not_found');
      expect(response.headers['cache-control']).not.toBe(PUBLIC_CATALOG_CACHE);
    }
  });

  it('rejects an unknown page name', async () => {
    const s = siteApp();
    const response = await request(s.app).get('/api/v1/store/pages/careers');

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
  });

  it('answers 503 when the store cannot be read', async () => {
    const s = siteApp();
    s.breakStore(new StoreUnavailableError('public_site_page failed (08006)'));
    const response = await request(s.app).get('/api/v1/store/pages/about');

    expect(response.status).toBe(503);
  });
});

describe('GET /api/v1/store/navigation and /store/homepage', () => {
  it('answers empty menus and no pages when nothing is set up', async () => {
    const s = siteApp();
    const response = await request(s.app).get('/api/v1/store/navigation');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe(PUBLIC_CATALOG_CACHE);
    expect(navigationResponseSchema.parse(response.body).navigation).toEqual({
      menus: { header: [], footerShop: [], footerHelp: [] },
      pages: [],
    });
  });

  it('lists active links in order and the published pages only', async () => {
    const s = siteApp();
    await s.content.saveMenuItem(s.tokens.owner, '', null, {
      menu: 'header',
      label: 'Eid sale',
      href: '/products?sort=newest',
      isActive: true,
    });
    await s.content.saveMenuItem(s.tokens.owner, '', null, {
      menu: 'header',
      label: 'Hidden',
      href: '/brands',
      isActive: false,
    });
    await s.content.savePage(s.tokens.owner, '', 'privacy', {
      title: 'Privacy policy',
      body: 'Text',
      isPublished: true,
      seoTitle: null,
      seoDescription: null,
    });
    const { navigation } = navigationResponseSchema.parse(
      (await request(s.app).get('/api/v1/store/navigation')).body,
    );

    expect(navigation.menus.header).toEqual([{ label: 'Eid sale', href: '/products?sort=newest' }]);
    expect(navigation.pages).toEqual([{ slug: 'privacy', title: 'Privacy policy' }]);
  });

  it("serves the homepage in today's order, then in the owner's", async () => {
    const s = siteApp();
    const first = homepageResponseSchema.parse(
      (await request(s.app).get('/api/v1/store/homepage')).body,
    );
    expect(first.homepage.sections.map((section) => section.key)).toEqual([
      'hero',
      'services',
      'categories',
      'new_arrivals',
      'featured',
      'promotions',
      'brands',
    ]);

    await s.content.saveHomepage(s.tokens.owner, '', [
      { key: 'featured', isEnabled: true, title: 'Eid picks', itemLimit: 8, config: {} },
      ...HOMEPAGE_SECTION_KEYS.filter((key) => key !== 'featured').map((key) => ({
        key,
        isEnabled: key !== 'brands',
        title: null,
        itemLimit: null,
        config: {},
      })),
    ]);
    const response = await request(s.app).get('/api/v1/store/homepage');
    const sections = homepageResponseSchema.parse(response.body).homepage.sections;

    expect(response.headers['cache-control']).toBe(PUBLIC_CATALOG_CACHE);
    expect(sections[0]).toEqual({ key: 'featured', title: 'Eid picks', itemLimit: 8, config: {} });
    expect(sections.map((section) => section.key)).not.toContain('brands');
  });
});

describe('PUT /api/v1/admin/store-profile extras', () => {
  const base = { displayName: 'Nilzora' };
  const put = (s: ReturnType<typeof siteApp>, body: object) =>
    request(s.app)
      .put('/api/v1/admin/store-profile')
      .set('Authorization', `Bearer ${s.tokens.owner}`)
      .send(body);

  it('passes the WhatsApp number, app links and social profiles to the store', async () => {
    const s = siteApp();
    const response = await put(s, {
      ...base,
      whatsappNumber: '+8801712345678',
      playStoreUrl: 'https://play.google.com/store/apps/details?id=com.nilzora.app',
      appStoreUrl: 'https://apps.apple.com/bd/app/nilzora/id123456789',
      socialTiktok: 'https://www.tiktok.com/@nilzora',
      socialX: 'https://x.com/nilzora',
    });

    expect(response.status).toBe(200);
    expect(storeProfileResponseSchema.parse(response.body).profile.whatsappNumber).toBe(
      '+8801712345678',
    );
    expect(s.saved[0]).toMatchObject({
      whatsappNumber: '+8801712345678',
      appStoreUrl: 'https://apps.apple.com/bd/app/nilzora/id123456789',
      socialTiktok: 'https://www.tiktok.com/@nilzora',
      socialX: 'https://x.com/nilzora',
    });
  });

  it('leaves the extras undefined when a client does not send them, and null clears one', async () => {
    const s = siteApp();
    await put(s, base);
    await put(s, { ...base, whatsappNumber: null });

    expect(s.saved[0]?.whatsappNumber).toBeUndefined();
    expect(s.saved[1]?.whatsappNumber).toBeNull();
  });

  it.each([
    ['a number without the country code', { whatsappNumber: '01712345678' }, 'whatsappNumber'],
    ['a landline', { whatsappNumber: '+88029876543' }, 'whatsappNumber'],
    [
      'another site as the Play Store link',
      { playStoreUrl: 'https://evil.example/app' },
      'playStoreUrl',
    ],
    [
      'a credentialed Play Store link',
      { playStoreUrl: 'https://user@play.google.com/store' },
      'playStoreUrl',
    ],
    ['a plain-http App Store link', { appStoreUrl: 'http://apps.apple.com/app/x' }, 'appStoreUrl'],
    [
      'a TikTok link that is not a profile',
      { socialTiktok: 'https://tiktok.com/video/1' },
      'socialTiktok',
    ],
    ['an X link on another host', { socialX: 'https://x.evil.example/name' }, 'socialX'],
  ])('rejects %s before the store', async (_label, extra, field) => {
    const s = siteApp();
    const response = await put(s, { ...base, ...extra });

    expect(response.status).toBe(400);
    const issues = (errorOf(response.body).details as { issues: { path: string }[] }).issues;
    expect(issues.map((issue) => issue.path)).toContain(field);
    expect(s.saved).toEqual([]);
  });

  it('refuses staff without settings.manage', async () => {
    const s = siteApp();
    const response = await request(s.app)
      .put('/api/v1/admin/store-profile')
      .set('Authorization', `Bearer ${s.tokens.staff}`)
      .send(base);

    expect(response.status).toBe(403);
    expect(s.saved).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Admin validation and refusals (the permission matrix is in admin-access.test.ts)
// ---------------------------------------------------------------------------

describe('admin content routes', () => {
  const page = { title: 'About us', body: 'We sell lamps.', isPublished: true };

  it('saves a page, then lists every page with the unwritten ones as drafts', async () => {
    const setup = adminSetup();
    const saved = await setup.call('put', '/admin/site-pages/privacy', 'owner', page);
    const listed = await setup.call('get', '/admin/site-pages', 'owner');

    expect(adminSitePageResponseSchema.parse(saved.body).page).toMatchObject({
      slug: 'privacy',
      isPublished: true,
    });
    const pages = (listed.body as { pages: { slug: string; isPublished: boolean }[] }).pages;
    expect(pages.map((entry) => entry.slug)).toEqual([
      'about',
      'privacy',
      'terms',
      'returns',
      'shipping',
      'faq',
    ]);
    expect(pages.filter((entry) => entry.isPublished).map((entry) => entry.slug)).toEqual([
      'privacy',
    ]);
    expect(setup.admin.content.audits).toEqual([
      { actorId: setup.users.owner.id, action: 'site_page.saved' },
    ]);
  });

  it.each([
    ['an unknown page', '/admin/site-pages/careers', page],
    ['a published page without text', '/admin/site-pages/about', { ...page, body: '   ' }],
    ['an empty title', '/admin/site-pages/about', { ...page, title: ' ' }],
    [
      'a body over 20,000 characters',
      '/admin/site-pages/about',
      { ...page, body: 'x'.repeat(20_001) },
    ],
    ['a control character', '/admin/site-pages/about', { ...page, body: 'bad \u0001 text' }],
    ['an extra field', '/admin/site-pages/about', { ...page, html: '<b>x</b>' }],
    ['a long SEO title', '/admin/site-pages/about', { ...page, seoTitle: 'x'.repeat(71) }],
  ])('rejects %s before the database', async (_label, path, body) => {
    const setup = adminSetup();
    const response = await setup.call('put', path, 'owner', body);

    expect(response.status).toBe(400);
    expect(setup.admin.calls).toEqual([]);
  });

  it('stores page text as given, never as markup the API interprets', async () => {
    const setup = adminSetup();
    const text = '<script>alert(1)</script>\n\n- item';
    const response = await setup.call('put', '/admin/site-pages/about', 'owner', {
      ...page,
      body: text,
    });

    expect(adminSitePageResponseSchema.parse(response.body).page.body).toBe(text);
  });

  it('creates, changes, orders and deletes navigation links', async () => {
    const setup = adminSetup();
    const first = menuItemResponseSchema.parse(
      (
        await setup.call('post', '/admin/navigation', 'owner', {
          menu: 'footer_help',
          label: 'Delivery',
          href: '/help/shipping',
        })
      ).body,
    ).item;
    const second = menuItemResponseSchema.parse(
      (
        await setup.call('post', '/admin/navigation', 'owner', {
          menu: 'footer_help',
          label: 'Blog',
          href: 'https://blog.nilzora.example/latest',
          isActive: false,
        })
      ).body,
    ).item;
    expect([first.sortOrder, second.sortOrder]).toEqual([0, 1]);

    const reordered = await setup.call('put', '/admin/navigation/order', 'owner', {
      menu: 'footer_help',
      ids: [second.id, first.id],
    });
    expect(
      menuItemListResponseSchema.parse(reordered.body).items.map((item) => item.label),
    ).toEqual(['Blog', 'Delivery']);

    const changed = await setup.call('put', `/admin/navigation/${first.id}`, 'owner', {
      menu: 'footer_help',
      label: 'Delivery info',
      href: '/help/shipping',
      isActive: true,
    });
    expect(menuItemResponseSchema.parse(changed.body).item.label).toBe('Delivery info');
    expect((await setup.call('delete', `/admin/navigation/${first.id}`, 'owner')).status).toBe(204);
    expect((await setup.call('delete', `/admin/navigation/${first.id}`, 'owner')).status).toBe(404);
  });

  it.each([
    ['a script link', { href: 'javascript:alert(1)' }],
    ['a protocol-relative link', { href: '//evil.example' }],
    ['a plain-http link', { href: 'http://plain.example' }],
    ['a label over 40 characters', { label: 'x'.repeat(41) }],
    ['an unknown menu', { menu: 'sidebar' }],
    ['an extra field', { sortOrder: 3 }],
  ])('rejects %s before the database', async (_label, change) => {
    const setup = adminSetup();
    const response = await setup.call('post', '/admin/navigation', 'owner', {
      menu: 'header',
      label: 'Link',
      href: '/products',
      ...change,
    });

    expect(response.status).toBe(400);
    expect(setup.admin.calls).toEqual([]);
  });

  it('answers 400 for a thirteenth link and for a reorder that misses a link', async () => {
    const setup = adminSetup();
    for (let n = 0; n < 12; n += 1) {
      const created = await setup.call('post', '/admin/navigation', 'owner', {
        menu: 'header',
        label: `Link ${String(n)}`,
        href: '/products',
      });
      expect(created.status).toBe(201);
    }
    const thirteenth = await setup.call('post', '/admin/navigation', 'owner', {
      menu: 'header',
      label: 'One too many',
      href: '/products',
    });
    const partial = await setup.call('put', '/admin/navigation/order', 'owner', {
      menu: 'header',
      ids: [setup.admin.content.items[0]?.id],
    });

    expect(thirteenth.status).toBe(400);
    expect(partial.status).toBe(400);
    expect(errorOf(partial.body).code).toBe('bad_request');
  });

  it('saves the homepage and rejects settings it cannot use', async () => {
    const setup = adminSetup();
    const sections = HOMEPAGE_SECTION_KEYS.map((key) => ({
      key,
      isEnabled: true,
      title: key === 'featured' ? 'Eid picks' : null,
      itemLimit: key === 'featured' ? 8 : null,
      config: key === 'featured' ? { categorySlug: 'eid' } : {},
    }));
    const saved = await setup.call('put', '/admin/homepage', 'owner', { sections });

    expect(adminHomepageResponseSchema.parse(saved.body).sections[0]).toMatchObject({
      key: 'hero',
      sortOrder: 0,
    });
    const [missing, duplicate, limit, config, extra] = await Promise.all([
      setup.call('put', '/admin/homepage', 'owner', { sections: sections.slice(1) }),
      setup.call('put', '/admin/homepage', 'owner', {
        sections: [...sections.slice(1), sections[1]],
      }),
      setup.call('put', '/admin/homepage', 'owner', {
        sections: sections.map((s) => (s.key === 'brands' ? { ...s, itemLimit: 25 } : s)),
      }),
      setup.call('put', '/admin/homepage', 'owner', {
        sections: sections.map((s) =>
          s.key === 'brands' ? { ...s, config: { brandSlug: 'acme' } } : s,
        ),
      }),
      setup.call('put', '/admin/homepage', 'owner', {
        sections: sections.map((s) => (s.key === 'hero' ? { ...s, html: '<b>' } : s)),
      }),
    ]);

    for (const response of [missing, duplicate, limit, config, extra]) {
      expect(response.status).toBe(400);
    }
  });

  it('maps a refusal from the database (NZ412) to 400 and hides its text', async () => {
    const setup = adminSetup();
    setup.admin.content.nextFailure = 'NZ412';
    const response = await setup.call('put', '/admin/homepage', 'owner', {
      sections: HOMEPAGE_SECTION_KEYS.map((key) => ({ key, isEnabled: true })),
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain('private.');
  });
});

// ---------------------------------------------------------------------------
// The content store over a pool and over Supabase
// ---------------------------------------------------------------------------

describe('the content store adapters', () => {
  const USER = '3f1c9c5e-9a52-4a52-8f0a-2a3a6f0e1111';
  const item = {
    id: '0f000000-0000-4000-8000-000000000001',
    menu: 'header',
    label: 'Eid sale',
    href: '/products',
    sortOrder: 0,
    isActive: true,
    updatedAt: '2026-11-08T08:00:00.123456+00:00',
  };

  function recordingPool(answer: (sql: string) => unknown) {
    const statements: { sql: string; values: unknown[] }[] = [];
    const client = {
      query: (sql: string, values: unknown[] = []) => {
        statements.push({ sql, values });
        return Promise.resolve({
          rows: sql.startsWith('select public.') ? [{ value: answer(sql) }] : [],
        });
      },
      release: () => undefined,
    } as unknown as PoolClient;
    const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;
    return { pool, call: () => statements.find((entry) => entry.sql.startsWith('select public.')) };
  }

  it('passes a null link id, the menu fields and an ISO timestamp back', async () => {
    const { pool, call } = recordingPool(() => item);

    const saved = await createPostgresSiteContentStore(pool).saveMenuItem('token', USER, null, {
      menu: 'header',
      label: 'Eid sale',
      href: '/products',
      isActive: true,
    });

    expect(saved.updatedAt).toBe('2026-11-08T08:00:00.123Z');
    expect(call()).toEqual({
      sql: 'select public.admin_save_menu_item($1::uuid, $2, $3, $4, $5) as value',
      values: [null, 'header', 'Eid sale', '/products', true],
    });
  });

  it('passes the homepage as one json document and the menu order as a uuid array', async () => {
    const homepage = recordingPool(() => []);
    await createPostgresSiteContentStore(homepage.pool).saveHomepage('token', USER, [
      { key: 'hero', isEnabled: true, title: null, itemLimit: null, config: {} },
    ]);
    const order = recordingPool(() => [item]);
    await createPostgresSiteContentStore(order.pool).reorderMenu('token', USER, 'header', [
      item.id,
    ]);

    expect(homepage.call()?.sql).toBe('select public.admin_save_homepage($1::jsonb) as value');
    expect(JSON.parse(homepage.call()?.values[0] as string)).toEqual([
      { key: 'hero', isEnabled: true, title: null, itemLimit: null, config: {} },
    ]);
    expect(order.call()).toEqual({
      sql: 'select public.admin_reorder_menu($1, $2::uuid[]) as value',
      values: ['header', [item.id]],
    });
  });

  it('maps a missing permission from the database and refuses an answer outside the contract', async () => {
    const denied = {
      connect: () =>
        Promise.resolve({
          query: (sql: string) =>
            sql.startsWith('select public.')
              ? Promise.reject(
                  Object.assign(new Error('missing permission settings.manage'), { code: 'NZ403' }),
                )
              : Promise.resolve({ rows: [] }),
          release: () => undefined,
        }),
    } as unknown as Pool;
    const failure = await createPostgresSiteContentStore(denied)
      .listMenuItems('token', USER)
      .catch((error: unknown) => error);
    const { pool } = recordingPool(() => [
      { ...item, href: 'javascript:alert(1)', menu: 'sidebar' },
    ]);

    expect(failure).toBeInstanceOf(AdminRefusalError);
    expect((failure as AdminRefusalError).refusal).toBe('missing_permission');
    await expect(
      createPostgresSiteContentStore(pool).listMenuItems('token', USER),
    ).rejects.toBeInstanceOf(StoreUnavailableError);
  });

  it('calls the rpc through Supabase with the caller token', async () => {
    const calls: { name: string; args: unknown; token: string }[] = [];
    const clients = {
      asUser: (token: string) => ({
        rpc: (name: string, args: unknown) => {
          calls.push({ name, args, token });
          return Promise.resolve({ data: item, error: null });
        },
      }),
    } as unknown as SupabaseClients;

    await createSupabaseSiteContentStore(clients).saveMenuItem('caller-token', USER, item.id, {
      menu: 'header',
      label: 'Eid sale',
      href: '/products',
      isActive: false,
    });

    expect(calls).toEqual([
      {
        name: 'admin_save_menu_item',
        args: {
          p_id: item.id,
          p_menu: 'header',
          p_label: 'Eid sale',
          p_href: '/products',
          p_is_active: false,
        },
        token: 'caller-token',
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Banners: the small-screen picture, the order, and removing every file
// ---------------------------------------------------------------------------

describe('banner routes', () => {
  function bannerApp() {
    const identity = new FakeIdentity();
    const users = {
      owner: identity.addUser({ email: 'owner@example.com', role: 'super_admin' }),
      admin: identity.addUser({ email: 'admin@example.com', role: 'admin' }),
      customer: identity.addUser({ email: 'customer@example.com', role: 'customer' }),
    };
    type Who = keyof typeof users;
    const tokens = Object.fromEntries(
      Object.entries(users).map(([who, user]) => [who, identity.tokenFor(user)]),
    ) as Record<Who, string>;
    const bannerId = randomUUID();
    const calls: string[] = [];
    const reorders: unknown[][] = [];
    const store = {
      adminListBanners: () => Promise.resolve([]),
      adminGetBanner: (_t: string, _u: string, id: string) =>
        Promise.resolve({
          id,
          placement: 'home_hero',
          title: 'Eid',
          subtitle: null,
          ctaLabel: null,
          ctaHref: null,
          image: null,
          mobileImage: null,
          categorySlug: null,
          categoryId: null,
          sortOrder: 0,
          isActive: true,
          startsAt: null,
          endsAt: null,
        }),
      setBannerImage: (_t: string, _u: string, id: string, key: string | null) => {
        calls.push(`main:${id}:${key === null ? 'null' : 'key'}`);
        return Promise.resolve(`banners/${id}/old-main`);
      },
      setBannerMobileImage: (_t: string, _u: string, id: string, key: string | null) => {
        calls.push(`mobile:${id}:${key === null ? 'null' : 'key'}`);
        return Promise.resolve(`banners/${id}/old-mobile`);
      },
      deleteBanner: (_t: string, _u: string, id: string) => {
        calls.push(`delete:${id}`);
        return Promise.resolve([`banners/${id}/one`, `banners/${id}/two`]);
      },
      reorderBanners: (_t: string, _u: string, ...args: unknown[]) => {
        reorders.push(args);
        if (args[2] instanceof Array && args[2].length === 1) {
          return Promise.reject(new AdminRefusalError('invalid_input'));
        }
        return Promise.resolve();
      },
    } as unknown as MerchandisingStore;
    const objects = failingObjectStore();
    const logs = captureLogs('warn');
    const app = testApp({
      auth: identity.deps,
      logger: logs.logger,
      modules: [
        merchandisingRouter({
          ...identity.deps,
          store,
          storage: { objects: objects.store, publicBaseUrl: 'https://media.example.com' },
          references: { inUse: () => Promise.resolve(false) },
          limiter: noLimit,
          logger: logs.logger,
        }),
      ],
    });
    const as = (pending: request.Test, who?: Who) =>
      who ? pending.set('Authorization', `Bearer ${tokens[who]}`) : pending;
    return { app, as, bannerId, calls, reorders, objects };
  }

  it('orders the banners of a placement and answers the list, auditing nothing in the API', async () => {
    const s = bannerApp();
    const ids = [randomUUID(), randomUUID()];
    const response = await s
      .as(request(s.app).put('/api/v1/admin/banners/order'), 'owner')
      .send({ placement: 'home_hero', ids });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(adminBannerListResponseSchema.parse(response.body).banners).toEqual([]);
    expect(s.reorders[0]).toEqual(['home_hero', null, ids]);
  });

  it.each([
    ['a category placement without its category', { placement: 'category', ids: [randomUUID()] }],
    [
      'a home placement with a category',
      { placement: 'home_hero', categoryId: randomUUID(), ids: [randomUUID()] },
    ],
    ['no banners', { placement: 'home_hero', ids: [] }],
    ['an unknown placement', { placement: 'footer', ids: [randomUUID()] }],
    ['ids that are not uuids', { placement: 'home_hero', ids: ['first'] }],
  ])('rejects %s before the store', async (_label, body) => {
    const s = bannerApp();
    const response = await s
      .as(request(s.app).put('/api/v1/admin/banners/order'), 'owner')
      .send(body);

    expect(response.status).toBe(400);
    expect(s.reorders).toEqual([]);
  });

  it('answers 400 when the database says the list misses a banner', async () => {
    const s = bannerApp();
    const response = await s
      .as(request(s.app).put('/api/v1/admin/banners/order'), 'owner')
      .send({ placement: 'home_hero', ids: [randomUUID()] });

    expect(response.status).toBe(400);
    expect(errorOf(response.body).message).toBe('List every banner of the placement exactly once');
  });

  it.each([
    ['anonymous callers', undefined, 401],
    ['customers', 'customer' as const, 403],
    ['admins without settings.manage', 'admin' as const, 403],
  ])('refuses %s before the store', async (_label, who, status) => {
    const s = bannerApp();
    const response = await s
      .as(request(s.app).put('/api/v1/admin/banners/order'), who)
      .send({ placement: 'home_hero', ids: [randomUUID()] });

    expect(response.status).toBe(status);
    expect(s.reorders).toEqual([]);
  });

  it('stores an upload with ?variant=mobile as the small-screen picture and removes the old one', async () => {
    const s = bannerApp();
    const response = await s
      .as(
        request(s.app)
          .post(`/api/v1/admin/banners/${s.bannerId}/image?variant=mobile`)
          .set('Content-Type', 'image/jpeg'),
        'owner',
      )
      .send(await makeImage('jpeg', 800, 600));

    expect(response.status).toBe(200);
    expect(s.calls).toEqual([`mobile:${s.bannerId}:key`]);
    const stored = [...s.objects.memory.objects.keys()];
    expect(stored).toHaveLength(2);
    expect(stored.every((key) => key.startsWith(`banners/${s.bannerId}/`))).toBe(true);
    expect(s.objects.state.deletes).toEqual([variantKeys(`banners/${s.bannerId}/old-mobile`)]);
  });

  it('keeps the main picture for an upload without a variant, and rejects an unknown one', async () => {
    const s = bannerApp();
    const main = await s
      .as(
        request(s.app)
          .post(`/api/v1/admin/banners/${s.bannerId}/image`)
          .set('Content-Type', 'image/jpeg'),
        'owner',
      )
      .send(await makeImage('jpeg', 800, 600));
    const unknown = await s
      .as(
        request(s.app)
          .post(`/api/v1/admin/banners/${s.bannerId}/image?variant=tablet`)
          .set('Content-Type', 'image/jpeg'),
        'owner',
      )
      .send(await makeImage('jpeg', 800, 600));

    expect(main.status).toBe(200);
    expect(s.calls).toEqual([`main:${s.bannerId}:key`]);
    expect(unknown.status).toBe(400);
  });

  it('removes only the small-screen picture with DELETE ?variant=mobile', async () => {
    const s = bannerApp();
    const removed = await s.as(
      request(s.app).delete(`/api/v1/admin/banners/${s.bannerId}/image?variant=mobile`),
      'owner',
    );
    const main = await s.as(
      request(s.app).delete(`/api/v1/admin/banners/${s.bannerId}/image`),
      'owner',
    );

    expect(removed.status).toBe(200);
    expect(s.calls).toEqual([`mobile:${s.bannerId}:null`]);
    expect(s.objects.state.deletes).toEqual([variantKeys(`banners/${s.bannerId}/old-mobile`)]);
    expect(main.status).toBe(400);
  });

  it('removes every image file of a deleted banner', async () => {
    const s = bannerApp();
    const response = await s.as(
      request(s.app).delete(`/api/v1/admin/banners/${s.bannerId}`),
      'owner',
    );

    expect(response.status).toBe(204);
    expect(s.objects.state.deletes).toEqual([
      variantKeys(`banners/${s.bannerId}/one`),
      variantKeys(`banners/${s.bannerId}/two`),
    ]);
  });

  it('shows shoppers the small-screen picture only on banners that have one', async () => {
    const rows = [
      {
        id: randomUUID(),
        placement: 'home_hero',
        category_id: null,
        title: 'With mobile',
        subtitle: null,
        cta_label: null,
        cta_href: '/products',
        image_key: 'banners/b/main',
        mobile_image_key: 'banners/b/mobile',
        sort_order: 0,
        is_active: true,
        starts_at: null,
        ends_at: null,
        category: { slug: null },
      },
      {
        id: randomUUID(),
        placement: 'home_hero',
        category_id: null,
        title: 'Without',
        subtitle: null,
        cta_label: null,
        cta_href: null,
        image_key: 'banners/c/main',
        mobile_image_key: null,
        sort_order: 1,
        is_active: true,
        starts_at: null,
        ends_at: null,
        category: { slug: null },
      },
    ];
    const client = {
      query: (sql: string) =>
        Promise.resolve({ rows: sql.includes('from public.banners') ? rows : [] }),
      release: () => undefined,
    } as unknown as PoolClient;
    const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;
    const store = createPostgresMerchandisingStore(pool, {
      mediaBaseUrl: 'https://media.example.com',
    });

    const banners = await store.listBanners('home_hero');

    expect(banners[0]?.mobileImage).toEqual({
      url: 'https://media.example.com/banners/b/mobile/full.webp',
      thumbUrl: 'https://media.example.com/banners/b/mobile/thumb.webp',
    });
    expect(banners[1]).not.toHaveProperty('mobileImage');
    expect(banners[1]?.ctaHref).toBeNull();
    expect(banners[0]?.ctaHref).toBe('/products');
  });
});
