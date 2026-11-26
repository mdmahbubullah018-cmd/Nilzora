import {
  adminCouponResponseSchema,
  adminRolesResponseSchema,
  auditLogResponseSchema,
  PERMISSIONS,
  storeSettingsResponseSchema,
} from '@nilzora/contracts';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  createPostgresAdminAccountStore,
  createSupabaseAdminAccountStore,
} from '../modules/admin/accounts-store';
import {
  createPostgresAdminReportStore,
  createSupabaseAdminReportStore,
} from '../modules/admin/reports-store';
import type { SupabaseClients } from '../supabase/clients';
import { adminSetup, errorOf, type AdminSetup } from './admin-helpers';

/*
 * Batch 6: the roles matrix, the audit-log filters, the store-settings route and the
 * coupons.create rule. The permission matrix per route is in admin-access.test.ts; the SQL
 * rules are in supabase/tests/roles_audit_settings.test.sql.
 */

const USER = '3f1c9c5e-9a52-4a52-8f0a-2a3a6f0e1111';

describe('GET /api/v1/admin/roles', () => {
  it('lists the five roles, the owner with every permission and customers with none', async () => {
    const setup = adminSetup();
    const response = await setup.call('get', '/admin/roles', 'admin');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const { roles } = adminRolesResponseSchema.parse(response.body);
    expect(roles.map((entry) => entry.role)).toEqual([
      'super_admin',
      'admin',
      'staff',
      'moderator',
      'customer',
    ]);
    expect(roles[0]?.permissions).toEqual([...PERMISSIONS].sort());
    expect(roles[1]?.permissions).not.toContain('settings.manage');
    expect(roles[4]?.permissions).toEqual([]);
    for (const entry of roles) expect(entry.permissions).toEqual([...entry.permissions].sort());
  });

  it('is open to a member who may only manage permissions, and closed to the rest', async () => {
    const setup = adminSetup();
    setup.users.staff.overrides.set('staff.permissions.manage', 'grant');

    expect((await setup.call('get', '/admin/roles', 'staff')).status).toBe(200);
    expect((await setup.call('get', '/admin/roles', 'moderator')).status).toBe(403);
    expect((await setup.call('get', '/admin/roles', 'customer')).status).toBe(403);
    expect((await setup.call('get', '/admin/roles')).status).toBe(401);
  });
});

describe('the roles store', () => {
  const answer = [
    { role: 'super_admin', permissions: ['orders.read', 'future.permission'] },
    { role: 'customer', permissions: [] },
  ];

  it('leaves out permission names this API does not know yet, over a pool and over Supabase', async () => {
    const statements: string[] = [];
    const client = {
      query: (sql: string) => {
        statements.push(sql);
        return Promise.resolve({
          rows: sql.startsWith('select public.') ? [{ value: answer }] : [],
        });
      },
      release: () => undefined,
    } as unknown as PoolClient;
    const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;
    const viaPool = await createPostgresAdminAccountStore(pool).listRoles('token', USER);

    const calls: string[] = [];
    const clients = {
      asUser: () => ({
        rpc: (name: string) => {
          calls.push(name);
          return Promise.resolve({ data: answer, error: null });
        },
      }),
    } as unknown as SupabaseClients;
    const viaSupabase = await createSupabaseAdminAccountStore(clients).listRoles('token', USER);

    expect(statements).toContain('select public.admin_list_roles() as value');
    expect(calls).toEqual(['admin_list_roles']);
    for (const roles of [viaPool, viaSupabase]) {
      expect(roles[0]).toEqual({ role: 'super_admin', permissions: ['orders.read'] });
    }
  });
});

