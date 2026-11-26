import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';

const TOKEN = 'staff-access-token';
const JOB = '0f000000-0000-4000-8000-000000000001';

function setup(response: () => Response) {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(response()));
  const client = createApiClient({ baseUrl: 'http://localhost:4000/', fetch: fetchMock });
  const sent = () => {
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    return { url, method: init?.method ?? 'GET', headers: new Headers(init?.headers), init };
  };
  return { client, sent, fetchMock };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const job = {
  id: JOB,
  kind: 'orders',
  format: 'csv',
  filters: { from: '2026-10-01', to: '2026-10-31' },
  status: 'queued',
  progress: 0,
  rowCount: null,
  fileName: null,
  contentType: null,
  fileBytes: null,
  error: null,
  createdAt: '2026-11-02T10:00:00.000Z',
  startedAt: null,
  finishedAt: null,
  expiresAt: '2026-11-09T10:00:00.000Z',
};

describe('reports and exports', () => {
  it('previews a report with its filters in the query', async () => {
    const report = {
      kind: 'orders',
      title: 'Orders',
      filters: { from: '2026-10-01', to: '2026-10-31', status: 'pending' },
      columns: [{ key: 'orderNumber', header: 'Order', type: 'text' }],
      rows: [{ orderNumber: 'NZ100001' }],
      totalRows: 1,
      summary: [{ label: 'Orders', value: 1, type: 'count' }],
    };
    const { client, sent } = setup(() => json({ report }));

    await expect(
      client.adminReportPreview(TOKEN, 'orders', {
        from: '2026-10-01',
        to: '2026-10-31',
        status: 'pending',
      }),
    ).resolves.toStrictEqual({ report });
    expect(sent().url).toBe(
      'http://localhost:4000/api/v1/admin/reports/orders/preview?from=2026-10-01&to=2026-10-31&status=pending',
    );
    expect(sent().headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('downloads a report file with the name the server gave', async () => {
    const csv = new TextEncoder().encode('﻿Order\r\nNZ100001\r\n');
    const { client, sent } = setup(
      () =>
        new Response(csv, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition':
              'attachment; filename="nilzora-orders-2026-10-01-to-2026-10-31.csv"',
          },
        }),
    );

    const file = await client.adminDownloadReport(TOKEN, 'orders', {
      format: 'csv',
      from: '2026-10-01',
      to: '2026-10-31',
    });

    expect(file.fileName).toBe('nilzora-orders-2026-10-01-to-2026-10-31.csv');
    expect(file.contentType).toBe('text/csv; charset=utf-8');
    expect([...file.bytes]).toEqual([...csv]);
    expect(sent().url).toBe(
      'http://localhost:4000/api/v1/admin/reports/orders/export?format=csv&from=2026-10-01&to=2026-10-31',
    );
    expect(sent().headers.get('Accept')).toBe('*/*');
  });

  it('raises export_too_large with its details', async () => {
    const { client } = setup(() =>
      json(
        {
          error: {
            code: 'export_too_large',
            message: 'Create an export job',
            details: { totalRows: 5001, maxRows: 5000 },
          },
        },
        409,
      ),
    );

    await expect(
      client.adminDownloadReport(TOKEN, 'orders', {
        format: 'pdf',
        from: '2026-10-01',
        to: '2026-10-31',
      }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'export_too_large',
      details: { totalRows: 5001 },
    });
  });

  it('creates, lists and reads export jobs', async () => {
    const created = setup(() => json({ job }, 202));
    await expect(
      created.client.adminCreateExport(TOKEN, {
        kind: 'orders',
        format: 'csv',
        filters: { from: '2026-10-01', to: '2026-10-31' },
      }),
    ).resolves.toStrictEqual({ job });
    expect(created.sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/admin/exports',
      method: 'POST',
    });
    expect(JSON.parse(created.sent().init?.body as string)).toEqual({
      kind: 'orders',
      format: 'csv',
      filters: { from: '2026-10-01', to: '2026-10-31' },
    });

    const listed = setup(() => json({ jobs: [job] }));
    await expect(listed.client.adminListExports(TOKEN)).resolves.toStrictEqual({ jobs: [job] });

    const read = setup(() => json({ job }));
    await read.client.adminGetExport(TOKEN, JOB);
    expect(read.sent().url).toBe(`http://localhost:4000/api/v1/admin/exports/${JOB}`);
  });

  it('downloads a finished job, and raises export_expired after 7 days', async () => {
    const ok = setup(
      () =>
        new Response(new Uint8Array([0x50, 0x4b]), {
          headers: { 'Content-Type': 'application/zip' },
        }),
    );
    const file = await ok.client.adminDownloadExport(TOKEN, JOB);
    expect(file).toMatchObject({ fileName: 'nilzora-export', contentType: 'application/zip' });
    expect(ok.sent().url).toBe(`http://localhost:4000/api/v1/admin/exports/${JOB}/download`);

    const gone = setup(() => json({ error: { code: 'export_expired', message: 'Gone' } }, 410));
    await expect(gone.client.adminDownloadExport(TOKEN, JOB)).rejects.toMatchObject({
      status: 410,
      code: 'export_expired',
    });
  });

  it.each([
    ['adminOrderInvoice', 'invoice.pdf', 'invoice-NZ100001.pdf'],
    ['adminOrderPackingSlip', 'packing-slip.pdf', 'packing-slip-NZ100001.pdf'],
  ] as const)('%s downloads the order document', async (method, path, fallback) => {
    const { client, sent } = setup(
      () =>
        new Response(new TextEncoder().encode('%PDF-1.4'), {
          headers: { 'Content-Type': 'application/pdf' },
        }),
    );

    const file = await client[method](TOKEN, 'NZ100001');

    expect(sent().url).toBe(`http://localhost:4000/api/v1/admin/orders/NZ100001/${path}`);
    expect(file).toMatchObject({ fileName: fallback, contentType: 'application/pdf' });
    expect(new TextDecoder().decode(file.bytes)).toBe('%PDF-1.4');
  });

  it('refuses unsafe ids without sending anything', async () => {
    const { client, fetchMock } = setup(() => json({}));
    await expect(client.adminDownloadExport(TOKEN, '..')).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(client.adminOrderInvoice(TOKEN, '.')).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('adminDeleteCategory', () => {
  const CATEGORY = 'ca000000-0000-4000-8000-000000000001';

  it('sends DELETE and resolves on 204', async () => {
    const { client, sent } = setup(() => new Response(null, { status: 204 }));

    await expect(client.adminDeleteCategory(TOKEN, CATEGORY)).resolves.toBeUndefined();
    expect(sent()).toMatchObject({
      url: `http://localhost:4000/api/v1/admin/categories/${CATEGORY}`,
      method: 'DELETE',
    });
    expect(sent().headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('raises category_in_use while products or subcategories remain', async () => {
    const { client } = setup(() =>
      json({ error: { code: 'category_in_use', message: 'Move its products first' } }, 409),
    );

    await expect(client.adminDeleteCategory(TOKEN, CATEGORY)).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'category_in_use',
    });
  });
});
