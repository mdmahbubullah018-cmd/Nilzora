import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ApiError, createApiClient } from '@nilzora/api-client';
import {
  addressListResponseSchema,
  addressResponseSchema,
  apiErrorBodySchema,
  authSessionSchema,
  cartQuoteResponseSchema,
  categoryListResponseSchema,
  MAX_ADDRESSES,
  orderListResponseSchema,
  orderResponseSchema,
  placeOrderResponseSchema,
  productListResponseSchema,
  productResponseSchema,
  type DeliveryZone,
} from '@nilzora/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApp } from '../../app';
import { createLogger } from '../../logging/logger';
import { createSupabaseAddressStore } from '../../modules/addresses/store';
import { createSupabaseAuthGateway } from '../../modules/auth/gateway';
import { createSupabaseCartStore } from '../../modules/cart/store';
import { createSupabaseCatalogStore } from '../../modules/catalog/store';
import { createSupabaseOrderStore } from '../../modules/orders/store';
import { createSupabaseAccountStore } from '../../modules/users/accounts';
import { createSupabaseClients } from '../../supabase/clients';
import { testConfig } from '../helpers';

/*
 * The commerce API against the local Supabase stack: real RLS, real SQL functions,
 * real row locks. Each run creates its own uniquely named category, products and
 * customers (@example.com) and removes everything it created afterwards. Delivery
 * charges are only added when missing, never changed.
 */

const local = inject('supabase');
const config = testConfig({
  SUPABASE_URL: local.url,
  SUPABASE_PUBLISHABLE_KEY: local.publishableKey,
  SUPABASE_SECRET_KEY: local.secretKey,
  RATE_LIMIT_MAX: '10000',
  AUTH_RATE_LIMIT_MAX: '10000',
  ORDER_RATE_LIMIT_MAX: '10000',
});
const clients = createSupabaseClients(config.supabase);
const app = createApp({
  config,
  logger: createLogger(config),
  auth: {
    gateway: createSupabaseAuthGateway(clients),
    accounts: createSupabaseAccountStore(clients),
  },
  commerce: {
    catalog: createSupabaseCatalogStore(clients),
    cart: createSupabaseCartStore(clients),
    addresses: createSupabaseAddressStore(clients),
    orders: createSupabaseOrderStore(clients),
  },
});

const run = randomUUID().slice(0, 8);
/** A letters-only word unique to this run, so searches find only this run's products. */
const tag = `nzit${run.replace(/\d/g, (digit) => 'ghijklmnop'.charAt(Number(digit)))}`;
const PASSWORD = 'shopping2026';
const emailFor = (label: string) => `it-${run}-${label}@example.com`;
const slugFor = (label: string) => `it-${run}-${label}`;
const skuFor = (label: string) => `IT-${run.toUpperCase()}-${label.toUpperCase()}`;

const DHAKA = {
  recipientName: 'Rahima Khatun',
  phone: '01712-345678',
  division: 'Dhaka',
  district: 'Dhaka',
  area: 'Dhanmondi',
  addressLine: 'House 12, Road 5',
} as const;
const KHULNA = {
  recipientName: 'Karim Ahmed',
  phone: '01812345678',
  division: 'Khulna',
  district: 'Khulna',
  area: 'Sonadanga',
  addressLine: 'House 5, Road 2',
} as const;

interface Fixture {
  id: string;
  slug: string;
}

const created = {
  categories: [] as string[],
  products: {} as Record<'lamp' | 'pen' | 'scarce' | 'draft' | 'hidden', Fixture>,
  zones: [] as DeliveryZone[],
};
const charges = new Map<DeliveryZone, number>();
let server: Server;
let baseUrl: string;

function errorOf(body: unknown) {
  return apiErrorBodySchema.parse(body).error;
}

async function usersOfThisRun() {
  const { data, error } = await clients.admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.filter((user) => user.email?.startsWith(`it-${run}-`));
}

/** A confirmed customer created through the Auth admin API, signed in through the API. */
async function customer(label: string) {
  const email = emailFor(label);
  const { data, error } = await clients.admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const response = await request(server)
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return { id: data.user.id, token: authSessionSchema.parse(response.body).accessToken };
}

async function addAddress(token: string, address: object = DHAKA) {
  const response = await request(server)
    .post('/api/v1/me/addresses')
    .set('Authorization', `Bearer ${token}`)
    .send(address);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return addressResponseSchema.parse(response.body).address;
}

function placeOrder(token: string, body: object) {
  return request(server).post('/api/v1/orders').set('Authorization', `Bearer ${token}`).send(body);
}