describe('GET /api/v1/admin/audit-log filters', () => {
  function withEntries() {
    const setup = adminSetup();
    const entry = (id: number, action: string, createdAt: string, targetId: string) =>
      setup.admin.audit.push({
        id,
        actorId: setup.users.admin.id,
        actor: { id: setup.users.admin.id, name: 'Arif Admin', email: 'admin@example.com' },
        action,
        targetType: 'order',
        targetId,
        details: {},
        createdAt,
      });
    // 18:30 UTC on 1 October is 00:30 on 2 October in Dhaka.
    entry(1, 'order.status_changed', '2026-10-01T18:30:00.000Z', 'NZ100001');
    entry(2, 'order.payment_collected', '2026-10-02T05:00:00.000Z', 'NZ100002');
    entry(3, 'inventory.adjusted', '2026-10-05T05:00:00.000Z', 'lamp');
    return setup;
  }
  const actions = async (setup: AdminSetup, query: string) => {
    const response = await setup.call('get', `/admin/audit-log${query}`, 'admin');
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return auditLogResponseSchema.parse(response.body).entries.map((item) => item.action);
  };

  it('still answers with no filter, and with the old action and actor filters', async () => {
    const setup = withEntries();

    expect(await actions(setup, '')).toHaveLength(3);
    expect(await actions(setup, '?action=order.')).toEqual([
      'order.payment_collected',
      'order.status_changed',
    ]);
    expect(await actions(setup, `?actorId=${setup.users.admin.id}`)).toHaveLength(3);
  });

  it('takes a Dhaka day range, inclusive, with either bound alone', async () => {
    const setup = withEntries();

    expect(await actions(setup, '?from=2026-10-02&to=2026-10-02')).toEqual([
      'order.payment_collected',
      'order.status_changed',
    ]);
    expect(await actions(setup, '?from=2026-10-01&to=2026-10-01')).toEqual([]);
    expect(await actions(setup, '?from=2026-10-03')).toEqual(['inventory.adjusted']);
    expect(await actions(setup, '?to=2026-10-02')).toHaveLength(2);
  });

  it('searches the action, the target and the actor, and combines filters', async () => {
    const setup = withEntries();

    expect(await actions(setup, '?q=NZ100002')).toEqual(['order.payment_collected']);
    expect(await actions(setup, '?q=LAMP')).toEqual(['inventory.adjusted']);
    expect(await actions(setup, '?q=arif')).toHaveLength(3);
    expect(await actions(setup, '?q=order&from=2026-10-02&to=2026-10-31')).toHaveLength(2);
    expect(await actions(setup, '?q=order&action=inventory.')).toEqual([]);
  });

  it.each([
    ['a range ending before it starts', 'from=2026-10-31&to=2026-10-01', 'to'],
    ['a range over 366 days', 'from=2025-01-01&to=2026-01-02', 'from'],
    ['an impossible date', 'from=2026-02-30', 'from'],
    ['a date in another form', 'to=01-10-2026', 'to'],
    ['an empty search', 'q=', 'q'],
    ['a search over 100 characters', `q=${'a'.repeat(101)}`, 'q'],
  ])('rejects %s before the database', async (_label, query, field) => {
    const setup = adminSetup();
    const response = await setup.call('get', `/admin/audit-log?${query}`, 'admin');

    expect(response.status).toBe(400);
    const issues = (errorOf(response.body).details as { issues: { path: string }[] }).issues;
    expect(issues.map((issue) => issue.path)).toContain(field);
    expect(setup.admin.calls).toEqual([]);
  });

  it('accepts a whole leap year', async () => {
    const setup = adminSetup();

    expect(
      (await setup.call('get', '/admin/audit-log?from=2028-01-01&to=2028-12-31', 'admin')).status,
    ).toBe(200);
  });
});

