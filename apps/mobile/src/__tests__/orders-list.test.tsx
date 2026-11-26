import { ApiError } from '@nilzora/api-client';
import type { OrderListResponse, OrderSummary } from '@nilzora/contracts';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import OrdersScreen from '../../app/orders';
import { ORDERS_PAGE_SIZE } from '../features/orders/orders-list';
import { createFakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock, router } from '../test-utils/expo-router-mock';
import { refreshList } from '../test-utils/refresh';
import { renderWithProviders } from '../test-utils/render-with-providers';
import { FAKE_ACCESS_TOKEN } from '../test-utils/session-fakes';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

beforeEach(resetRouterMock);

function order(number: string, overrides: Partial<OrderSummary> = {}): OrderSummary {
  return {
    orderNumber: number,
    status: 'pending',
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    itemCount: 2,
    totalMinor: 125_000,
    placedAt: '2026-01-05T10:00:00.000Z',
    preview: [],
    ...overrides,
  };
}

function page(
  orders: OrderSummary[],
  paging: { page?: number; totalPages?: number; total?: number } = {},
): OrderListResponse {
  const { page: number = 1, totalPages = 1, total = orders.length } = paging;
  return { orders, page: number, pageSize: ORDERS_PAGE_SIZE, total, totalPages };
}

const FIRST = order('NZ100042');
const FIRST_LABEL =
  'Order NZ100042, Awaiting confirmation, placed 5 January 2026, 2 items, total 1,250 taka, Cash on delivery · Payment pending';

async function renderOrders(api = createFakeApiClient()) {
  return { ...(await renderWithProviders(<OrdersScreen />, { api })), api };
}

function scrollEnd() {
  return fireEvent(screen.getByTestId('orders-list'), 'endReached');
}

