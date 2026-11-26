import { describe, expect, it } from 'vitest';
import type { SupabaseClients } from '../supabase/clients';
import { createSupabaseCatalogStore } from '../modules/catalog/store';

/*
 * The public category tree: what `catalog_category_tree` returns, and how the API turns a
 * stored cover key into public URLs (the key itself never leaves the API).
 */

interface TreeRow {
  slug: string;
  name: string;
  description: string | null;
  parent_slug: string | null;
  depth: number;
  image_key: string | null;
  is_featured: boolean;
  sort_order: number;
  product_count: number;
}

const KEY = 'categories/00000000-0000-4000-8000-000000000001/00000000-0000-4000-9000-0000000000aa';
const MEDIA = 'https://media.example.com';

function row(overrides: Partial<TreeRow> = {}): TreeRow {
  return {
    slug: 'fashion',
    name: 'Fashion',
    description: null,
    parent_slug: null,
    depth: 1,
    image_key: null,
    is_featured: false,
    sort_order: 0,
    product_count: 0,
    ...overrides,
  };
}

function storeWith(rows: TreeRow[], mediaBaseUrl?: string, banners: Record<string, string> = {}) {
  const calls: string[] = [];
  const clients = {
    public: () => ({
      // The banner keys: a separate read of the categories table, by slug.
      from: () => ({
        select: () => ({
          not: () =>
            Promise.resolve({
              data: Object.entries(banners).map(([slug, banner_key]) => ({ slug, banner_key })),
              error: null,
            }),
        }),
      }),
      rpc: (name: string) => {
        calls.push(name);
        return Promise.resolve({ data: rows, error: null });
      },
    }),
  } as unknown as SupabaseClients;
  return { store: createSupabaseCatalogStore(clients, { mediaBaseUrl }), calls };
}

describe('public category tree', () => {
  it('publishes the banner as variant URLs, never the stored key', async () => {
    const { store } = storeWith([row()], MEDIA, { fashion: KEY });

    const [fashion] = await store.listCategories();

    expect(fashion?.banner).toStrictEqual({
      url: `${MEDIA}/${KEY}/full.webp`,
      thumbUrl: `${MEDIA}/${KEY}/thumb.webp`,
    });
    expect(JSON.stringify(fashion)).not.toContain('banner_key');
  });

  it('has no banner when the category has none', async () => {
    const { store } = storeWith([row()], MEDIA);

    const [fashion] = await store.listCategories();

    expect(fashion?.banner).toBeNull();
  });

  it('reads the published tree from the tree function', async () => {
    const { store, calls } = storeWith([row()], MEDIA);

    await store.listCategories();

    expect(calls).toStrictEqual(['catalog_category_tree']);
  });

  it('publishes the cover image as variant URLs, never the stored key', async () => {
    const { store } = storeWith([row({ image_key: KEY })], MEDIA);

    const [category] = await store.listCategories();

    expect(category?.image).toStrictEqual({
      url: `${MEDIA}/${KEY}/full.webp`,
      thumbUrl: `${MEDIA}/${KEY}/thumb.webp`,
    });
    // Only the two public URLs are published: the storage key is not part of the contract.
    expect(Object.keys(category ?? {})).not.toContain('imageKey');
    expect(Object.keys(category?.image ?? {})).toStrictEqual(['url', 'thumbUrl']);
  });

  it('has no image when the category has no cover', async () => {
    const { store } = storeWith([row({ image_key: null })], MEDIA);

    expect((await store.listCategories())[0]?.image).toBeNull();
  });

  it('has no image when media is not configured, even with a stored key', async () => {
    const { store } = storeWith([row({ image_key: KEY })]);

    expect((await store.listCategories())[0]?.image).toBeNull();
  });

  it('carries the parent slug and depth of a subcategory', async () => {
    const { store } = storeWith(
      [row(), row({ slug: 'shirts', name: 'Shirts', parent_slug: 'fashion', depth: 2 })],
      MEDIA,
    );

    const categories = await store.listCategories();

    expect(categories.map(({ slug, parentSlug, depth }) => ({ slug, parentSlug, depth }))).toEqual([
      { slug: 'fashion', parentSlug: null, depth: 1 },
      { slug: 'shirts', parentSlug: 'fashion', depth: 2 },
    ]);
  });

  it('passes the featured flag and counts through', async () => {
    const { store } = storeWith([row({ is_featured: true, product_count: 7 })], MEDIA);

    const [category] = await store.listCategories();

    expect(category).toMatchObject({ isFeatured: true, productCount: 7 });
  });

  it('refuses a row the contract cannot represent', async () => {
    // A fourth level cannot exist (the database guard caps the tree at three), so a row
    // claiming one is a defect worth failing loudly rather than publishing.
    const { store } = storeWith([row({ depth: 4 })], MEDIA);

    await expect(store.listCategories()).rejects.toThrow();
  });
});
