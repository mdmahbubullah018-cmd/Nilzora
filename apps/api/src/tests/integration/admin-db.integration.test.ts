import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabasePool } from '../../db/pool';
import { withUser } from '../../db/user-context';
import { createPostgresAdminAccountStore } from '../../modules/admin/accounts-store';
import { createPostgresAdminCatalogStore } from '../../modules/admin/catalog-store';
import { AdminRefusalError } from '../../modules/admin/errors';
import { createPostgresAdminReportStore } from '../../modules/admin/reports-store';
import { StoreUnavailableError } from '../../modules/commerce/errors';

/*
 * Real integration test for the direct-PostgreSQL admin stores: reads run under the
 * same RLS policies, every change still goes through the permission-checking database
 * functions. Fixtures are created here and removed afterwards.
 */

const { dbUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 4 });
const catalog = createPostgresAdminCatalogStore(pool);
const accounts = createPostgresAdminAccountStore(pool);
const reports = createPostgresAdminReportStore(pool);

const NO_TOKEN = 'direct-connection';

const run = randomUUID().slice(0, 8);
const tag = `nzadm${run}`;

const created = { categories: [] as string[], products: [] as string[], users: [] as string[] };
let owner: string;
let admin: string;
let customer: string;
let categoryId: string;
let productId: string;

async function addUser(label: string, role: 'super_admin' | 'admin' | 'customer'): Promise<string> {
  const id = randomUUID();
  await pool.query('select public.provision_account($1::uuid, $2, $3, null, null, true)', [
    id,
    `it-admin-${run}-${label}@example.com`,
    `Admin ${label}`,
  ]);
  if (role !== 'customer') {
    await pool.query('update public.user_roles set role = $1 where user_id = $2', [role, id]);
  }
  created.users.push(id);
  return id;
}

beforeAll(async () => {
  const categories = await pool.query<{ id: string }>(
    `insert into public.categories (slug, name, sort_order, is_active)
     values ($1, $2, 990, true) returning id`,
    [`${tag}-seed`, `Seed ${run}`],
  );
  const id = categories.rows[0]?.id;
  if (!id) throw new Error('category fixture was not created');
  categoryId = id;
  created.categories.push(id);

  const products = await pool.query<{ id: string }>(
    `insert into public.products
       (category_id, slug, sku, name, summary, price_minor, stock_quantity, max_order_quantity, status)
     values ($1, $2, $3, $4, $5, 10000, 0, 10, 'active')
     returning id`,
    // Out of stock and named to sort first: the report lists the ten lowest (by stock, then
    // name), so a shared database with other empty products must not crowd the fixture out.
    [id, `${tag}-lamp`, `ADM-${run.toUpperCase()}`, `0000 ${tag} lamp`, `Admin fixture ${run}`],
  );
  const pid = products.rows[0]?.id;
  if (!pid) throw new Error('product fixture was not created');
  productId = pid;
  created.products.push(pid);

  await pool.query(
    `insert into public.delivery_charges (zone, amount_minor)
     values ('inside_dhaka', 7000), ('outside_dhaka', 13000)
     on conflict (zone) do nothing`,
  );

  owner = await addUser('owner', 'super_admin');
  admin = await addUser('editor', 'admin');
  customer = await addUser('customer', 'customer');
});

afterAll(async () => {
  if (created.products.length > 0) {
    await pool.query('delete from public.inventory_movements where product_id = any($1::uuid[])', [
      created.products,
    ]);
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
    await pool.query(
      'update public.audit_log set actor_id = null where actor_id = any($1::uuid[])',
      [created.users],
    );
    await pool.query('delete from public.profiles where id = any($1::uuid[])', [created.users]);
  }
  await pool.end();
});

