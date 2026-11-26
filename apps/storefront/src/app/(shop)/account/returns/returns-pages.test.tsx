import type {
  CustomerShipmentsResponse,
  ReturnDetail,
  ReturnListResponse,
  ReturnResponse,
} from '@nilzora/contracts';
import type { SessionCall, SessionRead } from '@nilzora/web-session';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  customerShipment,
  fakeRead,
  NOT_FOUND,
  redirectedTo,
} from '@/testing/commerce-fixtures';
import ReturnPage from './[returnId]/page';
import NewReturnPage from './new/page';
import ReturnsPage from './page';

const AT = '2026-11-06T10:00:00.000Z';
const RETURN_ID = '4b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f';

const api = vi.hoisted(() => ({
  myReturns: vi.fn<() => Promise<ReturnListResponse>>(),
  myReturn: vi.fn<() => Promise<ReturnResponse>>(),
  getOrder: vi.fn<() => Promise<unknown>>(),
  myOrderShipments: vi.fn<() => Promise<CustomerShipmentsResponse>>(),
}));

vi.mock('@/lib/session', () => ({
  session: {
    read: <T,>(call: SessionCall<T>): Promise<SessionRead<T>> => fakeRead(api as never, call),
    csrfToken: () => Promise.resolve('signed-csrf-value'),
  },
}));

function returnDetail(overrides: Partial<ReturnDetail> = {}): ReturnDetail {
  return {
    id: RETURN_ID,
    orderNumber: 'NZ100042',
    status: 'requested',
    itemCount: 1,
    refundableMinor: 125_000,
    reason: 'Arrived damaged',
    requestedAt: AT,
    decidedAt: null,
    decisionNote: null,
    description: null,
    receivedAt: null,
    restockedAt: null,
    items: [
      {
        orderItemId: 1,
        productName: 'Brass table lamp',
        variantLabel: 'Colour: Brass',
        sku: 'NZ-LAMP-01',
        quantity: 1,
        orderedQuantity: 2,
        lineTotalMinor: 125_000,
      },
    ],
    history: [
      { fromStatus: null, toStatus: 'requested', actorKind: 'customer', note: null, at: AT },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  api.myReturns.mockResolvedValue({
    returns: [returnDetail()],
    page: 1,
    pageSize: 1,
    total: 1,
    totalPages: 1,
  });
  api.myReturn.mockResolvedValue({ return: returnDetail() });
  api.myOrderShipments.mockResolvedValue({ shipments: [] });
});

describe('Your returns', () => {
  it('lists each request with its stage and refundable amount', async () => {
    render(await ReturnsPage());

    expect(api.myReturns).toHaveBeenCalled();
    expect(
      screen.getByRole('link', { name: 'Return for order NZ100042' }).getAttribute('href'),
    ).toBe(`/account/returns/${RETURN_ID}`);
    expect(screen.getByText('Waiting for Nilzora to review it')).toBeTruthy();
    expect(screen.getByText(/1 item · asked on/)).toBeTruthy();
  });

  it('points at the orders page when there is nothing to return', async () => {
    api.myReturns.mockResolvedValue({
      returns: [],
      page: 1,
      pageSize: 1,
      total: 0,
      totalPages: 0,
    });
    render(await ReturnsPage());

    expect(screen.getByText('No returns yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to your orders' }).getAttribute('href')).toBe(
      '/account/orders',
    );
  });

  it('sends a signed-out visitor to sign in and come back', async () => {
    api.myReturns.mockRejectedValue(apiError(401, 'unauthenticated'));
    await expect(ReturnsPage()).rejects.toMatchObject(redirectedTo('/login?next=/account/returns'));
  });

  it('says the list is unavailable instead of showing nothing', async () => {
    api.myReturns.mockRejectedValue(apiError(502, 'invalid_response'));
    render(await ReturnsPage());
    expect(screen.getByText(/could not load your returns/i)).toBeTruthy();
  });
});

