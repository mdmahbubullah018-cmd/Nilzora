import { checkoutListResponseSchema, checkoutResponseSchema, cartResponseSchema } from '@nilzora/contracts';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FakeAdmin } from './admin-fakes';
import { FakeSavedCarts, type FakeProduct } from './cart-fakes';
import { errorOf } from './commerce-helpers';
import { FakeIdentity } from './fakes';
import { testApp } from './helpers';

const LAMP = '0d000000-0000-4000-8000-000000000001';
const LAMP_RED = 'ee000000-0000-4000-8000-000000000001';
const LAMP_BLUE = 'ee000000-0000-4000-8000-000000000003';
/** A switched-off option of the lamp. */
const LAMP_GREEN = 'ee000000-0000-4000-8000-000000000004';
/** A product without options: the only kind that may be added without a variantId. */
const PEN = '0d000000-0000-4000-8000-000000000003';
/** A product that is not on sale (draft or hidden category). */
const DRAFT = '0d000000-0000-4000-8000-000000000004';
const MUG = '0d000000-0000-4000-8000-000000000002';
/** A real variant id that belongs to the mug, not the lamp. */
const MUG_VARIANT = 'ee000000-0000-4000-8000-000000000002';

const PRODUCTS: Record<string, FakeProduct> = {
  [LAMP]: {
    name: 'Desk Lamp',
    sku: 'LAMP-1',
    priceMinor: 10_000,
    variants: {
      [LAMP_RED]: 'Colour: Red',
      [LAMP_BLUE]: 'Colour: Blue',
      [LAMP_GREEN]: 'Colour: Green',
    },
    inactiveVariants: [LAMP_GREEN],
  },
  [PEN]: { name: 'Gel Pen', sku: 'PEN-1', priceMinor: 500 },
  [DRAFT]: { name: 'Draft Item', sku: 'DRAFT-1', priceMinor: 900, offSale: true },
  [MUG]: { name: 'Ceramic Mug', sku: 'MUG-1', priceMinor: 2_500, variants: { [MUG_VARIANT]: 'Size: Large' } },
};

/**
 * One app with both the customer cart routes and the staff queue mounted over the same
 * in-memory cart, so a test can prove that what a customer does is what staff see.
 */
function cartSetup() {
  const identity = new FakeIdentity();
  const admin = new FakeAdmin(identity);
  const customer = identity.addUser({ email: 'rahima@example.com' });
  const other = identity.addUser({ email: 'karim@example.com' });
  const staff = identity.addUser({ email: 'staff@example.com', role: 'staff' });
  const carts = new FakeSavedCarts(PRODUCTS, {
    [customer.id]: 'Rahima Khatun',
    [other.id]: 'Karim Ahmed',
    [staff.id]: 'Sadia Staff',
  });
  const app = testApp({
    auth: identity.deps,
    admin: { ...admin.stores, checkouts: carts },
    carts,
  });

  const tokens = {
    customer: identity.tokenFor(customer),
    other: identity.tokenFor(other),
    staff: identity.tokenFor(staff),
  };

  function call(
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    who?: keyof typeof tokens,
    body?: object,
  ) {
    let pending = request(app)[method](`/api/v1${path}`);
    if (who) pending = pending.set('Authorization', `Bearer ${tokens[who]}`);
    return body === undefined ? pending : pending.send(body);
  }

  return { identity, carts, customer, other, staff, tokens, app, call };
}

