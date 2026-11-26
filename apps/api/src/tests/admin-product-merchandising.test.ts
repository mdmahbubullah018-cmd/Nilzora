import { adminProductResponseSchema } from '@nilzora/contracts';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { createPostgresAdminCatalogStore } from '../modules/admin/catalog-store';
import { createSupabaseCatalogStore } from '../modules/catalog/store';
import type { SupabaseClients } from '../supabase/clients';
import { adminSetup, errorOf, newProduct, sameContent } from './admin-helpers';

/*
 * Product tags and size charts through the admin product routes: request validation and
 * normal form, "left out keeps it" for older clients, the publish and content rules on a
 * product on sale, and how the stores pass and read the new fields. The database rules
 * (normal form, checks, privacy of tags) are covered by catalog_admin.test.sql.
 */

const USER = '3f1c9c5e-9a52-4a52-8f0a-2a3a6f0e1111';
const chart = {
  columns: ['Size', 'Chest (cm)'],
  rows: [
    ['M', '96'],
    ['L', '102'],
  ],
};

describe('product tags and size charts', () => {
  it('creates a product with tags in normal form and a size chart', async () => {
    const setup = adminSetup();
    const response = await setup.call(
      'post',
      '/admin/products',
      'staff',
      newProduct(setup, {
        tags: ['  Summer   Sale ', 'summer sale', 'EID-2026'],
        sizeChart: {
          columns: [' Size ', 'Chest (cm)'],
          rows: [
            [' M ', '96'],
            ['L', '102'],
          ],
        },
      }),
    );

    expect(response.status).toBe(201);
    const { product } = adminProductResponseSchema.parse(response.body);
    expect(product.tags).toEqual(['summer sale', 'eid-2026']);
    expect(product.sizeChart).toEqual(chart);
  });

  it('creates a product without tags or chart for older clients', async () => {
    const setup = adminSetup();
    const response = await setup.call('post', '/admin/products', 'staff', newProduct(setup));

    const { product } = adminProductResponseSchema.parse(response.body);
    expect(product.tags).toEqual([]);
    expect(product.sizeChart).toBeNull();
  });

  it.each([
    ['16 tags', { tags: Array.from({ length: 16 }, (_, i) => `tag ${String(i)}`) }, 'tags'],
    ['a tag with an underscore', { tags: ['half_price'] }, 'tags.0'],
    ['a tag over 30 characters', { tags: ['x'.repeat(31)] }, 'tags.0'],
    ['an empty tag', { tags: ['  '] }, 'tags.0'],
    [
      'a row of another width',
      { sizeChart: { columns: ['Size'], rows: [['M', 'L']] } },
      'sizeChart.rows',
    ],
    [
      'nine columns',
      { sizeChart: { columns: Array(9).fill('C'), rows: [Array(9).fill('1')] } },
      'sizeChart.columns',
    ],
    [
      '31 rows',
      { sizeChart: { columns: ['Size'], rows: Array.from({ length: 31 }, () => ['M']) } },
      'sizeChart.rows',
    ],
    [
      'an entry over 40 characters',
      { sizeChart: { columns: ['Size'], rows: [['x'.repeat(41)]] } },
      'sizeChart.rows.0.0',
    ],
    ['an unnamed column', { sizeChart: { columns: [' '], rows: [['M']] } }, 'sizeChart.columns.0'],
    ['an extra chart field', { sizeChart: { ...chart, colour: 'red' } }, 'sizeChart'],
    ['an unknown unit', { sizeChart: { ...chart, unit: 'ft' } }, 'sizeChart.unit'],
    [
      'a picture chart without its picture',
      { sizeChart: { columns: [], rows: [], mode: 'image' } },
      'sizeChart.imageKey',
    ],
  ])('rejects %s before the database', async (_label, fields, path) => {
    const setup = adminSetup();
    const response = await setup.call(
      'post',
      '/admin/products',
      'staff',
      newProduct(setup, fields),
    );

    expect(response.status).toBe(400);
    const issues = (errorOf(response.body).details as { issues: { path: string }[] }).issues;
    expect(issues.map((issue) => issue.path)).toContain(path);
    expect(setup.admin.calls).toEqual([]);
  });

  it('keeps tags and chart when an update leaves them out, and clears them when asked', async () => {
    const setup = adminSetup();
    const created = adminProductResponseSchema.parse(
      (
        await setup.call(
          'post',
          '/admin/products',
          'staff',
          newProduct(setup, { tags: ['eid'], sizeChart: chart }),
        )
      ).body,
    ).product;
    const fake = setup.admin.products.find((p) => p.id === created.id);
    if (!fake) throw new Error('created product missing');

    const kept = await setup.call(
      'put',
      `/admin/products/${created.id}`,
      'staff',
      sameContent(fake),
    );
    const cleared = await setup.call('put', `/admin/products/${created.id}`, 'staff', {
      ...sameContent(fake),
      tags: [],
      sizeChart: null,
    });

    expect(adminProductResponseSchema.parse(kept.body).product).toMatchObject({
      tags: ['eid'],
      sizeChart: chart,
    });
    expect(adminProductResponseSchema.parse(cleared.body).product).toMatchObject({
      tags: [],
      sizeChart: null,
    });
  });

  it('on a product on sale: retagging needs publish permission and the chart is locked', async () => {
    const setup = adminSetup();
    const lamp = setup.products.lamp;

    const staffTags = await setup.call('put', `/admin/products/${lamp.id}`, 'staff', {
      ...sameContent(lamp),
      tags: ['clearance'],
    });
    const adminTags = await setup.call('put', `/admin/products/${lamp.id}`, 'admin', {
      ...sameContent(lamp),
      tags: ['clearance'],
    });
    const adminChart = await setup.call('put', `/admin/products/${lamp.id}`, 'admin', {
      ...sameContent(lamp),
      sizeChart: chart,
    });

    expect(staffTags.status).toBe(403);
    expect(adminTags.status).toBe(200);
    expect(adminProductResponseSchema.parse(adminTags.body).product).toMatchObject({
      tags: ['clearance'],
      status: 'active',
      moderationStatus: 'approved',
    });
    expect(adminChart.status).toBe(409);
    expect(errorOf(adminChart.body).code).toBe('product_content_locked');
  });
});

