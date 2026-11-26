import type { CustomerShipment, OrderDetail, ReturnDetail } from '@nilzora/contracts';
import { render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import OrderRoute from '../../app/order/[orderNumber]';
import ReturnRoute from '../../app/returns/[returnId]';
import { ShipmentTrackingCard } from '../features/orders/shipment-tracking';
import { createFakeApiClient, type FakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock, router, searchParams } from '../test-utils/expo-router-mock';
import { refreshList } from '../test-utils/refresh';
import { renderWithProviders } from '../test-utils/render-with-providers';
import { FAKE_ACCESS_TOKEN } from '../test-utils/session-fakes';

/*
 * Courier tracking on the order and return screens.
 *
 * The customer sees who has the parcel, its courier status, the tracking code (to copy) and
 * the courier's updates, newest first; the courier's tracking page opens only for a web
 * address. Tracking is extra: while it loads, when it fails, or when there is none, the order
 * screen is whole, and the order keeps its own status. Nothing here can show money.
 */

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));
/* The clipboard is a native module: the screen is tested against this stand-in for it. */
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));

const clipboard = jest.requireMock<{
  setStringAsync: jest.Mock<Promise<boolean>, [string]>;
}>('expo-clipboard');

const RETURN_ID = '4b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f';

const ORDER: OrderDetail = {
  orderNumber: 'NZ100042',
  status: 'shipped',
  paymentMethod: 'cod',
  paymentStatus: 'pending',
  itemCount: 1,
  totalMinor: 58_000,
  placedAt: '2026-10-24T08:05:00.000Z',
  preview: [],
  currency: 'BDT',
  subtotalMinor: 50_000,
  shippingFeeMinor: 8_000,
  discountMinor: 0,
  deliveryZone: 'inside_dhaka',
  shippingAddress: {
    recipientName: 'Ayesha Rahman',
    phone: '+8801712345678',
    division: 'Dhaka',
    district: 'Dhaka',
    area: 'Dhanmondi',
    addressLine: 'House 12, Road 5',
    postalCode: '1205',
    landmark: null,
  },
  customerNote: null,
  cancelReason: null,
  cancelledAt: null,
  items: [
    {
      orderItemId: 1,
      productId: '0b9f7f5e-6a14-4c43-8d63-2d1e8f3b7a01',
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
      quantity: 1,
      lineTotalMinor: 50_000,
    },
  ],
  history: [
    { fromStatus: null, toStatus: 'pending', at: '2026-10-24T08:05:00.000Z' },
    { fromStatus: 'pending', toStatus: 'shipped', at: '2026-10-25T04:00:00.000Z' },
  ],
  canCancel: false,
};

function shipment(overrides: Partial<CustomerShipment> = {}): CustomerShipment {
  return {
    id: '5e000000-0000-4000-8000-000000000001',
    kind: 'forward',
    returnRequestId: null,
    providerName: 'Steadfast Courier',
    status: 'in_transit',
    trackingCode: 'SF123456789',
    trackingUrl: 'https://steadfast.com.bd/t/SF123456789',
    isTest: false,
    bookedAt: '2026-10-25T04:00:00.000Z',
    deliveredAt: null,
    events: [
      { status: 'booked', occurredAt: '2026-10-25T04:00:00.000Z' },
      { status: 'picked_up', occurredAt: '2026-10-25T09:30:00.000Z' },
      { status: 'in_transit', occurredAt: '2026-10-26T02:15:00.000Z' },
    ],
    ...overrides,
  };
}

function apiWith(order: OrderDetail, shipments?: CustomerShipment[] | Error): FakeApiClient {
  const api = createFakeApiClient();
  api.getOrder.mockResolvedValue({ order });
  if (shipments instanceof Error) api.myOrderShipments.mockRejectedValue(shipments);
  else if (shipments !== undefined) api.myOrderShipments.mockResolvedValue({ shipments });
  return api;
}

async function renderOrder(api: FakeApiClient) {
  return renderWithProviders(<OrderRoute />, { api });
}

beforeEach(() => {
  resetRouterMock();
  for (const key of Object.keys(searchParams)) delete searchParams[key];
  searchParams.orderNumber = 'NZ100042';
  clipboard.setStringAsync.mockReset();
  clipboard.setStringAsync.mockResolvedValue(true);
});

