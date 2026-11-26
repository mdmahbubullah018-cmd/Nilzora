import { ApiError } from '@nilzora/api-client';
import type { PlaceOrderRequest, PlaceOrderResponse } from '@nilzora/contracts';
import { act, screen, waitFor } from '@testing-library/react-native';
import { randomUUID } from 'expo-crypto';
import CheckoutRoute from '../../app/checkout';
import { SessionEndedError } from '../auth/session-manager';
import { CheckoutScreen } from '../features/checkout/checkout-screen';
import { hasUnresolvedAttempt } from '../features/checkout/idempotency';
import { usePlaceOrder } from '../features/checkout/use-place-order';
import { queryKeys } from '../query';
import { PRODUCT_A, PRODUCT_B } from '../test-utils/cart-fakes';
import {
  ADDRESS_HOME_ID,
  ADDRESS_OFFICE_ID,
  cartLine,
  CHECKOUT_ITEMS,
  checkoutQuote,
  createCheckoutApi,
  createCommerceQueryClient,
  LAMP,
  MUG,
  orderDetail,
  renderCommerce,
  resetCheckoutAttempts,
} from '../test-utils/checkout-fakes';
import { resetRouterMock, router } from '../test-utils/expo-router-mock';
import { resetLeaveGuard } from '../test-utils/leave-guard-mock';
import { renderHookWithProviders } from '../test-utils/render-with-providers';
import {
  createControllableManager,
  CUSTOMER,
  FAKE_ACCESS_TOKEN,
  signedInState,
} from '../test-utils/session-fakes';

jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('@/test-utils/expo-router-mock'),
  ...jest.requireActual<{ leaveGuardMock: object }>('@/test-utils/leave-guard-mock').leaveGuardMock,
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));

const USER_ID = CUSTOMER.user.id;

/** The n-th key the app generates in a test. */
const key = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let generated = 0;

/** A lost answer is followed by two replays, so an outcome takes a moment to settle. */
const PATIENCE = { timeout: 5_000 };

