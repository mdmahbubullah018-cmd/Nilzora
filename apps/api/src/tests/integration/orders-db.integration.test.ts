import { randomUUID } from 'node:crypto';
import type { CartItem } from '@nilzora/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabasePool } from '../../db/pool';
import { StoreUnavailableError } from '../../modules/commerce/errors';
import { createPostgresOrderStore, type PlaceOrderInput } from '../../modules/orders/store';

/*
 * Real integration test for the direct-PostgreSQL order store: placement and
 * cancellation still run through the database functions, reads run under RLS.
 * Catalog, delivery-charge and account fixtures are created here and removed after.
 */

const { dbUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 4 });
const orders = createPostgresOrderStore(pool);

/** The shared store interface still passes an access token; the direct connection does not use it. */
const NO_TOKEN = 'direct-connection';

const run = randomUUID().slice(0, 8);
const tag = `nzord${run}`;
const skuTag = `ORD-${run.toUpperCase()}`;

const created = {
  categories: [] as string[],
  products: [] as string[],
  users: [] as string[],
  chargeZones: [] as string[],
};
let productId: string;
let owner: string;
let other: string;
let ownerAddress: string;

async function addUser(label: string): Promise<string> {
  const id = randomUUID();
  await pool.query('select public.provision_account($1::uuid, $2, $3, null, null, true)', [
    id,
    `it-order-${run}-${label}@example.com`,
    `Order ${label}`,
  ]);
  created.users.push(id);
  return id;
}

async function addAddress(userId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into public.addresses
       (user_id, label, recipient_name, phone, division, district, area, address_line, postal_code)
     values ($1, 'Home', 'Rahima Khatun', '+8801712345678', 'Dhaka', 'Dhaka', 'Dhanmondi',
             'House 12, Road 5', '1212')
     returning id`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('address fixture was not created');
  return row.id;
}

function placeInput(addressId: string, quantity = 2, key = randomUUID()): PlaceOrderInput {
  const items: CartItem[] = [{ productId, quantity }];
  return {
    idempotencyKey: key,
    addressId,
    items,
    expectedTotalMinor: 10_000 * quantity + 7_000,
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
       (category_id, slug, sku, name, summary, price_minor, stock_quantity, max_order_quantity,
        status, published_at)
     values ($1, $2, $3, $4, $5, 10000, 10, 10, 'active', now())
     returning id`,
    [categoryId, `${tag}-lamp`, `${skuTag}-LAMP`, `${tag} lamp`, `Order fixture ${run}`],
  );
  const id = products.rows[0]?.id;
  if (!id) throw new Error('product fixture was not created');
  productId = id;
  created.products.push(id);

  const charges = await pool.query<{ zone: string }>(
    `insert into public.delivery_charges (zone, amount_minor)
     values ('inside_dhaka', 7000), ('outside_dhaka', 13000)
     on conflict (zone) do nothing
     returning zone`,
  );
  created.chargeZones = charges.rows.map((row) => row.zone);

  owner = await addUser('owner');
  other = await addUser('other');
  ownerAddress = await addAddress(owner);
});

afterAll(async () => {
  if (created.users.length > 0) {
    await pool.query('delete from public.orders where user_id = any($1::uuid[])', [created.users]);
    await pool.query('delete from public.profiles where id = any($1::uuid[])', [created.users]);
  }
  if (created.products.length > 0) {
    await pool.query('delete from public.inventory_movements where product_id = any($1::uuid[])', [
      created.products,
    ]);
    await pool.query('delete from public.products where id = any($1::uuid[])', [created.products]);
  }
  if (created.categories.length > 0) {
    await pool.query('delete from public.categories where id = any($1::uuid[])', [
      created.categories,
    ]);
  }
  if (created.chargeZones.length > 0) {
    await pool.query('delete from public.delivery_charges where zone::text = any($1::text[])', [
      created.chargeZones,
    ]);
  }
  await pool.end();
});

