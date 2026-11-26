import { ApiError } from '@nilzora/api-client';
import type { OrderDetail } from '@nilzora/contracts';
import { screen } from '@testing-library/react-native';
import { OrderSuccessScreen } from '../features/checkout/order-success-screen';
import { createFakeApiClient } from '../test-utils/api-fakes';
import { renderWithProviders } from '../test-utils/render-with-providers';
import { resetRouterMock, router } from '../test-utils/expo-router-mock';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

jest.mock('@/features/receipt/save-receipt', () => ({
  CAN_SAVE_RECEIPT: true,
  saveReceiptPdf: jest.fn(),
}));

/*
 * The confirmation shown straight after checkout.
 *
 * It must say the order is placed, never that it is paid, and it must show the amount still due
 * in cash. The order it draws is read back from the API, so this test also covers the case where
 * that read fails: the confirmation still has to be truthful about what it does not know.
 */

function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    orderNumber: 'NZ100042',
    status: 'pending',
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    itemCount: 2,
    totalMinor: 226_000,
    placedAt: '2026-11-06T04:30:00.000Z',
    preview: [],
    currency: 'BDT',
    subtotalMinor: 220_000,
    shippingFeeMinor: 6_000,
    discountMinor: 0,
    deliveryZone: 'inside_dhaka',
    shippingAddress: {
      recipientName: 'Ayesha Rahman',
      phone: '+8801712345678',
      division: 'Dhaka',
      district: 'Dhaka',
      area: 'Dhanmondi',
      addressLine: 'House 12, Road 5',
      landmark: null,
      postalCode: '1209',
    },
    items: [],
    history: [],
    ...overrides,
  } as OrderDetail;
}

function successApi(detail: OrderDetail | null): ReturnType<typeof createFakeApiClient> {
  const api = createFakeApiClient();
  api.getOrder.mockResolvedValue({ order: detail ?? order() });
  return api;
}

beforeEach(() => {
  resetRouterMock();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('OrderSuccessScreen', () => {
  it('says the order is placed and asks for cash on delivery, never that it is paid', async () => {
    const detail = order({ totalMinor: 226_000 });
    await renderWithProviders(<OrderSuccessScreen orderNumber={detail.orderNumber} />, {
      api: successApi(detail),
    });

    expect(
      await screen.findByRole('header', { name: 'Your order has been placed successfully!' }),
    ).toBeOnTheScreen();
    expect(screen.getByText('NZ100042')).toBeOnTheScreen();
    // The amount due is the order total; nowhere does the screen claim the order has been paid.
    expect(screen.getByText(/Keep ৳2,260 ready in cash/)).toBeOnTheScreen();
    expect(screen.queryByText(/paid/i)).not.toBeOnTheScreen();
    // The full order stays one tap away: no long details panel under the confirmation.
    expect(screen.queryByText('Delivering to')).not.toBeOnTheScreen();
  });

  it('offers exactly two actions: view the order and save its receipt as a PDF', async () => {
    const detail = order();
    const { user } = await renderWithProviders(
      <OrderSuccessScreen orderNumber={detail.orderNumber} />,
      { api: successApi(detail) },
    );

    await user.press(await screen.findByRole('button', { name: 'View order details' }));
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/order/[orderNumber]',
      params: { orderNumber: 'NZ100042' },
    });
    expect(screen.getByRole('button', { name: 'Save order details' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Share receipt' })).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Continue shopping' }));
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('says the order is not there rather than inventing one', async () => {
    const api = createFakeApiClient();
    api.getOrder.mockRejectedValue(new ApiError(404, 'not_found', 'no order'));

    await renderWithProviders(<OrderSuccessScreen orderNumber="NZ999999" />, { api });

    expect(await screen.findByText('Order not found')).toBeOnTheScreen();
    expect(screen.queryByText(/placed successfully/i)).not.toBeOnTheScreen();
  });

  it('turns a failed read into a retry rather than a blank confirmation', async () => {
    const api = createFakeApiClient();
    api.getOrder
      .mockRejectedValueOnce(new ApiError(0, 'network_error', 'offline'))
      .mockResolvedValue({ order: order() });
    const { user } = await renderWithProviders(<OrderSuccessScreen orderNumber="NZ100042" />, {
      api,
    });

    await user.press(await screen.findByRole('button', { name: 'Try again' }));

    expect(api.getOrder).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByRole('header', { name: 'Your order has been placed successfully!' }),
    ).toBeOnTheScreen();
  });
});