describe('tags and size charts in the stores', () => {
  function recordingPool(detail: Record<string, unknown> | null) {
    const statements: { sql: string; values: unknown[] }[] = [];
    const client = {
      query: (sql: string, values: unknown[] = []) => {
        statements.push({ sql, values });
        if (sql.includes('admin_create_product')) {
          return Promise.resolve({ rows: [{ id: '0d000000-0000-4000-8000-000000000001' }] });
        }
        if (sql.includes('from public.products p') && detail) {
          return Promise.resolve({ rows: [detail] });
        }
        return Promise.resolve({ rows: [] });
      },
      release: () => undefined,
    } as unknown as PoolClient;
    const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;
    return { pool, statements };
  }

  const detailRow = {
    id: '0d000000-0000-4000-8000-000000000001',
    slug: 'linen-shirt',
    sku: 'LINEN-SHIRT',
    name: 'Linen shirt',
    summary: null,
    status: 'draft',
    moderation_status: 'not_submitted',
    price_minor: '45000',
    compare_at_price_minor: null,
    stock_quantity: 0,
    max_order_quantity: 5,
    is_featured: false,
    published_at: null,
    updated_at: new Date('2026-11-02T10:00:00Z'),
    description: null,
    created_at: new Date('2026-11-02T10:00:00Z'),
    category_id: 'ca000000-0000-4000-8000-000000000001',
    category_slug: 'clothing',
    category_name: 'Clothing',
    category_active: true,
    product_images: [],
    latest_review: null,
    size_chart: chart,
    tags: ['eid'],
  };

  const input = {
    categoryId: 'ca000000-0000-4000-8000-000000000001',
    slug: 'linen-shirt',
    sku: 'LINEN-SHIRT',
    name: 'Linen shirt',
    summary: null,
    description: null,
    priceMinor: 45_000,
    compareAtPriceMinor: null,
    maxOrderQuantity: 5,
    isFeatured: false,
    initialStock: 0,
  };

  it('creates through the full signature and reads the chart and tags back', async () => {
    const { pool, statements } = recordingPool(detailRow);

    const product = await createPostgresAdminCatalogStore(pool).createProduct('token', USER, {
      ...input,
      tags: ['eid'],
      sizeChart: chart,
    });

    const call = statements.find((entry) => entry.sql.includes('admin_create_product'));
    expect(call?.sql).toContain('$12::text[], $13::jsonb');
    expect(call?.values.slice(11)).toEqual([['eid'], JSON.stringify(chart)]);
    const read = statements.find((entry) => entry.sql.includes('from public.products p'));
    expect(read?.sql).toContain('public.admin_product_tags(p.id) as tags');
    expect(product).toMatchObject({ tags: ['eid'], sizeChart: chart });
  });

  it('updates keeping tags and chart when they are left out', async () => {
    const { pool, statements } = recordingPool(detailRow);
    const { initialStock: _stock, sku: _sku, ...fields } = input;

    await createPostgresAdminCatalogStore(pool).updateProduct('token', USER, detailRow.id, fields);

    const call = statements.find((entry) => entry.sql.includes('admin_update_product'));
    expect(call?.sql).toContain('$11::text[], $12::jsonb, $13::boolean');
    expect(call?.values.slice(10)).toEqual([null, null, false]);
  });

  it('updates clearing the chart when it is null', async () => {
    const { pool, statements } = recordingPool(detailRow);
    const { initialStock: _stock, sku: _sku, ...fields } = input;

    await createPostgresAdminCatalogStore(pool).updateProduct('token', USER, detailRow.id, {
      ...fields,
      tags: [],
      sizeChart: null,
    });

    const call = statements.find((entry) => entry.sql.includes('admin_update_product'));
    expect(call?.values.slice(10)).toEqual([[], null, true]);
  });

  it('shows shoppers the size chart on the product page', async () => {
    const product = {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'linen-shirt',
      sku: 'LINEN-SHIRT',
      name: 'Linen shirt',
      summary: null,
      description: null,
      price_minor: 45000,
      compare_at_price_minor: null,
      stock_quantity: 5,
      max_order_quantity: 3,
      is_featured: false,
      brand_id: null,
      size_chart: chart,
      category_slug: 'clothing',
      category_name: 'Clothing',
      campaign_id: null,
      campaign_title: null,
      campaign_ends_at: null,
      campaign_discount_kind: null,
      campaign_discount_value: null,
    };
    const selected: string[] = [];
    const builder = (table: string) => {
      const proxy: object = new Proxy(
        {},
        {
          get(_target, method: string) {
            if (method === 'then') {
              return (resolve: (value: unknown) => void) => {
                resolve({ data: table === 'products' ? product : [], error: null });
              };
            }
            return (...args: unknown[]) => {
              if (method === 'select' && table === 'products') selected.push(String(args[0]));
              return proxy;
            };
          },
        },
      );
      return proxy;
    };
    const clients = {
      public: () => ({
        from: builder,
        // catalog_product answers the priced row; .maybeSingle() is what the store calls.
        rpc: (name: string) => ({
          maybeSingle: () =>
            Promise.resolve({
              data: name === 'catalog_product' ? product : null,
              error: null,
            }),
          then: (resolve: (value: unknown) => void) =>
            resolve({ data: name === 'catalog_product' ? [product] : [], error: null }),
        }),
      }),
    } as unknown as SupabaseClients;

    const detail = await createSupabaseCatalogStore(clients).getProduct('linen-shirt');

    expect(detail?.sizeChart).toEqual(chart);
  });
});
