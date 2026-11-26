// @vitest-environment jsdom
import type { CheckoutDetail, CheckoutSummary } from '@nilzora/contracts';
import type { ApiClient } from '@nilzora/web-session';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CheckoutPage from '@/app/admin/checkouts/[checkoutId]/page';
import CheckoutsPage from '@/app/admin/checkouts/page';
import { testUser } from '@/test/fixtures';
import { CheckoutDetailView, CheckoutListView } from './checkout-views';

const api = vi.hoisted(() => ({
  adminListCheckouts: vi.fn(),
  adminGetCheckout: vi.fn(),
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
vi.mock('@/lib/actions', () => ({ signInAction: vi.fn(), signOutAction: vi.fn() }));
vi.mock('@/components/shell/workspace-shell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('next/navigation', async () => {
  const { throwNotFound, throwRedirect } = await import('@/test/redirect');
  return { redirect: vi.fn(throwRedirect), notFound: vi.fn(throwNotFound), usePathname: () => '/' };
});
vi.mock('next/form', () => ({
  default: ({ action, ...props }: ComponentProps<'form'> & { action: string }) => (
    <form action={action} method="get" {...props} />
  ),
}));

const csrf = { name: 'csrf_token', token: 'signed-test-token' };
const AT = '2026-11-05T10:00:00.000Z';

afterEach(cleanup);

const summary: CheckoutSummary = {
  id: 'c1111111-1111-4111-8111-111111111111',
  status: 'incomplete',
  recoveryState: 'open',
  customerName: 'Rahima Khatun',
  customerPhone: null,
  itemCount: 3,
  couponCode: 'EID10',
  cartValueMinor: 20_000,
  startedAt: AT,
  lastActivityAt: AT,
  abandonedAt: AT,
  convertedAt: null,
  orderNumber: null,
  attemptCount: 0,
};

const detail: CheckoutDetail = {
  ...summary,
  convertedAt: null,
  customer: { id: '00000000-0000-4000-8000-000000000002', name: 'Rahima Khatun', phone: null },
  attempts: [],
  link: null,
  items: [
    {
      productName: 'Desk Lamp',
      variantLabel: 'Colour: Red',
      sku: 'LAMP-RED',
      quantity: 2,
      unitPriceMinor: 10_000,
    },
  ],
};

describe('CheckoutListView', () => {
  it('names the stage in words and links each attempt to its detail', () => {
    render(
      <CheckoutListView
        checkouts={[summary]}
        metrics={null}
        filters={{ status: 'all', q: '', from: '', to: '', sort: 'recent' }}
        page={1}
        totalPages={1}
        total={1}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Checkout attempts (1)' })).toBeTruthy();
    const row = screen.getByRole('link', { name: 'Rahima Khatun' });
    expect(row.getAttribute('href')).toBe(`/admin/checkouts/${summary.id}`);
    const table = screen.getByRole('table');
    expect(within(table).getByText('Left before ordering')).toBeTruthy();
    expect(within(table).getByText('Needs contact')).toBeTruthy();
    expect(within(table).getByText('৳200')).toBeTruthy();
  });

  it('says so when nothing matches instead of showing an empty table', () => {
    render(
      <CheckoutListView
        checkouts={[]}
        metrics={null}
        filters={{ status: 'incomplete', q: 'nobody', from: '', to: '', sort: 'recent' }}
        page={1}
        totalPages={0}
        total={0}
      />,
    );
    expect(screen.getByText('No checkout attempts match this view.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
  it('pages through the queue and keeps the filters in each link', () => {
    render(
      <CheckoutListView
        checkouts={[summary]}
        metrics={null}
        filters={{ status: 'incomplete', q: 'rahima', from: '', to: '', sort: 'recent' }}
        page={2}
        totalPages={3}
        total={3}
      />,
    );
    const pager = screen.getByText('Page 2 of 3').parentElement;
    expect(pager).not.toBeNull();
    const previous = within(pager as HTMLElement).getByRole('link', { name: 'Previous' });
    const next = within(pager as HTMLElement).getByRole('link', { name: 'Next' });
    expect(previous.getAttribute('href')).toBe('/admin/checkouts?status=incomplete&q=rahima');
    expect(next.getAttribute('href')).toBe(
      '/admin/checkouts?status=incomplete&q=rahima&page=3',
    );
  });
});

describe('CheckoutDetailView', () => {
  it('shows the cart with its variant label and the current price', () => {
    render(<CheckoutDetailView checkout={detail} csrf={csrf} storefrontUrl="https://shop.test" canAct={false} />);

    expect(screen.getByRole('heading', { name: 'Rahima Khatun' })).toBeTruthy();
    expect(screen.getByText('Colour: Red')).toBeTruthy();
    expect(screen.getByText('LAMP-RED')).toBeTruthy();
    expect(screen.getByText('Not ordered')).toBeTruthy();
    expect(screen.getByText(/Current line value/)).toBeTruthy();
  });

  it('labels the cart value as current prices, never as an agreed total', () => {
    render(<CheckoutDetailView checkout={detail} csrf={csrf} storefrontUrl="https://shop.test" canAct={false} />);
    expect(screen.getByText(/No total is agreed until the order is placed/)).toBeTruthy();
  });
});

describe('CheckoutsPage', () => {
  beforeEach(() => {
    read.outcome = 'ok';
    api.adminListCheckouts.mockReset();
    api.adminGetCheckout.mockReset();
    api.adminCheckoutMetrics.mockReset();
    api.adminCheckoutMetrics.mockResolvedValue({
      metrics: {
        from: AT,
        to: AT,
        abandonedCount: 1,
        openCount: 1,
        recentCount: 1,
        potentialValueMinor: 20_000,
        recoveredCount: 0,
        recoveryRatePercent: 0,
        attemptCount: 0,
        contactedCount: 0,
        dismissedCount: 0,
        trackingSince: AT,
      },
    });
  });
  afterEach(cleanup);

  function listProps(searchParams: Record<string, string> = {}) {
    return { searchParams: Promise.resolve(searchParams) };
  }

  it('explains a missing orders.read permission instead of listing attempts', async () => {
    const user = testUser('moderator');
    gate.value = { access: 'allowed', user, csrf };
    render(await CheckoutsPage(listProps()));

    expect(screen.getByRole('heading', { level: 1, name: 'Checkouts' })).toBeTruthy();
    expect(screen.getByText(/“View orders” permission/)).toBeTruthy();
    expect(api.adminListCheckouts).not.toHaveBeenCalled();
  });

  it('passes the parsed filters to the API and draws the queue', async () => {
    gate.value = { access: 'allowed', user: testUser('staff'), csrf };
    api.adminListCheckouts.mockResolvedValue({
      checkouts: [summary],
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
    });

    render(await CheckoutsPage(listProps({ status: 'incomplete', q: 'rahima' })));

    expect(api.adminListCheckouts).toHaveBeenCalledWith('access-token', {
      status: 'incomplete',
      q: 'rahima',
      from: '',
      to: '',
      sort: 'recent',
      page: 1,
      pageSize: 25,
    });
    expect(screen.getByRole('link', { name: 'Rahima Khatun' })).toBeTruthy();
  });

  it('falls back to the default view for a query it cannot parse', async () => {
    gate.value = { access: 'allowed', user: testUser('staff'), csrf };
    api.adminListCheckouts.mockResolvedValue({
      checkouts: [],
      page: 1,
      pageSize: 25,
      total: 0,
      totalPages: 0,
    });

    render(await CheckoutsPage(listProps({ status: 'not-a-stage' })));

    expect(api.adminListCheckouts).toHaveBeenCalledWith('access-token', {
      status: 'all',
      q: '',
      from: '',
      to: '',
      sort: 'recent',
      page: 1,
      pageSize: 25,
    });
  });

  it('shows the access gate, not the workspace, when the gate refuses', async () => {
    gate.value = { access: 'unavailable', csrf };
    render(await CheckoutsPage(listProps()));
    expect(screen.getByText('We could not confirm your access')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Checkouts' })).toBeNull();
  });

  it('tells the reader the queue is unavailable rather than showing nothing', async () => {
    gate.value = { access: 'allowed', user: testUser('staff'), csrf };
    read.outcome = 'unavailable';
    render(await CheckoutsPage(listProps()));
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('CheckoutPage', () => {
  beforeEach(() => {
    read.outcome = 'ok';
    api.adminListCheckouts.mockReset();
    api.adminGetCheckout.mockReset();
  });
  afterEach(cleanup);

  function detailProps(checkoutId: string) {
    return { params: Promise.resolve({ checkoutId }) };
  }

  it('renders the attempt with its items', async () => {
    gate.value = { access: 'allowed', user: testUser('staff'), csrf };
    api.adminGetCheckout.mockResolvedValue({ checkout: detail });

    render(await CheckoutPage(detailProps(summary.id)));

    expect(api.adminGetCheckout).toHaveBeenCalledWith('access-token', summary.id);
    expect(screen.getByText('Colour: Red')).toBeTruthy();
  });

  it('refuses a permission it does not have before calling the API', async () => {
    gate.value = { access: 'allowed', user: testUser('moderator'), csrf };
    render(await CheckoutPage(detailProps(summary.id)));

    expect(screen.getByText(/“View orders” permission/)).toBeTruthy();
    expect(api.adminGetCheckout).not.toHaveBeenCalled();
  });

  it('answers 404 for an id that is not a uuid, without calling the API', async () => {
    gate.value = { access: 'allowed', user: testUser('staff'), csrf };
    await expect(CheckoutPage(detailProps('not-a-uuid'))).rejects.toMatchObject({
      digest: 'NEXT_NOT_FOUND',
    });
    expect(api.adminGetCheckout).not.toHaveBeenCalled();
  });
});
