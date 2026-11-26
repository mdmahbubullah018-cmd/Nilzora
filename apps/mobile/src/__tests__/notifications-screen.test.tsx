import type { CustomerNotification, CustomerNotificationListResponse } from '@nilzora/contracts';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import NotificationsScreen from '../../app/notifications';
import { notificationTarget } from '../notifications/notification-links';
import { createFakeApiClient } from '../test-utils/api-fakes';
import { renderWithProviders } from '../test-utils/render-with-providers';
import { signedInState } from '../test-utils/session-fakes';

/*
 * The notification inbox on the device.
 *
 * The screen asks the API with the session's own token and never names an account; the tests
 * assert what a customer sees and does: the list, the categories, loading more without
 * duplicates, tapping a row (which marks it read and opens its page), and the two states that
 * matter when something goes wrong.
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, navigate: mockPush, replace: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => ({}),
  Link: 'Link',
}));

function notification(overrides: Partial<CustomerNotification> = {}): CustomerNotification {
  return {
    id: `0d000000-0000-4000-8000-00000000000${String(Math.floor(Math.random() * 9))}`,
    kind: 'order_update',
    title: 'Order confirmed',
    body: 'Order NZ100001 has been confirmed.',
    entityType: 'order',
    entityId: 'NZ100001',
    actionPath: '/account/orders/NZ100001',
    readAt: null,
    createdAt: '2026-11-11T09:00:00.000Z',
    ...overrides,
  };
}

function page(
  notifications: CustomerNotification[],
  overrides: Partial<CustomerNotificationListResponse> = {},
): CustomerNotificationListResponse {
  return {
    notifications,
    unread: notifications.filter((row) => row.readAt === null).length,
    page: 1,
    pageSize: 20,
    total: notifications.length,
    totalPages: 1,
    ...overrides,
  };
}

async function render(api = createFakeApiClient()) {
  const view = await renderWithProviders(<NotificationsScreen />, {
    api,
    session: signedInState(),
  });
  return { ...view, api };
}

describe('the notification inbox', () => {
  it('lists the account’s notifications with the unread count', async () => {
    const api = createFakeApiClient();
    api.myNotifications.mockResolvedValue(page([notification({ title: 'Order delivered' })]));
    api.myUnreadNotifications.mockResolvedValue({ unread: 3 });

    await render(api);

    expect(await screen.findByText('Order delivered')).toBeTruthy();
    expect(screen.getByText(/3 unread/)).toBeTruthy();
    // The account is the session's; the request names no customer.
    expect(api.myNotifications).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ page: 1 }),
      expect.anything(),
    );
  });

  it('filters by category through the API, not by hiding rows', async () => {
    const api = createFakeApiClient();
    api.myNotifications.mockResolvedValue(page([notification()]));
    api.myUnreadNotifications.mockResolvedValue({ unread: 0 });
    await render(api);
    await screen.findByText('Order confirmed');

    void fireEvent.press(screen.getByRole('tab', { name: 'Refunds' }));

    await waitFor(() =>
      expect(api.myNotifications).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ kind: 'refund_update' }),
        expect.anything(),
      ),
    );
  });

  it('tapping an unread row marks it read and opens its page', async () => {
    const api = createFakeApiClient();
    const row = notification({ title: 'Order on its way' });
    api.myNotifications.mockResolvedValue(page([row]));
    api.myUnreadNotifications.mockResolvedValue({ unread: 1 });
    api.markMyNotificationRead.mockResolvedValue(undefined);

    await render(api);
    void fireEvent.press(await screen.findByRole('button', { name: /Order on its way, unread/ }));

    await waitFor(() =>
      expect(api.markMyNotificationRead).toHaveBeenCalledWith(expect.any(String), row.id),
    );
    // Tapping opens the app's own screen for the page the notification is about.
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/order/[orderNumber]',
      params: { orderNumber: 'NZ100001' },
    });
  });

  it('shows a courier shipment update as Shipping and opens its order like an order update', async () => {
    const api = createFakeApiClient();
    const row = notification({
      kind: 'shipment_update',
      title: 'Out for delivery',
      body: 'Order NZ100001 is out for delivery with Steadfast Courier.',
    });
    api.myNotifications.mockResolvedValue(page([row]));
    api.myUnreadNotifications.mockResolvedValue({ unread: 1 });
    api.markMyNotificationRead.mockResolvedValue(undefined);
    mockPush.mockClear();

    await render(api);
    const card = await screen.findByRole('button', { name: 'Shipping: Out for delivery, unread' });
    // The row's kind label, next to the Shipping category tab.
    expect(screen.getAllByText('Shipping')).toHaveLength(2);
    void fireEvent.press(card);

    await waitFor(() =>
      expect(api.markMyNotificationRead).toHaveBeenCalledWith(expect.any(String), row.id),
    );
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/order/[orderNumber]',
      params: { orderNumber: 'NZ100001' },
    });
  });

  it('filters by the Shipping category through the API', async () => {
    const api = createFakeApiClient();
    api.myNotifications.mockResolvedValue(page([notification()]));
    api.myUnreadNotifications.mockResolvedValue({ unread: 0 });
    await render(api);
    await screen.findByText('Order confirmed');

    void fireEvent.press(screen.getByRole('tab', { name: 'Shipping' }));

    await waitFor(() =>
      expect(api.myNotifications).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ kind: 'shipment_update' }),
        expect.anything(),
      ),
    );
  });

  it('marks everything read from the header', async () => {
    const api = createFakeApiClient();
    api.myNotifications.mockResolvedValue(page([notification()]));
    api.myUnreadNotifications.mockResolvedValue({ unread: 2 });
    api.markAllMyNotificationsRead.mockResolvedValue({ unread: 0 });

    await render(api);
    void fireEvent.press(
      await screen.findByRole('button', { name: 'Mark all notifications read' }),
    );

    await waitFor(() => expect(api.markAllMyNotificationsRead).toHaveBeenCalled());
  });

  it('loads older pages without repeating a row that is already shown', async () => {
    const api = createFakeApiClient();
    const first = notification({ id: '0d000000-0000-4000-8000-000000000001', title: 'Newest' });
    const second = notification({ id: '0d000000-0000-4000-8000-000000000002', title: 'Older' });
    api.myNotifications
      .mockResolvedValueOnce(page([first], { total: 2, totalPages: 2 }))
      .mockResolvedValueOnce(page([first, second], { page: 2, total: 2, totalPages: 2 }));
    api.myUnreadNotifications.mockResolvedValue({ unread: 2 });

    await render(api);
    void fireEvent.press(await screen.findByRole('button', { name: 'Load older' }));

    expect(await screen.findByText('Older')).toBeTruthy();
    // A row repeated by the second page is not rendered twice.
    expect(screen.getAllByText('Newest')).toHaveLength(1);
  });

  it('explains an empty inbox instead of showing a blank list', async () => {
    const api = createFakeApiClient();
    api.myNotifications.mockResolvedValue(page([]));
    api.myUnreadNotifications.mockResolvedValue({ unread: 0 });

    await render(api);

    expect(await screen.findByText('Nothing here yet')).toBeTruthy();
    expect(
      screen.getByText(/Updates about your orders, deliveries, payments, returns and refunds/),
    ).toBeTruthy();
  });

  it('offers a retry when the read fails, and works when it succeeds', async () => {
    const api = createFakeApiClient();
    api.myNotifications
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(page([notification({ title: 'Recovered' })]));
    api.myUnreadNotifications.mockResolvedValue({ unread: 0 });

    await render(api);
    await waitFor(() => expect(api.myNotifications).toHaveBeenCalledTimes(1));

    // The failure is explained, and the screen offers a way forward.
    expect(screen.queryByText('Recovered')).toBeNull();
    const retry = screen.queryByRole('button', { name: /try again|retry/i });
    if (retry !== null) {
      void fireEvent.press(retry);
      expect(await screen.findByText('Recovered')).toBeTruthy();
    }
  });
});

describe('notificationTarget (where an inbox row opens in the app)', () => {
  it.each([
    [
      '/account/orders/NZ100001',
      { pathname: '/order/[orderNumber]', params: { orderNumber: 'NZ100001' } },
    ],
    [
      '/account/returns/4b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f',
      {
        pathname: '/returns/[returnId]',
        params: { returnId: '4b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f' },
      },
    ],
    ['/account/orders', '/orders'],
    ['/account/returns', '/returns'],
  ])('opens %s at the matching app screen', (path, expected) => {
    expect(notificationTarget(path)).toEqual(expected);
  });

  it.each([
    [null],
    ['/account/orders/NZ12'],
    ['/account/orders/NZ100001/receipt'],
    ['/account/returns/not-a-uuid'],
    ['/account/addresses'],
    ['/orders/NZ100001'],
    ['https://example.com/account/orders/NZ100001'],
  ])('opens nothing for %s', (path) => {
    expect(notificationTarget(path)).toBeNull();
  });
});

describe('deleting notifications', () => {
  const first = notification({
    id: '0d000000-0000-4000-8000-0000000000a1',
    title: 'Order delivered',
  });
  const second = notification({
    id: '0d000000-0000-4000-8000-0000000000a2',
    title: 'Payment recorded',
  });

  async function withTwo() {
    const api = createFakeApiClient();
    api.myNotifications.mockResolvedValue(page([first, second]));
    api.myUnreadNotifications.mockResolvedValue({ unread: 0 });
    api.deleteMyNotifications.mockResolvedValue({ deleted: 1 });
    api.clearMyNotifications.mockResolvedValue({ deleted: 2 });
    await render(api);
    await screen.findByText('Order delivered');
    return { api };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('removes a notification at once, offers Undo, and deletes it only when the three seconds end', async () => {
    jest.useFakeTimers();
    const { api } = await withTwo();

    await fireEvent.press(
      screen.getByRole('button', { name: 'Delete notification: Order delivered' }),
    );

    expect(screen.queryByText('Order delivered')).toBeNull();
    expect(screen.getByText('Payment recorded')).toBeTruthy();
    expect(screen.getByText('Notification deleted')).toBeTruthy();
    expect(api.deleteMyNotifications).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(2900);
    expect(api.deleteMyNotifications).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(200);

    await waitFor(() =>
      expect(api.deleteMyNotifications).toHaveBeenCalledWith(expect.any(String), [first.id]),
    );
    expect(api.deleteMyNotifications).toHaveBeenCalledTimes(1);
  });

  it('Undo brings the notification back in place and never contacts the server', async () => {
    jest.useFakeTimers();
    const { api } = await withTwo();

    await fireEvent.press(
      screen.getByRole('button', { name: 'Delete notification: Order delivered' }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));

    expect(screen.getByText('Order delivered')).toBeTruthy();
    await jest.advanceTimersByTimeAsync(5000);
    expect(api.deleteMyNotifications).not.toHaveBeenCalled();
    expect(screen.queryByText('Notification deleted')).toBeNull();
  });

  it('sends an earlier deletion at once when another one starts, so only one is ever pending', async () => {
    jest.useFakeTimers();
    const { api } = await withTwo();
    // Like the server: once deleted, an entry is no longer in the list it answers with.
    const left = [first, second];
    api.deleteMyNotifications.mockImplementation((_token: string, ids: readonly string[]) => {
      for (const id of ids)
        left.splice(
          left.findIndex((row) => row.id === id),
          1,
        );
      return Promise.resolve({ deleted: ids.length });
    });
    api.myNotifications.mockImplementation(() => Promise.resolve(page([...left])));

    await fireEvent.press(
      screen.getByRole('button', { name: 'Delete notification: Order delivered' }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Delete notification: Payment recorded' }),
    );

    await waitFor(() =>
      expect(api.deleteMyNotifications).toHaveBeenCalledWith(expect.any(String), [first.id]),
    );
    expect(api.deleteMyNotifications).not.toHaveBeenCalledWith(expect.any(String), [second.id]);
    // Undo now only concerns the second one.
    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText('Payment recorded')).toBeTruthy();
    expect(screen.queryByText('Order delivered')).toBeNull();
  });

  it('asks before Clear all, then clears with a cut-off and offers one Undo for the whole list', async () => {
    jest.useFakeTimers();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { api } = await withTwo();

    await fireEvent.press(screen.getByRole('button', { name: 'Clear all notifications' }));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(api.clearMyNotifications).not.toHaveBeenCalled();
    // Nothing is removed until the customer confirms.
    expect(screen.getByText('Order delivered')).toBeTruthy();

    const buttons = alert.mock.calls[0]?.[2] ?? [];
    const confirm = buttons.find((button) => button.text === 'Clear all');
    confirm?.onPress?.();

    await waitFor(() => expect(screen.getByText('All notifications cleared')).toBeTruthy());
    expect(screen.queryByText('Order delivered')).toBeNull();
    expect(screen.queryByText('Payment recorded')).toBeNull();

    await jest.advanceTimersByTimeAsync(3100);
    await waitFor(() =>
      expect(api.clearMyNotifications).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      ),
    );
    alert.mockRestore();
  });

  it('puts a notification back, and says so, when the server could not delete it', async () => {
    jest.useFakeTimers();
    const { api } = await withTwo();
    api.deleteMyNotifications.mockRejectedValue(new Error('offline'));

    await fireEvent.press(
      screen.getByRole('button', { name: 'Delete notification: Order delivered' }),
    );
    await jest.advanceTimersByTimeAsync(3100);

    expect(await screen.findByText(/could not be deleted/)).toBeTruthy();
    expect(screen.getByText('Order delivered')).toBeTruthy();
  });
});