describe('Order screen: delivery tracking', () => {
  it('shows the courier, its status, the code and the updates, newest first', async () => {
    const api = apiWith(ORDER, [shipment()]);
    await renderOrder(api);

    expect(await screen.findByRole('header', { name: 'Delivery tracking' })).toBeOnTheScreen();
    expect(api.myOrderShipments).toHaveBeenCalledWith(
      FAKE_ACCESS_TOKEN,
      'NZ100042',
      expect.anything(),
    );
    expect(screen.getByLabelText('Your parcel with Steadfast Courier')).toBeOnTheScreen();
    expect(screen.getByLabelText('Courier status: In transit')).toBeOnTheScreen();
    // The order keeps its own status.
    expect(screen.getByLabelText('Order status: On the way')).toBeOnTheScreen();
    expect(screen.getByText('SF123456789')).toBeOnTheScreen();
    const updates = screen
      .getAllByLabelText(/, 2\d October 2026, \d\d:\d\d$/)
      .map((node) => (node.props as { accessibilityLabel: string }).accessibilityLabel)
      .filter((label) => /^(In transit|Picked up|Booked),/.test(label));
    expect(updates).toEqual([
      'In transit, 26 October 2026, 08:15',
      'Picked up, 25 October 2026, 15:30',
      'Booked, 25 October 2026, 10:00',
    ]);
    expect(screen.queryByText('Test shipment')).not.toBeOnTheScreen();
    expect(screen.queryByText(/once your parcel is with the courier/)).not.toBeOnTheScreen();
  });

  it('opens the courier tracking page and copies the code', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const { user } = await renderOrder(apiWith(ORDER, [shipment()]));

    await user.press(await screen.findByRole('button', { name: 'Track on Steadfast Courier' }));
    expect(openURL).toHaveBeenCalledWith('https://steadfast.com.bd/t/SF123456789');

    await user.press(screen.getByRole('button', { name: 'Copy tracking code SF123456789' }));
    expect(clipboard.setStringAsync).toHaveBeenCalledWith('SF123456789');
    expect(await screen.findByText('Copied')).toBeOnTheScreen();
    openURL.mockRestore();
  });

  it.each([
    ['no tracking page', null],
    ['an app scheme', 'intent://scan/#Intent;end'],
    ['a script', 'javascript:alert(1)'],
  ])('offers no tracking link for %s, and marks a test shipment', async (_label, trackingUrl) => {
    await renderOrder(apiWith(ORDER, [shipment({ trackingUrl, isTest: true })]));

    expect(await screen.findByRole('header', { name: 'Delivery tracking' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /Track on/ })).not.toBeOnTheScreen();
    expect(screen.getByText('Test shipment')).toBeOnTheScreen();
    expect(screen.getByText('SF123456789')).toBeOnTheScreen();
  });

  it('says tracking will come while the order waits for a courier', async () => {
    await renderOrder(apiWith(ORDER, []));

    expect(
      await screen.findByText(
        'Courier tracking appears here once your parcel is with the courier.',
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Delivery tracking' })).not.toBeOnTheScreen();
  });

  it('keeps the order screen whole when tracking fails', async () => {
    const api = apiWith(ORDER, new Error('network'));
    await renderOrder(api);

    expect(await screen.findByRole('header', { name: 'NZ100042' })).toBeOnTheScreen();
    await waitFor(() => expect(api.myOrderShipments).toHaveBeenCalled());
    expect(screen.queryByRole('header', { name: 'Delivery tracking' })).not.toBeOnTheScreen();
    expect(screen.queryByText(/once your parcel is with the courier/)).not.toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Items (1 item)' })).toBeOnTheScreen();
  });

  it('does not ask for tracking while the order awaits confirmation', async () => {
    const api = apiWith({ ...ORDER, status: 'pending', history: [ORDER.history[0]!] });
    await renderOrder(api);

    expect(await screen.findByRole('header', { name: 'NZ100042' })).toBeOnTheScreen();
    expect(api.myOrderShipments).not.toHaveBeenCalled();
  });

  it('reloads tracking on pull-to-refresh', async () => {
    const api = apiWith(ORDER, []);
    await renderOrder(api);
    await screen.findByText(/once your parcel is with the courier/);
    api.myOrderShipments.mockResolvedValue({ shipments: [shipment()] });

    await refreshList('order-scroll');

    expect(await screen.findByRole('header', { name: 'Delivery tracking' })).toBeOnTheScreen();
    expect(api.getOrder).toHaveBeenCalledTimes(2);
  });

  it('never shows money, and says when the parcel was delivered', async () => {
    await render(
      <ShipmentTrackingCard
        title="Delivery tracking"
        shipments={[
          shipment({
            status: 'delivered',
            deliveredAt: '2026-10-27T08:00:00.000Z',
            events: [{ status: 'delivered', occurredAt: '2026-10-27T08:00:00.000Z' }],
          }),
          shipment({ id: '5e000000-0000-4000-8000-000000000002', kind: 'exchange' }),
        ]}
      />,
    );

    expect(screen.getByText('Delivered on 27 October 2026')).toBeOnTheScreen();
    expect(screen.getByLabelText('Exchange parcel with Steadfast Courier')).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/৳|taka|BDT|charge|fees?|cash/i);
  });

  it('renders nothing without shipments', async () => {
    await render(<ShipmentTrackingCard title="Delivery tracking" shipments={[]} />);
    expect(screen.toJSON()).toBeNull();
  });

  it('shows a return pickup and opens its return', async () => {
    const { user } = await renderOrder(
      apiWith({ ...ORDER, status: 'delivered' }, [
        shipment({
          id: '5e000000-0000-4000-8000-000000000009',
          kind: 'return_pickup',
          returnRequestId: RETURN_ID,
          status: 'picked_up',
          trackingUrl: null,
        }),
      ]),
    );

    expect(await screen.findByRole('header', { name: 'Return pickup' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Courier status: Collected from you')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'View the return' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/returns/[returnId]',
      params: { returnId: RETURN_ID },
    });
  });
});

function returnDetail(overrides: Partial<ReturnDetail> = {}): ReturnDetail {
  return {
    id: RETURN_ID,
    orderNumber: 'NZ100042',
    status: 'approved',
    itemCount: 1,
    refundableMinor: 50_000,
    reason: 'Arrived damaged',
    requestedAt: '2026-10-28T04:00:00.000Z',
    decidedAt: '2026-10-28T06:00:00.000Z',
    decisionNote: null,
    description: null,
    receivedAt: null,
    restockedAt: null,
    items: [
      {
        orderItemId: 1,
        productName: 'Cotton kurta',
        variantLabel: null,
        sku: 'KUR-1',
        quantity: 1,
        orderedQuantity: 1,
        lineTotalMinor: 50_000,
      },
    ],
    history: [
      {
        fromStatus: null,
        toStatus: 'requested',
        actorKind: 'customer',
        note: null,
        at: '2026-10-28T04:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

describe('Return screen: courier pickup', () => {
  beforeEach(() => {
    searchParams.returnId = RETURN_ID;
  });

  it('shows this return’s pickup only', async () => {
    const api = createFakeApiClient();
    api.myReturn.mockResolvedValue({ return: returnDetail() });
    api.myOrderShipments.mockResolvedValue({
      shipments: [
        shipment(),
        shipment({
          id: '5e000000-0000-4000-8000-000000000003',
          kind: 'return_pickup',
          returnRequestId: RETURN_ID,
          providerName: 'Pathao Courier',
          status: 'pickup_pending',
          trackingCode: 'PT-778899',
          trackingUrl: null,
          events: [{ status: 'booked', occurredAt: '2026-10-28T07:00:00.000Z' }],
        }),
        shipment({
          id: '5e000000-0000-4000-8000-000000000004',
          kind: 'return_pickup',
          returnRequestId: '7c1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f',
          trackingCode: 'OTHER-RETURN',
        }),
      ],
    });
    await renderWithProviders(<ReturnRoute />, { api });

    expect(await screen.findByRole('header', { name: 'Return pickup' })).toBeOnTheScreen();
    expect(api.myOrderShipments).toHaveBeenCalledWith(
      FAKE_ACCESS_TOKEN,
      'NZ100042',
      expect.anything(),
    );
    expect(screen.getByLabelText('Return pickup with Pathao Courier')).toBeOnTheScreen();
    expect(screen.getByLabelText('Courier status: Awaiting pickup')).toBeOnTheScreen();
    expect(screen.getByText('PT-778899')).toBeOnTheScreen();
    expect(screen.queryByText('OTHER-RETURN')).not.toBeOnTheScreen();
    expect(screen.queryByText('SF123456789')).not.toBeOnTheScreen();
  });

  it('does not look for a pickup before the return is approved', async () => {
    const api = createFakeApiClient();
    api.myReturn.mockResolvedValue({ return: returnDetail({ status: 'requested' }) });
    await renderWithProviders(<ReturnRoute />, { api });

    expect(await screen.findByText('Return for order NZ100042')).toBeOnTheScreen();
    expect(api.myOrderShipments).not.toHaveBeenCalled();
    expect(screen.queryByRole('header', { name: 'Return pickup' })).not.toBeOnTheScreen();
  });
});