describe('guest carts', () => {
  it('creates one cart per handle and answers the same cart when asked again', async () => {
    const setup = cartSetup();
    const token = randomUUID();
    const first = await setup.call('post', '/guest/cart', undefined, { token });
    const second = await setup.call('post', '/guest/cart', undefined, { token });

    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    const cart = cartResponseSchema.parse(first.body).cart;
    expect(cart.status).toBe('active');
    expect(cart.lines).toEqual([]);
    expect(cartResponseSchema.parse(second.body).cart.id).toBe(cart.id);
    expect([...setup.carts.carts.values()]).toHaveLength(1);
  });

  it('starts a separate cart for a different handle', async () => {
    const setup = cartSetup();
    const first = await setup.call('post', '/guest/cart', undefined, { token: randomUUID() });
    const second = await setup.call('post', '/guest/cart', undefined, { token: randomUUID() });
    expect(cartResponseSchema.parse(first.body).cart.id).not.toBe(
      cartResponseSchema.parse(second.body).cart.id,
    );
  });

  it('adds, changes and removes a guest line with one shape', async () => {
    const setup = cartSetup();
    const token = randomUUID();
    await setup.call('post', '/guest/cart', undefined, { token });

    const added = await setup.call('put', '/guest/cart/items', undefined, {
      token,
      productId: LAMP,
      variantId: LAMP_RED,
      quantity: 2,
    });
    expect(added.status).toBe(200);
    expect(cartResponseSchema.parse(added.body).cart.lines).toEqual([
      { productId: LAMP, variantId: LAMP_RED, quantity: 2 },
    ]);

    const changed = await setup.call('put', '/guest/cart/items', undefined, {
      token,
      productId: LAMP,
      variantId: LAMP_RED,
      quantity: 3,
    });
    expect(cartResponseSchema.parse(changed.body).cart.lines[0]?.quantity).toBe(3);

    const removed = await setup.call('put', '/guest/cart/items', undefined, {
      token,
      productId: LAMP,
      variantId: LAMP_RED,
      quantity: 0,
    });
    expect(cartResponseSchema.parse(removed.body).cart.lines).toEqual([]);
  });

  it('keeps two variants of one product as two lines', async () => {
    const setup = cartSetup();
    const token = randomUUID();
    await setup.call('post', '/guest/cart', undefined, { token });
    await setup.call('put', '/guest/cart/items', undefined, {
      token,
      productId: LAMP,
      variantId: LAMP_BLUE,
      quantity: 1,
    });
    const response = await setup.call('put', '/guest/cart/items', undefined, {
      token,
      productId: LAMP,
      variantId: LAMP_RED,
      quantity: 2,
    });
    const lines = cartResponseSchema.parse(response.body).cart.lines;
    expect(lines).toHaveLength(2);
    expect(lines.find((line) => line.variantId === LAMP_BLUE)?.quantity).toBe(1);
    expect(lines.find((line) => line.variantId === LAMP_RED)?.quantity).toBe(2);
  });

  it('refuses an unknown handle instead of creating a cart on the way in', async () => {
    const setup = cartSetup();
    const response = await setup.call('put', '/guest/cart/items', undefined, {
      token: randomUUID(),
      productId: PEN,
      quantity: 1,
    });
    expect(response.status).toBe(404);
    expect(errorOf(response.body).code).toBe('cart_guest_token_invalid');
    expect([...setup.carts.carts.values()]).toHaveLength(0);
  });

  it('refuses a variant that belongs to another product', async () => {
    const setup = cartSetup();
    const token = randomUUID();
    await setup.call('post', '/guest/cart', undefined, { token });
    const response = await setup.call('put', '/guest/cart/items', undefined, {
      token,
      productId: LAMP,
      variantId: MUG_VARIANT,
      quantity: 1,
    });
    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('cart_line_invalid');
  });

  it('refuses a quantity above the per-line limit before the store is asked', async () => {
    const setup = cartSetup();
    const token = randomUUID();
    await setup.call('post', '/guest/cart', undefined, { token });
    const response = await setup.call('put', '/guest/cart/items', undefined, {
      token,
      productId: PEN,
      quantity: 101,
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'validation_failed' } });
  });

  it('empties a guest cart and answers 204 for a handle it never had', async () => {
    const setup = cartSetup();
    const token = randomUUID();
    await setup.call('post', '/guest/cart', undefined, { token });
    await setup.call('put', '/guest/cart/items', undefined, { token, productId: PEN, quantity: 2 });

    const cleared = await setup.call('post', '/guest/cart/clear', undefined, { token });
    expect(cleared.status).toBe(204);
    expect(await setup.carts.guestCart(token)).toMatchObject({ cart: { lines: [] } });

    const unknown = await setup.call('post', '/guest/cart/clear', undefined, {
      token: randomUUID(),
    });
    expect(unknown.status).toBe(204);
  });
});

