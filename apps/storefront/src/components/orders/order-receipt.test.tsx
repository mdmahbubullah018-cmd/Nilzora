import type { OrderDetail } from '@nilzora/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OrderReceipt } from './order-receipt';

// The logo is a next/image; the receipt's content is what this file is about.
vi.mock('@/components/brand/nilzora-logo', () => ({
  NilzoraLogo: () => <span data-testid="logo" />,
}));

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
    items: [
      {
        orderItemId: 1,
        productId: '11111111-1111-4111-8111-111111111111',
        variantId: null,
        variantLabel: 'Size: M / Colour: Navy',
        productName: 'Cotton panjabi',
        productSlug: 'cotton-panjabi',
        sku: 'NZ-PAN-01',
        unitPriceMinor: 150000,
        quantity: 2,
        lineTotalMinor: 300000,
        image: null,
        regularPriceMinor: 150000,
        catalogPriceMinor: 150000,
        campaignId: null,
        campaignTitle: null,
        campaignDiscountMinor: 0,
      },
    ],
    history: [],
    canCancel: true,
    ...overrides,
  };
}

describe('OrderReceipt', () => {
  it('shows cash on delivery as pending, never as paid', () => {
    render(<OrderReceipt order={order()} />);

    expect(screen.getByText('Cash on Delivery')).toBeTruthy();
    expect(screen.getByText('Payment pending')).toBeTruthy();
    // An unpaid COD order must not read as paid anywhere on the paper.
    expect(screen.queryByText('Paid')).toBeNull();
    expect(screen.queryByText(/payment successful/i)).toBeNull();
    expect(
      screen.getByText(/Nothing has been paid yet\. Pay ৳3,090 in cash when your parcel arrives\./),
    ).toBeTruthy();
  });

  it('prints the order as it was saved: items, variant, quantities and totals', () => {
    render(<OrderReceipt order={order()} />);

    expect(screen.getByRole('table', { name: 'What this order contains' })).toBeTruthy();
    expect(screen.getByText('Cotton panjabi')).toBeTruthy();
    expect(screen.getByText('Size: M / Colour: Navy')).toBeTruthy();
    expect(screen.getByText(/৳1,500 each · SKU NZ-PAN-01/)).toBeTruthy();
    expect(screen.getAllByText('৳3,000').length).toBeGreaterThan(0);
    expect(screen.getByText('Order NZ100042')).toBeTruthy();
    expect(screen.getByText('Ayesha Rahman')).toBeTruthy();
    expect(screen.getByText(/01712-345678/)).toBeTruthy();
  });

  it('shows a discount row only when the order has a discount', () => {
    const { unmount } = render(<OrderReceipt order={order()} />);
    expect(screen.queryByText('Discount')).toBeNull();
    unmount();

    render(<OrderReceipt order={order({ discountMinor: 5000, totalMinor: 304000 })} />);
    expect(screen.getByText('Discount')).toBeTruthy();
  });

  it('reports a delivered, collected order as paid in cash', () => {
    render(<OrderReceipt order={order({ status: 'delivered', paymentStatus: 'collected' })} />);

    // The badge says "Paid" too, so the totals row is read from the list of amounts.
    expect(screen.getByText('Paid', { selector: 'dt' })).toBeTruthy();
    expect(screen.getByText('Paid in cash when this order was delivered.')).toBeTruthy();
    expect(screen.getByText('Nothing')).toBeTruthy();
  });

  it('shows what a pending order still owes and nothing as paid', () => {
    render(<OrderReceipt order={order()} />);

    expect(screen.queryByText('Paid', { selector: 'dt' })).toBeNull();
    expect(screen.getByText('Due')).toBeTruthy();
    expect(screen.getAllByText('৳3,000').length).toBeGreaterThan(0);
  });

  it('keeps a cancelled order honest about payment', () => {
    render(
      <OrderReceipt
        order={order({ status: 'cancelled', paymentStatus: 'cancelled', canCancel: false })}
      />,
    );

    expect(screen.getByText('Nothing was charged: this order was cancelled.')).toBeTruthy();
    expect(screen.queryByText('Paid', { selector: 'dt' })).toBeNull();
    expect(screen.getByText('Nothing')).toBeTruthy();
  });
});
