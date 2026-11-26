import { describe, expect, it } from 'vitest';
import { apiErrorBodySchema, validationErrorDetailsSchema } from './api';
import { categorySchema, productSummarySchema } from './catalog';
import { healthResponseSchema } from './health';

describe('healthResponseSchema', () => {
  const valid = {
    status: 'ok',
    service: 'nilzora-api',
    uptimeSeconds: 42,
    timestamp: '2026-10-22T10:00:00.000Z',
    database: { target: 'hosted', connection: 'pooler', projectRef: 'abcdefghijklmnopqrst' },
  };

  it('accepts a valid health payload', () => {
    expect(healthResponseSchema.parse(valid)).toStrictEqual(valid);
  });

  it('requires the database target so a wrong stack is always visible', () => {
    const { database: _database, ...withoutTarget } = valid;
    expect(healthResponseSchema.safeParse(withoutTarget).success).toBe(false);
  });

  it('accepts a local target with no project ref', () => {
    const local = { ...valid, database: { target: 'local', connection: 'local', projectRef: null } };
    expect(healthResponseSchema.parse(local)).toStrictEqual(local);
  });

  it.each([
    { ...valid, status: 'degraded' },
    { ...valid, service: 'other-service' },
    { ...valid, uptimeSeconds: -1 },
    { ...valid, timestamp: 'yesterday' },
    { ...valid, database: { target: 'staging', connection: 'pooler', projectRef: null } },
    { ...valid, database: { target: 'hosted', connection: 'vpn', projectRef: null } },
  ])('rejects %j', (payload) => {
    expect(healthResponseSchema.safeParse(payload).success).toBe(false);
  });
});

describe('apiErrorBodySchema', () => {
  it('accepts the standard error envelope', () => {
    const body = { error: { code: 'not_found', message: 'Route not found', requestId: 'req-1' } };
    expect(apiErrorBodySchema.parse(body)).toStrictEqual(body);
  });

  it('rejects bodies without an error code', () => {
    expect(apiErrorBodySchema.safeParse({ error: { message: 'Oops' } }).success).toBe(false);
  });
});

describe('validationErrorDetailsSchema', () => {
  it('accepts issues located in params, query or body', () => {
    const details = {
      issues: [
        { location: 'query', path: 'page', message: 'Too small' },
        { location: 'body', path: '', message: 'Expected object' },
      ],
    };
    expect(validationErrorDetailsSchema.parse(details)).toStrictEqual(details);
  });

  it('rejects unknown issue locations', () => {
    const details = { issues: [{ location: 'headers', path: 'x', message: 'Bad' }] };
    expect(validationErrorDetailsSchema.safeParse(details).success).toBe(false);
  });
});

describe('categorySchema', () => {
  const base = { slug: 'fashion', name: 'Fashion', description: null, productCount: 3 };
  it('describes a top-level department without a cover', () => {
    expect(categorySchema.parse(base)).toStrictEqual({
      ...base,
      image: null,
      parentSlug: null,
      depth: 1,
      isFeatured: false,
    });
  });

  it('carries the cover picture and the parent of a subcategory', () => {
    const subcategory = categorySchema.parse({
      ...base,
      slug: 'shirts',
      parentSlug: 'fashion',
      depth: 2,
      isFeatured: true,
      image: {
        url: 'https://media.example.com/categories/c/full.webp',
        thumbUrl: 'https://media.example.com/categories/c/thumb.webp',
      },
    });

    expect(subcategory).toMatchObject({
      parentSlug: 'fashion',
      depth: 2,
      isFeatured: true,
      image: { url: 'https://media.example.com/categories/c/full.webp' },
    });
  });

  it('still parses a payload from an API that predates the tree fields', () => {
    // Additive change: the four new fields default, so an older response stays valid.
    expect(categorySchema.parse(base)).toStrictEqual({
      ...base,
      image: null,
      parentSlug: null,
      depth: 1,
      isFeatured: false,
    });
  });

  it('rejects a cover that is not made of URLs', () => {
    const result = categorySchema.safeParse({
      ...base,
      image: { url: 'not-a-url', thumbUrl: 'not-a-url' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an impossible hierarchy', () => {
    // The database caps the tree at three levels and slugs are lower-case.
    expect(categorySchema.safeParse({ ...base, depth: 4 }).success).toBe(false);
    expect(categorySchema.safeParse({ ...base, depth: 0 }).success).toBe(false);
    expect(categorySchema.safeParse({ ...base, parentSlug: 'Not A Slug' }).success).toBe(false);
  });
});

describe('productSummarySchema colours', () => {
  const base = {
    id: '0d000000-0000-4000-8000-000000000001',
    slug: 'premium-panjabi',
    sku: 'NZ-TEST-1',
    name: 'Premium panjabi',
    summary: null,
    priceMinor: 102_000,
    compareAtPriceMinor: null,
    availability: 'in_stock',
    maxOrderQuantity: 10,
    isFeatured: false,
    category: { slug: 'fashion', name: 'Fashion' },
    image: null,
  };

  it('accepts the colour preview the API now sends', () => {
    const colors = [
      { valueSlug: 'black', value: 'Black', swatchHex: '#0F172A' },
      { valueSlug: 'white', value: 'White', swatchHex: '#F1F5F9' },
    ];
    expect(productSummarySchema.parse({ ...base, colors }).colors).toStrictEqual(colors);
  });

  it('stays valid without colours, so an older API keeps working', () => {
    expect(productSummarySchema.parse(base).colors).toBeUndefined();
  });

  it('rejects a swatch that is not a six-digit hex colour', () => {
    const colors = [{ valueSlug: 'black', value: 'Black', swatchHex: 'black' }];
    expect(productSummarySchema.safeParse({ ...base, colors }).success).toBe(false);
  });
});
