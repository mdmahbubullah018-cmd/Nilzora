// @vitest-environment node
import type { PlaceOrderRequest, PlaceOrderResponse } from '@nilzora/contracts';
import type { FormState, SessionAct, SessionCall } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  HOME_ID,
  LAMP_ID,
  MUG_ID,
  ORDER_KEY,
  placedOrder,
  redirectedTo,
} from '@/testing/commerce-fixtures';
import { placeOrderAction } from './checkout-actions';

/** What session.act() decides before (or instead of) calling the API. */
type Gate = 'ok' | 'untrusted' | 'signed_out' | 'unavailable';

const browser = vi.hoisted(() => {
  const holder: { cart: string | undefined; gate: Gate } = { cart: undefined, gate: 'ok' };
  return {
    ...holder,
    placeOrder: vi.fn<(token: string, body: PlaceOrderRequest) => Promise<PlaceOrderResponse>>(),
    getOrder: vi.fn<(token: string, orderNumber: string) => Promise<{ order: unknown }>>(),
  };
});
const cache = vi.hoisted(() => ({ refresh: vi.fn(), updateTag: vi.fn() }));

vi.mock('next/cache', () => cache);
vi.mock('@/lib/session', () => ({
  session: {
    act: async <T>(_formData: FormData, call: SessionCall<T>): Promise<SessionAct<T>> => {
      if (browser.gate !== 'ok') return { kind: browser.gate };
      const api = { placeOrder: browser.placeOrder };
      return { kind: 'ok', value: await call(api as never, 'access-token') };
    },
    read: async <T>(call: SessionCall<T>) => {
      const api = { getOrder: browser.getOrder };
      try {
        return { kind: 'ok' as const, value: await call(api as never, 'access-token') };
      } catch (error) {
        // Mirrors session.read(): an undecided answer is `unavailable`, a refusal is thrown.
        const status = (error as { status?: unknown }).status;
        if (typeof status === 'number' && (status === 0 || status >= 500)) {
          return { kind: 'unavailable' as const };
        }
        throw error;
      }
    },
    cartCookie: {
      get: () => Promise.resolve(browser.cart),
      clear: () => {
        browser.cart = undefined;
        return Promise.resolve();
      },
    },
  },
}));

const idle: FormState = { status: 'idle' };
const NOT_CONFIRMED =
  'We could not confirm your order. It may already be placed: check Your orders first. Trying again from this page will not create a second order.';

function checkoutForm(fields: Record<string, string> = {}): FormData {
  const data = new FormData();
  const all = {
    csrf_token: 'signed-csrf-value',
    idempotencyKey: ORDER_KEY,
    addressId: HOME_ID,
    expectedTotalMinor: '316000',
    note: '  Call before delivery  ',
    ...fields,
  };
  for (const [name, value] of Object.entries(all)) data.append(name, value);
  return data;
}

