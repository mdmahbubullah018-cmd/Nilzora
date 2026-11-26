import { randomUUID } from 'node:crypto';
import {
  bookShipmentResponseSchema,
  courierCheckResponseSchema,
  courierCompareResponseSchema,
  courierConfigResponseSchema,
  courierRateCardSchema,
  customerShipmentsResponseSchema,
  recordShipmentStatusResponseSchema,
  refreshShipmentResponseSchema,
  shipmentSchema,
} from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import {
  MOCK_SIGNATURE_HEADER,
  MOCK_TIMESTAMP_HEADER,
  signMockWebhook,
} from '../modules/couriers/mock-provider';
import { errorOf } from './commerce-helpers';
import {
  courierSetup,
  TEST_MOCK_SECRET,
  type CourierSetup,
  type CourierSetupOptions,
} from './courier-helpers';

const MOCK: CourierSetupOptions = {
  mode: 'mock',
  env: { COURIER_MOCK_WEBHOOK_SECRET: TEST_MOCK_SECRET },
};
const LIVE: CourierSetupOptions = { mode: 'live', bookingEnabled: true };

const webhookAnswerSchema = z.object({
  received: z.literal(true),
  duplicate: z.boolean().optional(),
});

function bookBody(overrides: object = {}) {
  return { bookingKey: randomUUID(), provider: 'steadfast', weightGrams: 800, ...overrides };
}

const code = (response: request.Response) => errorOf(response.body).code;
const booking = (response: request.Response) => bookShipmentResponseSchema.parse(response.body);

/** A real (non-mock) booked shipment, as staff would have recorded after the portal. */
async function realBookedShipment(setup: CourierSetup, consignmentId = 'SF-REAL-1') {
  const account = setup.store.providers.find((p) => p.provider === 'steadfast');
  if (account) account.isEnabled = true;
  const shipment = await setup.store.recordPortalBooking(
    setup.caller('owner'),
    setup.order.orderNumber,
    {
      returnId: null,
      bookingKey: randomUUID(),
      provider: 'steadfast',
      weightGrams: 500,
      consignmentId,
      trackingCode: null,
      chargeMinor: null,
      note: 'Booked in the merchant portal',
      recommendedProvider: null,
      selectionReason: null,
      isMock: false,
    },
  );
  return shipment.id;
}

async function bookMock(setup: CourierSetup, overrides: object = {}) {
  return booking(
    await setup.call(
      'post',
      `/admin/orders/${setup.order.orderNumber}/shipments`,
      'admin',
      bookBody(overrides),
    ),
  );
}

