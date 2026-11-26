import {
  adminCampaignListResponseSchema,
  adminCampaignResponseSchema,
  campaignPreviewResponseSchema,
} from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import { adminSetup, errorOf, type AdminSetup } from './admin-helpers';

/*
 * The discount campaign endpoints through the HTTP layer: the permission each verb and each
 * status transition needs, request validation before the database, the 404 and 409 that a
 * stale or missing campaign produces, and a create → preview → activate round trip. The
 * pricing effect itself is proven in supabase/tests/discount_campaigns.test.sql; here the
 * store is the fake, so only the wiring is under test.
 */

/** A valid POST /admin/discounts/campaigns body for the setup's kitchen category. */
function newCampaign(setup: AdminSetup, overrides: object = {}) {
  return {
    name: 'Eid sale',
    customerTitle: 'Eid sale up to 20% off',
    scope: 'categories',
    discountKind: 'percent',
    discountValue: 20,
    maxDiscountMinor: null,
    startsAt: null,
    endsAt: null,
    priority: 0,
    isVisible: true,
    couponPolicy: 'stackable',
    categoryIds: [setup.categories.kitchen.id],
    ...overrides,
  };
}

async function withCampaign(setup: AdminSetup, overrides: object = {}) {
  const response = await setup.call(
    'post',
    '/admin/discounts/campaigns',
    'admin',
    newCampaign(setup, overrides),
  );
  return adminCampaignResponseSchema.parse(response.body).campaign;
}

describe('GET /api/v1/admin/discounts/campaigns', () => {
  it('lists campaigns with the page envelope', async () => {
    const setup = adminSetup();
    await withCampaign(setup);

    const response = await setup.call('get', '/admin/discounts/campaigns', 'admin');

    expect(response.status).toBe(200);
    const body = adminCampaignListResponseSchema.parse(response.body);
    expect(body.campaigns.map((campaign) => campaign.name)).toEqual(['Eid sale']);
    expect(body.total).toBe(1);
  });

  it('filters by state, and a draft is not live', async () => {
    const setup = adminSetup();
    await withCampaign(setup);

    const drafts = await setup.call('get', '/admin/discounts/campaigns?state=draft', 'admin');
    const live = await setup.call('get', '/admin/discounts/campaigns?state=active', 'admin');

    expect(adminCampaignListResponseSchema.parse(drafts.body).campaigns).toHaveLength(1);
    expect(adminCampaignListResponseSchema.parse(live.body).campaigns).toHaveLength(0);
  });

  it.each([['customer'], ['moderator'], ['otherCustomer']] as const)(
    'refuses %s, who has no discount permission',
    async (who) => {
      const setup = adminSetup();
      const response = await setup.call('get', '/admin/discounts/campaigns', who);

      expect(response.status).toBe(403);
      expect(errorOf(response.body).code).toBe('forbidden');
    },
  );

  it('refuses an anonymous caller', async () => {
    const setup = adminSetup();
    const response = await setup.call('get', '/admin/discounts/campaigns');

    expect(response.status).toBe(401);
  });

  it('honours a per-account denial', async () => {
    const setup = adminSetup();
    setup.deny('admin', 'discounts.view');

    const response = await setup.call('get', '/admin/discounts/campaigns', 'admin');

    expect(response.status).toBe(403);
  });
});

