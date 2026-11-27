import { productListResponseSchema } from '@nilzora/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createSupabaseCatalogStore } from '../modules/catalog/store';
import type { SupabaseClients } from '../supabase/clients';
import { commerceSetup } from './commerce-helpers';
import { testApp } from './helpers';

/*
 * A listing page that starts after the last match.
 *
 * catalog_products answers an offset beyond the end with no rows at all, and a page with no
 * rows says nothing about how many products match. Left alone, a stale ?page=9 link (or page
 * 2 of a filter that matches nothing) would report a total of 0. These tests pin the intended
 * behaviour: an empty page that still reports the real total, and every database failure
 * still being an outage.
 */

interface Row {
  id: string;
  slug: string;
  sku: string;
  name: string;
  summary: string | null;
  price_minor: number;
  compare_at_price_minor: number | null;
  stock_quantity: number;
  max_order_quantity: number;
  is_featured: boolean;
  category_slug: string;
  category_name: string;
  campaign_id: string | null;
  campaign_title: string | null;
  campaign_ends_at: string | null;
  campaign_discount_kind: string | null;
  campaign_discount_value: number | null;
  total_count: number;
}

const ROW: Row = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'desk-lamp',
  sku: 'LAMP-1',
  name: 'Desk lamp',
  summary: null,
  price_minor: 320000,
  compare_at_price_minor: null,
  stock_quantity: 5,
  max_order_quantity: 3,
  is_featured: false,
  category_slug: 'home',
  category_name: 'Home',
  campaign_id: null,
  campaign_title: null,
  campaign_ends_at: null,
  campaign_discount_kind: null,
  campaign_discount_value: null,
  total_count: 24,
};

interface Args {
  p_limit: number;
  p_offset: number;
}

/**
 * A Supabase double for the priced listing: it records every catalog_products call and
 * answers from `answer`, which sees the arguments asked for. Table reads answer empty.
 */
function clientsAnswering(
  calls: Args[],
  answer: (args: Args) => { data: unknown; error: unknown },
): SupabaseClients {
  function builder(): unknown {
    const proxy: object = new Proxy(
      {},
      {
        get(_target, method: string) {
          if (method === 'then') {
            return (resolve: (value: unknown) => void) => resolve({ data: [], error: null });
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
      rpc: (name: string, args: Args) => {
        if (name !== 'catalog_products') return Promise.resolve({ data: [], error: null });
        calls.push(args);
        return Promise.resolve(answer(args));
      },
    }),
  } as unknown as SupabaseClients;
}

const SEARCH = { sort: 'featured', limit: 24, offset: 24, inStock: true } as const;

describe('a listing page past the last match', () => {
  it('is an empty page that still says how many products match', async () => {
    const calls: Args[] = [];
    const store = createSupabaseCatalogStore(
      clientsAnswering(calls, ({ p_offset }) =>
        p_offset === 24 ? { data: [], error: null } : { data: [ROW], error: null },
      ),
    );

    const page = await store.listProducts(SEARCH);

    expect(page).toEqual({ items: [], total: 24 });
    // The page asked for, then one row to learn the total: two reads, no more.
    expect(calls.map((call) => [call.p_limit, call.p_offset])).toEqual([
      [24, 24],
      [1, 0],
    ]);
  });

  it('reports no matches when nothing matches the filters at all', async () => {
    const store = createSupabaseCatalogStore(
      clientsAnswering([], () => ({ data: [], error: null })),
    );
    await expect(store.listProducts(SEARCH)).resolves.toEqual({ items: [], total: 0 });
  });

  it('does not repeat the read when the page exists', async () => {
    const calls: Args[] = [];
    const store = createSupabaseCatalogStore(
      clientsAnswering(calls, () => ({ data: [{ ...ROW, total_count: 25 }], error: null })),
    );

    const page = await store.listProducts({ ...SEARCH, offset: 0 });

    expect(page.items.map((item) => item.slug)).toEqual(['desk-lamp']);
    expect(page.total).toBe(25);
    expect(calls.map((call) => [call.p_limit, call.p_offset])).toEqual([[24, 0]]);
  });

  it('is still an outage for any database failure', async () => {
    const store = createSupabaseCatalogStore(
      clientsAnswering([], () => ({
        data: null,
        error: { code: '57014', message: 'canceling statement due to statement timeout' },
      })),
    );
    await expect(store.listProducts(SEARCH)).rejects.toMatchObject({
      name: 'StoreUnavailableError',
    });
  });

  it('is an outage when learning the total fails too', async () => {
    const store = createSupabaseCatalogStore(
      clientsAnswering([], ({ p_offset }) =>
        p_offset === 24
          ? { data: [], error: null }
          : { data: null, error: { code: '57014', message: 'timeout' } },
      ),
    );
    await expect(store.listProducts(SEARCH)).rejects.toMatchObject({
      name: 'StoreUnavailableError',
    });
  });

  it('answers the HTTP request with an empty page and the real total, not a 503', async () => {
    const { identity, commerce } = commerceSetup();
    const catalog = createSupabaseCatalogStore(
      clientsAnswering([], ({ p_offset }) =>
        p_offset === 48
          ? { data: [], error: null }
          : { data: [{ ...ROW, total_count: 30 }], error: null },
      ),
    );
    const app = testApp({ auth: identity.deps, commerce: { ...commerce.stores, catalog } });

    const response = await request(app).get('/api/v1/catalog/products?inStock=true&page=3');

    expect(response.status).toBe(200);
    expect(productListResponseSchema.parse(response.body)).toMatchObject({
      items: [],
      page: 3,
      pageSize: 24,
      total: 30,
      totalPages: 2,
    });
  });
});
