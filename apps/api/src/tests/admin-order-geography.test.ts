import { orderGeographyResponseSchema, type OrderGeography } from '@nilzora/contracts';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  createPostgresAdminReportStore,
  createSupabaseAdminReportStore,
} from '../modules/admin/reports-store';
import type { SupabaseClients } from '../supabase/clients';
import { adminSetup } from './admin-helpers';

/*
 * GET /admin/analytics/orders/geography: the route's answers, the query validation, and
 * how both stores call the database function. The aggregation itself — the reconciliation
 * of mapped and unmapped orders, the division and district rows, the Dhaka day boundaries —
 * is computed by admin_order_geography in PostgreSQL and was verified against the real
 * schema, so these tests check the plumbing and the fake's mirror of the same rules.
 */

const QUERY = '/admin/analytics/orders/geography?from=2026-10-19&to=2026-10-25';

interface Recorded {
  sql: string;
  values: unknown[];
}

/** A pool whose one client records every statement and answers the function call. */
function recordingPool(answer: () => Promise<{ rows: unknown[] }>) {
  const statements: Recorded[] = [];
  const client = {
    query: (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (sql.startsWith('select public.')) return answer();
      return Promise.resolve({ rows: [] });
    },
    release: () => undefined,
  } as unknown as PoolClient;
  const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;
  return { pool, call: () => statements.find((entry) => entry.sql.startsWith('select public.')) };
}

/** Supabase clients whose user-scoped rpc records its call and answers `result`. */
function recordingClients(result: { data: unknown; error: unknown }) {
  const calls: { name: string; args: unknown; token: string }[] = [];
  const clients = {
    asUser: (token: string) => ({
      rpc: (name: string, args: unknown) => {
        calls.push({ name, args, token });
        return Promise.resolve(result);
      },
    }),
  } as unknown as SupabaseClients;
  return { clients, calls };
}

