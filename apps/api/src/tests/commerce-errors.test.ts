import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { orderResponseSchema, placeOrderResponseSchema } from '@nilzora/contracts';
import { Router } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommerceStores } from '../app';
import { createSupabaseAddressStore } from '../modules/addresses/store';
import { createSupabaseCartStore } from '../modules/cart/store';
import { createSupabaseCatalogStore } from '../modules/catalog/store';
import {
  CommerceRefusalError,
  StoreUnavailableError,
  toStoreError,
} from '../modules/commerce/errors';
import { sendCommerceFailure } from '../modules/commerce/http';
import { createSupabaseOrderStore } from '../modules/orders/store';
import { createSupabaseClients } from '../supabase/clients';
import { errorOf } from './commerce-helpers';
import { FakeIdentity } from './fakes';
import { captureLogs, TEST_SUPABASE_ENV, testApp } from './helpers';

const LAMP = '0d000000-0000-4000-8000-000000000001';
const MUG = '0d000000-0000-4000-8000-000000000002';
const SECRET_TEXT = 'relation private.secret_table at db.internal:5432';

describe('toStoreError', () => {
  it.each([
    ['NZ404', 'order_not_found'],
    ['NZ410', 'account_suspended'],
    ['NZ411', 'address_not_found'],
    ['NZ412', 'cart_invalid'],
    ['NZ413', 'product_unavailable'],
    ['NZ414', 'insufficient_stock'],
    ['NZ415', 'quantity_limit_exceeded'],
    ['NZ416', 'idempotency_conflict'],
    ['NZ417', 'delivery_unavailable'],
    ['NZ418', 'price_changed'],
    ['NZ419', 'order_not_cancellable'],
    ['NZ420', 'too_many_pending_orders'],
    ['NZ421', 'address_limit_reached'],
  ])('maps %s to the %s refusal', (code, refusal) => {
    const error = toStoreError({ code, message: SECRET_TEXT }, 'test');
    expect(error).toBeInstanceOf(CommerceRefusalError);
    expect(error).toMatchObject({ refusal });
    expect(error.message).not.toContain('secret_table');
  });

  it.each(['', '42501', '42P01', '23505', 'PGRST116', 'PGRST301', 'XX000', 'NZ999', 'nz414'])(
    'treats %j as the store being unavailable',
    (code) => {
      const error = toStoreError({ code, message: SECRET_TEXT }, 'test');
      expect(error).toBeInstanceOf(StoreUnavailableError);
    },
  );

  it('keeps only validated problem lines from DETAIL', () => {
    const detail = JSON.stringify([
      { productId: LAMP, problem: 'insufficient_stock', stock: 2, name: 'Lamp' },
      { productId: MUG, problem: 'unavailable' },
    ]);
    const error = toStoreError({ code: 'NZ414', message: '', details: detail }, 'test');

    expect(error).toBeInstanceOf(CommerceRefusalError);
    // Strict: any extra key (stock levels, names) leaking through would fail here.
    expect((error as CommerceRefusalError).details).toStrictEqual({
      problems: [
        { productId: LAMP, problem: 'insufficient_stock' },
        { productId: MUG, problem: 'unavailable' },
      ],
    });
  });

  it.each([
    ['missing', null],
    ['not JSON', 'not json {'],
    ['the wrong shape', '{"productId": "x"}'],
    ['an unknown problem', JSON.stringify([{ productId: LAMP, problem: 'drop table' }])],
  ])('answers no problem lines when DETAIL is %s', (_label, details) => {
    const error = toStoreError({ code: 'NZ413', message: '', details }, 'test');
    expect(error).toMatchObject({ details: { problems: [] } });
  });

  it('passes the current total for price changes, and nothing when it is malformed', () => {
    expect(
      toStoreError({ code: 'NZ418', message: '', details: '{"totalMinor": 28500}' }, 'test'),
    ).toMatchObject({ details: { totalMinor: 28_500 } });
    expect(
      toStoreError({ code: 'NZ418', message: '', details: '{"totalMinor": -1}' }, 'test'),
    ).toMatchObject({ details: undefined });
  });
});

