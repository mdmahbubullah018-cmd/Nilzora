import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_SEGMENT_LABELS,
  CUSTOMER_SEGMENTS,
  canonicalPathSchema,
  customerInsightQuerySchema,
  mediaKeySchema,
  publicStoreProfileSchema,
  saveSeoRequestSchema,
  saveStoreProfileRequestSchema,
  seoMetadataSchema,
  seoOverviewQuerySchema,
  staffNotificationKindSchema,
  staffNotificationEntityTypeSchema,
  staffNotificationQuerySchema,
  staffNotificationSchema,
} from './index';

/*
 * Phase 3 contracts. The point of these shapes is that an off-site canonical, an invented
 * media path or an unset store name is refused before anything reaches the database.
 */

describe('canonicalPathSchema', () => {
  it('accepts a path on this site', () => {
    expect(canonicalPathSchema.parse('/products/desk-lamp')).toBe('/products/desk-lamp');
  });

  it('refuses another origin, so a canonical can never point off-site', () => {
    expect(() => canonicalPathSchema.parse('https://example.com/x')).toThrow();
    expect(() => canonicalPathSchema.parse('//example.com/x')).toThrow();
  });
});

describe('mediaKeySchema', () => {
  it('accepts a key the media service produced', () => {
    expect(mediaKeySchema.parse('products/abc/def')).toBe('products/abc/def');
    expect(mediaKeySchema.parse('brand/logo')).toBe('brand/logo');
  });

  it('refuses a full URL or an unknown folder', () => {
    expect(() => mediaKeySchema.parse('https://cdn.example.com/a.png')).toThrow();
    expect(() => mediaKeySchema.parse('elsewhere/a')).toThrow();
  });
});

describe('saveSeoRequestSchema', () => {
  it('defaults every field to unset, which means "use the page’s own text"', () => {
    const parsed = saveSeoRequestSchema.parse({});
    expect(parsed).toEqual({
      seoTitle: null,
      seoDescription: null,
      ogTitle: null,
      ogDescription: null,
      ogImageKey: null,
      canonicalPath: null,
      noIndex: false,
    });
  });

  it('refuses a search title longer than a search result shows', () => {
    expect(() => saveSeoRequestSchema.parse({ seoTitle: 'a'.repeat(71) })).toThrow();
  });
});

describe('seoOverviewQuerySchema', () => {
  it('trims the search and defaults it to empty', () => {
    expect(seoOverviewQuerySchema.parse({ q: '  lamp ' }).q).toBe('lamp');
    expect(seoOverviewQuerySchema.parse({}).q).toBe('');
  });
});

describe('saveStoreProfileRequestSchema', () => {
  it('needs a store name and nothing else', () => {
    const parsed = saveStoreProfileRequestSchema.parse({ displayName: 'Nilzora' });
    expect(parsed.displayName).toBe('Nilzora');
    expect(parsed.supportEmail).toBeNull();
    expect(parsed.socialFacebook).toBeNull();
  });

  it('refuses an empty name and an address that is not an email', () => {
    expect(() => saveStoreProfileRequestSchema.parse({ displayName: ' ' })).toThrow();
    expect(() =>
      saveStoreProfileRequestSchema.parse({ displayName: 'Nilzora', contactEmail: 'not-an-email' }),
    ).toThrow();
  });

  it('refuses a social link that is not a URL', () => {
    expect(() =>
      saveStoreProfileRequestSchema.parse({ displayName: 'Nilzora', socialFacebook: 'facebook' }),
    ).toThrow();
  });
});

describe('staff notifications', () => {
  it('names every value of the database enum, chat kinds included', () => {
    expect(staffNotificationKindSchema.options).toEqual([
      'order_new',
      'stock_low',
      'return_new',
      'refund_action',
      'moderation_pending',
      'chat_message',
      'chat_escalation',
    ]);
  });

  it('accepts every entity type the table allows', () => {
    expect(staffNotificationEntityTypeSchema.options).toEqual([
      'order',
      'product',
      'return',
      'refund',
      'conversation',
    ]);
  });

  it('reads a chat notification, the row that used to make the inbox fail', () => {
    const notification = staffNotificationSchema.parse({
      id: 'c8b7b4b5-aedb-47d6-ac98-20aa64261311',
      kind: 'chat_message',
      title: 'New message from a customer',
      body: null,
      entityType: 'conversation',
      entityId: '2e186311-5cbc-485c-a188-1705b09dfc8d',
      actionPath: '/admin/communication?conversation=2e186311-5cbc-485c-a188-1705b09dfc8d',
      readAt: null,
      createdAt: '2026-11-10T13:47:09.290Z',
    });
    expect(notification.kind).toBe('chat_message');
    expect(notification.entityType).toBe('conversation');
  });

  it('pages the inbox with a bounded page size', () => {
    expect(staffNotificationQuerySchema.parse({}).pageSize).toBe(25);
    expect(() => staffNotificationQuerySchema.parse({ pageSize: '101' })).toThrow();
  });
});

describe('public media URLs in the public shapes', () => {
  const profile = {
    displayName: 'Nilzora',
    logoKey: 'brand/logo',
    updatedAt: '2026-11-06T10:00:00.000Z',
  };
  const seo = {
    kind: 'product' as const,
    slug: 'desk-lamp',
    title: 'Desk Lamp',
    ogTitle: 'Desk Lamp',
    canonicalPath: '/products/desk-lamp',
    updatedAt: '2026-11-06T10:00:00.000Z',
  };

  it('defaults the resolved logo and share image to null, so an older payload still parses', () => {
    expect(publicStoreProfileSchema.parse(profile).logoUrl).toBeNull();
    expect(seoMetadataSchema.parse(seo).ogImageUrl).toBeNull();
  });

  it('accepts the absolute URLs the API resolves', () => {
    expect(
      publicStoreProfileSchema.parse({
        ...profile,
        logoUrl: 'https://media.nilzora.test/brand/logo/thumb.webp',
      }).logoUrl,
    ).toBe('https://media.nilzora.test/brand/logo/thumb.webp');
    expect(
      seoMetadataSchema.parse({
        ...seo,
        ogImageUrl: 'https://media.nilzora.test/products/lamp/og/full.webp',
      }).ogImageUrl,
    ).toBe('https://media.nilzora.test/products/lamp/og/full.webp');
  });

  it('refuses anything that is not an absolute URL, so no relative or script URL leaks out', () => {
    expect(() =>
      publicStoreProfileSchema.parse({ ...profile, logoUrl: '/brand/logo.webp' }),
    ).toThrow();
    expect(() => seoMetadataSchema.parse({ ...seo, ogImageUrl: 'javascript:alert(1)' })).toThrow();
  });
});

describe('customer insight', () => {
  it('offers a transparent label for every segment', () => {
    for (const segment of CUSTOMER_SEGMENTS) {
      expect(CUSTOMER_SEGMENT_LABELS[segment]).toBeTruthy();
    }
  });

  it('accepts a segment or "all", and nothing invented', () => {
    expect(customerInsightQuerySchema.parse({}).segment).toBe('all');
    expect(customerInsightQuerySchema.parse({ segment: 'repeat' }).segment).toBe('repeat');
    expect(() => customerInsightQuerySchema.parse({ segment: 'vip' })).toThrow();
  });
});
