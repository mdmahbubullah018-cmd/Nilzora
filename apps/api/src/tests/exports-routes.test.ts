import {
  DIRECT_EXPORT_MAX_ROWS,
  exportJobListResponseSchema,
  exportJobResponseSchema,
  REPORT_DEFINITIONS,
  reportPreviewResponseSchema,
} from '@nilzora/contracts';
import type { Response as SupertestResponse } from 'supertest';
import { describe, expect, it } from 'vitest';
import { createExportProcessor, EXPORT_FAILURES } from '../modules/exports/worker';
import { adminSetup, errorOf } from './admin-helpers';

/*
 * Reports, direct exports, export jobs and order documents through the admin routes, over
 * the in-memory fakes (export-fakes.ts): validation, personal-data columns, the formula
 * guard, the direct-download limit, the job lifecycle with the worker ticked by hand, and
 * the audit rows. Permissions per route are in admin-access.test.ts.
 */

const RANGE = 'from=2026-10-01&to=2026-10-31';
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** The raw body of a binary answer. */
function bytes(response: SupertestResponse): Buffer {
  return Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.text, 'utf8');
}

function binary(pending: ReturnType<ReturnType<typeof adminSetup>['call']>) {
  return pending.buffer(true).parse((res, done) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => {
      done(null, Buffer.concat(chunks));
    });
  });
}

describe('GET /api/v1/admin/reports/:kind/preview', () => {
  it('answers the first rows, the total, the summary and the chart in the contract shape', async () => {
    const setup = adminSetup();
    setup.admin.exports.rows.sales = Array.from({ length: 60 }, (_, i) => ({
      day: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
      orders: i,
      cancelled: 0,
      revenue: i * 100,
      averageOrder: 100,
      collected: 0,
    }));
    setup.admin.exports.summaries.sales = { revenue: 177_000, orders: 1770 };
    const response = await setup.call('get', `/admin/reports/sales/preview?${RANGE}`, 'admin');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const { report } = reportPreviewResponseSchema.parse(response.body);
    expect(report).toMatchObject({
      kind: 'sales',
      title: 'Sales by day',
      totalRows: 60,
      filters: { from: '2026-10-01', to: '2026-10-31' },
    });
    expect(report.rows).toHaveLength(50);
    expect(report.columns).toEqual(REPORT_DEFINITIONS.sales.columns);
    expect(report.summary[0]).toEqual({ label: 'Revenue', value: 177_000, type: 'money' });
    expect(report.chart).toMatchObject({
      type: 'line',
      label: 'Revenue by day',
      valueType: 'money',
    });
    expect(setup.admin.exports.reads.at(-1)).toMatchObject({ kind: 'sales', limit: 50, offset: 0 });
  });

  it.each([
    ['a filter the report does not take', `sales/preview?${RANGE}&status=pending`, 'status'],
    ['a status the report does not know', `orders/preview?${RANGE}&status=lost`, 'status'],
    [
      'a payment filter on products',
      `products/preview?${RANGE}&paymentStatus=pending`,
      'paymentStatus',
    ],
    ['more than 366 days', 'sales/preview?from=2025-01-01&to=2026-01-02', 'from'],
    ['a range ending before it starts', 'sales/preview?from=2026-10-31&to=2026-10-01', 'to'],
    ['no range', 'sales/preview', 'from'],
    ['an unknown kind', `payroll/preview?${RANGE}`, 'kind'],
    ['a malformed category id', `products/preview?${RANGE}&categoryId=lamps`, 'categoryId'],
  ])('rejects %s with 400 before the database', async (_label, path, field) => {
    const setup = adminSetup();
    const response = await setup.call('get', `/admin/reports/${path}`, 'owner');

    expect(response.status).toBe(400);
    const issues = (errorOf(response.body).details as { issues: { path: string }[] }).issues;
    expect(issues.map((issue) => issue.path)).toContain(field);
    expect(setup.admin.calls).toEqual([]);
  });
});

