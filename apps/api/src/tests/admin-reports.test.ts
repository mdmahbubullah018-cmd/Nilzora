import { randomUUID } from 'node:crypto';
import {
  auditLogResponseSchema,
  dashboardResponseSchema,
  deliveryChargeListResponseSchema,
  deliveryChargeResponseSchema,
  salesOverviewResponseSchema,
} from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import { adminSetup, errorOf } from './admin-helpers';

describe('GET /api/v1/admin/audit-log', () => {
  async function withHistory() {
    const setup = adminSetup();
    await setup.call('post', `/admin/products/${setup.products.lamp.id}/stock`, 'staff', {
      change: 2,
      note: 'Recount',
    });
    await setup.call('post', `/admin/orders/${setup.orders.pending.orderNumber}/status`, 'admin', {
      status: 'confirmed',
    });
    await setup.call('put', `/admin/staff/${setup.users.staff.id}/permissions`, 'admin', {
      permission: 'orders.cancel',
      effect: 'grant',
    });
    return setup;
  }

  it('lists privileged actions newest first with their actors', async () => {
    const setup = await withHistory();
    const response = await setup.call('get', '/admin/audit-log', 'admin');

    const log = auditLogResponseSchema.parse(response.body);
    expect(log.entries.map((entry) => entry.action)).toEqual([
      'staff.permission_changed',
      'order.status_changed',
      'inventory.adjusted',
    ]);
    expect(log.entries[0]).toMatchObject({
      actor: { id: setup.users.admin.id },
      targetType: 'account',
      targetId: setup.users.staff.id,
      details: { permission: 'orders.cancel', to: 'grant' },
    });
  });

  it('filters by action prefix and actor', async () => {
    const setup = await withHistory();
    const orders = await setup.call('get', '/admin/audit-log?action=order.', 'admin');
    const byStaff = await setup.call(
      'get',
      `/admin/audit-log?actorId=${setup.users.staff.id}`,
      'admin',
    );

    expect(auditLogResponseSchema.parse(orders.body).entries.map((entry) => entry.action)).toEqual([
      'order.status_changed',
    ]);
    expect(auditLogResponseSchema.parse(byStaff.body).entries.map((entry) => entry.action)).toEqual(
      ['inventory.adjusted'],
    );
  });

  it.each(['action=ORDER', 'action=order%25', `action=${'a'.repeat(61)}`, 'actorId=me'])(
    'rejects %s',
    async (query) => {
      const setup = adminSetup();
      const response = await setup.call('get', `/admin/audit-log?${query}`, 'admin');

      expect(response.status).toBe(400);
      expect(errorOf(response.body).code).toBe('validation_failed');
    },
  );
});

describe('GET /api/v1/admin/analytics/sales', () => {
  it('reports sales of the period (30 days unless asked), never counting cancellations', async () => {
    const setup = adminSetup();
    setup.admin.addOrder(setup.users.otherCustomer.id, setup.products.lamp, {
      status: 'cancelled',
    });
    const response = await setup.call('get', '/admin/analytics/sales', 'admin');

    const { overview } = salesOverviewResponseSchema.parse(response.body);
    // Three open orders: 2 lamps + 6,000 delivery, then 1 lamp + 6,000 twice.
    expect(overview).toMatchObject({
      days: 30,
      orderCount: 3,
      cancelledCount: 1,
      salesMinor: 26_000 + 16_000 + 16_000,
      awaitingCollectionMinor: 16_000,
    });
  });

  it.each(['days=0', 'days=366', 'days=week'])('rejects %s', async (query) => {
    const setup = adminSetup();
    const response = await setup.call('get', `/admin/analytics/sales?${query}`, 'admin');

    expect(response.status).toBe(400);
    expect(setup.admin.calls).toEqual([]);
  });
});

