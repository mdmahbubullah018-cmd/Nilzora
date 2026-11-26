import {
  myRefundsResponseSchema,
  refundListResponseSchema,
  refundResponseSchema,
  returnListResponseSchema,
  returnResponseSchema,
} from '@nilzora/contracts';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FakeAdmin } from './admin-fakes';
import { FakeAfterSales, type FakeOrder } from './after-sales-fakes';
import { errorOf } from './commerce-helpers';
import { FakeIdentity } from './fakes';
import { testApp } from './helpers';

const AT = '2026-11-06T10:00:00.000Z';

const ORDERS: Record<string, FakeOrder> = {
  NZ100001: {
    userId: 'customer',
    customerName: 'Rahima Khatun',
    status: 'delivered',
    totalMinor: 125_000,
    items: [
      { orderItemId: 1, productName: 'Cotton shirt', sku: 'SHIRT-RED', quantity: 2, lineTotalMinor: 125_000 },
    ],
  },
  NZ100002: {
    userId: 'customer',
    customerName: 'Rahima Khatun',
    status: 'pending',
    totalMinor: 60_000,
    items: [{ orderItemId: 2, productName: 'Ceramic mug', sku: 'MUG-1', quantity: 1, lineTotalMinor: 60_000 }],
  },
  NZ100003: {
    userId: 'other',
    customerName: 'Karim Ahmed',
    status: 'delivered',
    totalMinor: 40_000,
    items: [{ orderItemId: 3, productName: 'Gel pen', sku: 'PEN-1', quantity: 5, lineTotalMinor: 40_000 }],
  },
};

/**
 * One app with the customer after-sales routes and the staff queues mounted over the same
 * in-memory records, so a test can prove that what a customer does is what staff see.
 */
