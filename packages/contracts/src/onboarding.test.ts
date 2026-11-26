import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_AUDIENCES,
  ONBOARDING_FREQUENCIES,
  ONBOARDING_ICONS,
  ONBOARDING_KINDS,
  ONBOARDING_SKIP_AFTER_SECONDS,
  ONBOARDING_SLIDE_SECONDS,
  onboardingResponseSchema,
  publicOnboardingSchema,
  reorderOnboardingSlidesSchema,
  saveOnboardingCampaignSchema,
  saveOnboardingSlideSchema,
} from './index';

/*
 * Onboarding contracts. The point of these shapes is that an unusable duration, an
 * impossible schedule, an off-site action or a hidden image without alt text is refused
 * before anything reaches the database — and that the public payload cannot carry a
 * management field.
 */

const slide = {
  internalName: 'Welcome / discover',
  heading: 'Discover Nilzora',
  description: 'One shop, carefully chosen things, delivered across Bangladesh.',
};

describe('campaign enums', () => {
  it('names exactly the kinds, audiences, frequencies and durations the app supports', () => {
    expect(ONBOARDING_KINDS).toEqual(['welcome', 'promotion']);
    expect(ONBOARDING_AUDIENCES).toEqual(['all', 'authenticated', 'guest']);
    expect(ONBOARDING_FREQUENCIES).toEqual([
      'first_launch',
      'every_launch',
      'once_per_campaign',
      'interval',
    ]);
    expect(ONBOARDING_SLIDE_SECONDS).toEqual([3, 5, 10]);
    expect(ONBOARDING_SKIP_AFTER_SECONDS).toBe(3);
  });

  it('offers only icons the app can actually draw', () => {
    expect(ONBOARDING_ICONS).toContain('cart');
    expect(ONBOARDING_ICONS).toContain('cash');
    expect(ONBOARDING_ICONS).not.toContain('rocket');
  });
});

describe('saveOnboardingCampaignSchema', () => {
  const base = {
    internalName: 'Welcome sequence',
    kind: 'welcome' as const,
    audience: 'all' as const,
    frequency: 'first_launch' as const,
    slideSeconds: 5 as const,
  };

  it('accepts a welcome sequence with no window and starts it switched off', () => {
    const parsed = saveOnboardingCampaignSchema.parse(base);

    expect(parsed.isActive).toBe(false);
    expect(parsed.startsAt).toBeNull();
    expect(parsed.repeatDays).toBeNull();
  });

  it('refuses a duration that is not 3, 5 or 10 seconds', () => {
    expect(() => saveOnboardingCampaignSchema.parse({ ...base, slideSeconds: 7 })).toThrow();
    expect(saveOnboardingCampaignSchema.parse({ ...base, slideSeconds: 10 }).slideSeconds).toBe(10);
  });

  it('needs a number of days for a repeat interval, and refuses one otherwise', () => {
    expect(() => saveOnboardingCampaignSchema.parse({ ...base, frequency: 'interval' })).toThrow(
      /how many days/,
    );

    const weekly = saveOnboardingCampaignSchema.parse({
      ...base,
      frequency: 'interval',
      repeatDays: 7,
    });
    expect(weekly.repeatDays).toBe(7);

    expect(() => saveOnboardingCampaignSchema.parse({ ...base, repeatDays: 7 })).toThrow(
      /Only a repeat interval/,
    );
  });

  it('requires both ends of a promotion, in order', () => {
    expect(() => saveOnboardingCampaignSchema.parse({ ...base, kind: 'promotion' })).toThrow(
      /start and an end/,
    );

    expect(() =>
      saveOnboardingCampaignSchema.parse({
        ...base,
        kind: 'promotion',
        startsAt: '2026-12-01T00:00:00.000Z',
        endsAt: '2026-11-01T00:00:00.000Z',
      }),
    ).toThrow(/after the start/);

    expect(
      saveOnboardingCampaignSchema.parse({
        ...base,
        kind: 'promotion',
        startsAt: '2026-11-01T00:00:00.000Z',
        endsAt: '2026-12-01T00:00:00.000Z',
      }).endsAt,
    ).toBe('2026-12-01T00:00:00.000Z');
  });

  it('refuses an unknown audience or frequency', () => {
    expect(() => saveOnboardingCampaignSchema.parse({ ...base, audience: 'everyone' })).toThrow();
    expect(() => saveOnboardingCampaignSchema.parse({ ...base, frequency: 'weekly' })).toThrow();
  });
});