describe('the audit-log store', () => {
  const row = {
    id: '7',
    actor_id: USER,
    actor_email: 'admin@example.com',
    actor_name: 'Arif Admin',
    action: 'order.status_changed',
    target_type: 'order',
    target_id: 'NZ100001',
    details: {},
    created_at: '2026-10-02T05:00:00.000+00:00',
    total_count: '1',
  };
  const filters = { actionPrefix: 'order.', from: '2026-10-01', to: '2026-10-31', q: '100%' };

  it('calls the search function with every filter over a pool, nulls for what is left out', async () => {
    const statements: { sql: string; values: unknown[] }[] = [];
    const client = {
      query: (sql: string, values: unknown[] = []) => {
        statements.push({ sql, values });
        return Promise.resolve({ rows: sql.includes('admin_audit_log_search') ? [row] : [] });
      },
      release: () => undefined,
    } as unknown as PoolClient;
    const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;
    const store = createPostgresAdminReportStore(pool);

    const page = await store.auditLog('token', USER, filters, { limit: 25, offset: 0 });
    await store.auditLog('token', USER, {}, { limit: 25, offset: 0 });

    const calls = statements.filter((entry) => entry.sql.includes('admin_audit_log_search'));
    expect(calls[0]).toEqual({
      sql: 'select * from public.admin_audit_log_search($1, $2::uuid, $3::date, $4::date, $5, $6, $7)',
      values: ['order.', null, '2026-10-01', '2026-10-31', '100%', 25, 0],
    });
    expect(calls[1]?.values).toEqual([null, null, null, null, null, 25, 0]);
    expect(page.total).toBe(1);
    expect(page.entries[0]).toMatchObject({ id: 7, createdAt: '2026-10-02T05:00:00.000Z' });
  });

  it('calls the same function through Supabase', async () => {
    const calls: { name: string; args: unknown }[] = [];
    const clients = {
      asUser: () => ({
        rpc: (name: string, args: unknown) => {
          calls.push({ name, args });
          return Promise.resolve({ data: [{ ...row, id: 7 }], error: null });
        },
      }),
    } as unknown as SupabaseClients;

    await createSupabaseAdminReportStore(clients).auditLog('token', USER, filters, {
      limit: 25,
      offset: 50,
    });

    expect(calls).toEqual([
      {
        name: 'admin_audit_log_search',
        args: {
          p_action_prefix: 'order.',
          p_actor: null,
          p_from: '2026-10-01',
          p_to: '2026-10-31',
          p_q: '100%',
          p_limit: 25,
          p_offset: 50,
        },
      },
    ]);
  });
});

describe('/api/v1/admin/settings/store', () => {
  it('reads every setting, including the sales target', async () => {
    const setup = adminSetup();
    await setup.call('put', '/admin/settings/sales-target', 'owner', { targetMinor: 5_000_000 });
    const response = await setup.call('get', '/admin/settings/store', 'owner');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(storeSettingsResponseSchema.parse(response.body).settings).toMatchObject({
      returnWindowDays: 7,
      cartInactivityMinutes: 120,
      repeatOrderThreshold: 2,
      highSpendThresholdMinor: 500_000,
      inactiveDays: 60,
      monthlySalesTargetMinor: 5_000_000,
    });
  });

  it('saves the two settings and any thresholds given, keeping the thresholds left out', async () => {
    const setup = adminSetup();
    const first = await setup.call('put', '/admin/settings/store', 'owner', {
      returnWindowDays: 14,
      cartInactivityMinutes: 300,
      repeatOrderThreshold: 4,
      highSpendThresholdMinor: 800_000,
      inactiveDays: 90,
    });
    const second = await setup.call('put', '/admin/settings/store', 'owner', {
      returnWindowDays: 10,
      cartInactivityMinutes: 240,
    });

    expect(storeSettingsResponseSchema.parse(first.body).settings).toMatchObject({
      returnWindowDays: 14,
      repeatOrderThreshold: 4,
      inactiveDays: 90,
    });
    expect(storeSettingsResponseSchema.parse(second.body).settings).toMatchObject({
      returnWindowDays: 10,
      cartInactivityMinutes: 240,
      repeatOrderThreshold: 4,
      highSpendThresholdMinor: 800_000,
      inactiveDays: 90,
    });
    expect(setup.admin.audit.map((entry) => entry.action)).toEqual([
      'settings.saved',
      'settings.insight_thresholds_saved',
      'settings.saved',
    ]);
  });

  it.each([
    ['a return window of 0 days', { returnWindowDays: 0, cartInactivityMinutes: 120 }],
    ['a return window of 91 days', { returnWindowDays: 91, cartInactivityMinutes: 120 }],
    ['cart inactivity under 15 minutes', { returnWindowDays: 7, cartInactivityMinutes: 14 }],
    [
      'one repeat order',
      { returnWindowDays: 7, cartInactivityMinutes: 120, repeatOrderThreshold: 1 },
    ],
    [
      '21 repeat orders',
      { returnWindowDays: 7, cartInactivityMinutes: 120, repeatOrderThreshold: 21 },
    ],
    [
      'a free high-spend threshold',
      { returnWindowDays: 7, cartInactivityMinutes: 120, highSpendThresholdMinor: 0 },
    ],
    ['6 inactive days', { returnWindowDays: 7, cartInactivityMinutes: 120, inactiveDays: 6 }],
    ['a fractional value', { returnWindowDays: 7.5, cartInactivityMinutes: 120 }],
    ['a missing setting', { returnWindowDays: 7 }],
    [
      'the sales target',
      { returnWindowDays: 7, cartInactivityMinutes: 120, monthlySalesTargetMinor: 1 },
    ],
  ])('rejects %s before the database', async (_label, body) => {
    const setup = adminSetup();
    const response = await setup.call('put', '/admin/settings/store', 'owner', body);

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(setup.admin.calls).toEqual([]);
  });

  it('keeps everything as it was when the database refuses a value', async () => {
    const setup = adminSetup();
    setup.admin.settings = { ...setup.admin.settings, returnWindowDays: 21 };
    setup.admin.nextFailure = { code: 'NZ412' };
    const response = await setup.call('put', '/admin/settings/store', 'owner', {
      returnWindowDays: 5,
      cartInactivityMinutes: 120,
    });

    expect(response.status).toBe(400);
    expect(errorOf(response.body).message).toBe(
      'Check the settings and thresholds: nothing was saved',
    );
    expect(setup.admin.settings.returnWindowDays).toBe(21);
  });
});

