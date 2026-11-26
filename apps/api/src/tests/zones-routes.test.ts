import type {
  AdminSaveShoppingZoneRequest,
  AdminShoppingZoneDetail,
  AdminShoppingZoneListQuery,
  AdminShoppingZoneListResponse,
  ShoppingZone,
} from '@nilzora/contracts';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { ZoneStore } from '../modules/zones/store';
import { commerceSetup, errorOf } from './commerce-helpers';
import { adminSetup } from './admin-helpers';
import { testApp } from './helpers';
import { FakeProductImages, makeImage } from './media-fakes';

/*
 * Shopping zones over HTTP.
 *
 * Two things are proved here that the store tests cannot: a collection narrows a listing
 * through the API (and an unknown one is a 404 rather than an empty shelf), and the
 * workspace's zone routes are behind `zones.manage`, checked by the server.
 */

/** An in-memory ZoneStore: enough to drive the public read and the admin routes. */
function fakeZones(): ZoneStore & { zones: ShoppingZone[] } {
  const zones: ShoppingZone[] = [
    {
      id: randomUUID(),
      slug: 'mens',
      name: "Men's",
      description: null,
      audience: 'men',
      banner: null,
      bannerAlt: null,
      mobileBanner: null,
      productCount: 1,
    },
  ];
  const detail = (zone: ShoppingZone): AdminShoppingZoneDetail => ({
    ...zone,
    seoTitle: null,
    seoDescription: null,
    displayOrder: 0,
    isActive: true,
    explicitProductCount: 0,
    categoryCount: 0,
    updatedAt: '2026-10-25T08:00:00.000Z',
    productIds: [],
    categoryIds: [],
  });
  return {
    zones,
    list: () => Promise.resolve({ zones }),
    zone: (slug) => Promise.resolve(zones.find((zone) => zone.slug === slug) ?? null),
    adminList: (
      _token: string,
      _userId: string,
      query: AdminShoppingZoneListQuery,
    ): Promise<AdminShoppingZoneListResponse> =>
      Promise.resolve({
        zones: zones.map(detail),
        counts: { active: zones.length, inactive: 0 },
        page: query.page,
        pageSize: query.pageSize,
        total: zones.length,
        totalPages: 1,
      }),
    adminZone: (_token, _userId, zoneId) =>
      Promise.resolve(
        detail(zones.find((zone) => zone.id === zoneId) ?? (zones[0] as ShoppingZone)),
      ),
    save: (_token, _userId, _zoneId, input: AdminSaveShoppingZoneRequest) => {
      void input;
      return Promise.resolve(zones[0]?.id ?? randomUUID());
    },
    setActive: () => Promise.resolve(),
    delete: () => Promise.resolve({ bannerKey: null, mobileBannerKey: null }),
    setProducts: () => Promise.resolve(0),
    setCategories: () => Promise.resolve(0),
    setBanner: () => Promise.resolve(null),
    setMobileBanner: () => Promise.resolve(null),
    productZones: () => Promise.resolve({ mine: [], inherited: [], resolved: [] }),
    setProductZones: () => Promise.resolve(0),
    categoryZones: () => Promise.resolve({ zoneIds: [] }),
    setCategoryZones: () => Promise.resolve(0),
  };
}

const slugs = (body: unknown): string[] =>
  (body as { items?: { slug: string }[] }).items?.map((item) => item.slug) ?? [];

describe('browsing a collection', () => {
  it('lists only the products in it', async () => {
    const base = commerceSetup();
    base.commerce.addZone({
      slug: 'mens',
      productIds: [base.products.lamp.id],
    });
    const app = testApp({ auth: base.identity.deps, commerce: base.commerce.stores });

    const plain = await request(app).get('/api/v1/catalog/products');
    const inZone = await request(app).get('/api/v1/catalog/products?zone=mens');

    expect(plain.status).toBe(200);
    expect(inZone.status).toBe(200);
    expect(slugs(inZone.body)).toStrictEqual(['desk-lamp']);
    // Everything else still browses normally: a zone never removes a product.
    expect(slugs(plain.body).length).toBeGreaterThan(slugs(inZone.body).length);
  });

  it('answers 404 for a collection nobody has, instead of an empty shelf', async () => {
    const base = commerceSetup();
    const app = testApp({ auth: base.identity.deps, commerce: base.commerce.stores });

    const missing = await request(app).get('/api/v1/catalog/products?zone=nope');

    expect(missing.status).toBe(404);
    expect(errorOf(missing.body).code).toBe('not_found');
  });

  it('leaves plain browsing alone', async () => {
    const base = commerceSetup();
    const app = testApp({ auth: base.identity.deps, commerce: base.commerce.stores });

    const plain = await request(app).get('/api/v1/catalog/products?sort=newest');

    expect(plain.status).toBe(200);
    expect(slugs(plain.body)).toContain('desk-lamp');
  });
});