describe('admin catalog over the direct connection', () => {
  it('lists categories and products for a caller with products.read', async () => {
    const categories = await catalog.listCategories(NO_TOKEN, owner);
    expect(categories.map((category) => category.id)).toContain(categoryId);

    const page = await catalog.listProducts(NO_TOKEN, owner, { search: tag }, 'updated_desc', {
      limit: 10,
      offset: 0,
    });
    expect(page.total).toBeGreaterThan(0);
    expect(page.products.map((product) => product.id)).toContain(productId);
    expect(page.products[0]?.category.id).toBe(categoryId);
  });

  it('creates, updates, adjusts stock and lists the ledger', async () => {
    const createdProduct = await catalog.createProduct(NO_TOKEN, owner, {
      categoryId,
      slug: `${tag}-created`,
      sku: `ADM-${run.toUpperCase()}-C`,
      name: `${tag} created`,
      summary: 'Created by the integration test',
      description: null,
      priceMinor: 12_000,
      compareAtPriceMinor: null,
      maxOrderQuantity: 5,
      isFeatured: false,
      initialStock: 4,
    });
    created.products.push(createdProduct.id);
    expect(createdProduct).toMatchObject({ name: `${tag} created`, stockQuantity: 4 });

    const adjusted = await catalog.adjustStock(
      NO_TOKEN,
      owner,
      createdProduct.id,
      2,
      'test top-up',
    );
    expect(adjusted.stockQuantity).toBe(6);

    const movements = await catalog.listMovements(
      NO_TOKEN,
      owner,
      { productId: createdProduct.id },
      { limit: 10, offset: 0 },
    );
    expect(movements.total).toBeGreaterThan(0);
    expect(movements.movements[0]).toMatchObject({
      change: 2,
      stockAfter: 6,
      reason: 'adjustment',
    });

    // The store owner publishing explicitly approves content no review has seen.
    const published = await catalog.setProductStatus(NO_TOKEN, owner, createdProduct.id, 'active');
    expect(published).toMatchObject({ status: 'active', moderationStatus: 'approved' });

    // An admin who holds products.publish still follows the review workflow, and the
    // database's refusal code is mapped exactly as before.
    const unreviewed = await catalog.createProduct(NO_TOKEN, owner, {
      categoryId,
      slug: `${tag}-unreviewed`,
      sku: `ADM-${run.toUpperCase()}-U`,
      name: `${tag} unreviewed`,
      summary: 'Left without a review on purpose',
      description: null,
      priceMinor: 12_000,
      compareAtPriceMinor: null,
      maxOrderQuantity: 5,
      isFeatured: false,
      initialStock: 0,
    });
    created.products.push(unreviewed.id);
    await expect(
      catalog.setProductStatus(NO_TOKEN, admin, unreviewed.id, 'active'),
    ).rejects.toMatchObject({ name: 'AdminRefusalError', refusal: 'not_approved' });
  });

  it('saves a category and reads it back', async () => {
    const saved = await catalog.saveCategory(NO_TOKEN, owner, null, {
      slug: `${tag}-saved`,
      name: `Saved ${run}`,
      description: null,
      sortOrder: 991,
      isActive: true,
      isFeatured: false,
      parentId: null,
    });
    created.categories.push(saved.id);
    expect(saved).toMatchObject({ slug: `${tag}-saved`, isActive: true, productCount: 0 });
  });

  it('reports delivery charges, order counts and low stock', async () => {
    const charges = await reports.deliveryCharges(NO_TOKEN, owner);
    expect(charges.map((charge) => charge.zone)).toEqual(['inside_dhaka', 'outside_dhaka']);
    expect(charges.every((charge) => typeof charge.amountMinor === 'number')).toBe(true);

    const counts = await reports.orderCounts(NO_TOKEN, owner);
    expect(Object.values(counts).every((value) => typeof value === 'number')).toBe(true);

    const stock = await reports.lowStock(NO_TOKEN, owner);
    expect(stock.products.map((product) => product.id)).toContain(productId);
  });

  it('lists permissions and staff for an owner', async () => {
    const permissions = await accounts.listPermissions(NO_TOKEN, owner);
    expect(permissions.map((permission) => permission.name)).toContain('products.read');

    const staff = await accounts.listStaff(NO_TOKEN, owner);
    expect(staff.map((member) => member.id)).toContain(owner);
  });

  it('leaves the switch alone when a legacy call omits the sixth argument', async () => {
    // A caller written before this migration can only pass the five original arguments, and
    // PostgreSQL resolves that call to the six-argument function through its parameter default.
    // The default is null, so the switch keeps whatever it was.
    try {
      for (const existing of [false, true]) {
        await pool.query('update public.store_settings set cod_enabled = $1 where id', [existing]);

        const reported = await withUser(pool, owner, async (client) => {
          const result = await client.query<{ value: { codEnabled: boolean } }>(
            `select public.admin_save_store_settings(
               $1::integer, $2::integer, $3::integer, $4::bigint, $5::integer) as value`,
            [7, 120, null, null, null],
          );
          return result.rows[0]?.value.codEnabled;
        });

        expect(reported).toBe(existing);
        const stored = await pool.query<{ cod_enabled: boolean }>(
          'select cod_enabled from public.store_settings where id',
        );
        expect(stored.rows[0]?.cod_enabled).toBe(existing);
      }
    } finally {
      await pool.query('update public.store_settings set cod_enabled = true where id');
    }
  });

  it('saves the cash on delivery switch and leaves it alone when it is not sent', async () => {
    const current = await reports.storeSettings(NO_TOKEN, owner);
    expect(current.codEnabled).toBe(true);

    try {
      const off = await reports.saveStoreSettings(NO_TOKEN, owner, {
        returnWindowDays: current.returnWindowDays,
        cartInactivityMinutes: current.cartInactivityMinutes,
        codEnabled: false,
      });
      expect(off.codEnabled).toBe(false);

      const stored = await pool.query<{ cod_enabled: boolean }>(
        'select cod_enabled from public.store_settings where id',
      );
      expect(stored.rows[0]?.cod_enabled).toBe(false);

      // A request without the switch (the settings form that only edits the return window)
      // must not quietly turn cash on delivery back on.
      const untouched = await reports.saveStoreSettings(NO_TOKEN, owner, {
        returnWindowDays: current.returnWindowDays,
        cartInactivityMinutes: current.cartInactivityMinutes,
      });
      expect(untouched.codEnabled).toBe(false);

      const on = await reports.saveStoreSettings(NO_TOKEN, owner, {
        returnWindowDays: current.returnWindowDays,
        cartInactivityMinutes: current.cartInactivityMinutes,
        codEnabled: true,
      });
      expect(on.codEnabled).toBe(true);
    } finally {
      await pool.query('update public.store_settings set cod_enabled = true where id');
    }
  });

  it('refuses staff management for a customer account', async () => {
    await expect(accounts.listStaff(NO_TOKEN, customer)).rejects.toBeInstanceOf(AdminRefusalError);
  });

  it('fails closed for an identity that is not an account id', async () => {
    await expect(
      catalog.listProducts(NO_TOKEN, 'not-a-uuid', {}, 'updated_desc', {
        limit: 10,
        offset: 0,
      }),
    ).rejects.toBeInstanceOf(StoreUnavailableError);
  });

  it('reports a database failure instead of products', async () => {
    const closed = createDatabasePool({ connectionString: dbUrl, max: 1 });
    await closed.end();
    const broken = createPostgresAdminCatalogStore(closed);
    await expect(
      broken.listProducts(NO_TOKEN, owner, {}, 'updated_desc', { limit: 10, offset: 0 }),
    ).rejects.toBeInstanceOf(StoreUnavailableError);
  });
});