describe('courier route permissions', () => {
  it('refuses anonymous callers and staff without courier grants', async () => {
    const setup = courierSetup(MOCK);
    const n = setup.order.orderNumber;
    expect((await setup.call('get', '/admin/couriers/config')).status).toBe(401);
    const denied = [
      setup.call('get', '/admin/couriers/config', 'staff'),
      setup.call('get', '/admin/couriers/overview', 'staff'),
      setup.call('put', '/admin/couriers/settings', 'staff', {
        defaultParcelWeightGrams: 500,
        quoteValidityMinutes: 30,
        preferredProvider: null,
        minHistorySample: 20,
      }),
      setup.call('post', '/admin/couriers/rate-cards', 'staff', {
        provider: 'steadfast',
        zone: 'inside_dhaka',
        weightUpToGrams: 1000,
        chargeMinor: 6000,
      }),
      setup.call('get', `/admin/orders/${n}/courier`, 'staff'),
      setup.call('post', `/admin/orders/${n}/courier/quotes`, 'staff', {}),
      setup.call('post', `/admin/orders/${n}/shipments`, 'staff', bookBody()),
      setup.call('get', '/admin/shipments', 'staff'),
      setup.call('post', `/admin/shipments/${randomUUID()}/cancel`, 'staff', {
        reason: 'Customer asked',
      }),
      setup.call('post', `/admin/shipments/${randomUUID()}/refresh`, 'staff', {}),
      setup.call('get', '/admin/couriers/cod', 'staff'),
      setup.call('get', '/admin/couriers/settlements', 'staff'),
      setup.call('post', `/admin/returns/${randomUUID()}/pickup`, 'staff', bookBody()),
    ];
    for (const response of await Promise.all(denied)) {
      expect(response.status).toBe(403);
      expect(code(response)).toBe('forbidden');
    }
    expect(setup.calls.book).toBe(0);
    // Nothing reached the "database" for a refused caller.
    expect(setup.store.calls).toEqual([]);
  });

  it('lets an admin read and book but keeps provider configuration for the owner', async () => {
    const setup = courierSetup(MOCK);
    const settings = {
      defaultParcelWeightGrams: 700,
      quoteValidityMinutes: 45,
      preferredProvider: 'pathao',
      minHistorySample: 10,
    };
    const config = await setup.call('get', '/admin/couriers/config', 'admin');
    expect(config.status).toBe(200);
    expect(config.headers['cache-control']).toBe('no-store');
    expect(courierConfigResponseSchema.parse(config.body).mode).toBe('mock');

    expect((await setup.call('put', '/admin/couriers/settings', 'admin', settings)).status).toBe(
      403,
    );
    expect(
      (await setup.call('post', '/admin/couriers/providers/steadfast/check', 'admin', {})).status,
    ).toBe(403);

    const saved = await setup.call('put', '/admin/couriers/settings', 'owner', settings);
    expect(saved.status).toBe(200);
    expect(courierConfigResponseSchema.parse(saved.body).settings).toMatchObject({
      defaultParcelWeightGrams: 700,
      preferredProvider: 'pathao',
    });
  });

  it('follows per-account grants for staff', async () => {
    const setup = courierSetup(MOCK);
    setup.grant('staff', 'shipments.read');
    expect((await setup.call('get', '/admin/couriers/config', 'staff')).status).toBe(200);
    const book = await setup.call(
      'post',
      `/admin/orders/${setup.order.orderNumber}/shipments`,
      'staff',
      bookBody(),
    );
    expect(book.status).toBe(403);
  });

  it('never reveals a credential, only whether it is configured', async () => {
    const setup = courierSetup({
      ...MOCK,
      env: {
        COURIER_MOCK_WEBHOOK_SECRET: TEST_MOCK_SECRET,
        STEADFAST_API_KEY: 'sf-key-not-real-123',
        STEADFAST_SECRET_KEY: 'sf-secret-not-real-456',
      },
    });
    const response = await setup.call('get', '/admin/couriers/config', 'owner');
    expect(JSON.stringify(response.body)).not.toContain('not-real');
    const steadfast = courierConfigResponseSchema
      .parse(response.body)
      .providers.find((p) => p.provider === 'steadfast');
    // Both required fields come from the environment; nothing is in the vault.
    expect(steadfast?.credentialsConfigured).toBe(true);
    expect(steadfast?.credentials).toEqual([
      { field: 'api_key', source: 'environment', setAt: null },
      { field: 'secret_key', source: 'environment', setAt: null },
    ]);
    expect(steadfast?.readiness.baseUrlValid).toBe(false);
  });
});

describe('courier configuration in each mode', () => {
  it('reports the blocked real adapters in live mode', async () => {
    const setup = courierSetup(LIVE);
    const response = await setup.call('get', '/admin/couriers/config', 'owner');
    expect(response.status).toBe(200);
    const providers = courierConfigResponseSchema.parse(response.body).providers;
    const steadfast = providers.find((p) => p.provider === 'steadfast');
    const pathao = providers.find((p) => p.provider === 'pathao');
    expect(steadfast?.capabilities.book).toBe('awaiting_documentation');
    expect(steadfast?.capabilities.cancel).toBe('unsupported');
    expect(pathao?.capabilities.cancel).toBe('awaiting_documentation');
    expect(steadfast?.blockedReason).toContain('Steadfast');
  });

  it('records a live connection check as blocked without calling anything', async () => {
    const setup = courierSetup(LIVE);
    const response = await setup.call(
      'post',
      '/admin/couriers/providers/pathao/check',
      'owner',
      {},
    );
    expect(response.status).toBe(200);
    const check = courierCheckResponseSchema.parse(response.body);
    expect(check).toMatchObject({ provider: 'pathao', ok: false, mode: 'live' });
    expect(check.message).toContain('documentation is verified');
    expect(setup.store.providers.find((p) => p.provider === 'pathao')?.lastCheckOk).toBe(false);
  });

  it('refuses a connection check while couriers are off', async () => {
    const setup = courierSetup();
    const response = await setup.call(
      'post',
      '/admin/couriers/providers/pathao/check',
      'owner',
      {},
    );
    expect(response.status).toBe(503);
    expect(code(response)).toBe('courier_unavailable');
  });

  it('manages rate cards and answers 204 on delete', async () => {
    const setup = courierSetup();
    const body = {
      provider: 'steadfast',
      zone: 'inside_dhaka',
      weightUpToGrams: 1000,
      chargeMinor: 6000,
    };
    const created = await setup.call('post', '/admin/couriers/rate-cards', 'admin', body);
    expect(created.status).toBe(201);
    const card = courierRateCardSchema.parse(created.body);
    expect(card).toMatchObject({ ...body, isActive: true });
    const clash = await setup.call('post', '/admin/couriers/rate-cards', 'admin', body);
    expect(clash.status).toBe(400);
    const removed = await setup.call('delete', `/admin/couriers/rate-cards/${card.id}`, 'admin');
    expect(removed.status).toBe(204);
  });
});

