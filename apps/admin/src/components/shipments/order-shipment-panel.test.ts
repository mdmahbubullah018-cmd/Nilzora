import type { OrderCourierContext } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import { notBookableText } from './order-shipment-panel';

function context(
  status: string,
  overrides: Partial<Pick<OrderCourierContext, 'bookable' | 'notBookableReason'>> = {},
): OrderCourierContext {
  return {
    order: { status },
    bookable: false,
    notBookableReason: 'order_status',
    ...overrides,
  } as OrderCourierContext;
}

describe('notBookableText', () => {
  it('says nothing for an order that can be booked', () => {
    expect(notBookableText(context('confirmed', { bookable: true, notBookableReason: null }))).toBe(
      null,
    );
  });

  it('is status-aware for orders that are finished', () => {
    expect(notBookableText(context('delivered'))).toBe(
      'This order is delivered, so no new parcel can be booked.',
    );
    expect(notBookableText(context('cancelled'))).toBe(
      'This order is cancelled, so no new parcel can be booked.',
    );
  });

  it('promises a booking only for an order that is still pending', () => {
    expect(notBookableText(context('pending'))).toBe(
      'A courier can be booked once the order is confirmed.',
    );
  });

  it('points at the existing parcel when one is active', () => {
    expect(notBookableText(context('shipped', { notBookableReason: 'active_shipment' }))).toMatch(
      /already has an active shipment/,
    );
  });
});
