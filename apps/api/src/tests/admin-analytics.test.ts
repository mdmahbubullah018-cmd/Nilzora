import {
  analyticsOverviewResponseSchema,
  analyticsOverviewSchema,
  salesTargetResponseSchema,
  type AnalyticsOverview,
} from '@nilzora/contracts';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { StoreUnavailableError } from '../modules/commerce/errors';
import { AdminRefusalError } from '../modules/admin/errors';
import {
  createPostgresAdminReportStore,
  createSupabaseAdminReportStore,
} from '../modules/admin/reports-store';
import type { SupabaseClients } from '../supabase/clients';
import { adminSetup, errorOf } from './admin-helpers';

/*
 * GET /admin/analytics/overview and PUT /admin/settings/sales-target: request
 * validation, the routes' answers, and how both stores call the database functions
 * and parse what they return. The figures themselves are computed by
 * admin_analytics_overview and checked by supabase/tests/admin_analytics.test.sql.
 */

const USER = '3f1c9c5e-9a52-4a52-8f0a-2a3a6f0e1111';
const CUSTOMER = '9b7d2d3a-4c1e-4f55-9d2b-5e8d1c0a2222';

const totals = {
  orderCount: 4,
  cancelledCount: 1,
  revenueMinor: 166_000,
  averageOrderMinor: 41_500,
  newCustomers: 2,
  collectedMinor: 26_000,
  deliveredCount: 2,
  returnedOrderCount: 1,
};

/** What the database function returns for a two-day range with comparison. */
const payload: AnalyticsOverview = {
  range: { from: '2031-03-03', to: '2031-03-04', days: 2 },
  previousRange: { from: '2031-03-01', to: '2031-03-02' },
  totals,
  previousTotals: { ...totals, orderCount: 1, revenueMinor: 16_000, averageOrderMinor: 16_000 },
  daily: [
    {
      day: '2031-03-03',
      revenueMinor: 26_000,
      orderCount: 1,
      newCustomers: 1,
      byStatus: { delivered: 1 },
    },
    { day: '2031-03-04', revenueMinor: 0, orderCount: 0, newCustomers: 0, byStatus: {} },
  ],
  previousDaily: [
    { day: '2031-03-01', revenueMinor: 0, orderCount: 0 },
    { day: '2031-03-02', revenueMinor: 16_000, orderCount: 1 },
  ],
  snapshot: { codPendingMinor: 62_000, codPendingCount: 1, lowStockCount: 2, outOfStockCount: 1 },
  statusSplit: { delivered: 1, cancelled: 1 },
  paymentSplit: { pendingMinor: 0, pendingCount: 0, collectedMinor: 26_000, collectedCount: 1 },
  deliveryZones: [
    { zone: 'inside_dhaka', orderCount: 1, revenueMinor: 26_000 },
    { zone: 'outside_dhaka', orderCount: 0, revenueMinor: 0 },
  ],
  salesByCategory: [
    {
      categoryId: 'ca000000-0000-4000-8000-0000000000f1',
      categoryName: 'Lamps',
      unitsSold: 2,
      revenueMinor: 20_000,
    },
  ],
  topProducts: [
    {
      productId: '0d000000-0000-4000-8000-0000000000f1',
      productName: 'Desk Lamp',
      unitsSold: 2,
      revenueMinor: 20_000,
    },
  ],
  heatmap: [{ weekday: 1, hour: 0, orderCount: 1 }],
  funnel: { carts: 3, checkouts: 2, orders: 2 },
  rates: { fulfillment: 1, returns: 0.5 },
  monthTarget: { month: '2026-11', targetMinor: 5_000_000, revenueMinor: 12_345 },
  topCustomers: [
    {
      customerId: CUSTOMER,
      name: 'Rahima Khatun',
      email: 'rahima@example.com',
      orderCount: 1,
      revenueMinor: 26_000,
      daily: [26_000, 0],
    },
  ],
};

interface Recorded {
  sql: string;
  values: unknown[];
}

