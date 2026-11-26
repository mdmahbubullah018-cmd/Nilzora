import { describe, expect, it } from 'vitest';
import {
  adminSaveShoppingZoneRequestSchema,
  adminShoppingZoneListQuerySchema,
  adminShoppingZoneProductsRequestSchema,
  shoppingZoneSchema,
  shoppingZonesResponseSchema,
  zoneAudienceSchema,
} from './shopping-zones';
import { productListQuerySchema } from './catalog';

/*
 * The shopping-zone contracts: what a zone may be, and what a listing may ask for. The
 * resolution rule (pinned products, otherwise the category) is the database's; these schemas
 * only keep bad input away from it.
 */

const zoneId = '3f2a1b4c-0000-4000-8000-000000000001';

function zone(overrides: Record<string, unknown> = {}) {
  return {
    id: zoneId,
    slug: 'mens',
    name: "Men's",
    description: null,
    audience: 'men',
    banner: null,
    bannerAlt: null,
    mobileBanner: null,
    productCount: 3,
    ...overrides,
  };
}

describe('a zone as clients read it', () => {
  it('accepts a zone without a picture, because the store draws its own tile', () => {
    expect(shoppingZoneSchema.safeParse(zone()).success).toBe(true);
  });

  it('accepts a resolved banner', () => {
    const parsed = shoppingZoneSchema.parse(
      zone({
        banner: { url: 'https://media/x/full.webp', thumbUrl: 'https://media/x/thumb.webp' },
      }),
    );
    expect(parsed.banner?.url).toBe('https://media/x/full.webp');
  });

  it('keeps the app artwork separate from the website picture', () => {
    const parsed = shoppingZoneSchema.parse(
      zone({
        banner: { url: 'https://media/site/full.webp', thumbUrl: 'https://media/site/thumb.webp' },
        mobileBanner: {
          url: 'https://media/app/full.webp',
          thumbUrl: 'https://media/app/thumb.webp',
        },
      }),
    );
    expect(parsed.banner?.url).toBe('https://media/site/full.webp');
    expect(parsed.mobileBanner?.url).toBe('https://media/app/full.webp');
  });

  it('reads a zone from an API that has not learned about app artwork yet', () => {
    const { mobileBanner: _omitted, ...older } = zone();
    const parsed = shoppingZoneSchema.parse(older);

    expect(parsed.mobileBanner).toBeNull();
  });

  it('refuses a picture that is only half there', () => {
    expect(shoppingZoneSchema.safeParse(zone({ banner: { url: 'https://media/x' } })).success).toBe(
      false,
    );
  });

  it('refuses a negative product count', () => {
    expect(shoppingZoneSchema.safeParse(zone({ productCount: -1 })).success).toBe(false);
  });

  it('reads a list of zones', () => {
    expect(shoppingZonesResponseSchema.parse({ zones: [zone()] }).zones).toHaveLength(1);
  });
});

describe('the audience label', () => {
  it('accepts a single lower-case word, and nothing', () => {
    expect(zoneAudienceSchema.safeParse('men').success).toBe(true);
    expect(zoneAudienceSchema.safeParse('kids').success).toBe(true);
    expect(zoneAudienceSchema.safeParse(null).success).toBe(true);
  });

  it('refuses capitals, spaces and empty text', () => {
    expect(zoneAudienceSchema.safeParse('Men').success).toBe(false);
    expect(zoneAudienceSchema.safeParse('young adults').success).toBe(false);
    expect(zoneAudienceSchema.safeParse('').success).toBe(false);
  });
});

describe('saving a zone', () => {
  it('needs a name and defaults to nothing extra', () => {
    const parsed = adminSaveShoppingZoneRequestSchema.parse({ name: 'Eid' });
    expect(parsed).toMatchObject({ name: 'Eid', displayOrder: 0, isActive: true });
  });

  it('refuses a blank name', () => {
    expect(adminSaveShoppingZoneRequestSchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('takes the associations as plain id lists', () => {
    expect(
      adminShoppingZoneProductsRequestSchema.parse({ productIds: [zoneId] }).productIds,
    ).toEqual([zoneId]);
    expect(adminShoppingZoneProductsRequestSchema.safeParse({ productIds: ['nope'] }).success).toBe(
      false,
    );
    // Unknown keys are refused, so a typo cannot quietly change nothing.
    expect(
      adminShoppingZoneProductsRequestSchema.safeParse({ productIds: [zoneId], extra: 1 }).success,
    ).toBe(false);
  });
});

describe('the workspace list query', () => {
  it('defaults to every zone, in display order', () => {
    expect(adminShoppingZoneListQuerySchema.parse({})).toMatchObject({
      status: 'all',
      sort: 'order',
      page: 1,
    });
  });

  it('refuses an unknown status', () => {
    expect(adminShoppingZoneListQuerySchema.safeParse({ status: 'archived' }).success).toBe(false);
  });
});

describe('a listing narrowed to a collection', () => {
  it('takes a zone slug', () => {
    expect(productListQuerySchema.parse({ zone: 'mens' }).zone).toBe('mens');
  });

  it('refuses an address that cannot be a slug', () => {
    expect(productListQuerySchema.safeParse({ zone: 'Not A Slug' }).success).toBe(false);
  });

  it('refuses best-match ranking inside a collection, which the API cannot rank', () => {
    expect(productListQuerySchema.safeParse({ zone: 'mens', sort: 'relevance' }).success).toBe(
      false,
    );
    expect(productListQuerySchema.safeParse({ zone: 'mens', sort: 'newest' }).success).toBe(true);
  });
});
