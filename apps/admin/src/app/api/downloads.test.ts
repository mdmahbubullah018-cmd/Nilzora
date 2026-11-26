import { ApiError, type ApiClient } from '@nilzora/web-session';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as downloadExport } from './exports/[jobId]/route';
import { GET as downloadOrderDocument } from './orders/[orderNumber]/[document]/route';
import { GET as downloadReport } from './reports/[kind]/route';

/*
 * The download route handlers: the browser asks the admin app, the admin app asks the API
 * with the visitor's session and streams the file back as an attachment. They refuse
 * requests started from another site, validate everything in the address before calling
 * the API, and never pass the API's own text on.
 */

type Outcome = 'ok' | 'signed_out' | 'unavailable';

const api = vi.hoisted(() => ({
  adminDownloadReport: vi.fn(),
  adminOrderInvoice: vi.fn(),
  adminOrderPackingSlip: vi.fn(),
  adminDownloadExport: vi.fn(),
}));
const session = vi.hoisted((): { outcome: Outcome } => ({ outcome: 'ok' }));

vi.mock('@/lib/session', () => ({
  session: {
    // Like the real read(): a refusal from the API is thrown to the caller.
    read: async (call: (client: ApiClient, token: string) => Promise<unknown>) => {
      if (session.outcome !== 'ok') return { kind: session.outcome };
      return { kind: 'ok', value: await call(api as unknown as ApiClient, 'access-token') };
    },
  },
}));

const BASE = 'http://localhost:3001';
const JOB = '0d000000-0000-4000-8000-000000000001';
const API_TEXT = 'API text that must never reach the browser';

function file(overrides: Partial<{ fileName: string; contentType: string }> = {}) {
  return {
    bytes: new Uint8Array([1, 2, 3, 4]),
    contentType: 'text/csv; charset=utf-8',
    fileName: 'nilzora-orders.csv',
    ...overrides,
  };
}

function request(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`${BASE}${path}`, { headers });
}

const REPORT = '/api/reports/orders?format=csv&from=2026-01-01&to=2026-01-31&status=pending&q=NZ1';
const reportContext = (kind: string) => ({ params: Promise.resolve({ kind }) });
const documentContext = (orderNumber: string, document: string) => ({
  params: Promise.resolve({ orderNumber, document }),
});
const exportContext = (jobId: string) => ({ params: Promise.resolve({ jobId }) });

function refusal(status: number, code: string): ApiError {
  return new ApiError(status, code, API_TEXT, 'req-1');
}

