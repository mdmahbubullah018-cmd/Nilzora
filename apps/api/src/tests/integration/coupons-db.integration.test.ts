import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabasePool } from '../../db/pool';
import { withUser } from '../../db/user-context';

/*
 * Coupons against the local database (migration 20261231095000): free delivery, category and
 * product targeting, claims, limits, concurrent use, and what a checkout records. Every figure is
 * the database's own; the client's expected total is only ever compared with it.
 */

const { dbUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 8 });
const run = randomUUID().slice(0, 8);
const tag = `nzcp${run}`;

const FEE = 7_000;
const PRICE = 10_000;
const created = {
  categories: [] as string[],
  products: [] as string[],
  users: [] as string[],
  coupons: [] as string[],
  chargeZones: [] as string[],
};
let catA: string;
let catB: string;
let childOfA: string;
let productA: string;
let productB: string;
let productChild: string;
let customer: string;
let address: string;

async function addUser(label: string): Promise<string> {
  const id = randomUUID();
  await pool.query('select public.provision_account($1::uuid, $2, $3, null, null, true)', [
    id,
    `it-coupon-${run}-${label}@example.com`,
    `Coupon ${label}`,
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
  return (result.rows[0] as { id: string }).id;
}

async function addCategory(slug: string, parent: string | null = null): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into public.categories (slug, name, sort_order, is_active, parent_id)
     values ($1, $2, 990, true, $3) returning id`,
    [`${tag}-${slug}`, `Cat ${slug} ${run}`, parent],
  );
  const id = (result.rows[0] as { id: string }).id;
  created.categories.push(id);
  return id;
}

async function addProduct(category: string, slug: string, stock = 50): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into public.products
       (category_id, slug, sku, name, summary, price_minor, stock_quantity, max_order_quantity,
        status, published_at)
     values ($1, $2, $3, $4, $5, ${String(PRICE)}, $6, 10, 'active', now())
     returning id`,
    [
      category,
      `${tag}-${slug}`,
      `CP-${run.toUpperCase()}-${slug.toUpperCase().replace(/[^A-Z0-9]/g, '')}`,
      `${tag} ${slug}`,
      'fixture',
      stock,
    ],
  );
  const id = (result.rows[0] as { id: string }).id;
  created.products.push(id);
  return id;
}

interface CouponSpec {
  code: string;
  kind?: 'percent' | 'fixed' | 'free_delivery';
  value?: number;
  minOrder?: number;
  perCustomer?: number;
  totalLimit?: number | null;
  scope?: 'storewide' | 'categories' | 'products';
  categories?: string[];
  products?: string[];
  voucher?: boolean;
  collectLimit?: number | null;
}