describe('GET /api/v1/admin/reports/:kind/export', () => {
  it('streams a CSV attachment with a safe name and audits the download (filters only)', async () => {
    const setup = adminSetup();
    setup.admin.exports.rows.customers = [
      {
        name: '=cmd|"/c calc"!A1',
        email: 'rahima@example.com',
        joinedAt: '2026-10-02',
        orders: 2,
        spent: 52_000,
        status: 'active',
      },
    ];
    const response = await binary(
      setup.call('get', `/admin/reports/customers/export?format=csv&${RANGE}&q=rahima`, 'staff'),
    );

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="nilzora-customers-2026-10-01-to-2026-10-31.csv"',
    );
    expect(response.headers['cache-control']).toBe('no-store');
    const lines = bytes(response).toString('utf8').split('\r\n');
    expect(lines[0]).toBe('﻿Name,Email,Joined,Orders,Total spent,Status');
    expect(lines[1]).toBe(`"'=cmd|""/c calc""!A1",rahima@example.com,2026-10-02,2,520.00,active`);
    expect(setup.admin.exports.audits.at(-1)).toEqual({
      actorId: setup.users.staff.id,
      action: 'export.downloaded',
      details: {
        kind: 'customers',
        format: 'csv',
        rowCount: 1,
        filters: { from: '2026-10-01', to: '2026-10-31', q: 'rahima' },
      },
    });
  });

  it('keeps phone numbers and street addresses out of the order and customer reports', () => {
    for (const kind of ['orders', 'customers', 'cod_collections'] as const) {
      const headers = REPORT_DEFINITIONS[kind].columns.map((column) => column.key.toLowerCase());
      expect(headers.some((key) => /phone|address|street|line|landmark|postal/.test(key))).toBe(
        false,
      );
    }
    expect(REPORT_DEFINITIONS.orders.columns.map((column) => column.key)).toEqual(
      expect.arrayContaining(['district', 'zone']),
    );
    const audit = REPORT_DEFINITIONS.audit_logs.columns.map((column) => column.key);
    expect(audit).toEqual(['at', 'action', 'actor', 'targetType', 'targetId']);
  });

  it('writes the audit-log export without a details column', async () => {
    const setup = adminSetup();
    setup.admin.exports.rows.audit_logs = [
      {
        at: '2026-10-02T08:00:00Z',
        action: 'settings.saved',
        actor: 'Nusrat Owner',
        targetType: 'store_settings',
        targetId: 'settings',
      },
    ];
    const response = await binary(
      setup.call('get', `/admin/reports/audit_logs/export?format=csv&${RANGE}`, 'admin'),
    );

    expect(bytes(response).toString('utf8').split('\r\n')[0]).toBe(
      '﻿Time (Dhaka time),Action,By,Target,Target id',
    );
  });

  it.each([
    ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'PK'],
    ['pdf', 'application/pdf', '%PDF-1.4'],
  ])('answers %s files', async (format, type, magic) => {
    const setup = adminSetup();
    setup.admin.exports.rows.orders = [
      {
        orderNumber: 'NZ100001',
        placedAt: '2026-10-02T08:00:00Z',
        status: 'pending',
        paymentStatus: 'pending',
        customer: 'Rahima',
        district: 'Dhaka',
        zone: 'inside_dhaka',
        items: 1,
        subtotal: 10_000,
        discount: 0,
        delivery: 6_000,
        total: 16_000,
      },
    ];
    const response = await binary(
      setup.call('get', `/admin/reports/orders/export?format=${format}&${RANGE}`, 'staff'),
    );

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe(type);
    expect(bytes(response).subarray(0, magic.length).toString('latin1')).toBe(magic);
  });

  it(`refuses more than ${String(DIRECT_EXPORT_MAX_ROWS)} rows with 409 export_too_large and a hint`, async () => {
    const setup = adminSetup();
    setup.admin.exports.totalOverride = DIRECT_EXPORT_MAX_ROWS + 1;
    const response = await setup.call(
      'get',
      `/admin/reports/orders/export?format=csv&${RANGE}`,
      'staff',
    );

    expect(response.status).toBe(409);
    const error = errorOf(response.body);
    expect(error.code).toBe('export_too_large');
    expect(error.message).toContain('POST /api/v1/admin/exports');
    expect(error.details).toEqual({ totalRows: 5001, maxRows: 5000 });
    expect(setup.admin.exports.audits).toEqual([]);
  });

  it('requires a known format', async () => {
    const setup = adminSetup();
    const response = await setup.call(
      'get',
      `/admin/reports/orders/export?format=docx&${RANGE}`,
      'staff',
    );

    expect(response.status).toBe(400);
  });
});