/** A pool whose one client records every statement and answers the function call. */
function recordingPool(answer: (sql: string) => Promise<{ rows: unknown[] }>) {
  const statements: Recorded[] = [];
  const client = {
    query: (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (sql.startsWith('select public.')) return answer(sql);
      return Promise.resolve({ rows: [] });
    },
    release: () => undefined,
  } as unknown as PoolClient;
  const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;
  const call = () => statements.find((entry) => entry.sql.startsWith('select public.'));
  return { pool, statements, call };
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

const RANGE = { from: '2031-03-03', to: '2031-03-04', compare: true };

describe('GET /api/v1/admin/analytics/overview', () => {
  it('answers the range in the contract shape, comparing with the period before', async () => {
    const setup = adminSetup();
    const response = await setup.call(
      'get',
      '/admin/analytics/overview?from=2026-10-19&to=2026-10-25',
      'admin',
    );

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const { overview } = analyticsOverviewResponseSchema.parse(response.body);
    expect(overview.range).toEqual({ from: '2026-10-19', to: '2026-10-25', days: 7 });
    expect(overview.previousRange).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    // The setup's three open orders: 2 lamps + delivery, then 1 lamp + delivery twice.
    expect(overview.totals).toMatchObject({ orderCount: 3, revenueMinor: 58_000 });
    expect(overview.previousTotals).toMatchObject({ orderCount: 0, revenueMinor: 0 });
    expect(overview.daily).toHaveLength(7);
    expect(overview.previousDaily).toHaveLength(7);
    expect(overview.topCustomers?.[0]).toMatchObject({
      customerId: setup.users.customer.id,
      revenueMinor: 58_000,
      daily: [0, 0, 0, 0, 0, 0, 58_000],
    });
    expect(setup.admin.calls).toEqual(['analyticsOverview']);
  });

  it('leaves the previous period out when compare=false', async () => {
    const setup = adminSetup();
    const response = await setup.call(
      'get',
      '/admin/analytics/overview?from=2026-10-19&to=2026-10-25&compare=false',
      'admin',
    );

    const { overview } = analyticsOverviewResponseSchema.parse(response.body);
    expect(overview.previousRange).toBeNull();
    expect(overview.previousTotals).toBeNull();
    expect(overview.previousDaily).toEqual([]);
  });

  it('accepts a whole leap year', async () => {
    const setup = adminSetup();
    const response = await setup.call(
      'get',
      '/admin/analytics/overview?from=2028-01-01&to=2028-12-31',
      'admin',
    );

    expect(response.status).toBe(200);
    expect(analyticsOverviewResponseSchema.parse(response.body).overview.range.days).toBe(366);
  });

  it('leaves top customers out for an account that may not read customers', async () => {
    const setup = adminSetup();
    setup.deny('admin', 'customers.read');
    const response = await setup.call(
      'get',
      '/admin/analytics/overview?from=2026-10-19&to=2026-10-25',
      'admin',
    );

    expect(response.status).toBe(200);
    const { overview } = analyticsOverviewResponseSchema.parse(response.body);
    expect(overview.topCustomers).toBeNull();
    expect(overview.totals.revenueMinor).toBe(58_000);
  });

  it.each([
    ['no range at all', '', ['from', 'to']],
    ['an impossible date', 'from=2026-02-30&to=2026-03-01', ['from']],
    ['a date with a time', 'from=2026-10-01T00:00:00Z&to=2026-10-02', ['from']],
    ['a range ending before it starts', 'from=2026-10-30&to=2026-10-01', ['to']],
    ['367 days', 'from=2025-01-01&to=2026-01-02', ['from']],
    [
      'a compare flag that is not true or false',
      'from=2026-10-01&to=2026-10-02&compare=yes',
      ['compare'],
    ],
  ])('rejects %s with the failing fields, before the database', async (_label, query, paths) => {
    const setup = adminSetup();
    const response = await setup.call('get', `/admin/analytics/overview?${query}`, 'admin');

    expect(response.status).toBe(400);
    const error = errorOf(response.body);
    expect(error.code).toBe('validation_failed');
    const issues = (error.details as { issues: { location: string; path: string }[] }).issues;
    // A malformed date may also fail the range-length check on the same field.
    expect([...new Set(issues.map((issue) => issue.path))].sort()).toEqual([...paths].sort());
    expect(issues.every((issue) => issue.location === 'query')).toBe(true);
    expect(setup.admin.calls).toEqual([]);
  });

  it('answers a range the database refuses (NZ412) with 400', async () => {
    const setup = adminSetup();
    setup.admin.nextFailure = { code: 'NZ412' };
    const response = await setup.call(
      'get',
      '/admin/analytics/overview?from=2026-10-19&to=2026-10-25',
      'admin',
    );

    expect(response.status).toBe(400);
    expect(errorOf(response.body)).toMatchObject({
      code: 'bad_request',
      message: 'Choose a range of 1 to 366 days',
    });
  });

  it('answers 503 without database detail when the database fails', async () => {
    const setup = adminSetup();
    setup.admin.nextFailure = { code: 'XX000' };
    const response = await setup.call(
      'get',
      '/admin/analytics/overview?from=2026-10-19&to=2026-10-25',
      'admin',
    );

    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toMatch(
      /internal detail|permissions_of|db\.internal/,
    );
    expect(JSON.stringify(response.body)).not.toMatch(/at .*\.ts:\d+/);
  });
});

describe('PUT /api/v1/admin/settings/sales-target', () => {
  it('sets and clears the target, auditing each change', async () => {
    const setup = adminSetup();
    const set = await setup.call('put', '/admin/settings/sales-target', 'owner', {
      targetMinor: 5_000_000,
    });
    const cleared = await setup.call('put', '/admin/settings/sales-target', 'owner', {
      targetMinor: null,
    });

    expect(set.status).toBe(200);
    expect(set.headers['cache-control']).toBe('no-store');
    expect(salesTargetResponseSchema.parse(set.body).target.targetMinor).toBe(5_000_000);
    expect(salesTargetResponseSchema.parse(cleared.body).target.targetMinor).toBeNull();
    expect(setup.admin.audit.slice(-2)).toMatchObject([
      { action: 'settings.sales_target_changed', actorId: setup.users.owner.id },
      { action: 'settings.sales_target_changed', details: { before: 5_000_000, after: null } },
    ]);
  });

  it('shows the target in the overview', async () => {
    const setup = adminSetup();
    await setup.call('put', '/admin/settings/sales-target', 'owner', { targetMinor: 7_500_000 });
    const response = await setup.call(
      'get',
      '/admin/analytics/overview?from=2026-10-19&to=2026-10-25',
      'owner',
    );

    expect(
      analyticsOverviewResponseSchema.parse(response.body).overview.monthTarget.targetMinor,
    ).toBe(7_500_000);
  });

  it.each([
    ['a negative target', { targetMinor: -1 }],
    ['a target above 1,000,000,000 taka', { targetMinor: 100_000_000_001 }],
    ['a fractional target', { targetMinor: 10.5 }],
    ['a target given as text', { targetMinor: '5000' }],
    ['no target field', {}],
    ['an extra field', { targetMinor: 1, month: '2026-11' }],
  ])('rejects %s before the database', async (_label, body) => {
    const setup = adminSetup();
    const response = await setup.call('put', '/admin/settings/sales-target', 'owner', body);

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(setup.admin.calls).toEqual([]);
  });

  it('maps a target the database refuses (NZ412) to 400', async () => {
    const setup = adminSetup();
    setup.admin.nextFailure = { code: 'NZ412' };
    const response = await setup.call('put', '/admin/settings/sales-target', 'owner', {
      targetMinor: 1,
    });

    expect(response.status).toBe(400);
    expect(errorOf(response.body).message).toBe('The target must be from 0 to 1,000,000,000 taka');
  });
});

describe('the analytics overview through the database pool', () => {
  it('calls the function as the caller with typed parameters and parses the answer', async () => {
    const { pool, statements, call } = recordingPool(() =>
      Promise.resolve({ rows: [{ overview: payload }] }),
    );
    const store = createPostgresAdminReportStore(pool);

    const overview = await store.analyticsOverview('token', USER, RANGE);

    expect(overview).toEqual(analyticsOverviewSchema.parse(payload));
    expect(call()).toEqual({
      sql: 'select public.admin_analytics_overview($1::date, $2::date, $3::boolean) as overview',
      values: ['2031-03-03', '2031-03-04', true],
    });
    const assumed = statements.find((entry) => entry.sql.includes("set_config('role'"));
    expect(assumed?.values[0]).toBe('authenticated');
    expect(JSON.parse(String(assumed?.values[1]))).toMatchObject({ sub: USER });
    expect(statements.at(-1)?.sql).toBe('commit');
  });

  it('passes compare=false through', async () => {
    const single = { ...payload, previousRange: null, previousTotals: null, previousDaily: [] };
    const { pool, call } = recordingPool(() => Promise.resolve({ rows: [{ overview: single }] }));

    const overview = await createPostgresAdminReportStore(pool).analyticsOverview('token', USER, {
      ...RANGE,
      compare: false,
    });

    expect(call()?.values[2]).toBe(false);
    expect(overview.previousTotals).toBeNull();
  });

  it('refuses an answer that does not match the contract (503, never passed on)', async () => {
    const broken = { ...payload, rates: { fulfillment: 1.5, returns: null } };
    const { pool, statements } = recordingPool(() =>
      Promise.resolve({ rows: [{ overview: broken }] }),
    );

    await expect(
      createPostgresAdminReportStore(pool).analyticsOverview('token', USER, RANGE),
    ).rejects.toBeInstanceOf(StoreUnavailableError);
    expect(statements.at(-1)?.sql).toBe('rollback');
  });

  it.each([
    ['NZ403', 'missing_permission'],
    ['NZ412', 'invalid_input'],
  ])('maps %s to the %s refusal', async (code, refusal) => {
    const { pool } = recordingPool(() =>
      Promise.reject(Object.assign(new Error('internal detail'), { code })),
    );

    const failure = await createPostgresAdminReportStore(pool)
      .analyticsOverview('token', USER, RANGE)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AdminRefusalError);
    expect((failure as AdminRefusalError).refusal).toBe(refusal);
  });

  it('sets the target and returns an ISO timestamp', async () => {
    const { pool, call } = recordingPool(() =>
      Promise.resolve({
        rows: [
          { target: { targetMinor: 5_000_000, updatedAt: '2026-11-02T10:00:00.123456+00:00' } },
        ],
      }),
    );

    const target = await createPostgresAdminReportStore(pool).setSalesTarget(
      'token',
      USER,
      5_000_000,
    );

    expect(target).toEqual({ targetMinor: 5_000_000, updatedAt: '2026-11-02T10:00:00.123Z' });
    expect(call()).toEqual({
      sql: 'select public.admin_set_sales_target($1::bigint) as target',
      values: [5_000_000],
    });
  });

  it('clears the target with null', async () => {
    const { pool, call } = recordingPool(() =>
      Promise.resolve({
        rows: [{ target: { targetMinor: null, updatedAt: '2026-11-02T10:00:00+00:00' } }],
      }),
    );

    const target = await createPostgresAdminReportStore(pool).setSalesTarget('token', USER, null);

    expect(target.targetMinor).toBeNull();
    expect(call()?.values).toEqual([null]);
  });
});

