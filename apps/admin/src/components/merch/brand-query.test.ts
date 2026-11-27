import type { AdminBrand } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import { filterBrands, hasBrandFilters, parseBrandFilters } from './brand-query';

function brand(overrides: Partial<AdminBrand>): AdminBrand {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'north-star',
    name: 'North Star',
    description: null,
    logo: null,
    banner: null,
    productCount: 0,
    isActive: true,
    ...overrides,
  };
}

const brands = [
  brand({ name: 'North Star', slug: 'north-star', description: 'Cotton panjabi' }),
  brand({
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Dhaka Home',
    slug: 'dhaka-home',
    isActive: false,
    logo: { url: 'https://m.test/a', thumbUrl: 'https://m.test/a-t' },
  }),
];

describe('brand filters', () => {
  it('reads the address and falls back on anything unknown', () => {
    expect(parseBrandFilters({ q: '  star ', view: 'hidden' })).toEqual({
      q: 'star',
      view: 'hidden',
    });
    expect(parseBrandFilters({ view: 'everything' })).toEqual({ q: '', view: 'all' });
    expect(parseBrandFilters({ q: ['a', 'b'] }).q).toBe('a');
    expect(parseBrandFilters({ q: 'x'.repeat(300) }).q).toHaveLength(100);
  });

  it('searches name, address and description without caring about case', () => {
    expect(filterBrands(brands, { q: 'PANJABI', view: 'all' }).map((b) => b.slug)).toEqual([
      'north-star',
    ]);
    expect(filterBrands(brands, { q: 'dhaka-home', view: 'all' })).toHaveLength(1);
    expect(filterBrands(brands, { q: 'nothing', view: 'all' })).toHaveLength(0);
  });

  it('filters by visibility and by missing logo', () => {
    expect(filterBrands(brands, { q: '', view: 'visible' }).map((b) => b.slug)).toEqual([
      'north-star',
    ]);
    expect(filterBrands(brands, { q: '', view: 'hidden' }).map((b) => b.slug)).toEqual([
      'dhaka-home',
    ]);
    expect(filterBrands(brands, { q: '', view: 'no-logo' }).map((b) => b.slug)).toEqual([
      'north-star',
    ]);
  });

  it('knows when a filter is in effect', () => {
    expect(hasBrandFilters({ q: '', view: 'all' })).toBe(false);
    expect(hasBrandFilters({ q: 'a', view: 'all' })).toBe(true);
    expect(hasBrandFilters({ q: '', view: 'hidden' })).toBe(true);
  });
});
