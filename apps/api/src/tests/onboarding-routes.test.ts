import {
  onboardingCampaignListResponseSchema,
  onboardingCampaignResponseSchema,
  onboardingPreviewResponseSchema,
  onboardingResponseSchema,
  onboardingSlideResponseSchema,
} from '@nilzora/contracts';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { AdminRefusalError } from '../modules/admin/errors';
import { toPublicCampaign, type OnboardingStore } from '../modules/onboarding/store';
import { errorOf } from './commerce-helpers';
import { FakeIdentity } from './fakes';
import { testApp } from './helpers';

/*
 * The onboarding routes: who may read what, who may manage it, and how a refusal is
 * answered. The store is faked here (the SQL is a draft), so these tests prove the HTTP
 * contract — audience-aware reads, ownership of completion, RBAC, validation and error
 * mapping — not that the database rules are correct.
 */

const AT = '2026-11-07T09:00:00.000Z';
const CAMPAIGN_ID = '0d000000-0000-4000-8000-000000000001';
const SLIDE_ID = '0d000000-0000-4000-8000-000000000002';
const MEDIA = 'https://media.nilzora.test';

const campaign = {
  id: CAMPAIGN_ID,
  internalName: 'Welcome sequence',
  kind: 'welcome' as const,
  audience: 'all' as const,
  frequency: 'first_launch' as const,
  repeatDays: null,
  slideSeconds: 5 as const,
  startsAt: null,
  endsAt: null,
  isActive: true,
  updatedAt: AT,
  slides: [
    {
      id: SLIDE_ID,
      campaignId: CAMPAIGN_ID,
      internalName: 'Welcome / discover',
      heading: 'Discover Nilzora',
      description: 'One shop, carefully chosen things.',
      imageKey: 'seo/welcome',
      icon: 'shop' as const,
      ctaLabel: null,
      ctaPath: null,
      altText: 'A shop front',
      position: 1,
      isActive: true,
    },
  ],
};

const publicCampaign = {
  id: CAMPAIGN_ID,
  kind: 'welcome' as const,
  frequency: 'first_launch' as const,
  repeatDays: null,
  slideSeconds: 5 as const,
  endsAt: null,
  slides: [
    {
      id: SLIDE_ID,
      heading: 'Discover Nilzora',
      description: 'One shop, carefully chosen things.',
      imageUrl: `${MEDIA}/seo/welcome/full.webp`,
      icon: 'shop' as const,
      ctaLabel: null,
      ctaPath: null,
      altText: 'A shop front',
      position: 1,
    },
  ],
};

const slideBody = {
  internalName: 'Welcome / discover',
  heading: 'Discover Nilzora',
  description: 'One shop, carefully chosen things.',
  imageKey: 'seo/welcome',
  icon: 'shop',
  altText: 'A shop front',
};

const campaignBody = {
  internalName: 'Welcome sequence',
  kind: 'welcome',
  audience: 'all',
  frequency: 'first_launch',
  slideSeconds: 5,
};