describe('the workspace’s zone routes', () => {
  /** The admin fixture's app, with a zone store attached so the routes can run. */
  function zoneApp() {
    const setup = adminSetup();
    const zones = fakeZones();
    const app = testApp({
      auth: setup.identity.deps,
      admin: setup.admin.stores,
      zones,
    });
    return { ...setup, zones, app };
  }

  it('refuses an anonymous caller', async () => {
    const { app } = zoneApp();

    const response = await request(app).get('/api/v1/admin/shopping-zones');

    expect(response.status).toBe(401);
  });

  it('is behind zones.manage: staff and moderators are refused, an owner is not', async () => {
    const { app, tokens } = zoneApp();
    const get = (who: 'owner' | 'staff' | 'moderator') =>
      request(app)
        .get('/api/v1/admin/shopping-zones')
        .set('Authorization', ['Bearer', tokens[who]].join(' '));

    expect((await get('owner')).status).toBe(200);
    expect((await get('staff')).status).toBe(403);
    expect((await get('moderator')).status).toBe(403);
  });

  it('serves the public collection list to anyone', async () => {
    const { app, zones } = zoneApp();

    const response = await request(app).get('/api/v1/catalog/shopping-zones');

    expect(response.status).toBe(200);
    expect((response.body as { zones: { slug: string }[] }).zones.map((zone) => zone.slug)).toEqual(
      ['mens'],
    );
    expect(zones.zones).toHaveLength(1);
  });
});

describe('the app artwork of a collection', () => {
  /** A zone store that records which picture was written, and answers with the one it replaced. */
  function artZones() {
    const written: string[] = [];
    const keys: (string | null)[] = [];
    const base = fakeZones();
    const replaced = `zone-mobile-banners/${base.zones[0]?.id ?? ''}/00000000-0000-4000-9000-0000000000bb`;
    const zones: ZoneStore = {
      ...base,
      setBanner: () => {
        throw new Error('the website picture must never be written by the app upload');
      },
      setMobileBanner: (_token, _userId, _zoneId, key) => {
        written.push(key === null ? 'cleared' : 'set');
        keys.push(key);
        return Promise.resolve(replaced);
      },
    };
    return { zones, written, keys, replaced, base };
  }

  function artApp() {
    const setup = adminSetup({}, { storage: true });
    const art = artZones();
    const app = testApp({
      auth: setup.identity.deps,
      admin: setup.admin.stores,
      zones: art.zones,
      media: {
        images: new FakeProductImages(setup.identity),
        storage: { objects: setup.objects.store, publicBaseUrl: 'https://media.example.com' },
      },
      // No other record uses the replaced key, so its files may go.
      mediaReferences: { inUse: () => Promise.resolve(false) },
    });
    return { ...setup, ...art, app };
  }

  it('refuses a customer and accepts an owner, writing only the app picture', async () => {
    const setup = artApp();
    const picture = await makeImage('png', 1200, 800);
    const zoneId = setup.base.zones[0]?.id ?? '';

    const refused = await request(setup.app)
      .post(`/api/v1/admin/shopping-zones/${zoneId}/mobile-banner`)
      .set('Authorization', `Bearer ${setup.tokens.customer}`)
      .set('Content-Type', 'image/png')
      .send(picture);
    expect(refused.status).toBe(403);
    expect(setup.written).toStrictEqual([]);

    const uploaded = await request(setup.app)
      .post(`/api/v1/admin/shopping-zones/${zoneId}/mobile-banner`)
      .set('Authorization', `Bearer ${setup.tokens.owner}`)
      .set('Content-Type', 'image/png')
      .send(picture);

    expect(uploaded.status).toBe(200);
    expect(setup.written).toStrictEqual(['set']);
    // The picture it replaced was deleted, and nothing else was.
    expect(setup.objects.state.deletes).toContainEqual([
      `${setup.replaced}/full.webp`,
      `${setup.replaced}/thumb.webp`,
    ]);
  });

  it('keeps the stored key lower case when the URL spells the id in capitals', async () => {
    const setup = artApp();
    const picture = await makeImage('png', 1200, 800);
    const zoneId = (setup.base.zones[0]?.id ?? '').toUpperCase();

    const uploaded = await request(setup.app)
      .post(`/api/v1/admin/shopping-zones/${zoneId}/mobile-banner`)
      .set('Authorization', `Bearer ${setup.tokens.owner}`)
      .set('Content-Type', 'image/png')
      .send(picture);

    expect(uploaded.status).toBe(200);
    // A UUID is case-insensitive; the stored key's folder is not, and the database compares it
    // with the lower-case id.
    expect(setup.keys[0]).toMatch(/^zone-mobile-banners\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
  });

  it('keeps a replaced picture whose key another record still uses', async () => {
    const setup = adminSetup({}, { storage: true });
    const art = artZones();
    const app = testApp({
      auth: setup.identity.deps,
      admin: setup.admin.stores,
      zones: art.zones,
      media: {
        images: new FakeProductImages(setup.identity),
        storage: { objects: setup.objects.store, publicBaseUrl: 'https://media.example.com' },
      },
      mediaReferences: { inUse: () => Promise.resolve(true) },
    });
    const picture = await makeImage('png', 1200, 800);

    const uploaded = await request(app)
      .post(`/api/v1/admin/shopping-zones/${art.base.zones[0]?.id ?? ''}/mobile-banner`)
      .set('Authorization', `Bearer ${setup.tokens.owner}`)
      .set('Content-Type', 'image/png')
      .send(picture);

    expect(uploaded.status).toBe(200);
    expect(setup.objects.state.deletes).toStrictEqual([]);
  });

  it('clears only the app picture when it is removed', async () => {
    const setup = artApp();

    const removed = await request(setup.app)
      .delete(`/api/v1/admin/shopping-zones/${setup.base.zones[0]?.id ?? ''}/mobile-banner`)
      .set('Authorization', `Bearer ${setup.tokens.owner}`);

    expect(removed.status).toBe(200);
    expect(setup.written).toStrictEqual(['cleared']);
  });
});
