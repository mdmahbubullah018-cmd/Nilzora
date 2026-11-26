import { randomUUID } from 'node:crypto';
import {
  addressResponseSchema,
  orderListResponseSchema,
  orderResponseSchema,
  placeOrderResponseSchema,
} from '@nilzora/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { commerceSetup, DHAKA_ADDRESS, errorOf, KHULNA_ADDRESS } from './commerce-helpers';

type Setup = ReturnType<typeof commerceSetup>;
type Who = 'customer' | 'other';

async function addressFor(setup: Setup, who: Who, address: object = DHAKA_ADDRESS) {
  const response = await request(setup.app)
    .post('/api/v1/me/addresses')
    .set('Authorization', `Bearer ${setup.tokens[who]}`)
    .send(address);
  return addressResponseSchema.parse(response.body).address.id;
}

/** A checkout for 2 lamps and 1 pen to Dhaka: 21,000 + 6,000 delivery. */
async function checkout(setup: Setup, who: Who = 'customer') {
  return {
    idempotencyKey: randomUUID(),
    addressId: await addressFor(setup, who),
    items: [
      { productId: setup.products.lamp.id, quantity: 2 },
      { productId: setup.products.pen.id, quantity: 1 },
    ],
    note: '  Call before delivery ',
    expectedTotalMinor: 27_000,
  };
}