describe('GET /api/v1/admin/analytics/orders/geography', () => {
  it('answers the geography in the contract shape from one read', async () => {
    const setup = adminSetup();
    const response = await setup.call('get', QUERY, 'admin');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const { geography } = orderGeographyResponseSchema.parse(response.body);
    expect(geography.timezone).toBe('Asia/Dhaka');
    expect(geography.filters).toMatchObject({ from: '2026-10-19', to: '2026-10-25', metric: 'orders' });
    // The setup's three orders were all placed by the customer, in Dhaka, and none cancelled.
    expect(geography.summary).toMatchObject({
      totalOrders: 3,
      eligibleOrders: 3,
      cancelledOrders: 0,
      mappedOrders: 3,
      unmappedOrders: 0,
      revenueMinor: 58_000,
    });
    expect(geography.divisions).toHaveLength(8);
    expect(geography.statusBreakdown.reduce((sum, entry) => sum + entry.count, 0)).toBe(3);
    expect(geography.timeline).toHaveLength(7);
    // The same call fed every card: the route read the aggregate exactly once.
    expect(setup.admin.calls).toEqual(['orderGeography']);
  });

  it('sends counts and money only, never a name, phone or address', async () => {
    const setup = adminSetup();
    const response = await setup.call('get', QUERY, 'admin');

    expect(response.status).toBe(200);
    const keys = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value !== null && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          keys.add(key);
          walk(child);
        }
      }
    };
    walk(response.body);
    for (const forbidden of [
      'ship_recipient_name',
      'shipRecipientName',
      'ship_phone',
      'shipPhone',
      'ship_address_line',
      'shipAddressLine',
      'ship_area',
      'shipArea',
      'postalCode',
      'landmark',
      'userId',
      'email',
      'phone',
      'orderId',
      'orderNumber',
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it('reconciles mapped and unmapped against the demand population', async () => {
    const setup = adminSetup();
    const { geography } = orderGeographyResponseSchema.parse(
      (await setup.call('get', QUERY, 'admin')).body,
    );
    const mapped = geography.districts.reduce((sum, district) => sum + district.orderCount, 0);
    expect(mapped).toBe(geography.summary.mappedOrders);
    expect(geography.divisions.reduce((sum, division) => sum + division.orderCount, 0)).toBe(
      geography.summary.mappedOrders,
    );
    expect(geography.summary.mappedOrders + geography.summary.unmappedOrders).toBe(
      geography.summary.eligibleOrders,
    );
    expect(geography.timeline.reduce((sum, day) => sum + day.orderCount, 0)).toBe(
      geography.summary.eligibleOrders,
    );
  });

  it('reports an unrecognised district instead of guessing one', async () => {
    const setup = adminSetup();
    setup.orders.pending.shippingAddress.district = 'Nowhere Land';
    const { geography } = orderGeographyResponseSchema.parse(
      (await setup.call('get', QUERY, 'admin')).body,
    );

    expect(geography.summary.mappedOrders).toBe(2);
    expect(geography.summary.unmappedOrders).toBe(1);
    expect(geography.unmapped).toMatchObject({
      orderCount: 1,
      missingDistrictCount: 0,
      unknownDistrictCount: 1,
      values: [{ district: 'Nowhere Land', division: 'Dhaka', orderCount: 1 }],
    });
    // The unmapped order's revenue stays in the total but in no district row.
    expect(geography.summary.revenueMinor).toBe(58_000);
    expect(geography.districts.reduce((sum, district) => sum + district.revenueMinor, 0)).toBe(
      32_000,
    );
    expect(geography.unmapped.revenueMinor).toBe(26_000);
  });

  it('counts a cancelled order in the population but not in the demand', async () => {
    const setup = adminSetup();
    setup.orders.shipped.status = 'cancelled';
    const { geography } = orderGeographyResponseSchema.parse(
      (await setup.call('get', QUERY, 'admin')).body,
    );

    expect(geography.summary).toMatchObject({
      totalOrders: 3,
      eligibleOrders: 2,
      cancelledOrders: 1,
      mappedOrders: 2,
    });
    expect(geography.statusBreakdown).toContainEqual({ status: 'cancelled', count: 1 });
  });

  it('takes a district filter and fills in its division', async () => {
    const setup = adminSetup();
    const { geography } = orderGeographyResponseSchema.parse(
      (await setup.call('get', `${QUERY}&district=Dhaka`, 'admin')).body,
    );
    expect(geography.filters).toMatchObject({ district: 'Dhaka', division: 'Dhaka' });
    expect(geography.summary.totalOrders).toBe(3);
  });

  it('narrows to a division with no orders', async () => {
    const setup = adminSetup();
    const { geography } = orderGeographyResponseSchema.parse(
      (await setup.call('get', `${QUERY}&division=Sylhet`, 'admin')).body,
    );
    expect(geography.summary.totalOrders).toBe(0);
    expect(geography.summary.deliveredRate).toBeNull();
    expect(geography.summary.averageOrderMinor).toBe(0);
    // Every division is still listed, so the chart shows the empty ones honestly.
    expect(geography.divisions).toHaveLength(8);
    expect(geography.divisions.every((division) => division.orderCount === 0)).toBe(true);
  });

  it('never reaches the chart with a stale metric', async () => {
    const setup = adminSetup();
    const { geography } = orderGeographyResponseSchema.parse(
      (await setup.call('get', `${QUERY}&metric=revenue`, 'admin')).body,
    );
    expect(geography.filters.metric).toBe('revenue');
  });

  it.each([
    ['an unsupported metric', `${QUERY}&metric=clicks`],
    ['an unknown status', `${QUERY}&status=archived`],
    ['a reversed range', '/admin/analytics/orders/geography?from=2026-10-25&to=2026-10-19'],
    ['a range over a year', '/admin/analytics/orders/geography?from=2025-01-01&to=2026-10-19'],
  ])('refuses %s before the database is asked', async (_label, path) => {
    const setup = adminSetup();
    const response = await setup.call('get', path, 'admin');
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'validation_failed' } });
    // Nothing was read: the request never reached the store.
    expect(setup.admin.calls).toEqual([]);
  });

  it.each([
    ['an unknown district', `${QUERY}&district=Atlantis`],
    ['a district outside its division', `${QUERY}&division=Khulna&district=Dhaka`],
    ['an unknown division', `${QUERY}&division=Atlantis`],
  ])('refuses %s with 400 bad_request', async (_label, path) => {
    const setup = adminSetup();
    const response = await setup.call('get', path, 'admin');
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'bad_request' } });
  });

  it('answers 403 to an account without finance.read', async () => {
    const setup = adminSetup();
    const response = await setup.call('get', QUERY, 'staff');
    expect(response.status).toBe(403);
  });

  it('answers 401 without a session', async () => {
    const setup = adminSetup();
    const response = await setup.call('get', QUERY);
    expect(response.status).toBe(401);
  });
});