function afterSalesSetup() {
  const identity = new FakeIdentity();
  const admin = new FakeAdmin(identity);
  const customer = identity.addUser({ email: 'rahima@example.com' });
  const other = identity.addUser({ email: 'karim@example.com' });
  const staff = identity.addUser({ email: 'staff@example.com', role: 'staff' });
  const owner = identity.addUser({ email: 'owner@example.com', role: 'super_admin' });

  // The fixture orders are named by their owner's role so one table serves every test.
  const orders = Object.fromEntries(
    Object.entries(ORDERS).map(([number, order]) => {
      const userId =
        order.userId === 'customer' ? customer.id : order.userId === 'other' ? other.id : order.userId;
      return [number, { ...order, userId }];
    }),
  );
  const afterSales = new FakeAfterSales(orders);
  const app = testApp({
    auth: identity.deps,
    admin: { ...admin.stores, afterSales },
    afterSales,
  });

  const tokens = {
    customer: identity.tokenFor(customer),
    other: identity.tokenFor(other),
    staff: identity.tokenFor(staff),
    owner: identity.tokenFor(owner),
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

  return { identity, afterSales, customer, other, staff, owner, tokens, app, call };
}

const returnBody = {
  orderNumber: 'NZ100001',
  items: [{ orderItemId: 1, quantity: 1 }],
  reason: 'Arrived damaged',
};

describe('customer returns', () => {
  it('needs a session for every customer after-sales route', async () => {
    const setup = afterSalesSetup();
    expect((await setup.call('get', '/returns')).status).toBe(401);
    expect((await setup.call('post', '/returns', undefined, returnBody)).status).toBe(401);
    expect((await setup.call('get', `/returns/${randomUUID()}`)).status).toBe(401);
    expect((await setup.call('post', `/returns/${randomUUID()}/cancel`, undefined, {})).status).toBe(401);
    expect((await setup.call('get', '/orders/NZ100001/refunds')).status).toBe(401);
  });

  it('files a return and answers it in the contract shape', async () => {
    const setup = afterSalesSetup();
    const response = await setup.call('post', '/returns', 'customer', returnBody);

    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const request_ = returnResponseSchema.parse(response.body).return;
    expect(request_.status).toBe('requested');
    expect(request_.orderNumber).toBe('NZ100001');
    expect(request_.items[0]).toMatchObject({ quantity: 1, orderedQuantity: 2, sku: 'SHIRT-RED' });
    expect(request_.history[0]).toMatchObject({ toStatus: 'requested', actorKind: 'customer' });
  });

  it('refuses an order that has not been delivered', async () => {
    const setup = afterSalesSetup();
    const response = await setup.call('post', '/returns', 'customer', {
      ...returnBody,
      orderNumber: 'NZ100002',
      items: [{ orderItemId: 2, quantity: 1 }],
    });
    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('return_not_eligible');
  });

  it('refuses more units than were bought', async () => {
    const setup = afterSalesSetup();
    const response = await setup.call('post', '/returns', 'customer', {
      ...returnBody,
      items: [{ orderItemId: 1, quantity: 3 }],
    });
    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('return_quantity_exceeded');
  });

  it('refuses a second request for the same line while one is open', async () => {
    const setup = afterSalesSetup();
    await setup.call('post', '/returns', 'customer', returnBody);
    const response = await setup.call('post', '/returns', 'customer', returnBody);
    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('return_not_eligible');
    expect(setup.afterSales.returns.size).toBe(1);
  });

  it('refuses a request body that names no items, without reaching the store', async () => {
    const setup = afterSalesSetup();
    const response = await setup.call('post', '/returns', 'customer', {
      orderNumber: 'NZ100001',
      items: [],
      reason: 'Arrived damaged',
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'validation_failed' } });
    expect(setup.afterSales.calls).not.toContain('requestReturn');
  });

  it('lists and reads only the caller’s own requests', async () => {
    const setup = afterSalesSetup();
    const filed = await setup.call('post', '/returns', 'customer', returnBody);
    const id = returnResponseSchema.parse(filed.body).return.id;

    const mine = await setup.call('get', '/returns', 'customer');
    expect(returnListResponseSchema.parse(mine.body).returns).toHaveLength(1);

    const theirs = await setup.call('get', '/returns', 'other');
    expect(returnListResponseSchema.parse(theirs.body).returns).toEqual([]);

    const asOwner = await setup.call('get', `/returns/${id}`, 'customer');
    expect(returnResponseSchema.parse(asOwner.body).return.id).toBe(id);

    // Another customer's request answers exactly like a missing one.
    const asOther = await setup.call('get', `/returns/${id}`, 'other');
    expect(asOther.status).toBe(404);
    expect(errorOf(asOther.body).code).toBe('not_found');
  });

  it('cancels a request that is still waiting, then refuses a second cancel', async () => {
    const setup = afterSalesSetup();
    const filed = await setup.call('post', '/returns', 'customer', returnBody);
    const id = returnResponseSchema.parse(filed.body).return.id;

    const cancelled = await setup.call('post', `/returns/${id}/cancel`, 'customer', {});
    expect(cancelled.status).toBe(204);

    const again = await setup.call('post', `/returns/${id}/cancel`, 'customer', {});
    expect(again.status).toBe(409);
    expect(errorOf(again.body).code).toBe('return_closed');
  });

  it('shows the refunds recorded against one of the customer’s orders', async () => {
    const setup = afterSalesSetup();
    const empty = await setup.call('get', '/orders/NZ100001/refunds', 'customer');
    expect(empty.status).toBe(200);
    expect(myRefundsResponseSchema.parse(empty.body).refunds).toEqual([]);

    // Another customer cannot read this order's refunds.
    const asOther = await setup.call('get', '/orders/NZ100001/refunds', 'other');
    expect(asOther.status).toBe(404);
    expect(errorOf(asOther.body).code).toBe('not_found');
  });
});