describe('the analytics overview through Supabase', () => {
  it('calls the rpc with the caller token and parses the answer', async () => {
    const { clients, calls } = recordingClients({ data: payload, error: null });

    const overview = await createSupabaseAdminReportStore(clients).analyticsOverview(
      'caller-token',
      USER,
      RANGE,
    );

    expect(overview).toEqual(analyticsOverviewSchema.parse(payload));
    expect(calls).toEqual([
      {
        name: 'admin_analytics_overview',
        args: { p_from: '2031-03-03', p_to: '2031-03-04', p_compare: true },
        token: 'caller-token',
      },
    ]);
  });

  it('refuses an answer that does not match the contract', async () => {
    const { clients } = recordingClients({
      data: { ...payload, heatmap: [{ weekday: 0, hour: 25, orderCount: 0 }] },
      error: null,
    });

    await expect(
      createSupabaseAdminReportStore(clients).analyticsOverview('caller-token', USER, RANGE),
    ).rejects.toBeInstanceOf(StoreUnavailableError);
  });

  it('maps a permission refusal', async () => {
    const { clients } = recordingClients({
      data: null,
      error: { code: 'NZ403', message: 'missing permission finance.read' },
    });

    await expect(
      createSupabaseAdminReportStore(clients).analyticsOverview('caller-token', USER, RANGE),
    ).rejects.toMatchObject({ refusal: 'missing_permission' });
  });

  it('sets the target through the rpc', async () => {
    const { clients, calls } = recordingClients({
      data: { targetMinor: 0, updatedAt: '2026-11-02T10:00:00+00:00' },
      error: null,
    });

    const target = await createSupabaseAdminReportStore(clients).setSalesTarget(
      'caller-token',
      USER,
      0,
    );

    expect(target).toEqual({ targetMinor: 0, updatedAt: '2026-11-02T10:00:00.000Z' });
    expect(calls[0]).toMatchObject({ name: 'admin_set_sales_target', args: { p_target_minor: 0 } });
  });
});