beforeEach(() => {
  session.outcome = 'ok';
  for (const fn of Object.values(api)) fn.mockReset();
  api.adminDownloadReport.mockResolvedValue(file());
  api.adminOrderInvoice.mockResolvedValue(file({ contentType: 'application/pdf', fileName: 'invoice-NZ100042.pdf' }));
  api.adminOrderPackingSlip.mockResolvedValue(
    file({ contentType: 'application/pdf', fileName: 'packing-slip-NZ100042.pdf' }),
  );
  api.adminDownloadExport.mockResolvedValue(file({ fileName: 'nilzora-export.xlsx' }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

/** Headers every successful download carries. */
function expectAttachment(response: Response, filename: string, contentType: string) {
  expect(response.status).toBe(200);
  expect(response.headers.get('content-disposition')).toBe(`attachment; filename="${filename}"`);
  expect(response.headers.get('content-type')).toBe(contentType);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}

describe('GET /api/reports/:kind', () => {
  it('sends the report as a no-store attachment, passing the validated filters on', async () => {
    const response = await downloadReport(request(REPORT), reportContext('orders'));

    expectAttachment(response, 'nilzora-orders.csv', 'text/csv; charset=utf-8');
    expect(api.adminDownloadReport).toHaveBeenCalledWith('access-token', 'orders', {
      format: 'csv',
      from: '2026-01-01',
      to: '2026-01-31',
      status: 'pending',
      q: 'NZ1',
    });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('makes a file name from the API’s own only when it is safe', async () => {
    api.adminDownloadReport.mockResolvedValue(file({ fileName: 'orders "../x"\r\nSet-Cookie: a=b.csv' }));
    const response = await downloadReport(request(REPORT), reportContext('orders'));

    const disposition = response.headers.get('content-disposition') ?? '';
    expect(disposition).toMatch(/^attachment; filename="[A-Za-z0-9.-]+"$/);
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it.each(['cross-site', 'same-site'])('refuses a request started from %s', async (site) => {
    const response = await downloadReport(
      request(REPORT, { 'sec-fetch-site': site }),
      reportContext('orders'),
    );
    expect(response.status).toBe(403);
    expect(api.adminDownloadReport).not.toHaveBeenCalled();
  });

  it.each(['same-origin', 'none'])('allows a request from %s', async (site) => {
    const response = await downloadReport(
      request(REPORT, { 'sec-fetch-site': site }),
      reportContext('orders'),
    );
    expect(response.status).toBe(200);
  });

  it('answers 404 for a report that does not exist, without calling the API', async () => {
    const response = await downloadReport(request(REPORT), reportContext('passwords'));
    expect(response.status).toBe(404);
    expect(api.adminDownloadReport).not.toHaveBeenCalled();
  });

  it.each([
    ['no dates', '/api/reports/orders?format=csv'],
    ['an unknown format', '/api/reports/orders?format=exe&from=2026-01-01&to=2026-01-31'],
    ['a range that ends before it starts', '/api/reports/orders?format=csv&from=2026-02-01&to=2026-01-01'],
    ['a range longer than a year', '/api/reports/orders?format=csv&from=2024-01-01&to=2026-01-31'],
  ])('answers 400 for %s, without calling the API', async (_name, path) => {
    const response = await downloadReport(request(path), reportContext('orders'));
    expect(response.status).toBe(400);
    expect(api.adminDownloadReport).not.toHaveBeenCalled();
  });

  it('never forwards a query parameter the report does not define', async () => {
    const response = await downloadReport(
      request('/api/reports/orders?format=csv&from=2026-01-01&to=2026-01-31&role=admin&x=1'),
      reportContext('orders'),
    );
    expect(response.status).toBe(200);
    expect(api.adminDownloadReport.mock.calls[0]?.[2]).toEqual({
      format: 'csv',
      from: '2026-01-01',
      to: '2026-01-31',
    });
  });

  it('sends a signed-out visitor to sign in', async () => {
    session.outcome = 'signed_out';
    const response = await downloadReport(request(REPORT), reportContext('orders'));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/login');
    expect(new URL(response.headers.get('location') ?? '').searchParams.get('next')).toBe(
      '/admin/reports',
    );
  });

  it('leads a list too long to download to the Reports page, keeping its filters', async () => {
    api.adminDownloadReport.mockRejectedValue(refusal(413, 'export_too_large'));
    const response = await downloadReport(request(REPORT), reportContext('orders'));

    expect(response.status).toBe(303);
    const target = new URL(response.headers.get('location') ?? '');
    expect(target.pathname).toBe('/admin/reports');
    expect(target.searchParams.get('tooLarge')).toBe('1');
    expect(target.searchParams.get('kind')).toBe('orders');
    expect(target.searchParams.get('from')).toBe('2026-01-01');
    expect(target.searchParams.get('status')).toBe('pending');
  });

  it.each([
    [403, 403],
    [429, 429],
    [400, 400],
    [500, 503],
  ])('turns an API %s into a plain %s without its text', async (apiStatus, expected) => {
    api.adminDownloadReport.mockRejectedValue(refusal(apiStatus, 'whatever'));
    const response = await downloadReport(request(REPORT), reportContext('orders'));
    expect(response.status).toBe(expected);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).not.toContain(API_TEXT);
  });

  it('says the API could not be reached when the read fails', async () => {
    session.outcome = 'unavailable';
    const response = await downloadReport(request(REPORT), reportContext('orders'));
    expect(response.status).toBe(503);
  });
});

describe('GET /api/orders/:orderNumber/:document', () => {
  it('sends the invoice and the packing slip as PDF attachments', async () => {
    const invoice = await downloadOrderDocument(
      request('/api/orders/NZ100042/invoice.pdf'),
      documentContext('NZ100042', 'invoice.pdf'),
    );
    expectAttachment(invoice, 'invoice-NZ100042.pdf', 'application/pdf');
    expect(api.adminOrderInvoice).toHaveBeenCalledWith('access-token', 'NZ100042');

    const slip = await downloadOrderDocument(
      request('/api/orders/NZ100042/packing-slip.pdf'),
      documentContext('NZ100042', 'packing-slip.pdf'),
    );
    expectAttachment(slip, 'packing-slip-NZ100042.pdf', 'application/pdf');
    expect(api.adminOrderPackingSlip).toHaveBeenCalledWith('access-token', 'NZ100042');
  });

  it('refuses a request started from another site', async () => {
    const response = await downloadOrderDocument(
      request('/api/orders/NZ100042/invoice.pdf', { 'sec-fetch-site': 'cross-site' }),
      documentContext('NZ100042', 'invoice.pdf'),
    );
    expect(response.status).toBe(403);
    expect(api.adminOrderInvoice).not.toHaveBeenCalled();
  });

  it.each([
    ['NZ100042', 'receipt.pdf'],
    ['NZ100042', 'invoice'],
    ['nz100042', 'invoice.pdf'],
    ['NZ1', 'invoice.pdf'],
    ['../admin', 'invoice.pdf'],
  ])('answers 404 for %s / %s without calling the API', async (orderNumber, document) => {
    const response = await downloadOrderDocument(
      request(`/api/orders/${orderNumber}/${document}`),
      documentContext(orderNumber, document),
    );
    expect(response.status).toBe(404);
    expect(api.adminOrderInvoice).not.toHaveBeenCalled();
    expect(api.adminOrderPackingSlip).not.toHaveBeenCalled();
  });

  it('sends a signed-out visitor to sign in and back to the order', async () => {
    session.outcome = 'signed_out';
    const response = await downloadOrderDocument(
      request('/api/orders/NZ100042/invoice.pdf'),
      documentContext('NZ100042', 'invoice.pdf'),
    );
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location') ?? '').searchParams.get('next')).toBe(
      '/admin/orders/NZ100042',
    );
  });

  it.each([
    [404, 404],
    [403, 403],
    [429, 429],
    [500, 503],
  ])('turns an API %s into a plain %s', async (apiStatus, expected) => {
    api.adminOrderInvoice.mockRejectedValue(refusal(apiStatus, 'whatever'));
    const response = await downloadOrderDocument(
      request('/api/orders/NZ100042/invoice.pdf'),
      documentContext('NZ100042', 'invoice.pdf'),
    );
    expect(response.status).toBe(expected);
    expect(await response.text()).not.toContain(API_TEXT);
  });
});

describe('GET /api/exports/:jobId', () => {
  it('sends the finished export as an attachment', async () => {
    const response = await downloadExport(request(`/api/exports/${JOB}`), exportContext(JOB));
    expectAttachment(response, 'nilzora-export.xlsx', 'text/csv; charset=utf-8');
    expect(api.adminDownloadExport).toHaveBeenCalledWith('access-token', JOB);
  });

  it('refuses a request started from another site', async () => {
    const response = await downloadExport(
      request(`/api/exports/${JOB}`, { 'sec-fetch-site': 'cross-site' }),
      exportContext(JOB),
    );
    expect(response.status).toBe(403);
    expect(api.adminDownloadExport).not.toHaveBeenCalled();
  });

  it('answers 404 for an id that is not a uuid, without calling the API', async () => {
    const response = await downloadExport(request('/api/exports/nope'), exportContext('nope'));
    expect(response.status).toBe(404);
    expect(api.adminDownloadExport).not.toHaveBeenCalled();
  });

  it('sends a signed-out visitor to sign in', async () => {
    session.outcome = 'signed_out';
    const response = await downloadExport(request(`/api/exports/${JOB}`), exportContext(JOB));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location') ?? '').searchParams.get('next')).toBe(
      '/admin/reports',
    );
  });

  it.each([
    [404, 404],
    [403, 403],
    [409, 409],
    [410, 410],
    [500, 503],
  ])('turns an API %s into a plain %s without its text', async (apiStatus, expected) => {
    api.adminDownloadExport.mockRejectedValue(refusal(apiStatus, 'whatever'));
    const response = await downloadExport(request(`/api/exports/${JOB}`), exportContext(JOB));
    expect(response.status).toBe(expected);
    expect(await response.text()).not.toContain(API_TEXT);
  });
});