describe('staff returns queue', () => {
  it('needs orders.read: a customer is refused before the store is asked', async () => {
    const setup = afterSalesSetup();
    const response = await setup.call('get', '/admin/returns', 'customer');
    expect(response.status).toBe(403);
    expect(errorOf(response.body).code).toBe('forbidden');
    expect(setup.afterSales.calls).not.toContain('listReturns');
  });

  it('lists, filters and pages the queue', async () => {
    const setup = afterSalesSetup();
    setup.afterSales.seedReturn('NZ100001', 'requested');
    setup.afterSales.seedReturn('NZ100003', 'received');

    const all = await setup.call('get', '/admin/returns', 'staff');
    expect(all.status).toBe(200);
    expect(all.headers['cache-control']).toBe('no-store');
    expect(returnListResponseSchema.parse(all.body).total).toBe(2);

    const requested = await setup.call('get', '/admin/returns?status=requested', 'staff');
    expect(returnListResponseSchema.parse(requested.body).returns).toHaveLength(1);

    const searched = await setup.call('get', '/admin/returns?q=karim', 'staff');
    expect(returnListResponseSchema.parse(searched.body).returns[0]?.orderNumber).toBe('NZ100003');

    const paged = await setup.call('get', '/admin/returns?pageSize=1&page=2', 'staff');
    const page = returnListResponseSchema.parse(paged.body);
    expect(page.returns).toHaveLength(1);
    expect(page.totalPages).toBe(2);
  });

  it('answers one return and 404 for one that is not there', async () => {
    const setup = afterSalesSetup();
    const seeded = setup.afterSales.seedReturn('NZ100001', 'requested');

    const found = await setup.call('get', `/admin/returns/${seeded.id}`, 'staff');
    expect(returnResponseSchema.parse(found.body).return.customer?.name).toBe('Rahima Khatun');

    const missing = await setup.call('get', `/admin/returns/${randomUUID()}`, 'staff');
    expect(missing.status).toBe(404);
    expect(errorOf(missing.body).code).toBe('not_found');
  });

  it('decides a request, then refuses the same decision twice', async () => {
    const setup = afterSalesSetup();
    const seeded = setup.afterSales.seedReturn('NZ100001', 'requested');

    const approved = await setup.call('post', `/admin/returns/${seeded.id}/status`, 'staff', {
      status: 'approved',
      note: 'Send it back',
    });
    expect(approved.status).toBe(200);
    expect(returnResponseSchema.parse(approved.body).return.status).toBe('approved');

    const again = await setup.call('post', `/admin/returns/${seeded.id}/status`, 'staff', {
      status: 'approved',
    });
    expect(again.status).toBe(409);
    expect(errorOf(again.body).code).toBe('return_closed');
  });

  it('keeps stock untouched until the goods are received', async () => {
    const setup = afterSalesSetup();
    const seeded = setup.afterSales.seedReturn('NZ100001', 'approved');

    const early = await setup.call('post', `/admin/returns/${seeded.id}/restock`, 'staff', {});
    expect(early.status).toBe(409);
    expect(errorOf(early.body).code).toBe('return_not_eligible');
    expect(setup.afterSales.restockedUnits).toBe(0);

    await setup.call('post', `/admin/returns/${seeded.id}/status`, 'staff', { status: 'received' });
    const restocked = await setup.call('post', `/admin/returns/${seeded.id}/restock`, 'staff', {});
    expect(restocked.status).toBe(200);
    expect(returnResponseSchema.parse(restocked.body).return.restockedAt).not.toBeNull();
    expect(setup.afterSales.restockedUnits).toBe(1);

    const twice = await setup.call('post', `/admin/returns/${seeded.id}/restock`, 'staff', {});
    expect(twice.status).toBe(409);
    expect(setup.afterSales.restockedUnits).toBe(1);
  });

  it('refuses a restock to an account without inventory.adjust', async () => {
    const setup = afterSalesSetup();
    const seeded = setup.afterSales.seedReturn('NZ100001', 'received');
    setup.staff.overrides.set('inventory.adjust', 'deny');

    const response = await setup.call('post', `/admin/returns/${seeded.id}/restock`, 'staff', {});
    expect(response.status).toBe(403);
    expect(setup.afterSales.restockedUnits).toBe(0);
  });
});