describe('POST /api/v1/admin/discounts/campaigns', () => {
  it('creates a campaign without a customer-facing title', async () => {
    const setup = adminSetup();
    const response = await setup.call(
      'post',
      '/admin/discounts/campaigns',
      'admin',
      newCampaign(setup, { customerTitle: '' }),
    );

    expect(response.status).toBe(201);
    const { campaign } = adminCampaignResponseSchema.parse(response.body);
    // Stored as an empty title, never as null: every reader still gets a string.
    expect(campaign.customerTitle).toBe('');
    expect(campaign.name).toBe('Eid sale');
  });

  it('creates a campaign as a draft', async () => {
    const setup = adminSetup();
    const response = await setup.call(
      'post',
      '/admin/discounts/campaigns',
      'admin',
      newCampaign(setup),
    );

    expect(response.status).toBe(201);
    const { campaign } = adminCampaignResponseSchema.parse(response.body);
    expect(campaign).toMatchObject({
      name: 'Eid sale',
      status: 'draft',
      state: 'draft',
      scope: 'categories',
      discountKind: 'percent',
      discountValue: 20,
      version: 1,
    });
    expect(campaign.categories.map((category) => category.id)).toEqual([
      setup.categories.kitchen.id,
    ]);
  });

  it.each([
    ['a percentage over 100', { discountValue: 101 }, 'discountValue'],
    ['a zero discount', { discountValue: 0 }, 'discountValue'],
    [
      'a cap on a fixed discount',
      { discountKind: 'fixed', maxDiscountMinor: 1000 },
      'maxDiscountMinor',
    ],
    ['a category scope with no category', { categoryIds: [] }, 'categoryIds'],
    [
      'a category scope that also lists products',
      { productIds: ['00000000-0000-4000-8000-000000000001'] },
      'categoryIds',
    ],
    [
      'an end before the start',
      { startsAt: '2026-12-01T00:00:00Z', endsAt: '2026-11-01T00:00:00Z' },
      'endsAt',
    ],
    ['an unknown scope', { scope: 'regions' }, 'scope'],
    ['an unknown coupon policy', { couponPolicy: 'sometimes' }, 'couponPolicy'],
    ['a blank name', { name: '   ' }, 'name'],
  ])('rejects %s before the database', async (_label, overrides, path) => {
    const setup = adminSetup();
    const response = await setup.call(
      'post',
      '/admin/discounts/campaigns',
      'admin',
      newCampaign(setup, overrides),
    );

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(JSON.stringify(errorOf(response.body))).toContain(path);
  });

  it('refuses a duplicate name with the mapped refusal', async () => {
    const setup = adminSetup();
    await withCampaign(setup);

    const response = await setup.call(
      'post',
      '/admin/discounts/campaigns',
      'admin',
      newCampaign(setup),
    );

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('campaign_invalid');
  });

  it('refuses staff, who may not create campaigns', async () => {
    const setup = adminSetup();
    const response = await setup.call(
      'post',
      '/admin/discounts/campaigns',
      'staff',
      newCampaign(setup),
    );

    expect(response.status).toBe(403);
  });
});

describe('PATCH /api/v1/admin/discounts/campaigns/:campaignId/status', () => {
  it.each([
    ['staff', 'active', 403],
    ['moderator', 'active', 403],
    ['admin', 'active', 200],
  ] as const)('answers %s activating a campaign with %i', async (who, status, expected) => {
    const setup = adminSetup();
    const campaign = await withCampaign(setup);

    const response = await setup.call(
      'patch',
      `/admin/discounts/campaigns/${campaign.id}/status`,
      who,
      { status },
    );

    expect(response.status).toBe(expected);
    if (expected === 200) {
      expect(adminCampaignResponseSchema.parse(response.body).campaign).toMatchObject({
        status: 'active',
        state: 'active',
        version: 2,
      });
    }
  });

  it('refuses a stale version with 409', async () => {
    const setup = adminSetup();
    const campaign = await withCampaign(setup);
    await setup.call('patch', `/admin/discounts/campaigns/${campaign.id}/status`, 'admin', {
      status: 'active',
      expectedVersion: campaign.version,
    });

    const response = await setup.call(
      'patch',
      `/admin/discounts/campaigns/${campaign.id}/status`,
      'admin',
      { status: 'paused', expectedVersion: campaign.version },
    );

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('campaign_conflict');
  });

  it('answers 404 for a campaign that does not exist', async () => {
    const setup = adminSetup();
    const response = await setup.call(
      'patch',
      '/admin/discounts/campaigns/00000000-0000-4000-8000-0000000000ff/status',
      'admin',
      { status: 'active' },
    );

    expect(response.status).toBe(404);
    expect(errorOf(response.body).code).toBe('campaign_not_found');
  });

  it('rejects a status the enum does not know, and a non-uuid id', async () => {
    const setup = adminSetup();
    const campaign = await withCampaign(setup);

    const badStatus = await setup.call(
      'patch',
      `/admin/discounts/campaigns/${campaign.id}/status`,
      'admin',
      { status: 'running' },
    );
    const badId = await setup.call(
      'patch',
      '/admin/discounts/campaigns/not-an-id/status',
      'admin',
      {
        status: 'active',
      },
    );

    expect(badStatus.status).toBe(400);
    expect(badId.status).toBe(400);
  });
});