beforeEach(async () => {
  resetRouterMock();
  resetLeaveGuard();
  await resetCheckoutAttempts();
  generated = 0;
  jest.mocked(randomUUID).mockImplementation(() => key(++generated));
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// What a screen reader says; the visible label is "Place order · ৳2,260".
const PLACE_HOME = 'Place order, total 2,260 taka';

/** Opens checkout for the sample cart and waits until the order can be placed. */
async function openCheckout(
  api = createCheckoutApi(),
  options: Parameters<typeof renderCommerce>[1] = {},
) {
  const harness = await renderCommerce(<CheckoutScreen />, {
    api,
    cart: CHECKOUT_ITEMS,
    ...options,
  });
  await screen.findByRole('button', { name: PLACE_HOME });
  return { ...harness, api };
}

/** The "Place order" button, whatever amount it currently shows. */
const placeButton = () => screen.getByRole('button', { name: /^Place order/ });

/** The request of the n-th placeOrder call (0-based), without the access token. */
function request(api: ReturnType<typeof createCheckoutApi>, call = 0): PlaceOrderRequest {
  const args = api.placeOrder.mock.calls[call];
  if (!args) throw new Error(`placeOrder was not called ${call + 1} times`);
  expect(args[0]).toBe(FAKE_ACCESS_TOKEN);
  return args[1];
}

/** The last request sent, whatever replays came before it. */
function lastRequest(api: ReturnType<typeof createCheckoutApi>): PlaceOrderRequest {
  const args = api.placeOrder.mock.calls.at(-1);
  if (!args) throw new Error('placeOrder was never called');
  expect(args[0]).toBe(FAKE_ACCESS_TOKEN);
  return args[1];
}

/** Rejects every attempt: the app answers a lost answer with two more of the same request. */
function noAnswer(api: ReturnType<typeof createCheckoutApi>, error: unknown): void {
  api.placeOrder.mockRejectedValue(error);
}

const SUCCESS: PlaceOrderResponse = { order: orderDetail('NZ100042'), created: true };

describe('placing the order: what is sent', () => {
  it('sends the address, product ids and quantities, a fresh key and the reviewed total, nothing priced', async () => {
    const { user, api } = await openCheckout();

    await user.press(placeButton());

    expect(api.placeOrder).toHaveBeenCalledTimes(1);
    const body = request(api);
    expect(body).toEqual({
      idempotencyKey: key(1),
      addressId: ADDRESS_HOME_ID,
      items: CHECKOUT_ITEMS,
      expectedTotalMinor: 226_000,
    });
    // No note when none was written, and no price, name or total of the device's making.
    expect(Object.keys(body).sort()).toEqual([
      'addressId',
      'expectedTotalMinor',
      'idempotencyKey',
      'items',
    ]);
  });

  it('takes expectedTotalMinor from the latest quote, not from anything the device adds up', async () => {
    const api = createCheckoutApi();
    // A total that is not the sum of its parts: the app must not "correct" it.
    api.quoteCheckout.mockResolvedValue({
      quote: checkoutQuote([MUG, LAMP], undefined, { totalMinor: 999_900 }),
    });
    const { user } = await renderCommerce(<CheckoutScreen />, { api, cart: CHECKOUT_ITEMS });

    await user.press(await screen.findByRole('button', { name: 'Place order, total 9,999 taka' }));

    expect(request(api).expectedTotalMinor).toBe(999_900);
  });

  it('sends the address and total of the address the customer chose', async () => {
    const { user, api } = await openCheckout();
    await user.press(screen.getByRole('button', { name: 'Change the delivery address' }));
    await user.press(screen.getByRole('radio', { name: 'Rahim Uddin, Kotbari, Cumilla' }));
    await user.press(await screen.findByRole('button', { name: 'Place order, total 2,320 taka' }));

    expect(request(api)).toMatchObject({
      addressId: ADDRESS_OFFICE_ID,
      expectedTotalMinor: 232_000,
    });
  });

  it('sends the note, trimmed', async () => {
    const { user, api } = await openCheckout();
    await user.type(screen.getByLabelText('Note for the order'), '  Call me after 5pm  ');

    await user.press(placeButton());

    expect(request(api).note).toBe('Call me after 5pm');
  });

  it('leaves a blank note out', async () => {
    const { user, api } = await openCheckout();
    await user.type(screen.getByLabelText('Note for the order'), '   ');

    await user.press(placeButton());

    expect(request(api)).not.toHaveProperty('note');
  });
});

describe('placing the order: one tap, one order', () => {
  it('sends a single request when the button is pressed again while the order is placed', async () => {
    const api = createCheckoutApi();
    const pending = deferred<PlaceOrderResponse>();
    api.placeOrder.mockReturnValueOnce(pending.promise);
    const { user } = await openCheckout(api);

    await user.press(placeButton());
    await user.press(placeButton());
    await user.press(placeButton());

    expect(api.placeOrder).toHaveBeenCalledTimes(1);
    expect(placeButton()).toBeDisabled();
  });

  it('places the order once and opens it, however many times it was tapped', async () => {
    const api = createCheckoutApi();
    const pending = deferred<PlaceOrderResponse>();
    api.placeOrder.mockReturnValueOnce(pending.promise);
    const { user } = await openCheckout(api);
    await user.press(placeButton());
    await user.press(placeButton());

    pending.resolve(SUCCESS);

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledTimes(1);
    });
    expect(api.placeOrder).toHaveBeenCalledTimes(1);
  });

  it('refuses a second attempt in code while one is running, not only in the interface', async () => {
    const api = createCheckoutApi();
    const pending = deferred<PlaceOrderResponse>();
    api.placeOrder.mockReturnValueOnce(pending.promise);
    const { result } = await renderHookWithProviders(() => usePlaceOrder(), {
      api,
      queryClient: createCommerceQueryClient(),
    });
    const input = {
      addressId: ADDRESS_HOME_ID,
      items: CHECKOUT_ITEMS,
      note: '',
      expectedTotalMinor: 226_000,
    };

    let first!: ReturnType<typeof result.current.place>;
    let second: Awaited<ReturnType<typeof result.current.place>> | undefined;
    await act(async () => {
      first = result.current.place(input);
      // The same tick: no render has happened in between.
      second = await result.current.place(input);
    });
    let outcome: Awaited<ReturnType<typeof result.current.place>> | undefined;
    await act(async () => {
      pending.resolve(SUCCESS);
      outcome = await first;
    });

    expect(second).toBeNull();
    expect(outcome).toMatchObject({ ok: true });
    expect(api.placeOrder).toHaveBeenCalledTimes(1);
    // Once it has finished, the guard is released.
    await act(() => result.current.place(input));
    expect(api.placeOrder).toHaveBeenCalledTimes(2);
  });
});