describe('the store-settings store', () => {
  const stored = {
    returnWindowDays: 7,
    cartInactivityMinutes: 120,
    repeatOrderThreshold: 2,
    highSpendThresholdMinor: 500000,
    inactiveDays: 60,
    monthlySalesTargetMinor: null,
    updatedAt: '2026-11-08T08:00:00.123456+00:00',
  };
  const input = { returnWindowDays: 10, cartInactivityMinutes: 200, inactiveDays: 30 };

  it('saves all five values in one call over a pool, passing null for a threshold left out', async () => {
    const statements: { sql: string; values: unknown[] }[] = [];
    const client = {
      query: (sql: string, values: unknown[] = []) => {
        statements.push({ sql, values });
        return Promise.resolve({
          rows: sql.includes('admin_save_store') ? [{ value: stored }] : [],
        });
      },
      release: () => undefined,
    } as unknown as PoolClient;
    const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;

    const saved = await createPostgresAdminReportStore(pool).saveStoreSettings(
      'token',
      USER,
      input,
    );

    const call = statements.find((entry) => entry.sql.includes('admin_save_store_settings'));
    // The cash on delivery switch travels too: null here means "leave it as it is", so saving
    // the return window cannot turn cash orders back on behind the owner's back.
    expect(call?.values).toEqual([10, 200, null, null, 30, null]);
    expect(call?.sql).toContain(
      '$1::integer, $2::integer, $3::integer, $4::bigint, $5::integer, $6::boolean',
    );
    expect(saved.updatedAt).toBe('2026-11-08T08:00:00.123Z');
  });

  it('passes the cash on delivery switch through when it is sent', async () => {
    const statements: { sql: string; values: unknown[] }[] = [];
    const client = {
      query: (sql: string, values: unknown[] = []) => {
        statements.push({ sql, values });
        return Promise.resolve({
          rows: sql.includes('admin_save_store') ? [{ value: stored }] : [],
        });
      },
      release: () => undefined,
    } as unknown as PoolClient;
    const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;

    await createPostgresAdminReportStore(pool).saveStoreSettings('token', USER, {
      ...input,
      codEnabled: false,
    });

    const call = statements.find((entry) => entry.sql.includes('admin_save_store_settings'));
    expect(call?.values?.at(-1)).toBe(false);
  });

  it('sends null, false and true as the switch, never a silent default', async () => {
    const sent: unknown[] = [];
    const client = {
      query: (sql: string, values: unknown[] = []) => {
        if (sql.includes('admin_save_store_settings')) sent.push(values.at(-1));
        return Promise.resolve({
          rows: sql.includes('admin_save_store') ? [{ value: stored }] : [],
        });
      },
      release: () => undefined,
    } as unknown as PoolClient;
    const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;
    const store = createPostgresAdminReportStore(pool);

    await store.saveStoreSettings('token', USER, input);
    await store.saveStoreSettings('token', USER, { ...input, codEnabled: false });
    await store.saveStoreSettings('token', USER, { ...input, codEnabled: true });

    expect(sent).toEqual([null, false, true]);
  });

  it('does the same through Supabase, reads the settings, and refuses a malformed answer', async () => {
    const calls: { name: string; args: unknown }[] = [];
    let answer: unknown = stored;
    const clients = {
      asUser: () => ({
        rpc: (name: string, args: unknown) => {
          calls.push({ name, args });
          return Promise.resolve({ data: answer, error: null });
        },
      }),
    } as unknown as SupabaseClients;
    const store = createSupabaseAdminReportStore(clients);

    await store.saveStoreSettings('token', USER, input);
    await store.storeSettings('token', USER);
    answer = { ...stored, repeatOrderThreshold: 99 };

    expect(calls[0]).toEqual({
      name: 'admin_save_store_settings',
      args: {
        p_return_window_days: 10,
        p_cart_inactivity_minutes: 200,
        p_repeat_order_threshold: null,
        p_high_spend_threshold_minor: null,
        p_inactive_days: 30,
        // Cash on delivery has no input in this request, so the store passes the switch
        // through untouched rather than inventing a value.
        p_cod_enabled: null,
      },
    });
    expect(calls[1]?.name).toBe('admin_store_settings');
    await expect(store.storeSettings('token', USER)).rejects.toMatchObject({
      name: 'StoreUnavailableError',
    });
  });

  it('sends the cash on delivery switch through Supabase when it is given', async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const clients = {
      asUser: () => ({
        rpc: (name: string, args: Record<string, unknown>) => {
          calls.push({ name, args });
          return Promise.resolve({ data: stored, error: null });
        },
      }),
    } as unknown as SupabaseClients;
    const store = createSupabaseAdminReportStore(clients);

    await store.saveStoreSettings('token', USER, { ...input, codEnabled: false });
    await store.saveStoreSettings('token', USER, { ...input, codEnabled: true });

    expect(calls.map((call) => call.args.p_cod_enabled)).toEqual([false, true]);
    expect(calls.every((call) => call.name === 'admin_save_store_settings')).toBe(true);
  });
});