function fakeStore(overrides: Partial<OnboardingStore> = {}): OnboardingStore {
  return {
    publicCampaign: vi.fn().mockResolvedValue(publicCampaign),
    complete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([
      {
        id: CAMPAIGN_ID,
        internalName: 'Welcome sequence',
        kind: 'welcome',
        audience: 'all',
        frequency: 'first_launch',
        repeatDays: null,
        slideSeconds: 5,
        startsAt: null,
        endsAt: null,
        isActive: true,
        slideCount: 1,
        activeSlideCount: 1,
        updatedAt: AT,
      },
    ]),
    get: vi.fn().mockResolvedValue(campaign),
    saveCampaign: vi.fn().mockResolvedValue(CAMPAIGN_ID),
    setActive: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    preview: vi.fn().mockResolvedValue(publicCampaign),
    saveSlide: vi.fn().mockResolvedValue(campaign.slides[0]),
    deleteSlide: vi.fn().mockResolvedValue(undefined),
    reorder: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function setup(store: OnboardingStore = fakeStore()) {
  const identity = new FakeIdentity();
  const customer = identity.addUser({ email: 'guest@example.com' });
  const otherCustomer = identity.addUser({ email: 'other@example.com' });
  const staff = identity.addUser({ email: 'staff@example.com', role: 'staff' });
  const owner = identity.addUser({ email: 'owner@example.com', role: 'super_admin' });
  const app = testApp({ auth: identity.deps, onboarding: store });

  const tokens = {
    customer: identity.tokenFor(customer),
    otherCustomer: identity.tokenFor(otherCustomer),
    staff: identity.tokenFor(staff),
    owner: identity.tokenFor(owner),
  };

  function call(
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    who?: keyof typeof tokens,
    body?: object,
  ) {
    let pending = request(app)[method](`/api/v1${path}`);
    if (who !== undefined) pending = pending.set('Authorization', `Bearer ${tokens[who]}`);
    return body === undefined ? pending : pending.send(body);
  }

  const ids = { customer: customer.id, otherCustomer: otherCustomer.id };
  return { store, call, tokens, app, ids };
}

describe('the public onboarding read', () => {
  it('answers a guest without a session, as an anonymous caller', async () => {
    const { store, call } = setup();
    const response = await call('get', '/onboarding');

    expect(response.status).toBe(200);
    const parsed = onboardingResponseSchema.parse(response.body);
    expect(parsed.campaign?.slides[0]?.heading).toBe('Discover Nilzora');
    // No token: the store must ask the database as an anonymous visitor.
    expect(store.publicCampaign).toHaveBeenCalledWith(null, null);
  });

  it('asks on behalf of a signed-in customer: their token and their verified account id', async () => {
    const { store, call, tokens, ids } = setup();
    const response = await call('get', '/onboarding', 'customer');

    expect(response.status).toBe(200);
    expect(store.publicCampaign).toHaveBeenCalledWith(tokens.customer, ids.customer);
  });

  it('takes the account from the verified token, never from anything the client sends', async () => {
    const { store, app, tokens, ids } = setup();
    await request(app)
      .get('/api/v1/onboarding?userId=' + ids.otherCustomer)
      .set('Authorization', 'Bearer ' + tokens.customer)
      .set('X-User-Id', ids.otherCustomer);

    expect(store.publicCampaign).toHaveBeenCalledWith(tokens.customer, ids.customer);
  });

  it('refuses a token that is not valid rather than quietly answering as a guest', async () => {
    const { app, store } = setup();
    const response = await request(app)
      .get('/api/v1/onboarding')
      .set('Authorization', 'Bearer not-a-real-token');

    expect(response.status).toBe(401);
    expect((response.body as { error: { code: string } }).error.code).toBe('unauthenticated');
    // A stale session must never be downgraded to guest content.
    expect(store.publicCampaign).not.toHaveBeenCalled();
  });

  it('says "no campaign" explicitly when nothing is eligible', async () => {
    const { call } = setup(fakeStore({ publicCampaign: vi.fn().mockResolvedValue(null) }));
    const response = await call('get', '/onboarding');

    expect(response.status).toBe(200);
    expect(onboardingResponseSchema.parse(response.body).campaign).toBeNull();
  });
});

describe('recording completion', () => {
  it('records it for the signed-in caller, under their own account', async () => {
    const { store, call, tokens, ids } = setup();
    const response = await call('post', `/onboarding/${CAMPAIGN_ID}/complete`, 'customer');

    expect(response.status).toBe(204);
    expect(store.complete).toHaveBeenCalledWith(tokens.customer, ids.customer, CAMPAIGN_ID);
  });

  it('cannot be pointed at another customer: the account comes only from the token', async () => {
    const { store, app, tokens, ids } = setup();
    const response = await request(app)
      .post(`/api/v1/onboarding/${CAMPAIGN_ID}/complete?userId=${ids.otherCustomer}`)
      .set('Authorization', 'Bearer ' + tokens.customer)
      .set('X-User-Id', ids.otherCustomer)
      .send({ userId: ids.otherCustomer, user_id: ids.otherCustomer });

    expect(response.status).toBe(204);
    expect(store.complete).toHaveBeenCalledTimes(1);
    expect(store.complete).toHaveBeenCalledWith(tokens.customer, ids.customer, CAMPAIGN_ID);
    expect(vi.mocked(store.complete).mock.calls[0]).not.toContain(ids.otherCustomer);
  });

  it('records each customer under their own account', async () => {
    const { store, call, ids } = setup();
    await call('post', `/onboarding/${CAMPAIGN_ID}/complete`, 'customer');
    await call('post', `/onboarding/${CAMPAIGN_ID}/complete`, 'otherCustomer');

    const recordedFor = vi.mocked(store.complete).mock.calls.map((call) => call[1]);
    expect(recordedFor).toEqual([ids.customer, ids.otherCustomer]);
  });

  it('records nothing for a token that is not valid', async () => {
    const { store, app } = setup();
    const response = await request(app)
      .post(`/api/v1/onboarding/${CAMPAIGN_ID}/complete`)
      .set('Authorization', 'Bearer not-a-real-token');

    expect(response.status).toBe(401);
    expect(store.complete).not.toHaveBeenCalled();
  });

  it('needs a session', async () => {
    const { call } = setup();
    expect((await call('post', `/onboarding/${CAMPAIGN_ID}/complete`)).status).toBe(401);
  });

  it('refuses an id that is not a campaign id', async () => {
    const { store, call } = setup();
    const response = await call('post', '/onboarding/not-a-uuid/complete', 'customer');

    expect(response.status).toBe(400);
    expect(store.complete).not.toHaveBeenCalled();
  });

  it('answers a campaign the caller may not see with 404', async () => {
    const { call } = setup(
      fakeStore({
        complete: vi.fn().mockRejectedValue(new AdminRefusalError('onboarding_not_found')),
      }),
    );
    const response = await call('post', `/onboarding/${CAMPAIGN_ID}/complete`, 'customer');

    expect(response.status).toBe(404);
    expect(errorOf(response.body).code).toBe('onboarding_not_found');
  });
});

describe('managing campaigns', () => {
  it('needs settings.manage, not merely a staff account', async () => {
    const { call } = setup();

    expect((await call('get', '/admin/onboarding')).status).toBe(401);
    expect((await call('get', '/admin/onboarding', 'staff')).status).toBe(403);
    expect((await call('get', '/admin/onboarding', 'customer')).status).toBe(403);
    expect((await call('get', '/admin/onboarding', 'owner')).status).toBe(200);
  });

  it('lists campaigns with their slide counts', async () => {
    const { call } = setup();
    const response = await call('get', '/admin/onboarding', 'owner');

    const parsed = onboardingCampaignListResponseSchema.parse(response.body);
    expect(parsed.campaigns[0]).toMatchObject({
      slideCount: 1,
      activeSlideCount: 1,
      isActive: true,
    });
  });

  it('creates a campaign and returns it', async () => {
    const { store, call } = setup();
    const response = await call('post', '/admin/onboarding', 'owner', campaignBody);

    expect(response.status).toBe(201);
    expect(onboardingCampaignResponseSchema.parse(response.body).campaign.id).toBe(CAMPAIGN_ID);
    expect(store.saveCampaign).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      null,
      expect.objectContaining({ internalName: 'Welcome sequence', slideSeconds: 5 }),
    );
  });

  it('updates a campaign by id', async () => {
    const { store, call } = setup();
    const response = await call('put', `/admin/onboarding/${CAMPAIGN_ID}`, 'owner', {
      ...campaignBody,
      isActive: true,
    });

    expect(response.status).toBe(200);
    expect(store.saveCampaign).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      CAMPAIGN_ID,
      expect.objectContaining({ isActive: true }),
    );
  });

  it('refuses an impossible duration, a promotion with no window and a bad audience', async () => {
    const { store, call } = setup();

    expect(
      (await call('post', '/admin/onboarding', 'owner', { ...campaignBody, slideSeconds: 7 }))
        .status,
    ).toBe(400);

    expect(
      (
        await call('post', '/admin/onboarding', 'owner', {
          ...campaignBody,
          kind: 'promotion',
        })
      ).status,
    ).toBe(400);

    expect(
      (await call('post', '/admin/onboarding', 'owner', { ...campaignBody, audience: 'everyone' }))
        .status,
    ).toBe(400);

    expect(store.saveCampaign).not.toHaveBeenCalled();
  });

  it('activates and deactivates in one call', async () => {
    const { store, call } = setup();
    const response = await call('post', `/admin/onboarding/${CAMPAIGN_ID}/active`, 'owner', {
      active: false,
    });

    expect(response.status).toBe(204);
    expect(store.setActive).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      CAMPAIGN_ID,
      false,
    );
  });

  it('reports a conflicting activation as 409', async () => {
    const { call } = setup(
      fakeStore({
        setActive: vi.fn().mockRejectedValue(new AdminRefusalError('onboarding_conflict')),
      }),
    );
    const response = await call('post', `/admin/onboarding/${CAMPAIGN_ID}/active`, 'owner', {
      active: true,
    });

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('onboarding_conflict');
  });

  it('deletes, previews and answers a missing campaign', async () => {
    const { store, call } = setup();
    expect((await call('delete', `/admin/onboarding/${CAMPAIGN_ID}`, 'owner')).status).toBe(204);
    expect(store.remove).toHaveBeenCalled();

    const preview = await call('get', `/admin/onboarding/${CAMPAIGN_ID}/preview`, 'owner');
    expect(preview.status).toBe(200);
    // A preview is the customer-facing shape: resolved media, no internal fields.
    const parsed = onboardingPreviewResponseSchema.parse(preview.body);
    expect(JSON.stringify(parsed)).not.toContain('internalName');
    expect(parsed.campaign.slides[0]?.imageUrl).toBe(`${MEDIA}/seo/welcome/full.webp`);

    const missing = await call('get', `/admin/onboarding/${randomUUID()}`, 'owner');
    expect(onboardingCampaignResponseSchema.safeParse(missing.body).success).toBe(true);
  });
});