describe('placing the order: the idempotency key', () => {
  it.each([
    ['a lost connection', new ApiError(0, 'network_error', 'offline')],
    ['a timeout', new ApiError(0, 'timeout', 'slow')],
    ['a 503', new ApiError(503, 'service_unavailable', 'down')],
    ['a 500', new ApiError(500, 'internal_error', 'broken')],
    ['an unreadable answer', new ApiError(200, 'invalid_response', 'garbled')],
  ])('replays the same request once after %s, without asking again', async (_name, error) => {
    const api = createCheckoutApi();
    api.placeOrder.mockRejectedValueOnce(error);
    const { user } = await openCheckout(api);

    await user.press(placeButton());

    // The replay is the same key and body, which the API answers with the order it saved.
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledTimes(1);
    });
    expect(api.placeOrder).toHaveBeenCalledTimes(2);
    expect(request(api, 1)).toStrictEqual(request(api, 0));
    expect(generated).toBe(1);
    expect(screen.queryByText('We could not confirm your order')).not.toBeOnTheScreen();
  });

  it('replays after an unexpected failure that left the outcome unknown', async () => {
    const api = createCheckoutApi();
    api.placeOrder.mockRejectedValueOnce(new TypeError('boom'));
    const { user } = await openCheckout(api);

    await user.press(placeButton());

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledTimes(1);
    });
    expect(api.placeOrder).toHaveBeenCalledTimes(2);
    expect(request(api, 1).idempotencyKey).toBe(key(1));
  });

  it('gives up after three unanswered attempts and keeps the key', async () => {
    const api = createCheckoutApi();
    noAnswer(api, new ApiError(0, 'network_error', 'offline'));
    const { user } = await openCheckout(api);

    await user.press(placeButton());
    expect(
      await screen.findByText('We could not confirm your order', {}, PATIENCE),
    ).toBeOnTheScreen();

    expect(api.placeOrder).toHaveBeenCalledTimes(3);
    expect(new Set(api.placeOrder.mock.calls.map(([, body]) => body.idempotencyKey)).size).toBe(1);
    expect(await hasUnresolvedAttempt(USER_ID)).toBe(true);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('survives leaving checkout and coming back after an unknown outcome', async () => {
    const api = createCheckoutApi();
    noAnswer(api, new ApiError(0, 'network_error', 'offline'));
    const first = await openCheckout(api);
    await first.user.press(placeButton());
    await screen.findByText('We could not confirm your order', {}, PATIENCE);
    await first.unmount();

    api.placeOrder.mockReset();
    api.placeOrder.mockResolvedValue(SUCCESS);
    const second = await openCheckout(api, { cart: first.cartStore, session: first.manager });
    await second.user.press(placeButton());

    expect(lastRequest(api).idempotencyKey).toBe(key(1));
    expect(generated).toBe(1);
  });

  it('is kept when the customer edits the note after an unknown outcome, so the API can decide', async () => {
    const api = createCheckoutApi();
    noAnswer(api, new ApiError(0, 'timeout', 'slow'));
    const { user } = await openCheckout(api);
    await user.press(placeButton());
    await screen.findByText('We could not confirm your order', {}, PATIENCE);

    await user.type(screen.getByLabelText('Note for the order'), 'Leave at the gate');
    await user.press(placeButton());

    // A new key here could place the order twice if the first attempt had been saved.
    expect(lastRequest(api)).toMatchObject({ idempotencyKey: key(1), note: 'Leave at the gate' });
  });

  it('is kept per account: another account starts with its own key', async () => {
    const api = createCheckoutApi();
    noAnswer(api, new ApiError(0, 'network_error', 'offline'));
    const first = await openCheckout(api);
    await first.user.press(placeButton());
    await screen.findByText('We could not confirm your order', {}, PATIENCE);
    await first.unmount();

    const other = await openCheckout(api, {
      session: signedInState('99999999-8888-4777-8666-555555555555'),
    });
    await other.user.press(placeButton());

    expect(lastRequest(api).idempotencyKey).toBe(key(2));
  });

  it.each([
    [
      'the total changed',
      new ApiError(409, 'price_changed', 'x', undefined, { details: { totalMinor: 230_000 } }),
    ],
    ['stock ran out', new ApiError(409, 'insufficient_stock', 'x')],
    ['a product went', new ApiError(409, 'product_unavailable', 'x')],
    ['a limit was exceeded', new ApiError(409, 'quantity_limit_exceeded', 'x')],
    ['the cart was invalid', new ApiError(400, 'cart_invalid', 'x')],
    ['the address was gone', new ApiError(400, 'address_not_found', 'x')],
    ['delivery was unavailable', new ApiError(409, 'delivery_unavailable', 'x')],
    ['the key belonged to another order', new ApiError(409, 'idempotency_conflict', 'x')],
    ['too many orders were pending', new ApiError(409, 'too_many_pending_orders', 'x')],
    ['the requests were limited', new ApiError(429, 'rate_limited', 'x')],
    ['the request was invalid', new ApiError(400, 'validation_failed', 'x')],
  ])('is replaced after a definitive refusal: %s', async (_name, error) => {
    const api = createCheckoutApi();
    api.placeOrder.mockRejectedValueOnce(error);
    const { user } = await openCheckout(api);

    await user.press(placeButton());
    await waitFor(async () => {
      expect(await hasUnresolvedAttempt(USER_ID)).toBe(false);
    });
    // Wait for the refreshed prices, then try again.
    await waitFor(() => {
      expect(placeButton()).toBeEnabled();
    });
    await user.press(placeButton());

    expect(api.placeOrder).toHaveBeenCalledTimes(2);
    expect(request(api, 0).idempotencyKey).toBe(key(1));
    expect(request(api, 1).idempotencyKey).toBe(key(2));
  });

  it('is replaced after the order is placed', async () => {
    const { user } = await openCheckout();

    await user.press(placeButton());

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalled();
    });
    expect(await hasUnresolvedAttempt(USER_ID)).toBe(false);
  });
});

