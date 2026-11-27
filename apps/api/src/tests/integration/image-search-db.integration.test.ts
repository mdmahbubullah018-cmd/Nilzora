import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import sharp from 'sharp';
import { createDatabasePool } from '../../db/pool';
import { withUser } from '../../db/user-context';
import { createPostgresImageSearchStore } from '../../modules/image-search/store';
import { ImageSearchRefusedError } from '../../modules/image-search/store';

/*
 * Real integration test for visual search: pgvector, the index state machine, the
 * eligibility triggers, the permission-checking admin functions and the product-card
 * function the results are built from.
 *
 * Fixtures (a category, a product, its picture, an account of each kind) are created here and
 * removed afterwards; nothing existing is read or changed.
 */

const { dbUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 4 });
const store = createPostgresImageSearchStore(pool);

const run = randomUUID().slice(0, 8);
const tag = `nzimg${run}`;
const created = { products: [] as string[], categories: [] as string[], users: [] as string[] };
let owner: string;
let customer: string;
let productId: string;
let imageId: string;

async function addUser(label: string, role: 'super_admin' | 'customer'): Promise<string> {
  const id = randomUUID();
  await pool.query('select public.provision_account($1::uuid, $2, $3, null, null, true)', [
    id,
    `it-image-${run}-${label}@example.com`,
    `Image ${label}`,
  ]);
  if (role !== 'customer') {
    await pool.query('update public.user_roles set role = $1 where user_id = $2', [role, id]);
  }
  created.users.push(id);
  return id;
}

beforeAll(async () => {
  owner = await addUser('owner', 'super_admin');
  customer = await addUser('customer', 'customer');

  const category = await pool.query<{ id: string }>(
    `insert into public.categories (slug, name, sort_order, is_active)
     values ($1, $2, 991, true) returning id`,
    [`${tag}-category`, `Image ${run}`],
  );
  const categoryId = category.rows[0]?.id;
  if (categoryId === undefined) throw new Error('category fixture failed');
  created.categories.push(categoryId);

  const product = await pool.query<{ id: string }>(
    `insert into public.products
       (category_id, slug, sku, name, summary, price_minor, stock_quantity, max_order_quantity,
        status, moderation_status, published_at)
     values ($1, $2, $3, $4, $5, 12000, 5, 5, 'active', 'approved', now())
     returning id`,
    [
      categoryId,
      `${tag}-product`,
      `NZIMG${run}`.toUpperCase(),
      `Image product ${run}`,
      'A picture',
    ],
  );
  productId = product.rows[0]?.id ?? '';
  created.products.push(productId);

  // A real picture, stored the way the media pipeline stores one.
  imageId = randomUUID();
  const picture = await sharp({
    create: { width: 640, height: 640, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="640" height="640"><rect width="640" height="640" fill="#0284c7"/><circle cx="320" cy="320" r="160" fill="#22c55e"/></svg>',
        ),
        top: 0,
        left: 0,
      },
    ])
    .webp()
    .toBuffer();

  await pool.query(
    `insert into public.product_images (id, product_id, storage_key, width, height, bytes, position)
     values ($1, $2, $3, 640, 640, $4, 0)`,
    [imageId, productId, `products/${productId}/${imageId}`, picture.length],
  );
});

afterAll(async () => {
  await pool.query('delete from public.image_search_jobs where created_by = any($1::uuid[])', [
    created.users,
  ]);
  await pool.query('delete from public.products where id = any($1::uuid[])', [created.products]);
  await pool.query('delete from public.categories where id = any($1::uuid[])', [
    created.categories,
  ]);
  await pool.query('delete from public.profiles where id = any($1::uuid[])', [created.users]);
  await pool.end();
});

