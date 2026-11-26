import { adminOrderListResponseSchema, adminOrderResponseSchema } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import { DB_MESSAGE } from './admin-fakes';
import { adminSetup, errorOf } from './admin-helpers';
import { toOrderSearch } from '../modules/admin/orders-routes';

describe('GET /api/v1/admin/orders', () => {
  it('lists every customer order newest first with paging', async () => {
    const setup = adminSetup();
    const other = setup.admin.addOrder(setup.users.otherCustomer.id, setup.products.lamp);
    const response = await setup.call('get', '/admin/orders?pageSize=2', 'staff');

    expect(response.status).toBe(200);
    const page = adminOrderListResponseSchema.parse(response.body);
    expect(page).toMatchObject({ total: 4, totalPages: 2 });
    expect(page.orders.map((order) => order.orderNumber)).toEqual([
      other.orderNumber,
      setup.orders.delivered.orderNumber,
    ]);
    expect(page.orders[0]).toMatchObject({
      customerId: setup.users.otherCustomer.id,
      recipientName: 'Rahima Khatun',
      deliveryZone: 'inside_dhaka',
    });
  });

  it.each([
    ['status', 'status=shipped', ['shipped']],
    ['payment status', 'paymentStatus=pending&status=delivered', ['delivered']],
    ['an order number prefix', 'q=nz10000', ['delivered', 'shipped', 'pending']],
    ['an exact order number', 'q=NZ100002', ['shipped']],
    ['a phone number fragment', 'q=01712-345', ['delivered', 'shipped', 'pending']],
    ['a recipient name', 'q=rahima', ['delivered', 'shipped', 'pending']],
    ['a name nobody has', 'q=karim', []],
  ])('filters by %s', async (_label, query, statuses) => {
    const setup = adminSetup();
    const response = await setup.call('get', `/admin/orders?${query}`, 'staff');

    expect(response.status).toBe(200);
    const { orders } = adminOrderListResponseSchema.parse(response.body);
    expect(orders.map((order) => order.status)).toEqual(statuses);
  });

  it("filters by one customer's id", async () => {
    const setup = adminSetup();
    const other = setup.admin.addOrder(setup.users.otherCustomer.id, setup.products.lamp);
    const theirs = await setup.call(
      'get',
      `/admin/orders?customerId=${setup.users.otherCustomer.id}`,
      'staff',
    );
    const nobody = await setup.call(
      'get',
      `/admin/orders?customerId=${setup.users.staff.id}`,
      'staff',
    );
    const malformed = await setup.call('get', '/admin/orders?customerId=karim', 'staff');

    expect(
      adminOrderListResponseSchema.parse(theirs.body).orders.map((o) => o.orderNumber),
    ).toEqual([other.orderNumber]);
    expect(adminOrderListResponseSchema.parse(nobody.body).total).toBe(0);
    expect(malformed.status).toBe(400);
  });

  it('filters by Bangladesh calendar days, both inclusive', async () => {
    const setup = adminSetup();
    // The fixtures are placed on 25 October 2026 at 14:00 in Dhaka (08:00 UTC).
    const day = await setup.call('get', '/admin/orders?from=2026-10-25&to=2026-10-25', 'staff');
    const before = await setup.call('get', '/admin/orders?to=2026-10-24', 'staff');
    const after = await setup.call('get', '/admin/orders?from=2026-10-26', 'staff');

    expect(adminOrderListResponseSchema.parse(day.body).total).toBe(3);
    expect(adminOrderListResponseSchema.parse(before.body).total).toBe(0);
    expect(adminOrderListResponseSchema.parse(after.body).total).toBe(0);
  });

  it.each([
    ['a start after the end', 'from=2026-10-26&to=2026-10-25'],
    ['a malformed date', 'from=25-10-2026'],
    ['an unknown status', 'status=lost'],
    ['an unknown payment status', 'paymentStatus=paid'],
  ])('rejects %s', async (_label, query) => {
    const setup = adminSetup();
    const response = await setup.call('get', `/admin/orders?${query}`, 'staff');

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
  });

  it('reads order searches as order numbers, phone numbers or names', () => {
    expect(toOrderSearch('nz 1000-42')).toStrictEqual({ kind: 'order_number', prefix: 'NZ100042' });
    expect(toOrderSearch('+880 1712-345678')).toStrictEqual({
      kind: 'phone',
      digits: '8801712345678',
    });
    expect(toOrderSearch('Rahima_%')).toStrictEqual({ kind: 'recipient', term: 'Rahima' });
    expect(toOrderSearch('%*')).toBeNull();
  });
});