describe('Orders tab', () => {
  it('lists the customer’s orders, one accessible element per order', async () => {
    const api = createFakeApiClient();
    api.listOrders.mockResolvedValue(
      page([
        FIRST,
        order('NZ100041', {
          status: 'delivered',
          paymentStatus: 'collected',
          itemCount: 1,
          totalMinor: 99_950,
          placedAt: '2026-01-02T20:30:00.000Z',
        }),
      ]),
    );
    await renderOrders(api);

    expect(await screen.findByRole('button', { name: FIRST_LABEL })).toBeOnTheScreen();
    expect(
      screen.getByRole('button', {
        name: 'Order NZ100041, Delivered, placed 3 January 2026, 1 item, total 999 taka 50 poisha, Cash on delivery · Payment collected',
      }),
    ).toBeOnTheScreen();
    // The visible fragments of a row.
    expect(screen.getByText('NZ100042')).toBeOnTheScreen();
    expect(screen.getByText('5 January 2026 · 2 items')).toBeOnTheScreen();
    expect(screen.getByText('Awaiting confirmation')).toBeOnTheScreen();
    expect(screen.getByText('Cash on delivery · Payment pending')).toBeOnTheScreen();
    expect(screen.getByText('৳1,250')).toBeOnTheScreen();
    expect(screen.getByText('৳999.50')).toBeOnTheScreen();
  });

  it('shows what was ordered: pictures, names and the first variant', async () => {
    const api = createFakeApiClient();
    api.listOrders.mockResolvedValue(
      page([
        order('NZ100042', {
          preview: [
            {
              productName: 'Blue mug',
              variantLabel: 'Colour: Navy',
              quantity: 2,
              image: {
                url: 'https://media.example.com/products/p/1/full.webp',
                thumbUrl: 'https://media.example.com/products/p/1/thumb.webp',
                alt: null,
              },
            },
            { productName: 'Desk lamp', variantLabel: null, quantity: 1, image: null },
          ],
        }),
      ]),
    );
    await renderOrders(api);

    expect(await screen.findByText('Blue mug, Desk lamp')).toBeOnTheScreen();
    expect(screen.getByText('Colour: Navy')).toBeOnTheScreen();
    expect(screen.getByText('5 January 2026 · 2 items')).toBeOnTheScreen();
    expect(screen.getByText('৳1,250')).toBeOnTheScreen();
  });

  it('asks the API for the first page with the session’s token', async () => {
    const api = createFakeApiClient();
    api.listOrders.mockResolvedValue(page([FIRST]));
    await renderOrders(api);
    await screen.findByRole('button', { name: FIRST_LABEL });

    expect(api.listOrders).toHaveBeenCalledTimes(1);
    expect(api.listOrders).toHaveBeenCalledWith(
      FAKE_ACCESS_TOKEN,
      { page: 1, pageSize: ORDERS_PAGE_SIZE },
      expect.objectContaining({ signal: expect.anything() as unknown }),
    );
  });

  it('opens an order from its row', async () => {
    const api = createFakeApiClient();
    api.listOrders.mockResolvedValue(page([FIRST]));
    const { user } = await renderOrders(api);

    await user.press(await screen.findByRole('button', { name: FIRST_LABEL }));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/order/[orderNumber]',
      params: { orderNumber: 'NZ100042' },
    });
  });

  it('loads the next page when the end of the list is reached, and only while there is one', async () => {
    const api = createFakeApiClient();
    api.listOrders.mockImplementation((_token, query) =>
      Promise.resolve(
        query?.page === 2
          ? page([order('NZ100040')], { page: 2, totalPages: 2, total: 2 })
          : page([FIRST], { page: 1, totalPages: 2, total: 2 }),
      ),
    );
    await renderOrders(api);
    await screen.findByText('NZ100042');

    await scrollEnd();

    expect(await screen.findByText('NZ100040')).toBeOnTheScreen();
    expect(screen.getByText('NZ100042')).toBeOnTheScreen();
    expect(api.listOrders).toHaveBeenLastCalledWith(
      FAKE_ACCESS_TOKEN,
      { page: 2, pageSize: ORDERS_PAGE_SIZE },
      expect.anything(),
    );
    expect(api.listOrders).toHaveBeenCalledTimes(2);

    await scrollEnd();
    expect(api.listOrders).toHaveBeenCalledTimes(2);
  });

  it('shows an order once even if paging shifted it onto two pages', async () => {
    const api = createFakeApiClient();
    api.listOrders.mockImplementation((_token, query) =>
      Promise.resolve(
        query?.page === 2
          ? page([FIRST, order('NZ100040')], { page: 2, totalPages: 2, total: 3 })
          : page([FIRST], { page: 1, totalPages: 2, total: 3 }),
      ),
    );
    await renderOrders(api);
    await screen.findByText('NZ100042');
    await scrollEnd();

    expect(await screen.findByText('NZ100040')).toBeOnTheScreen();
    expect(screen.getAllByText('NZ100042')).toHaveLength(1);
  });

  it('keeps the loaded orders when the next page fails, and retries on request', async () => {
    const api = createFakeApiClient();
    api.listOrders.mockImplementation((_token, query) =>
      query?.page === 2
        ? Promise.reject(new ApiError(0, 'network_error', 'Could not reach the Nilzora API'))
        : Promise.resolve(page([FIRST], { page: 1, totalPages: 2, total: 2 })),
    );
    const { user } = await renderOrders(api);
    await screen.findByText('NZ100042');

    await scrollEnd();

    expect(await screen.findByText('Could not load more orders')).toBeOnTheScreen();
    expect(screen.getByText('NZ100042')).toBeOnTheScreen();
    // Scrolling again does not hammer the failing request.
    await scrollEnd();
    expect(api.listOrders).toHaveBeenCalledTimes(2);

    api.listOrders.mockImplementation(() =>
      Promise.resolve(page([order('NZ100040')], { page: 2, totalPages: 2, total: 2 })),
    );
    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('NZ100040')).toBeOnTheScreen();
    expect(screen.queryByText('Could not load more orders')).not.toBeOnTheScreen();
  });

  it('shows a skeleton while the orders load', async () => {
    const api = createFakeApiClient();
    api.listOrders.mockReturnValue(new Promise(() => undefined));
    await renderOrders(api);

    expect(
      await screen.findByRole('progressbar', { name: 'Loading your orders' }),
    ).toBeOnTheScreen();
  });

  it('says so, and offers the shop, when there are no orders yet', async () => {
    const api = createFakeApiClient();
    api.listOrders.mockResolvedValue(page([]));
    const { user } = await renderOrders(api);

    expect(await screen.findByRole('header', { name: 'No orders yet' })).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Start shopping' }));
    expect(router.push).toHaveBeenCalledWith('/shop');
  });

  it('explains a failure and retries from the error view', async () => {
    const api = createFakeApiClient();
    api.listOrders.mockRejectedValueOnce(new ApiError(0, 'network_error', 'offline'));
    const { user } = await renderOrders(api);

    expect(
      await screen.findByRole('header', { name: 'Nilzora could not be reached' }),
    ).toBeOnTheScreen();
    expect(screen.queryByText('No orders yet')).not.toBeOnTheScreen();

    api.listOrders.mockResolvedValue(page([FIRST]));
    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: FIRST_LABEL })).toBeOnTheScreen();
  });

  it('keeps the orders on screen when a refresh fails', async () => {
    const api = createFakeApiClient();
    api.listOrders.mockResolvedValueOnce(page([FIRST]));
    await renderOrders(api);
    await screen.findByText('NZ100042');

    api.listOrders.mockRejectedValue(new ApiError(0, 'timeout', 'slow'));
    await refreshList('orders-list');

    expect(await screen.findByText('Could not refresh')).toBeOnTheScreen();
    expect(screen.getByText('NZ100042')).toBeOnTheScreen();
  });

  it('pulls to refresh and shows the new order', async () => {
    const api = createFakeApiClient();
    api.listOrders.mockResolvedValueOnce(page([FIRST]));
    await renderOrders(api);
    await screen.findByText('NZ100042');

    api.listOrders.mockResolvedValue(page([order('NZ100043', { status: 'confirmed' }), FIRST]));
    await refreshList('orders-list');

    expect(await screen.findByText('NZ100043')).toBeOnTheScreen();
    await waitFor(() => {
      expect(api.listOrders).toHaveBeenCalledTimes(2);
    });
  });

  it('sends a signed-out visitor to sign in, and back here afterwards, without asking the API', async () => {
    const api = createFakeApiClient();
    const { user } = await renderWithProviders(<OrdersScreen />, {
      api,
      session: { status: 'signed_out' },
    });

    expect(screen.getByRole('header', { name: 'Sign in to Nilzora' })).toBeOnTheScreen();
    expect(screen.queryByText('No orders yet')).not.toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Sign in' }));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/orders' },
    });
    expect(api.listOrders).not.toHaveBeenCalled();
  });

  it('removes the orders from the screen when the session ends', async () => {
    const api = createFakeApiClient();
    api.listOrders.mockResolvedValue(page([FIRST]));
    const { setSession } = await renderOrders(api);
    await screen.findByText('NZ100042');

    await setSession({ status: 'signed_out' });

    expect(screen.queryByText('NZ100042')).not.toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Sign in to Nilzora' })).toBeOnTheScreen();
  });
});
