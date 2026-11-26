import { render, screen } from '@testing-library/react';
import type { CustomerShipmentsResponse, OrderResponse } from '@nilzora/contracts';
import type { SessionCall, SessionRead } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchParams } from '@/lib/auth-params';
import { CART_CHANGED_EVENT } from '@/lib/cart-events';
import {
  apiError,
  customerShipment,
  fakeRead,
  NOT_FOUND,
  orderDetail,
  redirectedTo,
} from '@/testing/commerce-fixtures';
import OrderPage from './page';

const api = vi.hoisted(() => ({
  getOrder: vi.fn<(token: string, orderNumber: string) => Promise<OrderResponse>>(),
  myOrderShipments:
    vi.fn<(token: string, orderNumber: string) => Promise<CustomerShipmentsResponse>>(),
  myProductReview: vi.fn<() => Promise<unknown>>(),
}));

vi.mock('@/lib/session', () => ({
  session: {
    csrfToken: () => Promise.resolve('signed-csrf-value'),
    read: <T,>(call: SessionCall<T>): Promise<SessionRead<T>> => fakeRead(api as never, call),
  },
}));
vi.mock('@/lib/order-actions', () => ({ cancelOrderAction: vi.fn() }));

function page(orderNumber: string, params: SearchParams = {}) {
  return OrderPage({
    params: Promise.resolve({ orderNumber }),
    searchParams: Promise.resolve(params),
  });
}

beforeEach(() => {
  api.getOrder.mockReset();
  api.getOrder.mockResolvedValue({ order: orderDetail() });
  api.myOrderShipments.mockReset();
  api.myOrderShipments.mockResolvedValue({ shipments: [] });
});