describe('GET /api/v1/admin/dashboard', () => {
  it('fills every card for an owner', async () => {
    const setup = adminSetup();
    setup.products.lamp.stock = 2;
    const response = await setup.call('get', '/admin/dashboard', 'owner');

    expect(dashboardResponseSchema.parse(response.body)).toStrictEqual({
      orders: { pending: 1, confirmed: 0, processing: 0, shipped: 1, awaitingCollection: 1 },
      stock: {
        lowStockCount: 1,
        products: [
          { id: setup.products.lamp.id, name: 'Desk Lamp', sku: 'DESK-LAMP', stockQuantity: 2 },
        ],
      },
      moderation: { assignedToMe: 0, unassigned: 1, pending: 2 },
      sales: { days: 7, orderCount: 3, salesMinor: 58_000, awaitingCollectionMinor: 16_000 },
    });
  });

  it('shows staff their operational cards only', async () => {
    const setup = adminSetup();
    const response = await setup.call('get', '/admin/dashboard', 'staff');

    const dashboard = dashboardResponseSchema.parse(response.body);
    expect(dashboard.orders).not.toBeNull();
    expect(dashboard.stock).not.toBeNull();
    expect(dashboard.moderation).toBeNull();
    expect(dashboard.sales).toBeNull();
    expect(setup.admin.calls).not.toContain('salesOverview');
  });

  it('shows a moderator their own review count, nothing about orders or sales', async () => {
    const setup = adminSetup();
    const response = await setup.call('get', '/admin/dashboard', 'moderator');

    expect(dashboardResponseSchema.parse(response.body)).toMatchObject({
      orders: null,
      sales: null,
      moderation: { assignedToMe: 1, unassigned: null, pending: null },
    });
    expect(setup.admin.calls).not.toContain('orderCounts');
  });
});

describe('admin delivery charges', () => {
  it('lists every zone, set or not, and sets one', async () => {
    const setup = adminSetup();
    const before = await setup.call('get', '/admin/settings/delivery-charges', 'owner');
    const set = await setup.call('put', '/admin/settings/delivery-charges/outside_dhaka', 'owner', {
      amountMinor: 12_000,
    });
    const after = await setup.call('get', '/admin/settings/delivery-charges', 'owner');

    expect(deliveryChargeListResponseSchema.parse(before.body).charges).toEqual([
      { zone: 'inside_dhaka', amountMinor: null, updatedAt: null },
      { zone: 'outside_dhaka', amountMinor: null, updatedAt: null },
    ]);
    expect(deliveryChargeResponseSchema.parse(set.body).charge).toMatchObject({
      zone: 'outside_dhaka',
      amountMinor: 12_000,
    });
    expect(deliveryChargeListResponseSchema.parse(after.body).charges[1]?.amountMinor).toBe(12_000);
    expect(setup.admin.audit.at(-1)).toMatchObject({
      action: 'settings.delivery_charge_changed',
      actorId: setup.users.owner.id,
    });
  });

  it.each([
    ['an unknown zone', 'abroad', { amountMinor: 1 }],
    ['a negative charge', 'inside_dhaka', { amountMinor: -1 }],
    ['a charge above 100,000 taka', 'inside_dhaka', { amountMinor: 10_000_001 }],
    ['a fractional charge', 'inside_dhaka', { amountMinor: 10.5 }],
    ['an extra field', 'inside_dhaka', { amountMinor: 1, zone: 'outside_dhaka' }],
  ])('rejects %s', async (_label, zone, body) => {
    const setup = adminSetup();
    const response = await setup.call(
      'put',
      `/admin/settings/delivery-charges/${zone}`,
      'owner',
      body,
    );

    expect(response.status).toBe(400);
    expect(setup.admin.calls).toEqual([]);
  });

  it('maps a charge the database refuses (NZ412) to 400', async () => {
    const setup = adminSetup();
    setup.admin.nextFailure = { code: 'NZ412' };
    const response = await setup.call(
      'put',
      '/admin/settings/delivery-charges/inside_dhaka',
      'owner',
      {
        amountMinor: 1,
      },
    );

    expect(response.status).toBe(400);
    expect(errorOf(response.body).message).toBe('The charge must be from 0 to 100,000 taka');
  });

  it('keeps the audit log, analytics and settings apart from each other', async () => {
    const setup = adminSetup();
    setup.deny('owner', 'audit_logs.read');

    expect((await setup.call('get', '/admin/audit-log', 'owner')).status).toBe(403);
    expect((await setup.call('get', '/admin/analytics/sales', 'owner')).status).toBe(200);
    expect((await setup.call('get', '/admin/settings/delivery-charges', 'owner')).status).toBe(200);
    expect(
      (await setup.call('get', `/admin/audit-log?actorId=${randomUUID()}`, 'admin')).status,
    ).toBe(200);
  });
});