describe('GET /api/v1/admin/orders/:orderNumber', () => {
  it('shows the order with the actions the caller may take', async () => {
    const setup = adminSetup();
    const asStaff = await setup.call(
      'get',
      `/admin/orders/${setup.orders.pending.orderNumber}`,
      'staff',
    );
    const asAdmin = await setup.call(
      'get',
      `/admin/orders/${setup.orders.pending.orderNumber}`,
      'admin',
    );

    expect(adminOrderResponseSchema.parse(asStaff.body).order).toMatchObject({
      orderNumber: setup.orders.pending.orderNumber,
      customer: { id: setup.users.customer.id, fullName: 'Rahima Khatun' },
      allowedStatuses: ['confirmed'],
      canRecordCollection: false,
    });
    expect(adminOrderResponseSchema.parse(asAdmin.body).order.allowedStatuses).toEqual([
      'confirmed',
      'cancelled',
    ]);
  });

  it('offers cash collection only for a delivered order awaiting payment', async () => {
    const setup = adminSetup();
    const response = await setup.call(
      'get',
      `/admin/orders/${setup.orders.delivered.orderNumber}`,
      'staff',
    );

    expect(adminOrderResponseSchema.parse(response.body).order).toMatchObject({
      allowedStatuses: [],
      canRecordCollection: true,
    });
  });

  it('hides customer details from callers without customers.read', async () => {
    const setup = adminSetup();
    setup.deny('staff', 'customers.read');
    const response = await setup.call(
      'get',
      `/admin/orders/${setup.orders.pending.orderNumber}`,
      'staff',
    );

    expect(adminOrderResponseSchema.parse(response.body).order.customer).toStrictEqual({
      id: setup.users.customer.id,
      fullName: null,
      phone: null,
    });
  });

  it('answers 404 for an unknown order and 400 for a malformed number', async () => {
    const setup = adminSetup();
    const missing = await setup.call('get', '/admin/orders/NZ999999', 'staff');
    const malformed = await setup.call('get', '/admin/orders/order-1', 'staff');

    expect(missing.status).toBe(404);
    expect(errorOf(missing.body).message).toBe('Order not found');
    expect(malformed.status).toBe(400);
  });
});

describe('POST /api/v1/admin/orders/:orderNumber/status', () => {
  it('moves an order through fulfilment and records who did it', async () => {
    const setup = adminSetup();
    const { orderNumber } = setup.orders.pending;
    for (const status of ['confirmed', 'processing', 'shipped', 'delivered']) {
      const response = await setup.call('post', `/admin/orders/${orderNumber}/status`, 'staff', {
        status,
        note: status === 'shipped' ? 'Handed to courier' : '',
      });
      expect(response.status, status).toBe(200);
      expect(adminOrderResponseSchema.parse(response.body).order.status).toBe(status);
    }

    expect(
      setup.orders.pending.history.map((event) => [event.toStatus, event.actorKind, event.note]),
    ).toEqual([
      ['pending', 'customer', null],
      ['confirmed', 'staff', null],
      ['processing', 'staff', null],
      ['shipped', 'staff', 'Handed to courier'],
      ['delivered', 'staff', null],
    ]);
    expect(
      setup.admin.audit.filter((entry) => entry.action === 'order.status_changed'),
    ).toHaveLength(4);
    expect(setup.admin.audit.every((entry) => entry.actorId === setup.users.staff.id)).toBe(true);
  });

  it('cancels with a reason and returns the stock', async () => {
    const setup = adminSetup();
    const { orderNumber } = setup.orders.pending;
    const response = await setup.call('post', `/admin/orders/${orderNumber}/status`, 'admin', {
      status: 'cancelled',
      note: 'Customer asked by phone',
    });

    expect(response.status).toBe(200);
    expect(adminOrderResponseSchema.parse(response.body).order).toMatchObject({
      status: 'cancelled',
      paymentStatus: 'cancelled',
      cancelReason: 'Customer asked by phone',
      allowedStatuses: [],
    });
    expect(setup.products.lamp.stock).toBe(22);
    expect(setup.admin.movements.at(-1)).toMatchObject({
      change: 2,
      reason: 'order_cancelled',
      orderNumber,
      actorId: setup.users.admin.id,
    });
  });

  it('requires orders.cancel to cancel, even with orders.update_status', async () => {
    const setup = adminSetup();
    const response = await setup.call(
      'post',
      `/admin/orders/${setup.orders.pending.orderNumber}/status`,
      'staff',
      { status: 'cancelled', note: 'Customer asked by phone' },
    );

    expect(response.status).toBe(403);
    expect(errorOf(response.body).code).toBe('forbidden');
    expect(setup.admin.calls).toEqual([]);
  });

  it('requires orders.update_status for fulfilment, even with orders.cancel', async () => {
    const setup = adminSetup();
    setup.deny('admin', 'orders.update_status');
    const cancel = await setup.call(
      'post',
      `/admin/orders/${setup.orders.shipped.orderNumber}/status`,
      'admin',
      { status: 'delivered' },
    );

    expect(cancel.status).toBe(403);
    expect(setup.admin.calls).toEqual([]);
  });

  it('refuses transitions the order does not allow (NZ434)', async () => {
    const setup = adminSetup();
    const skip = await setup.call(
      'post',
      `/admin/orders/${setup.orders.pending.orderNumber}/status`,
      'staff',
      { status: 'shipped' },
    );
    const late = await setup.call(
      'post',
      `/admin/orders/${setup.orders.shipped.orderNumber}/status`,
      'admin',
      { status: 'cancelled', note: 'Too late now' },
    );

    for (const response of [skip, late]) {
      expect(response.status).toBe(409);
      expect(errorOf(response.body).code).toBe('invalid_status_transition');
      expect(JSON.stringify(response.body)).not.toContain(DB_MESSAGE);
    }
    expect(setup.orders.shipped.status).toBe('shipped');
  });

  it.each([
    ['a cancellation without a reason', { status: 'cancelled' }],
    ['a cancellation with a short reason', { status: 'cancelled', note: 'no' }],
    ['a move back to pending', { status: 'pending' }],
    ['an unknown status', { status: 'lost' }],
    ['a payment status', { status: 'confirmed', paymentStatus: 'collected' }],
    ['an actor', { status: 'confirmed', actorId: '3f8e2a52-7b1c-4d3e-9f0a-1b2c3d4e5f60' }],
    ['an oversized note', { status: 'confirmed', note: 'x'.repeat(301) }],
  ])('rejects %s', async (_label, body) => {
    const setup = adminSetup();
    const response = await setup.call(
      'post',
      `/admin/orders/${setup.orders.pending.orderNumber}/status`,
      'admin',
      body,
    );

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(setup.admin.calls).toEqual([]);
  });

  it('answers 404 for an unknown order and maps a refused note (NZ412) to 400', async () => {
    const setup = adminSetup();
    const missing = await setup.call('post', '/admin/orders/NZ999999/status', 'admin', {
      status: 'confirmed',
    });
    setup.admin.nextFailure = { code: 'NZ412' };
    const refused = await setup.call(
      'post',
      `/admin/orders/${setup.orders.pending.orderNumber}/status`,
      'admin',
      { status: 'confirmed' },
    );

    expect(missing.status).toBe(404);
    expect(errorOf(missing.body).message).toBe('Order not found');
    expect(refused.status).toBe(400);
    expect(errorOf(refused.body)).toMatchObject({
      code: 'bad_request',
      message: 'The note is missing or too long',
    });
  });
});

