import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';

/*
 * The onboarding methods: the public read must work with and without a session, and the
 * management calls must send the token, the right path and the body the API validates.
 */

const ACCESS = 'access-token-1';
const CAMPAIGN = '0f000000-0000-4000-8000-00000000c001';
const SLIDE = '0f000000-0000-4000-8000-00000000d001';
const AT = '2026-11-07T09:00:00.000Z';

const campaign = {
  id: CAMPAIGN,
  internalName: 'Welcome sequence',
  kind: 'welcome',
  audience: 'all',
  frequency: 'first_launch',
  repeatDays: null,
  slideSeconds: 5,
  startsAt: null,
  endsAt: null,
  isActive: true,
  updatedAt: AT,
  slides: [
    {
      id: SLIDE,
      campaignId: CAMPAIGN,
      internalName: 'Welcome / discover',
      heading: 'Discover Nilzora',
      description: 'One shop, chosen with care.',
      imageKey: null,
      icon: 'shop',
      ctaLabel: null,
      ctaPath: null,
      altText: null,
      position: 1,
      isActive: true,
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

function setup(response: Response) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  const client = createApiClient({ baseUrl: 'http://localhost:4000', fetch: fetchMock });
  const sent = () => {
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    return {
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : init?.body,
    };
  };
  return { client, sent };
}

describe('publicOnboarding', () => {
  it('reads the campaign as a guest, with no Authorization header', async () => {
    const { client, sent } = setup(jsonResponse({ campaign: null }));

    await expect(client.publicOnboarding()).resolves.toStrictEqual({ campaign: null });
    const request = sent();
    expect(request.url).toBe('http://localhost:4000/api/v1/onboarding');
    expect(request.method).toBe('GET');
    expect(request.headers.get('Authorization')).toBeNull();
  });

  it('reads as a signed-in customer when a token is given', async () => {
    const { client, sent } = setup(jsonResponse({ campaign: null }));

    await client.publicOnboarding(ACCESS);

    expect(sent().headers.get('Authorization')).toBe(`Bearer ${ACCESS}`);
  });

  it('refuses an answer outside the contract', async () => {
    const { client } = setup(jsonResponse({ campaign: { id: 'not-a-uuid' } }));

    await expect(client.publicOnboarding()).rejects.toMatchObject({
      name: 'ApiError',
      code: 'invalid_response',
    });
  });
});

describe('completeOnboarding', () => {
  it('posts the completion for one campaign', async () => {
    const { client, sent } = setup(noContent());

    await expect(client.completeOnboarding(ACCESS, CAMPAIGN)).resolves.toBeUndefined();
    const request = sent();
    expect(request.url).toBe(
      `http://localhost:4000/api/v1/onboarding/${CAMPAIGN}/complete`,
    );
    expect(request.method).toBe('POST');
    expect(request.headers.get('Authorization')).toBe(`Bearer ${ACCESS}`);
  });
});

describe('admin onboarding management', () => {
  it('creates a campaign', async () => {
    const { client, sent } = setup(jsonResponse({ campaign }, 201));
    const input = {
      internalName: 'Welcome sequence',
      kind: 'welcome' as const,
      audience: 'all' as const,
      frequency: 'first_launch' as const,
      slideSeconds: 5 as const,
      isActive: false,
    };

    await expect(client.createOnboardingCampaign(ACCESS, input)).resolves.toStrictEqual({
      campaign,
    });
    expect(sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/admin/onboarding',
      method: 'POST',
      body: input,
    });
  });

  it('updates a campaign at its own address', async () => {
    const { client, sent } = setup(jsonResponse({ campaign }));

    await client.updateOnboardingCampaign(ACCESS, CAMPAIGN, {
      internalName: 'Welcome sequence',
      kind: 'welcome',
      audience: 'all',
      frequency: 'first_launch',
      slideSeconds: 10,
      isActive: true,
    });

    expect(sent()).toMatchObject({
      url: `http://localhost:4000/api/v1/admin/onboarding/${CAMPAIGN}`,
      method: 'PUT',
    });
  });

  it('switches a campaign on and off', async () => {
    const { client, sent } = setup(noContent());

    await client.setOnboardingCampaignActive(ACCESS, CAMPAIGN, false);

    expect(sent()).toMatchObject({
      url: `http://localhost:4000/api/v1/admin/onboarding/${CAMPAIGN}/active`,
      method: 'POST',
      body: { active: false },
    });
  });

  it('sends the slide order it rendered', async () => {
    const { client, sent } = setup(noContent());

    await client.reorderOnboardingSlides(ACCESS, CAMPAIGN, [SLIDE]);

    expect(sent()).toMatchObject({
      url: `http://localhost:4000/api/v1/admin/onboarding/${CAMPAIGN}/slides/reorder`,
      method: 'POST',
      body: { slideIds: [SLIDE] },
    });
  });

  it('reads the preview a customer would see', async () => {
    const preview = {
      campaign: {
        id: CAMPAIGN,
        kind: 'welcome',
        frequency: 'first_launch',
        repeatDays: null,
        slideSeconds: 5,
        endsAt: null,
        slides: [
          {
            id: SLIDE,
            heading: 'Discover Nilzora',
            description: 'One shop, chosen with care.',
            imageUrl: null,
            icon: 'shop',
            ctaLabel: null,
            ctaPath: null,
            altText: null,
            position: 1,
          },
        ],
      },
    };
    const { client, sent } = setup(jsonResponse(preview));

    await expect(client.previewOnboardingCampaign(ACCESS, CAMPAIGN)).resolves.toStrictEqual(
      preview,
    );
    expect(sent().url).toBe(
      `http://localhost:4000/api/v1/admin/onboarding/${CAMPAIGN}/preview`,
    );
  });

  it('deletes a slide from its campaign', async () => {
    const { client, sent } = setup(noContent());

    await client.deleteOnboardingSlide(ACCESS, CAMPAIGN, SLIDE);

    expect(sent()).toMatchObject({
      url: `http://localhost:4000/api/v1/admin/onboarding/${CAMPAIGN}/slides/${SLIDE}`,
      method: 'DELETE',
    });
  });
});