describe('order documents', () => {
  it.each([
    ['invoice.pdf', 'invoice', 'order.invoice_downloaded'],
    ['packing-slip.pdf', 'packing-slip', 'order.packing_slip_downloaded'],
  ])('downloads the %s and audits it with the order number only', async (file, name, action) => {
    const setup = adminSetup();
    const orderNumber = setup.orders.pending.orderNumber;
    const response = await binary(
      setup.call('get', `/admin/orders/${orderNumber}/${file}`, 'staff'),
    );

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="${name}-${orderNumber}.pdf"`,
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expect(bytes(response).subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(setup.admin.exports.audits.at(-1)).toEqual({
      actorId: setup.users.staff.id,
      action,
      details: { orderNumber },
    });
  });

  it('answers 404 for an unknown order and 400 for a malformed number', async () => {
    const setup = adminSetup();
    const missing = await setup.call('get', '/admin/orders/NZ999999/invoice.pdf', 'staff');
    expect(missing.status, JSON.stringify(missing.body)).toBe(404);
    expect((await setup.call('get', '/admin/orders/order-1/invoice.pdf', 'staff')).status).toBe(
      400,
    );
  });
});

describe('export jobs', () => {
  const body = { kind: 'orders', format: 'csv', filters: { from: '2026-10-01', to: '2026-10-31' } };

  function withRows() {
    const setup = adminSetup();
    setup.admin.exports.rows.orders = Array.from({ length: 25 }, (_, i) => ({
      orderNumber: `NZ${String(100_000 + i)}`,
      placedAt: '2026-10-02T08:00:00Z',
      status: 'pending',
      paymentStatus: 'pending',
      customer: 'Rahima',
      district: 'Dhaka',
      zone: 'inside_dhaka',
      items: 1,
      subtotal: 10_000,
      discount: 0,
      delivery: 6_000,
      total: 16_000,
    }));
    const worker = createExportProcessor({
      backend: setup.admin.exports.worker,
      logger: silent,
      pageSize: 10,
      now: () => setup.admin.exports.now,
    });
    return { setup, worker };
  }

  it('runs queued → running → done with progress, and only the creator downloads the file', async () => {
    const { setup, worker } = withRows();
    const created = await setup.call('post', '/admin/exports', 'staff', body);
    expect(created.status).toBe(202);
    const { job } = exportJobResponseSchema.parse(created.body);
    expect(job).toMatchObject({ status: 'queued', progress: 0, kind: 'orders', format: 'csv' });

    const early = await setup.call('get', `/admin/exports/${job.id}/download`, 'staff');
    expect(early.status).toBe(409);
    expect(errorOf(early.body).code).toBe('export_not_ready');

    await expect(worker.runOnce()).resolves.toBe('done');
    expect(setup.admin.exports.progressLog.map((entry) => entry.percent)).toEqual([36, 72]);

    const done = exportJobResponseSchema.parse(
      (await setup.call('get', `/admin/exports/${job.id}`, 'staff')).body,
    ).job;
    expect(done).toMatchObject({ status: 'done', progress: 100, rowCount: 25 });
    expect(done.fileName).toBe('nilzora-orders-2026-10-01-to-2026-10-31.csv');

    const file = await binary(setup.call('get', `/admin/exports/${job.id}/download`, 'staff'));
    expect(file.status).toBe(200);
    expect(bytes(file).toString('utf8').split('\r\n')).toHaveLength(27);
    expect(setup.admin.exports.audits.map((audit) => audit.action)).toEqual([
      'export.created',
      'export.downloaded',
    ]);

    const other = await setup.call('get', `/admin/exports/${job.id}/download`, 'admin');
    expect(other.status).toBe(404);
    const list = exportJobListResponseSchema.parse(
      (await setup.call('get', '/admin/exports', 'admin')).body,
    );
    expect(list.jobs).toEqual([]);
  });

  it('answers 410 once the file is older than 7 days', async () => {
    const { setup, worker } = withRows();
    const { job } = exportJobResponseSchema.parse(
      (await setup.call('post', '/admin/exports', 'staff', body)).body,
    );
    await worker.runOnce();
    setup.admin.exports.now = new Date(setup.admin.exports.now.getTime() + 8 * 86_400_000);

    const response = await setup.call('get', `/admin/exports/${job.id}/download`, 'staff');
    expect(response.status).toBe(410);
    expect(errorOf(response.body).code).toBe('export_expired');
    await worker.runOnce();
    expect(setup.admin.exports.jobs[0]).toMatchObject({ status: 'expired', file: null });
  });

  it('fails a job whose creator lost the permission before it ran', async () => {
    const { setup, worker } = withRows();
    const { job } = exportJobResponseSchema.parse(
      (await setup.call('post', '/admin/exports', 'staff', body)).body,
    );
    setup.deny('staff', 'orders.read');

    await expect(worker.runOnce()).resolves.toBe('failed');
    setup.users.staff.overrides.clear();
    const failed = exportJobResponseSchema.parse(
      (await setup.call('get', `/admin/exports/${job.id}`, 'staff')).body,
    ).job;
    expect(failed).toMatchObject({ status: 'failed', error: EXPORT_FAILURES.permission });
  });

  it('fails a job with more rows than an export may hold', async () => {
    const { setup } = withRows();
    await setup.call('post', '/admin/exports', 'staff', body);
    const worker = createExportProcessor({
      backend: setup.admin.exports.worker,
      logger: silent,
      maxRows: 10,
    });

    await expect(worker.runOnce()).resolves.toBe('failed');
    expect(setup.admin.exports.jobs[0]?.error).toBe(EXPORT_FAILURES.tooManyRows);
  });

  it('is idle with nothing queued', async () => {
    const { worker } = withRows();
    await expect(worker.runOnce()).resolves.toBe('idle');
  });

  it.each([
    [
      'an unsupported filter',
      { ...body, filters: { ...body.filters, paymentStatus: 'pending' }, kind: 'sales' },
    ],
    ['a range over 366 days', { ...body, filters: { from: '2025-01-01', to: '2026-01-02' } }],
    ['an unknown format', { ...body, format: 'docx' }],
    ['an extra field', { ...body, rows: 5 }],
  ])('rejects %s before the database', async (_label, request) => {
    const setup = adminSetup();
    const response = await setup.call('post', '/admin/exports', 'owner', request);

    expect(response.status).toBe(400);
    expect(setup.admin.calls).toEqual([]);
  });
});
