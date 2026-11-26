import type { PublicStoreProfile, SeoMetadata } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import { publicMediaUrl } from '../modules/media/public-url';
import { presentProfile, presentSeo } from '../modules/site/store';

/*
 * Public media URLs.
 *
 * A stored key is a base key: the media service writes `<key>/full.webp` and
 * `<key>/thumb.webp`. The API is the only process that knows the bucket's public address
 * (R2_PUBLIC_BASE_URL), so it resolves keys into finished URLs and the storefront renders
 * them without ever building one. These tests are pure: no database, no bucket, no network.
 */

const BASE = 'https://media.nilzora.test';

const profile: PublicStoreProfile = {
  displayName: 'Nilzora',
  tagline: null,
  description: null,
  logoKey: 'brand/logo',
  logoUrl: null,
  contactEmail: null,
  contactPhone: null,
  addressLine: null,
  addressArea: null,
  addressDistrict: null,
  businessHours: null,
  supportEmail: null,
  supportPhone: null,
  social: { facebook: null, instagram: null, youtube: null },
  defaultSeoTitle: null,
  defaultSeoDescription: null,
  ogImageKey: null,
  ogImageUrl: null,
  codAvailable: true,
  updatedAt: '2026-11-06T10:00:00.000Z',
};

const seo: SeoMetadata = {
  kind: 'product',
  slug: 'desk-lamp',
  title: 'Desk Lamp',
  ogTitle: 'Desk Lamp',
  description: null,
  ogDescription: null,
  ogImageKey: 'products/lamp/og',
  ogImageUrl: null,
  canonicalPath: '/products/desk-lamp',
  noIndex: false,
  defaultSeoTitle: null,
  defaultSeoDescription: null,
  updatedAt: '2026-11-06T10:00:00.000Z',
};

describe('publicMediaUrl', () => {
  it('builds the full-size URL of a stored image', () => {
    expect(publicMediaUrl('products/lamp/og', BASE)).toBe(`${BASE}/products/lamp/og/full.webp`);
  });

  it('builds the thumbnail URL when a list wants it', () => {
    expect(publicMediaUrl('brand/logo', BASE, 'thumb')).toBe(`${BASE}/brand/logo/thumb.webp`);
  });

  it('keeps a base that has its own path, without doubling the slash', () => {
    expect(publicMediaUrl('brand/logo', `${BASE}/media/`, 'thumb')).toBe(
      `${BASE}/media/brand/logo/thumb.webp`,
    );
  });

  it('answers nothing when no media address is configured', () => {
    expect(publicMediaUrl('brand/logo', undefined)).toBeNull();
    expect(publicMediaUrl('brand/logo', '')).toBeNull();
  });

  it('answers nothing when there is no key', () => {
    expect(publicMediaUrl(null, BASE)).toBeNull();
  });

  it.each([
    ['a full URL', 'https://elsewhere.example/steal.png'],
    ['a protocol-relative path', '//elsewhere.example/steal'],
    ['a traversal', 'products/../../secret'],
    ['a dot segment', 'brand/./logo'],
    ['an absolute path', '/brand/logo'],
    ['a backslash', 'brand\\logo'],
    ['a scheme', 'javascript:alert(1)'],
    ['an unknown folder', 'elsewhere/logo'],
    ['a query', 'brand/logo?x=1'],
    ['a fragment', 'brand/logo#x'],
    ['an empty string', ''],
  ])('refuses %s', (_label, key) => {
    expect(publicMediaUrl(key, BASE)).toBeNull();
  });

  it.each([
    ['a base that is not a URL', 'not a url'],
    ['a base with credentials', 'https://user:secret@media.nilzora.test'],
    ['a base with a query', `${BASE}?token=1`],
    ['a base with a fragment', `${BASE}#x`],
    ['a base that is not http(s)', 'ftp://media.nilzora.test'],
  ])('refuses %s', (_label, base) => {
    expect(publicMediaUrl('brand/logo', base)).toBeNull();
  });
});

describe('presentProfile / presentSeo', () => {
  it('resolves the logo key into a thumbnail URL for the header', () => {
    expect(presentProfile(profile, BASE).logoUrl).toBe(`${BASE}/brand/logo/thumb.webp`);
  });

  it('resolves the store’s default share image at full size', () => {
    expect(presentProfile({ ...profile, ogImageKey: 'seo/share' }, BASE).ogImageUrl).toBe(
      `${BASE}/seo/share/full.webp`,
    );
  });

  it('keeps the profile usable when media is not configured', () => {
    const presented = presentProfile(profile, undefined);

    expect(presented.logoUrl).toBeNull();
    expect(presented.logoKey).toBe('brand/logo');
    expect(presented.displayName).toBe('Nilzora');
  });

  it('resolves a page’s share image at full size', () => {
    expect(presentSeo(seo, BASE).ogImageUrl).toBe(`${BASE}/products/lamp/og/full.webp`);
  });

  it('leaves the share image empty when the page has no key or media is unconfigured', () => {
    expect(presentSeo({ ...seo, ogImageKey: null }, BASE).ogImageUrl).toBeNull();
    expect(presentSeo(seo, undefined).ogImageUrl).toBeNull();
  });

  it('refuses a stored key that is really an address', () => {
    // Defence in depth: the Admin contract already refuses this, but a row may be edited
    // outside the app, and a public tag must never carry a third-party host.
    const hostile = { ...profile, logoKey: 'https://elsewhere.example/logo' };

    expect(presentProfile(hostile, BASE).logoUrl).toBeNull();
  });
});