describe('authenticated carts', () => {
  it('returns the signed-in cart and never another customer’s lines', async () => {
    const setup = cartSetup();
    await setup.call('put', '/me/cart/items', 'customer', { productId: PEN, quantity: 2 });

    const mine = await setup.call('get', '/me/cart', 'customer');
    expect(mine.status).toBe(200);
    expect(cartResponseSchema.parse(mine.body).cart.lines).toHaveLength(1);

    const theirs = await setup.call('get', '/me/cart', 'other');
    expect(cartResponseSchema.parse(theirs.body).cart.lines).toEqual([]);
    expect(cartResponseSchema.parse(theirs.body).cart.id).not.toBe(
      cartResponseSchema.parse(mine.body).cart.id,
    );
  });

  it('requires a session for every /me cart route', async () => {
    const setup = cartSetup();
    for (const [method, path] of [
      ['get', '/me/cart'],
      ['post', '/me/cart/clear'],
      ['post', '/me/cart/merge'],
    ] as const) {
      const response = await setup.call(method, path, undefined, { token: randomUUID() });
      expect(response.status).toBe(401);
    }
    const write = await setup.call('put', '/me/cart/items', undefined, {
      productId: PEN,
      quantity: 1,
    });
    expect(write.status).toBe(401);
  });

  it('empties the signed-in cart and answers the emptied cart', async () => {
    const setup = cartSetup();
    await setup.call('put', '/me/cart/items', 'customer', { productId: PEN, quantity: 2 });
    const response = await setup.call('post', '/me/cart/clear', 'customer', {});
    expect(response.status).toBe(200);
    expect(cartResponseSchema.parse(response.body).cart.lines).toEqual([]);
  });
});

describe('required variant selection', () => {
  async function guestSetup() {
    const setup = cartSetup();
    const token = randomUUID();
    await setup.call('post', '/guest/cart', undefined, { token });
    return { ...setup, token };
  }

  it('refuses a guest line without a variant for a product that has them (400 variant_required)', async () => {
    const setup = await guestSetup();
    const response = await setup.call('put', '/guest/cart/items', undefined, {
      token: setup.token,
      productId: LAMP,
      quantity: 1,
    });
    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('variant_required');
    expect(await setup.carts.guestCart(setup.token)).toMatchObject({ cart: { lines: [] } });
  });

  it('refuses a signed-in line without a variant for a product that has them (400 variant_required)', async () => {
    const setup = cartSetup();
    const response = await setup.call('put', '/me/cart/items', 'customer', {
      productId: LAMP,
      variantId: null,
      quantity: 1,
    });
    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('variant_required');
    const cart = await setup.call('get', '/me/cart', 'customer');
    expect(cartResponseSchema.parse(cart.body).cart.lines).toEqual([]);
  });

  it('refuses a switched-off variant (409 variant_invalid) on both paths', async () => {
    const setup = await guestSetup();
    const guest = await setup.call('put', '/guest/cart/items', undefined, {
      token: setup.token,
      productId: LAMP,
      variantId: LAMP_GREEN,
      quantity: 1,
    });
    expect(guest.status).toBe(409);
    expect(errorOf(guest.body).code).toBe('variant_invalid');

    const own = await setup.call('put', '/me/cart/items', 'customer', {
      productId: LAMP,
      variantId: LAMP_GREEN,
      quantity: 1,
    });
    expect(own.status).toBe(409);
    expect(errorOf(own.body).code).toBe('variant_invalid');
  });

  it('refuses a variant of another product (400 cart_line_invalid) on the signed-in path', async () => {
    const setup = cartSetup();
    const response = await setup.call('put', '/me/cart/items', 'customer', {
      productId: LAMP,
      variantId: MUG_VARIANT,
      quantity: 1,
    });
    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('cart_line_invalid');
  });

  it('refuses a product that is not on sale (400 cart_line_invalid)', async () => {
    const setup = await guestSetup();
    const response = await setup.call('put', '/guest/cart/items', undefined, {
      token: setup.token,
      productId: DRAFT,
      quantity: 1,
    });
    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('cart_line_invalid');
  });

  it('adds a simple product without a variant and a variant product with a complete one', async () => {
    const setup = cartSetup();
    const simple = await setup.call('put', '/me/cart/items', 'customer', {
      productId: PEN,
      variantId: null,
      quantity: 2,
    });
    expect(simple.status).toBe(200);
    const withVariant = await setup.call('put', '/me/cart/items', 'customer', {
      productId: LAMP,
      variantId: LAMP_RED,
      quantity: 1,
    });
    expect(withVariant.status).toBe(200);
    expect(cartResponseSchema.parse(withVariant.body).cart.lines).toEqual([
      { productId: PEN, variantId: null, quantity: 2 },
      { productId: LAMP, variantId: LAMP_RED, quantity: 1 },
    ]);
    const reread = await setup.call('get', '/me/cart', 'customer');
    expect(cartResponseSchema.parse(reread.body).cart.lines).toHaveLength(2);
  });

  it('still removes a legacy variant-less line of a product that has variants', async () => {
    const setup = cartSetup();
    const cart = await setup.carts.myCart('token', setup.customer.id);
    // A line saved before the rule existed.
    setup.carts.carts
      .get(cart.cart.id)
      ?.lines.push({ productId: LAMP, variantId: null, quantity: 2 });

    const raised = await setup.call('put', '/me/cart/items', 'customer', {
      productId: LAMP,
      variantId: null,
      quantity: 3,
    });
    expect(raised.status).toBe(400);

    const removed = await setup.call('put', '/me/cart/items', 'customer', {
      productId: LAMP,
      variantId: null,
      quantity: 0,
    });
    expect(removed.status).toBe(200);
    expect(cartResponseSchema.parse(removed.body).cart.lines).toEqual([]);
  });

  it('leaves refused lines behind when a guest cart is merged, keeping the valid ones', async () => {
    const setup = await guestSetup();
    const guest = [...setup.carts.carts.values()].find((cart) => cart.guestToken === setup.token);
    guest?.lines.push(
      { productId: PEN, variantId: null, quantity: 2 },
      { productId: LAMP, variantId: LAMP_RED, quantity: 1 },
      { productId: LAMP, variantId: null, quantity: 1 },
      { productId: LAMP, variantId: LAMP_GREEN, quantity: 1 },
      { productId: DRAFT, variantId: null, quantity: 1 },
    );
    const merged = await setup.call('post', '/me/cart/merge', 'customer', { token: setup.token });
    expect(merged.status).toBe(200);
    expect(cartResponseSchema.parse(merged.body).cart.lines).toEqual([
      { productId: PEN, variantId: null, quantity: 2 },
      { productId: LAMP, variantId: LAMP_RED, quantity: 1 },
    ]);
    expect(await setup.carts.guestCart(setup.token)).toBeNull();
  });
});

