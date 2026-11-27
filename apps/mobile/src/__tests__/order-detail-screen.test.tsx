import { ApiError } from '@nilzora/api-client';
import type { OrderDetail } from '@nilzora/contracts';
import { act, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import OrderRoute from '../../app/order/[orderNumber]';
import { CANCEL_MESSAGES } from '../features/orders/cancel-order';
import { createFakeApiClient, type FakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock, router, searchParams } from '../test-utils/expo-router-mock';
import { refreshList } from '../test-utils/refresh';
import { renderWithProviders } from '../test-utils/render-with-providers';
import { CUSTOMER, FAKE_ACCESS_TOKEN } from '../test-utils/session-fakes';
import { queryKeys } from '../query/query-keys';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

const KURTA_ID = '0b9f7f5e-6a14-4c43-8d63-2d1e8f3b7a01';
const MUG_ID = '5a3c2f10-9d88-4b0e-a1d4-7e6f2c9b1b02';

const ORDER: OrderDetail = {
  orderNumber: 'NZ100042',
  status: 'pending',
  paymentMethod: 'cod',
  paymentStatus: 'pending',
  itemCount: 3,
  totalMinor: 130_000,
  placedAt: '2026-01-05T10:00:00.000Z',
  preview: [],
  currency: 'BDT',
  subtotalMinor: 125_000,
  shippingFeeMinor: 8_000,
  discountMinor: 3_000,
  deliveryZone: 'inside_dhaka',
  shippingAddress: {
    recipientName: 'Ayesha Rahman',
    phone: '+8801712345678',
    division: 'Dhaka',
    district: 'Dhaka',
    area: 'Dhanmondi',
    addressLine: 'House 12, Road 5',
    postalCode: '1205',
    landmark: 'Star Mosque',
  },
  customerNote: 'Please call before delivery',
  cancelReason: null,
  cancelledAt: null,
  items: [
    {
      orderItemId: 1,
      productId: KURTA_ID,
      variantId: null,
      variantLabel: null,
      productName: 'Cotton kurta',
      productSlug: 'cotton-kurta',
      sku: 'KUR-1',
      unitPriceMinor: 50_000,
      regularPriceMinor: null,
      catalogPriceMinor: null,
      campaignId: null,
      campaignTitle: null,
      campaignDiscountMinor: 0,
      image: null,
      quantity: 2,
      lineTotalMinor: 100_000,
    },
    {
      orderItemId: 2,
      productId: MUG_ID,
      variantId: null,
      variantLabel: null,
      productName: 'Blue mug',
      productSlug: '',
      sku: 'MUG-1',
      unitPriceMinor: 25_000,
      regularPriceMinor: null,
      catalogPriceMinor: null,
      campaignId: null,
      campaignTitle: null,
      campaignDiscountMinor: 0,
      image: null,
      quantity: 1,
      lineTotalMinor: 25_000,
    },
  ],
  history: [{ fromStatus: null, toStatus: 'pending', at: '2026-01-05T10:00:00.000Z' }],
  canCancel: true,
};

function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return { ...ORDER, ...overrides };
}

const CANCELLED = order({
  status: 'cancelled',
  paymentStatus: 'cancelled',
  canCancel: false,
  cancelReason: 'Ordered by mistake',
  cancelledAt: '2026-01-05T13:00:00.000Z',
  history: [
    { fromStatus: null, toStatus: 'pending', at: '2026-01-05T10:00:00.000Z' },
    { fromStatus: 'pending', toStatus: 'cancelled', at: '2026-01-05T13:00:00.000Z' },
  ],
});

beforeEach(() => {
  resetRouterMock();
  searchParams.orderNumber = 'NZ100042';
});

function apiWith(current: OrderDetail): FakeApiClient {
  const api = createFakeApiClient();
  api.getOrder.mockResolvedValue({ order: current });
  return api;
}

async function renderOrder(api: FakeApiClient) {
  const harness = await renderWithProviders(<OrderRoute />, { api });
  return { ...harness, api };
}