function place(setup: Setup, body: object, who: Who = 'customer') {
  return request(setup.app)
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${setup.tokens[who]}`)
    .send(body);
}

describe('POST /api/v1/orders', () => {
  it('places a COD order priced by the server and moves stock once', async () => {
    const setup = commerceSetup();
    const body = await checkout(setup);
    const response = await place(setup, body);

    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const { order, created } = placeOrderResponseSchema.parse(response.body);
    expect(created).toBe(true);
    expect(order).toMatchObject({
      status: 'pending',
      paymentMethod: 'cod',
      paymentStatus: 'pending',
      itemCount: 3,
      subtotalMinor: 21_000,
      shippingFeeMinor: 6_000,
      discountMinor: 0,
      totalMinor: 27_000,
      deliveryZone: 'inside_dhaka',
      customerNote: 'Call before delivery',
      shippingAddress: { recipientName: 'Rahima Khatun', phone: '+8801712345678' },
      history: [{ fromStatus: null, toStatus: 'pending' }],
      canCancel: true,
    });
    expect(
      order.items.map((item) => [item.productSlug, item.quantity, item.lineTotalMinor]),
    ).toEqual([
      ['desk-lamp', 2, 20_000],
      ['gel-pen', 1, 1_000],
    ]);
    expect(setup.products.lamp.stock).toBe(3);
    expect(setup.commerce.movements).toHaveLength(2);
  });

  it('answers a repeated submission with the original order (200, created: false)', async () => {
    const setup = commerceSetup();
    const body = await checkout(setup);
    const first = await place(setup, body);
    const again = await place(setup, body);

    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    const replay = placeOrderResponseSchema.parse(again.body);
    expect(replay.created).toBe(false);
    expect(replay.order.orderNumber).toBe(
      placeOrderResponseSchema.parse(first.body).order.orderNumber,
    );
    expect(setup.commerce.orders).toHaveLength(1);
    expect(setup.products.lamp.stock).toBe(3);
  });

  it('refuses an idempotency key reused for a different cart', async () => {
    const setup = commerceSetup();
    const body = await checkout(setup);
    await place(setup, body);
    const response = await place(setup, {
      ...body,
      items: [{ productId: setup.products.pen.id, quantity: 1 }],
      expectedTotalMinor: 7_000,
    });

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('idempotency_conflict');
    expect(setup.commerce.orders).toHaveLength(1);
  });

  it.each([
    ['a client total', { totalMinor: 1 }],
    ['a client subtotal', { subtotalMinor: 1 }],
    ['a delivery charge', { shippingFeeMinor: 0 }],
    ['a discount', { discountMinor: 27_000 }],
    ['another user id', { userId: '3f8e2a52-7b1c-4d3e-9f0a-1b2c3d4e5f60' }],
    ['a status', { status: 'delivered' }],
    ['a payment status', { paymentStatus: 'collected' }],
  ])('rejects a request that sets %s, creating nothing', async (_label, extra) => {
    const setup = commerceSetup();
    const response = await place(setup, { ...(await checkout(setup)), ...extra });

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(setup.commerce.orders).toEqual([]);
  });

  it('rejects a client unit price inside the cart', async () => {
    const setup = commerceSetup();
    const body = await checkout(setup);
    const response = await place(setup, {
      ...body,
      items: [{ productId: setup.products.lamp.id, quantity: 1, unitPriceMinor: 1 }],
    });

    expect(response.status).toBe(400);
    expect(setup.commerce.orders).toEqual([]);
  });

  it.each(['idempotencyKey', 'addressId', 'items', 'expectedTotalMinor'])(
    'requires %s',
    async (field) => {
      const setup = commerceSetup();
      const body: Record<string, unknown> = await checkout(setup);
      delete body[field];

      expect((await place(setup, body)).status).toBe(400);
    },
  );

  it('refuses a total that differs from the reviewed one and reports the current total', async () => {
    const setup = commerceSetup();
    const response = await place(setup, { ...(await checkout(setup)), expectedTotalMinor: 1 });

    expect(response.status).toBe(409);
    expect(errorOf(response.body)).toMatchObject({
      code: 'price_changed',
      details: { totalMinor: 27_000 },
    });
    expect(setup.commerce.orders).toEqual([]);
  });

  it.each([
    ['product_unavailable', 'draft', 1, 'unavailable'],
    ['product_unavailable', 'lantern', 1, 'unavailable'],
    ['quantity_limit_exceeded', 'lamp', 4, 'quantity_limit'],
    ['insufficient_stock', 'mug', 2, 'insufficient_stock'],
    ['insufficient_stock', 'plate', 1, 'insufficient_stock'],
  ] as const)(
    'answers 409 %s for %s x%d and lists the problem lines',
    async (code, key, qty, problem) => {
      const setup = commerceSetup();
      const productId = setup.products[key].id;
      const response = await place(setup, {
        ...(await checkout(setup)),
        items: [
          { productId: setup.products.pen.id, quantity: 1 },
          { productId, quantity: qty },
        ],
      });

      expect(response.status).toBe(409);
      expect(errorOf(response.body)).toMatchObject({
        code,
        details: { problems: [{ productId, problem }] },
      });
      expect(response.text).not.toMatch(/secret_table|db\.internal/);
      expect(setup.products.pen.stock).toBe(100);
    },
  );

  it("refuses another customer's address as not found", async () => {
    const setup = commerceSetup();
    const theirs = await addressFor(setup, 'other', KHULNA_ADDRESS);
    const response = await place(setup, { ...(await checkout(setup)), addressId: theirs });

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('address_not_found');
  });

  it('refuses orders while the delivery zone has no charge', async () => {
    const setup = commerceSetup();
    setup.commerce.deliveryCharges.delete('inside_dhaka');
    const response = await place(setup, await checkout(setup));

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('delivery_unavailable');
  });

  it('allows five orders waiting for confirmation, then refuses more', async () => {
    const setup = commerceSetup();
    const addressId = await addressFor(setup, 'customer');
    const order = () =>
      place(setup, {
        idempotencyKey: randomUUID(),
        addressId,
        items: [{ productId: setup.products.pen.id, quantity: 1 }],
        expectedTotalMinor: 7_000,
      });
    for (let index = 0; index < 5; index += 1) expect((await order()).status).toBe(201);

    const sixth = await order();
    expect(sixth.status).toBe(409);
    expect(errorOf(sixth.body).code).toBe('too_many_pending_orders');
  });

  it('answers 503 without internal details when the database is unavailable', async () => {
    const setup = commerceSetup();
    const body = await checkout(setup);
    setup.commerce.unavailable = true;
    const response = await place(setup, body);

    expect(response.status).toBe(503);
    expect(errorOf(response.body).code).toBe('service_unavailable');
    expect(response.text).not.toMatch(/fetch failed|secret_table|db\.internal/);
  });
});

describe('reading orders', () => {
  async function placed(setup: Setup, who: Who, count: number) {
    const addressId = await addressFor(setup, who);
    const numbers: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const response = await place(
        setup,
        {
          idempotencyKey: randomUUID(),
          addressId,
          items: [{ productId: setup.products.pen.id, quantity: index + 1 }],
          expectedTotalMinor: 6_000 + 1_000 * (index + 1),
        },
        who,
      );
      numbers.push(placeOrderResponseSchema.parse(response.body).order.orderNumber);
    }
    return numbers;
  }

  it("lists only the caller's orders, newest first, in pages", async () => {
    const setup = commerceSetup();
    const mine = await placed(setup, 'customer', 3);
    await placed(setup, 'other', 1);
    const auth = `Bearer ${setup.tokens.customer}`;

    const first = await request(setup.app)
      .get('/api/v1/orders?pageSize=2')
      .set('Authorization', auth);
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    const page1 = orderListResponseSchema.parse(first.body);
    expect(page1.orders.map((order) => order.orderNumber)).toEqual([mine[2], mine[1]]);
    expect(page1).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });

    const second = orderListResponseSchema.parse(
      (await request(setup.app).get('/api/v1/orders?pageSize=2&page=2').set('Authorization', auth))
        .body,
    );
    expect(second.orders.map((order) => order.orderNumber)).toEqual([mine[0]]);

    const past = orderListResponseSchema.parse(
      (await request(setup.app).get('/api/v1/orders?page=9').set('Authorization', auth)).body,
    );
    expect(past).toMatchObject({ orders: [], total: 3, page: 9 });
  });

  it.each(['page=0', 'pageSize=51', 'page=abc'])('rejects the page query %s', async (query) => {
    const setup = commerceSetup();
    const response = await request(setup.app)
      .get(`/api/v1/orders?${query}`)
      .set('Authorization', `Bearer ${setup.tokens.customer}`);

    expect(response.status).toBe(400);
  });

  it('returns the full order with items, history and canCancel', async () => {
    const setup = commerceSetup();
    const [number] = await placed(setup, 'customer', 1);
    const response = await request(setup.app)
      .get(`/api/v1/orders/${number}`)
      .set('Authorization', `Bearer ${setup.tokens.customer}`);

    expect(response.status).toBe(200);
    expect(orderResponseSchema.parse(response.body).order).toMatchObject({
      orderNumber: number,
      canCancel: true,
      items: [{ productSlug: 'gel-pen', quantity: 1 }],
    });
  });

  it("answers 404 (never 403) for another customer's order, exactly like a missing one", async () => {
    const setup = commerceSetup();
    const [theirs] = await placed(setup, 'other', 1);
    const auth = `Bearer ${setup.tokens.customer}`;

    const foreign = await request(setup.app)
      .get(`/api/v1/orders/${theirs}`)
      .set('Authorization', auth);
    const missing = await request(setup.app)
      .get('/api/v1/orders/NZ999999')
      .set('Authorization', auth);

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(errorOf(foreign.body).message).toBe(errorOf(missing.body).message);
    expect(foreign.text).not.toContain('Karim');
  });

  it.each(['nz100001', 'NZ1', '100001', 'NZ100001;drop'])(
    'rejects the malformed order number %s',
    async (number) => {
      const setup = commerceSetup();
      const response = await request(setup.app)
        .get(`/api/v1/orders/${number}`)
        .set('Authorization', `Bearer ${setup.tokens.customer}`);

      expect(response.status).toBe(400);
    },
  );
});

describe('POST /api/v1/orders/:orderNumber/cancel', () => {
  async function orderNumber(setup: Setup, who: Who = 'customer') {
    const response = await place(setup, await checkout(setup, who), who);
    return placeOrderResponseSchema.parse(response.body).order.orderNumber;
  }

  function cancel(setup: Setup, number: string, body: object = {}, who: Who = 'customer') {
    return request(setup.app)
      .post(`/api/v1/orders/${number}/cancel`)
      .set('Authorization', `Bearer ${setup.tokens[who]}`)
      .send(body);
  }

  it('cancels a pending order, returns the stock and records the history', async () => {
    const setup = commerceSetup();
    const number = await orderNumber(setup);
    const response = await cancel(setup, number, { reason: ' Ordered by mistake ' });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const { order } = orderResponseSchema.parse(response.body);
    expect(order).toMatchObject({
      status: 'cancelled',
      paymentStatus: 'cancelled',
      cancelReason: 'Ordered by mistake',
      canCancel: false,
    });
    expect(order.cancelledAt).not.toBeNull();
    expect(order.history.map((event) => event.toStatus)).toEqual(['pending', 'cancelled']);
    expect(setup.products.lamp.stock).toBe(5);
    expect(setup.products.pen.stock).toBe(100);
  });

  it('refuses to cancel twice', async () => {
    const setup = commerceSetup();
    const number = await orderNumber(setup);
    await cancel(setup, number);
    const again = await cancel(setup, number);

    expect(again.status).toBe(409);
    expect(errorOf(again.body).code).toBe('order_not_cancellable');
    expect(setup.products.lamp.stock).toBe(5);
  });

  it("answers 404 for another customer's order and leaves it untouched", async () => {
    const setup = commerceSetup();
    const theirs = await orderNumber(setup, 'other');
    const response = await cancel(setup, theirs);

    expect(response.status).toBe(404);
    expect(errorOf(response.body).code).toBe('not_found');
    expect(setup.commerce.orders[0]?.detail.status).toBe('pending');
  });

  it.each([
    ['a status', { status: 'delivered' }],
    ['an overlong reason', { reason: 'x'.repeat(301) }],
  ])('rejects %s', async (_label, body) => {
    const setup = commerceSetup();
    const number = await orderNumber(setup);

    expect((await cancel(setup, number, body)).status).toBe(400);
    expect(setup.commerce.orders[0]?.detail.status).toBe('pending');
  });
});

/** The bearer header the fake identity accepts for a seeded account. */
function bearer(setup: Setup, who: Who): string {
  return ['Bearer', setup.tokens[who]].join(' ');
}

describe('GET /api/v1/orders/:orderNumber/receipt.pdf', () => {
  async function placedOrder(setup: Setup, who: Who): Promise<string> {
    const response = await place(
      setup,
      {
        idempotencyKey: randomUUID(),
        addressId: await addressFor(setup, who),
        items: [{ productId: setup.products.pen.id, quantity: 1 }],
        expectedTotalMinor: 7_000,
      },
      who,
    );
    return placeOrderResponseSchema.parse(response.body).order.orderNumber;
  }

  it('answers the customer’s own order as a branded PDF', async () => {
    const setup = commerceSetup();
    const number = await placedOrder(setup, 'customer');
    const response = await request(setup.app)
      .get(`/api/v1/orders/${number}/receipt.pdf`)
      .set('Authorization', bearer(setup, 'customer'))
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="Nilzora-Receipt-${number}.pdf"`,
    );
    expect(response.headers['cache-control']).toBe('private, no-cache');
    expect(response.headers.etag).toMatch(/^"receipt-[0-9a-f]{32}"$/);

    const pdf = response.body as Buffer;
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.subarray(-6).toString('latin1').trim()).toBe('%%EOF');
    const raw = pdf.toString('latin1');
    // The supplied Nilzora logo is embedded as an image (never redrawn) and drawn on every page.
    expect(raw).toContain('/Subtype /Image');
    expect(raw).toContain('/Filter /DCTDecode');
    expect(raw).toMatch(/\/XObject << \/Im1 \d+ 0 R/);
    expect(raw).toMatch(/cm \/Im1 Do Q/);
    // The checks below read the drawing operations, not the image bytes.
    const text = raw.replace(/\/Filter \/DCTDecode[\s\S]*?endstream/g, '');
    // The document names the order it belongs to.
    expect(text).toContain(number);
    expect(text).toContain('Order receipt');
    // The body is really rendered: what was bought, what it costs, and what is still owed.
    expect(text).toContain('Subtotal');
    expect(text).toContain('Total');
    expect(text).toContain('Paid');
    expect(text).toContain('Due on delivery');
    expect(text).toContain('Thank you for shopping with Nilzora.');
    // Amounts print as English text, never as a currency glyph the Latin-only writer cannot show.
    expect(text).toContain('BDT');
    // Nothing in this English-only receipt had to be replaced by the writer's fallback.
    expect(text).not.toContain('?');
    // Nothing internal travels in the document: no email address, no access token.
    expect(text).not.toContain('@');
    expect(text).not.toContain('Bearer');
    // The last page is the version a customer may forward: products and amounts, no address.
    expect(text).toContain('Shareable summary');
  });

  it("answers 404 for another customer's order, so order numbers cannot be probed", async () => {
    const setup = commerceSetup();
    const theirs = await placedOrder(setup, 'other');
    const response = await request(setup.app)
      .get(`/api/v1/orders/${theirs}/receipt.pdf`)
      .set('Authorization', bearer(setup, 'customer'));

    expect(response.status).toBe(404);
    expect(errorOf(response.body).code).toBe('not_found');
  });

  it('answers 304 when the same unchanged receipt is asked for again', async () => {
    const setup = commerceSetup();
    const number = await placedOrder(setup, 'customer');
    const first = await request(setup.app)
      .get(`/api/v1/orders/${number}/receipt.pdf`)
      .set('Authorization', bearer(setup, 'customer'));
    const again = await request(setup.app)
      .get(`/api/v1/orders/${number}/receipt.pdf`)
      .set('Authorization', bearer(setup, 'customer'))
      .set('If-None-Match', String(first.headers.etag));

    expect(again.status).toBe(304);
  });

  it('needs a signed-in customer', async () => {
    const setup = commerceSetup();
    const response = await request(setup.app).get('/api/v1/orders/NZ100001/receipt.pdf');

    expect(response.status).toBe(401);
  });
});

describe('order rate limiting', () => {
  it('limits placing and cancelling per client, separately from reading', async () => {
    const setup = commerceSetup({ ORDER_RATE_LIMIT_MAX: '2' });
    const body = await checkout(setup);
    const auth = `Bearer ${setup.tokens.customer}`;

    expect((await place(setup, body)).status).toBe(201);
    expect((await place(setup, body)).status).toBe(200);
    const limited = await place(setup, body);
    expect(limited.status).toBe(429);
    expect(errorOf(limited.body).code).toBe('rate_limited');
    expect(limited.headers['ratelimit-policy']).toContain('q=2');

    const cancelled = await request(setup.app)
      .post('/api/v1/orders/NZ100001/cancel')
      .set('Authorization', auth)
      .send({});
    expect(cancelled.status).toBe(429);

    expect((await request(setup.app).get('/api/v1/orders').set('Authorization', auth)).status).toBe(
      200,
    );
  });
});
