// @vitest-environment jsdom
import type { AdminCoupon, CustomerInsight } from '@nilzora/contracts';
import type { ApiClient } from '@nilzora/web-session';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CustomerViewsModule from '@/components/customers/customer-views';
import type * as OrdersResultsModule from '@/components/orders/orders-results';
import CheckoutsPage from '@/app/admin/checkouts/page';
import CodCollectionsPage from '@/app/admin/cod-collections/page';
import CouponsPage from '@/app/admin/coupons/page';
import NewCouponPage from '@/app/admin/coupons/new/page';
import CustomerInsightsPage from '@/app/admin/customers/insights/page';
import CustomersPage from '@/app/admin/customers/page';
import OrdersPage from '@/app/admin/orders/page';
import { exportRange } from '@/lib/export-range';
import { testUser } from '@/test/fixtures';
import { RedirectSignal } from '@/test/redirect';
import { apiPageFor } from './cod-collections';
import { adminOrder, orderSummary } from './fixtures';
import { CustomersTable } from '@/components/customers/customer-views';
import { OrderDetailView } from './order-detail';

/*
 * Page-level checks of the sales area: each page tests its own permission before calling
 * the API, exports appear only for accounts that hold the report's permission, and the
 * COD collections list reads "cash to collect" from the oldest end.
 */

const api = vi.hoisted(() => ({
  adminListOrders: vi.fn(),
  adminGetCustomer: vi.fn(),
  adminListCustomers: vi.fn(),
  adminCustomerInsights: vi.fn(),
  adminListCoupons: vi.fn(),
  adminListCategories: vi.fn(() => Promise.resolve({ categories: [] })),
  adminListBrands: vi.fn(() => Promise.resolve({ brands: [] })),
  adminListProducts: vi.fn(() =>
    Promise.resolve({ products: [], page: 1, pageSize: 50, total: 0, totalPages: 0 }),
  ),
  adminListCheckouts: vi.fn(),
  adminCheckoutMetrics: vi.fn(),
}));
const read = vi.hoisted((): { outcome: 'ok' | 'signed_out' | 'unavailable' } => ({
  outcome: 'ok',
}));
const gate = vi.hoisted((): { value: unknown } => ({ value: undefined }));

vi.mock('@/lib/session', () => ({
  session: {
    read: async (call: (client: ApiClient, token: string) => Promise<unknown>) => {
      if (read.outcome !== 'ok') return { kind: read.outcome };
      return { kind: 'ok', value: await call(api as unknown as ApiClient, 'access-token') };
    },
  },
}));
vi.mock('@/lib/access', () => ({ workspaceGate: () => Promise.resolve(gate.value) }));
vi.mock('@/lib/order-actions', () => ({
  changeOrderStatusAction: vi.fn(),
  recordCodCollectionAction: vi.fn(),
}));
vi.mock('@/lib/coupon-actions', () => ({
  saveCouponAction: vi.fn(),
  setCouponActiveAction: vi.fn(),
}));
vi.mock('@/lib/customer-actions', () => ({ setCustomerStatusAction: vi.fn() }));
vi.mock('@/lib/actions', () => ({ signInAction: vi.fn(), signOutAction: vi.fn() }));
// The pages read their results in async Server Components inside Suspense; those are
// covered directly in orders.test.tsx and customers.test.tsx.
vi.mock('@/components/orders/orders-results', async () => ({
  ...(await vi.importActual<typeof OrdersResultsModule>(
    '@/components/orders/orders-results',
  )),
  OrdersResults: () => <p>Order results</p>,
}));
vi.mock('@/components/customers/customer-views', async () => ({
  ...(await vi.importActual<typeof CustomerViewsModule>(
    '@/components/customers/customer-views',
  )),
  CustomersResults: () => <p>Customer results</p>,
}));
vi.mock('@/components/shell/workspace-shell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('next/navigation', async () => {
  const { throwRedirect } = await import('@/test/redirect');
  return { redirect: vi.fn(throwRedirect), usePathname: () => '/' };
});
vi.mock('next/form', () => ({
  default: ({ action, ...props }: ComponentProps<'form'> & { action: string }) => (
    <form action={action} method="get" {...props} />
  ),
}));

const csrf = { name: 'csrf_token', token: 'signed-test-token' };
const withoutSales = testUser('moderator', { permissions: ['admin_workspace.access'] });

