import type { OrderDetail } from '@nilzora/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrderSuccess } from './order-success';

function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    orderNumber: 'NZ100042',
    status: 'pending',
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    itemCount: 2,
    totalMinor: 309000,
    placedAt: '2026-11-06T04:30:00.000Z',
    preview: [],
    currency: 'BDT',
    subtotalMinor: 300000,
    shippingFeeMinor: 9000,
    discountMinor: 0,
    deliveryZone: 'inside_dhaka',
    shippingAddress: {
      recipientName: 'Ayesha Rahman',
      phone: '+8801712345678',
      division: 'Dhaka',
      district: 'Dhaka',
      area: 'Dhanmondi',
      addressLine: 'House 12, Road 5',
      postalCode: null,
      landmark: null,
    },
    customerNote: null,
    cancelReason: null,
    cancelledAt: null,
    items: [],
    history: [],
    canCancel: true,
    ...overrides,
  };
}

describe('OrderSuccess', () => {
  it('confirms the order concisely and offers exactly two actions, both for this order', () => {
    render(<OrderSuccess order={order()} pdfHref="/account/orders/NZ100042/receipt/pdf" />);

    expect(
      screen.getByRole('heading', { name: 'Your order has been placed successfully!' }),
    ).toBeTruthy();
    expect(screen.getByText('NZ100042')).toBeTruthy();

    const view = screen.getByRole('link', { name: /View order details/ });
    expect(view.getAttribute('href')).toBe('/account/orders/NZ100042');
    const save = screen.getByRole('link', { name: /Save order details/ });
    expect(save.getAttribute('href')).toBe('/account/orders/NZ100042/receipt/pdf');
    expect(save.hasAttribute('download')).toBe(true);
  });

  it('does not repeat the order details underneath, and never calls a cash order paid', () => {
    render(<OrderSuccess order={order()} pdfHref="/account/orders/NZ100042/receipt/pdf" />);
    // The address, items and amounts live in the order page and the receipt, not here.
    expect(screen.queryByText(/Ayesha Rahman/)).toBeNull();
    expect(screen.queryByText(/Dhanmondi/)).toBeNull();
    expect(screen.queryByText(/Delivering to/i)).toBeNull();
    expect(screen.getByText(/in cash when it arrives/)).toBeTruthy();
    expect(screen.queryByText(/\bpaid\b/i)).toBeNull();
  });

  it('says nothing is due when nothing is', () => {
    render(
      <OrderSuccess
        order={order({ paymentStatus: 'cancelled' })}
        pdfHref="/account/orders/NZ100042/receipt/pdf"
      />,
    );
    expect(screen.getByText('Nothing is left to pay on this order.')).toBeTruthy();
  });
});
