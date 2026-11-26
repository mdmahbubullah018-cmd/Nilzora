import { ApiError, type ApiClient } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseReportRange } from '@/lib/date-range';
import { ROLE_PERMISSIONS } from '@/test/fixtures';
import { analyticsOverview, pendingReviews } from './fixtures';
import { loadDashboard, signedOut } from './load-dashboard';

const api = vi.hoisted(() => ({
  adminDashboard: vi.fn(),
  adminAnalyticsOverview:
    vi.fn<(token: string, query: { from: string; to: string; compare?: string }) => Promise<unknown>>(),
  adminListOrders: vi.fn(),
  adminAuditLog: vi.fn(),
  adminListReviews: vi.fn(),
  adminListProducts: vi.fn<(token: string, query?: { status?: string; stock?: string }) => Promise<unknown>>(),
  adminListCustomers: vi.fn<(token: string, query?: { pageSize?: number }) => Promise<unknown>>(),
  adminCheckoutMetrics: vi.fn(),
}));

type ReadOutcome = 'ok' | 'signed_out' | 'unavailable';
const read = vi.hoisted((): { outcome: ReadOutcome } => ({ outcome: 'ok' }));

vi.mock('@/lib/session', () => ({
  session: {
    // The real read() runs the call with the visitor's token; tests decide the outcome.
    read: async (call: (client: ApiClient, token: string) => Promise<unknown>) => {
      if (read.outcome !== 'ok') return { kind: read.outcome };
      return { kind: 'ok', value: await call(api as unknown as ApiClient, 'access-token') };
    },
  },
}));

const emptySummary = { orders: null, stock: null, moderation: null, sales: null };
const NOW = new Date('2026-11-15T06:00:00Z');
const last30 = parseReportRange({}, NOW);

beforeEach(() => {
  read.outcome = 'ok';
  api.adminDashboard.mockReset().mockResolvedValue(emptySummary);
  api.adminAnalyticsOverview
    .mockReset()
    .mockResolvedValue({ overview: analyticsOverview(30) });
  api.adminListOrders
    .mockReset()
    .mockResolvedValue({ orders: [], page: 1, pageSize: 6, total: 0, totalPages: 0 });
  api.adminAuditLog
    .mockReset()
    .mockResolvedValue({ entries: [], page: 1, pageSize: 8, total: 0, totalPages: 0 });
  api.adminListReviews.mockReset().mockResolvedValue(pendingReviews);
  api.adminListProducts.mockReset().mockImplementation((_token, query) => {
    const total = query?.stock === 'out' ? 7 : query?.status === 'active' ? 96 : 128;
    return Promise.resolve({ products: [], page: 1, pageSize: 1, total, totalPages: 1 });
  });
  api.adminListCustomers
    .mockReset()
    .mockResolvedValue({ customers: [], page: 1, pageSize: 1, total: 412, totalPages: 1 });
  api.adminCheckoutMetrics.mockReset().mockResolvedValue({
    metrics: {
      from: '2026-10-16T00:00:00.000Z',
      to: '2026-11-15T00:00:00.000Z',
      abandonedCount: 4,
      openCount: 2,
      recentCount: 1,
      potentialValueMinor: 120_000,
      recoveredCount: 1,
      recoveryRatePercent: 25,
      attemptCount: 3,
      contactedCount: 2,
      dismissedCount: 0,
      trackingSince: '2026-11-05T00:00:00.000Z',
    },
  });
});

