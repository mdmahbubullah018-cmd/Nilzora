import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabasePool } from '../../db/pool';
import { createPostgresAdminCatalogStore } from '../../modules/admin/catalog-store';
import { AdminRefusalError } from '../../modules/admin/errors';

/*
 * Categories and subcategories against the local database (migrations 20261030090000 and
 * 20261228090000): the tree rules, the atomic reorder, the branch-aware product filter and the
 * delete guards. Fixtures use this run's own slugs and are removed afterwards.
 */

const { dbUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 4 });
const catalog = createPostgresAdminCatalogStore(pool);
const NO_TOKEN = 'direct-connection';
const run = randomUUID().slice(0, 8);
const tag = `nzcat${run}`;

const created = { categories: [] as string[], products: [] as string[], users: [] as string[] };
let admin: string;
let customer: string;

async function addUser(label: string, role: 'admin' | 'customer'): Promise<string> {
  const id = randomUUID();
  await pool.query('select public.provision_account($1::uuid, $2, $3, null, null, true)', [
    id,
    `it-cat-${run}-${label}@example.com`,
    `Cat ${label}`,
  ]);
  if (role !== 'customer') {
    await pool.query('update public.user_roles set role = $1 where user_id = $2', [role, id]);
  }
  created.users.push(id);
  return id;
}

async function addCategory(slug: string, parentId: string | null, order = 0): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into public.categories (slug, name, sort_order, is_active, parent_id)
     values ($1, $2, $3, true, $4) returning id`,
    [`${tag}-${slug}`, `${tag} ${slug}`, order, parentId],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('category fixture was not created');
  created.categories.push(id);
  return id;
}

async function addProduct(slug: string, categoryId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into public.products
       (category_id, slug, sku, name, summary, price_minor, stock_quantity, max_order_quantity, status)
     values ($1, $2, $3, $4, 'tree fixture', 10000, 2, 10, 'active') returning id`,
    [categoryId, `${tag}-${slug}`, `${tag}-${slug}`.toUpperCase(), `${tag} ${slug}`],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('product fixture was not created');
  created.products.push(id);
  return id;
}

async function sortOrders(ids: readonly string[]): Promise<Record<string, number>> {
  const rows = await pool.query<{ id: string; sort_order: number }>(
    'select id, sort_order from public.categories where id = any($1::uuid[])',
    [ids],
  );
  return Object.fromEntries(rows.rows.map((row) => [row.id, row.sort_order]));
}

let department: string;
let first: string;
let second: string;
let third: string;
let grandchild: string;

beforeAll(async () => {
  admin = await addUser('admin', 'admin');
  customer = await addUser('customer', 'customer');
  department = await addCategory('dept', null, 990);
  first = await addCategory('one', department, 0);
  second = await addCategory('two', department, 10);
  third = await addCategory('three', department, 20);
  grandchild = await addCategory('deep', first, 0);
});

afterAll(async () => {
  await pool.query('delete from public.products where id = any($1::uuid[])', [created.products]);
  // Children first: a category with children cannot be deleted.
  await pool.query(
    `delete from public.categories where slug like $1 and parent_id is not null
       and id not in (select parent_id from public.categories where parent_id is not null)`,
    [`${tag}-%`],
  );
  for (let pass = 0; pass < 3; pass += 1) {
    await pool.query(
      `delete from public.categories c where c.slug like $1
         and not exists (select 1 from public.categories k where k.parent_id = c.id)
         and not exists (select 1 from public.products p where p.category_id = c.id)`,
      [`${tag}-%`],
    );
  }
  await pool.query('delete from public.profiles where id = any($1::uuid[])', [created.users]);
  await pool.end();
});

describe('subcategories and the database rules', () => {
  it('refuses a category under itself, under its own child, or a fourth level', async () => {
    await expect(
      pool.query('update public.categories set parent_id = id where id = $1', [department]),
    ).rejects.toMatchObject({ code: 'NZ422' });
    await expect(
      pool.query('update public.categories set parent_id = $1 where id = $2', [first, department]),
    ).rejects.toMatchObject({ code: 'NZ422' });
    await expect(addCategory('fourth', grandchild)).rejects.toMatchObject({ code: 'NZ422' });
  });

  it('refuses a duplicate address', async () => {
    await expect(
      pool.query(
        `insert into public.categories (slug, name) select slug, 'Again' from public.categories where id = $1`,
        [first],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('will not delete a category that has products or subcategories, and never cascades', async () => {
    const product = await addProduct('held', second);
    await expect(catalog.deleteCategory(NO_TOKEN, admin, second)).rejects.toBeInstanceOf(
      AdminRefusalError,
    );
    await expect(catalog.deleteCategory(NO_TOKEN, admin, first)).rejects.toBeInstanceOf(
      AdminRefusalError,
    );
    const still = await pool.query('select 1 from public.products where id = $1', [product]);
    expect(still.rowCount).toBe(1);
  });
});

describe('reordering a group', () => {
  it('rewrites the whole group in the order given, in one step', async () => {
    await catalog.reorderCategories(NO_TOKEN, admin, department, [third, first, second]);
    expect(await sortOrders([first, second, third])).toEqual({
      [third]: 0,
      [first]: 10,
      [second]: 20,
    });
    // Nothing outside the group moved.
    expect((await sortOrders([department]))[department]).toBe(990);
    expect((await sortOrders([grandchild]))[grandchild]).toBe(0);
  });

  it('refuses a partial list, a repeat or another group, and changes nothing', async () => {
    const before = await sortOrders([first, second, third]);
    for (const ids of [
      [first, second],
      [first, first, second],
      [first, second, grandchild],
    ]) {
      await expect(
        catalog.reorderCategories(NO_TOKEN, admin, department, ids),
      ).rejects.toBeInstanceOf(AdminRefusalError);
    }
    expect(await sortOrders([first, second, third])).toEqual(before);
  });

  it('is for people who may publish products, not customers', async () => {
    await expect(
      catalog.reorderCategories(NO_TOKEN, customer, department, [first, second, third]),
    ).rejects.toBeDefined();
  });
});

describe('the product list by category', () => {
  it('a department includes its subcategories at every depth; a subcategory only its own', async () => {
    const direct = await addProduct('direct', department);
    const inFirst = await addProduct('infirst', first);
    const inDeep = await addProduct('indeep', grandchild);
    const names = async (categoryId: string) => {
      const page = await catalog.listProducts(NO_TOKEN, admin, { categoryId }, 'name_asc', {
        limit: 50,
        offset: 0,
      });
      return page.products.map((product) => product.id);
    };

    const whole = await names(department);
    expect(whole).toEqual(expect.arrayContaining([direct, inFirst, inDeep]));
    const sub = await names(first);
    expect(sub).toEqual(expect.arrayContaining([inFirst, inDeep]));
    expect(sub).not.toContain(direct);
    expect(await names(grandchild)).toEqual([inDeep]);
  });
});