describe('comparing couriers', () => {
  it('prices both couriers with the mock and recommends the cheaper one', async () => {
    const setup = courierSetup(MOCK);
    const response = await setup.call(
      'post',
      `/admin/orders/${setup.order.orderNumber}/courier/quotes`,
      'admin',
      { weightGrams: 800 },
    );
    expect(response.status).toBe(200);
    const compared = courierCompareResponseSchema.parse(response.body);
    expect(compared.isMock).toBe(true);
    expect(compared.quotes).toHaveLength(2);
    expect(compared.quotes.every((q) => q.isMock)).toBe(true);
    expect(compared.recommendation.provider).toBe('steadfast');
    expect(compared.recommendation.reasons.join(' ')).toContain('lowest expected cost');
  });

  it('uses the rate card in live mode and recommends only enabled couriers', async () => {
    const setup = courierSetup(LIVE);
    setup.store.rateCards.push({
      id: randomUUID(),
      provider: 'pathao',
      zone: 'inside_dhaka',
      weightUpToGrams: 1000,
      chargeMinor: 7000,
      isActive: true,
      updatedAt: '2026-11-01T08:00:00.000Z',
    });
    const path = `/admin/orders/${setup.order.orderNumber}/courier/quotes`;
    const first = courierCompareResponseSchema.parse(
      (await setup.call('post', path, 'admin', {})).body,
    );
    expect(first.quotes.find((q) => q.provider === 'pathao')).toMatchObject({
      kind: 'internal_estimate',
      deliveryChargeMinor: 7000,
      isMock: false,
    });
    expect(first.quotes.find((q) => q.provider === 'steadfast')).toMatchObject({
      kind: 'unavailable',
      available: false,
    });
    // Pathao is not enabled for real bookings yet.
    expect(first.recommendation.provider).toBeNull();
    expect(setup.calls.quote).toBe(0);

    const pathaoRow = setup.store.providers.find((p) => p.provider === 'pathao');
    if (pathaoRow) pathaoRow.isEnabled = true;
    // Enabled is not enough for real bookings: the courier must be verified for live use.
    const unverified = courierCompareResponseSchema.parse(
      (await setup.call('post', path, 'admin', {})).body,
    );
    expect(unverified.recommendation.provider).toBeNull();
    if (pathaoRow) pathaoRow.liveVerifiedAt = '2026-11-14T07:00:00.000Z';
    const second = courierCompareResponseSchema.parse(
      (await setup.call('post', path, 'admin', {})).body,
    );
    expect(second.recommendation.provider).toBe('pathao');
  });
});