describe('guest to account merge', () => {
  it('folds guest lines into the account cart and consumes the handle', async () => {
    const setup = cartSetup();
    const token = randomUUID();
    await setup.call('post', '/guest/cart', undefined, { token });
    await setup.call('put', '/guest/cart/items', undefined, {
      token,
      productId: LAMP,
      variantId: LAMP_RED,
      quantity: 2,
    });
    await setup.call('put', '/me/cart/items', 'customer', { productId: PEN, quantity: 1 });

    const merged = await setup.call('post', '/me/cart/merge', 'customer', { token });
    expect(merged.status).toBe(200);
    const lines = cartResponseSchema.parse(merged.body).cart.lines;
    expect(lines).toHaveLength(2);
    expect(lines.find((line) => line.productId === LAMP)?.variantId).toBe(LAMP_RED);

    // The guest cart is gone, so the same handle cannot be merged twice.
    expect(await setup.carts.guestCart(token)).toBeNull();
    const again = await setup.call('post', '/me/cart/merge', 'customer', { token });
    expect(cartResponseSchema.parse(again.body).cart.lines).toHaveLength(2);
  });

  it('adds up the same line instead of duplicating it', async () => {
    const setup = cartSetup();
    const token = randomUUID();
    await setup.call('post', '/guest/cart', undefined, { token });
    await setup.call('put', '/guest/cart/items', undefined, { token, productId: PEN, quantity: 2 });
    await setup.call('put', '/me/cart/items', 'customer', { productId: PEN, quantity: 1 });

    const merged = await setup.call('post', '/me/cart/merge', 'customer', { token });
    const lines = cartResponseSchema.parse(merged.body).cart.lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe(3);
  });

  it('leaves the account cart alone for a handle it does not know', async () => {
    const setup = cartSetup();
    await setup.call('put', '/me/cart/items', 'customer', { productId: PEN, quantity: 1 });
    const response = await setup.call('post', '/me/cart/merge', 'customer', {
      token: randomUUID(),
    });
    expect(response.status).toBe(200);
    expect(cartResponseSchema.parse(response.body).cart.lines).toEqual([
      { productId: PEN, variantId: null, quantity: 1 },
    ]);
  });

  it('refuses a merge body without a handle', async () => {
    const setup = cartSetup();
    const response = await setup.call('post', '/me/cart/merge', 'customer', {});
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'validation_failed' } });
  });
});

