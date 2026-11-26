import { describe, expect, it } from 'vitest';
import { createSupabaseCatalogStore } from '../modules/catalog/store';
import type { SupabaseClients } from '../supabase/clients';

/*
 * Round trips per catalogue read.
 *
 * Every catalogue screen reaches PostgREST over the network, so the number of *sequential*
 * requests is the latency the customer pays. These tests pin the shape of that work: the
 * product page reads its priced row in one call and then its images, brand and variants at
 * the same time, and a product that does not exist costs exactly one request.
 */

type Row = { data: unknown; error: null };
type Answer = () => Promise<Row>;

interface Deferred {
  promise: Promise<Row>;
  resolve: (value: Row) => void;
}

function deferred(): Deferred {
  let resolve!: (value: Row) => void;
  const promise = new Promise<Row>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const answer =
  (data: unknown): Answer =>
  () =>
    Promise.resolve({ data, error: null });

const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * A Supabase double: each table read is a thenable that records the table when the store
 * awaits it and answers from `tables`. RPCs are recorded and answered from `rpcs`.
 */
function fakeClients(
  started: string[],
  tables: Record<string, Answer | undefined>,
  rpcs: Record<string, Answer | undefined> = {},
): SupabaseClients {
  function builder(table: string): unknown {
    const proxy: object = new Proxy(
      {},
      {
        get(_target, method: string) {
          if (method === 'then') {
            return (resolve: (value: unknown) => void, reject: (error: unknown) => void) => {
              started.push(table);
              const handler = tables[table];
              return (handler ? handler() : Promise.resolve({ data: [], error: null })).then(
                resolve,
                reject,
              );
            };
          }
          return () => proxy;
        },
      },
    );
    return proxy;
  }

  return {
    public: () => ({
      from: builder,
      rpc: (name: string) => {
        started.push(`rpc:${name}`);
        const handler = rpcs[name];
        const answer = () =>
          handler ? handler() : Promise.resolve({ data: [], error: null });
        // PostgREST's rpc builder is a promise that also offers .maybeSingle().
        return {
          then: (resolve: (value: unknown) => void, reject: (error: unknown) => void) =>
            answer().then(resolve, reject),
          maybeSingle: () =>
            answer().then((row) => ({ data: row.data ?? null, error: row.error })),
        };
      },
    }),
  } as unknown as SupabaseClients;
}

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'desk-lamp',
    sku: 'LAMP-1',
    name: 'Desk lamp',
    summary: null,
    description: null,
    price_minor: 320000,
    compare_at_price_minor: null,
    stock_quantity: 5,
    max_order_quantity: 3,
    is_featured: false,
    brand_id: '22222222-2222-4222-8222-222222222222',
    size_chart: null,
    category_slug: 'home',
    category_name: 'Home',
    campaign_id: null,
    campaign_title: null,
    campaign_ends_at: null,
    campaign_discount_kind: null,
    campaign_discount_value: null,
    ...overrides,
  };
}

describe('catalogue round trips', () => {
  it('reads images, brand and variants in one wave after the product row', async () => {
    const started: string[] = [];
    const row = deferred();
    const images = deferred();
    const brand = deferred();
    const variants = deferred();

    const store = createSupabaseCatalogStore(
      fakeClients(
        started,
        {
          product_images: () => images.promise,
          brands: () => brand.promise,
        },
        { catalog_product: () => row.promise, catalog_product_variants: () => variants.promise },
      ),
    );

    const pending = store.getProduct('desk-lamp');
    row.resolve({ data: productRow(), error: null });
    await tick();

    // All three dependent reads are on the wire while none of them has answered yet.
    expect(started).toEqual(
      expect.arrayContaining([
        'rpc:catalog_product',
        'product_images',
        'brands',
        'rpc:catalog_product_variants',
      ]),
    );

    images.resolve({ data: [], error: null });
    brand.resolve({ data: { slug: 'acme', name: 'Acme' }, error: null });
    variants.resolve({ data: [], error: null });

    await expect(pending).resolves.toMatchObject({
      slug: 'desk-lamp',
      brand: { slug: 'acme', name: 'Acme' },
      variants: [],
    });
  });

  it('does not read a brand for a product that has none', async () => {
    const started: string[] = [];
    const store = createSupabaseCatalogStore(
      fakeClients(started, {}, { catalog_product: answer(productRow({ brand_id: null })) }),
    );

    const product = await store.getProduct('desk-lamp');

    expect(product).toMatchObject({ slug: 'desk-lamp', brand: null });
    expect(started).toEqual(
      expect.arrayContaining([
        'rpc:catalog_product',
        'product_images',
        'rpc:catalog_product_variants',
      ]),
    );
    expect(started).not.toContain('brands');
  });

  it('costs one request for a product that does not exist', async () => {
    const started: string[] = [];
    const store = createSupabaseCatalogStore(
      fakeClients(started, {}, { catalog_product: answer(null) }),
    );

    await expect(store.getProduct('no-such-product')).resolves.toBeNull();
    expect(started).toEqual(['rpc:catalog_product']);
  });
});