describe('placing the order: success', () => {
  it('clears the cart, refreshes the orders and opens the new order as just placed', async () => {
    const { user, cartStore, queryClient } = await openCheckout();
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');

    await user.press(placeButton());

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledTimes(1);
    });
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/order-success/[orderNumber]',
      params: { orderNumber: 'NZ100042' },
    });
    expect(cartStore.getSnapshot().items).toEqual([]);
    expect(cartStore.getSnapshot().count).toBe(0);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.orders.all(USER_ID) });
    // Until the order screen replaces checkout, the emptied cart is not shown as empty.
    expect(screen.getByText('Order placed')).toBeOnTheScreen();
    expect(screen.queryByText('Your cart is empty')).not.toBeOnTheScreen();
  });

  it('opens the original order when the API answers a repeated request with it', async () => {
    const api = createCheckoutApi();
    api.placeOrder.mockResolvedValue({ order: orderDetail('NZ100007'), created: false });
    const { user, cartStore } = await openCheckout(api);

    await user.press(placeButton());

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/order-success/[orderNumber]',
        params: { orderNumber: 'NZ100007' },
      });
    });
    expect(cartStore.getSnapshot().count).toBe(0);
  });

  it('keeps the cart and stays on checkout when the order is refused', async () => {
    const api = createCheckoutApi();
    api.placeOrder.mockRejectedValueOnce(new ApiError(429, 'rate_limited', 'slow down'));
    const { user, cartStore } = await openCheckout(api);

    await user.press(placeButton());

    expect(await screen.findByText('Too many requests')).toBeOnTheScreen();
    expect(cartStore.getSnapshot().count).toBe(3);
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('placing the order: every refusal is explained', () => {
  it.each([
    [
      new ApiError(409, 'price_changed', 'x', undefined, { details: { totalMinor: 230_000 } }),
      'The total has changed',
      'The total is now ৳2,300. Review the updated order, then place it again.',
    ],
    [
      new ApiError(409, 'price_changed', 'x'),
      'The total has changed',
      'Prices or delivery changed since you reviewed your order. Review the updated order, then place it again.',
    ],
    [
      new ApiError(409, 'insufficient_stock', 'x'),
      'Not enough stock',
      'Some items have fewer units left than you chose. Adjust your cart to continue.',
    ],
    [
      new ApiError(409, 'product_unavailable', 'x'),
      'An item is no longer available',
      'Remove the unavailable items from your cart to continue.',
    ],
    [
      new ApiError(409, 'quantity_limit_exceeded', 'x'),
      'Quantity limit reached',
      'Some items exceed the most you can order at once. Adjust your cart to continue.',
    ],
    [
      new ApiError(400, 'cart_invalid', 'x'),
      'Your cart cannot be ordered',
      'Check the items and quantities in your cart.',
    ],
    [
      new ApiError(400, 'address_not_found', 'x'),
      'Address not found',
      'This delivery address is no longer saved. Choose another address.',
    ],
    [
      new ApiError(409, 'delivery_unavailable', 'x'),
      'Delivery not available',
      'Delivery is not available for this address yet. Choose another address.',
    ],
    [
      new ApiError(429, 'rate_limited', 'x'),
      'Too many requests',
      'Please wait a minute before trying again.',
    ],
    [
      new ApiError(409, 'too_many_pending_orders', 'x'),
      'Too many orders waiting',
      'Wait until your current orders are confirmed before placing another.',
    ],
    [
      new ApiError(409, 'idempotency_conflict', 'x'),
      'This order was changed',
      'This checkout was already used for an order with different details. Check your orders first; placing the order again starts a fresh checkout.',
    ],
    [
      new ApiError(403, 'account_suspended', 'x'),
      'Account suspended',
      'This account is suspended. Contact Nilzora support for help.',
    ],
    [
      new ApiError(400, 'validation_failed', 'x'),
      'Your order could not be placed',
      'Check your details, then try again.',
    ],
    [
      new ApiError(418, 'something_new', 'internal detail that must not be shown'),
      'This could not be completed',
      'Check your details and try again.',
    ],
    [
      new ApiError(0, 'network_error', 'x'),
      'We could not confirm your order',
      'Your order may already be placed: check your orders first. Trying again from here will not create a second order.',
    ],
  ])('%#: %s', async (error, title, message) => {
    const api = createCheckoutApi();
    // Every attempt fails: a refusal stops at once, a lost answer is replayed and still lost.
    noAnswer(api, error);
    const { user } = await openCheckout(api);

    await user.press(placeButton());

    expect(await screen.findByText(title, {}, PATIENCE)).toBeOnTheScreen();
    expect(screen.getByText(message)).toBeOnTheScreen();
    expect(screen.queryByText(/internal detail/)).not.toBeOnTheScreen();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('offers a way to check the orders when the outcome is unknown, and keeps the button for the retry', async () => {
    const api = createCheckoutApi();
    noAnswer(api, new ApiError(0, 'network_error', 'offline'));
    const { user } = await openCheckout(api);

    await user.press(placeButton());
    await user.press(await screen.findByRole('button', { name: 'View my orders' }, PATIENCE));

    expect(router.navigate).toHaveBeenCalledWith('/orders');
    expect(placeButton()).toBeEnabled();
  });

  it('opens the order the API named when only its read-back failed', async () => {
    const api = createCheckoutApi();
    api.placeOrder.mockRejectedValue(
      new ApiError(503, 'order_confirmation_pending', 'x', undefined, {
        details: { orderNumber: 'NZ100042' },
      }),
    );
    api.getOrder.mockResolvedValue({ order: orderDetail('NZ100042') });
    const { user } = await openCheckout(api);

    await user.press(placeButton());

    // Reading the customer's own order settles it: no replay, no second order.
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledTimes(1);
    });
    expect(api.placeOrder).toHaveBeenCalledTimes(1);
    expect(api.getOrder).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN, 'NZ100042');
    expect(await hasUnresolvedAttempt(USER_ID)).toBe(false);
  });

  it('asks the customer to check their orders when the named order cannot be read', async () => {
    const api = createCheckoutApi();
    api.placeOrder.mockRejectedValue(
      new ApiError(503, 'order_confirmation_pending', 'x', undefined, {
        details: { orderNumber: 'NZ100042' },
      }),
    );
    api.getOrder.mockRejectedValue(new ApiError(503, 'service_unavailable', 'down'));
    const { user } = await openCheckout(api);

    await user.press(placeButton());

    expect(
      await screen.findByText('We could not confirm your order', {}, PATIENCE),
    ).toBeOnTheScreen();
    expect(router.replace).not.toHaveBeenCalled();
    expect(await hasUnresolvedAttempt(USER_ID)).toBe(true);
  });

  it('shows the new total after the price changed, and confirms that total next', async () => {
    const api = createCheckoutApi();
    api.placeOrder.mockRejectedValueOnce(
      new ApiError(409, 'price_changed', 'x', undefined, { details: { totalMinor: 230_000 } }),
    );
    const { user } = await openCheckout(api);
    // The refreshed quote carries the new delivery charge.
    api.quoteCheckout.mockResolvedValue({
      quote: checkoutQuote([MUG, LAMP], { zone: 'inside_dhaka', feeMinor: 10_000 }),
    });

    await user.press(placeButton());

    expect(
      await screen.findByRole('button', { name: 'Place order, total 2,300 taka' }),
    ).toBeEnabled();
    expect(
      screen.getByText('The total is now ৳2,300. Review the updated order, then place it again.'),
    ).toBeOnTheScreen();
    await user.press(placeButton());
    expect(request(api, 1)).toMatchObject({ expectedTotalMinor: 230_000, idempotencyKey: key(2) });
  });

  it('refreshes the prices and offers to fix the cart after a stock refusal', async () => {
    const api = createCheckoutApi();
    api.placeOrder.mockRejectedValueOnce(new ApiError(409, 'insufficient_stock', 'x'));
    const { user } = await openCheckout(api);
    const calls = api.quoteCheckout.mock.calls.length;
    api.quoteCheckout.mockResolvedValue({
      quote: checkoutQuote(
        [
          cartLine({
            productId: PRODUCT_A,
            quantity: 2,
            lineTotalMinor: 100_000,
            availableQuantity: 1,
            problem: 'insufficient_stock',
          }),
          { ...LAMP, productId: PRODUCT_B },
        ],
        undefined,
        { purchasable: false },
      ),
    });

    await user.press(placeButton());

    expect(await screen.findByRole('button', { name: 'Fix cart' })).toBeOnTheScreen();
    expect(api.quoteCheckout.mock.calls.length).toBeGreaterThan(calls);
    expect(screen.getByText('Not enough stock')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Place order' })).toBeDisabled();
  });

  it('reloads the addresses after the chosen address was not found', async () => {
    const api = createCheckoutApi();
    api.placeOrder.mockRejectedValueOnce(new ApiError(400, 'address_not_found', 'x'));
    const { user } = await openCheckout(api);
    const calls = api.listAddresses.mock.calls.length;

    await user.press(placeButton());

    await screen.findByText('Address not found');
    await waitFor(() => {
      expect(api.listAddresses.mock.calls.length).toBeGreaterThan(calls);
    });
  });

  it('puts a note the API rejected on the note field', async () => {
    const api = createCheckoutApi();
    api.placeOrder.mockRejectedValueOnce(
      new ApiError(400, 'validation_failed', 'x', undefined, {
        details: { issues: [{ location: 'body', path: 'note', message: 'too long' }] },
      }),
    );
    const { user } = await openCheckout(api);

    await user.press(placeButton());

    expect(await screen.findByText('Check your note')).toBeOnTheScreen();
    expect(screen.getAllByText('Keep the note under 500 characters.').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('alert', { name: 'Keep the note under 500 characters.' }),
    ).toBeOnTheScreen();
  });

  it('hands over to the sign-in prompt when the session ended while ordering', async () => {
    const manager = createControllableManager(signedInState());
    const api = createCheckoutApi();
    api.placeOrder.mockImplementation(() => {
      manager.setState({
        status: 'signed_out',
        notice: 'Your session has ended. Please sign in again.',
      });
      return Promise.reject(new SessionEndedError());
    });
    const { user } = await renderCommerce(<CheckoutRoute />, {
      api,
      session: manager,
      cart: CHECKOUT_ITEMS,
    });
    await user.press(await screen.findByRole('button', { name: PLACE_HOME }));

    expect(await screen.findByText('Sign in to Nilzora')).toBeOnTheScreen();
    expect(screen.getByText('Your session has ended. Please sign in again.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /Place order/ })).not.toBeOnTheScreen();
    // The order was refused before it could be saved: the next attempt gets a new key.
    expect(await hasUnresolvedAttempt(USER_ID)).toBe(false);
    await user.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/checkout' },
    });
  });
});

describe('placing the order: only a settled order can be confirmed', () => {
  it('cannot be placed while a line is out of stock', async () => {
    const api = createCheckoutApi();
    api.quoteCheckout.mockResolvedValue({
      quote: checkoutQuote(
        [
          cartLine({
            productId: PRODUCT_A,
            quantity: 2,
            lineTotalMinor: 100_000,
            availableQuantity: 0,
            problem: 'insufficient_stock',
          }),
          { ...LAMP, productId: PRODUCT_B },
        ],
        undefined,
        { purchasable: false },
      ),
    });
    const { user } = await renderCommerce(<CheckoutScreen />, { api, cart: CHECKOUT_ITEMS });

    await user.press(await screen.findByRole('button', { name: 'Place order' }));

    expect(screen.getByText(/Out of stock/)).toBeOnTheScreen();
    expect(api.placeOrder).not.toHaveBeenCalled();
  });
});
