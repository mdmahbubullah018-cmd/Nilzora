import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { brandShareTarget, categoryShareTarget, productShareTarget } from './share';

const SITE = 'https://shop.example.test';

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe('productShareTarget', () => {
  it('shares the product’s own name, summary and canonical address', () => {
    expect(
      productShareTarget({
        slug: 'clay-mug',
        name: 'Clay Mug',
        summary: 'Hand-thrown in Dhaka.',
        image: { url: `${SITE}/media/clay-mug.webp` },
      }),
    ).toEqual({
      kind: 'product',
      title: 'Clay Mug',
      text: 'Clay Mug — Hand-thrown in Dhaka.',
      url: `${SITE}/products/clay-mug`,
      imageUrl: `${SITE}/media/clay-mug.webp`,
    });
  });

  it('works for a card, which has no summary to offer', () => {
    const target = productShareTarget({ slug: 'clay-mug', name: 'Clay Mug', summary: null });
    expect(target?.text).toBe('Clay Mug');
    expect(target?.imageUrl).toBeNull();
  });

  it('refuses a slug that would smuggle a path separator into the address', () => {
    // The API never stores one; a share must not turn one into a second segment if it did.
    expect(productShareTarget({ slug: 'a/b', name: 'Odd' })).toBeNull();
    // A space is simply encoded, as every other link on the site does.
    expect(productShareTarget({ slug: 'a b', name: 'Odd' })?.url).toBe(`${SITE}/products/a%20b`);
  });

  it('is null when the record has no name to share', () => {
    expect(productShareTarget({ slug: 'clay-mug', name: '   ' })).toBeNull();
  });
});

describe('categoryShareTarget', () => {
  it('shares the category page and its own picture', () => {
    const target = categoryShareTarget({
      slug: 'home',
      name: 'Home',
      description: 'Everything for the home.',
      image: { url: `${SITE}/media/home.webp` },
    });
    expect(target?.url).toBe(`${SITE}/categories/home`);
    expect(target?.text).toBe('Home — Everything for the home.');
    expect(target?.imageUrl).toBe(`${SITE}/media/home.webp`);
  });

  it('drops a picture the store has not published as an address', () => {
    expect(categoryShareTarget({ slug: 'home', name: 'Home', image: null })?.imageUrl).toBeNull();
  });
});

describe('brandShareTarget', () => {
  it('shares the brand’s top-level address', () => {
    const target = brandShareTarget({
      slug: 'north-star',
      name: 'North Star',
      description: 'Dhaka ceramics.',
      logo: { url: `${SITE}/media/north-star.webp` },
    });
    expect(target?.url).toBe(`${SITE}/north-star`);
    expect(target?.imageUrl).toBe(`${SITE}/media/north-star.webp`);
  });

  it('never builds an address from a slug that resolves to a private page', () => {
    // A brand slug cannot be a store path (the API refuses one), so this cannot arrive from the
    // catalogue — but a share must still not turn a crafted slug into a private link.
    expect(brandShareTarget({ slug: 'admin', name: 'Escape' })).toBeNull();
    expect(brandShareTarget({ slug: 'checkout', name: 'Escape' })).toBeNull();
    // A dot segment would climb out of the brand's own page, so it is refused, not normalised.
    expect(brandShareTarget({ slug: '..', name: 'Escape' })).toBeNull();
  });
});
