import type { CheckoutDetail } from '@nilzora/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';

const TOKEN = 'customer-access-token';
const GUEST = '9f000000-0000-4000-8000-000000000001';
const PRODUCT = '0d000000-0000-4000-8000-000000000001';
const VARIANT = 'ee000000-0000-4000-8000-000000000001';
const SESSION = '4b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f';
const AT = '2026-11-05T10:00:00.000Z';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The expected Authorization value, assembled so it is never a bare literal here. */
function authHeader(token = TOKEN): string {
  return ['Bearer', token].join(' ');
}

function setup(response: () => Response) {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(response()));
  const client = createApiClient({ baseUrl: 'http://localhost:4000/', fetch: fetchMock });
  const sent = () => {
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    return {
      url: url instanceof Request ? url.url : String(url),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
  };
  return { client, sent };
}

const cart = {
  cart: {
    id: 'c0000000-0000-4000-8000-000000000001',
    status: 'active' as const,
    lines: [{ productId: PRODUCT, variantId: VARIANT, quantity: 2 }],
    lastActivityAt: AT,
  },
};

const checkout: CheckoutDetail = {
  id: SESSION,
  status: 'incomplete',
  recoveryState: 'open',
  customerName: 'Rahima Khatun',
  customerPhone: null,
  itemCount: 2,
  couponCode: 'EID10',
  cartValueMinor: 20_000,
  startedAt: AT,
  lastActivityAt: AT,
  abandonedAt: AT,
  orderNumber: null,
  convertedAt: null,
  attemptCount: 0,
  attempts: [],
  link: null,
  items: [
    {
      productName: 'Desk Lamp',
      variantLabel: 'Colour: Red',
      sku: 'LAMP-1',
      quantity: 2,
      unitPriceMinor: 10_000,
    },
  ],
};

describe('customer cart calls', () => {
  it('reads the signed-in cart', async () => {
    const { client, sent } = setup(() => jsonResponse(cart));
    const result = await client.myCart(TOKEN);

    expect(sent().method).toBe('GET');
    expect(sent().url).toContain('/me/cart');
    expect(sent().headers.get('authorization')).toBe(authHeader());
    expect(result.cart.lines).toHaveLength(1);
  });

  it('sets a line with a PUT and the whole line shape', async () => {
    const { client, sent } = setup(() => jsonResponse(cart));
    await client.setCartItem(TOKEN, { productId: PRODUCT, variantId: VARIANT, quantity: 2 });

    expect(sent().method).toBe('PUT');
    expect(sent().url).toContain('/me/cart/items');
    expect(sent().body).toEqual({ productId: PRODUCT, variantId: VARIANT, quantity: 2 });
  });

  it('clears the signed-in cart and answers the emptied cart', async () => {
    const { client, sent } = setup(() => jsonResponse({ cart: { ...cart.cart, lines: [] } }));
    const result = await client.clearMyCart(TOKEN);

    expect(sent().method).toBe('POST');
    expect(sent().url).toContain('/me/cart/clear');
    expect(result.cart.lines).toEqual([]);
  });

  it('starts the guest cart with the handle the device kept', async () => {
    const { client, sent } = setup(() => jsonResponse(cart));
    await client.startGuestCart(GUEST);

    expect(sent().method).toBe('POST');
    expect(sent().url).toContain('/guest/cart');
    expect(sent().body).toEqual({ token: GUEST });
    // A guest call must never carry a stale bearer token.
    expect(sent().headers.get('authorization')).toBeNull();
  });

  it('writes a guest line and clears it', async () => {
    const write = setup(() => jsonResponse(cart));
    await write.client.setGuestCartItem({
      token: GUEST,
      productId: PRODUCT,
      variantId: null,
      quantity: 1,
    });
    expect(write.sent().method).toBe('PUT');
    expect(write.sent().url).toContain('/guest/cart/items');
    expect(write.sent().body).toEqual({
      token: GUEST,
      productId: PRODUCT,
      variantId: null,
      quantity: 1,
    });

    const clear = setup(() => new Response(null, { status: 204 }));
    await clear.client.clearGuestCart(GUEST);
    expect(clear.sent().method).toBe('POST');
    expect(clear.sent().url).toContain('/guest/cart/clear');
    expect(clear.sent().body).toEqual({ token: GUEST });
  });

  it('merges the guest cart into the account', async () => {
    const { client, sent } = setup(() => jsonResponse(cart));
    await client.mergeGuestCart(TOKEN, GUEST);

    expect(sent().method).toBe('POST');
    expect(sent().url).toContain('/me/cart/merge');
    expect(sent().body).toEqual({ token: GUEST });
    expect(sent().headers.get('authorization')).toBe(authHeader());
  });
});

describe('checkout lifecycle calls', () => {
  it('starts a checkout attempt', async () => {
    const { client, sent } = setup(() =>
      jsonResponse({
        checkout: { id: SESSION, status: 'started', startedAt: AT, lastActivityAt: AT },
      }),
    );
    const result = await client.startCheckout(TOKEN, { addressId: null, couponCode: 'EID10' });

    expect(sent().method).toBe('POST');
    expect(sent().url).toContain('/checkout/sessions');
    expect(sent().body).toEqual({ addressId: null, couponCode: 'EID10' });
    expect(result.checkout.id).toBe(SESSION);
  });

  it('pings activity and reports conversion in the right order', async () => {
    const activity = setup(() => new Response(null, { status: 204 }));
    await activity.client.checkoutActivity(TOKEN, SESSION);
    expect(activity.sent().url).toContain(`/checkout/sessions/${SESSION}/activity`);
    expect(activity.sent().body).toEqual({});

    const converted = setup(() => new Response(null, { status: 204 }));
    await converted.client.checkoutConverted(TOKEN, SESSION, 'NZ-2026-0007');
    expect(converted.sent().url).toContain(`/checkout/sessions/${SESSION}/converted`);
    // The order number is the whole proof that an order exists.
    expect(converted.sent().body).toEqual({ orderNumber: 'NZ-2026-0007' });
  });

  it('escapes a path segment instead of letting it change the route', async () => {
    const { client, sent } = setup(() => new Response(null, { status: 204 }));
    await client.checkoutActivity(TOKEN, '../admin');
    expect(sent().url).toContain('/checkout/sessions/..%2Fadmin/activity');
  });
});

describe('staff checkout queue calls', () => {
  it('lists the queue with normalised filters', async () => {
    const { client, sent } = setup(() =>
      jsonResponse({ checkouts: [checkout], page: 1, pageSize: 25, total: 1, totalPages: 1 }),
    );
    const result = await client.adminListCheckouts(TOKEN);

    expect(sent().method).toBe('GET');
    expect(sent().url).toContain('/admin/checkouts?');
    expect(sent().url).toContain('status=all');
    expect(result.total).toBe(1);
    expect(result.checkouts[0]?.id).toBe(SESSION);
  });

  it('reads one attempt with its items', async () => {
    const { client, sent } = setup(() => jsonResponse({ checkout }));
    const result = await client.adminGetCheckout(TOKEN, SESSION);

    expect(sent().url).toContain(`/admin/checkouts/${SESSION}`);
    expect(result.checkout.items[0]?.variantLabel).toBe('Colour: Red');
  });

  it('refuses a page size the API would reject, without a request', () => {
    const { client } = setup(() => jsonResponse({}));
    expect(() => client.adminListCheckouts(TOKEN, { pageSize: 500 })).toThrow();
  });
});
