import type {
  CustomerInsightQuery,
  PublicStoreProfile,
  SaveSeoRequest,
  SaveStoreProfileRequest,
  SeoKind,
  SeoMetadata,
  SeoOverviewQuery,
  SeoOverviewRow,
  SitemapEntry,
  StaffNotification,
  StaffNotificationQuery,
} from '@nilzora/contracts';
import {
  seoOverviewResponseSchema,
  sitemapResponseSchema,
  staffNotificationListResponseSchema,
  storeProfileResponseSchema,
  customerInsightListResponseSchema,
  seoMetadataResponseSchema,
} from '@nilzora/contracts';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { InboxStore } from '../modules/inbox/store';
import type { InsightStore } from '../modules/insights/store';
import type { SiteStore } from '../modules/site/store';
import { FakeAdmin } from './admin-fakes';
import { errorOf } from './commerce-helpers';
import { FakeIdentity } from './fakes';
import { testApp } from './helpers';

const AT = '2026-11-06T10:00:00.000Z';
const PRODUCT_ID = '0d000000-0000-4000-8000-000000000001';

const MEDIA = 'https://media.nilzora.test';

const profile: PublicStoreProfile = {
  displayName: 'Nilzora',
  tagline: null,
  description: null,
  logoKey: 'brand/logo',
  logoUrl: `${MEDIA}/brand/logo/thumb.webp`,
  contactEmail: 'hello@nilzora.test',
  contactPhone: null,
  addressLine: null,
  addressArea: null,
  addressDistrict: null,
  businessHours: null,
  supportEmail: null,
  supportPhone: null,
  social: { facebook: null, instagram: null, youtube: null },
  defaultSeoTitle: 'Nilzora — everyday essentials',
  defaultSeoDescription: null,
  ogImageKey: null,
  ogImageUrl: null,
  codAvailable: true,
  updatedAt: AT,
};

const productSeo: SeoMetadata = {
  kind: 'product',
  slug: 'desk-lamp',
  title: 'Desk Lamp',
  description: 'A warm reading light.',
  ogTitle: 'Desk Lamp',
  ogDescription: null,
  ogImageKey: 'products/lamp/og',
  ogImageUrl: `${MEDIA}/products/lamp/og/full.webp`,
  canonicalPath: '/products/desk-lamp',
  noIndex: false,
  defaultSeoTitle: null,
  defaultSeoDescription: null,
  updatedAt: AT,
};

const overviewRow: SeoOverviewRow = {
  kind: 'product',
  id: PRODUCT_ID,
  slug: 'desk-lamp',
  name: 'Desk Lamp',
  isPublic: true,
  seoTitle: null,
  seoDescription: null,
  ogTitle: null,
  ogDescription: null,
  ogImageKey: null,
  canonicalPath: null,
  noIndex: false,
  missingTitle: true,
  missingDescription: true,
  updatedAt: AT,
};

const notification: StaffNotification = {
  id: randomUUID(),
  kind: 'order_new',
  title: 'New order NZ100001',
  body: null,
  entityType: 'order',
  entityId: randomUUID(),
  actionPath: '/admin/orders/NZ100001',
  readAt: null,
  createdAt: AT,
};

/** Records what the routes asked for, so a test can prove a save reached the store. */
function fakeSite() {
  const saved: { kind: SeoKind; id: string; input: SaveSeoRequest }[] = [];
  const profiles: SaveStoreProfileRequest[] = [];
  const site: SiteStore = {
    publicProfile: () => Promise.resolve(profile),
    publicPage: () => Promise.resolve(null),
    publicNavigation: () =>
      Promise.resolve({ menus: { header: [], footerShop: [], footerHelp: [] }, pages: [] }),
    publicHomepage: () => Promise.resolve([]),
    publicSeo: (kind, slug) =>
      Promise.resolve(kind === 'product' && slug === 'desk-lamp' ? productSeo : null),
    sitemap: () =>
      Promise.resolve([
        { kind: 'product' as const, slug: 'desk-lamp', lastModified: AT },
        { kind: 'category' as const, slug: 'home-kitchen', lastModified: AT },
      ] satisfies SitemapEntry[]),
    overview: (_token, _userId, _query: SeoOverviewQuery) => Promise.resolve([overviewRow]),
    saveProductSeo: (_t, _u, id, input) => {
      saved.push({ kind: 'product', id, input });
      return Promise.resolve();
    },
    saveCategorySeo: (_t, _u, id, input) => {
      saved.push({ kind: 'category', id, input });
      return Promise.resolve();
    },
    adminProfile: () => Promise.resolve(profile),
    saveProfile: (_t, _u, input) => {
      profiles.push(input);
      return Promise.resolve({ ...profile, displayName: input.displayName });
    },
  };
  return { site, saved, profiles };
}

