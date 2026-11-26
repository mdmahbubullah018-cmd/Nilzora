// @vitest-environment jsdom
import type { ExportJob, ReportPreview } from '@nilzora/contracts';
import { ApiError, type ApiClient, type SessionUser } from '@nilzora/web-session';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReportsPage from '@/app/admin/reports/page';
import { testUser } from '@/test/fixtures';
import { RedirectSignal } from '@/test/redirect';
import { DIRECT_EXPORT_MAX_ROWS, formatCell } from './report-views';

const gate = vi.hoisted(() => ({ user: null as SessionUser | null }));
type ReadOutcome = 'ok' | 'signed_out' | 'unavailable';
const read = vi.hoisted((): { outcome: ReadOutcome } => ({ outcome: 'ok' }));
const api = vi.hoisted(() => ({
  adminReportPreview: vi.fn(),
  adminListExports: vi.fn(),
  adminListCategories: vi.fn(),
  adminListBrands: vi.fn(),
}));

vi.mock('@/lib/access', () => ({
  workspaceGate: () =>
    Promise.resolve({ access: 'allowed', user: gate.user, csrf: { name: 'csrf_token', token: 't' } }),
}));
vi.mock('@/lib/session', () => ({
  session: {
    read: async (call: (client: ApiClient, token: string) => Promise<unknown>) => {
      if (read.outcome !== 'ok') return { kind: read.outcome };
      const value = await call(api as unknown as ApiClient, 'access-token');
      return { kind: 'ok', value };
    },
  },
}));
vi.mock('@/lib/report-actions', () => ({ createExportAction: vi.fn() }));
vi.mock('@/components/shell/workspace-shell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('next/navigation', async () => {
  const { throwRedirect } = await import('@/test/redirect');
  return { redirect: vi.fn(throwRedirect), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) };
});
vi.mock('next/form', () => ({
  default: ({ action, ...props }: ComponentProps<'form'> & { action: string }) => (
    <form action={action} method="get" {...props} />
  ),
}));

afterEach(cleanup);

function preview(overrides: Partial<ReportPreview> = {}): { report: ReportPreview } {
  return {
    report: {
      kind: 'orders',
      title: 'Orders',
      filters: { from: '2026-10-01', to: '2026-10-31' },
      columns: [
        { key: 'orderNumber', header: 'Order', type: 'text' },
        { key: 'status', header: 'Status', type: 'text' },
        { key: 'total', header: 'Total', type: 'money' },
        { key: 'items', header: 'Items', type: 'count' },
      ],
      rows: [
        { orderNumber: 'NZ100042', status: 'delivered', total: 245_000, items: 3 },
        { orderNumber: 'NZ100043', status: 'pending', total: 99_900, items: 1 },
      ],
      totalRows: 2,
      summary: [{ label: 'Total value', value: 344_900, type: 'money' }],
      ...overrides,
    },
  };
}

function job(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    id: '0f8fad5b-d9cb-469f-a165-70867728950e',
    kind: 'orders',
    format: 'csv',
    filters: { from: '2026-10-01', to: '2026-10-31' },
    status: 'done',
    progress: 100,
    rowCount: 12_000,
    fileName: 'nilzora-orders.csv',
    contentType: 'text/csv',
    fileBytes: 2_500_000,
    error: null,
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    startedAt: null,
    finishedAt: null,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    ...overrides,
  };
}

async function show(searchParams: Record<string, string> = {}) {
  render(await ReportsPage({ searchParams: Promise.resolve(searchParams) } as never));
}

beforeEach(() => {
  gate.user = testUser('super_admin');
  read.outcome = 'ok';
  for (const mock of Object.values(api)) mock.mockReset();
  api.adminReportPreview.mockResolvedValue(preview());
  api.adminListExports.mockResolvedValue({ jobs: [] });
  api.adminListCategories.mockResolvedValue({ categories: [{ id: 'c1', name: 'Sarees' }] });
  api.adminListBrands.mockResolvedValue({ brands: [{ id: 'b1', name: 'Nilzora Weaves' }] });
});

describe('reports page: access', () => {
  it('lists every report for the owner and opens the first one', async () => {
    await show();
    const nav = screen.getByRole('navigation', { name: 'Reports' });
    expect(within(nav).getAllByRole('link')).toHaveLength(9);
    expect(api.adminReportPreview.mock.calls[0]?.[1]).toBe('sales');
  });

  it('lists only the reports an account holds the permission for', async () => {
    gate.user = testUser('staff', { permissions: ['admin_workspace.access', 'orders.read', 'customers.read'] });
    await show({ kind: 'audit_logs' }); // not permitted: falls back to a permitted one
    const nav = screen.getByRole('navigation', { name: 'Reports' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Orders',
      'New customers',
    ]);
    expect(api.adminReportPreview.mock.calls[0]?.[1]).toBe('orders');
  });

  it('is forbidden without any report permission, without asking the API', async () => {
    gate.user = testUser('staff', { permissions: ['admin_workspace.access'] });
    await show();
    expect(screen.getByText(/permission/i)).toBeTruthy();
    expect(api.adminReportPreview).not.toHaveBeenCalled();
    expect(api.adminListExports).not.toHaveBeenCalled();
  });

  it('sends a lapsed session to sign in', async () => {
    read.outcome = 'signed_out';
    await expect(show()).rejects.toBeInstanceOf(RedirectSignal);
  });
});

