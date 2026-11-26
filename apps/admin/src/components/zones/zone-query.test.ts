import type { AdminShoppingZone } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import { filterZones, hasZoneFilters, parseZoneFilters, zoneStoreHref } from './zone-query';

/*
 * The zones page's filters: plain GET parameters with their own address, so a filtered view
 * can be bookmarked and works without JavaScript. An unknown value falls back to "all" rather
 * than showing nothing.
 */

function zone(overrides: Partial<AdminShoppingZone> = {}): AdminShoppingZone {
  return {
    id: '3f2a1b4c-0000-4000-8000-000000000001',
    slug: 'mens',
    name: "Men's",
    description: null,
    audience: 'men',
    banner: null,
    bannerAlt: null,
    mobileBanner: null,
    productCount: 4,
    seoTitle: null,
    seoDescription: null,
    displayOrder: 0,
    isActive: true,
    explicitProductCount: 0,
    categoryCount: 0,
    updatedAt: '2026-10-25T08:00:00.000Z',
    ...overrides,
  };
}

const zones = [
  zone(),
  zone({
    id: '3f2a1b4c-0000-4000-8000-000000000002',
    slug: 'kids',
    name: 'Kids',
    audience: 'kids',
    isActive: false,
  }),
  zone({
    id: '3f2a1b4c-0000-4000-8000-000000000003',
    slug: 'eid-edit',
    name: 'Eid edit',
    description: 'The festive collection',
    audience: null,
  }),
];

describe('reading the address', () => {
  it('defaults to every zone', () => {
    expect(parseZoneFilters({})).toStrictEqual({ q: '', view: 'all' });
  });

  it('falls back to all for an unknown view', () => {
    expect(parseZoneFilters({ view: 'archived' }).view).toBe('all');
  });

  it('keeps a repeated parameter from confusing the filter', () => {
    expect(parseZoneFilters({ q: ['mens', 'kids'] }).q).toBe('mens');
  });

  it('trims and caps the search text', () => {
    expect(parseZoneFilters({ q: '   kids   ' }).q).toBe('kids');
    expect(parseZoneFilters({ q: 'x'.repeat(150) }).q).toHaveLength(100);
  });
});

describe('filtering', () => {
  it('shows everything by default', () => {
    expect(filterZones(zones, parseZoneFilters({}))).toHaveLength(3);
  });

  it('separates what shoppers see from what is hidden', () => {
    expect(
      filterZones(zones, parseZoneFilters({ view: 'shown' })).map((entry) => entry.slug),
    ).toStrictEqual(['mens', 'eid-edit']);
    expect(
      filterZones(zones, parseZoneFilters({ view: 'hidden' })).map((entry) => entry.slug),
    ).toStrictEqual(['kids']);
  });

  it('searches the name, address, audience and description', () => {
    const search = (q: string) => filterZones(zones, parseZoneFilters({ q })).map((e) => e.slug);
    expect(search('kids')).toStrictEqual(['kids']);
    expect(search('eid-edit')).toStrictEqual(['eid-edit']);
    expect(search('festive')).toStrictEqual(['eid-edit']);
    expect(search('MEN')).toStrictEqual(['mens']);
    expect(search('nothing')).toStrictEqual([]);
  });

  it('combines the search with the view', () => {
    expect(filterZones(zones, parseZoneFilters({ q: 'kids', view: 'shown' }))).toStrictEqual([]);
  });
});

describe('the helpers around it', () => {
  it('knows when a filter is on', () => {
    expect(hasZoneFilters(parseZoneFilters({}))).toBe(false);
    expect(hasZoneFilters(parseZoneFilters({ q: 'kids' }))).toBe(true);
    expect(hasZoneFilters(parseZoneFilters({ view: 'hidden' }))).toBe(true);
  });

  it('points at the storefront listing, encoding the slug', () => {
    expect(zoneStoreHref('mens')).toBe('/products?zone=mens');
    expect(zoneStoreHref('eid edit')).toBe('/products?zone=eid%20edit');
  });
});