async function addCoupon(spec: CouponSpec): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into public.coupons
       (code, kind, value, min_order_minor, per_customer_limit, total_limit, is_active, scope,
        category_ids, product_ids, is_voucher, title, collect_limit)
     values ($1, $2, $3, $4, $5, $6, true, $7, $8::uuid[], $9::uuid[], $10, $11, $12)
     returning id`,
    [
      `${spec.code}${run.toUpperCase()}`,
      spec.kind ?? 'percent',
      spec.kind === 'free_delivery' ? 1 : (spec.value ?? 10),
      spec.minOrder ?? 0,
      spec.perCustomer ?? 1,
      spec.totalLimit ?? null,
      spec.scope ?? 'storewide',
      spec.categories ?? [],
      spec.products ?? [],
      spec.voucher ?? false,
      spec.voucher ? `Voucher ${spec.code}` : null,
      spec.collectLimit ?? null,
    ],
  );
  const id = (result.rows[0] as { id: string }).id;
  created.coupons.push(id);
  return id;
}

const code = (name: string) => `${name}${run.toUpperCase()}`;
const items = (...lines: [string, number][]) =>
  JSON.stringify(lines.map(([productId, quantity]) => ({ productId, quantity })));

interface Quote {
  subtotalMinor: number;
  shippingFeeMinor: number;
  discountMinor: number;
  totalMinor: number;
  couponProblem?: string;
  coupon?: { kind: string };
}

async function quote(user: string, lines: string, couponCode: string): Promise<Quote> {
  return withUser(pool, user, async (client) => {
    const result = await client.query<{ value: Quote }>(
      'select public.quote_cart_with_coupon($1::jsonb, $2::uuid, $3) as value',
      [lines, address, couponCode],
    );
    return (result.rows[0] as { value: Quote }).value;
  });
}

async function place(user: string, lines: string, couponCode: string, expected: number) {
  return withUser(pool, user, async (client) => {
    const result = await client.query<{ value: { orderId: string } }>(
      'select public.place_cod_order($1::uuid, $2::uuid, $3::jsonb, null, $4::bigint, $5) as value',
      [randomUUID(), address, lines, expected, couponCode],
    );
    return (result.rows[0] as { value: { orderId: string } }).value;
  });
}

beforeAll(async () => {
  catA = await addCategory('a');
  catB = await addCategory('b');
  childOfA = await addCategory('a-child', catA);
  productA = await addProduct(catA, 'pa');
  productB = await addProduct(catB, 'pb');
  productChild = await addProduct(childOfA, 'pc');
  const charges = await pool.query<{ zone: string }>(
    `insert into public.delivery_charges (zone, amount_minor)
     values ('inside_dhaka', ${String(FEE)}), ('outside_dhaka', 13000)
     on conflict (zone) do nothing returning zone`,
  );
  created.chargeZones = charges.rows.map((row) => row.zone);
  customer = await addUser('customer');
  address = await addAddress(customer);
});

afterAll(async () => {
  const users = created.users;
  if (users.length > 0) {
    await pool.query('delete from public.coupon_redemptions where user_id = any($1::uuid[])', [
      users,
    ]);
    await pool.query('delete from public.voucher_collections where user_id = any($1::uuid[])', [
      users,
    ]);
    await pool.query('delete from public.orders where user_id = any($1::uuid[])', [users]);
  }
  if (created.coupons.length > 0) {
    await pool.query('delete from public.coupons where id = any($1::uuid[])', [created.coupons]);
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
  if (users.length > 0) {
    await pool.query('delete from public.profiles where id = any($1::uuid[])', [users]);
  }
  if (created.chargeZones.length > 0) {
    await pool.query('delete from public.delivery_charges where zone = any($1::text[])', [
      created.chargeZones,
    ]);
  }
  await pool.end();
});

describe('free delivery', () => {
  it('waives exactly the delivery fee and nothing on the goods', async () => {
    await addCoupon({ code: 'FREEDEL', kind: 'free_delivery' });
    const q = await quote(customer, items([productA, 2]), code('FREEDEL'));

    expect(q.couponProblem).toBeUndefined();
    expect(q.subtotalMinor).toBe(2 * PRICE);
    expect(q.shippingFeeMinor).toBe(FEE);
    expect(q.discountMinor).toBe(FEE);
    expect(q.totalMinor).toBe(2 * PRICE);
    expect(q.coupon?.kind).toBe('free_delivery');
  });

  it('records the order with the fee, the waiver and a total that never goes below the goods', async () => {
    await addCoupon({ code: 'FREEPLACE', kind: 'free_delivery' });
    const lines = items([productA, 1]);
    const order = await place(customer, lines, code('FREEPLACE'), PRICE);
    const row = await pool.query<{
      subtotal_minor: string;
      shipping_fee_minor: string;
      discount_minor: string;
      total_minor: string;
    }>(
      'select subtotal_minor, shipping_fee_minor, discount_minor, total_minor from public.orders where id = $1',
      [order.orderId],
    );

    expect(row.rows[0]).toMatchObject({
      subtotal_minor: String(PRICE),
      shipping_fee_minor: String(FEE),
      discount_minor: String(FEE),
      total_minor: String(PRICE),
    });
    const redemption = await pool.query<{ discount_minor: string }>(
      'select discount_minor from public.coupon_redemptions where order_id = $1',
      [order.orderId],
    );
    expect(redemption.rows[0]?.discount_minor).toBe(String(FEE));
  });

  it('refuses a total the client worked out without the waiver', async () => {
    await addCoupon({ code: 'FREEEXP', kind: 'free_delivery' });
    await expect(
      place(customer, items([productA, 1]), code('FREEEXP'), PRICE + FEE),
    ).rejects.toMatchObject({ code: 'NZ418' });
  });

  it('keeps the minimum subtotal and the per-customer limit', async () => {
    await addCoupon({ code: 'FREEMIN', kind: 'free_delivery', minOrder: 3 * PRICE });
    const low = await quote(customer, items([productA, 1]), code('FREEMIN'));
    expect(low.discountMinor).toBe(0);
    expect(low.couponProblem).toBeTruthy();

    await addCoupon({ code: 'FREEONCE', kind: 'free_delivery', perCustomer: 1 });
    await place(customer, items([productA, 1]), code('FREEONCE'), PRICE);
    const again = await quote(customer, items([productA, 1]), code('FREEONCE'));
    expect(again.discountMinor).toBe(0);
    expect(again.couponProblem).toBeTruthy();
  });

  it('applies to a category only when the cart holds something from it', async () => {
    await addCoupon({
      code: 'FREECAT',
      kind: 'free_delivery',
      scope: 'categories',
      categories: [catA],
    });
    const elsewhere = await quote(customer, items([productB, 1]), code('FREECAT'));
    expect(elsewhere.discountMinor).toBe(0);
    expect(elsewhere.couponProblem).toBeTruthy();

    // A subcategory counts as part of its parent category.
    const inside = await quote(customer, items([productChild, 1], [productB, 1]), code('FREECAT'));
    expect(inside.discountMinor).toBe(FEE);
  });
});

describe('category and product targeting', () => {
  it('takes a percentage off only the lines the category covers', async () => {
    await addCoupon({
      code: 'PCTCAT',
      kind: 'percent',
      value: 10,
      scope: 'categories',
      categories: [catA],
    });
    const q = await quote(customer, items([productA, 1], [productB, 1]), code('PCTCAT'));
    expect(q.discountMinor).toBe(PRICE / 10);
    expect(q.totalMinor).toBe(2 * PRICE + FEE - PRICE / 10);
  });

  it('takes a fixed amount off only when a chosen product is in the cart, never below zero', async () => {
    await addCoupon({
      code: 'FIXPROD',
      kind: 'fixed',
      value: 50_000,
      scope: 'products',
      products: [productB],
    });
    const q = await quote(customer, items([productB, 1]), code('FIXPROD'));
    expect(q.discountMinor).toBe(PRICE);
    expect(q.totalMinor).toBeGreaterThanOrEqual(FEE);

    const none = await quote(customer, items([productA, 1]), code('FIXPROD'));
    expect(none.discountMinor).toBe(0);
  });
});

describe('claiming vouchers', () => {
  it('shows a product the vouchers that apply to it, and not the others', async () => {
    await addCoupon({ code: 'VSTORE', voucher: true, kind: 'free_delivery' });
    await addCoupon({ code: 'VCATA', voucher: true, scope: 'categories', categories: [catA] });
    await addCoupon({ code: 'VCATB', voucher: true, scope: 'categories', categories: [catB] });
    await addCoupon({ code: 'VPROD', voucher: true, scope: 'products', products: [productA] });

    const result = await withUser(pool, customer, async (client) =>
      client.query<{ value: { title: string; state: string }[] }>(
        'select public.product_vouchers($1) as value',
        [`${tag}-pa`],
      ),
    );
    const titles = (result.rows[0]?.value ?? []).map((voucher) => voucher.title);
    expect(titles).toEqual(
      expect.arrayContaining(['Voucher VSTORE', 'Voucher VCATA', 'Voucher VPROD']),
    );
    expect(titles).not.toContain('Voucher VCATB');

    // A subcategory's product also sees its parent category's voucher.
    const child = await withUser(pool, customer, async (client) =>
      client.query<{ value: { title: string }[] }>('select public.product_vouchers($1) as value', [
        `${tag}-pc`,
      ]),
    );
    expect((child.rows[0]?.value ?? []).map((voucher) => voucher.title)).toContain('Voucher VCATA');
  });

  it('must be collected before use, and collecting twice is one claim', async () => {
    const id = await addCoupon({ code: 'CLAIMME', voucher: true, kind: 'free_delivery' });
    const blocked = await quote(customer, items([productA, 1]), code('CLAIMME'));
    expect(blocked.discountMinor).toBe(0);
    expect(blocked.couponProblem).toMatch(/collect/i);

    await withUser(pool, customer, (client) =>
      client.query('select public.collect_voucher($1)', [id]),
    );
    await withUser(pool, customer, (client) =>
      client.query('select public.collect_voucher($1)', [id]),
    );
    const rows = await pool.query(
      'select 1 from public.voucher_collections where coupon_id = $1 and user_id = $2',
      [id, customer],
    );
    expect(rows.rowCount).toBe(1);

    const ok = await quote(customer, items([productA, 1]), code('CLAIMME'));
    expect(ok.discountMinor).toBe(FEE);
  });

  it('stops collection once the cap is reached', async () => {
    const id = await addCoupon({
      code: 'CAPPED',
      voucher: true,
      kind: 'free_delivery',
      collectLimit: 1,
    });
    const second = await addUser('second');
    await withUser(pool, customer, (client) =>
      client.query('select public.collect_voucher($1)', [id]),
    );
    await expect(
      withUser(pool, second, (client) => client.query('select public.collect_voucher($1)', [id])),
    ).rejects.toBeTruthy();
  });
});

describe('cancelled orders (migration 20261231101000)', () => {
  it('give a single-use coupon back when the order is cancelled, and keep the redemption as history', async () => {
    await addCoupon({ code: 'BACK', kind: 'free_delivery', perCustomer: 1, totalLimit: 1 });
    const buyer = await addUser('canceller');
    const buyerAddress = await addAddress(buyer);
    const lines = items([productA, 1]);
    const placeAs = (expected: number) =>
      withUser(pool, buyer, async (client) => {
        const result = await client.query<{ value: { orderId: string } }>(
          'select public.place_cod_order($1::uuid, $2::uuid, $3::jsonb, null, $4::bigint, $5) as value',
          [randomUUID(), buyerAddress, lines, expected, code('BACK')],
        );
        return (result.rows[0] as { value: { orderId: string } }).value.orderId;
      });

    const first = await placeAs(PRICE);
    // Used up (its one total use is checked first): refused while the first order stands.
    await expect(placeAs(PRICE)).rejects.toMatchObject({ code: 'NZ456' });

    const number = (
      await pool.query<{ order_number: string }>(
        'select order_number from public.orders where id = $1',
        [first],
      )
    ).rows[0]?.order_number as string;
    await withUser(pool, buyer, async (client) => {
      await client.query('select public.cancel_my_order($1, $2)', [number, 'Ordered by mistake']);
    });

    // The customer never received that discount, so the coupon is theirs to use again.
    const second = await placeAs(PRICE);
    expect(second).not.toBe(first);
    const history = await pool.query('select 1 from public.coupon_redemptions where user_id = $1', [
      buyer,
    ]);
    expect(history.rowCount).toBe(2);
    // And the total limit still holds against orders that were not cancelled.
    const other = await addUser('after-cancel');
    const otherAddress = await addAddress(other);
    await expect(
      withUser(pool, other, async (client) => {
        await client.query(
          'select public.place_cod_order($1::uuid, $2::uuid, $3::jsonb, null, $4::bigint, $5)',
          [randomUUID(), otherAddress, lines, PRICE, code('BACK')],
        );
      }),
    ).rejects.toMatchObject({ code: 'NZ456' });
  });
});

describe('limits under concurrency', () => {
  it('lets a coupon with one use left be redeemed by exactly one of two simultaneous orders', async () => {
    await addCoupon({ code: 'RACE', kind: 'free_delivery', totalLimit: 1, perCustomer: 5 });
    const rival = await addUser('rival');
    const rivalAddress = await addAddress(rival);
    const lines = items([productA, 1]);
    const attempt = (user: string, addressId: string) =>
      withUser(pool, user, async (client) => {
        await client.query(
          'select public.place_cod_order($1::uuid, $2::uuid, $3::jsonb, null, $4::bigint, $5)',
          [randomUUID(), addressId, lines, PRICE, code('RACE')],
        );
      });

    const outcomes = await Promise.allSettled([
      attempt(customer, address),
      attempt(rival, rivalAddress),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const redemptions = await pool.query(
      'select 1 from public.coupon_redemptions r join public.coupons c on c.id = r.coupon_id where c.code = $1',
      [code('RACE')],
    );
    expect(redemptions.rowCount).toBe(1);
  });
});