describe('creating a coupon needs coupons.create', () => {
  const coupon = { code: 'EID10', kind: 'percent', value: 10 };

  it('refuses coupons.update alone before the database, yet lets that account change a coupon', async () => {
    const setup = adminSetup();
    const created = await setup.call('post', '/admin/coupons', 'admin', coupon);
    const id = adminCouponResponseSchema.parse(created.body).coupon.id;
    setup.users.staff.overrides.set('coupons.update', 'grant');
    const callsBefore = setup.admin.calls.length;

    const refused = await setup.call('post', '/admin/coupons', 'staff', {
      ...coupon,
      code: 'EID20',
    });
    const changed = await setup.call('put', `/admin/coupons/${id}`, 'staff', {
      ...coupon,
      value: 15,
    });

    expect(created.status).toBe(201);
    expect(refused.status).toBe(403);
    expect(errorOf(refused.body).code).toBe('forbidden');
    expect(changed.status).toBe(200);
    expect(adminCouponResponseSchema.parse(changed.body).coupon.value).toBe(15);
    expect(setup.admin.calls.slice(callsBefore)).not.toContain('coupons.save:EID20');
    expect(setup.admin.couponRows.map((row) => row.code)).toEqual(['EID10']);
  });

  it('lets an account that holds both create coupons', async () => {
    const setup = adminSetup();
    setup.users.staff.overrides.set('coupons.update', 'grant');
    setup.users.staff.overrides.set('coupons.create', 'grant');

    expect((await setup.call('post', '/admin/coupons', 'staff', coupon)).status).toBe(201);
  });

  it('refuses coupons.create alone, since the coupon is read back with coupons.update', async () => {
    const setup = adminSetup();
    setup.users.staff.overrides.set('coupons.create', 'grant');

    expect((await setup.call('post', '/admin/coupons', 'staff', coupon)).status).toBe(403);
  });

  it('does not change what admins and the owner can do (both hold both permissions)', async () => {
    const setup = adminSetup();

    expect((await setup.call('post', '/admin/coupons', 'admin', coupon)).status).toBe(201);
    expect(
      (await setup.call('post', '/admin/coupons', 'owner', { ...coupon, code: 'EID30' })).status,
    ).toBe(201);
  });
});