describe('staff refunds', () => {
  it('records a refund request and refuses one above the order’s balance', async () => {
    const setup = afterSalesSetup();
    const created = await setup.call('post', '/admin/refunds', 'staff', {
      orderNumber: 'NZ100001',
      amountMinor: 50_000,
      reason: 'Goods returned',
    });
    expect(created.status).toBe(201);
    expect(refundResponseSchema.parse(created.body).refund.status).toBe('requested');

    const tooMuch = await setup.call('post', '/admin/refunds', 'staff', {
      orderNumber: 'NZ100001',
      amountMinor: 100_000,
      reason: 'Goods returned',
    });
    expect(tooMuch.status).toBe(409);
    expect(errorOf(tooMuch.body).code).toBe('refund_exceeds_balance');
  });

  it('will not record a payout before the refund was approved', async () => {
    const setup = afterSalesSetup();
    const created = await setup.call('post', '/admin/refunds', 'staff', {
      orderNumber: 'NZ100001',
      amountMinor: 50_000,
      reason: 'Goods returned',
    });
    const id = refundResponseSchema.parse(created.body).refund.id;

    const early = await setup.call('post', `/admin/refunds/${id}/completion`, 'owner', {
      reference: 'CASH-2026-0001',
    });
    expect(early.status).toBe(409);
    expect(errorOf(early.body).code).toBe('refund_not_completable');
  });

  it('requires a reference to record cash handed back by hand', async () => {
    const setup = afterSalesSetup();
    const created = await setup.call('post', '/admin/refunds', 'staff', {
      orderNumber: 'NZ100001',
      amountMinor: 50_000,
      reason: 'Goods returned',
    });
    const id = refundResponseSchema.parse(created.body).refund.id;
    await setup.call('post', `/admin/refunds/${id}/decision`, 'owner', { approve: true });

    const noReference = await setup.call('post', `/admin/refunds/${id}/completion`, 'owner', {
      reference: '  ',
    });
    expect(noReference.status).toBe(400);
    expect(noReference.body).toMatchObject({ error: { code: 'validation_failed' } });

    const completed = await setup.call('post', `/admin/refunds/${id}/completion`, 'owner', {
      reference: 'CASH-2026-0001',
    });
    expect(completed.status).toBe(200);
    const refund = refundResponseSchema.parse(completed.body).refund;
    expect(refund.status).toBe('completed');
    expect(refund.reference).toBe('CASH-2026-0001');
    expect(refund.completedAt).not.toBeNull();
  });

  it('needs refunds.approve to decide a refund, which staff do not hold', async () => {
    const setup = afterSalesSetup();
    const created = await setup.call('post', '/admin/refunds', 'staff', {
      orderNumber: 'NZ100001',
      amountMinor: 50_000,
      reason: 'Goods returned',
    });
    const id = refundResponseSchema.parse(created.body).refund.id;

    const asStaff = await setup.call('post', `/admin/refunds/${id}/decision`, 'staff', {
      approve: true,
    });
    expect(asStaff.status).toBe(403);
    expect(setup.afterSales.calls).not.toContain('decideRefund');

    const asOwner = await setup.call('post', `/admin/refunds/${id}/decision`, 'owner', {
      approve: true,
    });
    expect(asOwner.status).toBe(200);
    expect(refundResponseSchema.parse(asOwner.body).refund.status).toBe('approved');
  });

  it('lists refunds and reads one with the order it belongs to', async () => {
    const setup = afterSalesSetup();
    const created = await setup.call('post', '/admin/refunds', 'owner', {
      orderNumber: 'NZ100001',
      amountMinor: 25_000,
      reason: 'Partial goodwill',
    });
    const id = refundResponseSchema.parse(created.body).refund.id;

    const list = await setup.call('get', '/admin/refunds?status=requested', 'staff');
    expect(refundListResponseSchema.parse(list.body).refunds).toHaveLength(1);

    const detail = await setup.call('get', `/admin/refunds/${id}`, 'staff');
    const refund = refundResponseSchema.parse(detail.body).refund;
    expect(refund.order.number).toBe('NZ100001');
    expect(refund.refundableMinor).toBe(100_000);

    const missing = await setup.call('get', `/admin/refunds/${randomUUID()}`, 'staff');
    expect(missing.status).toBe(404);
  });

  it('cancels a refund and refuses to cancel one already paid', async () => {
    const setup = afterSalesSetup();
    const created = await setup.call('post', '/admin/refunds', 'owner', {
      orderNumber: 'NZ100001',
      amountMinor: 25_000,
      reason: 'Partial goodwill',
    });
    const id = refundResponseSchema.parse(created.body).refund.id;

    const cancelled = await setup.call('post', `/admin/refunds/${id}/cancel`, 'owner', {
      note: 'Customer changed their mind',
    });
    expect(cancelled.status).toBe(200);
    expect(refundResponseSchema.parse(cancelled.body).refund.status).toBe('cancelled');
  });

  it('never carries a customer session token in a refund answer', async () => {
    const setup = afterSalesSetup();
    const list = await setup.call('get', '/admin/refunds', 'staff');
    expect(JSON.stringify(list.body)).not.toContain(setup.tokens.customer);
    expect(list.headers['cache-control']).toBe('no-store');
  });
});

void AT;