async function stockOf(product: Fixture): Promise<number> {
  const { data, error } = await clients.admin
    .from('products')
    .select('stock_quantity')
    .eq('id', product.id)
    .single();
  if (error) throw error;
  return data.stock_quantity;
}

async function ledgerOf(product: Fixture) {
  const { data, error } = await clients.admin
    .from('inventory_movements')
    .select('change, stock_after, reason, order_id')
    .eq('product_id', product.id)
    .order('id');
  if (error) throw error;
  return data;
}

async function addProduct(
  label: keyof typeof created.products,
  values: {
    categoryId: string;
    name: string;
    priceMinor: number;
    stock: number;
    maxOrderQuantity: number;
    status?: 'draft' | 'active';
    isFeatured?: boolean;
  },
) {
  const { data, error } = await clients.admin
    .from('products')
    .insert({
      category_id: values.categoryId,
      slug: slugFor(label),
      sku: skuFor(label),
      name: values.name,
      summary: `Integration fixture ${tag}`,
      price_minor: values.priceMinor,
      stock_quantity: values.stock,
      max_order_quantity: values.maxOrderQuantity,
      status: values.status ?? 'active',
      is_featured: values.isFeatured ?? false,
    })
    .select('id, slug')
    .single();
  if (error) throw error;
  created.products[label] = data;
  // Starting stock goes in the ledger, as the development seed does.
  const ledger = await clients.admin.from('inventory_movements').insert({
    product_id: data.id,
    change: values.stock,
    stock_after: values.stock,
    reason: 'initial_stock',
    note: 'Integration test fixture',
  });
  if (ledger.error) throw ledger.error;
}

beforeAll(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Add the delivery charges only where none is set; existing values stay untouched.
  const inserted = await clients.admin
    .from('delivery_charges')
    .upsert(
      [
        { zone: 'inside_dhaka', amount_minor: 7000 },
        { zone: 'outside_dhaka', amount_minor: 13000 },
      ],
      { onConflict: 'zone', ignoreDuplicates: true },
    )
    .select('zone');
  if (inserted.error) throw inserted.error;
  created.zones = inserted.data.map((row) => row.zone);
  const current = await clients.admin.from('delivery_charges').select('zone, amount_minor');
  if (current.error) throw current.error;
  for (const row of current.data) charges.set(row.zone, row.amount_minor);

  const categories = await clients.admin
    .from('categories')
    .insert([
      { slug: slugFor('open'), name: `Open ${tag}`, sort_order: 990, is_active: true },
      { slug: slugFor('hidden'), name: `Hidden ${tag}`, sort_order: 991, is_active: false },
    ])
    .select('id, slug');
  if (categories.error) throw categories.error;
  created.categories = categories.data.map((row) => row.id);
  const [open, hidden] = categories.data;
  if (!open || !hidden) throw new Error('Category fixtures were not created');

  await addProduct('lamp', {
    categoryId: open.id,
    name: `${tag} Desk Lamp`,
    priceMinor: 10_000,
    stock: 20,
    maxOrderQuantity: 5,
    isFeatured: true,
  });
  await addProduct('pen', {
    categoryId: open.id,
    name: `${tag} Gel Pen`,
    priceMinor: 1_000,
    stock: 100,
    maxOrderQuantity: 10,
  });
  await addProduct('scarce', {
    categoryId: open.id,
    name: `${tag} Limited Teapot`,
    priceMinor: 5_000,
    stock: 3,
    maxOrderQuantity: 2,
  });
  await addProduct('draft', {
    categoryId: open.id,
    name: `${tag} Draft Watch`,
    priceMinor: 99_000,
    stock: 10,
    maxOrderQuantity: 2,
    status: 'draft',
  });
  await addProduct('hidden', {
    categoryId: hidden.id,
    name: `${tag} Hidden Lantern`,
    priceMinor: 2_000,
    stock: 10,
    maxOrderQuantity: 2,
  });
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  const userIds = (await usersOfThisRun()).map((user) => user.id);
  const productIds = Object.values(created.products).map((product) => product.id);

  // Dependency order: orders (items and history cascade), the stock ledger of this
  // run's products, products, categories, any delivery charge this run added, users.
  // Users go with their saved addresses still in place, so this cleanup also checks
  // that deleting an account cascades through them (address_delete_trigger_definer).
  if (userIds.length > 0) {
    const orders = await clients.admin.from('orders').delete().in('user_id', userIds);
    if (orders.error) throw orders.error;
  }
  if (productIds.length > 0) {
    const ledger = await clients.admin
      .from('inventory_movements')
      .delete()
      .in('product_id', productIds);
    if (ledger.error) throw ledger.error;
    const products = await clients.admin.from('products').delete().in('id', productIds);
    if (products.error) throw products.error;
  }
  if (created.categories.length > 0) {
    const categories = await clients.admin.from('categories').delete().in('id', created.categories);
    if (categories.error) throw categories.error;
  }
  if (created.zones.length > 0) {
    await clients.admin.from('delivery_charges').delete().in('zone', created.zones);
  }
  const leftovers: string[] = [];
  for (const userId of userIds) {
    const { error } = await clients.admin.auth.admin.deleteUser(userId);
    if (error) leftovers.push(userId);
  }
  if (leftovers.length > 0) throw new Error(`${leftovers.length} test users could not be deleted`);
});

