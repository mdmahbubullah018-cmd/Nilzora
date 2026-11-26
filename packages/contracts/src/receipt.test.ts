import { describe, expect, it } from 'vitest';
import type { OrderDetail } from './orders';
import {
  receiptDateText,
  receiptFileName,
  receiptLines,
  receiptMoney,
  receiptMoneyEnglish,
  receiptShareText,
  receiptText,
} from './receipt';

/*
 * The receipt's wording and arithmetic. The point of these tests is that a receipt is built
 * only from the order it is given: nothing is recalculated, and the shareable form never
 * carries the customer's own contact details.
 */

function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    orderNumber: 'NZ100042',
    status: 'pending',
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    itemCount: 2,
    totalMinor: 190_000,
    placedAt: '2026-11-07T10:05:00.000Z',
    preview: [],
    currency: 'BDT',
    subtotalMinor: 200_000,
    shippingFeeMinor: 10_000,
    discountMinor: 20_000,
    deliveryZone: 'inside_dhaka',
    shippingAddress: {
      recipientName: 'Ayesha Rahman',
      phone: '+8801712345678',
      division: 'Dhaka',
      district: 'Dhaka',
      area: 'Dhanmondi',
      addressLine: 'House 12, Road 5',
      postalCode: '1209',
      landmark: 'City College',
    },
    customerNote: 'Call before 6pm.',
    cancelReason: null,
    cancelledAt: null,
    items: [
      {
        orderItemId: 1,
        productId: '7e000000-0000-4000-8000-000000000001',
        variantId: '7e000000-0000-4000-8000-000000000002',
        variantLabel: 'Size: M / Colour: Navy',
        productName: 'Cotton Panjabi',
        productSlug: 'cotton-panjabi',
        sku: 'NZ-PAN-M-NVY',
        unitPriceMinor: 150_000,
        quantity: 1,
        lineTotalMinor: 150_000,
        image: null,
        regularPriceMinor: 150_000,
        catalogPriceMinor: 150_000,
        campaignId: null,
        campaignTitle: null,
        campaignDiscountMinor: 0,
      },
      {
        orderItemId: 2,
        productId: '7e000000-0000-4000-8000-000000000003',
        variantId: null,
        variantLabel: null,
        productName: 'Cotton Handkerchief',
        productSlug: 'cotton-handkerchief',
        sku: 'NZ-HANK-01',
        unitPriceMinor: 25_000,
        quantity: 2,
        lineTotalMinor: 50_000,
        image: null,
        regularPriceMinor: 25_000,
        catalogPriceMinor: 25_000,
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

describe('receipt money', () => {
  it('writes amounts in English only, with the Bangladeshi grouping and poisha when there are any', () => {
    expect(receiptMoneyEnglish(0)).toBe('BDT 0');
    expect(receiptMoneyEnglish(125_000)).toBe('BDT 1,250');
    expect(receiptMoneyEnglish(12_500_050)).toBe('BDT 1,25,000.50');
    expect(receiptMoneyEnglish(-20_000)).toBe('-BDT 200');
    expect(receiptMoneyEnglish(Number.NaN)).toBe('');
  });

  it('takes every amount from the order, never from its own arithmetic', () => {
    const money = receiptMoney(order());
    expect(money).toEqual({
      subtotalMinor: 200_000,
      discountMinor: 20_000,
      shippingFeeMinor: 10_000,
      totalMinor: 190_000,
      paidMinor: 0,
      dueMinor: 190_000,
    });
  });

  it('counts a collected payment as paid and a cancelled order as owing nothing', () => {
    expect(receiptMoney(order({ paymentStatus: 'collected' })).paidMinor).toBe(190_000);
    expect(receiptMoney(order({ paymentStatus: 'collected' })).dueMinor).toBe(0);
    expect(receiptMoney(order({ paymentStatus: 'cancelled' })).dueMinor).toBe(0);
  });

  it('would rather show the order’s own total than a recalculated one', () => {
    // The order's total is authoritative even if the parts did not add up (a legacy row).
    expect(receiptMoney(order({ totalMinor: 1 })).totalMinor).toBe(1);
  });
});

describe('receipt lines', () => {
  it('keeps the product, the variant and the quantity of every real line', () => {
    const lines = receiptLines(order());
    expect(lines.map((line) => line.title)).toEqual([
      '1 × Cotton Panjabi · Size: M / Colour: Navy',
      '2 × Cotton Handkerchief',
    ]);
    expect(lines.map((line) => line.sku)).toEqual(['NZ-PAN-M-NVY', 'NZ-HANK-01']);
    expect(lines.map((line) => line.lineTotalMinor)).toEqual([150_000, 50_000]);
  });

  it('shows the order’s date and time on the store’s own calendar', () => {
    expect(receiptDateText('2026-11-07T10:05:00.000Z')).toBe('7 November 2026, 16:05');
    expect(receiptDateText('2026-11-07T18:30:00.000Z')).toBe('8 November 2026, 00:30');
    expect(receiptDateText('nonsense')).toBe('');
  });

  it('names the file after the order', () => {
    expect(receiptFileName('NZ100042')).toBe('Nilzora-Receipt-NZ100042.pdf');
  });
});

describe('receipt text', () => {
  it('prints the whole receipt, including the address the order was sent to', () => {
    const text = receiptText(order());
    expect(text).toContain('Nilzora');
    expect(text).toContain('Order receipt — NZ100042');
    expect(text).toContain('Placed 7 November 2026, 16:05');
    expect(text).toContain('1 × Cotton Panjabi · Size: M / Colour: Navy');
    expect(text).toContain('NZ-HANK-01 · BDT 250 each · BDT 500');
    expect(text).toContain('Subtotal: BDT 2,000');
    expect(text).toContain('Delivery charge: BDT 100');
    expect(text).toContain('Discount: -BDT 200');
    expect(text).toContain('Total: BDT 1,900');
    expect(text).toContain('Paid: BDT 0');
    expect(text).toContain('Due on delivery: BDT 1,900');
    expect(text).toContain('Payment method: Cash on Delivery');
    expect(text).toContain('House 12, Road 5 (near City College)');
    expect(text).toContain('Note for delivery: Call before 6pm.');
  });

  it('is English only: no currency or punctuation glyph a plain-text reader cannot show', () => {
    // Everything a customer copies, pastes or prints must survive any editor and any font.
    expect(receiptText(order())).not.toMatch(/[৳−]/);
    expect(receiptShareText(order())).not.toMatch(/[৳−]/);
  });

  it('leaves out the delivery charge line only when it is zero', () => {
    expect(receiptText(order({ shippingFeeMinor: 0 }))).toContain('Delivery charge: Free');
  });

  it('omits the note when the customer did not write one', () => {
    expect(receiptText(order({ customerNote: null }))).not.toContain('Note for delivery');
  });
});

describe('shared receipt text', () => {
  it('shows what was bought without the customer’s contact details', () => {
    const text = receiptShareText(order());
    expect(text).toContain('Order receipt — NZ100042');
    expect(text).toContain('1 × Cotton Panjabi · Size: M / Colour: Navy');
    expect(text).toContain('Total: BDT 1,900');
    expect(text).not.toContain('Ayesha Rahman');
    expect(text).not.toContain('+8801712345678');
    expect(text).not.toContain('House 12, Road 5');
    expect(text).not.toContain('Dhanmondi');
    expect(text).not.toContain('Call before 6pm');
    expect(text).not.toContain('@');
  });
});
