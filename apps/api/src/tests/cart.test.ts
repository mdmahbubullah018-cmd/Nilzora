import { addressResponseSchema, cartQuoteResponseSchema } from '@nilzora/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { commerceSetup, DHAKA_ADDRESS, errorOf, KHULNA_ADDRESS } from './commerce-helpers';

type Setup = ReturnType<typeof commerceSetup>;

async function addAddress(setup: Setup, token: string, address: object = DHAKA_ADDRESS) {
  const response = await request(setup.app)
    .post('/api/v1/me/addresses')
    .set('Authorization', `Bearer ${token}`)
    .send(address);
  return addressResponseSchema.parse(response.body).address;
}

describe('POST /api/v1/cart/quote', () => {
  it('prices a cart from the catalog for anyone, uncached', async () => {
    const { app, products } = commerceSetup();
    const response = await request(app)
      .post('/api/v1/cart/quote')
      .send({
        items: [
          { productId: products.lamp.id, quantity: 2 },
          { productId: products.pen.id, quantity: 3 },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const { quote } = cartQuoteResponseSchema.parse(response.body);
    expect(quote).toMatchObject({
      itemCount: 5,
      subtotalMinor: 23_000,
      deliveryZone: null,
      shippingFeeMinor: null,
      totalMinor: null,
      purchasable: true,
    });
    expect(quote.lines[0]).toStrictEqual({
      productId: products.lamp.id,
      variantId: null,
      variantLabel: null,
      slug: 'desk-lamp',
      name: 'Desk Lamp',
      sku: 'DESK-LAMP',
      unitPriceMinor: 10_000,
      compareAtPriceMinor: 12_000,
      listPriceMinor: 12_000,
      campaignDiscountMinor: 0,
      campaign: null,
      quantity: 2,
      lineTotalMinor: 20_000,
      availableQuantity: 3,
      problem: null,
      image: null,
    });
  });

  it('flags lines that cannot be ordered and reveals nothing about hidden products', async () => {
    const { app, products } = commerceSetup();
    const response = await request(app)
      .post('/api/v1/cart/quote')
      .send({
        items: [
          { productId: products.draft.id, quantity: 1 },
          { productId: products.lantern.id, quantity: 1 },
          { productId: products.lamp.id, quantity: 4 },
          { productId: products.mug.id, quantity: 2 },
          { productId: products.pen.id, quantity: 1 },
        ],
      });

    const { quote } = cartQuoteResponseSchema.parse(response.body);
    expect(quote.lines.map((line) => line.problem)).toEqual([
      'unavailable',
      'unavailable',
      'quantity_limit',
      'insufficient_stock',
      null,
    ]);
    expect(quote.lines[0]).toMatchObject({ slug: null, name: null, unitPriceMinor: null });
    expect(quote).toMatchObject({ itemCount: 1, subtotalMinor: 1_000, purchasable: false });
    expect(response.text).not.toMatch(/Smart Watch|Paper Lantern/);
  });

  it.each([
    [
      'a client price',
      (id: string) => ({ items: [{ productId: id, quantity: 1, priceMinor: 1 }] }),
    ],
    [
      'a client total',
      (id: string) => ({ items: [{ productId: id, quantity: 1 }], totalMinor: 1 }),
    ],
    [
      'a discount',
      (id: string) => ({ items: [{ productId: id, quantity: 1 }], discountMinor: 500 }),
    ],
    ['an empty cart', () => ({ items: [] })],
    ['a zero quantity', (id: string) => ({ items: [{ productId: id, quantity: 0 }] })],
    [
      'a repeated product',
      (id: string) => ({
        items: [
          { productId: id, quantity: 1 },
          { productId: id.toUpperCase(), quantity: 1 },
        ],
      }),
    ],
  ])('rejects %s', async (_label, body) => {
    const { app, products } = commerceSetup();
    const response = await request(app).post('/api/v1/cart/quote').send(body(products.pen.id));

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(response.headers['cache-control']).toBe('no-store');
  });
});

describe('POST /api/v1/checkout/quote', () => {
  it("adds the delivery charge for the caller's own address", async () => {
    const setup = commerceSetup();
    const dhaka = await addAddress(setup, setup.tokens.customer);
    const khulna = await addAddress(setup, setup.tokens.customer, KHULNA_ADDRESS);
    const items = [{ productId: setup.products.pen.id, quantity: 3 }];

    const inside = await request(setup.app)
      .post('/api/v1/checkout/quote')
      .set('Authorization', `Bearer ${setup.tokens.customer}`)
      .send({ items, addressId: dhaka.id });
    const outside = await request(setup.app)
      .post('/api/v1/checkout/quote')
      .set('Authorization', `Bearer ${setup.tokens.customer}`)
      .send({ items, addressId: khulna.id });

    expect(inside.status).toBe(200);
    expect(inside.headers['cache-control']).toBe('no-store');
    expect(cartQuoteResponseSchema.parse(inside.body).quote).toMatchObject({
      subtotalMinor: 3_000,
      deliveryZone: 'inside_dhaka',
      shippingFeeMinor: 6_000,
      totalMinor: 9_000,
      purchasable: true,
    });
    expect(cartQuoteResponseSchema.parse(outside.body).quote).toMatchObject({
      deliveryZone: 'outside_dhaka',
      shippingFeeMinor: 12_000,
      totalMinor: 15_000,
    });
  });

  it('is not purchasable while the zone has no delivery charge', async () => {
    const setup = commerceSetup();
    const address = await addAddress(setup, setup.tokens.customer);
    setup.commerce.deliveryCharges.delete('inside_dhaka');

    const response = await request(setup.app)
      .post('/api/v1/checkout/quote')
      .set('Authorization', `Bearer ${setup.tokens.customer}`)
      .send({ items: [{ productId: setup.products.pen.id, quantity: 1 }], addressId: address.id });

    expect(cartQuoteResponseSchema.parse(response.body).quote).toMatchObject({
      shippingFeeMinor: null,
      totalMinor: null,
      purchasable: false,
    });
  });

  it("treats another customer's address as not found", async () => {
    const setup = commerceSetup();
    const theirs = await addAddress(setup, setup.tokens.other);

    const response = await request(setup.app)
      .post('/api/v1/checkout/quote')
      .set('Authorization', `Bearer ${setup.tokens.customer}`)
      .send({ items: [{ productId: setup.products.pen.id, quantity: 1 }], addressId: theirs.id });

    expect(response.status).toBe(400);
    expect(errorOf(response.body)).toMatchObject({
      code: 'address_not_found',
      message: 'Choose one of your saved delivery addresses',
    });
    expect(response.text).not.toContain(KHULNA_ADDRESS.area);
    expect(response.text).not.toContain('secret_table');
  });

  it.each([
    ['a missing address', {}],
    ['an address that is not a uuid', { addressId: 'home' }],
    ['a client delivery charge', { shippingFeeMinor: 0 }],
  ])('rejects %s', async (_label, extra) => {
    const setup = commerceSetup();
    const address = await addAddress(setup, setup.tokens.customer);
    const response = await request(setup.app)
      .post('/api/v1/checkout/quote')
      .set('Authorization', `Bearer ${setup.tokens.customer}`)
      .send({
        items: [{ productId: setup.products.pen.id, quantity: 1 }],
        ...(Object.keys(extra).length === 0 ? {} : { addressId: address.id }),
        ...extra,
      });

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
  });
});
