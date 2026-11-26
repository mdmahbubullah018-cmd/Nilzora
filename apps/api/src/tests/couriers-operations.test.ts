import { randomUUID } from 'node:crypto';
import {
  adminOrderListResponseSchema,
  bookShipmentResponseSchema,
  bulkCourierCheckResponseSchema,
  bulkOrderStatusResponseSchema,
  bulkOrderSummariesResponseSchema,
  bulkShipmentBookingResponseSchema,
  COURIER_LIVE_CONFIRMATION,
  courierConfigResponseSchema,
  shipmentSchema,
} from '@nilzora/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createSteadfastProvider } from '../modules/couriers/blocked-providers';
import {
  MOCK_SIGNATURE_HEADER,
  MOCK_TIMESTAMP_HEADER,
  signMockWebhook,
} from '../modules/couriers/mock-provider';
import { createCourierProcessor } from '../modules/couriers/processor';
import { createCourierRegistry, type CourierRegistry } from '../modules/couriers/registry';
import { createCourierRuntime } from '../modules/couriers/runtime';
import type { CourierProvider } from '../modules/couriers/types';
import { adminSetup } from './admin-helpers';
import { errorOf } from './commerce-helpers';
import {
  courierSetup,
  TEST_MOCK_SECRET,
  type CourierSetup,
  type CourierSetupOptions,
} from './courier-helpers';
import { captureLogs } from './helpers';