describe('catalog (publishable key, RLS in force)', () => {
  it('lists active categories with their product counts, never hidden ones', async () => {
    const response = await request(server).get('/api/v1/catalog/categories');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    const { categories } = categoryListResponseSchema.parse(response.body);
    expect(categories.find((category) => category.slug === slugFor('open'))).toMatchObject({
      productCount: 3,
    });
    expect(categories.some((category) => category.slug === slugFor('hidden'))).toBe(false);
  });

  it('lists and searches products on sale only, hiding drafts and hidden categories', async () => {
    const listed = await request(server).get(
      `/api/v1/catalog/products?category=${slugFor('open')}&sort=price_asc`,
    );
    const items = productListResponseSchema.parse(listed.body).items;
    expect(items.map((item) => item.slug)).toEqual([
      slugFor('pen'),
      slugFor('scarce'),
      slugFor('lamp'),
    ]);
    expect(items.find((item) => item.slug === slugFor('scarce'))).toMatchObject({
      availability: 'low_stock',
      maxOrderQuantity: 2,
    });
    expect(listed.text).not.toMatch(/stock_quantity|"stock"/);

    const searched = await request(server).get(`/api/v1/catalog/products?q=${tag}`);
    const found = productListResponseSchema.parse(searched.body);
    expect(found.items.map((item) => item.slug).sort()).toEqual(
      [slugFor('lamp'), slugFor('pen'), slugFor('scarce')].sort(),
    );
    // Relevance first, then newest: every name matches equally well here.
    expect(found.total).toBe(3);

    const prefix = await request(server)
      .get('/api/v1/catalog/products')
      .query({ q: `${tag.slice(0, -1)} des` });
    expect(productListResponseSchema.parse(prefix.body).items.map((item) => item.slug)).toEqual([
      slugFor('lamp'),
    ]);
  });

  it('survives tsquery injection attempts', async () => {
    for (const q of [`${tag}' | 'pen`, `${tag}:* | !x`, `(${tag}) <-> &`, "&|!():*'\\<>"]) {
      const response = await request(server).get('/api/v1/catalog/products').query({ q });
      expect(response.status, q).toBe(200);
      for (const item of productListResponseSchema.parse(response.body).items) {
        expect(item.slug.startsWith(`it-${run}-`), q).toBe(true);
      }
    }
  });

  it('pages through search results, including past the last page', async () => {
    const second = await request(server).get(`/api/v1/catalog/products?q=${tag}&pageSize=2&page=2`);
    expect(productListResponseSchema.parse(second.body)).toMatchObject({
      page: 2,
      total: 3,
      totalPages: 2,
    });
    expect(productListResponseSchema.parse(second.body).items).toHaveLength(1);

    const past = await request(server).get(`/api/v1/catalog/products?q=${tag}&pageSize=2&page=7`);
    expect(productListResponseSchema.parse(past.body)).toMatchObject({ items: [], total: 3 });
  });

  it('shows a product on sale and answers 404 for drafts and hidden categories', async () => {
    const lamp = await request(server).get(`/api/v1/catalog/products/${slugFor('lamp')}`);
    expect(lamp.status).toBe(200);
    expect(productResponseSchema.parse(lamp.body).product).toMatchObject({
      id: created.products.lamp.id,
      priceMinor: 10_000,
      availability: 'in_stock',
      maxOrderQuantity: 5,
      isFeatured: true,
      category: { slug: slugFor('open') },
    });

    for (const label of ['draft', 'hidden'] as const) {
      const response = await request(server).get(`/api/v1/catalog/products/${slugFor(label)}`);
      expect(response.status, label).toBe(404);
    }
  });
});