function props(searchParams: Record<string, string> = {}) {
  return { params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) } as never;
}

function signIn(user: ReturnType<typeof testUser>) {
  gate.value = { access: 'allowed', user, csrf };
}

function listOf<K extends string, T>(key: K, items: T[], total = items.length, page = 1) {
  return {
    [key]: items,
    page,
    pageSize: 25,
    total,
    totalPages: Math.max(1, Math.ceil(total / 25)),
  } as Record<K, T[]> & { page: number; pageSize: number; total: number; totalPages: number };
}

/** The download links of the export menu on the page. */
function exportLinks(): URL[] {
  return screen
    .queryAllByRole('link')
    .map((link) => link.getAttribute('href') ?? '')
    .filter((href) => href.startsWith('/api/reports/'))
    .map((href) => new URL(href, 'http://localhost:3001'));
}

beforeEach(() => {
  read.outcome = 'ok';
  for (const mock of Object.values(api)) mock.mockReset();
  signIn(testUser('admin'));
});
afterEach(cleanup);

describe('exportRange', () => {
  const now = new Date('2026-11-05T06:00:00.000Z');

  it('exports the last year ending today when the list has no dates', () => {
    expect(exportRange({}, now)).toEqual({ from: '2025-11-06', to: '2026-11-05' });
  });

  it('keeps a range the list has and fills a missing end', () => {
    expect(exportRange({ from: '2026-10-01', to: '2026-10-31' }, now)).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(exportRange({ from: '2026-10-01' }, now)).toEqual({ from: '2026-10-01', to: '2026-11-05' });
    expect(exportRange({ to: '2026-03-31' }, now)).toEqual({ from: '2025-04-01', to: '2026-03-31' });
  });

  it('cuts a range longer than a report allows to its latest days, never inverts one', () => {
    expect(exportRange({ from: '2020-01-01', to: '2026-11-05' }, now)).toEqual({
      from: '2025-11-05',
      to: '2026-11-05',
    });
    expect(exportRange({ from: '2027-01-01' }, now)).toEqual({ from: '2026-11-05', to: '2026-11-05' });
  });
});