describe('refusal responses', () => {
  const probe = Router().get('/probe/refusal/:code', (req, res) => {
    sendCommerceFailure(
      res,
      toStoreError(
        {
          code: req.params.code,
          message: SECRET_TEXT,
          details: JSON.stringify([{ productId: LAMP, problem: 'insufficient_stock' }]),
        },
        'probe',
      ),
    );
  });

  it.each([
    ['NZ404', 404, 'not_found'],
    ['NZ410', 403, 'account_suspended'],
    ['NZ411', 400, 'address_not_found'],
    ['NZ412', 400, 'cart_invalid'],
    ['NZ413', 409, 'product_unavailable'],
    ['NZ414', 409, 'insufficient_stock'],
    ['NZ415', 409, 'quantity_limit_exceeded'],
    ['NZ416', 409, 'idempotency_conflict'],
    ['NZ417', 409, 'delivery_unavailable'],
    ['NZ418', 409, 'price_changed'],
    ['NZ419', 409, 'order_not_cancellable'],
    ['NZ420', 409, 'too_many_pending_orders'],
    ['NZ421', 409, 'address_limit_reached'],
    ['XX000', 503, 'service_unavailable'],
    ['42501', 503, 'service_unavailable'],
  ])('%s answers %d %s without the database message', async (code, status, apiCode) => {
    const response = await request(testApp({ modules: [probe] })).get(
      `/api/v1/probe/refusal/${code}`,
    );

    expect(response.status).toBe(status);
    expect(errorOf(response.body)).toMatchObject({
      code: apiCode,
      requestId: response.headers['x-request-id'],
    });
    expect(response.text).not.toMatch(/secret_table|db\.internal|5432|relation/);
  });
});

/*
 * The real Supabase stores against a stand-in PostgREST server, to check how they
 * read answers and failures from the wire. Nothing here talks to a real database.
 */