describe('booking a shipment', () => {
  it('answers 503 while couriers are off and creates nothing', async () => {
    const setup = courierSetup();
    const response = await setup.call(
      'post',
      `/admin/orders/${setup.order.orderNumber}/shipments`,
      'admin',
      bookBody(),
    );
    expect(response.status).toBe(503);
    expect(code(response)).toBe('courier_unavailable');
    expect(setup.store.shipments).toHaveLength(0);
  });

  it('refuses a live booking while the courier API is awaiting documentation', async () => {
    const setup = courierSetup(LIVE);
    const response = await setup.call(
      'post',
      `/admin/orders/${setup.order.orderNumber}/shipments`,
      'admin',
      bookBody(),
    );
    expect(response.status).toBe(409);
    expect(code(response)).toBe('courier_operation_unsupported');
    expect(setup.store.shipments).toHaveLength(0);
    expect(setup.calls.book).toBe(0);
  });

  it('books with the mock once per booking key', async () => {
    const setup = courierSetup(MOCK);
    const body = bookBody();
    const path = `/admin/orders/${setup.order.orderNumber}/shipments`;
    const first = booking(await setup.call('post', path, 'admin', body));
    expect(first).toMatchObject({ outcome: 'booked', duplicate: false });
    expect(first.shipment).toMatchObject({ status: 'booked', isMock: true });
    expect(first.shipment.consignmentId).toMatch(/^MK-[0-9A-F]{10}-/);

    const again = booking(await setup.call('post', path, 'admin', body));
    expect(again).toMatchObject({ outcome: 'booked', duplicate: true });
    expect(again.shipment.id).toBe(first.shipment.id);
    expect(setup.calls.book).toBe(1);

    // A second booking key while the first parcel is active is refused by the database.
    const second = await setup.call('post', path, 'admin', bookBody());
    expect(second.status).toBe(409);
    expect(code(second)).toBe('shipment_already_active');
    expect(setup.calls.book).toBe(1);
  });

  it('records a courier refusal as a failed booking', async () => {
    const setup = courierSetup(MOCK);
    const result = await bookMock(setup, { note: 'Fragile [mock:reject]' });
    expect(result.outcome).toBe('failed');
    expect(result.shipment.status).toBe('booking_failed');
  });

  it('never retries an uncertain booking', async () => {
    const setup = courierSetup(MOCK);
    const body = bookBody({ note: '[mock:timeout]' });
    const path = `/admin/orders/${setup.order.orderNumber}/shipments`;
    const first = booking(await setup.call('post', path, 'admin', body));
    expect(first).toMatchObject({ outcome: 'uncertain', duplicate: false });
    expect(first.shipment).toMatchObject({ status: 'booking_pending', bookingUncertain: true });
    const again = booking(await setup.call('post', path, 'admin', body));
    expect(again).toMatchObject({ outcome: 'uncertain', duplicate: true });
    expect(setup.calls.book).toBe(1);

    // Resolved by hand after checking the courier portal.
    const resolved = await setup.call(
      'post',
      `/admin/shipments/${first.shipment.id}/resolve`,
      'admin',
      { outcome: 'not_created', note: 'Checked the portal: no parcel' },
    );
    expect(resolved.status).toBe(200);
    expect(shipmentSchema.parse(resolved.body).status).toBe('booking_failed');
  });

  it('asks for a reason when the recommended courier is overridden', async () => {
    const setup = courierSetup(MOCK);
    const response = await setup.call(
      'post',
      `/admin/orders/${setup.order.orderNumber}/shipments`,
      'admin',
      bookBody({ provider: 'pathao', recommendedProvider: 'steadfast' }),
    );
    expect(response.status).toBe(400);
    expect(code(response)).toBe('courier_override_reason_required');
    expect(setup.calls.book).toBe(0);
  });

  it('refuses an order that is not ready to ship', async () => {
    const setup = courierSetup(MOCK);
    const pending = setup.store.addOrder(setup.users.customer.id, { status: 'pending' });
    const response = await setup.call(
      'post',
      `/admin/orders/${pending.orderNumber}/shipments`,
      'admin',
      bookBody(),
    );
    expect(response.status).toBe(409);
    expect(code(response)).toBe('shipment_not_bookable');
  });

  it('books a return pickup only for an approved return', async () => {
    const setup = courierSetup(MOCK);
    const approved = setup.store.addReturn(setup.order.orderNumber, 'approved');
    const requested = setup.store.addReturn(setup.order.orderNumber, 'requested');
    const ok = await setup.call('post', `/admin/returns/${approved}/pickup`, 'admin', bookBody());
    expect(ok.status).toBe(200);
    expect(booking(ok).shipment).toMatchObject({ kind: 'return_pickup', codAmountMinor: 0 });
    const refused = await setup.call(
      'post',
      `/admin/returns/${requested}/pickup`,
      'admin',
      bookBody(),
    );
    expect(refused.status).toBe(409);
    expect(code(refused)).toBe('return_not_eligible');
  });
});

