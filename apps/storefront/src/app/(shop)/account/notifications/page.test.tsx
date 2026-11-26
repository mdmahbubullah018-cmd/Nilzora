import type {
  CustomerNotification,
  CustomerNotificationListResponse,
  CustomerNotificationQuery,
} from '@nilzora/contracts';
import type { SessionCall, SessionRead } from '@nilzora/web-session';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeRead, signedIn } from '@/testing/commerce-fixtures';
import AccountNotificationsPage from './page';

/*
 * The website inbox: courier shipment updates have their own kind, icon, label and
 * category tab, and open the order they are about, like an order update.
 */

const api = vi.hoisted(() => ({
  myNotifications:
    vi.fn<
      (token: string, query: CustomerNotificationQuery) => Promise<CustomerNotificationListResponse>
    >(),
}));

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePathname: () => '/account/notifications',
}));

vi.mock('@/lib/session', () => ({
  session: {
    getSession: () => Promise.resolve(signedIn),
    read: <T,>(call: SessionCall<T>): Promise<SessionRead<T>> => fakeRead(api as never, call),
  },
}));

function notification(overrides: Partial<CustomerNotification> = {}): CustomerNotification {
  return {
    id: '0d000000-0000-4000-8000-000000000001',
    kind: 'shipment_update',
    title: 'Out for delivery',
    body: 'Order NZ100042 is out for delivery with Steadfast Courier.',
    entityType: 'order',
    entityId: '0d000000-0000-4000-8000-0000000000aa',
    actionPath: '/account/orders/NZ100042',
    readAt: null,
    createdAt: '2026-11-11T09:00:00.000Z',
    ...overrides,
  };
}

function inbox(notifications: CustomerNotification[]): CustomerNotificationListResponse {
  return {
    notifications,
    unread: notifications.filter((row) => row.readAt === null).length,
    page: 1,
    pageSize: 20,
    total: notifications.length,
    totalPages: 1,
  };
}

function page(params: Record<string, string> = {}) {
  return AccountNotificationsPage({ searchParams: Promise.resolve(params) });
}

beforeEach(() => {
  api.myNotifications.mockReset();
});

describe('Notifications page', () => {
  it('shows a shipment update as Shipping, linking to its order like an order update', async () => {
    api.myNotifications.mockResolvedValue(
      inbox([
        notification(),
        notification({
          id: '0d000000-0000-4000-8000-000000000002',
          kind: 'order_update',
          title: 'Order confirmed',
          body: null,
          readAt: '2026-11-11T10:00:00.000Z',
        }),
      ]),
    );

    render(await page());

    const list = screen.getByRole('list', { name: 'Notifications' });
    const shipping = within(list).getByRole('link', { name: /Out for delivery/ });
    expect(shipping.getAttribute('href')).toBe('/account/orders/NZ100042');
    expect(within(shipping).getByText('Shipping')).not.toBeNull();
    expect(within(shipping).getByText('Unread')).not.toBeNull();
    const order = within(list).getByRole('link', { name: /Order confirmed/ });
    expect(order.getAttribute('href')).toBe('/account/orders/NZ100042');
  });

  it('filters by the Shipping category through the API', async () => {
    api.myNotifications.mockResolvedValue(inbox([]));

    render(await page({ kind: 'shipment_update' }));

    expect(api.myNotifications).toHaveBeenCalledWith('access-token', {
      page: 1,
      pageSize: 20,
      kind: 'shipment_update',
    });
    const tab = screen.getByRole('tab', { name: 'Shipping' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(tab.getAttribute('href')).toBe('/account/notifications?kind=shipment_update');
    expect(screen.getByText('No shipping updates yet.')).not.toBeNull();
  });
});