describe('Supabase stores on failure', () => {
  type Handler = (req: IncomingMessage, body: string) => [number, unknown];
  const handlers = new Map<string, Handler>();
  let server: Server;
  let url: string;
  let closedUrl: string;

  function reply(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  }

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      req.on('end', () => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        const handler = handlers.get(`${req.method} ${path}`);
        if (handler) reply(res, ...handler(req, body));
        else reply(res, 404, { code: 'PGRST202', message: `no handler for ${path}` });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // A port that was just free: connections to it are refused.
    const spare = createServer();
    await new Promise<void>((resolve) => spare.listen(0, '127.0.0.1', resolve));
    closedUrl = `http://127.0.0.1:${(spare.address() as AddressInfo).port}`;
    await new Promise((resolve) => spare.close(resolve));
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function storesAt(baseUrl: string): CommerceStores {
    const clients = createSupabaseClients({
      url: baseUrl,
      publishableKey: TEST_SUPABASE_ENV.SUPABASE_PUBLISHABLE_KEY,
      secretKey: TEST_SUPABASE_ENV.SUPABASE_SECRET_KEY,
    });
    return {
      catalog: createSupabaseCatalogStore(clients),
      cart: createSupabaseCartStore(clients),
      addresses: createSupabaseAddressStore(clients),
      orders: createSupabaseOrderStore(clients),
    };
  }

  it('answers 503 when the database cannot be reached, logging only server-side', async () => {
    const logs = captureLogs('warn');
    const app = testApp({ commerce: storesAt(closedUrl), logger: logs.logger });
    const response = await request(app)
      .post('/api/v1/cart/quote')
      .send({ items: [{ productId: LAMP, quantity: 1 }] });

    expect(response.status).toBe(503);
    expect(errorOf(response.body)).toMatchObject({
      code: 'service_unavailable',
      message: 'The store is temporarily unavailable. Try again.',
    });
    expect(response.text).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|fetch|quote_cart/);
    expect(logs.raw()).toContain('Store database unavailable');
    expect(logs.raw()).not.toContain(TEST_SUPABASE_ENV.SUPABASE_PUBLISHABLE_KEY);
  });

  it('answers 503 for an unexpected database error without leaking its message', async () => {
    handlers.set('POST /rest/v1/rpc/catalog_categories', () => [
      500,
      { code: 'XX000', message: SECRET_TEXT, details: 'password=hunter2', hint: null },
    ]);
    const response = await request(testApp({ commerce: storesAt(url) })).get(
      '/api/v1/catalog/categories',
    );

    expect(response.status).toBe(503);
    expect(response.text).not.toMatch(/secret_table|hunter2|XX000/);
  });

  it('answers 503 when the database answer breaks the contract', async () => {
    handlers.set('POST /rest/v1/rpc/quote_cart', () => [200, { lines: 'unexpected' }]);
    const response = await request(testApp({ commerce: storesAt(url) }))
      .post('/api/v1/cart/quote')
      .send({ items: [{ productId: LAMP, quantity: 1 }] });

    expect(response.status).toBe(503);
    expect(errorOf(response.body).code).toBe('service_unavailable');
  });

  it('sends the cart, never prices, and maps a stock refusal from the wire', async () => {
    const identity = new FakeIdentity();
    const token = identity.tokenFor(identity.addUser({ email: 'rahima@example.com' }));
    const calls: { authorization: string | undefined; body: unknown }[] = [];
    handlers.set('POST /rest/v1/rpc/place_cod_order', (req, body) => {
      calls.push({ authorization: req.headers.authorization, body: JSON.parse(body) });
      return [
        400,
        {
          code: 'NZ414',
          message: `not enough stock (${SECRET_TEXT})`,
          details: JSON.stringify([{ productId: LAMP, problem: 'insufficient_stock' }]),
          hint: null,
        },
      ];
    });
    const app = testApp({ auth: identity.deps, commerce: storesAt(url) });
    const key = '0e000000-0000-4000-8000-000000000001';
    const addressId = '0a000000-0000-4000-8000-000000000001';

    const response = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        idempotencyKey: key,
        addressId,
        items: [{ productId: LAMP, quantity: 2 }],
        expectedTotalMinor: 26_000,
      });

    expect(response.status).toBe(409);
    expect(errorOf(response.body)).toMatchObject({
      code: 'insufficient_stock',
      details: { problems: [{ productId: LAMP, problem: 'insufficient_stock' }] },
    });
    expect(response.text).not.toContain('secret_table');
    // The call ran as the customer (RLS applies), with ids and quantities only.
    expect(calls).toEqual([
      {
        authorization: `Bearer ${token}`,
        body: {
          p_idempotency_key: key,
          p_address_id: addressId,
          p_items: [{ productId: LAMP, quantity: 2 }],
          p_expected_total_minor: 26_000,
        },
      },
    ]);
  });

  it('selects explicit order columns and never the private idempotency fields', async () => {
    const identity = new FakeIdentity();
    const token = identity.tokenFor(identity.addUser({ email: 'rahima@example.com' }));
    const selects: string[] = [];
    handlers.set('GET /rest/v1/orders', (req) => {
      selects.push(new URL(req.url ?? '', url).searchParams.get('select') ?? '');
      return [200, []];
    });
    const app = testApp({ auth: identity.deps, commerce: storesAt(url) });

    const detail = await request(app)
      .get('/api/v1/orders/NZ100001')
      .set('Authorization', `Bearer ${token}`);
    const list = await request(app).get('/api/v1/orders').set('Authorization', `Bearer ${token}`);

    expect(detail.status).toBe(404);
    expect(list.status).toBe(200);
    expect(selects).toHaveLength(2);
    for (const select of selects) {
      expect(select).not.toMatch(/\*|idempotency_key|request_fingerprint|user_id/);
    }
  });

  describe('reading an order back after its database function committed', () => {
    const ORDER_NUMBER = 'NZ100042';
    const READ_BACK_LOG = 'Order change committed but could not be read back';
    const placeBody = {
      idempotencyKey: '0e000000-0000-4000-8000-000000000002',
      addressId: '0a000000-0000-4000-8000-000000000001',
      items: [{ productId: LAMP, quantity: 2 }],
      expectedTotalMinor: 26_000,
    };

    /** The order as PostgREST returns it for the detail select. */
    function orderRow(status: 'pending' | 'cancelled') {
      const placedAt = '2026-10-24T08:05:00+00:00';
      const cancelledAt = '2026-10-24T08:10:00+00:00';
      return {
        order_number: ORDER_NUMBER,
        status,
        payment_method: 'cod',
        payment_status: status,
        item_count: 2,
        total_minor: 26_000,
        placed_at: placedAt,
        currency: 'BDT',
        subtotal_minor: 20_000,
        shipping_fee_minor: 6_000,
        discount_minor: 0,
        delivery_zone: 'inside_dhaka',
        ship_recipient_name: 'Rahima Khatun',
        ship_phone: '+8801712345678',
        ship_division: 'Dhaka',
        ship_district: 'Dhaka',
        ship_area: 'Dhanmondi',
        ship_address_line: 'House 12, Road 5',
        ship_postal_code: null,
        ship_landmark: null,
        customer_note: null,
        cancel_reason: null,
        cancelled_at: status === 'cancelled' ? cancelledAt : null,
        order_items: [
          {
            id: 1,
            product_id: LAMP,
            product_name: 'Desk Lamp',
            product_slug: 'desk-lamp',
            sku: 'DESK-LAMP',
            unit_price_minor: 10_000,
            quantity: 2,
            line_total_minor: 20_000,
            regular_price_minor: null,
            catalog_price_minor: null,
            campaign_id: null,
            campaign_title: null,
            campaign_discount_minor: 0,
          },
        ],
        order_status_history: [
          { from_status: null, to_status: 'pending', created_at: placedAt },
          ...(status === 'cancelled'
            ? [{ from_status: 'pending', to_status: 'cancelled', created_at: cancelledAt }]
            : []),
        ],
      };
    }

    /**
     * Answers the order reads in turn: 'fail' is a 500 (which PostgREST's client does
     * not retry by itself), 'missing' no row, otherwise the row. Returns a read count.
     */
    function orderReads(...answers: ('fail' | 'missing' | 'pending' | 'cancelled')[]) {
      let reads = 0;
      handlers.set('GET /rest/v1/orders', () => {
        const answer = answers[reads] ?? 'fail';
        reads += 1;
        if (answer === 'fail') {
          return [500, { code: 'XX000', message: SECRET_TEXT, details: null, hint: null }];
        }
        return [200, answer === 'missing' ? [] : [orderRow(answer)]];
      });
      return () => reads;
    }

    function shopper() {
      const identity = new FakeIdentity();
      const user = identity.addUser({ email: 'rahima@example.com' });
      const logs = captureLogs('warn');
      const app = testApp({ auth: identity.deps, commerce: storesAt(url), logger: logs.logger });
      return { app, logs, userId: user.id, auth: `Bearer ${identity.tokenFor(user)}` };
    }

    function placed() {
      handlers.set('POST /rest/v1/rpc/place_cod_order', () => [
        200,
        {
          orderId: '0f000000-0000-4000-8000-000000000001',
          orderNumber: ORDER_NUMBER,
          created: true,
        },
      ]);
    }

    /** How many times the order was actually written, so a retry can prove it wrote once. */
    function placeCalls(): () => number {
      let writes = 0;
      handlers.set('POST /rest/v1/rpc/place_cod_order', () => {
        writes += 1;
        return [
          200,
          {
            orderId: '0f000000-0000-4000-8000-000000000001',
            orderNumber: ORDER_NUMBER,
            created: true,
          },
        ];
      });
      return () => writes;
    }

    function cancelled() {
      handlers.set('POST /rest/v1/rpc/cancel_my_order', () => [
        200,
        {
          orderId: '0f000000-0000-4000-8000-000000000001',
          orderNumber: ORDER_NUMBER,
          status: 'cancelled',
        },
      ]);
    }

    it('retries a failed read after placing, then answers 201 with the order', async () => {
      const writes = placeCalls();
      const reads = orderReads('fail', 'pending');
      const { app, logs, auth } = shopper();

      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', auth)
        .send(placeBody);

      expect(response.status).toBe(201);
      expect(placeOrderResponseSchema.parse(response.body)).toMatchObject({
        created: true,
        order: { orderNumber: ORDER_NUMBER, status: 'pending', totalMinor: 26_000 },
      });
      expect(reads()).toBe(2);
      // A slow read is retried as a read: the order itself was written exactly once.
      expect(writes()).toBe(1);
      expect(logs.raw()).not.toContain(READ_BACK_LOG);
    });

    it('names the placed order when no read succeeds, so the customer can open it', async () => {
      placed();
      const reads = orderReads('fail', 'fail', 'fail');
      const { app, logs, userId, auth } = shopper();

      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', auth)
        .send(placeBody);

      expect(response.status).toBe(503);
      // The write was saved: the answer says so, and names the caller's own order.
      expect(errorOf(response.body)).toMatchObject({
        code: 'order_confirmation_pending',
        message: 'Your order was placed, but it could not be loaded just now.',
        details: { orderNumber: ORDER_NUMBER },
        requestId: response.headers['x-request-id'],
      });
      expect(response.text).not.toMatch(/secret_table|XX000|read back/);
      // Every read was tried, with the order's own number in the answer.
      expect(reads()).toBe(3);

      const warnings = logs.entries().filter((entry) => entry.msg === READ_BACK_LOG);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        level: 40,
        operation: 'place_cod_order',
        orderNumber: ORDER_NUMBER,
        err: { type: 'OrderReadBackError' },
      });
      // Told apart from a plain outage, and nothing about the customer is logged.
      expect(logs.raw()).not.toContain('Store database unavailable');
      expect(logs.raw()).not.toMatch(/Rahima|rahima@|8801712345678|House 12/);
      expect(logs.raw()).not.toContain(userId);
      expect(logs.raw()).not.toContain(auth.slice('Bearer '.length));
    });

    it('retries a failed read once after cancelling, then answers with the order', async () => {
      cancelled();
      const reads = orderReads('fail', 'cancelled');
      const { app, auth } = shopper();

      const response = await request(app)
        .post(`/api/v1/orders/${ORDER_NUMBER}/cancel`)
        .set('Authorization', auth)
        .send({});

      expect(response.status).toBe(200);
      expect(orderResponseSchema.parse(response.body).order).toMatchObject({
        orderNumber: ORDER_NUMBER,
        status: 'cancelled',
        canCancel: false,
      });
      expect(reads()).toBe(2);
    });

    it('answers 503 when the cancelled order cannot be read back, logging it distinctly', async () => {
      cancelled();
      // A failed read, then no row at all: both leave the committed change unconfirmed.
      const reads = orderReads('fail', 'missing', 'missing');
      const { app, logs, auth } = shopper();

      const response = await request(app)
        .post(`/api/v1/orders/${ORDER_NUMBER}/cancel`)
        .set('Authorization', auth)
        .send({});

      expect(response.status).toBe(503);
      expect(errorOf(response.body).code).toBe('service_unavailable');
      expect(reads()).toBe(3);
      expect(logs.entries().filter((entry) => entry.msg === READ_BACK_LOG)).toMatchObject([
        { level: 40, operation: 'cancel_my_order', orderNumber: ORDER_NUMBER },
      ]);
      expect(logs.raw()).not.toContain('Store database unavailable');
    });
  });
});