const MOCK: CourierSetupOptions = {
  mode: 'mock',
  env: { COURIER_MOCK_WEBHOOK_SECRET: TEST_MOCK_SECRET },
};
const HOSTED = { SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' };

const code = (response: request.Response) => errorOf(response.body).code;
const config = (response: request.Response) => courierConfigResponseSchema.parse(response.body);

const operations = (overrides: object = {}) => ({
  mode: 'off',
  bookingEnabled: false,
  trackingSyncEnabled: false,
  trackingSyncIntervalSeconds: 300,
  httpTimeoutMs: 15_000,
  ...overrides,
});

describe('courier operations settings', () => {
  it('belong to the owner: an admin is refused every configuration change', async () => {
    const setup = courierSetup();
    const attempts = [
      setup.call('put', '/admin/couriers/operations', 'admin', operations()),
      setup.call('put', '/admin/couriers/providers/steadfast/credentials/api_key', 'admin', {
        value: 'sf-key-not-real-1',
      }),
      setup.call('delete', '/admin/couriers/providers/steadfast/credentials/api_key', 'admin'),
      setup.call('put', '/admin/couriers/providers/steadfast/base-url', 'admin', {
        apiBaseUrl: 'https://portal.packzy.com/api/v1',
      }),
      setup.call('put', '/admin/couriers/providers/steadfast/live-verification', 'admin', {
        verified: false,
      }),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(403);
    }
    expect(setup.store.calls).toEqual([]);

    const saved = await setup.call(
      'put',
      '/admin/couriers/operations',
      'owner',
      operations({ mode: 'mock', trackingSyncEnabled: true, trackingSyncIntervalSeconds: 900 }),
    );
    expect(saved.status).toBe(200);
    expect(config(saved)).toMatchObject({
      mode: 'mock',
      trackingSyncEnabled: true,
      operations: { mode: 'mock', trackingSyncIntervalSeconds: 900 },
      databaseTarget: 'local',
      mockAllowed: true,
      modeNotice: null,
    });
  });

  it('needs the typed confirmation to turn live operations on', async () => {
    const setup = courierSetup();
    const missing = await setup.call(
      'put',
      '/admin/couriers/operations',
      'owner',
      operations({ mode: 'live', bookingEnabled: true }),
    );
    expect(missing.status).toBe(400);
    expect(code(missing)).toBe('courier_confirmation_required');
    expect(setup.store.operations.mode).toBe('off');

    const confirmed = await setup.call(
      'put',
      '/admin/couriers/operations',
      'owner',
      operations({ mode: 'live', bookingEnabled: true, confirmation: COURIER_LIVE_CONFIRMATION }),
    );
    expect(confirmed.status).toBe(200);
    expect(config(confirmed)).toMatchObject({ mode: 'live', bookingEnabled: true });
  });

  it('refuses test mode on a hosted database before asking the database', async () => {
    const setup = courierSetup({ env: HOSTED });
    const response = await setup.call(
      'put',
      '/admin/couriers/operations',
      'owner',
      operations({ mode: 'mock' }),
    );
    expect(response.status).toBe(409);
    expect(code(response)).toBe('courier_mock_not_allowed');
    expect(setup.store.calls).not.toContain('admin_save_courier_operations');
  });

  it('treats a saved test mode as off on a hosted database, and books nothing', async () => {
    const setup = courierSetup({ mode: 'mock', env: HOSTED });
    const response = await setup.call('get', '/admin/couriers/config', 'admin');
    const answer = config(response);
    expect(answer).toMatchObject({
      mode: 'off',
      operations: { mode: 'mock' },
      databaseTarget: 'hosted',
      mockAllowed: false,
    });
    expect(answer.modeNotice).toContain('local database');
    const booking = await setup.call(
      'post',
      `/admin/orders/${setup.order.orderNumber}/shipments`,
      'admin',
      { bookingKey: randomUUID(), provider: 'steadfast', weightGrams: 500 },
    );
    expect(booking.status).toBe(503);
    expect(code(booking)).toBe('courier_unavailable');
    expect(setup.calls.book).toBe(0);
  });

  it('applies a saved change to the very next request', async () => {
    const setup = courierSetup(MOCK);
    await setup.call('put', '/admin/couriers/operations', 'owner', operations({ mode: 'off' }));
    const booking = await setup.call(
      'post',
      `/admin/orders/${setup.order.orderNumber}/shipments`,
      'admin',
      { bookingKey: randomUUID(), provider: 'steadfast', weightGrams: 500 },
    );
    expect(booking.status).toBe(503);
  });
});

describe('courier credentials', () => {
  const SECRET_VALUE = 'vault-secret-value-not-real-7731';

  it('stores a credential without ever answering or logging its value', async () => {
    const setup = courierSetup();
    const saved = await setup.call(
      'put',
      '/admin/couriers/providers/steadfast/credentials/api_key',
      'owner',
      { value: SECRET_VALUE },
    );
    expect(saved.status).toBe(200);
    expect(saved.text).not.toContain(SECRET_VALUE);
    expect(setup.logs.raw()).not.toContain(SECRET_VALUE);
    const steadfast = config(saved).providers.find((p) => p.provider === 'steadfast');
    expect(steadfast?.credentials).toEqual([
      { field: 'api_key', source: 'vault', setAt: '2026-11-14T08:00:00.000Z' },
    ]);
    expect(steadfast?.credentialFields).toEqual(['api_key', 'secret_key', 'webhook_token']);
    const read = await setup.call('get', '/admin/couriers/config', 'owner');
    expect(read.text).not.toContain(SECRET_VALUE);

    const cleared = await setup.call(
      'delete',
      '/admin/couriers/providers/steadfast/credentials/api_key',
      'owner',
    );
    expect(cleared.status).toBe(200);
    expect(config(cleared).providers.find((p) => p.provider === 'steadfast')?.credentials).toEqual(
      [],
    );
    const again = await setup.call(
      'delete',
      '/admin/couriers/providers/steadfast/credentials/api_key',
      'owner',
    );
    expect(again.status).toBe(404);
    const unknown = await setup.call(
      'put',
      '/admin/couriers/providers/steadfast/credentials/client_id',
      'owner',
      { value: SECRET_VALUE },
    );
    expect(unknown.status).toBe(400);
  });

  it('reports the vault before the environment, field by field', async () => {
    const setup = courierSetup({
      env: {
        STEADFAST_API_KEY: 'env-key-not-real-1',
        STEADFAST_SECRET_KEY: 'env-secret-not-real-2',
      },
    });
    await setup.call('put', '/admin/couriers/providers/steadfast/credentials/api_key', 'owner', {
      value: SECRET_VALUE,
    });
    const answer = await setup.call('get', '/admin/couriers/config', 'owner');
    expect(answer.text).not.toContain('not-real');
    const steadfast = config(answer).providers.find((p) => p.provider === 'steadfast');
    expect(steadfast?.credentials).toEqual([
      { field: 'api_key', source: 'vault', setAt: '2026-11-14T08:00:00.000Z' },
      { field: 'secret_key', source: 'environment', setAt: null },
    ]);
    expect(steadfast?.readiness.credentialsComplete).toBe(true);
  });
});

describe('courier base URL, readiness and live verification', () => {
  it('validates the base URL against the courier allow-list', async () => {
    const setup = courierSetup();
    const bad = await setup.call('put', '/admin/couriers/providers/pathao/base-url', 'owner', {
      apiBaseUrl: 'https://evil.example.com',
    });
    expect(bad.status).toBe(400);
    expect(errorOf(bad.body).message).toContain('allow-list');
    expect(setup.store.calls).not.toContain('admin_save_courier_api_base_url');

    const good = await setup.call('put', '/admin/couriers/providers/pathao/base-url', 'owner', {
      apiBaseUrl: 'https://courier-api-sandbox.pathao.com/',
    });
    expect(good.status).toBe(200);
    const pathao = config(good).providers.find((p) => p.provider === 'pathao');
    expect(pathao?.apiBaseUrl).toBe('https://courier-api-sandbox.pathao.com');
    expect(pathao?.readiness.baseUrlValid).toBe(true);
  });

  it('lists every blocker of a courier that is not ready', async () => {
    const setup = courierSetup({ mode: 'live', bookingEnabled: true });
    const steadfast = config(
      await setup.call('get', '/admin/couriers/config', 'owner'),
    ).providers.find((p) => p.provider === 'steadfast');
    expect(steadfast?.readiness).toMatchObject({
      adapterVerified: false,
      credentialsComplete: false,
      baseUrlValid: false,
      liveCheckPassed: false,
      liveVerified: false,
      enabled: false,
      ready: false,
    });
    expect(steadfast?.readiness.blockers).toContain('Some required credentials are missing');
    expect(steadfast?.readiness.blockers.join(' ')).toContain(
      'verified merchant API documentation',
    );
  });

  it('refuses to verify a courier whose adapter is not verified, but always unverifies', async () => {
    const setup = courierSetup({ mode: 'live' });
    const verify = await setup.call(
      'put',
      '/admin/couriers/providers/steadfast/live-verification',
      'owner',
      { verified: true, confirmation: 'VERIFY STEADFAST' },
    );
    expect(verify.status).toBe(409);
    expect(code(verify)).toBe('courier_operation_unsupported');
    expect(setup.store.calls).not.toContain('admin_set_courier_live_verified');

    const unverify = await setup.call(
      'put',
      '/admin/couriers/providers/steadfast/live-verification',
      'owner',
      { verified: false },
    );
    expect(unverify.status).toBe(200);
  });

  it('maps the live-check refusal of the database', async () => {
    const setup = courierSetup();
    setup.store.nextFailure = 'NZ612';
    const response = await setup.call(
      'put',
      '/admin/couriers/providers/pathao/live-verification',
      'owner',
      { verified: false },
    );
    expect(response.status).toBe(409);
    expect(code(response)).toBe('courier_live_check_required');
  });

  it('deletes a remembered location mapping', async () => {
    const setup = courierSetup();
    const id = randomUUID();
    setup.store.locationMappings.push({
      id,
      provider: 'pathao',
      district: 'Dhaka',
      area: '',
      destination: { cityId: 1 },
      label: null,
      updatedAt: '2026-11-01T08:00:00.000Z',
    });
    expect(
      (await setup.call('delete', `/admin/couriers/location-mappings/${id}`, 'staff')).status,
    ).toBe(403);
    expect(
      (await setup.call('delete', `/admin/couriers/location-mappings/${id}`, 'admin')).status,
    ).toBe(204);
    expect(
      (await setup.call('delete', `/admin/couriers/location-mappings/${id}`, 'admin')).status,
    ).toBe(404);
  });
});

describe('tracking sync from the saved settings', () => {
  async function bookedMock(setup: CourierSetup) {
    const response = await setup.call(
      'post',
      `/admin/orders/${setup.order.orderNumber}/shipments`,
      'admin',
      { bookingKey: randomUUID(), provider: 'steadfast', weightGrams: 500 },
    );
    return bookShipmentResponseSchema.parse(response.body).shipment;
  }

  it('uses the saved interval', async () => {
    const setup = courierSetup({
      ...MOCK,
      trackingSyncEnabled: true,
      trackingSyncIntervalSeconds: 900,
    });
    await bookedMock(setup);
    setup.store.clock += 20 * 60_000;
    expect(await setup.processor.syncDue()).toMatchObject({ claimed: 1, synced: 1 });
    expect(setup.store.syncFinishes[0]).toMatchObject({ ok: true, nextIn: 900 });
  });

  it('claims nothing while sync is off', async () => {
    const setup = courierSetup(MOCK);
    await bookedMock(setup);
    setup.store.clock += 20 * 60_000;
    expect(await setup.processor.syncDue()).toEqual({ claimed: 0, synced: 0, failed: 0 });
    expect(setup.store.calls).not.toContain('service_claim_shipment_sync');
  });
});

describe('mock and real shipments never cross', () => {
  function signed(setup: CourierSetup, raw: string) {
    const timestamp = String(Math.floor(setup.store.clock / 1000));
    return request(setup.app)
      .post('/api/v1/webhooks/couriers/steadfast')
      .set('Content-Type', 'application/json')
      .set(MOCK_TIMESTAMP_HEADER, timestamp)
      .set(MOCK_SIGNATURE_HEADER, signMockWebhook(TEST_MOCK_SECRET, timestamp, raw))
      .send(raw);
  }

  async function realShipment(setup: CourierSetup) {
    const row = setup.store.providers.find((p) => p.provider === 'steadfast');
    if (row) row.isEnabled = true;
    const shipment = await setup.store.recordPortalBooking(
      setup.caller('owner'),
      setup.order.orderNumber,
      {
        returnId: null,
        bookingKey: randomUUID(),
        provider: 'steadfast',
        weightGrams: 500,
        consignmentId: 'SF-REAL-42',
        trackingCode: null,
        chargeMinor: null,
        note: 'Booked in the merchant portal',
        recommendedProvider: null,
        selectionReason: null,
        isMock: false,
      },
    );
    return shipment;
  }

  it('ignores a mock-signed webhook naming a real shipment', async () => {
    const setup = courierSetup(MOCK);
    const real = await realShipment(setup);
    for (const body of [
      { eventId: 'x1', consignmentId: real.consignmentId, status: 'delivered' },
      { eventId: 'x2', merchantRef: real.merchantRef, status: 'delivered' },
    ]) {
      expect((await signed(setup, JSON.stringify(body))).status).toBe(200);
    }
    expect(setup.store.shipments.find((s) => s.id === real.id)?.status).toBe('booked');
    expect(setup.store.webhooks.map((w) => w.status)).toEqual(['ignored', 'ignored']);
  });

  it('never lets staff give a real parcel an id in the mock format', async () => {
    const setup = courierSetup({ mode: 'live' });
    const row = setup.store.providers.find((p) => p.provider === 'steadfast');
    if (row) row.isEnabled = true;
    const response = await setup.call(
      'post',
      `/admin/orders/${setup.order.orderNumber}/shipments/portal`,
      'admin',
      {
        bookingKey: randomUUID(),
        provider: 'steadfast',
        weightGrams: 500,
        consignmentId: 'MK-0123456789-ABC',
        note: 'Booked in the merchant portal',
      },
    );
    expect(response.status).toBe(400);
    expect(setup.store.shipments).toHaveLength(0);
  });

  it('ignores a real courier webhook naming a mock shipment', async () => {
    const setup = courierSetup(MOCK);
    const booked = bookShipmentResponseSchema.parse(
      (
        await setup.call('post', `/admin/orders/${setup.order.orderNumber}/shipments`, 'admin', {
          bookingKey: randomUUID(),
          provider: 'steadfast',
          weightGrams: 500,
        })
      ).body,
    ).shipment;
    // A hypothetical verified real adapter that accepts every webhook.
    const real = createSteadfastProvider();
    const verifiedReal: CourierProvider = {
      ...real,
      verified: true,
      capabilities: () => ({ ...real.capabilities(), webhook: 'available' }),
      verifyWebhook: () => ({ ok: true }),
      parseWebhook: (raw) => {
        const body = JSON.parse(raw.toString('utf8')) as { consignmentId: string };
        return {
          eventId: 'real-1',
          eventType: 'status',
          consignmentId: body.consignmentId,
          merchantRef: null,
          providerStatus: 'delivered',
          occurredAt: null,
          payload: { eventId: 'real-1', status: 'delivered', occurredAt: null },
        };
      },
      mapStatus: () => 'delivered',
    };
    const base = createCourierRegistry();
    const registry: CourierRegistry = {
      ...base,
      provider: (id, mode) =>
        mode === 'live' && id === 'steadfast' ? verifiedReal : base.provider(id, mode),
    };
    setup.store.operations.mode = 'live';
    const processor = createCourierProcessor({
      store: setup.store,
      registry,
      runtime: createCourierRuntime({
        store: setup.store,
        config: setup.config.couriers,
        ttlMs: 0,
      }),
      logger: captureLogs().logger,
      now: () => setup.store.clock,
    });
    const answer = await processor.handleWebhook(
      'steadfast',
      () => undefined,
      Buffer.from(JSON.stringify({ consignmentId: booked.consignmentId })),
    );
    expect(answer.status).toBe(200);
    expect(setup.store.shipments.find((s) => s.id === booked.id)?.status).toBe('booked');
  });
});

describe('bulk order status and summaries', () => {
  it('applies each order on its own and reports every one', async () => {
    const setup = adminSetup();
    const response = await setup.call('post', '/admin/orders/bulk/status', 'admin', {
      orderNumbers: [
        setup.orders.pending.orderNumber,
        setup.orders.delivered.orderNumber,
        'NZ999999',
      ],
      status: 'confirmed',
    });
    expect(response.status).toBe(200);
    const body = bulkOrderStatusResponseSchema.parse(response.body);
    expect(body).toMatchObject({ succeeded: 1, failed: 2 });
    expect(body.results.map((r) => [r.orderNumber, r.ok, r.error?.code ?? null])).toEqual([
      [setup.orders.pending.orderNumber, true, null],
      [setup.orders.delivered.orderNumber, false, 'invalid_status_transition'],
      ['NZ999999', false, 'not_found'],
    ]);
    expect(body.results[0]?.status).toBe('confirmed');
  });

  it('needs a reason and orders.cancel to cancel in bulk', async () => {
    const setup = adminSetup();
    const numbers = [setup.orders.pending.orderNumber];
    const noReason = await setup.call('post', '/admin/orders/bulk/status', 'admin', {
      orderNumbers: numbers,
      status: 'cancelled',
    });
    expect(noReason.status).toBe(400);
    const staff = await setup.call('post', '/admin/orders/bulk/status', 'staff', {
      orderNumbers: numbers,
      status: 'cancelled',
      note: 'Customer asked to cancel',
    });
    expect(staff.status).toBe(403);
    expect(setup.admin.calls).not.toContain('updateStatus');
    const admin = await setup.call('post', '/admin/orders/bulk/status', 'admin', {
      orderNumbers: numbers,
      status: 'cancelled',
      note: 'Customer asked to cancel',
    });
    expect(bulkOrderStatusResponseSchema.parse(admin.body).succeeded).toBe(1);
  });

  it('reads the selected rows and names what is missing', async () => {
    const setup = adminSetup();
    const response = await setup.call('post', '/admin/orders/bulk/summaries', 'admin', {
      orderNumbers: [
        setup.orders.shipped.orderNumber,
        'NZ999999',
        setup.orders.pending.orderNumber,
      ],
    });
    const body = bulkOrderSummariesResponseSchema.parse(response.body);
    expect(body.orders.map((o) => o.orderNumber)).toEqual([
      setup.orders.shipped.orderNumber,
      setup.orders.pending.orderNumber,
    ]);
    expect(body.missing).toEqual(['NZ999999']);
    expect(
      (
        await setup.call('post', '/admin/orders/bulk/summaries', 'customer', {
          orderNumbers: ['NZ1'],
        })
      ).status,
    ).toBe(403);
  });
});

describe('bulk courier check and booking', () => {
  it('checks each order and blocks everything while couriers are off', async () => {
    const setup = courierSetup(MOCK);
    const pending = setup.store.addOrder(setup.users.customer.id, { status: 'pending' });
    const numbers = [setup.order.orderNumber, pending.orderNumber, 'NZ999999'];
    const response = await setup.call('post', '/admin/orders/bulk/courier-check', 'admin', {
      orderNumbers: numbers,
    });
    const body = bulkCourierCheckResponseSchema.parse(response.body);
    expect(body.bookable).toBe(1);
    expect(body.defaultParcelWeightGrams).toBe(500);
    expect(body.results.map((r) => [r.orderNumber, r.bookable, r.blocker])).toEqual([
      [setup.order.orderNumber, true, null],
      [pending.orderNumber, false, 'order_status'],
      ['NZ999999', false, 'not_found'],
    ]);

    setup.store.operations.mode = 'off';
    const off = bulkCourierCheckResponseSchema.parse(
      (
        await setup.call('post', '/admin/orders/bulk/courier-check', 'admin', {
          orderNumbers: numbers,
        })
      ).body,
    );
    // Nothing is bookable with couriers off, but every order keeps its real reason; only
    // the order that could otherwise be booked is reported as 'unavailable'.
    expect(off.bookable).toBe(0);
    expect(off.results.map((r) => [r.orderNumber, r.bookable, r.blocker, r.orderStatus])).toEqual([
      [setup.order.orderNumber, false, 'unavailable', setup.order.status],
      [pending.orderNumber, false, 'order_status', 'pending'],
      ['NZ999999', false, 'not_found', null],
    ]);
    const delivered = setup.store.addOrder(setup.users.customer.id, { status: 'delivered' });
    const deliveredOff = bulkCourierCheckResponseSchema.parse(
      (
        await setup.call('post', '/admin/orders/bulk/courier-check', 'admin', {
          orderNumbers: [delivered.orderNumber],
        })
      ).body,
    );
    expect(deliveredOff.results[0]).toMatchObject({
      bookable: false,
      blocker: 'order_status',
      orderStatus: 'delivered',
    });
    expect(
      (
        await setup.call('post', '/admin/orders/bulk/courier-check', 'staff', {
          orderNumbers: numbers,
        })
      ).status,
    ).toBe(403);
  });

  it('books only with an explicit confirmation, per order, never retrying an uncertain one', async () => {
    const setup = courierSetup(MOCK);
    const second = setup.store.addOrder(setup.users.customer.id);
    const pending = setup.store.addOrder(setup.users.customer.id, { status: 'pending' });
    // The first order already has an uncertain booking under its key.
    const uncertainKey = randomUUID();
    await setup.call('post', `/admin/orders/${setup.order.orderNumber}/shipments`, 'admin', {
      bookingKey: uncertainKey,
      provider: 'steadfast',
      weightGrams: 500,
      note: '[mock:timeout]',
    });
    expect(setup.calls.book).toBe(1);

    const items = [
      { orderNumber: setup.order.orderNumber, bookingKey: uncertainKey },
      { orderNumber: second.orderNumber, bookingKey: randomUUID() },
      { orderNumber: pending.orderNumber, bookingKey: randomUUID() },
    ];
    const unconfirmed = await setup.call('post', '/admin/orders/bulk/shipments', 'admin', {
      provider: 'steadfast',
      items,
    });
    expect(unconfirmed.status).toBe(400);
    expect(setup.calls.book).toBe(1);

    const response = await setup.call('post', '/admin/orders/bulk/shipments', 'admin', {
      provider: 'steadfast',
      confirm: true,
      items,
    });
    expect(response.status).toBe(200);
    const body = bulkShipmentBookingResponseSchema.parse(response.body);
    expect(body).toMatchObject({ booked: 1, uncertain: 1, failed: 1 });
    expect(body.results.map((r) => [r.outcome, r.duplicate, r.error?.code ?? null])).toEqual([
      ['uncertain', true, 'shipment_booking_unresolved'],
      ['booked', false, null],
      [null, false, 'shipment_not_bookable'],
    ]);
    // Only the second order reached the courier: the uncertain one was not sent again.
    expect(setup.calls.book).toBe(2);
    const booked = setup.store.shipments.find((s) => s.orderNumber === second.orderNumber);
    expect(booked?.weightGrams).toBe(500);

    expect(
      (
        await setup.call('post', '/admin/orders/bulk/shipments', 'staff', {
          provider: 'steadfast',
          confirm: true,
          items,
        })
      ).status,
    ).toBe(403);
  });
});

describe('the order list', () => {
  it('sorts, filters by zone and shows the parcel to staff who may read shipments', async () => {
    const setup = adminSetup();
    setup.orders.shipped.deliveryZone = 'outside_dhaka';
    setup.admin.orderShipments.set(setup.orders.shipped.orderNumber, {
      shipmentId: randomUUID(),
      status: 'in_transit',
      provider: 'steadfast',
      providerName: 'Steadfast Courier',
      trackingCode: 'SFT1',
      bookingUncertain: false,
      isMock: false,
    });
    const zone = adminOrderListResponseSchema.parse(
      (await setup.call('get', '/admin/orders?deliveryZone=outside_dhaka', 'admin')).body,
    );
    expect(zone.orders.map((o) => o.orderNumber)).toEqual([setup.orders.shipped.orderNumber]);
    expect(zone.orders[0]?.shipment).toMatchObject({
      status: 'in_transit',
      providerName: 'Steadfast Courier',
    });

    const newest = adminOrderListResponseSchema
      .parse((await setup.call('get', '/admin/orders', 'admin')).body)
      .orders.map((o) => o.orderNumber);
    const oldest = adminOrderListResponseSchema
      .parse((await setup.call('get', '/admin/orders?sort=oldest', 'admin')).body)
      .orders.map((o) => o.orderNumber);
    expect(oldest).toEqual([...newest].reverse());
    const high = adminOrderListResponseSchema.parse(
      (await setup.call('get', '/admin/orders?sort=total_high', 'admin')).body,
    ).orders;
    for (let i = 1; i < high.length; i += 1) {
      expect(high[i - 1]?.totalMinor ?? 0).toBeGreaterThanOrEqual(high[i]?.totalMinor ?? 0);
    }
    expect((await setup.call('get', '/admin/orders?sort=random', 'admin')).status).toBe(400);

    // Staff have orders.read but not shipments.read: no parcel column.
    const staff = adminOrderListResponseSchema.parse(
      (await setup.call('get', '/admin/orders', 'staff')).body,
    );
    expect(staff.orders.every((o) => o.shipment === null)).toBe(true);
  });

  it('answers a recorded portal booking as a shipment', async () => {
    const setup = courierSetup({ mode: 'off' });
    const row = setup.store.providers.find((p) => p.provider === 'pathao');
    if (row) row.isEnabled = true;
    const response = await setup.call(
      'post',
      `/admin/orders/${setup.order.orderNumber}/shipments/portal`,
      'admin',
      {
        bookingKey: randomUUID(),
        provider: 'pathao',
        weightGrams: 500,
        consignmentId: 'PT-1',
        note: 'Booked in the merchant portal',
      },
    );
    expect(shipmentSchema.parse(response.body).isMock).toBe(false);
  });
});