describe('managing slides', () => {
  it('creates, updates, reorders and deletes slides', async () => {
    const { store, call } = setup();

    const created = await call(
      'post',
      `/admin/onboarding/${CAMPAIGN_ID}/slides`,
      'owner',
      slideBody,
    );
    expect(created.status).toBe(201);
    expect(onboardingSlideResponseSchema.parse(created.body).slide.id).toBe(SLIDE_ID);

    const updated = await call(
      'put',
      `/admin/onboarding/${CAMPAIGN_ID}/slides/${SLIDE_ID}`,
      'owner',
      slideBody,
    );
    expect(updated.status).toBe(200);
    expect(store.saveSlide).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      SLIDE_ID,
      CAMPAIGN_ID,
      expect.objectContaining({ heading: 'Discover Nilzora' }),
    );

    const reordered = await call(
      'post',
      `/admin/onboarding/${CAMPAIGN_ID}/slides/reorder`,
      'owner',
      { slideIds: [SLIDE_ID] },
    );
    expect(reordered.status).toBe(204);
    expect(store.reorder).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      CAMPAIGN_ID,
      [SLIDE_ID],
    );

    const removed = await call(
      'delete',
      `/admin/onboarding/${CAMPAIGN_ID}/slides/${SLIDE_ID}`,
      'owner',
    );
    expect(removed.status).toBe(204);
    expect(store.deleteSlide).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      SLIDE_ID,
    );
  });

  it('accepts a slide with no heading when it has a description or a picture', async () => {
    const { store, call } = setup();

    const response = await call('post', `/admin/onboarding/${CAMPAIGN_ID}/slides`, 'owner', {
      ...slideBody,
      heading: '',
    });

    expect(response.status).toBe(201);
    expect(store.saveSlide).toHaveBeenCalledTimes(1);
  });

  it('refuses a slide with no words and no picture, an off-site action or a missing alt text', async () => {
    const { store, call } = setup();

    expect(
      (
        await call('post', `/admin/onboarding/${CAMPAIGN_ID}/slides`, 'owner', {
          ...slideBody,
          heading: '',
          description: '',
          imageKey: null,
          altText: null,
        })
      ).status,
    ).toBe(400);

    expect(
      (
        await call('post', `/admin/onboarding/${CAMPAIGN_ID}/slides`, 'owner', {
          ...slideBody,
          ctaLabel: 'Elsewhere',
          ctaPath: 'https://elsewhere.example',
        })
      ).status,
    ).toBe(400);

    expect(
      (
        await call('post', `/admin/onboarding/${CAMPAIGN_ID}/slides`, 'owner', {
          ...slideBody,
          altText: null,
        })
      ).status,
    ).toBe(400);

    expect(store.saveSlide).not.toHaveBeenCalled();
  });

  it('refuses reordering with an empty list', async () => {
    const { store, call } = setup();
    const response = await call(
      'post',
      `/admin/onboarding/${CAMPAIGN_ID}/slides/reorder`,
      'owner',
      { slideIds: [] },
    );

    expect(response.status).toBe(400);
    expect(store.reorder).not.toHaveBeenCalled();
  });
});