describe('cancelling a shipment', () => {
  it('cancels a mock shipment with the courier', async () => {
    const setup = courierSetup(MOCK);
    const booked = await bookMock(setup);
    const response = await setup.call(
      'post',
      `/admin/shipments/${booked.shipment.id}/cancel`,
      'admin',
      {
        reason: 'Customer asked to cancel',
      },
    );
    expect(response.status).toBe(200);
    expect(shipmentSchema.parse(response.body).status).toBe('cancelled');
    expect(setup.calls.cancel).toBe(1);
  });

  it('needs portal confirmation for a courier without a cancel API', async () => {
    const setup = courierSetup(LIVE);
    const id = await realBookedShipment(setup);
    const refused = await setup.call('post', `/admin/shipments/${id}/cancel`, 'admin', {
      reason: 'Customer asked',
    });
    expect(refused.status).toBe(409);
    expect(code(refused)).toBe('courier_operation_unsupported');
    const confirmed = await setup.call('post', `/admin/shipments/${id}/cancel`, 'admin', {
      reason: 'Customer asked',
      cancelledInPortal: true,
    });
    expect(confirmed.status).toBe(200);
    expect(shipmentSchema.parse(confirmed.body).status).toBe('cancelled');
    expect(setup.calls.cancel).toBe(0);
  });

  it('waits for a booking that may still be in flight, then cancels it without the courier', async () => {
    const setup = courierSetup(MOCK);
    const begun = await setup.store.beginBooking(setup.caller('admin'), setup.order.orderNumber, {
      bookingKey: randomUUID(),
      provider: 'pathao',
      quoteId: null,
      weightGrams: 500,
      note: null,
      recommendedProvider: null,
      selectionReason: null,
      destination: {},
      isMock: true,
    });
    const path = `/admin/shipments/${begun.shipment.id}/cancel`;
    const early = await setup.call('post', path, 'admin', { reason: 'Wrong courier' });
    expect(early.status).toBe(409);
    expect(code(early)).toBe('shipment_booking_unresolved');
    setup.store.clock += 3 * 60_000;
    const later = await setup.call('post', path, 'admin', { reason: 'Wrong courier' });
    expect(later.status).toBe(200);
    expect(shipmentSchema.parse(later.body).status).toBe('cancelled');
    expect(setup.calls.cancel).toBe(0);
  });

  it('refuses to cancel a delivered shipment', async () => {
    const setup = courierSetup(MOCK);
    const id = (await bookMock(setup)).shipment.id;
    setup.store.applyEvent(id, 'picked_up', null, 'manual', null, 'k1', null);
    setup.store.applyEvent(id, 'delivered', null, 'manual', null, 'k2', null);
    const response = await setup.call('post', `/admin/shipments/${id}/cancel`, 'admin', {
      reason: 'Too late',
    });
    expect(response.status).toBe(409);
    expect(code(response)).toBe('shipment_not_cancellable');
  });
});

describe('tracking', () => {
  it('syncs a mock shipment by elapsed time and never touches the order', async () => {
    const setup = courierSetup(MOCK);
    const id = (await bookMock(setup)).shipment.id;
    setup.store.clock += 20 * 60_000;
    const response = await setup.call('post', `/admin/shipments/${id}/refresh`, 'admin', {});
    expect(response.status).toBe(200);
    expect(refreshShipmentResponseSchema.parse(response.body)).toMatchObject({
      result: 'synced',
      shipment: { status: 'picked_up' },
    });
    // A second refresh adds nothing: the same statuses have the same keys.
    const before = setup.store.events.length;
    await setup.call('post', `/admin/shipments/${id}/refresh`, 'admin', {});
    expect(setup.store.events.length).toBe(before);
    expect(setup.order.status).toBe('confirmed');
  });

  it('answers unsupported for a courier without a verified tracking API', async () => {
    const setup = courierSetup(LIVE);
    const id = await realBookedShipment(setup);
    const response = await setup.call('post', `/admin/shipments/${id}/refresh`, 'admin', {});
    expect(response.status).toBe(200);
    expect(refreshShipmentResponseSchema.parse(response.body).result).toBe('unsupported');
    expect(setup.calls.track).toBe(0);
  });

  it('records a status by hand and refuses booking statuses', async () => {
    const setup = courierSetup(LIVE);
    const id = await realBookedShipment(setup);
    const path = `/admin/shipments/${id}/events`;
    const body = { status: 'picked_up', note: 'Rider collected it at noon' };
    const ok = await setup.call('post', path, 'admin', body);
    expect(ok.status).toBe(200);
    expect(recordShipmentStatusResponseSchema.parse(ok.body)).toMatchObject({
      applied: true,
      duplicate: false,
      shipment: { status: 'picked_up' },
    });
    const repeat = await setup.call('post', path, 'admin', body);
    expect(recordShipmentStatusResponseSchema.parse(repeat.body).duplicate).toBe(true);
    const invalid = await setup.call('post', path, 'admin', {
      status: 'booked',
      note: 'Not allowed',
    });
    expect(invalid.status).toBe(400);
  });

  it('lets the worker poll due mock shipments', async () => {
    const setup = courierSetup({ ...MOCK, trackingSyncEnabled: true });
    const id = (await bookMock(setup)).shipment.id;
    setup.store.clock += 95 * 60_000;
    const result = await setup.processor.syncDue();
    expect(result).toMatchObject({ claimed: 1, synced: 1, failed: 0 });
    expect(setup.store.shipments.find((s) => s.id === id)?.status).toBe('delivered');
    expect(setup.store.syncFinishes[0]).toMatchObject({ ok: true, nextIn: 300 });
  });
});