describe('orders page', () => {
  it('exports with only the report’s filters, and always with both dates', async () => {
    render(
      await OrdersPage(
        props({
          status: 'pending',
          paymentStatus: 'pending',
          q: 'NZ1',
          customerId: '22222222-2222-4222-8222-222222222222',
        }),
      ),
    );

    const links = exportLinks();
    expect(links.map((url) => url.searchParams.get('format'))).toEqual(['csv', 'xlsx', 'pdf']);
    const first = links[0];
    expect(first?.pathname).toBe('/api/reports/orders');
    expect(first?.searchParams.get('status')).toBe('pending');
    expect(first?.searchParams.get('paymentStatus')).toBe('pending');
    expect(first?.searchParams.get('q')).toBe('NZ1');
    expect(first?.searchParams.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first?.searchParams.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The report has no customer filter, so none is passed.
    expect(first?.searchParams.has('customerId')).toBe(false);
  });

  it('exports the range the list is filtered to', async () => {
    render(await OrdersPage(props({ from: '2026-10-01', to: '2026-10-31' })));
    const first = exportLinks()[0];
    expect(first?.searchParams.get('from')).toBe('2026-10-01');
    expect(first?.searchParams.get('to')).toBe('2026-10-31');
  });

  it('shows no export and calls no API for an account without orders.read', async () => {
    signIn(withoutSales);
    render(await OrdersPage(props()));
    expect(exportLinks()).toEqual([]);
    expect(api.adminListOrders).not.toHaveBeenCalled();
  });
});

describe('order detail documents', () => {
  it('links the invoice and the packing slip as PDF downloads', () => {
    render(
      <OrderDetailView
        order={adminOrder()}
        permissions={testUser('staff').permissions}
        csrf={csrf}
      />,
    );
    const invoice = screen.getByRole('link', { name: 'Invoice (PDF)' });
    const slip = screen.getByRole('link', { name: 'Packing slip (PDF)' });
    expect(invoice.getAttribute('href')).toBe('/api/orders/NZ100042/invoice.pdf');
    expect(invoice.hasAttribute('download')).toBe(true);
    expect(slip.getAttribute('href')).toBe('/api/orders/NZ100042/packing-slip.pdf');
    expect(slip.hasAttribute('download')).toBe(true);
    // Printing the page still works.
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy();
  });
});

describe('COD collections page', () => {
  const OLDER = { ...orderSummary, orderNumber: 'NZ100001', status: 'delivered' as const };
  const NEWER = { ...orderSummary, orderNumber: 'NZ100002', status: 'delivered' as const };

  function mockOrders() {
    api.adminListOrders.mockImplementation(
      (_token: string, query: { pageSize: number; paymentStatus?: string; page: number }) => {
        if (query.pageSize === 1) {
          return Promise.resolve(listOf('orders', [], query.paymentStatus === 'collected' ? 3 : 60));
        }
        // The API lists newest first: the last page holds the oldest orders.
        return Promise.resolve(listOf('orders', [NEWER, OLDER], 60, query.page));
      },
    );
  }

  it('is forbidden without orders.read, before any API call', async () => {
    signIn(withoutSales);
    render(await CodCollectionsPage(props()));
    expect(screen.getByRole('heading', { level: 1, name: 'COD collections' })).toBeTruthy();
    expect(screen.getByText(/“View orders” permission/)).toBeTruthy();
    expect(api.adminListOrders).not.toHaveBeenCalled();
  });

  it('lists the delivered orders still waiting for cash, oldest first', async () => {
    mockOrders();
    render(await CodCollectionsPage(props({ page: '1' })));

    // Counts for both tabs, then the far end of the newest-first list: 60 orders = 3 pages.
    expect(api.adminListOrders).toHaveBeenCalledWith(
      'access-token',
      expect.objectContaining({ status: 'delivered', paymentStatus: 'pending', pageSize: 1 }),
    );
    expect(api.adminListOrders).toHaveBeenCalledWith(
      'access-token',
      expect.objectContaining({ paymentStatus: 'collected', pageSize: 1 }),
    );
    expect(api.adminListOrders).toHaveBeenCalledWith(
      'access-token',
      expect.objectContaining({
        status: 'delivered',
        paymentStatus: 'pending',
        page: 3,
        pageSize: 25,
      }),
    );
    const tabs = screen.getByRole('navigation', { name: 'Cash collection' });
    expect(within(tabs).getByRole('link', { name: /Cash to collect\s*60/ })).toBeTruthy();
    expect(within(tabs).getByRole('link', { name: /Collected\s*3/ })).toBeTruthy();

    const rows = within(screen.getByRole('table', { name: 'Cash to collect' })).getAllByRole('row');
    expect(within(rows[1] as HTMLElement).getByRole('link', { name: 'NZ100001' })).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByRole('link', { name: 'NZ100002' })).toBeTruthy();
    // Only what the page holds is added up, and it says so.
    expect(screen.getByText(/2 orders on this page add up to/)).toBeTruthy();
  });

  it('maps a page of the oldest-first list to the API page that holds it', () => {
    expect(apiPageFor('collect', 1, 3)).toBe(3);
    expect(apiPageFor('collect', 3, 3)).toBe(1);
    expect(apiPageFor('collected', 2, 3)).toBe(2);
  });

  it('offers Record cash per row to accounts holding payments.collect, and the finance export to finance.read', async () => {
    mockOrders();
    render(await CodCollectionsPage(props()));
    expect(screen.getAllByRole('button', { name: /^Record cash for NZ/ })).toHaveLength(2);
    const links = exportLinks();
    expect(links[0]?.pathname).toBe('/api/reports/cod_collections');
    // The report takes a search only: no status or payment filter.
    expect([...(links[0]?.searchParams.keys() ?? [])].sort()).toEqual(['format', 'from', 'to']);
    cleanup();

    // Staff read orders but hold neither payments.collect nor finance.read.
    signIn(testUser('staff'));
    render(await CodCollectionsPage(props()));
    expect(screen.queryByRole('button', { name: /^Record cash for NZ/ })).toBeNull();
    expect(exportLinks()).toEqual([]);
    expect(screen.getByRole('link', { name: 'NZ100001' })).toBeTruthy();
  });

  it('shows the collected tab newest first, without actions', async () => {
    mockOrders();
    render(await CodCollectionsPage(props({ tab: 'collected', q: 'NZ1' })));
    expect(api.adminListOrders).toHaveBeenCalledWith(
      'access-token',
      expect.objectContaining({ paymentStatus: 'collected', q: 'NZ1', page: 1, pageSize: 25 }),
    );
    expect(screen.queryByRole('button', { name: /^Record cash for NZ/ })).toBeNull();
    expect(screen.getByRole('table', { name: 'Collected cash' })).toBeTruthy();
  });

  it('says so when no cash is waiting, and sends a lapsed session to sign in', async () => {
    api.adminListOrders.mockResolvedValue(listOf('orders', [], 0));
    render(await CodCollectionsPage(props()));
    expect(screen.getByText('No cash waiting to be collected')).toBeTruthy();
    cleanup();

    read.outcome = 'signed_out';
    const error = await CodCollectionsPage(props()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RedirectSignal);
    expect((error as RedirectSignal).url).toBe('/login?next=%2Fadmin%2Fcod-collections');
  });

  it('shows the notice an earlier Record cash redirected with', async () => {
    mockOrders();
    render(await CodCollectionsPage(props({ notice: 'cash_collected' })));
    expect(screen.getByText(/The cash is recorded as collected/)).toBeTruthy();
  });
});

