// @vitest-environment jsdom
import { ApiError, type ApiClient } from '@nilzora/web-session';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OrdersPage from '@/app/admin/orders/page';
import { ROLE_PERMISSIONS, testUser } from '@/test/fixtures';
import type { RedirectSignal } from '@/test/redirect';
import { changeOrderStatusAction } from '@/lib/order-actions';
import { OrderStatusActions } from './order-actions';
import { OrderDetailContent, OrderDetailView } from './order-detail';
import { OrdersResults } from './orders-results';
import { adminOrder, orderSummary } from './fixtures';

const api = vi.hoisted(() => ({
  adminListOrders: vi.fn(),
  adminGetOrder: vi.fn(),
  adminOrderInternal: vi.fn(() => Promise.resolve({ notes: [], archive: null })),
  adminGetCustomer: vi.fn(),
  adminListReturns: vi.fn(() => Promise.resolve({ returns: [] })),
  adminListRefunds: vi.fn(() => Promise.resolve({ refunds: [] })),
  adminGetReturn: vi.fn(),
  adminAuditLog: vi.fn(() => Promise.resolve({ entries: [], total: 0 })),
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
vi.mock('@/lib/actions', () => ({ signInAction: vi.fn(), signOutAction: vi.fn() }));
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
const now = new Date('2026-10-25T12:00:00.000Z');

beforeEach(() => {
  read.outcome = 'ok';
  api.adminListOrders.mockReset();
  api.adminGetOrder.mockReset();
  api.adminGetCustomer.mockReset();
});
afterEach(cleanup);

function pageProps(searchParams: Record<string, string> = {}) {
  return { params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) };
}

describe('OrdersPage', () => {
  it('explains a missing orders.read permission instead of listing orders', async () => {
    const user = testUser('moderator', {
      permissions: ['admin_workspace.access', 'products.read'],
    });
    gate.value = { access: 'allowed', user, csrf };
    render(await OrdersPage(pageProps()));
    expect(screen.getByRole('heading', { level: 1, name: 'Orders' })).toBeTruthy();
    expect(screen.getByText(/“View orders” permission/)).toBeTruthy();
    expect(api.adminListOrders).not.toHaveBeenCalled();
  });

  it('shows the access gate, not the workspace, when the gate refuses', async () => {
    gate.value = { access: 'unavailable', csrf };
    render(await OrdersPage(pageProps()));
    expect(screen.getByText('We could not confirm your access')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Orders' })).toBeNull();
  });
});

describe('OrdersResults', () => {
  it('lists orders with links to each and passes the filters on', async () => {
    api.adminListOrders.mockResolvedValue({
      orders: [orderSummary],
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
    });
    render(await OrdersResults({ filters: { status: 'pending', q: 'NZ1' }, page: 1, now }));
    expect(api.adminListOrders).toHaveBeenCalledWith('access-token', {
      status: 'pending',
      q: 'NZ1',
      page: 1,
      pageSize: 25,
    });
    // The table (md and up) and the phone list both carry the order, each as one link.
    const links = screen.getAllByRole('link', { name: 'NZ100042' });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link.getAttribute('href')).toBe('/admin/orders/NZ100042');
    expect(screen.getByText('Showing 1–1 of 1 orders')).toBeTruthy();
  });

  it('shows a figure on each status tab, counted under the other filters', async () => {
    api.adminListOrders.mockImplementation(
      (_token: string, query: { pageSize: number; status?: string }) =>
        Promise.resolve({
          orders: query.pageSize === 1 ? [] : [orderSummary],
          page: 1,
          pageSize: query.pageSize,
          total: query.status === 'pending' ? 4 : query.status ? 0 : 9,
          totalPages: 1,
        }),
    );
    render(
      await OrdersResults({
        filters: { status: 'pending', paymentStatus: 'pending', q: 'NZ1' },
        page: 1,
        now,
      }),
    );

    const tabs = screen.getByRole('navigation', { name: 'Order status' });
    expect(within(tabs).getByRole('link', { name: /All orders\s*9/ })).toBeTruthy();
    expect(within(tabs).getByRole('link', { name: /Pending\s*4/ })).toBeTruthy();
    expect(within(tabs).getByRole('link', { name: /Delivered\s*0/ })).toBeTruthy();
    // Each count asks for one row, keeps the other filters and swaps only the status.
    expect(api.adminListOrders).toHaveBeenCalledWith('access-token', {
      paymentStatus: 'pending',
      q: 'NZ1',
      status: 'delivered',
      page: 1,
      pageSize: 1,
    });
    expect(api.adminListOrders).toHaveBeenCalledWith('access-token', {
      paymentStatus: 'pending',
      q: 'NZ1',
      page: 1,
      pageSize: 1,
    });
  });

  it('leaves a tab without a figure when its count cannot be read, and still lists the orders', async () => {
    api.adminListOrders.mockImplementation((_token: string, query: { pageSize: number }) =>
      query.pageSize === 1
        ? Promise.reject(new ApiError(429, 'rate_limited', 'slow down'))
        : Promise.resolve({
            orders: [orderSummary],
            page: 1,
            pageSize: 25,
            total: 1,
            totalPages: 1,
          }),
    );
    render(await OrdersResults({ filters: {}, page: 1, now }));

    const tabs = screen.getByRole('navigation', { name: 'Order status' });
    expect(within(tabs).getByRole('link', { name: 'All orders' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'NZ100042' }).length).toBeGreaterThan(0);
  });

  it('shows what each order holds: product, options, quantity, more lines, and its coupon', async () => {
    api.adminListOrders.mockResolvedValue({
      orders: [
        {
          ...orderSummary,
          itemCount: 4,
          discountMinor: 5_000,
          coupon: {
            couponId: '33333333-3333-4333-8333-333333333333',
            code: 'EID50',
            title: null,
            isVoucher: false,
            discountMinor: 5_000,
          },
          preview: [
            {
              productName: 'Cotton Panjabi',
              variantLabel: 'Size: M / Colour: Navy',
              variantOptions: [
                { name: 'Size', value: 'M' },
                { name: 'Colour', value: 'Navy' },
              ],
              quantity: 2,
              image: null,
            },
            { productName: 'Prayer cap', variantLabel: null, quantity: 1, image: null },
          ],
        },
      ],
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
    });
    render(await OrdersResults({ filters: {}, page: 1, now }));

    expect(screen.getAllByText('Cotton Panjabi').length).toBeGreaterThan(0);
    // Every chosen option is its own labelled chip, and the quantity stands beside them.
    const chosen = within(
      screen.getAllByRole('list', { name: 'Chosen options' })[0] as HTMLElement,
    );
    expect(chosen.getByText('Size')).toBeTruthy();
    expect(chosen.getByText('M')).toBeTruthy();
    expect(chosen.getByText('Colour')).toBeTruthy();
    expect(chosen.getByText('Navy')).toBeTruthy();
    expect(screen.getAllByText('× 2').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/and 1 more line · 4 items/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('EID50').length).toBeGreaterThan(0);
  });

  it('names the customer in a removable chip for the customer filter', async () => {
    api.adminListOrders.mockResolvedValue({
      orders: [orderSummary],
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
    });
    api.adminGetCustomer.mockResolvedValue({
      customer: { fullName: 'Test Customer', email: 'customer@example.test' },
    });
    const customerId = '22222222-2222-4222-8222-222222222222';
    render(await OrdersResults({ filters: { customerId }, page: 1, now, canReadCustomers: true }));
    expect(api.adminListOrders).toHaveBeenCalledWith('access-token', {
      customerId,
      page: 1,
      pageSize: 25,
    });
    expect(
      screen
        .getByRole('link', { name: 'Customer: Test Customer, remove filter' })
        .getAttribute('href'),
    ).toBe('/admin/orders');
  });

  it('does not read the customer without customers.read', async () => {
    api.adminListOrders.mockResolvedValue({
      orders: [],
      page: 1,
      pageSize: 25,
      total: 0,
      totalPages: 0,
    });
    render(
      await OrdersResults({
        filters: { customerId: '22222222-2222-4222-8222-222222222222' },
        page: 1,
        now,
      }),
    );
    expect(api.adminGetCustomer).not.toHaveBeenCalled();
    expect(screen.getByText('Customer: one account')).toBeTruthy();
  });

  it('says when filters match nothing', async () => {
    api.adminListOrders.mockResolvedValue({
      orders: [],
      page: 1,
      pageSize: 25,
      total: 0,
      totalPages: 0,
    });
    render(await OrdersResults({ filters: { status: 'shipped' }, page: 1, now }));
    expect(screen.getByText('No orders match these filters')).toBeTruthy();
  });

  it.each([
    ['unavailable', 'This information is unavailable right now'],
    ['forbidden', 'You do not have access to this'],
  ] as const)('renders the %s state', async (kind, text) => {
    if (kind === 'unavailable') read.outcome = 'unavailable';
    else api.adminListOrders.mockRejectedValue(new ApiError(403, 'forbidden', 'x'));
    render(await OrdersResults({ filters: {}, page: 1, now }));
    expect(screen.getByText(text)).toBeTruthy();
  });

  it('sends a lapsed session to sign in', async () => {
    read.outcome = 'signed_out';
    const error = await OrdersResults({ filters: {}, page: 1, now }).catch((e: unknown) => e);
    expect((error as RedirectSignal).url).toBe('/login?next=%2Fadmin%2Forders');
  });
});

describe('OrderDetailView', () => {
  it('offers exactly the moves the API allows, each behind a confirmation', () => {
    render(
      <OrderDetailView order={adminOrder()} permissions={ROLE_PERMISSIONS.admin} csrf={csrf} />,
    );
    const steps = screen.getByRole('region', { name: 'Next steps' });
    expect(within(steps).getByText('Confirm order')).toBeTruthy();
    expect(within(steps).getByText('Cancel order')).toBeTruthy();
    expect(within(steps).queryByText('Mark as shipped')).toBeNull();
    // The cancellation reason is required in the confirmation step.
    const reason = within(steps).getByLabelText(/Reason/);
    expect(reason.hasAttribute('required')).toBe(true);
    expect(reason.getAttribute('minlength')).toBe('5');
    expect(screen.queryByText('Record cash collected')).toBeNull();
  });

  it('shows each line with its options and the coupon behind the discount', () => {
    const base = adminOrder();
    const [line] = base.items;
    if (!line) throw new Error('fixture has no line');
    render(
      <OrderDetailView
        order={adminOrder({
          items: [
            {
              ...line,
              variantLabel: 'Size: M / Colour: Navy',
              variantOptions: [
                { name: 'Size', value: 'M' },
                { name: 'Colour', value: 'Navy' },
              ],
            },
          ],
          discountMinor: 5_000,
          coupon: {
            couponId: '33333333-3333-4333-8333-333333333333',
            code: 'EID50',
            title: 'Eid special',
            isVoucher: true,
            discountMinor: 5_000,
          },
        })}
        permissions={ROLE_PERMISSIONS.admin}
        csrf={csrf}
      />,
    );
    // The packing list and the items table both name the options the customer chose.
    const packing = screen.getByRole('region', { name: 'Packing list' });
    expect(within(packing).getByText('Size')).toBeTruthy();
    expect(within(packing).getByText('M')).toBeTruthy();
    expect(within(packing).getByText('Navy')).toBeTruthy();
    expect(within(packing).getByLabelText(/^Quantity \d+$/)).toBeTruthy();
    expect(screen.getByText('Voucher EID50')).toBeTruthy();
    expect(screen.getByText('Total payable (cash)')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open the voucher/ }).getAttribute('href')).toBe(
      '/admin/coupons/33333333-3333-4333-8333-333333333333',
    );
  });

  it('shows the items, totals, address, note and history', () => {
    render(
      <OrderDetailView order={adminOrder()} permissions={ROLE_PERMISSIONS.admin} csrf={csrf} />,
    );
    // Named once in the packing list and once in the items table.
    expect(screen.getAllByText('Test Kettle')).toHaveLength(2);
    expect(screen.getAllByText('৳2,580').length).toBeGreaterThan(0);
    expect(screen.getByText('Call before delivery')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'History of order NZ100042' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Test Customer' }).getAttribute('href')).toBe(
      '/admin/customers/22222222-2222-4222-8222-222222222222',
    );
  });

  it('records cash only when the API says it is collectable', () => {
    render(
      <OrderDetailView
        order={adminOrder({ status: 'delivered', allowedStatuses: [], canRecordCollection: true })}
        permissions={ROLE_PERMISSIONS.admin}
        csrf={csrf}
      />,
    );
    expect(screen.getByText('Record cash collected')).toBeTruthy();
    expect(screen.getByText(/This order is closed/)).toBeTruthy();
  });

  it('does not link the customer without customers.read and explains a read-only order', () => {
    render(
      <OrderDetailView
        order={adminOrder({ allowedStatuses: [] })}
        permissions={['admin_workspace.access', 'orders.read']}
        csrf={csrf}
      />,
    );
    expect(screen.queryByRole('link', { name: 'Test Customer' })).toBeNull();
    expect(screen.getByText(/cannot change this order’s status/)).toBeTruthy();
  });

  it('shows the cancellation reason of a cancelled order', () => {
    render(
      <OrderDetailView
        order={adminOrder({
          status: 'cancelled',
          paymentStatus: 'cancelled',
          cancelReason: 'Customer asked to cancel',
          cancelledAt: '2026-10-24T09:00:00.000Z',
          allowedStatuses: [],
        })}
        permissions={ROLE_PERMISSIONS.admin}
        csrf={csrf}
      />,
    );
    expect(screen.getByText(/Reason: Customer asked to cancel/)).toBeTruthy();
  });
});