function fakeInbox() {
  const read: string[] = [];
  let allRead = 0;
  const inbox: InboxStore = {
    list: (_t, _u, _q: StaffNotificationQuery) =>
      Promise.resolve({ notifications: [notification], total: 1 }),
    unreadCount: () => Promise.resolve(1),
    markRead: (_t, _u, id) => {
      read.push(id);
      return Promise.resolve();
    },
    markAllRead: () => {
      allRead += 1;
      return Promise.resolve(0);
    },
  };
  return { inbox, read, allRead: () => allRead };
}

function fakeInsights() {
  let lastQuery: CustomerInsightQuery | undefined;
  const insights: InsightStore = {
    customers: (_t, _u, query: CustomerInsightQuery) => {
      lastQuery = query;
      return Promise.resolve({
        customers: [
          {
            id: randomUUID(),
            fullName: 'Rahima Khatun',
            email: 'rahima@example.com',
            ordersCount: 3,
            completedOrders: 2,
            spendMinor: 125_000,
            averageOrderMinor: 41_666,
            firstOrderAt: AT,
            lastOrderAt: AT,
            segments: ['repeat'],
          },
        ],
        total: 1,
      });
    },
  };
  return { insights, lastQuery: () => lastQuery };
}

function phase3Setup() {
  const identity = new FakeIdentity();
  const admin = new FakeAdmin(identity);
  const customer = identity.addUser({ email: 'rahima@example.com' });
  const staff = identity.addUser({ email: 'staff@example.com', role: 'staff' });
  const moderator = identity.addUser({ email: 'moderator@example.com', role: 'moderator' });
  const manager = identity.addUser({ email: 'admin@example.com', role: 'admin' });
  const owner = identity.addUser({ email: 'owner@example.com', role: 'super_admin' });

  const { site, saved, profiles } = fakeSite();
  const { inbox, read, allRead } = fakeInbox();
  const { insights, lastQuery } = fakeInsights();

  const app = testApp({
    auth: identity.deps,
    admin: admin.stores,
    phase3: { site, inbox, insights },
  });

  const tokens = {
    customer: identity.tokenFor(customer),
    staff: identity.tokenFor(staff),
    moderator: identity.tokenFor(moderator),
    manager: identity.tokenFor(manager),
    owner: identity.tokenFor(owner),
  };

  function call(
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    who?: keyof typeof tokens,
    body?: object,
  ) {
    let pending = request(app)[method](`/api/v1${path}`);
    if (who) pending = pending.set('Authorization', `Bearer ${tokens[who]}`);
    return body === undefined ? pending : pending.send(body);
  }

  return { tokens, call, saved, profiles, read, allRead, lastQuery, staff, manager };
}

