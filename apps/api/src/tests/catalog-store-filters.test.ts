import { describe, expect, it } from 'vitest';
import type { SupabaseClients } from '../supabase/clients';
import { createSupabaseCatalogStore, type ProductSearch } from '../modules/catalog/store';

/*
 * The priced listing: which filters the store sends to catalog_products, that a department
 * resolves its branch from the cached tree first, and that pictures and brands are read in
 * one wave after the page. The database prices every row (a campaign included), so the store
 * never re-derives a price itself.
 */

interface Answer {
  data: unknown;
  error: unknown;
}

type RpcAnswers = Record<string, (args: Record<string, unknown>) => Answer>;

function tree(slug: string, parent: string | null, depth: number) {
  return {
    slug,
    name: slug,
    description: null,
    parent_slug: parent,
    depth,
    image_key: null,
    is_featured: false,
    sort_order: 0,
    product_count: 1,
  };
}

function recordingClients(
  tables: Record<string, Answer> = {},
  rpcs: RpcAnswers = {},
): { clients: SupabaseClients; reads: string[]; calls: { name: string; args: unknown }[] } {
  const reads: string[] = [];
  const calls: { name: string; args: unknown }[] = [];
  const builder = (table: string) => {
    reads.push(table);
    const proxy: object = new Proxy(
      {},
      {
        get(_target, method: string) {
          if (method === 'then') {
            return (resolve: (value: unknown) => void, reject: (error: unknown) => void) =>
              Promise.resolve(tables[table] ?? { data: [], error: null }).then(resolve, reject);
          }
          return () => proxy;
        },
      },
    );
    return proxy;
  };
  const clients = {
    public: () => ({
      from: builder,
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        const answer = rpcs[name];
        return Promise.resolve(answer ? answer(args) : { data: [], error: null });
      },
    }),
  } as unknown as SupabaseClients;
  return { clients, reads, calls };
}

const productRow = {
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'blue-cup',
  sku: 'CUP-1',
  name: 'Blue Cup',
  summary: null,
  price_minor: 4500,
  compare_at_price_minor: null,
  stock_quantity: 9,
  max_order_quantity: 5,
  is_featured: false,
  category_slug: 'cups',
  category_name: 'Cups',
  campaign_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  campaign_title: 'Cup Week',
  campaign_ends_at: '2026-12-01T00:00:00.000Z',
  campaign_discount_kind: 'percent',
  campaign_discount_value: 10,
  total_count: 31,
};

const search = (overrides: Partial<ProductSearch>): ProductSearch => ({
  sort: 'featured',
  limit: 24,
  offset: 0,
  ...overrides,
});

