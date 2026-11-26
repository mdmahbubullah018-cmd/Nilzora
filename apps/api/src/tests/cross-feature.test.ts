import { cartResponseSchema, checkoutListResponseSchema, refundResponseSchema, returnResponseSchema } from '@nilzora/contracts';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FakeAdmin } from './admin-fakes';
import { FakeAfterSales, type FakeOrder } from './after-sales-fakes';
import { FakeSavedCarts, type FakeProduct } from './cart-fakes';
import { FakeCommerce } from './commerce-fakes';
import { DHAKA_ADDRESS, errorOf } from './commerce-helpers';
import { FakeIdentity } from './fakes';
import { testApp } from './helpers';

/*
 * The whole path through one app: a saved cart, a genuine checkout, a Cash-on-Delivery
 * order, then a return against that order whose restock and refund are staff decisions.
 *
 * The fakes are separate (commerce prices and places orders, the cart keeps the saved
 * copy, after-sales keeps the return and refund records), so this checks that the routes
 * compose and that each step's output is the next step's input. It is not a database test.
 * Coupons are not priced by the commerce fake, so coupon pricing is covered by the coupon
 * route tests and the SQL draft instead of here.
 */

/** 2 lamps (10,000 each, limit 3) + 1 pen (1,000) + 6,000 delivery to Dhaka. */
const EXPECTED_TOTAL = 27_000;

function crossFeatureSetup() {
  const identity = new FakeIdentity();
  const commerce = new FakeCommerce(identity);
  const admin = new FakeAdmin(identity);
  const customer = identity.addUser({ email: 'rahima@example.com' });
  const staff = identity.addUser({ email: 'staff@example.com', role: 'staff' });
  const owner = identity.addUser({ email: 'owner@example.com', role: 'super_admin' });

  const kitchen = commerce.addCategory({ slug: 'home-kitchen', name: 'Home & Kitchen' });
  const lamp = commerce.addProduct({
    slug: 'desk-lamp',
    name: 'Desk Lamp',
    categoryId: kitchen.id,
    priceMinor: 10_000,
    stock: 5,
    maxOrderQuantity: 3,
  });
  const pen = commerce.addProduct({
    slug: 'gel-pen',
    name: 'Gel Pen',
    categoryId: kitchen.id,
    priceMinor: 1_000,
    stock: 100,
  });

  const products: Record<string, FakeProduct> = {
    [lamp.id]: { name: 'Desk Lamp', sku: 'LAMP-1', priceMinor: 10_000 },
    [pen.id]: { name: 'Gel Pen', sku: 'PEN-1', priceMinor: 1_000 },
  };
  // One table of orders both the return workflow and this test read; a placed order is
  // added to it the way the database would already hold it.
  const orders: Record<string, FakeOrder> = {};
  const carts = new FakeSavedCarts(products, { [customer.id]: 'Rahima Khatun' });
  const afterSales = new FakeAfterSales(orders);

  const app = testApp({
    auth: identity.deps,
    commerce: commerce.stores,
    carts,
    afterSales,
    admin: { ...admin.stores, afterSales, checkouts: carts },
  });

  const tokens = {
    customer: identity.tokenFor(customer),
    staff: identity.tokenFor(staff),
    owner: identity.tokenFor(owner),
  };

  function call(
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    who: keyof typeof tokens | undefined,
    body?: object,
  ) {
    let pending = request(app)[method](`/api/v1${path}`);
    if (who) pending = pending.set('Authorization', `Bearer ${tokens[who]}`);
    return body === undefined ? pending : pending.send(body);
  }

  return { identity, commerce, carts, afterSales, customer, staff, owner, tokens, orders, call, lamp, pen };
}

type Setup = ReturnType<typeof crossFeatureSetup>;

async function addressId(setup: Setup): Promise<string> {
  const created = await setup.call('post', '/me/addresses', 'customer', DHAKA_ADDRESS);
  return (created.body as { address: { id: string } }).address.id;
}

/** Places the order the review found, registering it for the return workflow. */
async function placeOrder(setup: Setup): Promise<string> {
  const address = await addressId(setup);
  const response = await setup.call('post', '/orders', 'customer', {
    idempotencyKey: randomUUID(),
    addressId: address,
    items: [
      { productId: setup.lamp.id, quantity: 2 },
      { productId: setup.pen.id, quantity: 1 },
    ],
    expectedTotalMinor: EXPECTED_TOTAL,
  });
  expect(response.status).toBe(201);
  const order = (response.body as { order: { orderNumber: string } }).order;
  // Both fakes keep their own view of the orders that exist: the cart fake refuses to
  // convert an attempt for an order it does not know, exactly as the RPC does.
  setup.carts.orders.set(order.orderNumber, order.orderNumber);
  setup.orders[order.orderNumber] = {
    userId: setup.customer.id,
    customerName: 'Rahima Khatun',
    status: 'delivered',
    totalMinor: EXPECTED_TOTAL,
    items: [
      { orderItemId: 1, productName: 'Desk Lamp', sku: 'LAMP-1', quantity: 2, lineTotalMinor: 20_000 },
      { orderItemId: 2, productName: 'Gel Pen', sku: 'PEN-1', quantity: 1, lineTotalMinor: 1_000 },
    ],
  };
  return order.orderNumber;
}