describe('cart and checkout quotes (quote_cart)', () => {
  it('prices a cart for anyone and reveals nothing about products not on sale', async () => {
    const response = await request(server)
      .post('/api/v1/cart/quote')
      .send({
        items: [
          { productId: created.products.lamp.id, quantity: 2 },
          { productId: created.products.draft.id, quantity: 1 },
        ],
      });

    expect(response.status).toBe(200);
    const { quote } = cartQuoteResponseSchema.parse(response.body);
    expect(quote).toMatchObject({ itemCount: 2, subtotalMinor: 20_000, purchasable: false });
    expect(quote.lines[1]).toMatchObject({ problem: 'unavailable', name: null, slug: null });
    expect(response.text).not.toContain('Draft Watch');
  });

  it("adds the delivery charge for the caller's own address only", async () => {
    const buyer = await customer('quote-buyer');
    const stranger = await customer('quote-stranger');
    const khulna = await addAddress(buyer.token, KHULNA);
    const items = [{ productId: created.products.pen.id, quantity: 3 }];

    const own = await request(server)
      .post('/api/v1/checkout/quote')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ items, addressId: khulna.id });
    expect(own.status).toBe(200);
    const fee = charges.get('outside_dhaka') ?? -1;
    expect(cartQuoteResponseSchema.parse(own.body).quote).toMatchObject({
      subtotalMinor: 3_000,
      deliveryZone: 'outside_dhaka',
      shippingFeeMinor: fee,
      totalMinor: 3_000 + fee,
      purchasable: true,
    });

    const foreign = await request(server)
      .post('/api/v1/checkout/quote')
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ items, addressId: khulna.id });
    expect(foreign.status).toBe(400);
    expect(errorOf(foreign.body).code).toBe('address_not_found');
  });
});

describe('addresses (RLS-owned rows)', () => {
  it('creates, lists, replaces and deletes; another customer gets 404', async () => {
    const owner = await customer('address-owner');
    const stranger = await customer('address-stranger');
    const auth = `Bearer ${owner.token}`;

    const first = await addAddress(owner.token);
    expect(first).toMatchObject({
      phone: '+8801712345678',
      isDefault: true,
      deliveryZone: 'inside_dhaka',
    });
    const second = await addAddress(owner.token, {
      ...KHULNA,
      isDefault: true,
      landmark: 'Gate 2',
    });
    expect(second).toMatchObject({ isDefault: true, deliveryZone: 'outside_dhaka' });

    const listed = addressListResponseSchema.parse(
      (await request(server).get('/api/v1/me/addresses').set('Authorization', auth)).body,
    ).addresses;
    expect(listed.map((address) => [address.id, address.isDefault])).toEqual([
      [second.id, true],
      [first.id, false],
    ]);

    const replaced = await request(server)
      .put(`/api/v1/me/addresses/${second.id}`)
      .set('Authorization', auth)
      .send({ ...DHAKA, area: 'Gulshan' });
    expect(replaced.status).toBe(200);
    expect(addressResponseSchema.parse(replaced.body).address).toMatchObject({
      area: 'Gulshan',
      landmark: null,
      deliveryZone: 'inside_dhaka',
      isDefault: true,
    });

    // The stranger can neither see, change nor delete the owner's addresses.
    const strangerAuth = `Bearer ${stranger.token}`;
    const theirList = await request(server)
      .get('/api/v1/me/addresses')
      .set('Authorization', strangerAuth);
    expect(addressListResponseSchema.parse(theirList.body).addresses).toEqual([]);
    const hijack = await request(server)
      .put(`/api/v1/me/addresses/${first.id}`)
      .set('Authorization', strangerAuth)
      .send({ ...DHAKA, area: 'Hijacked' });
    expect(hijack.status).toBe(404);
    const steal = await request(server)
      .delete(`/api/v1/me/addresses/${first.id}`)
      .set('Authorization', strangerAuth);
    expect(steal.status).toBe(404);
    const stored = await clients.admin.from('addresses').select('area').eq('id', first.id).single();
    expect(stored.data?.area).toBe('Dhanmondi');

    const removed = await request(server)
      .delete(`/api/v1/me/addresses/${second.id}`)
      .set('Authorization', auth);
    expect(removed.status).toBe(204);
    const remaining = addressListResponseSchema.parse(
      (await request(server).get('/api/v1/me/addresses').set('Authorization', auth)).body,
    ).addresses;
    expect(remaining.map((address) => [address.id, address.isDefault])).toEqual([[first.id, true]]);
  });

  it('moves the default with PUT isDefault: true, leaving exactly one default', async () => {
    const owner = await customer('address-default');
    const auth = `Bearer ${owner.token}`;
    const first = await addAddress(owner.token);
    const second = await addAddress(owner.token, KHULNA);
    expect([first.isDefault, second.isDefault]).toEqual([true, false]);

    const moved = await request(server)
      .put(`/api/v1/me/addresses/${second.id}`)
      .set('Authorization', auth)
      .send({ ...KHULNA, isDefault: true });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(addressResponseSchema.parse(moved.body).address).toMatchObject({
      id: second.id,
      isDefault: true,
    });

    const listed = addressListResponseSchema.parse(
      (await request(server).get('/api/v1/me/addresses').set('Authorization', auth)).body,
    ).addresses;
    expect(listed.map((address) => [address.id, address.isDefault])).toEqual([
      [second.id, true],
      [first.id, false],
    ]);
    const defaults = await clients.admin
      .from('addresses')
      .select('id')
      .eq('user_id', owner.id)
      .eq('is_default', true);
    if (defaults.error) throw defaults.error;
    expect(defaults.data).toEqual([{ id: second.id }]);
  });

  it(`refuses an address beyond the ${MAX_ADDRESSES}th (NZ421 address_limit_reached)`, async () => {
    const owner = await customer('address-limit');
    for (let index = 0; index < MAX_ADDRESSES; index += 1) {
      await addAddress(owner.token, { ...DHAKA, addressLine: `House ${index + 1}, Road 5` });
    }

    const extra = await request(server)
      .post('/api/v1/me/addresses')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ ...DHAKA, addressLine: 'House 99, Road 5' });
    expect(extra.status, JSON.stringify(extra.body)).toBe(409);
    expect(errorOf(extra.body).code).toBe('address_limit_reached');
    const stored = await clients.admin
      .from('addresses')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', owner.id);
    expect(stored.count).toBe(MAX_ADDRESSES);
  });

  it('deletes an account with saved addresses, the default included, and its addresses', async () => {
    const leaving = await customer('account-deleted');
    const first = await addAddress(leaving.token);
    await addAddress(leaving.token, KHULNA);
    expect(first.isDefault).toBe(true);
    const before = await clients.admin
      .from('addresses')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', leaving.id);
    expect(before.count).toBe(2);

    const { error } = await clients.admin.auth.admin.deleteUser(leaving.id);
    expect(error).toBeNull();

    const after = await clients.admin
      .from('addresses')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', leaving.id);
    if (after.error) throw after.error;
    expect(after.count).toBe(0);
    const profile = await clients.admin.from('profiles').select('id').eq('id', leaving.id);
    if (profile.error) throw profile.error;
    expect(profile.data).toEqual([]);
  });
});