const coupon: AdminCoupon = {
  id: '55555555-5555-4555-8555-555555555555',
  code: 'EID25',
  description: null,
  kind: 'percent',
  value: 10,
  minOrderMinor: 0,
  maxDiscountMinor: null,
  startsAt: null,
  endsAt: null,
  totalLimit: null,
  perCustomerLimit: 1,
  isActive: true,
  state: 'active',
  redemptionCount: 2,
  totalDiscountMinor: 20_000,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

describe('coupons pages', () => {
  it('refuses the list without coupons.update, before any API call', async () => {
    signIn(testUser('staff'));
    render(await CouponsPage(props()));
    expect(screen.getByText(/“Edit coupons” permission/)).toBeTruthy();
    expect(api.adminListCoupons).not.toHaveBeenCalled();
    expect(exportLinks()).toEqual([]);
  });

  it('offers New coupon only with coupons.create, and exports the coupons report', async () => {
    api.adminListCoupons.mockResolvedValue(listOf('coupons', [coupon]));
    signIn(testUser('moderator', { permissions: ['admin_workspace.access', 'coupons.update'] }));
    render(await CouponsPage(props({ state: 'exhausted', q: 'EID' })));
    expect(screen.queryByRole('link', { name: 'New coupon' })).toBeNull();
    const links = exportLinks();
    expect(links[0]?.pathname).toBe('/api/reports/coupons');
    // Only the report's two states are passed on.
    expect(links[0]?.searchParams.has('status')).toBe(false);
    expect(links[0]?.searchParams.get('q')).toBe('EID');
    cleanup();

    signIn(testUser('admin'));
    render(await CouponsPage(props({ state: 'inactive' })));
    expect(screen.getByRole('link', { name: 'New coupon' }).getAttribute('href')).toBe(
      '/admin/coupons/new',
    );
    expect(exportLinks()[0]?.searchParams.get('status')).toBe('inactive');
  });

  it('needs coupons.create on top of coupons.update to open the new-coupon form', async () => {
    signIn(testUser('moderator', { permissions: ['admin_workspace.access', 'coupons.update'] }));
    render(await NewCouponPage());
    expect(screen.getByText(/“Create coupons” permission/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create coupon' })).toBeNull();
    cleanup();

    signIn(testUser('moderator', { permissions: ['admin_workspace.access', 'coupons.create'] }));
    render(await NewCouponPage());
    expect(screen.getByText(/“Edit coupons” permission/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create coupon' })).toBeNull();
    cleanup();

    signIn(testUser('admin'));
    render(await NewCouponPage());
    expect(screen.getByRole('button', { name: 'Create coupon' })).toBeTruthy();
  });
});

describe('customers pages', () => {
  const customer = { id: '22222222-2222-4222-8222-222222222222' };

  it('exports the customers report with the list’s search and status', async () => {
    render(await CustomersPage(props({ q: 'rahima', status: 'suspended' })));
    const links = exportLinks();
    expect(links[0]?.pathname).toBe('/api/reports/customers');
    expect(links[0]?.searchParams.get('status')).toBe('suspended');
    expect(links[0]?.searchParams.get('q')).toBe('rahima');
    expect(links[0]?.searchParams.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('draws the customers with their search and status filters in the table panel', () => {
    render(
      <CustomersTable
        data={listOf(
          'customers',
          [
            {
              id: customer.id,
              email: 'rahima@example.test',
              fullName: 'Rahima Khatun',
              phone: null,
              status: 'active' as const,
              orderCount: 3,
              lastOrderAt: null,
        avatar: null,
        googleAvatar: null,
              createdAt: '2026-09-01T00:00:00.000Z',
            },
          ],
        )}
        filters={{ q: 'rahima' }}
        now={new Date('2026-11-05T00:00:00.000Z')}
      />,
    );
    const panel = screen.getByRole('region', { name: 'Customers' });
    expect(within(panel).getByRole('search', { name: 'Customer filters' })).toBeTruthy();
    expect(within(panel).getByRole('link', { name: 'Rahima Khatun' })).toBeTruthy();
    expect(within(panel).getByRole('link', { name: 'Search: “rahima”, remove filter' })).toBeTruthy();
    expect(within(panel).getByText('Showing 1–1 of 1 customers')).toBeTruthy();
  });

  it('refuses the list and the insight page without customers.read', async () => {
    signIn(withoutSales);
    render(await CustomersPage(props()));
    expect(screen.getByText(/“View customers” permission/)).toBeTruthy();
    cleanup();
    render(await CustomerInsightsPage(props()));
    expect(screen.getByText(/“View customers” permission/)).toBeTruthy();
    expect(api.adminListCustomers).not.toHaveBeenCalled();
    expect(api.adminCustomerInsights).not.toHaveBeenCalled();
    expect(exportLinks()).toEqual([]);
  });

  it('shows spending and segment chips on the insight page, and ignores an empty search', async () => {
    const insight: CustomerInsight = {
      id: customer.id,
      fullName: 'Rahima Khatun',
      email: 'rahima@example.test',
      ordersCount: 4,
      completedOrders: 3,
      spendMinor: 1_250_000,
      averageOrderMinor: 312_500,
      firstOrderAt: '2026-08-01T00:00:00.000Z',
      lastOrderAt: '2026-10-20T00:00:00.000Z',
      segments: ['repeat', 'high_spender'],
    };
    api.adminCustomerInsights.mockResolvedValue({ ...listOf('customers', [insight]) });
    render(
      await CustomerInsightsPage({
        searchParams: Promise.resolve({ q: '', segment: 'repeat', page: '2' }),
      }),
    );
    expect(api.adminCustomerInsights).toHaveBeenCalledWith('access-token', {
      segment: 'repeat',
      q: '',
      page: 2,
      pageSize: 25,
    });
    const table = screen.getByRole('table', { name: 'Customer spending and segments' });
    expect(within(table).getByText('৳12,500')).toBeTruthy();
    // The chips carry the contract's text, which says how each segment is decided.
    expect(within(table).getByText('Has ordered again')).toBeTruthy();
    expect(within(table).getByText('Spending above the store threshold')).toBeTruthy();
    const tabs = screen.getByRole('navigation', { name: 'Customer segment' });
    expect(within(tabs).getByRole('link', { name: 'Repeat' }).getAttribute('aria-current')).toBe('page');
    expect(within(tabs).getByRole('link', { name: 'High spender' }).getAttribute('href')).toBe(
      '/admin/customers/insights?segment=high_spender',
    );
  });

  it('tells the reader the insight is unavailable instead of a made-up table', async () => {
    read.outcome = 'unavailable';
    render(await CustomerInsightsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText('This information is unavailable right now')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('checkouts page', () => {
  it('ignores an emptied search and shows the stage tabs', async () => {
    api.adminListCheckouts.mockResolvedValue(listOf('checkouts', []));
    api.adminCheckoutMetrics.mockResolvedValue({
      metrics: {
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-30T00:00:00.000Z',
        abandonedCount: 0,
        openCount: 0,
        recentCount: 0,
        potentialValueMinor: 0,
        recoveredCount: 0,
        recoveryRatePercent: null,
        attemptCount: 0,
        contactedCount: 0,
        dismissedCount: 0,
        trackingSince: null,
      },
    });
    render(await CheckoutsPage({ searchParams: Promise.resolve({ q: '', status: 'incomplete' }) }));
    expect(api.adminListCheckouts).toHaveBeenCalledWith('access-token', {
      status: 'incomplete',
      q: '',
      from: '',
      to: '',
      sort: 'recent',
      page: 1,
      pageSize: 25,
    });
    expect(screen.getByRole('navigation', { name: 'Checkout stage' })).toBeTruthy();
    expect(screen.getByText('No checkout attempts match this view.')).toBeTruthy();
  });
});