describe('checkout lifecycle', () => {
  it('refuses to start a checkout for an empty cart', async () => {
    const setup = cartSetup();
    const response = await setup.call('post', '/checkout/sessions', 'customer', {});
    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('cart_invalid');
    expect(setup.carts.sessions.size).toBe(0);
  });

  it('records one attempt and reuses it on a retry', async () => {
    const setup = cartSetup();
    await setup.call('put', '/me/cart/items', 'customer', { productId: PEN, quantity: 1 });

    const first = await setup.call('post', '/checkout/sessions', 'customer', { couponCode: 'EID10' });
    expect(first.status).toBe(201);
    expect(first.headers['cache-control']).toBe('no-store');
    const session = (first.body as { checkout: { id: string; status: string } }).checkout;
    expect(session.status).toBe('started');

    const second = await setup.call('post', '/checkout/sessions', 'customer', {});
    expect((second.body as { checkout: { id: string } }).checkout.id).toBe(session.id);
    expect(setup.carts.sessions.size).toBe(1);
  });

  it('marks the cart as being checked out without converting it', async () => {
    const setup = cartSetup();
    await setup.call('put', '/me/cart/items', 'customer', { productId: PEN, quantity: 1 });
    await setup.call('post', '/checkout/sessions', 'customer', {});
    const cart = await setup.call('get', '/me/cart', 'customer');
    expect(cartResponseSchema.parse(cart.body).cart.status).toBe('checkout');
  });

  it('treats another customer’s session as a silent no-op', async () => {
    const setup = cartSetup();
    await setup.call('put', '/me/cart/items', 'customer', { productId: PEN, quantity: 1 });
    const started = await setup.call('post', '/checkout/sessions', 'customer', {});
    const sessionId = (started.body as { checkout: { id: string } }).checkout.id;

    const response = await setup.call(
      'post',
      `/checkout/sessions/${sessionId}/activity`,
      'other',
      {},
    );
    expect(response.status).toBe(204);
    expect(setup.carts.sessions.get(sessionId)?.userId).toBe(setup.customer.id);
  });

  it('refuses an activity ping for a session id that is not a uuid', async () => {
    const setup = cartSetup();
    const response = await setup.call('post', '/checkout/sessions/nope/activity', 'customer', {});
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'validation_failed' } });
  });

  it('converts only after an order exists, then never returns to the queue', async () => {
    const setup = cartSetup();
    await setup.call('put', '/me/cart/items', 'customer', { productId: PEN, quantity: 1 });
    const started = await setup.call('post', '/checkout/sessions', 'customer', {});
    const sessionId = (started.body as { checkout: { id: string } }).checkout.id;

    const forged = await setup.call(
      'post',
      `/checkout/sessions/${sessionId}/converted`,
      'customer',
      { orderNumber: 'NZ999999' },
    );
    expect(forged.status).toBe(409);
    expect(setup.carts.sessions.get(sessionId)?.status).toBe('started');

    setup.carts.orders.set('NZ100007', 'NZ100007');
    const converted = await setup.call(
      'post',
      `/checkout/sessions/${sessionId}/converted`,
      'customer',
      { orderNumber: 'NZ100007' },
    );
    expect(converted.status).toBe(204);
    expect(setup.carts.sessions.get(sessionId)).toMatchObject({
      status: 'converted',
      orderNumber: 'NZ100007',
    });

    // A second identical call cannot move a converted attempt anywhere.
    const again = await setup.call(
      'post',
      `/checkout/sessions/${sessionId}/converted`,
      'customer',
      { orderNumber: 'NZ100007' },
    );
    expect(again.status).toBe(204);
    expect(setup.carts.sessions.get(sessionId)?.status).toBe('converted');
  });
});