describe('Cash-on-Delivery orders (place_cod_order / cancel_my_order)', () => {
  it('computes the totals on the server and moves stock with a ledger entry', async () => {
    const buyer = await customer('order-buyer');
    const address = await addAddress(buyer.token);
    const fee = charges.get('inside_dhaka') ?? -1;
    const lampBefore = await stockOf(created.products.lamp);

    const response = await placeOrder(buyer.token, {
      idempotencyKey: randomUUID(),
      addressId: address.id,
      items: [
        { productId: created.products.lamp.id, quantity: 2 },
        { productId: created.products.pen.id, quantity: 1 },
      ],
      note: 'Call before delivery',
      expectedTotalMinor: 21_000 + fee,
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const { order, created: isNew } = placeOrderResponseSchema.parse(response.body);
    expect(isNew).toBe(true);
    expect(order).toMatchObject({
      status: 'pending',
      paymentStatus: 'pending',
      itemCount: 3,
      subtotalMinor: 21_000,
      shippingFeeMinor: fee,
      totalMinor: 21_000 + fee,
      customerNote: 'Call before delivery',
      canCancel: true,
      history: [{ fromStatus: null, toStatus: 'pending' }],
    });
    expect(response.text).not.toMatch(/idempotency|fingerprint|user_?id/i);

    const stored = await clients.admin
      .from('orders')
      .select('user_id, subtotal_minor, shipping_fee_minor, total_minor')
      .eq('order_number', order.orderNumber)
      .single();
    expect(stored.data).toStrictEqual({
      user_id: buyer.id,
      subtotal_minor: 21_000,
      shipping_fee_minor: fee,
      total_minor: 21_000 + fee,
    });
    expect(await stockOf(created.products.lamp)).toBe(lampBefore - 2);
    expect((await ledgerOf(created.products.lamp)).at(-1)).toMatchObject({
      change: -2,
      stock_after: lampBefore - 2,
      reason: 'order_placed',
    });
  });

  it('refuses a stale total, reporting the current one, and creates nothing', async () => {
    const buyer = await customer('stale-total');
    const address = await addAddress(buyer.token);
    const response = await placeOrder(buyer.token, {
      idempotencyKey: randomUUID(),
      addressId: address.id,
      items: [{ productId: created.products.pen.id, quantity: 1 }],
      expectedTotalMinor: 1,
    });

    expect(response.status).toBe(409);
    expect(errorOf(response.body)).toMatchObject({
      code: 'price_changed',
      details: { totalMinor: 1_000 + (charges.get('inside_dhaka') ?? -1) },
    });
    const count = await clients.admin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', buyer.id);
    expect(count.count).toBe(0);
  });

  it('refuses unavailable products, quantity limits and missing stock with the problem lines', async () => {
    const buyer = await customer('problems');
    const address = await addAddress(buyer.token);
    const fee = charges.get('inside_dhaka') ?? -1;
    const attempt = (productId: string, quantity: number) =>
      placeOrder(buyer.token, {
        idempotencyKey: randomUUID(),
        addressId: address.id,
        items: [{ productId, quantity }],
        expectedTotalMinor: fee,
      });

    const cases = [
      [created.products.draft.id, 1, 'product_unavailable', 'unavailable'],
      [created.products.hidden.id, 1, 'product_unavailable', 'unavailable'],
      [created.products.lamp.id, 6, 'quantity_limit_exceeded', 'quantity_limit'],
    ] as const;
    for (const [productId, quantity, code, problem] of cases) {
      const response = await attempt(productId, quantity);
      expect(response.status, code).toBe(409);
      expect(errorOf(response.body), code).toMatchObject({
        code,
        details: { problems: [{ productId, problem }] },
      });
    }
  });

  it('replays a repeated submission and refuses the key for a different cart', async () => {
    const buyer = await customer('replay');
    const address = await addAddress(buyer.token);
    const fee = charges.get('inside_dhaka') ?? -1;
    const body = {
      idempotencyKey: randomUUID(),
      addressId: address.id,
      items: [{ productId: created.products.pen.id, quantity: 2 }],
      expectedTotalMinor: 2_000 + fee,
    };
    const penBefore = await stockOf(created.products.pen);

    const first = await placeOrder(buyer.token, body);
    const again = await placeOrder(buyer.token, body);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    const replay = placeOrderResponseSchema.parse(again.body);
    expect(replay.created).toBe(false);
    expect(replay.order.orderNumber).toBe(
      placeOrderResponseSchema.parse(first.body).order.orderNumber,
    );

    const conflict = await placeOrder(buyer.token, {
      ...body,
      items: [{ productId: created.products.pen.id, quantity: 3 }],
      expectedTotalMinor: 3_000 + fee,
    });
    expect(conflict.status).toBe(409);
    expect(errorOf(conflict.body).code).toBe('idempotency_conflict');

    const stored = await clients.admin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', buyer.id);
    expect(stored.count).toBe(1);
    expect(await stockOf(created.products.pen)).toBe(penBefore - 2);
  });

  it('creates exactly one order for concurrent submissions with one key', async () => {
    const buyer = await customer('concurrent-replay');
    const address = await addAddress(buyer.token);
    const body = {
      idempotencyKey: randomUUID(),
      addressId: address.id,
      items: [{ productId: created.products.pen.id, quantity: 1 }],
      expectedTotalMinor: 1_000 + (charges.get('inside_dhaka') ?? -1),
    };

    const responses = await Promise.all(
      Array.from({ length: 6 }, () => placeOrder(buyer.token, body)),
    );

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 200, 200, 200, 200, 201]);
    const numbers = new Set(
      responses.map((response) => placeOrderResponseSchema.parse(response.body).order.orderNumber),
    );
    expect(numbers.size).toBe(1);
    const stored = await clients.admin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', buyer.id);
    expect(stored.count).toBe(1);
  });

  it('never oversells: 3 units, 8 simultaneous buyers, exactly 3 orders', async () => {
    const scarce = created.products.scarce;
    expect(await stockOf(scarce)).toBe(3);
    const fee = charges.get('inside_dhaka') ?? -1;
    const buyers = await Promise.all(
      Array.from({ length: 8 }, async (_, index) => {
        const buyer = await customer(`rush-${index}`);
        return { ...buyer, addressId: (await addAddress(buyer.token)).id };
      }),
    );

    const responses = await Promise.all(
      buyers.map((buyer) =>
        placeOrder(buyer.token, {
          idempotencyKey: randomUUID(),
          addressId: buyer.addressId,
          items: [{ productId: scarce.id, quantity: 1 }],
          expectedTotalMinor: 5_000 + fee,
        }),
      ),
    );

    const won = responses.filter((response) => response.status === 201);
    const lost = responses.filter((response) => response.status !== 201);
    expect(won).toHaveLength(3);
    expect(lost).toHaveLength(5);
    for (const response of lost) {
      expect(response.status).toBe(409);
      expect(errorOf(response.body)).toMatchObject({
        code: 'insufficient_stock',
        details: { problems: [{ productId: scarce.id, problem: 'insufficient_stock' }] },
      });
    }

    expect(await stockOf(scarce)).toBe(0);
    const ledger = await ledgerOf(scarce);
    expect(ledger.map((entry) => entry.reason)).toEqual([
      'initial_stock',
      'order_placed',
      'order_placed',
      'order_placed',
    ]);
    expect(ledger.reduce((sum, entry) => sum + entry.change, 0)).toBe(0);
    expect(ledger.slice(1).map((entry) => entry.stock_after)).toEqual([2, 1, 0]);
    const orderIds = new Set(ledger.slice(1).map((entry) => entry.order_id));
    expect(orderIds.size).toBe(3);
    const items = await clients.admin
      .from('order_items')
      .select('quantity')
      .eq('product_id', scarce.id);
    expect(items.data?.map((item) => item.quantity)).toEqual([1, 1, 1]);
  });

  it("keeps another customer's order unreadable and uncancellable (404); the owner cancels and stock returns", async () => {
    const owner = await customer('cancel-owner');
    const stranger = await customer('cancel-stranger');
    const address = await addAddress(owner.token);
    const fee = charges.get('inside_dhaka') ?? -1;
    const lampBefore = await stockOf(created.products.lamp);
    const placed = placeOrderResponseSchema.parse(
      (
        await placeOrder(owner.token, {
          idempotencyKey: randomUUID(),
          addressId: address.id,
          items: [{ productId: created.products.lamp.id, quantity: 3 }],
          expectedTotalMinor: 30_000 + fee,
        })
      ).body,
    ).order;
    const path = `/api/v1/orders/${placed.orderNumber}`;

    const peek = await request(server).get(path).set('Authorization', `Bearer ${stranger.token}`);
    expect(peek.status).toBe(404);
    const strangerCancel = await request(server)
      .post(`${path}/cancel`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({});
    expect(strangerCancel.status).toBe(404);
    expect(errorOf(strangerCancel.body).code).toBe('not_found');
    const missing = await request(server)
      .get('/api/v1/orders/NZ999999999')
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(missing.status).toBe(404);

    const read = await request(server).get(path).set('Authorization', `Bearer ${owner.token}`);
    expect(orderResponseSchema.parse(read.body).order).toMatchObject({
      orderNumber: placed.orderNumber,
      items: [{ productId: created.products.lamp.id, quantity: 3, lineTotalMinor: 30_000 }],
      canCancel: true,
    });
    expect(await stockOf(created.products.lamp)).toBe(lampBefore - 3);

    const cancelled = await request(server)
      .post(`${path}/cancel`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ reason: 'Ordered by mistake' });
    expect(cancelled.status).toBe(200);
    expect(orderResponseSchema.parse(cancelled.body).order).toMatchObject({
      status: 'cancelled',
      paymentStatus: 'cancelled',
      cancelReason: 'Ordered by mistake',
      canCancel: false,
      history: [
        { fromStatus: null, toStatus: 'pending' },
        { fromStatus: 'pending', toStatus: 'cancelled' },
      ],
    });
    expect(await stockOf(created.products.lamp)).toBe(lampBefore);
    expect((await ledgerOf(created.products.lamp)).at(-1)).toMatchObject({
      change: 3,
      stock_after: lampBefore,
      reason: 'order_cancelled',
    });

    const twice = await request(server)
      .post(`${path}/cancel`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});
    expect(twice.status).toBe(409);
    expect(errorOf(twice.body).code).toBe('order_not_cancellable');
  });

  it("lists only the caller's orders, newest first, with pages", async () => {
    const buyer = await customer('history');
    const address = await addAddress(buyer.token);
    const fee = charges.get('inside_dhaka') ?? -1;
    const numbers: string[] = [];
    for (let quantity = 1; quantity <= 3; quantity += 1) {
      const response = await placeOrder(buyer.token, {
        idempotencyKey: randomUUID(),
        addressId: address.id,
        items: [{ productId: created.products.pen.id, quantity }],
        expectedTotalMinor: 1_000 * quantity + fee,
      });
      numbers.push(placeOrderResponseSchema.parse(response.body).order.orderNumber);
    }
    const auth = `Bearer ${buyer.token}`;

    const page1 = orderListResponseSchema.parse(
      (await request(server).get('/api/v1/orders?pageSize=2').set('Authorization', auth)).body,
    );
    expect(page1.orders.map((order) => order.orderNumber)).toEqual([numbers[2], numbers[1]]);
    expect(page1).toMatchObject({ total: 3, totalPages: 2 });
    const page2 = orderListResponseSchema.parse(
      (await request(server).get('/api/v1/orders?pageSize=2&page=2').set('Authorization', auth))
        .body,
    );
    expect(page2.orders.map((order) => order.orderNumber)).toEqual([numbers[0]]);
    const past = orderListResponseSchema.parse(
      (await request(server).get('/api/v1/orders?pageSize=2&page=5').set('Authorization', auth))
        .body,
    );
    expect(past).toMatchObject({ orders: [], total: 3, totalPages: 2 });
  });

  it('refuses a 6th order while 5 wait for confirmation (NZ420 too_many_pending_orders)', async () => {
    const buyer = await customer('pending-limit');
    const address = await addAddress(buyer.token);
    const body = () => ({
      idempotencyKey: randomUUID(),
      addressId: address.id,
      items: [{ productId: created.products.pen.id, quantity: 1 }],
      expectedTotalMinor: 1_000 + (charges.get('inside_dhaka') ?? -1),
    });
    for (let index = 0; index < 5; index += 1) {
      const response = await placeOrder(buyer.token, body());
      expect(response.status, JSON.stringify(response.body)).toBe(201);
    }
    const penBefore = await stockOf(created.products.pen);

    const sixth = await placeOrder(buyer.token, body());
    expect(sixth.status, JSON.stringify(sixth.body)).toBe(409);
    expect(errorOf(sixth.body).code).toBe('too_many_pending_orders');
    const stored = await clients.admin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', buyer.id);
    expect(stored.count).toBe(5);
    expect(await stockOf(created.products.pen)).toBe(penBefore);
  });

  it('refuses a suspended account, at the API and in the database', async () => {
    const held = await customer('suspended');
    const address = await addAddress(held.token);
    const suspended = await clients.admin
      .from('profiles')
      .update({ status: 'suspended' })
      .eq('id', held.id);
    if (suspended.error) throw suspended.error;
    const body = {
      idempotencyKey: randomUUID(),
      addressId: address.id,
      items: [{ productId: created.products.pen.id, quantity: 1 }],
      expectedTotalMinor: 1_000 + (charges.get('inside_dhaka') ?? -1),
    };

    const refused = await placeOrder(held.token, body);
    expect(refused.status).toBe(403);
    expect(errorOf(refused.body).code).toBe('account_suspended');
    const addresses = await request(server)
      .get('/api/v1/me/addresses')
      .set('Authorization', `Bearer ${held.token}`);
    expect(addresses.status).toBe(403);

    // Even calling the database function directly with the token is refused.
    const direct = await clients.asUser(held.token).rpc('place_cod_order', {
      p_idempotency_key: body.idempotencyKey,
      p_address_id: address.id,
      p_items: body.items,
    });
    expect(direct.error?.code).toBe('NZ410');
  });
});

