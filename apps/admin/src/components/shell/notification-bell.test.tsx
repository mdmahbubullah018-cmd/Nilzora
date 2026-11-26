// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationBell, NotificationNavBadge } from './notification-bell';

interface Fake {
  outcome: 'ok' | 'unavailable' | 'forbidden';
  unread: number;
  notifications: Record<string, unknown>[];
  calls: unknown[][];
}

const read = vi.hoisted(
  (): Fake => ({ outcome: 'ok', unread: 0, notifications: [], calls: [] }),
);

vi.mock('@/lib/session', () => ({
  session: {
    read: (call: (api: unknown, token: string) => unknown) => {
      // Record what the bell asks the API for.
      call(
        {
          staffNotifications: (...args: unknown[]) => {
            read.calls.push(args);
            return Promise.resolve();
          },
        },
        'token',
      );
      return Promise.resolve(
        read.outcome === 'ok'
          ? {
              kind: 'ok',
              value: {
                notifications: read.notifications,
                unread: read.unread,
                page: 1,
                pageSize: 5,
                total: read.notifications.length,
                totalPages: 1,
              },
            }
          : { kind: read.outcome },
      );
    },
  },
}));

afterEach(cleanup);

beforeEach(() => {
  read.outcome = 'ok';
  read.unread = 0;
  read.notifications = [];
  read.calls = [];
});

const order = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'order_new',
  title: 'New order NZ100042',
  body: '2 items, ৳3,200',
  entityType: 'order',
  entityId: 'NZ100042',
  actionPath: '/admin/orders/NZ100042',
  readAt: null,
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
};

function trigger() {
  const summary = document.querySelector('summary');
  if (!summary) throw new Error('bell not rendered');
  return summary;
}

describe('NotificationBell', () => {
  it('reads the latest five notifications in one request', async () => {
    render(await NotificationBell());
    expect(read.calls).toEqual([['token', { pageSize: 5 }]]);
  });

  it('names the unread count and shows it on the bell', async () => {
    read.unread = 3;
    render(await NotificationBell());

    expect(trigger().getAttribute('aria-label')).toBe('Notifications, 3 unread');
    expect(trigger().textContent).toBe('3');
  });

  it('shows no badge when nothing is unread', async () => {
    render(await NotificationBell());

    expect(trigger().getAttribute('aria-label')).toBe('Notifications');
    expect(trigger().textContent).toBe('');
    expect(screen.getByText('All caught up')).toBeTruthy();
  });

  it('caps a long backlog at 99+', async () => {
    read.unread = 140;
    render(await NotificationBell());

    expect(trigger().getAttribute('aria-label')).toBe('Notifications, 140 unread');
    expect(trigger().textContent).toBe('99+');
  });

  it('previews the latest notifications, each linking to the page that acts on it', async () => {
    read.unread = 1;
    read.notifications = [order];
    render(await NotificationBell());

    const link = screen.getByRole('link', { name: /New order NZ100042/ });
    expect(link.getAttribute('href')).toBe('/admin/orders/NZ100042');
    expect(within(link).getByText('Unread')).toBeTruthy();
    expect(within(link).getByText('5 min ago')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the inbox' }).getAttribute('href')).toBe(
      '/admin/notifications',
    );
  });

  it('shows no number and says so when the inbox could not be read', async () => {
    read.outcome = 'unavailable';
    render(await NotificationBell());

    expect(trigger().textContent).toBe('');
    expect(screen.getByText('Notifications could not be loaded')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the inbox' })).toBeTruthy();
  });

  it('shows no number when the account may not read the inbox', async () => {
    read.outcome = 'forbidden';
    render(await NotificationBell());

    expect(trigger().getAttribute('aria-label')).toBe('Notifications');
    expect(trigger().textContent).toBe('');
  });
});

describe('NotificationNavBadge', () => {
  it('shows the unread count for the rail', async () => {
    read.unread = 4;
    const { container } = render(<>{await NotificationNavBadge()}</>);
    expect(container.textContent).toBe('4, 4 unread');
  });

  it('renders nothing at zero or when the count is unknown', async () => {
    expect(await NotificationNavBadge()).toBeNull();
    read.outcome = 'unavailable';
    expect(await NotificationNavBadge()).toBeNull();
  });
});
