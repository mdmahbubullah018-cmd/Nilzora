import type { Brand } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import { category } from '@/testing/catalog-fixtures';
import { audienceDepartment, brandLinks, categoryTree, NEW_ARRIVALS_HREF } from './navigation';

function brand(overrides: Partial<Brand> = {}): Brand {
  return {
    slug: 'aarong',
    name: 'Aarong',
    description: null,
    logo: null,
    banner: null,
    productCount: 1,
    ...overrides,
  };
}

describe('categoryTree', () => {
  it('nests published categories under their parents, in the store order', () => {
    const tree = categoryTree([
      category({ slug: 'women', name: 'Women' }),
      category({ slug: 'sarees', name: 'Sarees', parentSlug: 'women', depth: 2 }),
      category({ slug: 'jamdani', name: 'Jamdani', parentSlug: 'sarees', depth: 3 }),
      category({ slug: 'men', name: 'Men' }),
    ]);

    expect(tree.map((node) => node.slug)).toEqual(['women', 'men']);
    expect(tree[0]?.href).toBe('/categories/women');
    expect(tree[0]?.children.map((node) => node.slug)).toEqual(['sarees']);
    expect(tree[0]?.children[0]?.children.map((node) => node.slug)).toEqual(['jamdani']);
    expect(tree[1]?.children).toEqual([]);
  });

  it('drops orphans and duplicates instead of surfacing them', () => {
    const tree = categoryTree([
      category({ slug: 'women', name: 'Women' }),
      category({ slug: 'women', name: 'Women again' }),
      category({ slug: 'stray', name: 'Stray', parentSlug: 'unpublished', depth: 2 }),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0]?.name).toBe('Women');
    expect(JSON.stringify(tree)).not.toContain('stray');
  });
});

describe('brandLinks', () => {
  it('keeps only brands with something on sale', () => {
    expect(brandLinks([brand(), brand({ slug: 'empty', name: 'Empty', productCount: 0 })])).toEqual(
      [{ slug: 'aarong', name: 'Aarong', href: '/aarong' }],
    );
  });
});

describe('audienceDepartment', () => {
  it('finds a top-level Men or Women department, and nothing else', () => {
    const categories = [
      category({ slug: 'mens', name: "Men's" }),
      category({ slug: 'women', name: 'Women', parentSlug: 'fashion', depth: 2 }),
      category({ slug: 'menswear-accessories', name: 'Menswear accessories' }),
    ];

    expect(audienceDepartment(categories, 'men')?.slug).toBe('mens');
    // A subcategory called Women is not a department, and nothing is guessed from names.
    expect(audienceDepartment(categories, 'women')).toBeNull();
  });
});

it('sends New Arrivals to the newest-first listing', () => {
  expect(NEW_ARRIVALS_HREF).toBe('/products?sort=newest');
});