describe('loadDashboard', () => {
  it('asks the owner for every panel, with one analytics read for the chosen range', async () => {
    const data = await loadDashboard(ROLE_PERMISSIONS.super_admin, last30);

    expect(api.adminDashboard).toHaveBeenCalledWith('access-token');
    expect(api.adminAnalyticsOverview).toHaveBeenCalledTimes(1);
    expect(api.adminAnalyticsOverview).toHaveBeenCalledWith('access-token', {
      from: '2026-10-17',
      to: '2026-11-15',
      compare: 'true',
    });
    expect(api.adminListOrders).toHaveBeenCalledWith('access-token', { pageSize: 6 });
    expect(api.adminAuditLog).toHaveBeenCalledWith('access-token', { pageSize: 8 });
    expect(api.adminListReviews).toHaveBeenCalledWith('access-token', {
      status: 'pending',
      pageSize: 4,
    });
    expect(api.adminListProducts.mock.calls.map(([, query]) => query)).toEqual([
      { pageSize: 1 },
      { pageSize: 1, status: 'active' },
      { pageSize: 1, stock: 'out' },
    ]);
    expect(api.adminListCustomers).toHaveBeenCalledWith('access-token', { pageSize: 1 });
    expect(data.analytics?.kind).toBe('ok');
    expect(data.range).toBe(last30);
    expect(data.pendingReviews).toEqual({ kind: 'ok', value: pendingReviews });
    expect(data.catalogue).toEqual({
      kind: 'ok',
      value: { products: 128, activeProducts: 96, outOfStock: 7, customers: 412 },
    });
  });

  it('passes a custom range without a comparison through unchanged', async () => {
    const custom = parseReportRange(
      { range: 'custom', from: '2026-10-01', to: '2026-10-31', compare: '0' },
      NOW,
    );
    await loadDashboard(ROLE_PERMISSIONS.super_admin, custom);
    expect(api.adminAnalyticsOverview).toHaveBeenCalledWith('access-token', {
      from: '2026-10-01',
      to: '2026-10-31',
      compare: 'false',
    });
  });

  it('never asks for analytics, reviews or the audit log without those permissions', async () => {
    const data = await loadDashboard(ROLE_PERMISSIONS.staff, last30);

    expect(api.adminAnalyticsOverview).not.toHaveBeenCalled();
    expect(api.adminAuditLog).not.toHaveBeenCalled();
    expect(api.adminListReviews).not.toHaveBeenCalled();
    expect(api.adminListOrders).toHaveBeenCalled();
    expect(data.analytics).toBeNull();
    expect(data.activity).toBeNull();
    expect(data.pendingReviews).toBeNull();
    expect(data.catalogue?.kind).toBe('ok');
  });

  it('asks only for the catalogue lists the account may read', async () => {
    const data = await loadDashboard(ROLE_PERMISSIONS.moderator, last30);

    expect(api.adminListProducts).toHaveBeenCalled();
    expect(api.adminListCustomers).not.toHaveBeenCalled();
    expect(data.catalogue).toEqual({
      kind: 'ok',
      value: { products: 128, activeProducts: 96, outOfStock: 7, customers: null },
    });
  });

  it('asks only for the summary when the account holds no panel permission', async () => {
    const data = await loadDashboard(['admin_workspace.access'], last30);

    expect(api.adminDashboard).toHaveBeenCalled();
    expect(api.adminListOrders).not.toHaveBeenCalled();
    expect(api.adminListProducts).not.toHaveBeenCalled();
    expect(api.adminListCustomers).not.toHaveBeenCalled();
    expect(data.recentOrders).toBeNull();
    expect(data.catalogue).toBeNull();
    expect(data.analytics).toBeNull();
  });

  it('reports an API refusal as forbidden instead of failing the page', async () => {
    api.adminAuditLog.mockRejectedValue(new ApiError(403, 'forbidden', 'Missing permission'));
    const data = await loadDashboard(ROLE_PERMISSIONS.admin, last30);

    expect(data.activity).toEqual({ kind: 'forbidden' });
    expect(data.summary.kind).toBe('ok');
  });

  it('reports an unreachable API per panel, and a lapsed session for the page', async () => {
    read.outcome = 'unavailable';
    const unavailable = await loadDashboard(ROLE_PERMISSIONS.admin, last30);
    expect(unavailable.summary).toEqual({ kind: 'unavailable' });
    expect(unavailable.analytics).toEqual({ kind: 'unavailable' });
    expect(unavailable.catalogue).toEqual({ kind: 'unavailable' });
    expect(signedOut(unavailable)).toBe(false);

    read.outcome = 'signed_out';
    expect(signedOut(await loadDashboard(ROLE_PERMISSIONS.admin, last30))).toBe(true);
  });
});