describe('orders over the direct connection', () => {
  it('places an order through the database function and reads it back', async () => {
    const placed = await orders.place(NO_TOKEN, owner, placeInput(ownerAddress));

    expect(placed.created).toBe(true);
    expect(placed.order).toMatchObject({
      status: 'pending',
      paymentStatus: 'pending',
      itemCount: 2,
      subtotalMinor: 20_000,
      shippingFeeMinor: 7_000,
      totalMinor: 27_000,
      canCancel: true,
    });
    expect(placed.order.items).toHaveLength(1);
    expect(placed.order.history.length).toBeGreaterThan(0);

    const fetched = await orders.get(NO_TOKEN, owner, placed.order.orderNumber);
    expect(fetched?.orderNumber).toBe(placed.order.orderNumber);
  });

  it('returns the same order for a replayed idempotency key', async () => {
    const key = randomUUID();
    const first = await orders.place(NO_TOKEN, owner, placeInput(ownerAddress, 1, key));
    const replay = await orders.place(NO_TOKEN, owner, placeInput(ownerAddress, 1, key));

    expect(replay.created).toBe(false);
    expect(replay.order.orderNumber).toBe(first.order.orderNumber);
  });

  it('lists only the caller orders, newest first, with a total', async () => {
    const mine = await orders.list(NO_TOKEN, owner, { limit: 50, offset: 0 });
    expect(mine.total).toBeGreaterThan(0);
    expect(mine.orders.length).toBe(mine.total);

    // Every row carries what was bought: the list can show pictures and names without
    // opening the order, and without one query per row.
    for (const order of mine.orders) {
      expect(order.preview.length).toBeLessThanOrEqual(3);
      expect(order.preview.length).toBeGreaterThan(0);
      for (const line of order.preview) {
        expect(line.productName).not.toBe('');
        expect(line.quantity).toBeGreaterThan(0);
        // No media configured in the test environment: the key resolves to no URL.
        expect(line.image).toBeNull();
      }
    }
    // The newest order's first line is the product it was placed for.
    expect(mine.orders[0]?.preview[0]?.productName).toMatch(/lamp$/);
    expect(mine.orders[0]?.preview[0]?.quantity).toBeGreaterThan(0);

    const theirs = await orders.list(NO_TOKEN, other, { limit: 50, offset: 0 });
    expect(theirs.orders.map((order) => order.orderNumber)).not.toContain(
      mine.orders[0]?.orderNumber,
    );

    const past = await orders.list(NO_TOKEN, owner, { limit: 5, offset: 10_000 });
    expect(past).toMatchObject({ orders: [], total: mine.total });
  });

  it("does not expose another account's order", async () => {
    const placed = await orders.place(NO_TOKEN, owner, placeInput(ownerAddress, 1));
    await expect(orders.get(NO_TOKEN, other, placed.order.orderNumber)).resolves.toBeNull();
    await expect(
      orders.cancel(NO_TOKEN, other, placed.order.orderNumber, 'not mine'),
    ).rejects.toBeTruthy();
  });

  it('cancels a pending order through the database function', async () => {
    const placed = await orders.place(NO_TOKEN, owner, placeInput(ownerAddress, 1));
    const cancelled = await orders.cancel(
      NO_TOKEN,
      owner,
      placed.order.orderNumber,
      'changed my mind',
    );

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelReason).toBe('changed my mind');
    expect(cancelled.canCancel).toBe(false);
  });

  it('refuses a cash order while cash on delivery is switched off', async () => {
    const before = await orders.list(NO_TOKEN, owner, { limit: 1, offset: 0 });

    await pool.query('update public.store_settings set cod_enabled = false');
    try {
      await expect(
        orders.place(NO_TOKEN, owner, placeInput(ownerAddress, 1)),
      ).rejects.toMatchObject({ refusal: 'payment_unavailable' });
    } finally {
      await pool.query('update public.store_settings set cod_enabled = true');
    }

    // The refusal happened inside the transaction: nothing was written, not even a draft.
    const after = await orders.list(NO_TOKEN, owner, { limit: 1, offset: 0 });
    expect(after.total).toBe(before.total);
  });

  it('fails closed for an identity that is not an account id', async () => {
    await expect(
      orders.list(NO_TOKEN, 'not-a-uuid', { limit: 10, offset: 0 }),
    ).rejects.toBeInstanceOf(StoreUnavailableError);
  });

  it('reports a database failure instead of an order list', async () => {
    const closed = createDatabasePool({ connectionString: dbUrl, max: 1 });
    await closed.end();
    const broken = createPostgresOrderStore(closed);
    await expect(broken.list(NO_TOKEN, owner, { limit: 10, offset: 0 })).rejects.toBeInstanceOf(
      StoreUnavailableError,
    );
  });
});
