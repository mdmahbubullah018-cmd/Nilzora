import { randomUUID } from 'node:crypto';
import type { CartItem } from '@nilzora/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabasePool } from '../../db/pool';
import { createPostgresCartStore } from '../../modules/cart/store';
import { CommerceRefusalError, StoreUnavailableError } from '../../modules/commerce/errors';
import { createSupabaseClients } from '../../supabase/clients';
import { testConfig } from '../helpers';

/*
 * Real integration test for the direct-PostgreSQL cart pricing: no PostgREST for the
 * user-scoped quote, only a connection that assumes the account's identity the way
 * PostgREST did. Catalog, delivery-charge and account fixtures are created here and
 * removed afterwards; nothing outside this run is touched.
 */

const local = inject('supabase');
const config = testConfig({
  SUPABASE_URL: local.url,
  SUPABASE_PUBLISHABLE_KEY: local.publishableKey,
  SUPABASE_SECRET_KEY: local.secretKey,
});
const clients = createSupabaseClients(config.supabase);
const pool = createDatabasePool({ connectionString: local.dbUrl, max: 4 });
const cart = createPostgresCartStore(pool, clients);

/** The shared store interface still passes an access token; the direct connection does not use it. */
const NO_TOKEN = 'direct-connection';

const run = randomUUID().slice(0, 8);
const tag = `nzcart${run}`;
const skuTag = `CART-${run.toUpperCase()}`;

interface Product {
  id: string;
}

const created = {
  categories: [] as string[],
  products: [] as string[],
  users: [] as string[],
  chargeZones: [] as string[],
};
const products = {} as Record<'lamp' | 'pen' | 'scarce' | 'draft' | 'hidden', Product>;
let owner: string;
let other: string;
let ownerAddress: string;

async function addUser(label: string): Promise<string> {
  const id = randomUUID();
  await pool.query('select public.provision_account($1::uuid, $2, $3, null, null, true)', [
    id,
    `it-cart-${run}-${label}@example.com`,
    `Cart ${label}`,
  ]);
  created.users.push(id);
  return id;
}