describe('reports page: the report', () => {
  it('previews the chosen report with its filters, and drops filters it does not accept', async () => {
    await show({ kind: 'orders', status: 'delivered', paymentStatus: 'pending', q: 'NZ1', brandId: '0f8fad5b-d9cb-469f-a165-70867728950e' });
    const [, kind, query] = api.adminReportPreview.mock.calls[0] as [string, string, Record<string, string>];
    expect(kind).toBe('orders');
    expect(query).toMatchObject({ status: 'delivered', paymentStatus: 'pending', q: 'NZ1' });
    expect(query).not.toHaveProperty('brandId');
  });

  it('shows the rows formatted: money in taka, counts and readable statuses', async () => {
    await show({ kind: 'orders' });
    const table = screen.getByRole('table', { name: 'Orders' });
    expect(within(table).getByText('NZ100042')).toBeTruthy();
    expect(within(table).getByText('Delivered')).toBeTruthy();
    expect(within(table).getByText('৳2,450')).toBeTruthy();
    expect(screen.getAllByText('৳3,449').length).toBeGreaterThan(0); // the summary tile
  });

  it('offers category and brand filters for the products report', async () => {
    await show({ kind: 'products' });
    expect(api.adminListCategories).toHaveBeenCalled();
    expect(api.adminListBrands).toHaveBeenCalled();
    expect(screen.getByRole('option', { name: 'Sarees' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Nilzora Weaves' })).toBeTruthy();
  });

  it('does not load category or brand lists for a report without those filters', async () => {
    await show({ kind: 'orders' });
    expect(api.adminListCategories).not.toHaveBeenCalled();
    expect(api.adminListBrands).not.toHaveBeenCalled();
  });

  it('says there are no rows instead of an empty table', async () => {
    api.adminReportPreview.mockResolvedValue(preview({ rows: [], totalRows: 0, summary: [] }));
    await show({ kind: 'orders' });
    expect(screen.getByText('No rows for these filters')).toBeTruthy();
  });

  it('says so when the report cannot be read, instead of showing zeros', async () => {
    read.outcome = 'unavailable';
    await show({ kind: 'orders' });
    expect(screen.getByText('This information is unavailable right now')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the permission message when the API refuses this account the report', async () => {
    api.adminReportPreview.mockRejectedValue(new ApiError(403, 'forbidden', 'API text', 'req-1'));
    await show({ kind: 'orders' });
    expect(screen.getByText(/permission/i)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('reports page: downloads', () => {
  it('offers CSV, Excel and PDF downloads of exactly the rows shown', async () => {
    await show({ kind: 'orders', status: 'delivered', range: 'custom', from: '2026-10-01', to: '2026-10-31' });
    const section = screen.getByRole('region', { name: 'Download this report' });
    const hrefs = within(section)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(hrefs).toHaveLength(3);
    for (const [index, format] of ['csv', 'xlsx', 'pdf'].entries()) {
      const url = new URL(hrefs[index] ?? '', 'http://admin.test');
      expect(url.pathname).toBe('/api/reports/orders');
      expect(url.searchParams.get('format')).toBe(format);
      expect(url.searchParams.get('from')).toBe('2026-10-01');
      expect(url.searchParams.get('to')).toBe('2026-10-31');
      expect(url.searchParams.get('status')).toBe('delivered');
    }
  });

  it('queues a background export instead of a direct download for a very large report', async () => {
    api.adminReportPreview.mockResolvedValue(preview({ totalRows: DIRECT_EXPORT_MAX_ROWS + 1 }));
    await show({ kind: 'orders' });
    const section = screen.getByRole('region', { name: 'Download this report' });
    expect(within(section).queryByRole('link')).toBeNull();
    expect(within(section).getByRole('button', { name: 'Queue CSV' })).toBeTruthy();
    expect(within(section).getByRole('button', { name: 'Queue Excel' })).toBeTruthy();
    // A very large PDF is not offered as a background job.
    expect(within(section).queryByRole('button', { name: 'Queue PDF' })).toBeNull();
  });
});

describe('reports page: your exports', () => {
  it('shows each export with its state and a download only for the ones that are ready', async () => {
    api.adminListExports.mockResolvedValue({
      jobs: [
        job(),
        job({ id: '1f8fad5b-d9cb-469f-a165-70867728950e', status: 'running', progress: 40, rowCount: null, fileBytes: null }),
        job({ id: '2f8fad5b-d9cb-469f-a165-70867728950e', status: 'failed', error: 'The export could not be prepared.', fileBytes: null }),
      ],
    });
    await show({ kind: 'orders' });
    const exports = screen.getByRole('region', { name: 'Your exports' });
    const links = within(exports).getAllByRole('link', { name: /Download/ });
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('/api/exports/0f8fad5b-d9cb-469f-a165-70867728950e');
    expect(within(exports).getByRole('progressbar', { name: 'Export progress' }).getAttribute('aria-valuenow')).toBe('40');
    expect(within(exports).getByText('The export could not be prepared.')).toBeTruthy();
    expect(within(exports).getByText('Ready')).toBeTruthy();
  });

  it('explains an empty list', async () => {
    await show({ kind: 'orders' });
    expect(screen.getByText(/No background exports yet/)).toBeTruthy();
  });
});

describe('formatCell', () => {
  it('formats by column type and shows a dash for missing values', () => {
    expect(formatCell('money', 245_000)).toBe('৳2,450');
    expect(formatCell('count', 12_345)).toBe('12,345');
    expect(formatCell('percent', 0.256)).toBe('25.6%');
    expect(formatCell('text', 'changes_requested')).toBe('Changes requested');
    expect(formatCell('text', 'Ayesha Rahman')).toBe('Ayesha Rahman');
    expect(formatCell('date', '2026-10-25')).toContain('25');
    for (const type of ['text', 'count', 'money', 'date', 'datetime', 'percent'] as const) {
      expect(formatCell(type, null)).toBe('—');
    }
  });
});