describe('Order screen', () => {
  it('shows the order: header, progress, items, totals, payment, address and note', async () => {
    const api = apiWith(
      order({
        status: 'confirmed',
        canCancel: false,
        history: [
          { fromStatus: null, toStatus: 'pending', at: '2026-01-05T10:00:00.000Z' },
          { fromStatus: 'pending', toStatus: 'confirmed', at: '2026-01-05T12:30:00.000Z' },
        ],
      }),
    );
    await renderOrder(api);

    expect(await screen.findByRole('header', { name: 'NZ100042' })).toBeOnTheScreen();
    expect(api.getOrder).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN, 'NZ100042', expect.anything());
    expect(screen.getByLabelText('Order status: Confirmed')).toBeOnTheScreen();
    expect(screen.getByText('Placed on 5 January 2026')).toBeOnTheScreen();

    // Progress, oldest first, in Bangladesh time.
    expect(screen.getByRole('header', { name: 'Order progress' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Order placed, 5 January 2026, 16:00')).toBeOnTheScreen();
    expect(screen.getByLabelText('Confirmed by Nilzora, 5 January 2026, 18:30')).toBeOnTheScreen();

    // Items as they were ordered, with the totals the server calculated.
    expect(screen.getByRole('header', { name: 'Items (3 items)' })).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Cotton kurta, quantity 2, 500 taka each, line total 1,000 taka'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Qty 2 · ৳500 each')).toBeOnTheScreen();
    expect(screen.getByText('SKU KUR-1')).toBeOnTheScreen();
    expect(screen.getByLabelText('Subtotal: 1,250 taka')).toBeOnTheScreen();
    expect(screen.getByLabelText('Delivery (Inside Dhaka): 80 taka')).toBeOnTheScreen();
    expect(screen.getByLabelText('Discount: minus 30 taka')).toBeOnTheScreen();
    expect(screen.getByLabelText('Total: 1,300 taka')).toBeOnTheScreen();

    // Cash on delivery, with payment tracked apart from the order.
    expect(screen.getByRole('header', { name: 'Payment' })).toBeOnTheScreen();
    expect(screen.getByText('Cash on delivery')).toBeOnTheScreen();
    expect(screen.getByLabelText('Payment status: Payment pending')).toBeOnTheScreen();
    expect(screen.getByText('Pay in cash when your parcel arrives.')).toBeOnTheScreen();

    // The address kept on the order, and the customer's note.
    expect(
      screen.getByLabelText(
        'Ayesha Rahman, House 12, Road 5, Near Star Mosque, Dhanmondi, Dhaka 1205, Dhaka Division, phone 01712-345678',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText('Please call before delivery')).toBeOnTheScreen();
  });

  it('leaves out the discount row, the note and a missing address detail when they are empty', async () => {
    const api = apiWith(
      order({
        discountMinor: 0,
        totalMinor: 133_000,
        customerNote: null,
        canCancel: false,
        shippingAddress: { ...ORDER.shippingAddress, landmark: null, postalCode: null },
      }),
    );
    await renderOrder(api);
    await screen.findByRole('header', { name: 'NZ100042' });

    expect(screen.queryByLabelText(/^Discount/)).not.toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Your note' })).not.toBeOnTheScreen();
    expect(
      screen.getByLabelText(
        'Ayesha Rahman, House 12, Road 5, Dhanmondi, Dhaka, Dhaka Division, phone 01712-345678',
      ),
    ).toBeOnTheScreen();
  });

  it('opens a product from its line only when the order kept a usable slug', async () => {
    const api = apiWith(order({ canCancel: false }));
    const { user } = await renderOrder(api);

    await user.press(
      await screen.findByRole('link', {
        name: 'Cotton kurta, quantity 2, 500 taka each, line total 1,000 taka',
      }),
    );

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/product/[slug]',
      params: { slug: 'cotton-kurta' },
    });
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(
      screen.getByLabelText('Blue mug, quantity 1, 250 taka each, line total 250 taka'),
    ).toBeOnTheScreen();
  });

  it('falls back to the moment of placing when the order has no history', async () => {
    const api = apiWith(order({ history: [], canCancel: false }));
    await renderOrder(api);

    expect(await screen.findByLabelText('Order placed, 5 January 2026, 16:00')).toBeOnTheScreen();
  });

  describe('after checkout (placed=1)', () => {
    it('shows and announces the "Order placed" banner', async () => {
      searchParams.placed = '1';
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
      announce.mockClear();
      await renderOrder(apiWith(order({ canCancel: false })));

      await screen.findByRole('header', { name: 'NZ100042' });
      // The banner's title and the first step of the progress.
      expect(screen.getAllByText('Order placed')).toHaveLength(2);
      expect(
        screen.getByText(/Pay in cash on delivery\. We will confirm your order soon/),
      ).toBeOnTheScreen();
      expect(announce).toHaveBeenCalledWith('Order placed');
    });

    it('shows no banner when the order is opened normally', async () => {
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
      announce.mockClear();
      await renderOrder(apiWith(order({ canCancel: false })));
      await screen.findByRole('header', { name: 'NZ100042' });

      expect(screen.queryByText(/We will confirm your order soon/)).not.toBeOnTheScreen();
      expect(announce).not.toHaveBeenCalled();
    });

    it('does not claim the order was placed when it is already cancelled', async () => {
      searchParams.placed = '1';
      await renderOrder(apiWith(CANCELLED));
      await screen.findByRole('header', { name: 'NZ100042' });

      expect(screen.queryByText(/We will confirm your order soon/)).not.toBeOnTheScreen();
    });
  });

  describe('a cancelled order', () => {
    it('says when and why, and offers no cancel button', async () => {
      await renderOrder(apiWith(CANCELLED));

      expect(await screen.findByText('This order is cancelled')).toBeOnTheScreen();
      expect(
        screen.getByText(
          'Cancelled on 5 January 2026. Nothing is due for it. Reason: Ordered by mistake',
        ),
      ).toBeOnTheScreen();
      expect(screen.getByLabelText('Payment status: Payment cancelled')).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeOnTheScreen();
      expect(screen.getByLabelText('Cancelled, 5 January 2026, 19:00')).toBeOnTheScreen();
    });
  });

  describe('cancelling', () => {
    it('offers "Cancel order" only while the server says the order can be cancelled', async () => {
      await renderOrder(apiWith(order({ canCancel: false, status: 'shipped' })));
      await screen.findByRole('header', { name: 'NZ100042' });
      expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeOnTheScreen();
      expect(screen.queryByText('Changed your mind?')).not.toBeOnTheScreen();
    });

    it('needs a confirmation, and keeping the order sends nothing', async () => {
      const api = apiWith(ORDER);
      const { user } = await renderOrder(api);

      await user.press(await screen.findByRole('button', { name: 'Cancel order' }));

      expect(screen.getByRole('header', { name: 'Cancel order NZ100042?' })).toBeOnTheScreen();
      expect(api.cancelOrder).not.toHaveBeenCalled();

      await user.press(screen.getByRole('button', { name: 'Keep order' }));

      expect(
        screen.queryByRole('header', { name: 'Cancel order NZ100042?' }),
      ).not.toBeOnTheScreen();
      expect(api.cancelOrder).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Cancel order' })).toBeOnTheScreen();
    });

    it('limits the reason to 300 characters', async () => {
      const { user } = await renderOrder(apiWith(ORDER));
      await user.press(await screen.findByRole('button', { name: 'Cancel order' }));

      expect(screen.getByLabelText('Reason').props).toHaveProperty('maxLength', 300);
    });

    it('cancels with the reason, refreshes the order and the history, and says so', async () => {
      let current = ORDER;
      const api = createFakeApiClient();
      api.getOrder.mockImplementation(() => Promise.resolve({ order: current }));
      api.cancelOrder.mockImplementation(() => {
        current = CANCELLED;
        return Promise.resolve({ order: CANCELLED });
      });
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
      const { user, queryClient } = await renderOrder(api);
      const feedKey = queryKeys.orders.feed(CUSTOMER.user.id, { pageSize: 10 });
      queryClient.setQueryData(feedKey, { pages: [], pageParams: [] });

      await user.press(await screen.findByRole('button', { name: 'Cancel order' }));
      await user.type(screen.getByLabelText('Reason'), '  Ordered by mistake ');
      await user.press(screen.getByRole('button', { name: 'Yes, cancel order' }));

      expect(await screen.findByText('Your order has been cancelled.')).toBeOnTheScreen();
      expect(api.cancelOrder).toHaveBeenCalledTimes(1);
      expect(api.cancelOrder).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN, 'NZ100042', {
        reason: 'Ordered by mistake',
      });
      expect(announce).toHaveBeenCalledWith('Your order has been cancelled.');
      expect(
        screen.queryByRole('header', { name: 'Cancel order NZ100042?' }),
      ).not.toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeOnTheScreen();
      expect(await screen.findByLabelText('Order status: Cancelled')).toBeOnTheScreen();
      // The order history is stale now, and will reload when it is next shown.
      expect(queryClient.getQueryState(feedKey)?.isInvalidated).toBe(true);
    });

    it('sends no reason when none was written', async () => {
      const api = apiWith(ORDER);
      api.cancelOrder.mockResolvedValue({ order: CANCELLED });
      const { user } = await renderOrder(api);

      await user.press(await screen.findByRole('button', { name: 'Cancel order' }));
      await user.press(screen.getByRole('button', { name: 'Yes, cancel order' }));

      expect(await screen.findByText('Your order has been cancelled.')).toBeOnTheScreen();
      expect(api.cancelOrder).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN, 'NZ100042', {});
    });

    it('lets go of the finished cancellation once the screen is gone (no five-minute timer left behind)', async () => {
      const api = apiWith(ORDER);
      api.cancelOrder.mockResolvedValue({ order: CANCELLED });
      const { user, queryClient, unmount } = await renderOrder(api);

      await user.press(await screen.findByRole('button', { name: 'Cancel order' }));
      await user.press(screen.getByRole('button', { name: 'Yes, cancel order' }));
      await screen.findByText('Your order has been cancelled.');
      expect(queryClient.getMutationCache().getAll()).toHaveLength(1);

      await unmount();

      // Kept for the library's default five minutes, this would leave a timer running
      // after the test run (jest: "A worker process has failed to exit gracefully").
      await waitFor(() => {
        expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
      });
    });

    it('sends the cancellation once however often the button is pressed', async () => {
      const api = apiWith(ORDER);
      let finish: (value: { order: OrderDetail }) => void = () => undefined;
      api.cancelOrder.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const { user } = await renderOrder(api);
      await user.press(await screen.findByRole('button', { name: 'Cancel order' }));

      await user.press(screen.getByRole('button', { name: 'Yes, cancel order' }));
      await user.press(screen.getByRole('button', { name: 'Yes, cancel order' }));
      expect(api.cancelOrder).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Keep order' })).toBeDisabled();

      await act(() => {
        finish({ order: CANCELLED });
      });
    });

    it('explains when the order has moved on, and shows its new state', async () => {
      let current = ORDER;
      const api = createFakeApiClient();
      api.getOrder.mockImplementation(() => Promise.resolve({ order: current }));
      api.cancelOrder.mockImplementation(() => {
        current = order({ status: 'shipped', canCancel: false });
        return Promise.reject(new ApiError(409, 'order_not_cancellable', 'No longer cancellable'));
      });
      const { user } = await renderOrder(api);

      await user.press(await screen.findByRole('button', { name: 'Cancel order' }));
      await user.press(screen.getByRole('button', { name: 'Yes, cancel order' }));

      expect(await screen.findByText(CANCEL_MESSAGES.refused)).toBeOnTheScreen();
      expect(
        screen.queryByRole('header', { name: 'Cancel order NZ100042?' }),
      ).not.toBeOnTheScreen();
      expect(await screen.findByLabelText('Order status: On the way')).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeOnTheScreen();
    });

    it('treats a repeat of a cancellation that was already saved as cancelled', async () => {
      let current = ORDER;
      const api = createFakeApiClient();
      api.getOrder.mockImplementation(() => Promise.resolve({ order: current }));
      api.cancelOrder.mockImplementation(() => {
        current = CANCELLED;
        return Promise.reject(new ApiError(409, 'order_not_cancellable', 'Already cancelled'));
      });
      const { user } = await renderOrder(api);

      await user.press(await screen.findByRole('button', { name: 'Cancel order' }));
      await user.press(screen.getByRole('button', { name: 'Yes, cancel order' }));

      expect(await screen.findByText('Your order has been cancelled.')).toBeOnTheScreen();
      expect(screen.queryByText(CANCEL_MESSAGES.refused)).not.toBeOnTheScreen();
    });

    it('keeps the confirmation open after a connection failure, so it can be sent again', async () => {
      const api = apiWith(ORDER);
      api.cancelOrder.mockRejectedValueOnce(new ApiError(0, 'network_error', 'offline'));
      api.cancelOrder.mockResolvedValueOnce({ order: CANCELLED });
      const { user } = await renderOrder(api);

      await user.press(await screen.findByRole('button', { name: 'Cancel order' }));
      await user.type(screen.getByLabelText('Reason'), 'Too slow');
      await user.press(screen.getByRole('button', { name: 'Yes, cancel order' }));

      expect(await screen.findByText(CANCEL_MESSAGES.unconfirmed)).toBeOnTheScreen();
      expect(screen.getByRole('header', { name: 'Cancel order NZ100042?' })).toBeOnTheScreen();
      expect(screen.getByLabelText('Reason')).toHaveDisplayValue('Too slow');
      expect(screen.queryByText('Your order has been cancelled.')).not.toBeOnTheScreen();

      api.getOrder.mockResolvedValue({ order: CANCELLED });
      await user.press(screen.getByRole('button', { name: 'Yes, cancel order' }));

      expect(await screen.findByText('Your order has been cancelled.')).toBeOnTheScreen();
      expect(api.cancelOrder).toHaveBeenCalledTimes(2);
      expect(api.cancelOrder).toHaveBeenLastCalledWith(FAKE_ACCESS_TOKEN, 'NZ100042', {
        reason: 'Too slow',
      });
    });

    it('closes the confirmation and explains when the account cannot do this', async () => {
      const api = apiWith(ORDER);
      api.cancelOrder.mockRejectedValue(new ApiError(403, 'account_suspended', 'Suspended'));
      const { user } = await renderOrder(api);

      await user.press(await screen.findByRole('button', { name: 'Cancel order' }));
      await user.press(screen.getByRole('button', { name: 'Yes, cancel order' }));

      expect(
        await screen.findByText('This account is suspended. Contact Nilzora support for help.'),
      ).toBeOnTheScreen();
      expect(
        screen.queryByRole('header', { name: 'Cancel order NZ100042?' }),
      ).not.toBeOnTheScreen();
    });
  });

  describe('when the order cannot be shown', () => {
    it('shows "not found" for an order that is not the customer’s (the API answers 404)', async () => {
      const api = createFakeApiClient();
      api.getOrder.mockRejectedValue(new ApiError(404, 'not_found', 'Order not found'));
      const { user } = await renderOrder(api);

      expect(await screen.findByRole('header', { name: 'Order not found' })).toBeOnTheScreen();
      expect(screen.queryByRole('header', { name: 'NZ100042' })).not.toBeOnTheScreen();
      await user.press(screen.getByRole('button', { name: 'View your orders' }));
      expect(router.replace).toHaveBeenCalledWith('/orders');
    });

    it.each(['abc', 'nz100042', 'NZ12', 'NZ100042/../x', '../order/NZ100042'])(
      'does not even ask the API about the malformed order number %p',
      async (orderNumber) => {
        searchParams.orderNumber = orderNumber;
        const api = createFakeApiClient();
        await renderOrder(api);

        expect(screen.getByRole('header', { name: 'Order not found' })).toBeOnTheScreen();
        expect(api.getOrder).not.toHaveBeenCalled();
      },
    );

    it('refuses a repeated order-number parameter', async () => {
      searchParams.orderNumber = ['NZ100042', 'NZ100043'];
      const api = createFakeApiClient();
      await renderOrder(api);

      expect(screen.getByRole('header', { name: 'Order not found' })).toBeOnTheScreen();
      expect(api.getOrder).not.toHaveBeenCalled();
    });

    it('shows a skeleton while loading', async () => {
      const api = createFakeApiClient();
      api.getOrder.mockReturnValue(new Promise(() => undefined));
      await renderOrder(api);

      expect(
        await screen.findByRole('progressbar', { name: 'Loading your order' }),
      ).toBeOnTheScreen();
    });

    it('explains a failure and retries', async () => {
      const api = createFakeApiClient();
      api.getOrder.mockRejectedValueOnce(new ApiError(503, 'service_unavailable', 'down'));
      const { user } = await renderOrder(api);

      expect(
        await screen.findByRole('header', { name: 'Nilzora is unavailable right now' }),
      ).toBeOnTheScreen();
      expect(screen.queryByRole('header', { name: 'Order not found' })).not.toBeOnTheScreen();

      api.getOrder.mockResolvedValue({ order: order({ canCancel: false }) });
      await user.press(screen.getByRole('button', { name: 'Try again' }));

      expect(await screen.findByRole('header', { name: 'NZ100042' })).toBeOnTheScreen();
    });

    it('pulls to refresh', async () => {
      const api = apiWith(order({ canCancel: false }));
      await renderOrder(api);
      await screen.findByRole('header', { name: 'NZ100042' });

      api.getOrder.mockResolvedValue({
        order: order({ canCancel: false, status: 'confirmed' }),
      });
      await refreshList('order-scroll');

      expect(await screen.findByLabelText('Order status: Confirmed')).toBeOnTheScreen();
      expect(api.getOrder).toHaveBeenCalledTimes(2);
    });

    it('sends a signed-out visitor to sign in and back to this order', async () => {
      const api = createFakeApiClient();
      const { user } = await renderWithProviders(<OrderRoute />, {
        api,
        session: { status: 'signed_out' },
      });

      await user.press(screen.getByRole('button', { name: 'Sign in' }));

      expect(router.push).toHaveBeenCalledWith({
        pathname: '/sign-in',
        params: { returnTo: '/order/NZ100042' },
      });
      expect(api.getOrder).not.toHaveBeenCalled();
      expect(screen.getByRole('header', { name: 'Sign in to Nilzora' })).toBeOnTheScreen();
    });
  });
});