describe('customer shipments', () => {
  it('shows a customer their own booked shipments only', async () => {
    const setup = courierSetup(MOCK);
    await bookMock(setup);
    const path = `/orders/${setup.order.orderNumber}/shipments`;
    const own = await setup.call('get', path, 'customer');
    expect(own.status).toBe(200);
    const shipments = customerShipmentsResponseSchema.parse(own.body).shipments;
    expect(shipments).toHaveLength(1);
    expect(shipments[0]).toMatchObject({ status: 'booked', isTest: true });
    expect(JSON.stringify(own.body)).not.toContain('expectedCharge');

    expect((await setup.call('get', path, 'otherCustomer')).status).toBe(404);
    expect((await setup.call('get', path)).status).toBe(401);
  });
});

describe('database refusals', () => {
  it('maps NZ6xx codes to their API codes and keeps internal ones a 503', async () => {
    const setup = courierSetup(MOCK);
    setup.store.nextFailure = 'NZ605';
    const unresolved = await setup.call('get', '/admin/couriers/config', 'admin');
    expect(unresolved.status).toBe(409);
    expect(code(unresolved)).toBe('shipment_booking_unresolved');
    setup.store.nextFailure = 'NZ608';
    expect(code(await setup.call('get', '/admin/couriers/config', 'admin'))).toBe(
      'settlement_invalid',
    );
    setup.store.nextFailure = 'NZ609';
    const internal = await setup.call('get', '/admin/couriers/config', 'admin');
    expect(internal.status).toBe(503);
    expect(JSON.stringify(internal.body)).not.toContain('internal detail');
  });
});

describe('courier webhooks', () => {
  const path = '/api/v1/webhooks/couriers/steadfast';

  function signed(
    setup: CourierSetup,
    raw: string,
    options: { secret?: string; ageSeconds?: number } = {},
  ) {
    const timestamp = String(Math.floor(setup.store.clock / 1000) - (options.ageSeconds ?? 0));
    return request(setup.app)
      .post(path)
      .set('Content-Type', 'application/json')
      .set(MOCK_TIMESTAMP_HEADER, timestamp)
      .set(
        MOCK_SIGNATURE_HEADER,
        signMockWebhook(options.secret ?? TEST_MOCK_SECRET, timestamp, raw),
      )
      .send(raw);
  }

  it('is not found for unknown couriers, when couriers are off, or without a webhook secret', async () => {
    const mock = courierSetup(MOCK);
    expect((await request(mock.app).post('/api/v1/webhooks/couriers/dhl').send('{}')).status).toBe(
      404,
    );
    const off = courierSetup();
    expect((await request(off.app).post(path).send('{}')).status).toBe(404);
    const unsigned = courierSetup({ mode: 'mock' });
    expect((await request(unsigned.app).post(path).send('{}')).status).toBe(404);
    const live = courierSetup(LIVE);
    expect((await request(live.app).post(path).send('{}')).status).toBe(404);
  });

  it('refuses a bad, missing or stale signature', async () => {
    const setup = courierSetup(MOCK);
    const { consignmentId } = (await bookMock(setup)).shipment;
    const raw = JSON.stringify({ eventId: 'e1', consignmentId, status: 'picked' });
    const wrongSecret = await signed(setup, raw, {
      secret: 'another-secret-that-is-long-enough-000',
    });
    expect(wrongSecret.status).toBe(401);
    expect((await signed(setup, raw, { ageSeconds: 600 })).status).toBe(401);
    const unsignedCall = await request(setup.app)
      .post(path)
      .set('Content-Type', 'application/json')
      .send(raw);
    expect(unsignedCall.status).toBe(401);
    expect(setup.store.events.filter((e) => e.source === 'webhook')).toHaveLength(0);
  });

  it('verifies the exact bytes, applies the event once and stores no personal data', async () => {
    const setup = courierSetup(MOCK);
    const { id, consignmentId } = (await bookMock(setup)).shipment;
    // Whitespace and an extra field a JSON parser would normalise away: the signature covers
    // the raw body, so it must still verify.
    const occurredAt = new Date(setup.store.clock).toISOString();
    const raw = `{ "eventId": "evt-1",  "consignmentId": "${consignmentId ?? ''}", "status": "picked", "recipientPhone": "01712345678", "occurredAt": "${occurredAt}" }`;
    const first = await signed(setup, raw);
    expect(first.status).toBe(200);
    expect(webhookAnswerSchema.parse(first.body)).toEqual({ received: true });
    expect(setup.store.shipments.find((s) => s.id === id)?.status).toBe('picked_up');

    const repeat = await signed(setup, raw);
    expect(repeat.status).toBe(200);
    expect(webhookAnswerSchema.parse(repeat.body).duplicate).toBe(true);
    expect(setup.store.events.filter((e) => e.source === 'webhook')).toHaveLength(1);
    expect(JSON.stringify(setup.store.webhooks)).not.toContain('01712345678');
    expect(setup.store.webhooks[0]).toMatchObject({ status: 'processed', signatureOk: true });
    // The order itself never moves.
    expect(setup.order.status).toBe('confirmed');
  });

  it('answers 200 once stored even when applying fails, and retries later', async () => {
    const setup = courierSetup(MOCK);
    const { id, consignmentId } = (await bookMock(setup)).shipment;
    const raw = JSON.stringify({ eventId: 'evt-retry', consignmentId, status: 'picked' });
    const originalFind = setup.store.findShipment.bind(setup.store);
    setup.store.findShipment = () => Promise.reject(new Error('database down'));
    const response = await signed(setup, raw);
    expect(response.status).toBe(200);
    expect(setup.store.webhooks[0]?.status).toBe('failed');

    setup.store.findShipment = originalFind;
    const retried = await setup.processor.retryWebhooks();
    expect(retried).toMatchObject({ claimed: 1, processed: 1 });
    expect(setup.store.shipments.find((s) => s.id === id)?.status).toBe('picked_up');
  });

  it('ignores events for unknown consignments', async () => {
    const setup = courierSetup(MOCK);
    await bookMock(setup);
    const raw = JSON.stringify({
      eventId: 'e-x',
      consignmentId: 'MK-0000000000-ABC',
      status: 'picked',
    });
    expect((await signed(setup, raw)).status).toBe(200);
    expect(setup.store.webhooks[0]?.status).toBe('ignored');
  });
});