describe('GET /admin/checkouts', () => {
  it('needs a session, a staff role and orders.read', async () => {
    const setup = cartSetup();
    const anonymous = await setup.call('get', '/admin/checkouts');
    expect(anonymous.status).toBe(401);

    const customer = await setup.call('get', '/admin/checkouts', 'customer');
    expect(customer.status).toBe(403);
    expect(errorOf(customer.body).code).toBe('forbidden');
  });

  it('lists checkouts with lifecycle status and pagination', async () => {
    const setup = cartSetup();
    setup.carts.seedCheckout(setup.customer.id, [{ productId: LAMP, variantId: LAMP_RED, quantity: 2 }]);
    setup.carts.seedCheckout(setup.other.id, [{ productId: PEN, variantId: null, quantity: 1 }], 'converted');

    const response = await setup.call('get', '/admin/checkouts', 'staff');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const list = checkoutListResponseSchema.parse(response.body);
    expect(list.total).toBe(2);
    expect(list.page).toBe(1);
    expect(list.checkouts.map((checkout) => checkout.status).sort()).toEqual([
      'converted',
      'incomplete',
    ]);

    const incomplete = await setup.call('get', '/admin/checkouts?status=incomplete', 'staff');
    expect(checkoutListResponseSchema.parse(incomplete.body).checkouts).toHaveLength(1);
  });

  it('searches by customer name and pages the queue', async () => {
    const setup = cartSetup();
    setup.carts.seedCheckout(setup.customer.id, [{ productId: LAMP, variantId: null, quantity: 1 }]);
    setup.carts.seedCheckout(setup.other.id, [{ productId: PEN, variantId: null, quantity: 1 }]);

    const searched = await setup.call('get', '/admin/checkouts?q=karim', 'staff');
    const found = checkoutListResponseSchema.parse(searched.body);
    expect(found.total).toBe(1);
    expect(found.checkouts[0]?.customerName).toBe('Karim Ahmed');

    const paged = await setup.call('get', '/admin/checkouts?pageSize=1&page=2', 'staff');
    const page = checkoutListResponseSchema.parse(paged.body);
    expect(page.checkouts).toHaveLength(1);
    expect(page.totalPages).toBe(2);
  });

  it('refuses a page size above the limit', async () => {
    const setup = cartSetup();
    const response = await setup.call('get', '/admin/checkouts?pageSize=101', 'staff');
    expect(response.status).toBe(400);
  });

  it('never carries the guest handle of the cart behind a checkout', async () => {
    const setup = cartSetup();
    const token = randomUUID();
    await setup.call('post', '/guest/cart', undefined, { token });
    setup.carts.seedCheckout(setup.customer.id, [{ productId: LAMP, variantId: null, quantity: 1 }]);

    const response = await setup.call('get', '/admin/checkouts', 'staff');
    expect(JSON.stringify(response.body)).not.toContain(token);
  });
});

describe('GET /admin/checkouts/:checkoutId', () => {
  it('answers the attempt with its items, variant labels and order reference', async () => {
    const setup = cartSetup();
    const session = setup.carts.seedCheckout(setup.customer.id, [
      { productId: LAMP, variantId: LAMP_RED, quantity: 2 },
    ]);

    const response = await setup.call('get', `/admin/checkouts/${session.id}`, 'staff');
    expect(response.status).toBe(200);
    const detail = checkoutResponseSchema.parse(response.body).checkout;
    expect(detail.customerName).toBe('Rahima Khatun');
    expect(detail.items).toEqual([
      {
        productName: 'Desk Lamp',
        variantLabel: 'Colour: Red',
        sku: 'LAMP-1',
        quantity: 2,
        unitPriceMinor: 10_000,
      },
    ]);
    expect(detail.convertedAt).toBeNull();
  });

  it('answers 404 for an attempt that is not there and 400 for a bad id', async () => {
    const setup = cartSetup();
    const missing = await setup.call('get', `/admin/checkouts/${randomUUID()}`, 'staff');
    expect(missing.status).toBe(404);
    expect(errorOf(missing.body).code).toBe('not_found');

    const invalid = await setup.call('get', '/admin/checkouts/not-a-uuid', 'staff');
    expect(invalid.status).toBe(400);
  });

  it('is closed to a customer and to an account denied orders.read', async () => {
    const setup = cartSetup();
    const session = setup.carts.seedCheckout(setup.customer.id, [
      { productId: LAMP, variantId: null, quantity: 1 },
    ]);
    const asCustomer = await setup.call('get', `/admin/checkouts/${session.id}`, 'customer');
    expect(asCustomer.status).toBe(403);

    setup.staff.overrides.set('orders.read', 'deny');
    const denied = await setup.call('get', `/admin/checkouts/${session.id}`, 'staff');
    expect(denied.status).toBe(403);
    expect(setup.carts.calls).not.toContain('getCheckout');
  });
});
