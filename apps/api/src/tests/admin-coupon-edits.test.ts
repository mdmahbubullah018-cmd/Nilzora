import { adminCouponResponseSchema } from '@nilzora/contracts';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { createPostgresAdminCouponStore } from '../modules/admin/coupons-store';
import { adminSetup, errorOf } from './admin-helpers';

/*
 * Editing coupons after creation: a redeemed coupon keeps its code and discount (the API
 * answers the database's NZ442 with a clear refusal), its other settings stay editable,
 * redemption records never change, and a coupon for chosen customers must name them and
 * reaches the database with its recipient list. The SQL side of each rule is proved in
 * supabase/tests/coupon_customers.test.sql.
 */

const CUSTOMER = '3f1c9c5e-9a52-4a52-8f0a-2a3a6f0e2222';
const coupon = { code: 'EID50', kind: 'fixed', value: 5000 } as const;

async function redeemedCoupon() {
  const setup = adminSetup();
  const created = await setup.call('post', '/admin/coupons', 'admin', coupon);
  const id = adminCouponResponseSchema.parse(created.body).coupon.id;
  setup.admin.recordRedemption(id, {
    id: 1,
    orderNumber: 'NZ100001',
    discountMinor: 5000,
    redeemedAt: '2026-11-09T08:00:00.000Z',
    customerId: CUSTOMER,
    customerName: 'Rahima Khatun',
    customerEmail: 'rahima@example.com',
  });
  return { setup, id };
}

describe('PUT /admin/coupons/:couponId after an order redeemed it', () => {
  it('refuses a new code or discount, and says why', async () => {
    const { setup, id } = await redeemedCoupon();

    for (const change of [{ code: 'EID60' }, { value: 9000 }, { kind: 'percent', value: 10 }]) {
      const response = await setup.call('put', `/admin/coupons/${id}`, 'admin', {
        ...coupon,
        ...change,
      });
      expect(response.status).toBe(409);
      expect(errorOf(response.body).code).toBe('in_use');
      expect(errorOf(response.body).message).toMatch(/code and discount can no longer change/);
    }
    expect(setup.admin.couponRows[0]?.code).toBe('EID50');
    expect(setup.admin.couponRows[0]?.value).toBe(5000);
  });

  it('still saves dates, limits and the switch, and never touches the redemption', async () => {
    const { setup, id } = await redeemedCoupon();

    const response = await setup.call('put', `/admin/coupons/${id}`, 'admin', {
      ...coupon,
      endsAt: '2026-12-31T18:00:00.000Z',
      totalLimit: 50,
      isActive: false,
    });

    expect(response.status).toBe(200);
    const saved = adminCouponResponseSchema.parse(response.body).coupon;
    expect(saved.endsAt).toBe('2026-12-31T18:00:00.000Z');
    expect(saved.isActive).toBe(false);
    expect(saved.redemptionCount).toBe(1);
    expect(saved.totalDiscountMinor).toBe(5000);
    expect(setup.admin.redemptionRows).toHaveLength(1);
    expect(setup.admin.redemptionRows[0]?.discountMinor).toBe(5000);
  });
});

describe('coupons for chosen customers', () => {
  it('refuses the audience without recipients before the database', async () => {
    const setup = adminSetup();
    const callsBefore = setup.admin.calls.length;

    const response = await setup.call('post', '/admin/coupons', 'admin', {
      ...coupon,
      targeting: { audience: 'selected_customers', customerIds: [] },
    });

    expect(response.status).toBe(400);
    expect(setup.admin.calls.slice(callsBefore)).not.toContain('coupons.save');
  });

  it('sends the recipient list with the targeting, in the same transaction as the save', async () => {
    const statements: { sql: string; parameters: unknown[] }[] = [];
    const client = {
      query: (sql: string, parameters: unknown[] = []) => {
        statements.push({ sql, parameters });
        return Promise.resolve({
          rows: sql.includes('admin_save_coupon(') ? [{ id: CUSTOMER }] : [],
        });
      },
      release: () => undefined,
    } as unknown as PoolClient;
    const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;

    await createPostgresAdminCouponStore(pool).save('token', CUSTOMER, null, {
      ...coupon,
      targeting: { audience: 'selected_customers', customerIds: [CUSTOMER] },
    });

    const sqls = statements.map((statement) => statement.sql);
    expect(sqls[0]).toBe('begin');
    expect(sqls.at(-1)).toBe('commit');
    const targeting = statements.find((statement) =>
      statement.sql.includes('admin_save_coupon_targeting'),
    );
    expect(targeting?.sql).toContain('$9::uuid[]');
    expect(targeting?.parameters[6]).toBe('selected_customers');
    expect(targeting?.parameters[8]).toEqual([CUSTOMER]);
  });

  it('clears the list for any other audience', async () => {
    const statements: { sql: string; parameters: unknown[] }[] = [];
    const client = {
      query: (sql: string, parameters: unknown[] = []) => {
        statements.push({ sql, parameters });
        return Promise.resolve({
          rows: sql.includes('admin_save_coupon(') ? [{ id: CUSTOMER }] : [],
        });
      },
      release: () => undefined,
    } as unknown as PoolClient;
    const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;

    await createPostgresAdminCouponStore(pool).save('token', CUSTOMER, null, {
      ...coupon,
      targeting: { audience: 'all', customerIds: [CUSTOMER] },
    });

    const targeting = statements.find((statement) =>
      statement.sql.includes('admin_save_coupon_targeting'),
    );
    expect(targeting?.parameters[8]).toEqual([]);
  });
});

describe('the redemption history', () => {
  it('reads timestamps the way the database writes them (+00:00)', async () => {
    const client = {
      query: (sql: string) =>
        Promise.resolve({
          rows: sql.includes('admin_coupon_redemptions')
            ? [
                {
                  payload: {
                    redemptions: [
                      {
                        id: 1,
                        orderNumber: 'NZ100001',
                        discountMinor: 5000,
                        redeemedAt: '2026-11-09T08:00:00.123456+00:00',
                        customerId: CUSTOMER,
                        customerName: 'Rahima Khatun',
                        customerEmail: 'rahima@example.com',
                      },
                    ],
                    page: 1,
                    pageSize: 25,
                    total: 1,
                    totalPages: 1,
                  },
                },
              ]
            : [],
        }),
      release: () => undefined,
    } as unknown as PoolClient;
    const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;

    const { redemptions, total } = await createPostgresAdminCouponStore(pool).redemptions(
      'token',
      CUSTOMER,
      CUSTOMER,
      { limit: 25, offset: 0 },
    );

    expect(total).toBe(1);
    expect(redemptions[0]?.redeemedAt).toBe('2026-11-09T08:00:00.123Z');
    expect(redemptions[0]?.discountMinor).toBe(5000);
  });
});