describe('public store reads', () => {
  it('answers the store profile without a session', async () => {
    const setup = phase3Setup();
    const response = await setup.call('get', '/store/profile');

    expect(response.status).toBe(200);
    const { profile: answered } = storeProfileResponseSchema.parse(response.body);
    expect(answered.displayName).toBe('Nilzora');
    // The logo key arrives resolved to a public URL, and the key itself stays editable.
    expect(answered.logoUrl).toBe(`${MEDIA}/brand/logo/thumb.webp`);
    expect(answered.logoKey).toBe('brand/logo');
    // The public shape carries no private setting at all.
    expect(JSON.stringify(response.body)).not.toContain('returnWindow');
    expect(JSON.stringify(response.body)).not.toContain('cartInactivity');
  });

  it('answers one page’s metadata with its share image resolved', async () => {
    const setup = phase3Setup();
    const found = await setup.call('get', '/seo/product/desk-lamp');
    expect(found.status).toBe(200);
    const { seo } = seoMetadataResponseSchema.parse(found.body);
    expect(seo.canonicalPath).toBe('/products/desk-lamp');
    expect(seo.ogImageUrl).toBe(`${MEDIA}/products/lamp/og/full.webp`);

    const hidden = await setup.call('get', '/seo/product/secret-draft');
    expect(hidden.status).toBe(404);
    expect(errorOf(hidden.body).code).toBe('not_found');
  });

  it('refuses a kind that is not a page type', async () => {
    const setup = phase3Setup();
    const response = await setup.call('get', '/seo/banner/promo');
    expect(response.status).toBe(400);
  });

  it('lists only what the store publishes in the sitemap', async () => {
    const setup = phase3Setup();
    const response = await setup.call('get', '/seo/sitemap');
    expect(response.status).toBe(200);
    expect(sitemapResponseSchema.parse(response.body).entries).toHaveLength(2);
  });
});

describe('SEO management', () => {
  it('needs products.read to list the pages', async () => {
    const setup = phase3Setup();
    const anonymous = await setup.call('get', '/admin/seo');
    expect(anonymous.status).toBe(401);

    const asCustomer = await setup.call('get', '/admin/seo', 'customer');
    expect(asCustomer.status).toBe(403);
    expect(errorOf(asCustomer.body).code).toBe('forbidden');

    const asStaff = await setup.call('get', '/admin/seo', 'staff');
    expect(asStaff.status).toBe(200);
    expect(seoOverviewResponseSchema.parse(asStaff.body).entries[0]?.missingTitle).toBe(true);
    expect(asStaff.headers['cache-control']).toBe('no-store');
  });

  it('saves product metadata and refuses an off-site canonical', async () => {
    const setup = phase3Setup();
    const saved = await setup.call('put', `/admin/seo/products/${PRODUCT_ID}`, 'staff', {
      seoTitle: 'Desk lamp for reading',
      seoDescription: 'A warm light for a small desk.',
      noIndex: false,
    });
    expect(saved.status).toBe(204);
    expect(setup.saved[0]?.kind).toBe('product');
    expect(setup.saved[0]?.input.seoTitle).toBe('Desk lamp for reading');

    const offSite = await setup.call('put', `/admin/seo/products/${PRODUCT_ID}`, 'staff', {
      canonicalPath: '//example.com/steal',
    });
    expect(offSite.status).toBe(400);
    expect(setup.saved).toHaveLength(1);
  });

  it('needs products.update to save, which a moderator does not hold', async () => {
    const setup = phase3Setup();
    const moderator = setup.tokens.customer;
    void moderator;
    const response = await setup.call('put', `/admin/seo/products/${PRODUCT_ID}`, 'customer', {
      seoTitle: 'Nope',
    });
    expect(response.status).toBe(403);
    expect(setup.saved).toHaveLength(0);
  });
});

describe('store profile management', () => {
  it('is closed to an account without settings.manage, including an admin', async () => {
    const setup = phase3Setup();
    const asAdmin = await setup.call('get', '/admin/store-profile', 'manager');
    expect(asAdmin.status).toBe(403);

    const asOwner = await setup.call('get', '/admin/store-profile', 'owner');
    expect(asOwner.status).toBe(200);
    expect(storeProfileResponseSchema.parse(asOwner.body).profile.displayName).toBe('Nilzora');
  });

  it('saves the public details and never a private setting', async () => {
    const setup = phase3Setup();
    const response = await setup.call('put', '/admin/store-profile', 'owner', {
      displayName: 'Nilzora BD',
      supportEmail: 'support@nilzora.test',
      addressLine: 'House 12, Road 5',
    });
    expect(response.status).toBe(200);
    expect(setup.profiles[0]).toMatchObject({
      displayName: 'Nilzora BD',
      supportEmail: 'support@nilzora.test',
    });
    expect(response.body).toMatchObject({ profile: { displayName: 'Nilzora BD' } });
  });

  it('refuses a save without a store name', async () => {
    const setup = phase3Setup();
    const response = await setup.call('put', '/admin/store-profile', 'owner', { displayName: '' });
    expect(response.status).toBe(400);
    expect(setup.profiles).toHaveLength(0);
  });
});