describe('saved cart through order, return and refund', () => {
  it('carries a saved cart into an order and converts the checkout with that order', async () => {
    const setup = crossFeatureSetup();

    const saved = await setup.call('put', '/me/cart/items', 'customer', {
      productId: setup.lamp.id,
      quantity: 2,
    });
    expect(cartResponseSchema.parse(saved.body).cart.status).toBe('active');

    const started = await setup.call('post', '/checkout/sessions', 'customer', {});
    expect(started.status).toBe(201);
    const sessionId = (started.body as { checkout: { id: string } }).checkout.id;

    const orderNumber = await placeOrder(setup);

    const converted = await setup.call(
      'post',
      `/checkout/sessions/${sessionId}/converted`,
      'customer',
      { orderNumber },
    );
    expect(converted.status).toBe(204);

    // The attempt is no longer in the staff queue as an incomplete checkout.
    const queue = await setup.call('get', '/admin/checkouts', 'staff');
    const list = checkoutListResponseSchema.parse(queue.body);
    expect(list.checkouts).toHaveLength(1);
    expect(list.checkouts[0]).toMatchObject({ status: 'converted', orderNumber });
  });

  it('never converts a checkout with an order number the caller does not own', async () => {
    const setup = crossFeatureSetup();
    await setup.call('put', '/me/cart/items', 'customer', { productId: setup.lamp.id, quantity: 1 });
    const started = await setup.call('post', '/checkout/sessions', 'customer', {});
    const sessionId = (started.body as { checkout: { id: string } }).checkout.id;

    const response = await setup.call(
      'post',
      `/checkout/sessions/${sessionId}/converted`,
      'customer',
      { orderNumber: 'NZ999999' },
    );
    expect(response.status).toBe(409);
    expect(setup.carts.sessions.get(sessionId)?.status).toBe('started');
  });

  it('restocks only after the goods arrive, then refunds no more than the order took', async () => {
    const setup = crossFeatureSetup();
    const orderNumber = await placeOrder(setup);

    const filed = await setup.call('post', '/returns', 'customer', {
      orderNumber,
      items: [{ orderItemId: 1, quantity: 1 }],
      reason: 'Arrived damaged',
    });
    expect(filed.status).toBe(201);
    const returnId = returnResponseSchema.parse(filed.body).return.id;

    // Before the goods are in hand, nothing goes back on the shelf.
    const early = await setup.call('post', `/admin/returns/${returnId}/restock`, 'staff', {});
    expect(early.status).toBe(409);
    expect(setup.afterSales.restockedUnits).toBe(0);

    await setup.call('post', `/admin/returns/${returnId}/status`, 'staff', { status: 'approved' });
    await setup.call('post', `/admin/returns/${returnId}/status`, 'staff', { status: 'received' });
    const restocked = await setup.call('post', `/admin/returns/${returnId}/restock`, 'staff', {});
    expect(restocked.status).toBe(200);
    expect(setup.afterSales.restockedUnits).toBe(1);

    // A refund for the returned lamp: approved first, then recorded with a reference.
    const asked = await setup.call('post', '/admin/refunds', 'owner', {
      orderNumber,
      amountMinor: 10_000,
      reason: 'Returned lamp',
      returnRequestId: returnId,
    });
    expect(asked.status).toBe(201);
    const refundId = refundResponseSchema.parse(asked.body).refund.id;

    const tooSoon = await setup.call('post', `/admin/refunds/${refundId}/completion`, 'owner', {
      reference: 'CASH-2026-0001',
    });
    expect(tooSoon.status).toBe(409);
    expect(errorOf(tooSoon.body).code).toBe('refund_not_completable');

    await setup.call('post', `/admin/refunds/${refundId}/decision`, 'owner', { approve: true });
    const paid = await setup.call('post', `/admin/refunds/${refundId}/completion`, 'owner', {
      reference: 'CASH-2026-0001',
    });
    expect(paid.status).toBe(200);
    expect(refundResponseSchema.parse(paid.body).refund).toMatchObject({
      status: 'completed',
      reference: 'CASH-2026-0001',
    });

    // What an order can still refund is its total minus everything already recorded.
    const remaining = await setup.call('post', '/admin/refunds', 'owner', {
      orderNumber,
      amountMinor: 17_001,
      reason: 'Goodwill',
    });
    expect(remaining.status).toBe(409);
    expect(errorOf(remaining.body).code).toBe('refund_exceeds_balance');

    const lastOfIt = await setup.call('post', '/admin/refunds', 'owner', {
      orderNumber,
      amountMinor: 17_000,
      reason: 'Goodwill',
    });
    expect(lastOfIt.status).toBe(201);
  });

  it('shows the customer the return and its refund', async () => {
    const setup = crossFeatureSetup();
    const orderNumber = await placeOrder(setup);
    const filed = await setup.call('post', '/returns', 'customer', {
      orderNumber,
      items: [{ orderItemId: 2, quantity: 1 }],
      reason: 'Not what I ordered',
    });
    const returnId = returnResponseSchema.parse(filed.body).return.id;

    const asked = await setup.call('post', '/admin/refunds', 'owner', {
      orderNumber,
      amountMinor: 1_000,
      reason: 'Returned pen',
      returnRequestId: returnId,
    });
    const refundId = refundResponseSchema.parse(asked.body).refund.id;
    await setup.call('post', `/admin/refunds/${refundId}/decision`, 'owner', { approve: true });
    await setup.call('post', `/admin/refunds/${refundId}/completion`, 'owner', {
      reference: 'CASH-2026-0002',
    });

    const mine = await setup.call('get', `/returns/${returnId}`, 'customer');
    const detail = returnResponseSchema.parse(mine.body).return;
    expect(detail.refunds).toHaveLength(1);
    expect(detail.refunds?.[0]).toMatchObject({ amountMinor: 1_000, status: 'completed' });

    const refunds = await setup.call('get', `/orders/${orderNumber}/refunds`, 'customer');
    expect((refunds.body as { refunds: unknown[] }).refunds).toHaveLength(1);
  });
});
