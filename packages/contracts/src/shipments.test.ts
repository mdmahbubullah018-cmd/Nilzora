import { describe, expect, it } from 'vitest';
import { CUSTOMER_NOTIFICATION_KINDS } from './customer-notifications';
import { PERMISSIONS } from './auth';
import {
  bookShipmentRequestSchema,
  courierProviderRequestSchema,
  customerShipmentSchema,
  recordCourierSettlementRequestSchema,
  recordShipmentStatusRequestSchema,
  resolveShipmentBookingRequestSchema,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUSES,
} from './shipments';

const SHIPMENT = '9b2f0a64-6a3e-4c1f-9d55-1a2b3c4d5e6f';

describe('shipments contract', () => {
  it('mirrors the database shipment_status enum, in order', () => {
    // supabase/migrations/20261223091000_courier_foundation.sql
    expect(SHIPMENT_STATUSES).toEqual([
      'draft',
      'quoted',
      'booking_pending',
      'booking_failed',
      'booked',
      'pickup_pending',
      'picked_up',
      'in_transit',
      'on_hold',
      'out_for_delivery',
      'delivered',
      'partially_delivered',
      'delivery_failed',
      'cancelled',
      'return_initiated',
      'returned',
      'unknown',
    ]);
    expect(Object.keys(SHIPMENT_STATUS_LABELS).sort()).toEqual([...SHIPMENT_STATUSES].sort());
  });

  it('knows the courier permissions and the shipment notification kind', () => {
    for (const name of [
      'couriers.read',
      'couriers.configure',
      'couriers.pricing.manage',
      'shipments.read',
      'shipments.create',
      'shipments.cancel',
      'shipments.track',
      'shipments.returns.manage',
      'couriers.cod.read',
      'couriers.cod.reconcile',
    ]) {
      expect(PERMISSIONS).toContain(name);
    }
    expect(CUSTOMER_NOTIFICATION_KINDS).toContain('shipment_update');
  });

  it('refuses credential-looking provider settings', () => {
    const base = { isEnabled: true, codFeeBp: 100, returnChargeMinor: null };
    expect(
      courierProviderRequestSchema.safeParse({ ...base, settings: { storeId: '12' } }).success,
    ).toBe(true);
    for (const key of ['apiKey', 'secretKey', 'clientSecret', 'password', 'webhookToken']) {
      expect(
        courierProviderRequestSchema.safeParse({ ...base, settings: { [key]: 'x' } }).success,
      ).toBe(false);
    }
  });

  it('needs a booking key and never takes a price from the client', () => {
    const body = { bookingKey: SHIPMENT, provider: 'steadfast', weightGrams: 500 };
    expect(bookShipmentRequestSchema.safeParse(body).success).toBe(true);
    expect(bookShipmentRequestSchema.safeParse({ ...body, bookingKey: undefined }).success).toBe(
      false,
    );
    expect(bookShipmentRequestSchema.safeParse({ ...body, codAmountMinor: 1 }).success).toBe(false);
    expect(bookShipmentRequestSchema.safeParse({ ...body, chargeMinor: 1 }).success).toBe(false);
    expect(bookShipmentRequestSchema.safeParse({ ...body, weightGrams: 0 }).success).toBe(false);
  });

  it('resolves an uncertain booking only with a note, and a consignment id when booked', () => {
    expect(
      resolveShipmentBookingRequestSchema.safeParse({
        outcome: 'not_created',
        note: 'Not in portal',
      }).success,
    ).toBe(true);
    expect(
      resolveShipmentBookingRequestSchema.safeParse({ outcome: 'booked', note: 'Found in portal' })
        .success,
    ).toBe(false);
    expect(
      resolveShipmentBookingRequestSchema.safeParse({ outcome: 'not_created', note: 'ok' }).success,
    ).toBe(false);
  });

  it('never lets staff set booking statuses by hand', () => {
    expect(
      recordShipmentStatusRequestSchema.safeParse({ status: 'delivered', note: 'Courier phoned' })
        .success,
    ).toBe(true);
    expect(
      recordShipmentStatusRequestSchema.safeParse({ status: 'booked', note: 'Courier phoned' })
        .success,
    ).toBe(false);
  });

  it('requires settlement lines to add up to the payout, each shipment once', () => {
    const base = { provider: 'steadfast', reference: 'PAY-1', receivedOn: '2026-11-14' };
    expect(
      recordCourierSettlementRequestSchema.safeParse({
        ...base,
        amountMinor: 300,
        lines: [{ shipmentId: SHIPMENT, settledMinor: 300, codFeeMinor: 10 }],
      }).success,
    ).toBe(true);
    expect(
      recordCourierSettlementRequestSchema.safeParse({
        ...base,
        amountMinor: 301,
        lines: [{ shipmentId: SHIPMENT, settledMinor: 300 }],
      }).success,
    ).toBe(false);
    expect(
      recordCourierSettlementRequestSchema.safeParse({
        ...base,
        amountMinor: 2,
        lines: [
          { shipmentId: SHIPMENT, settledMinor: 1 },
          { shipmentId: SHIPMENT, settledMinor: 1 },
        ],
      }).success,
    ).toBe(false);
  });

  it('gives customers no courier money', () => {
    const keys = Object.keys(customerShipmentSchema.shape);
    expect(keys.some((key) => /Minor$|charge|fee|^cod/i.test(key))).toBe(false);
  });
});
