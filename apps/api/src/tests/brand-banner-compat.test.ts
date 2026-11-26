import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  createPostgresMerchandisingStore,
  createSupabaseMerchandisingStore,
} from '../modules/merchandising/store';
import type { SupabaseClients } from '../supabase/clients';

/*
 * The brand-banner column is new, so a database that has not run the migration yet must keep
 * working: brands then read without `banner_key` and answer `banner: null`, and the schema is
 * asked once rather than on every read. Once the column exists, it is read — there is no
 * permanent fallback hiding real banner data.
 */

const BRAND_ID = '0d000000-0000-4000-8000-000000000001';
const BANNER = `brands/${BRAND_ID}/0d000000-0000-4000-8000-000000000002`;
const BASE = 'https://media.example.com';

function brandRow(overrides: Record<string, unknown> = {}) {
  return {
    id: BRAND_ID,
    slug: 'north-star',
    name: 'North Star',
    description: null,
    logo_key: null,
    is_active: true,
    product_count: 2,
    ...overrides,
  };
}

/** A thenable that answers whatever the chain asked for, the way PostgREST does. */
function query<T>(answer: () => Promise<T>) {
  const promise = {
    eq: () => promise,
    order: () => promise,
    limit: () => promise,
    maybeSingle: () => promise,
    then: <R>(onDone: (value: T) => R, onError?: (reason: unknown) => R) =>
      answer().then(onDone, onError),
  };
  return promise;
}

function supabaseStore(options: {
  probeError?: { code: string; message: string } | null;
  rows?: unknown[];
}) {
  const selects: string[] = [];
  const client = {
    from: () => ({
      select: (columns: string) => {
        selects.push(columns);
        if (columns === 'banner_key') {
          return query(() =>
            Promise.resolve({
              data: options.probeError ? null : [],
              error: options.probeError ?? null,
            }),
          );
        }
        return query(() => Promise.resolve({ data: options.rows ?? [], error: null }));
      },
    }),
  };
  const clients = { public: () => client, asUser: () => client } as unknown as SupabaseClients;
  return { store: createSupabaseMerchandisingStore(clients, { mediaBaseUrl: BASE }), selects };
}

describe('brand reads over PostgREST', () => {
  it('reads the banner once the column exists, and shows the picture', async () => {
    const { store, selects } = supabaseStore({
      rows: [brandRow({ banner_key: BANNER })],
    });

    const brands = await store.listBrands();

    expect(selects[0]).toBe('banner_key');
    expect(selects[1]).toContain('banner_key');
    expect(brands[0]?.banner).toEqual({
      url: `${BASE}/${BANNER}/full.webp`,
      thumbUrl: `${BASE}/${BANNER}/thumb.webp`,
    });
  });

  it('keeps working on a database without the column, answering null banners', async () => {
    const { store, selects } = supabaseStore({
      probeError: { code: '42703', message: 'column brands.banner_key does not exist' },
      rows: [brandRow({ name: 'North Star' })],
    });

    const brands = await store.listBrands();

    expect(selects[1]).not.toContain('banner_key');
    expect(brands[0]?.name).toBe('North Star');
    expect(brands[0]?.banner).toBeNull();
  });

  it('does not ask the schema again for the next read', async () => {
    const { store, selects } = supabaseStore({ rows: [brandRow()] });

    await store.listBrands();
    await store.listBrands();

    expect(selects.filter((columns) => columns === 'banner_key')).toHaveLength(1);
  });

  it('swallows nothing: a brands read that fails for another reason still throws', async () => {
    const failing = {
      public: () => ({
        from: () => ({
          select: (columns: string) =>
            query(() =>
              Promise.resolve(
                columns === 'banner_key'
                  ? { data: [], error: null }
                  : { data: null, error: { code: '57014', message: 'cancelled' } },
              ),
            ),
        }),
      }),
    } as unknown as SupabaseClients;
    const store = createSupabaseMerchandisingStore(failing, { mediaBaseUrl: BASE });

    await expect(store.listBrands()).rejects.toThrow();
  });
});

function postgresPool(hasBanner: boolean, rows: unknown[]) {
  const queries: string[] = [];
  // Every read runs inside `withAnon`, which opens a client and a transaction first.
  const client = {
    query: (text: string) => {
      queries.push(text);
      if (text.includes('information_schema')) {
        return Promise.resolve({ rows: [{ present: hasBanner }] });
      }
      if (text === 'begin' || text === 'commit' || text === 'rollback') {
        return Promise.resolve({ rows: [] });
      }
      // A selected column that is null comes back as null, never missing.
      return Promise.resolve({
        rows: rows.map((row) => ({ banner_key: null, ...(row as object) })),
      });
    },
    release: () => undefined,
  };
  const fake = {
    connect: () => Promise.resolve(client),
    query: client.query,
  } as unknown as Pool;
  return { store: createPostgresMerchandisingStore(fake, { mediaBaseUrl: BASE }), queries };
}

describe('brand reads over the direct connection', () => {
  it('reads and shows the banner when the column exists', async () => {
    const { store, queries } = postgresPool(true, [brandRow({ banner_key: BANNER })]);

    const brands = await store.listBrands();

    const brandQuery = queries.find((text) => text.includes('from public.brands'));
    expect(brandQuery).toContain('b.banner_key');
    expect(brands[0]?.banner?.url).toBe(`${BASE}/${BANNER}/full.webp`);
  });

  it('reads a null banner when the column is missing, without failing', async () => {
    const { store, queries } = postgresPool(false, [brandRow()]);

    const brands = await store.listBrands();

    const brandQuery = queries.find((text) => text.includes('from public.brands'));
    expect(brandQuery).toContain('null::text as banner_key');
    expect(brands[0]?.banner).toBeNull();
  });

  it('asks the catalogue once for the schema', async () => {
    const { store, queries } = postgresPool(true, [brandRow()]);

    await store.listBrands();
    await store.listBrands();

    expect(queries.filter((text) => text.includes('information_schema'))).toHaveLength(1);
  });
});