beforeEach(() => {
  browser.cart = `${LAMP_ID}:2,${MUG_ID}:1`;
  browser.gate = 'ok';
  browser.placeOrder.mockReset();
  browser.placeOrder.mockResolvedValue(placedOrder());
  browser.getOrder.mockReset();
  browser.getOrder.mockResolvedValue({ order: placedOrder().order });
  cache.refresh.mockReset();
  cache.updateTag.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('placeOrderAction: placing', () => {
  it('orders what the cart cookie holds, then empties the cart and opens the order', async () => {
    // Fields a tampered form might add are never read.
    const form = checkoutForm({ items: `${MUG_ID}:50`, totalMinor: '1', priceMinor: '1' });

    await expect(placeOrderAction(idle, form)).rejects.toMatchObject(
      redirectedTo('/account/orders/NZ100042/receipt?placed=1'),
    );

    expect(browser.placeOrder).toHaveBeenCalledTimes(1);
    expect(browser.placeOrder).toHaveBeenCalledWith('access-token', {
      idempotencyKey: ORDER_KEY,
      addressId: HOME_ID,
      items: [
        { productId: LAMP_ID, quantity: 2 },
        { productId: MUG_ID, quantity: 1 },
      ],
      note: 'Call before delivery',
      expectedTotalMinor: 316_000,
    });
    expect(browser.cart).toBeUndefined();
    expect(cache.updateTag.mock.calls).toEqual([
      ['product:brass-table-lamp'],
      ['product:ceramic-mug'],
    ]);
  });

  it('treats a replay of the same checkout like a new order', async () => {
    browser.placeOrder.mockResolvedValue(placedOrder(false));

    await expect(placeOrderAction(idle, checkoutForm())).rejects.toMatchObject(
      redirectedTo('/account/orders/NZ100042/receipt?placed=1'),
    );
    expect(browser.cart).toBeUndefined();
  });

  it('leaves an empty note out', async () => {
    await expect(placeOrderAction(idle, checkoutForm({ note: '   ' }))).rejects.toMatchObject(
      redirectedTo('/account/orders/NZ100042/receipt?placed=1'),
    );
    expect(browser.placeOrder.mock.calls[0]?.[1].note).toBeUndefined();
  });

  it('sends an empty cart back to the cart page without calling the API', async () => {
    browser.cart = undefined;

    await expect(placeOrderAction(idle, checkoutForm())).rejects.toMatchObject(
      redirectedTo('/cart'),
    );
    expect(browser.placeOrder).not.toHaveBeenCalled();
  });
});

describe('placeOrderAction: refusing a form before any call', () => {
  it.each([
    ['a malformed key', { idempotencyKey: 'not-a-uuid' }],
    ['a malformed address', { addressId: 'home' }],
    ['a malformed total', { expectedTotalMinor: '12.5' }],
    ['a negative total', { expectedTotalMinor: '-1' }],
    ['a missing total', { expectedTotalMinor: '' }],
  ])('refuses %s', async (_label, fields) => {
    const result = await placeOrderAction(idle, checkoutForm(fields));

    expect(result.status).toBe('error');
    expect(result.message).toBe('This checkout page has expired. Reload the page and try again.');
    expect(browser.placeOrder).not.toHaveBeenCalled();
  });

  it('does not keep a malformed key for the retry', async () => {
    const result = await placeOrderAction(idle, checkoutForm({ idempotencyKey: 'x' }));
    expect(result.values?.idempotencyKey).toBeUndefined();
  });

  it('marks a note that is too long', async () => {
    const result = await placeOrderAction(idle, checkoutForm({ note: 'a'.repeat(501) }));

    expect(result.fieldErrors).toStrictEqual({ note: 'Keep the note under 500 characters.' });
    expect(result.values?.idempotencyKey).toBe(ORDER_KEY);
    expect(browser.placeOrder).not.toHaveBeenCalled();
  });

  it('reports an expired or cross-site form and keeps the key', async () => {
    browser.gate = 'untrusted';

    const result = await placeOrderAction(idle, checkoutForm());

    expect(result.message).toContain('This form has expired or did not come from Nilzora');
    expect(result.values).toStrictEqual({
      idempotencyKey: ORDER_KEY,
      addressId: HOME_ID,
      note: 'Call before delivery',
    });
    expect(browser.cart).toBe(`${LAMP_ID}:2,${MUG_ID}:1`);
  });

  it('sends a signed-out customer to sign in and back to checkout', async () => {
    browser.gate = 'signed_out';

    await expect(placeOrderAction(idle, checkoutForm())).rejects.toMatchObject(
      redirectedTo('/login?next=/checkout&session=expired'),
    );
  });
});

describe('placeOrderAction: when the outcome is unknown', () => {
  it.each([
    ['the session could not be checked', undefined],
    ['the network failed', apiError(0, 'network_error')],
    ['the call timed out', apiError(0, 'timeout')],
    ['the store was unavailable', apiError(503, 'service_unavailable')],
    ['the answer could not be read', apiError(201, 'invalid_response')],
    ['something unexpected was thrown', new Error('boom')],
  ])('asks for a retry with the same key when %s', async (_label, error) => {
    if (error === undefined) browser.gate = 'unavailable';
    else browser.placeOrder.mockRejectedValue(error);

    const result = await placeOrderAction(idle, checkoutForm());

    expect(result).toStrictEqual({
      status: 'error',
      message: NOT_CONFIRMED,
      values: { idempotencyKey: ORDER_KEY, addressId: HOME_ID, note: 'Call before delivery' },
    });
    // The cart stays until an order is confirmed.
    expect(browser.cart).toBe(`${LAMP_ID}:2,${MUG_ID}:1`);
    expect(cache.updateTag).not.toHaveBeenCalled();
  });

  it('sends the very same request again, then opens the order it placed', async () => {
    browser.placeOrder.mockRejectedValueOnce(apiError(503, 'service_unavailable'));

    await expect(placeOrderAction(idle, checkoutForm())).rejects.toMatchObject(
      redirectedTo('/account/orders/NZ100042/receipt?placed=1'),
    );

    // The retry is a replay of the same key, so it cannot become a second order.
    const [firstBody, secondBody] = browser.placeOrder.mock.calls.map(([, body]) => body);
    expect(secondBody).toStrictEqual(firstBody);
    expect(browser.cart).toBeUndefined();
  });

  it('gives up after three attempts instead of retrying forever', async () => {
    browser.placeOrder.mockRejectedValue(apiError(0, 'timeout'));

    const result = await placeOrderAction(idle, checkoutForm());

    expect(result.message).toBe(NOT_CONFIRMED);
    expect(browser.placeOrder).toHaveBeenCalledTimes(3);
  });

  it('opens the order the API named when only its read-back failed', async () => {
    browser.placeOrder.mockRejectedValue(
      apiError(503, 'order_confirmation_pending', { orderNumber: 'NZ100042' }),
    );

    // A refusal is final: the saved order is read by its own number, not re-sent.
    await expect(placeOrderAction(idle, checkoutForm())).rejects.toMatchObject(
      redirectedTo('/account/orders/NZ100042/receipt?placed=1'),
    );

    expect(browser.placeOrder).toHaveBeenCalledTimes(1);
    expect(browser.getOrder).toHaveBeenCalledExactlyOnceWith('access-token', 'NZ100042');
    expect(browser.cart).toBeUndefined();
  });

  it('asks the customer to check their orders when the named order cannot be read', async () => {
    browser.placeOrder.mockRejectedValue(
      apiError(503, 'order_confirmation_pending', { orderNumber: 'NZ100042' }),
    );
    browser.getOrder.mockRejectedValue(apiError(503, 'service_unavailable'));

    const result = await placeOrderAction(idle, checkoutForm());

    expect(result.message).toBe(NOT_CONFIRMED);
    // Still their order: the cart is kept so a reload lands back on a working checkout.
    expect(browser.cart).toBe(`${LAMP_ID}:2,${MUG_ID}:1`);
  });

  it('asks the customer to check their orders when the order number is missing', async () => {
    browser.placeOrder.mockRejectedValue(
      apiError(503, 'order_confirmation_pending', { orderNumber: '' }),
    );

    const result = await placeOrderAction(idle, checkoutForm());

    expect(result.message).toBe(NOT_CONFIRMED);
    expect(browser.getOrder).not.toHaveBeenCalled();
  });
});

describe('placeOrderAction: refusals', () => {
  it('tells the new total after a price change and re-renders the checkout', async () => {
    browser.placeOrder.mockRejectedValue(apiError(409, 'price_changed', { totalMinor: 322_500 }));

    const result = await placeOrderAction(idle, checkoutForm());

    expect(result.message).toBe(
      'The total has changed to ৳3,225 since you reviewed your order. Check the updated order, then place it again.',
    );
    expect(result.values?.idempotencyKey).toBe(ORDER_KEY);
    expect(cache.refresh).toHaveBeenCalledTimes(1);
  });

  it('still explains a price change that came without a total', async () => {
    browser.placeOrder.mockRejectedValue(apiError(409, 'price_changed', { totalMinor: -5 }));

    const result = await placeOrderAction(idle, checkoutForm());

    expect(result.message).toBe(
      'The total has changed since you reviewed your order. Check the updated order, then place it again.',
    );
  });

  it.each([
    ['insufficient_stock', 'stock'],
    ['product_unavailable', 'unavailable'],
    ['quantity_limit_exceeded', 'limit'],
    ['cart_invalid', 'invalid'],
    ['variant_required', 'options'],
    ['variant_invalid', 'options'],
  ])('sends %s back to the cart with an explanation', async (code, issue) => {
    browser.placeOrder.mockRejectedValue(
      apiError(409, code, { problems: [{ productId: LAMP_ID, problem: 'insufficient_stock' }] }),
    );

    await expect(placeOrderAction(idle, checkoutForm())).rejects.toMatchObject(
      redirectedTo(`/cart?issue=${issue}`),
    );
    expect(browser.cart).toBe(`${LAMP_ID}:2,${MUG_ID}:1`);
  });

  it('starts a fresh checkout after an idempotency conflict', async () => {
    browser.placeOrder.mockRejectedValue(apiError(409, 'idempotency_conflict'));

    const result = await placeOrderAction(idle, checkoutForm());

    expect(result.message).toContain('This checkout was already used for an order');
    // No key is echoed: the re-rendered page brings a new one.
    expect(result.values).toStrictEqual({ note: 'Call before delivery' });
    expect(cache.refresh).toHaveBeenCalledTimes(1);
  });

  it('re-renders the checkout when the address is gone', async () => {
    browser.placeOrder.mockRejectedValue(apiError(400, 'address_not_found'));

    const result = await placeOrderAction(idle, checkoutForm());

    expect(result.message).toBe(
      'This delivery address is no longer saved. Choose another address.',
    );
    expect(cache.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['delivery_unavailable', 409, 'Delivery is not available for this address yet.'],
    ['too_many_pending_orders', 409, 'You already have several orders waiting for confirmation.'],
    ['rate_limited', 429, 'Too many attempts. Wait a few minutes, then try again.'],
    ['account_suspended', 403, 'This account is suspended, so it cannot place orders.'],
    ['forbidden', 403, 'Your order could not be placed.'],
    ['validation_failed', 400, 'Your order could not be placed.'],
  ])('maps %s to a fixed message, keeping the key', async (code, status, message) => {
    browser.placeOrder.mockRejectedValue(apiError(status, code));

    const result = await placeOrderAction(idle, checkoutForm());

    expect(result.status).toBe('error');
    expect(result.message).toContain(message);
    expect(result.message).not.toContain('API says');
    expect(result.values?.idempotencyKey).toBe(ORDER_KEY);
    expect(browser.cart).toBe(`${LAMP_ID}:2,${MUG_ID}:1`);
  });

  it('marks the note when the API refuses it', async () => {
    browser.placeOrder.mockRejectedValue(
      apiError(400, 'validation_failed', {
        issues: [{ location: 'body', path: 'note', message: 'Too long' }],
      }),
    );

    const result = await placeOrderAction(idle, checkoutForm());

    expect(result.fieldErrors).toStrictEqual({ note: 'Keep the note under 500 characters.' });
  });

  it('logs refusals it does not expect, without personal data', async () => {
    browser.placeOrder.mockRejectedValue(apiError(418, 'teapot'));

    await placeOrderAction(idle, checkoutForm());

    expect(console.error).toHaveBeenCalledWith('[nilzora] order placement failed', {
      code: 'teapot',
      status: 418,
      requestId: 'req-test-1',
    });
  });
});