describe('saveOnboardingSlideSchema', () => {
  it('accepts a slide with a short heading and description', () => {
    const parsed = saveOnboardingSlideSchema.parse(slide);

    expect(parsed.heading).toBe('Discover Nilzora');
    expect(parsed.isActive).toBe(true);
    expect(parsed.imageKey).toBeNull();
    expect(parsed.icon).toBeNull();
  });

  it('lets the words be optional, but never leaves a slide blank', () => {
    const words = saveOnboardingSlideSchema.parse({
      ...slide,
      heading: ' ',
      description: '',
      imageKey: 'library/abc',
      altText: 'A parcel at a door',
    });
    expect([words.heading, words.description]).toEqual(['', '']);
    // With a picture, no words is a complete slide.
    expect(
      saveOnboardingSlideSchema.safeParse({
        ...slide,
        heading: '',
        description: '',
        imageKey: 'library/abc',
        altText: 'A parcel at a door',
      }).success,
    ).toBe(true);
    // Without words or a picture, there is nothing to show.
    expect(
      saveOnboardingSlideSchema.safeParse({
        ...slide,
        heading: '',
        description: '',
        imageKey: null,
      }).success,
    ).toBe(false);
  });

  it('refuses an over-long heading and description', () => {
    expect(() => saveOnboardingSlideSchema.parse({ ...slide, heading: 'a'.repeat(81) })).toThrow();
    expect(() =>
      saveOnboardingSlideSchema.parse({ ...slide, description: 'a'.repeat(241) }),
    ).toThrow();
  });

  it('validates a media key the media service could have produced', () => {
    expect(
      saveOnboardingSlideSchema.parse({
        ...slide,
        imageKey: 'brand/logo',
        altText: 'The Nilzora mark',
      }).imageKey,
    ).toBe('brand/logo');
    expect(() =>
      saveOnboardingSlideSchema.parse({ ...slide, imageKey: 'https://cdn.example/x.png' }),
    ).toThrow();
    expect(() => saveOnboardingSlideSchema.parse({ ...slide, imageKey: 'elsewhere/x' })).toThrow();
  });

  it('needs alt text whenever the slide has an image', () => {
    expect(() =>
      saveOnboardingSlideSchema.parse({ ...slide, imageKey: 'products/lamp/one' }),
    ).toThrow(/cannot see/);

    expect(
      saveOnboardingSlideSchema.parse({
        ...slide,
        imageKey: 'products/lamp/one',
        altText: 'A brass lamp on a wooden table',
      }).altText,
    ).toBe('A brass lamp on a wooden table');
  });

  it('keeps an action on the store’s own paths and paired with its label', () => {
    expect(
      saveOnboardingSlideSchema.parse({ ...slide, ctaLabel: 'Browse', ctaPath: '/products' })
        .ctaPath,
    ).toBe('/products');

    expect(() => saveOnboardingSlideSchema.parse({ ...slide, ctaLabel: 'Browse' })).toThrow(
      /both a label and a place/,
    );
    expect(() =>
      saveOnboardingSlideSchema.parse({
        ...slide,
        ctaLabel: 'Elsewhere',
        ctaPath: 'https://elsewhere.example',
      }),
    ).toThrow();
    expect(() =>
      saveOnboardingSlideSchema.parse({
        ...slide,
        ctaLabel: 'Evil',
        ctaPath: '//elsewhere.example',
      }),
    ).toThrow();
  });

  it('accepts only a known icon', () => {
    expect(saveOnboardingSlideSchema.parse({ ...slide, icon: 'cart' }).icon).toBe('cart');
    expect(() => saveOnboardingSlideSchema.parse({ ...slide, icon: 'rocket' })).toThrow();
  });
});

describe('public onboarding payload', () => {
  const campaign = {
    id: '0d000000-0000-4000-8000-000000000001',
    kind: 'welcome' as const,
    frequency: 'first_launch' as const,
    slideSeconds: 5 as const,
    slides: [
      {
        id: '0d000000-0000-4000-8000-000000000002',
        heading: 'Discover Nilzora',
        description: 'One shop, carefully chosen things.',
        imageUrl: 'https://media.nilzora.test/seo/welcome/full.webp',
        position: 1,
      },
    ],
  };

  it('carries no management field at all', () => {
    const parsed = publicOnboardingSchema.parse(campaign);
    const text = JSON.stringify(parsed);

    for (const hidden of ['internalName', 'isActive', 'audience', 'campaignId', 'imageKey']) {
      expect(text).not.toContain(hidden);
    }
  });

  it('requires an absolute http(s) image and refuses anything else', () => {
    const withImage = (imageUrl: string | null) => ({
      ...campaign,
      slides: [{ ...campaign.slides[0], imageUrl }],
    });

    expect(() => publicOnboardingSchema.parse(withImage('javascript:alert(1)'))).toThrow();
    expect(() => publicOnboardingSchema.parse(withImage('/seo/welcome/full.webp'))).toThrow();
    expect(publicOnboardingSchema.parse(withImage(null)).slides[0]?.imageUrl).toBeNull();
  });

  it('answers "no campaign" as an explicit null', () => {
    expect(onboardingResponseSchema.parse({ campaign: null }).campaign).toBeNull();
  });
});

describe('reorderOnboardingSlidesSchema', () => {
  it('needs at least one id and refuses more than a carousel can hold', () => {
    const id = '0d000000-0000-4000-8000-000000000002';
    expect(reorderOnboardingSlidesSchema.parse({ slideIds: [id] }).slideIds).toEqual([id]);
    expect(() => reorderOnboardingSlidesSchema.parse({ slideIds: [] })).toThrow();
    expect(() =>
      reorderOnboardingSlidesSchema.parse({
        slideIds: Array.from({ length: 13 }, () => id),
      }),
    ).toThrow();
  });
});