describe('visual search in PostgreSQL', () => {
  it('queues a new product picture through the trigger, with its eligibility decided', async () => {
    const rows = await pool.query<{
      status: string;
      kind: string;
      is_primary: boolean;
      width: number;
      exclusion_reason: string | null;
    }>(
      `select status::text as status, kind::text as kind, is_primary, width, exclusion_reason
       from public.image_search_images where product_id = $1`,
      [productId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      status: 'pending',
      kind: 'primary',
      is_primary: true,
      width: 640,
    });
  });

  it('excludes a picture smaller than 128 px instead of queueing it for embedding', async () => {
    const smallId = randomUUID();
    await pool.query(
      `insert into public.product_images (id, product_id, storage_key, width, height, bytes, position)
       values ($1, $2, $3, 64, 64, 900, 1)`,
      [smallId, productId, `products/${productId}/${smallId}`],
    );
    const rows = await pool.query<{ status: string; exclusion_reason: string }>(
      `select status::text as status, exclusion_reason from public.image_search_images
       where product_id = $1 and product_image_id = $2`,
      [productId, smallId],
    );
    expect(rows.rows[0]).toMatchObject({ status: 'excluded', exclusion_reason: 'too_small' });
    await pool.query('delete from public.product_images where id = $1', [smallId]);
    const gone = await pool.query(
      'select 1 from public.image_search_images where product_image_id = $1',
      [smallId],
    );
    expect(gone.rowCount).toBe(0);
  });

  it('removes the index row when the picture is deleted', async () => {
    const doomedId = randomUUID();
    await pool.query(
      `insert into public.product_images (id, product_id, storage_key, width, height, bytes, position)
       values ($1, $2, $3, 800, 800, 4000, 3)`,
      [doomedId, productId, `products/${productId}/${doomedId}`],
    );
    await pool.query('delete from public.product_images where id = $1', [doomedId]);
    const rows = await pool.query(
      'select 1 from public.image_search_images where product_image_id = $1',
      [doomedId],
    );
    expect(rows.rowCount).toBe(0);
  });

  it('stores a vector once per content hash, and never compares two models', async () => {
    const vector = new Array(512).fill(0);
    vector[0] = 1;
    await store.recordIndexed({
      id: (await store.claim(10, null))[0]?.id ?? '',
      contentHash: 'b'.repeat(64),
      model: 'test-model',
      dimensions: 512,
      vector: `[${vector.join(',')}]`,
      width: 640,
      height: 640,
    });
    const indexed = await pool.query(
      `select 1 from public.image_search_embeddings where content_hash = $1 and model = 'test-model'`,
      ['b'.repeat(64)],
    );
    expect(indexed.rowCount).toBe(1);

    const other = await pool.query(
      `select * from public.image_search_nearest($1::extensions.vector, 'another-model', 512, 5)`,
      [`[${vector.join(',')}]`],
    );
    expect(other.rowCount).toBe(0);
  });

  it('returns the product card the catalogue would return', async () => {
    const cards = await pool.query<{ id: string; name: string; category_slug: string }>(
      `select id, name, category_slug from public.catalog_products_by_ids($1::uuid[])`,
      [[productId]],
    );
    expect(cards.rows[0]).toMatchObject({ id: productId, category_slug: `${tag}-category` });
  });

  it('refuses the admin functions to an account without image_search.manage', async () => {
    await expect(
      withUser(pool, customer, async (client) =>
        client.query('select public.admin_image_search_stats()'),
      ),
    ).rejects.toThrow();
    await expect(
      withUser(pool, owner, async (client) =>
        client.query('select public.admin_image_search_stats()'),
      ),
    ).resolves.toBeTruthy();
  });

  it('refuses a second job while one is running, and records the caller', async () => {
    await pool.query(`delete from public.image_search_jobs where status in ('queued', 'running')`);
    await store.adminStartJob(owner, 'backfill');
    await expect(store.adminStartJob(owner, 'reindex_all')).rejects.toBeInstanceOf(
      ImageSearchRefusedError,
    );
    const jobs = await pool.query<{ created_by: string }>(
      `select created_by from public.image_search_jobs where status in ('queued', 'running')`,
    );
    expect(jobs.rows[0]?.created_by).toBe(owner);
    await pool.query(`delete from public.image_search_jobs where status in ('queued', 'running')`);
  });

  it('answers the missing-image list without a stale reference', async () => {
    await pool.query(
      `insert into public.products
         (category_id, slug, sku, name, summary, price_minor, stock_quantity, max_order_quantity,
          status, moderation_status, published_at)
       select category_id, $1, $2, $3, null, 5000, 1, 1, 'active', 'approved', now()
       from public.products where id = $4`,
      [`${tag}-bare`, `NZIMGB${run}`.toUpperCase(), `Bare product ${run}`, productId],
    );
    const bare = await pool.query<{ id: string }>(
      'select id from public.products where slug = $1',
      [`${tag}-bare`],
    );
    const bareId = bare.rows[0]?.id ?? '';
    created.products.push(bareId);

    const answer = await withUser(pool, owner, async (client) => {
      const result = await client.query<{
        value: { items: { product_id: string; reason: string }[]; total: number };
      }>(`select public.admin_image_search_missing_images($1, 20, 0) as value`, [
        `Bare product ${run}`,
      ]);
      return result.rows[0]?.value;
    });
    expect(answer?.items.map((item) => item.product_id)).toContain(bareId);
    expect(answer?.items.find((item) => item.product_id === bareId)?.reason).toBe('no_images');
  });
});