describe('POST /api/v1/admin/orders/:orderNumber/cod-collection', () => {
  it('records the cash of a delivered order once', async () => {
    const setup = adminSetup();
    const { orderNumber, totalMinor } = setup.orders.delivered;
    const first = await setup.call('post', `/admin/orders/${orderNumber}/cod-collection`, 'staff', {
      amountMinor: totalMinor,
    });
    const again = await setup.call('post', `/admin/orders/${orderNumber}/cod-collection`, 'staff', {
      amountMinor: totalMinor,
    });

    expect(first.status).toBe(200);
    expect(adminOrderResponseSchema.parse(first.body).order).toMatchObject({
      status: 'delivered',
      paymentStatus: 'collected',
      canRecordCollection: false,
    });
    expect(again.status).toBe(409);
    expect(errorOf(again.body).code).toBe('payment_not_collectable');
    expect(
      setup.admin.audit.filter((entry) => entry.action === 'order.payment_collected'),
    ).toHaveLength(1);
  });

  it('refuses an amount that differs from the server total, recording nothing', async () => {
    const setup = adminSetup();
    const { orderNumber, totalMinor } = setup.orders.delivered;
    const response = await setup.call(
      'post',
      `/admin/orders/${orderNumber}/cod-collection`,
      'staff',
      {
        amountMinor: totalMinor - 100,
      },
    );

    expect(response.status).toBe(409);
    expect(errorOf(response.body)).toMatchObject({
      code: 'collection_amount_mismatch',
      details: { totalMinor },
    });
    expect(setup.orders.delivered.paymentStatus).toBe('pending');
    expect(setup.admin.calls).not.toContain('recordCollection');
  });

  it('refuses an order that is not delivered yet (NZ435)', async () => {
    const setup = adminSetup();
    const { orderNumber, totalMinor } = setup.orders.shipped;
    const response = await setup.call(
      'post',
      `/admin/orders/${orderNumber}/cod-collection`,
      'staff',
      {
        amountMinor: totalMinor,
      },
    );

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('payment_not_collectable');
  });

  it.each([
    ['no amount', {}],
    ['a negative amount', { amountMinor: -1 }],
    ['a payment status', { amountMinor: 1, paymentStatus: 'collected' }],
    ['a collector', { amountMinor: 1, collectedBy: '3f8e2a52-7b1c-4d3e-9f0a-1b2c3d4e5f60' }],
  ])('rejects %s', async (_label, body) => {
    const setup = adminSetup();
    const response = await setup.call(
      'post',
      `/admin/orders/${setup.orders.delivered.orderNumber}/cod-collection`,
      'staff',
      body,
    );

    expect(response.status).toBe(400);
    expect(setup.admin.calls).toEqual([]);
  });

  it('answers 404 for an unknown order', async () => {
    const setup = adminSetup();
    const response = await setup.call('post', '/admin/orders/NZ999999/cod-collection', 'staff', {
      amountMinor: 1,
    });

    expect(response.status).toBe(404);
  });
});