describe('Order screen: reviewing a delivered order', () => {
  const DELIVERED = order({
    status: 'delivered',
    paymentStatus: 'collected',
    canCancel: false,
    history: [
      { fromStatus: null, toStatus: 'pending', at: '2026-01-05T10:00:00.000Z' },
      { fromStatus: 'shipped', toStatus: 'delivered', at: '2026-01-07T10:00:00.000Z' },
    ],
  });

  it('offers a review only where the server allows one, and shows a saved review instead', async () => {
    const api = apiWith(DELIVERED);
    api.myProductReview.mockImplementation(
      (_token, productId) =>
        Promise.resolve(
          productId === KURTA_ID
            ? { eligible: true, review: null }
            : {
                eligible: true,
                review: {
                  id: 'a9c1d0e2-0000-4000-8000-000000000001',
                  rating: 5,
                  title: null,
                  body: 'Lovely mug, well packed.',
                  status: 'pending',
                  createdAt: '2026-01-08T10:00:00.000Z',
                  updatedAt: '2026-01-08T10:00:00.000Z',
                  images: [],
                },
              },
        ) as never,
    );
    await renderOrder(api);

    expect(await screen.findByText('Review your items')).toBeOnTheScreen();
    const write = await screen.findAllByRole('button', { name: 'Write a review' });
    expect(write).toHaveLength(1);
    expect(await screen.findByText('Reviewed · being checked')).toBeOnTheScreen();
    expect(api.myProductReview).toHaveBeenCalledWith(
      FAKE_ACCESS_TOKEN,
      KURTA_ID,
      expect.anything(),
    );
  });

  it('offers nothing on an order that is not delivered', async () => {
    const api = apiWith(ORDER);
    await renderOrder(api);
    await screen.findByText('Cotton kurta');
    expect(screen.queryByText('Review your items')).not.toBeOnTheScreen();
    expect(api.myProductReview).not.toHaveBeenCalled();
  });
});