describe('OrderPage', () => {
  it('shows the order: items, totals, address, payment and progress', async () => {
    render(await page('NZ100042'));

    expect(api.getOrder).toHaveBeenCalledWith('access-token', 'NZ100042');
    expect(screen.getByRole('heading', { level: 1, name: 'Order NZ100042' })).not.toBeNull();
    expect(screen.getAllByText('Awaiting confirmation').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Brass table lamp' }).getAttribute('href')).toBe(
      '/products/brass-table-lamp',
    );
    expect(screen.getByText('Qty 2 · ৳1,250 each')).not.toBeNull();
    // The line's own picture is shown, and a line without one falls back to the tile.
    const pictures = [...document.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(pictures).toContain('https://media.example.com/products/p/1/thumb.webp');
    expect(pictures.filter((src) => src?.includes('products/p/1/'))).toHaveLength(1);
    expect(screen.getByText('Subtotal')).not.toBeNull();
    expect(screen.getByText('৳3,100')).not.toBeNull();
    expect(screen.getByText('Delivery (Inside Dhaka)')).not.toBeNull();
    expect(screen.getByText('৳60')).not.toBeNull();
    expect(screen.getByText('৳3,160')).not.toBeNull();
    expect(screen.queryByText('Discount')).toBeNull();
    expect(screen.getByText('Near Opposite the lake')).not.toBeNull();
    expect(screen.getByText('Cash on Delivery')).not.toBeNull();
    expect(screen.getByText('Payment pending')).not.toBeNull();
    expect(screen.getByText('Pay in cash when your parcel arrives.')).not.toBeNull();
    expect(screen.getByText('Order placed')).not.toBeNull();
    expect(screen.getByText('24 October 2026 at 14:05')).not.toBeNull();
    // Pending orders may be cancelled, through a CSRF-protected form.
    expect(screen.getByText('Cancel this order')).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>('input[name="csrf_token"]')?.value).toBe(
      'signed-csrf-value',
    );
    expect(screen.queryByText(/Thank you/)).toBeNull();
  });

  it('signals the header only right after placing', async () => {
    const counts: unknown[] = [];
    const listener = (event: Event) => counts.push((event as CustomEvent).detail);
    window.addEventListener(CART_CHANGED_EVENT, listener);

    render(await page('NZ100042'));

    window.removeEventListener(CART_CHANGED_EVENT, listener);
    expect(counts).toEqual([]);
  });

  it('thanks the customer after placing, and has the header read the emptied cart', async () => {
    const counts: unknown[] = [];
    const listener = (event: Event) => counts.push((event as CustomEvent).detail);
    window.addEventListener(CART_CHANGED_EVENT, listener);

    render(await page('NZ100042', { placed: '1' }));

    window.removeEventListener(CART_CHANGED_EVENT, listener);
    expect(screen.getByRole('status').textContent).toBe(
      'Thank you — your order NZ100042 is placed.Pay in cash on delivery. We will confirm your order soon, and you can follow it here.',
    );
    // No count: the badge reads the cart cookie, which the order action has cleared.
    expect(counts).toEqual([{ count: undefined }]);
  });

  it('shows a cancelled order, its reason and the confirmation after cancelling', async () => {
    api.getOrder.mockResolvedValue({
      order: orderDetail({
        status: 'cancelled',
        paymentStatus: 'cancelled',
        canCancel: false,
        cancelledAt: '2026-10-24T09:00:00.000Z',
        cancelReason: 'Ordered twice',
        history: [
          { fromStatus: 'pending', toStatus: 'cancelled', at: '2026-10-24T09:00:00.000Z' },
          { fromStatus: null, toStatus: 'pending', at: '2026-10-24T08:05:00.000Z' },
        ],
      }),
    });

    render(await page('NZ100042', { cancelled: '1' }));

    expect(screen.getByText('Your order has been cancelled.')).not.toBeNull();
    expect(screen.getByText('This order is cancelled')).not.toBeNull();
    expect(screen.getByText('Reason: Ordered twice')).not.toBeNull();
    expect(screen.getByText('Nothing to pay: this order was cancelled.')).not.toBeNull();
    expect(screen.queryByText('Cancel this order')).toBeNull();
    // The timeline runs oldest first.
    const steps = Array.from(
      document.querySelectorAll('ol li p:first-child'),
      (p) => p.textContent,
    );
    expect(steps).toEqual(['Order placed', 'Cancelled']);
  });

  it('ignores the cancelled flag for an order that is not cancelled', async () => {
    render(await page('NZ100042', { cancelled: '1' }));
    expect(screen.queryByText('Your order has been cancelled.')).toBeNull();
  });

  it('shows the customer note and any discount', async () => {
    api.getOrder.mockResolvedValue({
      order: orderDetail({ customerNote: 'Call before\ncoming', discountMinor: 10_000 }),
    });

    render(await page('NZ100042'));

    expect(screen.getByText(/Call before/).textContent).toBe('Call before\ncoming');
    expect(screen.getByText('Discount')).not.toBeNull();
    expect(screen.getByText('−৳100')).not.toBeNull();
  });

  it.each([
    ['a malformed order number', 'NZ12'],
    ['a path', '..%2Fadmin'],
  ])('is not found for %s, without asking the API', async (_label, orderNumber) => {
    await expect(page(orderNumber)).rejects.toMatchObject(NOT_FOUND);
    expect(api.getOrder).not.toHaveBeenCalled();
  });

  it('is not found for a missing order, including other customers orders', async () => {
    api.getOrder.mockRejectedValue(apiError(404, 'not_found'));
    await expect(page('NZ100099')).rejects.toMatchObject(NOT_FOUND);
  });

  it('sends a signed-out visitor to sign in and back to the order', async () => {
    api.getOrder.mockRejectedValue(apiError(401, 'unauthenticated'));
    await expect(page('NZ100042')).rejects.toMatchObject(
      redirectedTo('/login?next=/account/orders/NZ100042'),
    );
  });

  it('explains an outage and a suspended account', async () => {
    api.getOrder.mockRejectedValueOnce(apiError(503, 'service_unavailable'));
    const { unmount } = render(await page('NZ100042'));
    expect(screen.getByText('We could not load this order')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe(
      '/account/orders/NZ100042',
    );
    unmount();

    api.getOrder.mockRejectedValueOnce(apiError(403, 'account_suspended'));
    render(await page('NZ100042'));
    expect(screen.getByText('This account is suspended')).not.toBeNull();
  });
  describe('courier tracking', () => {
    const shipped = () =>
      orderDetail({
        status: 'shipped',
        canCancel: false,
        history: [
          { fromStatus: null, toStatus: 'pending', at: '2026-10-24T08:05:00.000Z' },
          { fromStatus: 'pending', toStatus: 'shipped', at: '2026-10-25T04:00:00.000Z' },
        ],
      });

    it('shows the courier, status, tracking code and updates beside the order', async () => {
      api.getOrder.mockResolvedValue({ order: shipped() });
      api.myOrderShipments.mockResolvedValue({ shipments: [customerShipment()] });

      render(await page('NZ100042'));

      expect(api.myOrderShipments).toHaveBeenCalledWith('access-token', 'NZ100042');
      expect(screen.getByRole('heading', { level: 2, name: 'Delivery tracking' })).not.toBeNull();
      expect(screen.getByText('Steadfast Courier')).not.toBeNull();
      expect(screen.getByText('SF123456789')).not.toBeNull();
      expect(screen.getByText('Courier status:').parentElement?.textContent).toBe(
        'Courier status: In transit',
      );
      // The order keeps its own status: tracking never relabels it.
      expect(screen.getAllByText('On the way').length).toBeGreaterThan(0);
      expect(screen.queryByText(/once your parcel is with the courier/)).toBeNull();
    });

    it('says tracking will come while the order waits for a courier', async () => {
      api.getOrder.mockResolvedValue({ order: shipped() });

      render(await page('NZ100042'));

      expect(screen.queryByRole('heading', { name: 'Delivery tracking' })).toBeNull();
      expect(
        screen.getByText('Courier tracking appears here once your parcel is with the courier.'),
      ).not.toBeNull();
    });

    it.each([
      ['an outage', () => apiError(503, 'service_unavailable')],
      ['a refusal', () => apiError(403, 'forbidden')],
      ['an unexpected failure', () => new Error('boom')],
    ])('keeps the order page whole after %s', async (_label, failure) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      api.getOrder.mockResolvedValue({ order: shipped() });
      api.myOrderShipments.mockRejectedValue(failure());

      render(await page('NZ100042'));

      expect(screen.getByRole('heading', { level: 1, name: 'Order NZ100042' })).not.toBeNull();
      expect(screen.queryByRole('heading', { name: 'Delivery tracking' })).toBeNull();
      expect(screen.queryByText(/once your parcel is with the courier/)).toBeNull();
    });

    it('does not ask for tracking while the order awaits confirmation', async () => {
      render(await page('NZ100042'));

      expect(api.myOrderShipments).not.toHaveBeenCalled();
      expect(screen.queryByText(/once your parcel is with the courier/)).toBeNull();
    });

    it('shows a return pickup with a link to its return', async () => {
      const returnId = '4b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f';
      api.getOrder.mockResolvedValue({
        order: orderDetail({ status: 'delivered', paymentStatus: 'collected', canCancel: false }),
      });
      api.myProductReview.mockResolvedValue({ review: null });
      api.myOrderShipments.mockResolvedValue({
        shipments: [
          customerShipment({
            id: '5e000000-0000-4000-8000-000000000009',
            kind: 'return_pickup',
            returnRequestId: returnId,
            status: 'pickup_pending',
            trackingUrl: null,
            events: [{ status: 'booked', occurredAt: '2026-10-28T04:00:00.000Z' }],
          }),
        ],
      });

      render(await page('NZ100042'));

      expect(screen.getByRole('heading', { level: 2, name: 'Return pickup' })).not.toBeNull();
      expect(screen.getByRole('link', { name: 'View the return' }).getAttribute('href')).toBe(
        `/account/returns/${returnId}`,
      );
      expect(screen.queryByRole('heading', { name: 'Delivery tracking' })).toBeNull();
    });
  });
});