describe('OrderDetailView hierarchy', () => {
  it('reads customer and delivery, items, courier, then activity, with the next step and payment beside them', () => {
    render(
      <OrderDetailView
        order={adminOrder()}
        permissions={ROLE_PERMISSIONS.admin}
        csrf={csrf}
        courier={<section aria-label="Shipment">Courier panel</section>}
      />,
    );
    const regions = screen
      .getAllByRole('region')
      .map(
        (region) => region.getAttribute('aria-label') ?? region.querySelector('h2')?.textContent,
      );
    expect(regions).toEqual([
      'Customer & delivery',
      'Packing list',
      'Items',
      'Shipment',
      'Activity',
      'Next steps',
      'Payment',
    ]);
    const delivery = screen.getByRole('region', { name: 'Customer & delivery' });
    expect(within(delivery).getByText('Test Recipient')).toBeTruthy();
    expect(within(delivery).getByText('Inside Dhaka')).toBeTruthy();
    const payment = screen.getByRole('region', { name: 'Payment' });
    expect(within(payment).getByText('COD due')).toBeTruthy();
    expect(within(payment).getByText('৳2,580')).toBeTruthy();
    expect(within(payment).getByText(/never marks it paid/)).toBeTruthy();
  });

  it('says no cash is due on a cancelled order', () => {
    render(
      <OrderDetailView
        order={adminOrder({
          status: 'cancelled',
          paymentStatus: 'cancelled',
          allowedStatuses: [],
        })}
        permissions={ROLE_PERMISSIONS.admin}
        csrf={csrf}
      />,
    );
    const payment = screen.getByRole('region', { name: 'Payment' });
    expect(within(payment).getByText('Nothing — the order was cancelled')).toBeTruthy();
  });
});