describe('One return', () => {
  const props = (returnId: string, query: Record<string, string> = {}) => ({
    params: Promise.resolve({ returnId }),
    searchParams: Promise.resolve(query),
  });

  it('shows the items, the history and the refundable amount', async () => {
    render(await ReturnPage(props(RETURN_ID)));

    expect(api.myReturn).toHaveBeenCalledWith('access-token', RETURN_ID);
    expect(screen.getAllByText(/Colour: Brass/).length).toBeGreaterThan(0);
    expect(screen.getByText('Arrived damaged')).toBeTruthy();
    expect(screen.getByText(/1 of 2 · SKU NZ-LAMP-01/)).toBeTruthy();
    expect(screen.getByText('What has happened')).toBeTruthy();
  });

  it('stops offering a cancel once the request has been decided', async () => {
    api.myReturn.mockResolvedValue({ return: returnDetail({ status: 'approved' }) });
    render(await ReturnPage(props(RETURN_ID)));
    expect(screen.queryByText('Cancel this return')).toBeNull();
  });

  it('offers cancelling while the request is still being reviewed', async () => {
    render(await ReturnPage(props(RETURN_ID)));
    expect(screen.getByText('Cancel this return')).toBeTruthy();
  });

  it('explains a Cash-on-Delivery refund and when it counts as paid', async () => {
    api.myReturn.mockResolvedValue({
      return: returnDetail({
        status: 'completed',
        refunds: [
          {
            id: '9d1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f',
            amountMinor: 125_000,
            status: 'completed',
            method: 'cod_manual',
            requestedAt: AT,
            completedAt: AT,
          },
        ],
      }),
    });
    render(await ReturnPage(props(RETURN_ID)));

    expect(screen.getByText(/pays Cash on Delivery refunds back by hand/)).toBeTruthy();
    expect(screen.getByText(/cash paid back by hand/)).toBeTruthy();
    expect(screen.getByText(/Paid back/)).toBeTruthy();
  });

  it('shows the courier pickup of this return, not of another one', async () => {
    api.myReturn.mockResolvedValue({ return: returnDetail({ status: 'approved' }) });
    api.myOrderShipments.mockResolvedValue({
      shipments: [
        customerShipment(),
        customerShipment({
          id: '5e000000-0000-4000-8000-000000000003',
          kind: 'return_pickup',
          returnRequestId: RETURN_ID,
          providerName: 'Pathao Courier',
          status: 'pickup_pending',
          trackingCode: 'PT-778899',
          trackingUrl: null,
          events: [{ status: 'booked', occurredAt: AT }],
        }),
        customerShipment({
          id: '5e000000-0000-4000-8000-000000000004',
          kind: 'return_pickup',
          returnRequestId: '7c1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f',
          trackingCode: 'OTHER-RETURN',
        }),
      ],
    });
    render(await ReturnPage(props(RETURN_ID)));

    expect(api.myOrderShipments).toHaveBeenCalledWith('access-token', 'NZ100042');
    expect(screen.getByRole('heading', { level: 2, name: 'Return pickup' })).toBeTruthy();
    expect(screen.getByText('Pathao Courier')).toBeTruthy();
    expect(screen.getByText('PT-778899')).toBeTruthy();
    expect(screen.queryByText('OTHER-RETURN')).toBeNull();
    // The delivery to the customer is the order page's business, not the return's.
    expect(screen.queryByText('SF123456789')).toBeNull();
    expect(screen.queryByRole('link', { name: /Track on/ })).toBeNull();
  });

  it('does not look for a pickup before the return is approved, and survives a failed read', async () => {
    render(await ReturnPage(props(RETURN_ID)));
    expect(api.myOrderShipments).not.toHaveBeenCalled();

    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    api.myReturn.mockResolvedValue({ return: returnDetail({ status: 'received' }) });
    api.myOrderShipments.mockRejectedValue(apiError(503, 'service_unavailable'));
    render(await ReturnPage(props(RETURN_ID)));
    expect(screen.getAllByText('Return details').length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Return pickup' })).toBeNull();
  });

  it('confirms a request that was just sent', async () => {
    render(await ReturnPage(props(RETURN_ID, { requested: '1' })));
    expect(screen.getByText(/Nilzora will review your request/)).toBeTruthy();
  });

  it('answers 404 for an id that is not a uuid, without calling the API', async () => {
    await expect(ReturnPage(props('not-a-uuid'))).rejects.toMatchObject(NOT_FOUND);
    expect(api.myReturn).not.toHaveBeenCalled();
  });

  it('answers 404 for a return that is not the caller’s', async () => {
    api.myReturn.mockRejectedValue(apiError(404, 'not_found'));
    await expect(ReturnPage(props(RETURN_ID))).rejects.toMatchObject(NOT_FOUND);
  });
});

describe('Send something back', () => {
  const props = (query: Record<string, string> = {}) => ({
    searchParams: Promise.resolve(query),
  });

  it('asks how many units of each line came back, up to what was bought', async () => {
    api.getOrder.mockResolvedValue({
      order: {
        orderNumber: 'NZ100042',
        status: 'delivered',
        items: [
          {
            orderItemId: 7,
            productId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
            variantId: null,
            variantLabel: null,
            productName: 'Brass table lamp',
            productSlug: 'brass-table-lamp',
            sku: 'NZ-LAMP-01',
            unitPriceMinor: 125_000,
            quantity: 2,
            lineTotalMinor: 250_000,
          },
        ],
      },
    });

    render(await NewReturnPage(props({ order: 'NZ100042' })));

    expect(api.getOrder).toHaveBeenCalledWith('access-token', 'NZ100042');
    const quantity = screen.getByLabelText<HTMLSelectElement>('How many are coming back?');
    expect([...quantity.options].map((option) => option.value)).toEqual(['0', '1', '2']);
    expect(screen.getByLabelText('Why are you sending it back?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send the request' })).toBeTruthy();
  });

  it('needs an order number, and 404s for an order that is not the caller’s', async () => {
    await expect(NewReturnPage(props())).rejects.toMatchObject(NOT_FOUND);
    expect(api.getOrder).not.toHaveBeenCalled();

    api.getOrder.mockRejectedValue(apiError(404, 'not_found'));
    await expect(NewReturnPage(props({ order: 'NZ100042' }))).rejects.toMatchObject(NOT_FOUND);
  });
});