describe('the geography read through the database pool', () => {
  const payload: OrderGeography = {
    generatedAt: '2026-11-11T09:00:00.123456+00:00',
    timezone: 'Asia/Dhaka',
    filters: {
      from: '2026-10-19',
      to: '2026-10-25',
      division: null,
      district: null,
      status: null,
      metric: 'orders',
    },
    summary: {
      totalOrders: 3,
      eligibleOrders: 3,
      deliveredOrders: 1,
      pendingOrders: 1,
      processingOrders: 0,
      shippedOrders: 1,
      cancelledOrders: 0,
      returnedOrders: 0,
      revenueMinor: 58_000,
      averageOrderMinor: 19_333,
      deliveredRate: 0.3333,
      mappedOrders: 3,
      unmappedOrders: 0,
    },
    divisions: [
      {
        division: 'Dhaka',
        orderCount: 3,
        deliveredCount: 1,
        revenueMinor: 58_000,
        share: 1,
      },
    ],
    districts: [
      {
        district: 'Dhaka',
        division: 'Dhaka',
        orderCount: 3,
        deliveredCount: 1,
        revenueMinor: 58_000,
        share: 1,
      },
    ],
    timeline: [{ day: '2026-10-25', orderCount: 3, deliveredCount: 1, revenueMinor: 58_000 }],
    statusBreakdown: [
      { status: 'pending', count: 1 },
      { status: 'shipped', count: 1 },
      { status: 'delivered', count: 1 },
    ],
    unmapped: {
      orderCount: 0,
      revenueMinor: 0,
      missingDistrictCount: 0,
      unknownDistrictCount: 0,
      values: [],
    },
  };

  it('calls the function with typed parameters and ISO-normalises the timestamp', async () => {
    const pool = recordingPool(() => Promise.resolve({ rows: [{ geography: payload }] }));
    const store = createPostgresAdminReportStore(pool.pool);
    const result = await store.orderGeography('token', '3f1c9c5e-9a52-4a52-8f0a-2a3a6f0e1111', {
      from: '2026-10-19',
      to: '2026-10-25',
      metric: 'orders',
    });

    expect(pool.call()?.sql).toContain('public.admin_order_geography($1::date, $2::date');
    expect(pool.call()?.values).toEqual([
      '2026-10-19',
      '2026-10-25',
      null,
      null,
      null,
      'orders',
    ]);
    expect(result.generatedAt).toBe('2026-11-11T09:00:00.123Z');
    expect(result.summary.mappedOrders).toBe(3);
  });

  it('refuses an answer that does not match the contract', async () => {
    const pool = recordingPool(() =>
      Promise.resolve({ rows: [{ geography: { ...payload, summary: { totalOrders: 3 } } }] }),
    );
    const store = createPostgresAdminReportStore(pool.pool);
    await expect(
      store.orderGeography('token', '3f1c9c5e-9a52-4a52-8f0a-2a3a6f0e1111', {
        from: '2026-10-19',
        to: '2026-10-25',
        metric: 'orders',
      }),
    ).rejects.toThrow();
  });
});

describe('the geography read through Supabase', () => {
  it('calls the rpc with the caller token and the filters', async () => {
    const recorded = recordingClients({
      data: {
        generatedAt: '2026-11-11T09:00:00.123456+00:00',
        timezone: 'Asia/Dhaka',
        filters: {
          from: '2026-10-19',
          to: '2026-10-25',
          division: 'Dhaka',
          district: null,
          status: null,
          metric: 'delivered',
        },
        summary: {
          totalOrders: 0,
          eligibleOrders: 0,
          deliveredOrders: 0,
          pendingOrders: 0,
          processingOrders: 0,
          shippedOrders: 0,
          cancelledOrders: 0,
          returnedOrders: 0,
          revenueMinor: 0,
          averageOrderMinor: 0,
          deliveredRate: null,
          mappedOrders: 0,
          unmappedOrders: 0,
        },
        divisions: [],
        districts: [],
        timeline: [],
        statusBreakdown: [],
        unmapped: {
          orderCount: 0,
          revenueMinor: 0,
          missingDistrictCount: 0,
          unknownDistrictCount: 0,
          values: [],
        },
      },
      error: null,
    });
    const store = createSupabaseAdminReportStore(recorded.clients);
    const result = await store.orderGeography('the-token', 'user', {
      from: '2026-10-19',
      to: '2026-10-25',
      division: 'Dhaka',
      metric: 'delivered',
    });

    expect(recorded.calls[0]).toMatchObject({
      name: 'admin_order_geography',
      token: 'the-token',
      args: { p_from: '2026-10-19', p_to: '2026-10-25', p_division: 'Dhaka', p_metric: 'delivered' },
    });
    expect(result.filters.metric).toBe('delivered');
  });
});
