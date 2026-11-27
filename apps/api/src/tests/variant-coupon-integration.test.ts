import {
  cartQuoteResponseSchema,
  checkoutQuoteResponseSchema,
  orderResponseSchema,
} from '@nilzora/contracts';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FakeCommerce } from './commerce-fakes';
import { DHAKA_ADDRESS, errorOf } from './commerce-helpers';
import { FakeIdentity } from './fakes';
import { testApp } from './helpers';

/*
 * Variants and coupons across the real pricing routes.
 *
 * What this proves: a variant line is priced from the variant rather than its product on
 * both the public quote route and the place-order route, the variant reaches the order line
 * intact, a variant's own stock is what refuses an oversized line, and a coupon code is
 * carried into both pricing calls instead of being dropped on the way.
 *
 * What it does NOT prove: the coupon arithmetic itself (percentage vs fixed, limits, usage
 * windows) and the SQL-side variant stock decrement. Those live in the coupon and variant
 * migration drafts and in `private.quote_cart_with_coupon` / `public.place_order`, none of
 * which has been executed. The fake deliberately prices no discount, so a passing test here
 * is not evidence that a coupon discount is correct.
 */

const SMALL_LABEL = 'Size: S';
const LARGE_LABEL = 'Size: L';

function variantSetup() {
  const identity = new FakeIdentity();
  const commerce = new FakeCommerce(identity);
  const customer = identity.addUser({ email: 'variant@example.com' });

  const kitchen = commerce.addCategory({ slug: 'home-kitchen', name: 'Home & Kitchen' });
  const shirt = commerce.addProduct({
    slug: 'cotton-panjabi',
    name: 'Cotton Panjabi',
    categoryId: kitchen.id,
    priceMinor: 20_000,
    stock: 6,
    maxOrderQuantity: 4,
    variants: [
      {
        id: randomUUID(),
        label: SMALL_LABEL,
        priceMinor: 19_000,
        stock: 3,
        isActive: true,
        sku: 'PANJABI-S',
      },
      {
        id: randomUUID(),
        label: LARGE_LABEL,
        priceMinor: 22_000,
        stock: 1,
        isActive: true,
        sku: 'PANJABI-L',
      },
      {
        id: randomUUID(),
        label: 'Size: XL',
        priceMinor: 23_000,
        stock: 5,
        isActive: false,
        sku: 'PANJABI-XL',
      },
    ],
  });

  const app = testApp({ auth: identity.deps, commerce: commerce.stores });
  const token = identity.tokenFor(customer);

  function call(method: 'get' | 'post', path: string, body?: object) {
    const pending = request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
    return body === undefined ? pending : pending.send(body);
  }

  const [small, large, retired] = shirt.variants;
  if (!small || !large || !retired) throw new Error('the fixture must define three variants');

  return { commerce, call, shirt, small, large, retired };
}

type Setup = ReturnType<typeof variantSetup>;

async function address(setup: Setup): Promise<string> {
  const created = await setup.call('post', '/me/addresses', DHAKA_ADDRESS);
  return (created.body as { address: { id: string } }).address.id;
}

/** One small panjabi at 19,000, plus 6,000 delivery inside Dhaka. */
const SMALL_ONE = 25_000;
const SMALL_TWO = 44_000;

describe('variant pricing through the public quote route', () => {
  it('prices each variant on its own, not from the product', async () => {
    const setup = variantSetup();

    const response = await setup.call('post', '/cart/quote', {
      items: [
        { productId: setup.shirt.id, variantId: setup.small.id, quantity: 2 },
        { productId: setup.shirt.id, variantId: setup.large.id, quantity: 1 },
      ],
    });
    expect(response.status).toBe(200);

    const quote = cartQuoteResponseSchema.parse(response.body).quote;
    expect(quote.lines).toHaveLength(2);
    expect(quote.lines[0]).toMatchObject({
      variantId: setup.small.id,
      variantLabel: SMALL_LABEL,
      sku: 'PANJABI-S',
      unitPriceMinor: 19_000,
      lineTotalMinor: 38_000,
      problem: null,
    });
    expect(quote.lines[1]).toMatchObject({
      variantId: setup.large.id,
      variantLabel: LARGE_LABEL,
      sku: 'PANJABI-L',
      unitPriceMinor: 22_000,
      lineTotalMinor: 22_000,
    });
    // Two variants of one product are two cart lines, not one duplicated product.
    expect(quote.subtotalMinor).toBe(60_000);
    expect(quote.itemCount).toBe(3);
  });

  it('refuses a retired variant and an id that is not this product’s', async () => {
    const setup = variantSetup();

    const retired = await setup.call('post', '/cart/quote', {
      items: [{ productId: setup.shirt.id, variantId: setup.retired.id, quantity: 1 }],
    });
    expect(cartQuoteResponseSchema.parse(retired.body).quote.lines[0]).toMatchObject({
      variantId: setup.retired.id,
      problem: 'unavailable',
      unitPriceMinor: null,
    });

    const unknown = await setup.call('post', '/cart/quote', {
      items: [{ productId: setup.shirt.id, variantId: randomUUID(), quantity: 1 }],
    });
    expect(cartQuoteResponseSchema.parse(unknown.body).quote.lines[0]?.problem).toBe('unavailable');
  });

  it('flags a line that names no variant for a product that has them', async () => {
    const setup = variantSetup();

    const response = await setup.call('post', '/cart/quote', {
      items: [{ productId: setup.shirt.id, quantity: 1 }],
    });

    expect(response.status).toBe(200);
    expect(cartQuoteResponseSchema.parse(response.body).quote.lines[0]).toMatchObject({
      productId: setup.shirt.id,
      variantId: null,
      problem: 'variant_required',
    });
  });

  it('refuses a line larger than the variant’s own stock', async () => {
    const setup = variantSetup();

    // The product holds 6 and allows 4 per line; the large variant holds 1.
    const response = await setup.call('post', '/cart/quote', {
      items: [{ productId: setup.shirt.id, variantId: setup.large.id, quantity: 2 }],
    });

    expect(cartQuoteResponseSchema.parse(response.body).quote.lines[0]).toMatchObject({
      problem: 'insufficient_stock',
      availableQuantity: 1,
    });
  });
});

