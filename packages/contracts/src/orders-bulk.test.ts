import { describe, expect, it } from 'vitest';
import { adminOrderListQuerySchema } from './admin-orders';
import {
  BULK_ORDER_LIMIT,
  bulkOrderStatusRequestSchema,
  bulkShipmentBookingRequestSchema,
} from './orders-bulk';
import {
  COURIER_LIVE_CONFIRMATION,
  courierOperationsRequestSchema,
  courierVerifyConfirmation,
} from './shipments';

const KEY_A = '9b2f0a64-6a3e-4c1f-9d55-1a2b3c4d5e6f';
const KEY_B = '1b2f0a64-6a3e-4c1f-9d55-1a2b3c4d5e6f';

describe('bulk order contracts', () => {
  it('limits and de-duplicates the selection', () => {
    const many = Array.from({ length: BULK_ORDER_LIMIT + 1 }, (_, i) => `NZ${1000 + i}`);
    expect(
      bulkOrderStatusRequestSchema.safeParse({ orderNumbers: many, status: 'confirmed' }).success,
    ).toBe(false);
    expect(
      bulkOrderStatusRequestSchema.safeParse({ orderNumbers: [], status: 'confirmed' }).success,
    ).toBe(false);
    expect(
      bulkOrderStatusRequestSchema.safeParse({ orderNumbers: ['NZ1', 'NZ1'], status: 'confirmed' })
        .success,
    ).toBe(false);
    expect(
      bulkOrderStatusRequestSchema.safeParse({ orderNumbers: ['NZ1'], status: 'confirmed' })
        .success,
    ).toBe(true);
  });

  it('never moves orders back to pending and needs a reason to cancel', () => {
    expect(
      bulkOrderStatusRequestSchema.safeParse({ orderNumbers: ['NZ1'], status: 'pending' }).success,
    ).toBe(false);
    expect(
      bulkOrderStatusRequestSchema.safeParse({ orderNumbers: ['NZ1'], status: 'cancelled' })
        .success,
    ).toBe(false);
    expect(
      bulkOrderStatusRequestSchema.safeParse({
        orderNumbers: ['NZ1'],
        status: 'cancelled',
        note: 'Out of stock',
      }).success,
    ).toBe(true);
  });

  it('books parcels only with an explicit confirmation and one key per order', () => {
    const items = [
      { orderNumber: 'NZ1', bookingKey: KEY_A },
      { orderNumber: 'NZ2', bookingKey: KEY_B },
    ];
    expect(
      bulkShipmentBookingRequestSchema.safeParse({ provider: 'steadfast', confirm: true, items })
        .success,
    ).toBe(true);
    expect(
      bulkShipmentBookingRequestSchema.safeParse({ provider: 'steadfast', items }).success,
    ).toBe(false);
    expect(
      bulkShipmentBookingRequestSchema.safeParse({ provider: 'steadfast', confirm: false, items })
        .success,
    ).toBe(false);
    expect(
      bulkShipmentBookingRequestSchema.safeParse({
        provider: 'steadfast',
        confirm: true,
        items: [items[0], { orderNumber: 'NZ2', bookingKey: KEY_A }],
      }).success,
    ).toBe(false);
  });

  it('sorts and filters the order list by known values only', () => {
    expect(
      adminOrderListQuerySchema.safeParse({ sort: 'total_high', deliveryZone: 'inside_dhaka' })
        .success,
    ).toBe(true);
    expect(adminOrderListQuerySchema.safeParse({ sort: 'random()' }).success).toBe(false);
  });
});

describe('courier operations contracts', () => {
  it('bounds the operating switches', () => {
    const base = {
      mode: 'mock',
      bookingEnabled: false,
      trackingSyncEnabled: true,
      trackingSyncIntervalSeconds: 300,
      httpTimeoutMs: 15000,
    };
    expect(courierOperationsRequestSchema.safeParse(base).success).toBe(true);
    expect(
      courierOperationsRequestSchema.safeParse({ ...base, trackingSyncIntervalSeconds: 10 })
        .success,
    ).toBe(false);
    expect(
      courierOperationsRequestSchema.safeParse({ ...base, httpTimeoutMs: 120000 }).success,
    ).toBe(false);
    expect(courierOperationsRequestSchema.safeParse({ ...base, mode: 'production' }).success).toBe(
      false,
    );
  });

  it('names the typed confirmations the database requires', () => {
    expect(COURIER_LIVE_CONFIRMATION).toBe('ENABLE LIVE COURIERS');
    expect(courierVerifyConfirmation('pathao')).toBe('VERIFY PATHAO');
  });
});