describe('the priced listing', () => {
  it('sends every filter, the branch of categories and the page in one call', async () => {
    const { clients, reads, calls } = recordingClients(
      {
        product_images: { data: [], error: null },
        products: {
          data: [{ id: productRow.id, brand: { slug: 'acme', name: 'Acme' } }],
          error: null,
        },
      },
      {
        catalog_category_tree: () => ({
          data: [
            tree('home', null, 1),
            tree('tableware', 'home', 2),
            tree('cups', 'tableware', 3),
            tree('garden', null, 1),
          ],
          error: null,
        }),
        catalog_products: () => ({ data: [productRow], error: null }),
      },
    );

    const page = await createSupabaseCatalogStore(clients, {
      mediaBaseUrl: 'https://media.example',
    }).listProducts(
      search({
        categorySlug: 'home',
        includeSubcategories: true,
        brandSlug: 'acme',
        minPriceMinor: 1000,
        maxPriceMinor: 9000,
        inStock: true,
        prefixQuery: "'cup':*",
        sort: 'price_asc',
        limit: 12,
        offset: 24,
      }),
    );

    expect(calls.map((call) => call.name)).toStrictEqual([
      'catalog_category_tree',
      'catalog_products',
      // The page's units-sold figures, read once for the whole page.
      'catalog_sold_counts',
      // The page's colour previews, also read once for the whole page.
      'catalog_product_colors',
    ]);
    expect(calls[1]?.args).toStrictEqual({
      p_sort: 'price_asc',
      p_limit: 12,
      p_offset: 24,
      p_category_slug: 'home',
      p_query: "'cup':*",
      p_branch_slugs: ['home', 'tableware', 'cups'],
      p_brand_slug: 'acme',
      p_min_price_minor: 1000,
      p_max_price_minor: 9000,
      p_in_stock: true,
    });
    expect(page.total).toBe(31);
    expect(page.items[0]).toMatchObject({
      slug: 'blue-cup',
      category: { slug: 'cups', name: 'Cups' },
      brand: { slug: 'acme', name: 'Acme' },
      availability: 'in_stock',
      maxOrderQuantity: 5,
      campaign: {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        title: 'Cup Week',
        discountKind: 'percent',
        discountValue: 10,
      },
    });
    // The exact stock level never leaves the store.
    expect(JSON.stringify(page)).not.toContain('stock_quantity');
    // Pictures and brands are read after the page, not once per product.
    expect(reads).toEqual(expect.arrayContaining(['product_images', 'products']));
  });

  it('keeps a listing without subcategories on the one priced call', async () => {
    const { clients, calls, reads } = recordingClients();
    await createSupabaseCatalogStore(clients).listProducts(
      search({ categorySlug: 'home', prefixQuery: "'cup':*", sort: 'relevance' }),
    );
    expect(calls).toStrictEqual([
      {
        name: 'catalog_products',
        args: {
          p_sort: 'relevance',
          p_limit: 24,
          p_offset: 0,
          p_category_slug: 'home',
          p_query: "'cup':*",
          p_branch_slugs: null,
          p_brand_slug: null,
          p_min_price_minor: null,
          p_max_price_minor: null,
          p_in_stock: null,
        },
      },
    ]);
    // No picture or brand lookup runs for an empty page.
    expect(reads).toStrictEqual([]);
  });
});

describe('the colour preview on a card', () => {
  /** The page's colours, answered in the shape catalog_product_colors returns. */
  const colours: RpcAnswers = {
    catalog_products: () => ({ data: [productRow], error: null }),
    catalog_product_colors: () => ({
      data: [
        {
          product_id: productRow.id,
          value: 'Black',
          value_slug: 'black',
          swatch_hex: '#0F172A',
          position: 0,
        },
        {
          product_id: productRow.id,
          value: 'Navy',
          value_slug: 'navy',
          swatch_hex: '#1E3A8A',
          position: 2,
        },
      ],
      error: null,
    }),
  };

  it('reads a page of colours in one call and keeps the order the database gives', async () => {
    const { clients, calls } = recordingClients({}, colours);

    const page = await createSupabaseCatalogStore(clients, {
      mediaBaseUrl: 'https://media.example',
    }).listProducts(search({}));

    expect(page.items[0]?.colors).toStrictEqual([
      { valueSlug: 'black', value: 'Black', swatchHex: '#0F172A' },
      { valueSlug: 'navy', value: 'Navy', swatchHex: '#1E3A8A' },
    ]);
    // One call for the whole page, with every product id in it.
    expect(calls.filter((call) => call.name === 'catalog_product_colors')).toHaveLength(1);
    expect(calls.find((call) => call.name === 'catalog_product_colors')?.args).toStrictEqual({
      p_product_ids: [productRow.id],
    });
  });

  it('leaves a single colour off the card, and says nothing when the read fails', async () => {
    const one = recordingClients(
      {},
      {
        catalog_products: () => ({ data: [productRow], error: null }),
        catalog_product_colors: () => ({
          data: [
            {
              product_id: productRow.id,
              value: 'Black',
              value_slug: 'black',
              swatch_hex: '#0F172A',
              position: 0,
            },
          ],
          error: null,
        }),
      },
    );
    const single = await createSupabaseCatalogStore(one.clients, {
      mediaBaseUrl: 'https://media.example',
    }).listProducts(search({}));
    expect(single.items[0]?.colors).toBeUndefined();

    const broken = recordingClients(
      {},
      {
        catalog_products: () => ({ data: [productRow], error: null }),
        catalog_product_colors: () => ({ data: null, error: { message: 'no function' } }),
      },
    );
    // A database without the function must not fail the listing: the cards simply have no dots.
    const page = await createSupabaseCatalogStore(broken.clients, {
      mediaBaseUrl: 'https://media.example',
    }).listProducts(search({}));
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.colors).toBeUndefined();
  });
});
