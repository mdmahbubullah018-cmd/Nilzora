import type { HomepageSection } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import { brandsThenFeatured, saleBeforeCategories } from './home-order';

/*
 * The home page's two rules on top of the store's arrangement: the promotional strip reads
 * just before the categories, and the page closes with Shop by Brand and then Featured Products
 * (with Shop the Collections drawn between them). Everything else keeps the order the store saved.
 */

function section(key: HomepageSection['key']): HomepageSection {
  return { key, title: null, itemLimit: null, config: {} };
}

const keys = (sections: readonly HomepageSection[]) => sections.map((entry) => entry.key);

describe('saleBeforeCategories', () => {
  it('moves the sale in front of the categories, keeping everything else in place', () => {
    const arranged = [
      section('hero'),
      section('services'),
      section('categories'),
      section('new_arrivals'),
      section('featured'),
      section('promotions'),
      section('brands'),
    ];

    expect(keys(saleBeforeCategories(arranged))).toEqual([
      'hero',
      'services',
      'promotions',
      'categories',
      'new_arrivals',
      'featured',
      'brands',
    ]);
  });

  it('works when the store had already put the sale first', () => {
    const arranged = [section('promotions'), section('categories'), section('featured')];

    expect(keys(saleBeforeCategories(arranged))).toEqual(['promotions', 'categories', 'featured']);
  });

  it('leaves an arrangement without a sale alone', () => {
    const arranged = [section('hero'), section('categories'), section('featured')];

    expect(keys(saleBeforeCategories(arranged))).toEqual(['hero', 'categories', 'featured']);
  });

  it('leaves an arrangement without categories alone', () => {
    const arranged = [section('hero'), section('featured'), section('promotions')];

    expect(keys(saleBeforeCategories(arranged))).toEqual(['hero', 'featured', 'promotions']);
  });

  it('never brings back a section the store switched off', () => {
    const arranged = [section('hero'), section('featured')];

    const ordered = saleBeforeCategories(arranged);
    expect(keys(ordered)).toEqual(['hero', 'featured']);
    expect(ordered).not.toContainEqual(expect.objectContaining({ key: 'promotions' }));
  });

  it('does not change the caller’s array', () => {
    const arranged = [section('categories'), section('promotions')];
    saleBeforeCategories(arranged);

    expect(keys(arranged)).toEqual(['categories', 'promotions']);
  });
});

describe('brandsThenFeatured', () => {
  it('ends the page with Shop by Brand, then Featured Products', () => {
    const arranged = [
      section('hero'),
      section('services'),
      section('promotions'),
      section('categories'),
      section('new_arrivals'),
      section('featured'),
      section('brands'),
    ];

    expect(keys(brandsThenFeatured(arranged))).toEqual([
      'hero',
      'services',
      'promotions',
      'categories',
      'new_arrivals',
      'brands',
      'featured',
    ]);
  });

  it('moves Brands below New Arrivals when the store saved it higher', () => {
    const arranged = [
      section('hero'),
      section('brands'),
      section('categories'),
      section('new_arrivals'),
      section('featured'),
    ];

    expect(keys(brandsThenFeatured(arranged))).toEqual([
      'hero',
      'categories',
      'new_arrivals',
      'brands',
      'featured',
    ]);
  });

  it('keeps the tail right when the store has no brands', () => {
    const arranged = [section('hero'), section('featured'), section('new_arrivals')];

    expect(keys(brandsThenFeatured(arranged))).toEqual(['hero', 'new_arrivals', 'featured']);
  });

  it('keeps the tail right when the store has no featured row', () => {
    const arranged = [section('hero'), section('brands'), section('new_arrivals')];

    expect(keys(brandsThenFeatured(arranged))).toEqual(['hero', 'new_arrivals', 'brands']);
  });

  it('never duplicates a section, and does not change the caller’s array', () => {
    const arranged = [section('featured'), section('brands'), section('new_arrivals')];

    const ordered = brandsThenFeatured(arranged);
    expect(keys(ordered)).toEqual(['new_arrivals', 'brands', 'featured']);
    expect(keys(arranged)).toEqual(['featured', 'brands', 'new_arrivals']);
  });

  it('composes with the sale rule into the requested page order', () => {
    // The store's own arrangement, as seeded: hero, trusted, categories, new arrivals,
    // featured, promotions, brands.
    const arranged = [
      section('hero'),
      section('services'),
      section('categories'),
      section('new_arrivals'),
      section('featured'),
      section('promotions'),
      section('brands'),
    ];

    expect(keys(brandsThenFeatured(saleBeforeCategories(arranged)))).toEqual([
      'hero',
      'services',
      'promotions',
      'categories',
      'new_arrivals',
      'brands',
      'featured',
    ]);
  });
});