describe('variant and coupon through placement', () => {
  it('keeps the variant on the order line and moves only that variant’s stock', async () => {
    const setup = variantSetup();
    const addressId = await address(setup);

    const placed = await setup.call('post', '/orders', {
      idempotencyKey: randomUUID(),
      addressId,
      items: [{ productId: setup.shirt.id, variantId: setup.small.id, quantity: 2 }],
      expectedTotalMinor: SMALL_TWO,
    });
    expect(placed.status).toBe(201);

    const order = orderResponseSchema.parse(placed.body).order;
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({
      variantId: setup.small.id,
      variantLabel: SMALL_LABEL,
      sku: 'PANJABI-S',
      unitPriceMinor: 19_000,
      quantity: 2,
      lineTotalMinor: 38_000,
    });
    expect(order.subtotalMinor).toBe(38_000);
    expect(order.totalMinor).toBe(SMALL_TWO);

    expect(setup.small.stock).toBe(1);
    expect(setup.large.stock).toBe(1);
    expect(setup.shirt.stock).toBe(4);
  });

  it('refuses a placement the quote would not accept, and writes no order', async () => {
    const setup = variantSetup();
    const addressId = await address(setup);

    const refused = await setup.call('post', '/orders', {
      idempotencyKey: randomUUID(),
      addressId,
      items: [{ productId: setup.shirt.id, variantId: setup.large.id, quantity: 2 }],
      expectedTotalMinor: SMALL_ONE,
    });

    expect(refused.status).toBe(409);
    expect(errorOf(refused.body).code).toBe('insufficient_stock');
    expect(setup.commerce.orders).toHaveLength(0);
  });

  it('refuses a placement that names no variant for a product that has them', async () => {
    const setup = variantSetup();
    const addressId = await address(setup);

    const refused = await setup.call('post', '/orders', {
      idempotencyKey: randomUUID(),
      addressId,
      items: [{ productId: setup.shirt.id, quantity: 1 }],
      expectedTotalMinor: SMALL_ONE,
    });

    expect(refused.status).toBe(400);
    expect(errorOf(refused.body).code).toBe('variant_required');
    expect(setup.commerce.orders).toHaveLength(0);
  });

  it('carries a coupon code into the customer quote and the placement', async () => {
    const setup = variantSetup();
    const addressId = await address(setup);
    const items = [{ productId: setup.shirt.id, variantId: setup.small.id, quantity: 1 }];

    const quote = await setup.call('post', '/checkout/quote', {
      items,
      addressId,
      couponCode: 'EID10',
    });
    expect(quote.status).toBe(200);
    // The fake prices no coupons, and says so instead of pretending the code was applied.
    const priced = checkoutQuoteResponseSchema.parse(quote.body).quote;
    expect(priced.discountMinor).toBe(0);
    expect(priced.couponProblem).not.toBeNull();

    const placed = await setup.call('post', '/orders', {
      idempotencyKey: randomUUID(),
      addressId,
      items,
      expectedTotalMinor: SMALL_ONE,
      couponCode: 'EID10',
    });
    expect(placed.status).toBe(201);

    // Both pricing calls received the code; neither dropped it on the way.
    expect(setup.commerce.couponCodes).toStrictEqual(['EID10', 'EID10']);
    expect(orderResponseSchema.parse(placed.body).order.discountMinor).toBe(0);
  });

  it('rejects a coupon code that cannot be one, before any pricing happens', async () => {
    const setup = variantSetup();
    const addressId = await address(setup);

    const response = await setup.call('post', '/checkout/quote', {
      items: [{ productId: setup.shirt.id, variantId: setup.small.id, quantity: 1 }],
      addressId,
      couponCode: 'E'.repeat(33),
    });

    expect(response.status).toBe(400);
    expect(setup.commerce.couponCodes).toStrictEqual([]);
  });
});
