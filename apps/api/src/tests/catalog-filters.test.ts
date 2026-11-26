import { categoryListResponseSchema, productListResponseSchema } from '@nilzora/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { branchSlugs, withBranchCounts } from '../modules/catalog/store';
import { commerceSetup, errorOf } from './commerce-helpers';

/*
 * Narrowing a listing: a category's whole branch, a brand, a price range and in-stock only.
 * The fixture's kitchen department gains a subcategory (Tableware) with its own product, and
 * two products carry a brand.
 */
function setup() {
  const base = commerceSetup();
  const { commerce, products } = base;
  const kitchen = commerce.categories.find((category) => category.slug === 'home-kitchen');
  if (!kitchen) throw new Error('fixture changed');
  const tableware = commerce.addCategory({
    slug: 'tableware',
    name: 'Tableware',
    parentId: kitchen.id,
  });
  const hidden = commerce.addCategory({
    slug: 'hidden-shelf',
    name: 'Hidden shelf',
    parentId: tableware.id,
    isActive: false,
  });
  const bowl = commerce.addProduct({
    slug: 'serving-bowl',
    name: 'Serving Bowl',
    categoryId: tableware.id,
    priceMinor: 4_500,
    stock: 8,
  });
  commerce.addProduct({
    slug: 'old-bowl',
    name: 'Old Bowl',
    categoryId: hidden.id,
    priceMinor: 4_000,
    stock: 8,
  });
  const brand = { slug: 'aarong-home', name: 'Aarong Home' };
  products.lamp.brand = brand;
  bowl.brand = brand;
  return { ...base, bowl, brand };
}

const slugs = (body: unknown) =>
  productListResponseSchema.parse(body).items.map((item) => item.slug);

describe('category branches', () => {
  it('lists only the category itself unless its subcategories are asked for', async () => {
    const { app } = setup();

    const direct = await request(app).get('/api/v1/catalog/products?category=home-kitchen');
    expect(slugs(direct.body)).not.toContain('serving-bowl');

    const branch = await request(app).get(
      '/api/v1/catalog/products?category=home-kitchen&includeSubcategories=true',
    );
    expect(branch.status).toBe(200);
    expect(slugs(branch.body)).toContain('serving-bowl');
    // A product under a hidden subcategory never appears, whatever the branch.
    expect(branch.text).not.toContain('old-bowl');
    expect(productListResponseSchema.parse(branch.body).total).toBe(5);
  });

  it('counts each category with its whole published branch', async () => {
    const { app } = setup();
    const response = await request(app).get('/api/v1/catalog/categories');
    const bySlug = Object.fromEntries(
      categoryListResponseSchema
        .parse(response.body)
        .categories.map((category) => [
          category.slug,
          [category.productCount, category.totalProductCount],
        ]),
    );
    expect(bySlug).toStrictEqual({ 'home-kitchen': [4, 5], tableware: [1, 1] });
  });

  it('walks the tree breadth first and stops at unknown slugs', () => {
    const tree = [
      { slug: 'a', parentSlug: null },
      { slug: 'b', parentSlug: 'a' },
      { slug: 'c', parentSlug: 'b' },
      { slug: 'd', parentSlug: null },
    ].map((entry, index) => ({
      ...entry,
      name: entry.slug,
      description: null,
      productCount: index + 1,
      image: null,
      depth: 1,
      isFeatured: false,
    }));
    expect(branchSlugs(tree, 'a')).toStrictEqual(['a', 'b', 'c']);
    expect(branchSlugs(tree, 'b')).toStrictEqual(['b', 'c']);
    expect(branchSlugs(tree, 'zzz')).toStrictEqual([]);
    expect(withBranchCounts(tree).map((entry) => entry.totalProductCount)).toStrictEqual([
      6, 5, 3, 4,
    ]);
  });
});

describe('brand, price and stock filters', () => {
  it('names the brand on every summary that has one', async () => {
    const { app } = setup();
    const response = await request(app).get('/api/v1/catalog/products');
    const items = productListResponseSchema.parse(response.body).items;
    expect(items.find((item) => item.slug === 'desk-lamp')?.brand).toStrictEqual({
      slug: 'aarong-home',
      name: 'Aarong Home',
    });
    expect(items.find((item) => item.slug === 'gel-pen')?.brand).toBeNull();
  });

  it("narrows to one brand's products", async () => {
    const { app } = setup();
    const response = await request(app).get('/api/v1/catalog/products?brand=aarong-home');
    expect(slugs(response.body).sort()).toStrictEqual(['desk-lamp', 'serving-bowl']);

    const unknown = await request(app).get('/api/v1/catalog/products?brand=no-such-brand');
    expect(productListResponseSchema.parse(unknown.body).total).toBe(0);
  });

  it('keeps prices inside both bounds, inclusive', async () => {
    const { app } = setup();
    const response = await request(app).get(
      '/api/v1/catalog/products?minPriceMinor=2500&maxPriceMinor=4500&sort=price_asc',
    );
    expect(slugs(response.body)).toStrictEqual(['ceramic-mug', 'dinner-plate', 'serving-bowl']);
  });

  it('drops sold-out products when only stock on hand is wanted', async () => {
    const { app } = setup();
    const response = await request(app).get('/api/v1/catalog/products?inStock=true');
    expect(slugs(response.body)).not.toContain('dinner-plate');
    expect(slugs(response.body)).toContain('gel-pen');
  });

  it('passes every filter to the store and defaults a narrowed search to newest', async () => {
    const { app, commerce } = setup();
    await request(app).get(
      '/api/v1/catalog/products?q=bowl&category=home-kitchen&includeSubcategories=1&brand=aarong-home&minPriceMinor=100&maxPriceMinor=9000&inStock=true',
    );
    expect(commerce.searches.at(-1)).toMatchObject({
      categorySlug: 'home-kitchen',
      includeSubcategories: true,
      brandSlug: 'aarong-home',
      minPriceMinor: 100,
      maxPriceMinor: 9000,
      inStock: true,
      prefixQuery: "'bowl':*",
      sort: 'newest',
    });
  });

  it('keeps a plain search ranked by relevance, exactly as before', async () => {
    const { app, commerce } = setup();
    await request(app).get('/api/v1/catalog/products?q=lamp');
    expect(commerce.searches.at(-1)).toMatchObject({ sort: 'relevance' });
    expect(commerce.searches.at(-1)?.brandSlug).toBeUndefined();
  });
});

describe('filter validation', () => {
  it.each([
    ['a lowest price above the highest', 'minPriceMinor=500&maxPriceMinor=100'],
    ['a negative price', 'minPriceMinor=-1'],
    ['a fractional price', 'maxPriceMinor=10.5'],
    ['a price beyond any product', 'maxPriceMinor=1000000001'],
    ['a malformed brand', 'brand=Not%20A%20Slug'],
    ['an unclear yes/no', 'inStock=perhaps'],
    ['relevance with filters', 'q=lamp&inStock=true&sort=relevance'],
  ])('refuses %s', async (_label, query) => {
    const { app, commerce } = setup();
    const before = commerce.searches.length;
    const response = await request(app).get(`/api/v1/catalog/products?${query}`);
    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(commerce.searches.length).toBe(before);
  });
});