describe('typed API client against the running API', () => {
  it('shops, checks out and cancels through @nilzora/api-client', async () => {
    const api = createApiClient({ baseUrl });
    const buyer = await customer('typed-client');
    const fee = charges.get('outside_dhaka') ?? -1;

    expect((await api.listCategories()).categories.some((c) => c.slug === slugFor('open'))).toBe(
      true,
    );
    const page = await api.listProducts({ q: `${tag} gel`, pageSize: 5 });
    expect(page.items.map((item) => item.slug)).toEqual([slugFor('pen')]);
    const { product } = await api.getProduct(slugFor('pen'));
    const items = [{ productId: product.id, quantity: 2 }];
    expect((await api.quoteCart(items)).quote.subtotalMinor).toBe(2_000);

    const { address } = await api.createAddress(buyer.token, KHULNA);
    const updated = await api.updateAddress(buyer.token, address.id, { ...KHULNA, area: 'Boyra' });
    expect(updated.address.area).toBe('Boyra');
    const { quote } = await api.quoteCheckout(buyer.token, { items, addressId: address.id });
    expect(quote.totalMinor).toBe(2_000 + fee);

    const placed = await api.placeOrder(buyer.token, {
      idempotencyKey: randomUUID(),
      addressId: address.id,
      items,
      expectedTotalMinor: quote.totalMinor ?? 0,
    });
    expect(placed.created).toBe(true);
    expect((await api.listOrders(buyer.token)).orders[0]?.orderNumber).toBe(
      placed.order.orderNumber,
    );
    expect((await api.getOrder(buyer.token, placed.order.orderNumber)).order.totalMinor).toBe(
      2_000 + fee,
    );
    const cancelled = await api.cancelOrder(buyer.token, placed.order.orderNumber);
    expect(cancelled.order.status).toBe('cancelled');

    const missing = await api.getOrder(buyer.token, 'NZ999999999').catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(ApiError);
    expect(missing).toMatchObject({ status: 404, code: 'not_found' });

    await api.deleteAddress(buyer.token, address.id);
    expect((await api.listAddresses(buyer.token)).addresses).toEqual([]);
  });
});