describe('OrderStatusActions', () => {
  it('shows a failure only in the panel of the step that failed', async () => {
    vi.mocked(changeOrderStatusAction).mockResolvedValue({
      status: 'error',
      message: 'This order has moved on.',
      values: { status: 'processing', note: 'packed' },
    });
    const { container } = render(
      <OrderStatusActions
        orderNumber="NZ100042"
        status="confirmed"
        allowedStatuses={['processing', 'shipped', 'cancelled']}
        csrf={csrf}
      />,
    );
    const form = container
      .querySelector('input[name="status"][value="processing"]')
      ?.closest('form');
    if (!form) throw new Error('no processing form');
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });
    const alerts = await screen.findAllByText('This order has moved on.');
    expect(alerts).toHaveLength(1);
    // The message sits in the form of the step that failed, not in the others.
    expect(
      alerts[0]?.closest('form')?.querySelector('input[name="status"]')?.getAttribute('value'),
    ).toBe('processing');
  });
});

describe('OrderDetailContent', () => {
  it('treats a malformed order number as not found without calling the API', async () => {
    render(
      await OrderDetailContent({ orderNumber: 'x', permissions: ROLE_PERMISSIONS.admin, csrf }),
    );
    expect(screen.getByRole('heading', { name: 'Order not found' })).toBeTruthy();
    expect(api.adminGetOrder).not.toHaveBeenCalled();
  });

  it('maps a 404 to not found', async () => {
    api.adminGetOrder.mockRejectedValue(new ApiError(404, 'not_found', 'x'));
    render(
      await OrderDetailContent({
        orderNumber: 'NZ100042',
        permissions: ROLE_PERMISSIONS.admin,
        csrf,
      }),
    );
    expect(screen.getByRole('heading', { name: 'Not found' })).toBeTruthy();
  });
});