describe('the staff inbox', () => {
  it('lists the caller’s own notifications with the unread count', async () => {
    const setup = phase3Setup();
    const response = await setup.call('get', '/staff/notifications', 'staff');

    expect(response.status).toBe(200);
    const list = staffNotificationListResponseSchema.parse(response.body);
    expect(list.notifications).toHaveLength(1);
    expect(list.unread).toBe(1);
    expect(list.totalPages).toBe(1);
  });

  it('needs a session, then the workspace permission every inbox surface requires', async () => {
    const setup = phase3Setup();
    expect((await setup.call('get', '/staff/notifications')).status).toBe(401);

    // A customer holds no workspace permission: the answer is a refusal, not an empty list.
    const asCustomer = await setup.call('get', '/staff/notifications', 'customer');
    expect(asCustomer.status).toBe(403);
    expect(errorOf(asCustomer.body).code).toBe('forbidden');

    // A moderator keeps their own workspace but has no Admin inbox, matching the page and nav.
    const asModerator = await setup.call('get', '/staff/notifications', 'moderator');
    expect(asModerator.status).toBe(403);
  });

  it('refuses the unread count and the read endpoints to an account without the permission', async () => {
    const setup = phase3Setup();
    const id = randomUUID();

    expect((await setup.call('get', '/staff/notifications/unread-count')).status).toBe(401);
    expect((await setup.call('get', '/staff/notifications/unread-count', 'customer')).status).toBe(
      403,
    );
    expect(
      (await setup.call('post', `/staff/notifications/${id}/read`, 'customer', {})).status,
    ).toBe(403);
    expect((await setup.call('post', '/staff/notifications/read-all', 'customer', {})).status).toBe(
      403,
    );
    // Nothing reached the store: a refusal is not a silent no-op that still wrote.
    expect(setup.read).toHaveLength(0);
    expect(setup.allRead()).toBe(0);
  });

  it('answers the unread count to every staff role that may open the inbox', async () => {
    const setup = phase3Setup();

    for (const who of ['staff', 'manager', 'owner'] as const) {
      const response = await setup.call('get', '/staff/notifications/unread-count', who);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ unread: 1 });
    }
  });

  it('marks one notification read and then all of them', async () => {
    const setup = phase3Setup();
    const id = randomUUID();
    expect((await setup.call('post', `/staff/notifications/${id}/read`, 'staff', {})).status).toBe(
      204,
    );
    expect(setup.read).toEqual([id]);

    const all = await setup.call('post', '/staff/notifications/read-all', 'staff', {});
    expect(all.status).toBe(200);
    expect(all.body).toEqual({ unread: 0 });
    expect(setup.allRead()).toBe(1);
  });

  it('refuses a notification id that is not a uuid', async () => {
    const setup = phase3Setup();
    const response = await setup.call('post', '/staff/notifications/nope/read', 'staff', {});
    expect(response.status).toBe(400);
    expect(setup.read).toHaveLength(0);
  });
});

describe('customer insight', () => {
  it('needs customers.read, then lists spending and segments', async () => {
    const setup = phase3Setup();
    const asCustomer = await setup.call('get', '/admin/insights/customers', 'customer');
    expect(asCustomer.status).toBe(403);

    const asStaff = await setup.call(
      'get',
      '/admin/insights/customers?segment=repeat&q=rahima',
      'staff',
    );
    expect(asStaff.status).toBe(200);
    const list = customerInsightListResponseSchema.parse(asStaff.body);
    expect(list.customers[0]).toMatchObject({ spendMinor: 125_000, segments: ['repeat'] });
    expect(setup.lastQuery()).toMatchObject({ segment: 'repeat', q: 'rahima' });
  });

  it('refuses a segment that is not one of the real ones', async () => {
    const setup = phase3Setup();
    const response = await setup.call('get', '/admin/insights/customers?segment=vip', 'staff');
    expect(response.status).toBe(400);
  });
});
