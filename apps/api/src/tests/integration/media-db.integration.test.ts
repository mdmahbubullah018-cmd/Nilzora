import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabasePool } from '../../db/pool';
import { AdminRefusalError } from '../../modules/admin/errors';
import { StoreUnavailableError } from '../../modules/commerce/errors';
import { createPostgresProductImageStore } from '../../modules/media/store';

/*
 * Real integration test for the direct-PostgreSQL product-image store: reads run under
 * RLS, every change still goes through the permission-checking database functions.
 * Catalog and account fixtures are created here and removed afterwards.
 */

const { dbUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 4 });
const images = createPostgresProductImageStore(pool);

const NO_TOKEN = 'direct-connection';

const run = randomUUID().slice(0, 8);
const tag = `nzimg${run}`;

const created = {
  categories: [] as string[],
  products: [] as string[],
  users: [] as string[],
};
let productId: string;
let staff: string;
let customer: string;

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

function newImage(alt: string | null = null) {
  return {
    productId,
    imageId: randomUUID(),
    width: 1200,
    height: 1200,
    bytes: 84_000,
    alt,
  };
}

beforeAll(async () => {
  const categories = await pool.query<{ id: string }>(
    `insert into public.categories (slug, name, sort_order, is_active)
     values ($1, $2, 990, true) returning id`,
    [`${tag}-open`, `Open ${run}`],
  );
  const categoryId = categories.rows[0]?.id;
  if (!categoryId) throw new Error('category fixture was not created');
  created.categories.push(categoryId);

  const products = await pool.query<{ id: string }>(
    `insert into public.products
       (category_id, slug, sku, name, summary, price_minor, stock_quantity, max_order_quantity, status)
     values ($1, $2, $3, $4, $5, 10000, 10, 10, 'draft')
     returning id`,
    [
      categoryId,
      `${tag}-lamp`,
      `IMG-${run.toUpperCase()}-LAMP`,
      `${tag} lamp`,
      `Image fixture ${run}`,
    ],
  );
  const id = products.rows[0]?.id;
  if (!id) throw new Error('product fixture was not created');
  productId = id;
  created.products.push(id);

  staff = await addUser('staff', 'super_admin');
  customer = await addUser('customer', 'customer');
});

afterAll(async () => {
  if (created.users.length > 1) {
    // Staff accounts own audit rows; detach them before removing the fixtures.
    await pool.query(
      'update public.audit_log set actor_id = null where actor_id = any($1::uuid[])',
      [created.users],
    );
  }
  if (created.products.length > 0) {
    await pool.query('delete from public.product_images where product_id = any($1::uuid[])', [
      created.products,
    ]);
    await pool.query('delete from public.products where id = any($1::uuid[])', [created.products]);
  }
  if (created.categories.length > 0) {
    await pool.query('delete from public.categories where id = any($1::uuid[])', [
      created.categories,
    ]);
  }
  if (created.users.length > 0) {
    await pool.query('delete from public.profiles where id = any($1::uuid[])', [created.users]);
  }
  await pool.end();
});

describe('product images over the direct connection', () => {
  it('adds, lists, reorders, re-labels and removes images as staff', async () => {
    const first = newImage('Front');
    await images.add(NO_TOKEN, staff, first);
    const second = newImage();
    await images.add(NO_TOKEN, staff, second);

    const listed = await images.list(NO_TOKEN, staff, productId);
    expect(listed.map((row) => row.id)).toEqual([first.imageId, second.imageId]);
    expect(listed[0]).toMatchObject({ alt_text: 'Front', position: 0 });
    expect(listed[0]?.storage_key).toBe(`products/${productId}/${first.imageId}`);

    await expect(images.productOf(NO_TOKEN, staff, first.imageId)).resolves.toBe(productId);

    await images.updateAlt(NO_TOKEN, staff, second.imageId, 'Back');
    await images.reorder(NO_TOKEN, staff, productId, [second.imageId, first.imageId]);
    const reordered = await images.list(NO_TOKEN, staff, productId);
    expect(reordered.map((row) => [row.id, row.position, row.alt_text])).toEqual([
      [second.imageId, 0, 'Back'],
      [first.imageId, 1, 'Front'],
    ]);

    const key = await images.remove(NO_TOKEN, staff, first.imageId);
    expect(key).toBe(`products/${productId}/${first.imageId}`);
    await expect(images.productOf(NO_TOKEN, staff, first.imageId)).resolves.toBeNull();
  });

  it('refuses a caller without the product permission', async () => {
    await expect(images.list(NO_TOKEN, customer, productId)).resolves.toEqual([]);
    await expect(images.add(NO_TOKEN, customer, newImage())).rejects.toBeInstanceOf(
      AdminRefusalError,
    );
  });

  it('fails closed for an identity that is not an account id', async () => {
    await expect(images.list(NO_TOKEN, 'not-a-uuid', productId)).rejects.toBeInstanceOf(
      StoreUnavailableError,
    );
  });

  it('reports a database failure instead of image rows', async () => {
    const closed = createDatabasePool({ connectionString: dbUrl, max: 1 });
    await closed.end();
    const broken = createPostgresProductImageStore(closed);
    await expect(broken.list(NO_TOKEN, staff, productId)).rejects.toBeInstanceOf(
      StoreUnavailableError,
    );
  });
});
