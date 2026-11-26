import { render, screen } from '@testing-library/react';
import type {
  OrderListQuery,
  OrderListResponse,
  ReviewableItemsResponse,
} from '@nilzora/contracts';
import type { SessionCall, SessionRead } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchParams } from '@/lib/auth-params';
import { apiError, fakeRead, orderSummary, redirectedTo } from '@/testing/commerce-fixtures';
import OrdersPage from './page';

const api = vi.hoisted(() => ({
  listOrders: vi.fn<(token: string, query: OrderListQuery) => Promise<OrderListResponse>>(),
  pendingReviews: vi.fn<(token: string) => Promise<ReviewableItemsResponse>>(),
}));

vi.mock('@/lib/session', () => ({
  session: {
    read: <T,>(call: SessionCall<T>): Promise<SessionRead<T>> => fakeRead(api as never, call),
  },
}));

function listing(overrides: Partial<OrderListResponse> = {}): OrderListResponse {
  return {
    orders: [
      orderSummary(),
      orderSummary({
        orderNumber: 'NZ100041',
        status: 'delivered',
        paymentStatus: 'collected',
        itemCount: 1,
        totalMinor: 125_000,
        placedAt: '2026-10-20T04:00:00.000Z',
      }),
    ],
    page: 1,
    pageSize: 10,
    total: 2,
    totalPages: 1,
    ...overrides,
  };
}

async function renderPage(params: SearchParams = {}) {
  return render(await OrdersPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  api.listOrders.mockReset();
  api.listOrders.mockResolvedValue(listing());
  api.pendingReviews.mockReset();
  api.pendingReviews.mockResolvedValue({ items: [] });
});

describe('OrdersPage', () => {
  it('lists orders with number, date, status, items and total', async () => {
    await renderPage();

    expect(api.listOrders).toHaveBeenCalledWith('access-token', { page: 1, pageSize: 10 });
    expect(screen.getByRole('link', { name: 'Order NZ100042' }).getAttribute('href')).toBe(
      '/account/orders/NZ100042',
    );
    expect(screen.getByText('Awaiting confirmation')).not.toBeNull();
    expect(screen.getByText('Delivered')).not.toBeNull();
    expect(screen.getByText('24 October 2026')).not.toBeNull();
    expect(screen.getByText(/3 items/)).not.toBeNull();
    expect(screen.getByText(/1 item$/)).not.toBeNull();
    expect(screen.getByText('৳3,160')).not.toBeNull();
    // What was bought is recognisable at a glance: names, quantity and the line's picture.
    expect(screen.getAllByText('Brass table lamp, Ceramic mug').length).toBeGreaterThan(0);
    const pictures = [...document.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(pictures).toContain('https://media.example.com/products/p/1/thumb.webp');
    expect(screen.queryByRole('navigation', { name: 'Order pages' })).toBeNull();
  });

  it('pages through older orders', async () => {
    api.listOrders.mockResolvedValue(listing({ page: 2, total: 25, totalPages: 3 }));

    await renderPage({ page: '2' });

    expect(api.listOrders.mock.calls[0]?.[1]).toStrictEqual({ page: 2, pageSize: 10 });
    expect(screen.getByText('Page 2 of 3')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Previous page' }).getAttribute('href')).toBe(
      '/account/orders',
    );
    expect(screen.getByRole('link', { name: 'Next page' }).getAttribute('href')).toBe(
      '/account/orders?page=3',
    );
  });

  it.each([['0'], ['-1'], ['abc'], ['1001'], ['99999']])(
    'reads page %s as the first page',
    async (page) => {
      await renderPage({ page });
      expect(api.listOrders.mock.calls[0]?.[1].page).toBe(1);
    },
  );

  it('invites a first order', async () => {
    api.listOrders.mockResolvedValue(listing({ orders: [], total: 0, totalPages: 0 }));

    await renderPage();

    expect(screen.getByText('No orders yet')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Start shopping' }).getAttribute('href')).toBe(
      '/products',
    );
  });

  it('leads back from a page past the last one', async () => {
    api.listOrders.mockResolvedValue(listing({ orders: [], page: 9, total: 4, totalPages: 1 }));

    await renderPage({ page: '9' });

    expect(screen.getByText('There are no orders on this page')).not.toBeNull();
    expect(
      screen.getByRole('link', { name: 'Go to your latest orders' }).getAttribute('href'),
    ).toBe('/account/orders');
  });

  it('sends a signed-out visitor to sign in and back to the same page', async () => {
    api.listOrders.mockRejectedValue(apiError(401, 'unauthenticated'));

    await expect(
      OrdersPage({ searchParams: Promise.resolve({ page: '2' }) }),
    ).rejects.toMatchObject(redirectedTo('/login?next=%2Faccount%2Forders%3Fpage%3D2'));
  });

  it('explains a suspended account and an outage', async () => {
    api.listOrders.mockRejectedValueOnce(apiError(403, 'account_suspended'));
    const { unmount } = await renderPage();
    expect(screen.getByText('This account is suspended')).not.toBeNull();
    unmount();

    api.listOrders.mockRejectedValueOnce(apiError(0, 'timeout'));
    await renderPage();
    expect(screen.getByText('We could not load your orders')).not.toBeNull();
  });
});