describe('GET /api/v1/admin/discounts/campaigns/:campaignId', () => {
  it('reads one campaign with its targets', async () => {
    const setup = adminSetup();
    const campaign = await withCampaign(setup);

    const response = await setup.call('get', `/admin/discounts/campaigns/${campaign.id}`, 'admin');

    expect(response.status).toBe(200);
    expect(adminCampaignResponseSchema.parse(response.body).campaign.id).toBe(campaign.id);
  });

  it('answers 404 for an unknown campaign', async () => {
    const setup = adminSetup();
    const response = await setup.call(
      'get',
      '/admin/discounts/campaigns/00000000-0000-4000-8000-0000000000ff',
      'admin',
    );

    expect(response.status).toBe(404);
    expect(errorOf(response.body).code).toBe('campaign_not_found');
  });
});

describe('PUT /api/v1/admin/discounts/campaigns/:campaignId', () => {
  it('edits a campaign and bumps the version', async () => {
    const setup = adminSetup();
    const campaign = await withCampaign(setup);

    const response = await setup.call(
      'put',
      `/admin/discounts/campaigns/${campaign.id}`,
      'admin',
      newCampaign(setup, { discountValue: 35, expectedVersion: campaign.version }),
    );

    expect(response.status).toBe(200);
    expect(adminCampaignResponseSchema.parse(response.body).campaign).toMatchObject({
      discountValue: 35,
      version: 2,
    });
  });

  it('refuses an edit based on a stale version', async () => {
    const setup = adminSetup();
    const campaign = await withCampaign(setup);
    await setup.call(
      'put',
      `/admin/discounts/campaigns/${campaign.id}`,
      'admin',
      newCampaign(setup, { expectedVersion: campaign.version }),
    );

    const response = await setup.call(
      'put',
      `/admin/discounts/campaigns/${campaign.id}`,
      'admin',
      newCampaign(setup, { expectedVersion: campaign.version }),
    );

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('campaign_conflict');
  });
});

describe('POST /api/v1/admin/discounts/preview', () => {
  it('prices the products a draft campaign would reach', async () => {
    const setup = adminSetup();
    const response = await setup.call('post', '/admin/discounts/preview', 'admin', {
      scope: 'categories',
      discountKind: 'percent',
      discountValue: 20,
      categoryIds: [setup.categories.kitchen.id],
    });

    expect(response.status).toBe(200);
    const preview = campaignPreviewResponseSchema.parse(response.body);
    expect(preview.products.length).toBeGreaterThan(0);
    const lamp = preview.products.find((row) => row.productId === setup.products.lamp.id);
    expect(lamp?.campaignPriceMinor).toBe(8_000);
    expect(lamp?.campaignDiscountMinor).toBe(2_000);
  });

  it('refuses staff, who may not see prices they cannot change', async () => {
    const setup = adminSetup();
    const response = await setup.call('post', '/admin/discounts/preview', 'customer', {
      scope: 'storewide',
      discountKind: 'percent',
      discountValue: 10,
    });

    expect(response.status).toBe(403);
  });
});

describe('POST /api/v1/admin/discounts/campaigns/:campaignId/duplicate', () => {
  it('copies a campaign as a fresh draft', async () => {
    const setup = adminSetup();
    const campaign = await withCampaign(setup);

    const response = await setup.call(
      'post',
      `/admin/discounts/campaigns/${campaign.id}/duplicate`,
      'admin',
    );

    expect(response.status).toBe(201);
    const copy = adminCampaignResponseSchema.parse(response.body).campaign;
    expect(copy).toMatchObject({ name: 'Eid sale (copy)', status: 'draft', version: 1 });
    expect(copy.id).not.toBe(campaign.id);
  });
});

describe('GET /api/v1/admin/discounts/category-campaigns', () => {
  it('reports the live campaigns reaching a category', async () => {
    const setup = adminSetup();
    const campaign = await withCampaign(setup);
    await setup.call('patch', `/admin/discounts/campaigns/${campaign.id}/status`, 'admin', {
      status: 'active',
    });

    const response = await setup.call(
      'get',
      `/admin/discounts/category-campaigns?categoryId=${setup.categories.kitchen.id}`,
      'admin',
    );

    expect(response.status).toBe(200);
    const body = response.body as { campaigns: { campaignId: string; productCount: number }[] };
    expect(body.campaigns).toHaveLength(1);
    expect(body.campaigns[0]?.campaignId).toBe(campaign.id);
    expect(body.campaigns[0]?.productCount).toBeGreaterThan(0);
  });
});

describe('customer-facing campaign routes', () => {
  it('answers an empty list for a store with no live campaign, without a session', async () => {
    const setup = adminSetup();
    const response = await setup.call('get', '/catalog/campaigns');

    expect(response.status).toBe(200);
    expect((response.body as { campaigns: unknown[] }).campaigns).toEqual([]);
  });
});