describe('recording a portal booking', () => {
  const portalBody = (overrides: object = {}) => ({
    bookingKey: randomUUID(),
    provider: 'steadfast',
    weightGrams: 900,
    consignmentId: 'SF-PORTAL-77',
    trackingCode: 'SFT77',
    chargeMinor: 7000,
    note: 'Booked in the Steadfast merchant portal',
    ...overrides,
  });
  const portalPath = (setup: CourierSetup) =>
    `/admin/orders/${setup.order.orderNumber}/shipments/portal`;
  const enable = (setup: CourierSetup, provider = 'steadfast') => {
    const row = setup.store.providers.find((p) => p.provider === provider);
    if (row) row.isEnabled = true;
  };

  it('records a booked shipment in live mode without calling any courier', async () => {
    const setup = courierSetup(LIVE);
    enable(setup);
    const response = await setup.call('post', portalPath(setup), 'admin', portalBody());
    expect(response.status).toBe(200);
    const shipment = shipmentSchema.parse(response.body);
    expect(shipment).toMatchObject({
      status: 'booked',
      isMock: false,
      kind: 'forward',
      consignmentId: 'SF-PORTAL-77',
      trackingCode: 'SFT77',
      providerCallStartedAt: null,
    });
    // An admin holds couriers.cod.read, so the expected charge is shown.
    expect(shipment.expectedChargeMinor).toBe(7000);
    expect(setup.calls).toEqual({ quote: 0, book: 0, track: 0, cancel: 0, check: 0 });
    // The customer now sees it.
    const mine = await setup.call(
      'get',
      `/orders/${setup.order.orderNumber}/shipments`,
      'customer',
    );
    expect(customerShipmentsResponseSchema.parse(mine.body).shipments).toHaveLength(1);
  });

  it('works with couriers off, and flags a test shipment in mock mode', async () => {
    const off = courierSetup();
    enable(off);
    const recorded = await off.call('post', portalPath(off), 'admin', portalBody());
    expect(recorded.status).toBe(200);
    expect(shipmentSchema.parse(recorded.body).isMock).toBe(false);

    const mock = courierSetup(MOCK);
    // Mock rows need no enabled courier, as for a mock booking.
    const test = await mock.call('post', portalPath(mock), 'admin', portalBody());
    expect(test.status).toBe(200);
    expect(shipmentSchema.parse(test.body).isMock).toBe(true);
    expect(mock.calls.book).toBe(0);
  });

  it('is idempotent on the booking key', async () => {
    const setup = courierSetup(LIVE);
    enable(setup);
    const body = portalBody();
    const first = shipmentSchema.parse(
      (await setup.call('post', portalPath(setup), 'admin', body)).body,
    );
    const again = await setup.call('post', portalPath(setup), 'admin', body);
    expect(again.status).toBe(200);
    expect(shipmentSchema.parse(again.body).id).toBe(first.id);
    expect(setup.store.shipments).toHaveLength(1);
    expect(setup.store.events.filter((e) => e.status === 'booked')).toHaveLength(1);
    // A different key while that parcel is active is refused.
    const second = await setup.call('post', portalPath(setup), 'admin', portalBody());
    expect(second.status).toBe(409);
    expect(code(second)).toBe('shipment_already_active');
  });

  it('records a return pickup booked in the portal', async () => {
    const setup = courierSetup(LIVE);
    enable(setup);
    const approved = setup.store.addReturn(setup.order.orderNumber, 'approved');
    const requested = setup.store.addReturn(setup.order.orderNumber, 'requested');
    const ok = await setup.call(
      'post',
      portalPath(setup),
      'admin',
      portalBody({ returnId: approved, consignmentId: 'SF-RET-1' }),
    );
    expect(ok.status).toBe(200);
    expect(shipmentSchema.parse(ok.body)).toMatchObject({
      kind: 'return_pickup',
      returnRequestId: approved,
      codAmountMinor: 0,
      status: 'booked',
    });
    const refused = await setup.call(
      'post',
      portalPath(setup),
      'admin',
      portalBody({ returnId: requested, consignmentId: 'SF-RET-2' }),
    );
    expect(refused.status).toBe(409);
    expect(code(refused)).toBe('return_not_eligible');
    const elsewhere = setup.store.addOrder(setup.users.customer.id);
    const foreign = await setup.call(
      'post',
      `/admin/orders/${elsewhere.orderNumber}/shipments/portal`,
      'admin',
      portalBody({ returnId: approved, consignmentId: 'SF-RET-3' }),
    );
    expect(foreign.status).toBe(404);
  });

  it('needs shipments.create for a delivery and shipments.returns.manage for a pickup', async () => {
    const setup = courierSetup(LIVE);
    enable(setup);
    const approved = setup.store.addReturn(setup.order.orderNumber, 'approved');
    expect((await setup.call('post', portalPath(setup), undefined, portalBody())).status).toBe(401);
    expect((await setup.call('post', portalPath(setup), 'staff', portalBody())).status).toBe(403);

    setup.grant('staff', 'shipments.returns.manage');
    const delivery = await setup.call('post', portalPath(setup), 'staff', portalBody());
    expect(delivery.status).toBe(403);
    const pickup = await setup.call(
      'post',
      portalPath(setup),
      'staff',
      portalBody({ returnId: approved }),
    );
    expect(pickup.status).toBe(200);
    // Staff without couriers.cod.read do not see courier money.
    expect(shipmentSchema.parse(pickup.body).expectedChargeMinor).toBeNull();

    const other = courierSetup(LIVE);
    enable(other);
    other.grant('staff', 'shipments.create');
    const otherReturn = other.store.addReturn(other.order.orderNumber, 'approved');
    const refusedPickup = await other.call(
      'post',
      portalPath(other),
      'staff',
      portalBody({ returnId: otherReturn }),
    );
    expect(refusedPickup.status).toBe(403);
    expect((await other.call('post', portalPath(other), 'staff', portalBody())).status).toBe(200);
    expect(other.store.calls.filter((c) => c === 'admin_record_portal_booking')).toHaveLength(1);
  });

  it('maps the database refusals', async () => {
    const setup = courierSetup(LIVE);
    // Steadfast is not enabled for real bookings yet.
    const disabled = await setup.call('post', portalPath(setup), 'admin', portalBody());
    expect(disabled.status).toBe(503);
    expect(code(disabled)).toBe('courier_unavailable');

    enable(setup);
    const pending = setup.store.addOrder(setup.users.customer.id, { status: 'pending' });
    const notBookable = await setup.call(
      'post',
      `/admin/orders/${pending.orderNumber}/shipments/portal`,
      'admin',
      portalBody(),
    );
    expect(notBookable.status).toBe(409);
    expect(code(notBookable)).toBe('shipment_not_bookable');

    const override = await setup.call(
      'post',
      portalPath(setup),
      'admin',
      portalBody({ recommendedProvider: 'pathao' }),
    );
    expect(override.status).toBe(400);
    expect(code(override)).toBe('courier_override_reason_required');

    const missing = await setup.call(
      'post',
      '/admin/orders/NZ999999/shipments/portal',
      'admin',
      portalBody(),
    );
    expect(missing.status).toBe(404);

    const invalid = await setup.call('post', portalPath(setup), 'admin', portalBody({ note: 'x' }));
    expect(invalid.status).toBe(400);
    expect(code(invalid)).toBe('validation_failed');
    expect(setup.calls.book).toBe(0);
  });
});
