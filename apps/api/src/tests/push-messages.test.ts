import { broadcastRequestSchema, savePushSettingsSchema } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import {
  broadcastAnnouncement,
  linkData,
  productAnnouncement,
} from '../modules/notifications/messages';

describe('where a tapped notification leads', () => {
  it('opens a product, a category or a fixed screen, and nothing else', () => {
    expect(linkData('/products/cotton-panjabi')).toEqual({ productSlug: 'cotton-panjabi' });
    expect(linkData('/categories/fashion?sort=newest')).toEqual({ categorySlug: 'fashion' });
    expect(linkData('/wishlist')).toEqual({ screen: 'wishlist' });
    expect(linkData('/')).toEqual({ screen: 'home' });
    // Anything the app cannot open, or that looks like an address, sends no destination at all.
    expect(linkData('/admin/orders')).toEqual({});
    expect(linkData('/categories/Not A Slug')).toEqual({});
    expect(linkData(null)).toEqual({});
  });

  it('carries the link of a broadcast, with a linked product taking precedence', () => {
    expect(broadcastAnnouncement('Sale', 'Up to 30% off', '', '/categories/fashion')?.data).toEqual(
      {
        categorySlug: 'fashion',
      },
    );
    expect(
      broadcastAnnouncement('Sale', 'Up to 30% off', 'blue-shirt', '/categories/fashion')?.data,
    ).toEqual({ productSlug: 'blue-shirt' });
  });
});

describe('the automatic product announcement', () => {
  it("uses the store's own words, and the fixed ones for an announcement without any", () => {
    expect(
      productAnnouncement('Blue shirt', 'blue-shirt', {
        title: 'Just landed',
        body: 'Meet Blue shirt',
      }),
    ).toMatchObject({ title: 'Just landed', body: 'Meet Blue shirt' });
    expect(productAnnouncement('Blue shirt', 'blue-shirt')).toMatchObject({
      title: 'New at Nilzora',
      body: 'Discover Blue shirt — now available.',
    });
  });
});

describe('broadcast and settings requests', () => {
  it('accepts a picture, a store link and a schedule, and refuses anything off-site', () => {
    const ok = broadcastRequestSchema.safeParse({
      title: 'Sale',
      body: 'Today only',
      imageKey: 'library/0e000000-0000-4000-8000-000000000001',
      linkPath: '/categories/fashion',
      scheduledFor: '2026-12-01T10:00:00.000Z',
    });
    expect(ok.success).toBe(true);
    expect(
      broadcastRequestSchema.safeParse({
        title: 'Sale',
        body: 'x',
        linkPath: 'https://evil.example',
      }).success,
    ).toBe(false);
  });

  it('keeps the product templates within the notification limits', () => {
    expect(
      savePushSettingsSchema.safeParse({
        autoAnnounceProducts: false,
        productTitleTemplate: 'New: {name}',
        productBodyTemplate: 'Now available',
      }).success,
    ).toBe(true);
    expect(
      savePushSettingsSchema.safeParse({
        autoAnnounceProducts: true,
        productTitleTemplate: 'x'.repeat(66),
        productBodyTemplate: 'ok',
      }).success,
    ).toBe(false);
  });
});