describe('toPublicCampaign', () => {
  const payload = {
    id: CAMPAIGN_ID,
    kind: 'welcome',
    frequency: 'first_launch',
    repeatDays: null,
    slideSeconds: 5,
    endsAt: null,
    slides: [
      {
        id: SLIDE_ID,
        heading: 'Discover Nilzora',
        description: 'One shop.',
        imageKey: 'seo/welcome',
        icon: 'shop',
        ctaLabel: null,
        ctaPath: null,
        altText: 'A shop front',
        position: 1,
      },
    ],
  };

  it('resolves a stored key into a public URL, never a key', () => {
    const presented = toPublicCampaign(payload, MEDIA);

    expect(presented?.slides[0]?.imageUrl).toBe(`${MEDIA}/seo/welcome/full.webp`);
    expect(JSON.stringify(presented)).not.toContain('imageKey');
  });

  it('leaves the image empty when there is no key or no media configured', () => {
    expect(
      toPublicCampaign({ ...payload, slides: [{ ...payload.slides[0], imageKey: null }] }, MEDIA)
        ?.slides[0]?.imageUrl,
    ).toBeNull();
    expect(toPublicCampaign(payload, undefined)?.slides[0]?.imageUrl).toBeNull();
  });

  it('refuses a stored key that is really an address', () => {
    expect(
      toPublicCampaign(
        { ...payload, slides: [{ ...payload.slides[0], imageKey: 'https://elsewhere.example/x' }] },
        MEDIA,
      )?.slides[0]?.imageUrl,
    ).toBeNull();
  });

  it('treats a campaign with no enabled slide as nothing to show', () => {
    expect(toPublicCampaign(null, MEDIA)).toBeNull();
    expect(toPublicCampaign({ ...payload, slides: [] }, MEDIA)).toBeNull();
  });
});