/** Fixtures are written as the database owner: they stand in for the admin catalog writes. */
async function addAddress(userId: string, district = 'Dhaka', division = 'Dhaka'): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into public.addresses
       (user_id, label, recipient_name, phone, division, district, area, address_line, postal_code)
     values ($1, 'Home', 'Rahima Khatun', '+8801712345678', $2, $3, 'Dhanmondi', 'House 12, Road 5', '1212')
     returning id`,
    [userId, division, district],
  );
  const row = result.rows[0];
  if (!row) throw new Error('address fixture was not created');
  return row.id;
}

async function addProduct(
  label: keyof typeof products,
  values: { categoryId: string; priceMinor: number; stock: number; max: number; status?: string },
): Promise<void> {
  const result = await pool.query<{ id: string }>(
    `insert into public.products
       (category_id, slug, sku, name, summary, price_minor, stock_quantity, max_order_quantity, status,
        published_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::public.product_status,
             case when $10 then now() else null end)
     returning id`,
    [
      values.categoryId,
      `${tag}-${label}`,
      `${skuTag}-${label.toUpperCase()}`,
      `${tag} ${label}`,
      `Cart integration fixture ${run}`,
      values.priceMinor,
      values.stock,
      values.max,
      values.status ?? 'active',
      (values.status ?? 'active') === 'active',
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('product fixture was not created');
  products[label] = row;
  created.products.push(row.id);
}

function items(...lines: Array<[keyof typeof products, number]>): CartItem[] {
  return lines.map(([label, quantity]) => ({ productId: products[label].id, quantity }));
}

beforeAll(async () => {
  const categories = await pool.query<{ id: string; is_active: boolean }>(
    `insert into public.categories (slug, name, sort_order, is_active)
     values ($1, $2, 990, true), ($3, $4, 991, false)
     returning id, is_active`,
    [`${tag}-open`, `Open ${run}`, `${tag}-hidden`, `Hidden ${run}`],
  );
  const open = categories.rows.find((row) => row.is_active);
  const hidden = categories.rows.find((row) => !row.is_active);
  if (!open || !hidden) throw new Error('category fixtures were not created');
  created.categories.push(open.id, hidden.id);

  await addProduct('lamp', { categoryId: open.id, priceMinor: 10_000, stock: 20, max: 5 });
  await addProduct('pen', { categoryId: open.id, priceMinor: 1_000, stock: 100, max: 10 });
  // Stock below the per-order limit, so quantity can exceed stock before it exceeds the limit.
  await addProduct('scarce', { categoryId: open.id, priceMinor: 5_000, stock: 3, max: 10 });
  await addProduct('draft', {
    categoryId: open.id,
    priceMinor: 99_000,
    stock: 10,
    max: 2,
    status: 'draft',
  });
  // Active product in an inactive category: not on sale either.
  await addProduct('hidden', { categoryId: hidden.id, priceMinor: 2_000, stock: 10, max: 2 });

  // Delivery charges are reference data: add only the zones that are missing.
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
  // Fixtures only, in dependency order. No orders are created, so no ledger rows exist.
  if (created.products.length > 0) {
    await pool.query('delete from public.products where id = any($1::uuid[])', [created.products]);
  }
  if (created.categories.length > 0) {
    await pool.query('delete from public.categories where id = any($1::uuid[])', [
      created.categories,
    ]);
  }
  if (created.users.length > 0) {
    // Profiles and their addresses cascade with the auth user.
    await pool.query('delete from public.profiles where id = any($1::uuid[])', [created.users]);
  }
  if (created.chargeZones.length > 0) {
    await pool.query('delete from public.delivery_charges where zone::text = any($1::text[])', [
      created.chargeZones,
    ]);
  }
  await pool.end();
});

describe('cart pricing over the direct connection', () => {
  it('prices the cart from the live catalog and adds the delivery charge for the caller address', async () => {
    const quote = await cart.quoteForCustomer(
      NO_TOKEN,
      owner,
      items(['lamp', 2], ['pen', 3]),
      ownerAddress,
    );

    expect(quote).toMatchObject({
      itemCount: 5,
      subtotalMinor: 23_000,
      deliveryZone: 'inside_dhaka',
      shippingFeeMinor: 7_000,
      totalMinor: 30_000,
      purchasable: true,
    });
    expect(quote.lines.map((line) => [line.productId, line.quantity, line.lineTotalMinor])).toEqual(
      [
        [products.lamp.id, 2, 20_000],
        [products.pen.id, 3, 3_000],
      ],
    );
    expect(quote.lines[0]?.availableQuantity).toBe(5);
    expect(quote.lines.every((line) => line.problem === null)).toBe(true);
  });

  it('reflects changed quantities and removed lines', async () => {
    const oneLamp = await cart.quoteForCustomer(NO_TOKEN, owner, items(['lamp', 1]), ownerAddress);
    expect(oneLamp).toMatchObject({ itemCount: 1, subtotalMinor: 10_000, totalMinor: 17_000 });

    const onePen = await cart.quoteForCustomer(NO_TOKEN, owner, items(['pen', 1]), ownerAddress);
    expect(onePen).toMatchObject({ itemCount: 1, subtotalMinor: 1_000, totalMinor: 8_000 });

    const atLimit = await cart.quoteForCustomer(NO_TOKEN, owner, items(['lamp', 5]), ownerAddress);
    expect(atLimit).toMatchObject({ subtotalMinor: 50_000, purchasable: true });
  });

  it('reports products that are not on sale without pricing them', async () => {
    const quote = await cart.quoteForCustomer(
      NO_TOKEN,
      owner,
      items(['draft', 1], ['hidden', 1], ['lamp', 1]),
      ownerAddress,
    );

    expect(quote.itemCount).toBe(1);
    expect(quote.subtotalMinor).toBe(10_000);
    expect(quote.purchasable).toBe(false);
    const unavailable = quote.lines.filter((line) => line.problem === 'unavailable');
    expect(unavailable).toHaveLength(2);
    for (const line of unavailable) {
      expect(line).toMatchObject({
        slug: null,
        name: null,
        sku: null,
        unitPriceMinor: null,
        lineTotalMinor: null,
        availableQuantity: null,
      });
    }
  });

  it('reports quantity limits and insufficient stock', async () => {
    const overLimit = await cart.quoteForCustomer(
      NO_TOKEN,
      owner,
      items(['lamp', 6]),
      ownerAddress,
    );
    expect(overLimit.lines[0]?.problem).toBe('quantity_limit');
    expect(overLimit).toMatchObject({ itemCount: 0, subtotalMinor: 0, purchasable: false });

    const overStock = await cart.quoteForCustomer(
      NO_TOKEN,
      owner,
      items(['scarce', 5]),
      ownerAddress,
    );
    expect(overStock.lines[0]?.problem).toBe('insufficient_stock');
    expect(overStock.lines[0]?.availableQuantity).toBe(3);
  });

  it("refuses another account's address as not found", async () => {
    const stolen = cart.quoteForCustomer(NO_TOKEN, other, items(['lamp', 1]), ownerAddress);
    await expect(stolen).rejects.toBeInstanceOf(CommerceRefusalError);
    await expect(stolen).rejects.toMatchObject({ refusal: 'address_not_found' });

    const unknown = cart.quoteForCustomer(NO_TOKEN, owner, items(['lamp', 1]), randomUUID());
    await expect(unknown).rejects.toMatchObject({ refusal: 'address_not_found' });
  });

  it('refuses a malformed cart with the database refusal code', async () => {
    const duplicate: CartItem[] = [
      { productId: products.lamp.id, quantity: 1 },
      { productId: products.lamp.id, quantity: 2 },
    ];
    await expect(
      cart.quoteForCustomer(NO_TOKEN, owner, duplicate, ownerAddress),
    ).rejects.toMatchObject({ name: 'CommerceRefusalError', refusal: 'cart_invalid' });
  });

  it('fails closed for an identity that is not an account id', async () => {
    await expect(
      cart.quoteForCustomer(NO_TOKEN, 'not-a-uuid', items(['lamp', 1]), ownerAddress),
    ).rejects.toBeInstanceOf(StoreUnavailableError);
  });

  it('reports a database failure instead of a price', async () => {
    const closed = createDatabasePool({ connectionString: local.dbUrl, max: 1 });
    await closed.end();
    const broken = createPostgresCartStore(closed, clients);
    await expect(
      broken.quoteForCustomer(NO_TOKEN, owner, items(['lamp', 1]), ownerAddress),
    ).rejects.toBeInstanceOf(StoreUnavailableError);
  });

  it('keeps the anonymous quote working without a delivery charge', async () => {
    const quote = await cart.quote(items(['lamp', 2]));
    expect(quote).toMatchObject({
      itemCount: 2,
      subtotalMinor: 20_000,
      deliveryZone: null,
      shippingFeeMinor: null,
      totalMinor: null,
      purchasable: true,
    });
  });
});

/*
 * The pictures are joined on by the API (private.price_cart knows nothing about them), so
 * both quotes must carry them: the cart's own and the checkout's, which runs inside the
 * account's transaction.
 */
describe('cart pictures over the direct connection', () => {
  const mediaBaseUrl = 'https://media.example.com';
  const withPictures = createPostgresCartStore(pool, clients, { mediaBaseUrl });
  let storageKey: string;

  beforeAll(async () => {
    const imageId = randomUUID();
    storageKey = `products/${products.lamp.id}/${imageId}`;
    await pool.query(
      `insert into public.product_images
         (id, product_id, storage_key, width, height, bytes, alt_text, position)
       values ($1, $2, $3, 1200, 1200, 90000, 'A brass lamp', 0)`,
      [imageId, products.lamp.id, storageKey],
    );
  });

  it('gives the cart’s anonymous quote the product’s primary picture', async () => {
    const quote = await withPictures.quote(items(['lamp', 1]));

    expect(quote.lines[0]?.image).toEqual({
      url: `${mediaBaseUrl}/${storageKey}/full.webp`,
      thumbUrl: `${mediaBaseUrl}/${storageKey}/thumb.webp`,
      alt: 'A brass lamp',
    });
  });

  it('gives the signed-in checkout quote the same picture', async () => {
    const quote = await withPictures.quoteForCustomer(
      NO_TOKEN,
      owner,
      items(['lamp', 1], ['pen', 1]),
      ownerAddress,
    );

    expect(quote.lines[0]?.image?.thumbUrl).toBe(`${mediaBaseUrl}/${storageKey}/thumb.webp`);
    // A product without a picture keeps a null one, so the app draws its own tile.
    expect(quote.lines[1]?.image).toBeNull();
    // The picture never changes the money.
    expect(quote).toMatchObject({ subtotalMinor: 11_000, totalMinor: 18_000 });
  });

  it('adds no pictures at all when media is not configured', async () => {
    const plain = await cart.quote(items(['lamp', 1]));
    expect(plain.lines[0]?.image).toBeNull();
  });
});
