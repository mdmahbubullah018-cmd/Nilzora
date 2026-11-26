import { ApiError } from '@nilzora/api-client';
import {
  orderResponseSchema,
  type OrderDetail,
  type PlaceOrderRequest,
  type PlaceOrderResponse,
} from '@nilzora/contracts';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { randomUUID } from 'expo-crypto';
import { AccessibilityInfo, BackHandler } from 'react-native';
import OrderRoute from '../../app/order/[orderNumber]';
import { CART_STORAGE_KEY, lineKey, serializeCart } from '../cart';
import {
  ATTEMPT_MAX_AGE_MS,
  ATTEMPT_STORAGE_PREFIX,
  beginAttempt,
  fingerprintOrder,
  hasUnresolvedAttempt,
  settleAttempt,
  simulateRestart,
} from '../features/checkout/idempotency';
import { PLACED_MESSAGE } from '../features/orders/order-detail';
import { CheckoutScreen } from '../features/checkout/checkout-screen';
import { queryKeys } from '../query';
import { fakeStoreProfile } from '../test-utils/api-fakes';
import { createMemoryCartStorage, PRODUCT_A, PRODUCT_B } from '../test-utils/cart-fakes';
import {
  ADDRESS_HOME_ID,
  CHECKOUT_ITEMS,
  checkoutQuote,
  createCheckoutApi,
  LAMP,
  MUG,
  orderDetail,
  renderCommerce,
  resetCheckoutAttempts,
} from '../test-utils/checkout-fakes';
import { resetRouterMock, router, searchParams } from '../test-utils/expo-router-mock';
import { isLeavingBlocked, leaveGuard, resetLeaveGuard } from '../test-utils/leave-guard-mock';
import { CUSTOMER } from '../test-utils/session-fakes';

jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('@/test-utils/expo-router-mock'),
  ...jest.requireActual<{ leaveGuardMock: object }>('@/test-utils/leave-guard-mock').leaveGuardMock,
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));

const USER_ID = CUSTOMER.user.id;
const ATTEMPT_KEY = `${ATTEMPT_STORAGE_PREFIX}${USER_ID}`;
const HOUR = 60 * 60 * 1000;

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

const PLACE_HOME = 'Place order, total 2,260 taka';
const SUCCESS: PlaceOrderResponse = { order: orderDetail('NZ100042'), created: true };

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

const placeButton = () => screen.getByRole('button', { name: /^Place order/ });

describe('the line selection', () => {
  it('orders only the selected lines and leaves the rest in the cart', async () => {
    const { api, cartStore, cartStorage } = await openCheckout();
    // The customer keeps the lamp for later: deselecting it must not remove it.
    await act(() => {
      cartStore.setSelected(lineKey({ productId: PRODUCT_B }), false);
    });
    await screen.findByRole('button', { name: PLACE_HOME });

    await fireEvent.press(placeButton());
    await waitFor(() => {
      expect(api.placeOrder).toHaveBeenCalledTimes(1);
    });

    // Only the selected line reaches the server; the API still prices and validates it.
    expect(request(api).items).toEqual([{ productId: PRODUCT_A, quantity: 2 }]);
    // And only that line leaves the cart: the lamp is still saved on the device.
    await waitFor(() => {
      const saved = cartStorage.read(CART_STORAGE_KEY);
      expect(saved).toBe(serializeCart([{ productId: PRODUCT_B, quantity: 1 }]));
    });
    expect(cartStore.getSnapshot().items).toEqual([{ productId: PRODUCT_B, quantity: 1 }]);
  });
});

function request(api: ReturnType<typeof createCheckoutApi>, call = 0): PlaceOrderRequest {
  const args = api.placeOrder.mock.calls[call];
  if (!args) throw new Error(`placeOrder was not called ${call + 1} times`);
  return args[1];
}

/** Writes an attempt record the way the app does, with the given age. */
async function saveAttempt(overrides: Record<string, unknown> = {}, ageMs = HOUR) {
  await AsyncStorage.setItem(
    ATTEMPT_KEY,
    JSON.stringify({
      v: 1,
      key: key(77),
      fingerprint: '1:00000000000000',
      startedAt: Date.now() - ageMs,
      ...overrides,
    }),
  );
}

async function storedAttempt(): Promise<Record<string, unknown> | null> {
  const raw = await AsyncStorage.getItem(ATTEMPT_KEY);
  return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
}

describe('the attempt record', () => {
  const order = { addressId: ADDRESS_HOME_ID, items: CHECKOUT_ITEMS, note: '' };

  it('is saved on the device before the order is sent, without the text of the note', async () => {
    const api = createCheckoutApi();
    let seenWhenSent: string | null = null;
    api.placeOrder.mockImplementation(async () => {
      seenWhenSent = await AsyncStorage.getItem(ATTEMPT_KEY);
      return SUCCESS;
    });
    const { user } = await openCheckout(api);
    await user.type(screen.getByLabelText('Note for the order'), 'Ring 01712345678');

    await user.press(placeButton());

    await waitFor(() => {
      expect(api.placeOrder).toHaveBeenCalledTimes(1);
    });
    const record = JSON.parse(String(seenWhenSent)) as Record<string, unknown>;
    expect(Object.keys(record).sort()).toEqual(['fingerprint', 'key', 'startedAt', 'v']);
    expect(record.v).toBe(1);
    expect(record.key).toBe(key(1));
    expect(record.fingerprint).toMatch(/^2:[0-9a-f]{14}$/);
    expect(typeof record.startedAt).toBe('number');
    // Only a hash of the note is stored, never the note itself or a number in it.
    expect(String(seenWhenSent)).not.toContain('Ring');
    expect(String(seenWhenSent)).not.toContain('01712345678');
  });

  it('is kept after an unknown outcome and removed once the order is saved', async () => {
    const api = createCheckoutApi();
    // Every attempt is unanswered, so the outcome stays unknown (a single failure is replayed).
    api.placeOrder.mockRejectedValue(new ApiError(0, 'network_error', 'offline'));
    const { user } = await openCheckout(api);

    await user.press(placeButton());
    await screen.findByText('We could not confirm your order', {}, PATIENCE);
    expect(await storedAttempt()).toMatchObject({ key: key(1) });

    api.placeOrder.mockReset();
    api.placeOrder.mockResolvedValue({ order: orderDetail(), created: true });
    await user.press(placeButton());
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalled();
    });
    expect(await storedAttempt()).toBeNull();
  });

  it.each([
    ['price_changed', new ApiError(409, 'price_changed', 'x')],
    ['insufficient_stock', new ApiError(409, 'insufficient_stock', 'x')],
    ['rate_limited', new ApiError(429, 'rate_limited', 'x')],
  ])('is removed after a definitive refusal (%s)', async (_code, error) => {
    const api = createCheckoutApi();
    api.placeOrder.mockRejectedValueOnce(error);
    const { user } = await openCheckout(api);

    await user.press(placeButton());

    await waitFor(async () => {
      expect(await storedAttempt()).toBeNull();
    });
  });

  it('empties the stored cart and removes the record before the order page opens, in that order', async () => {
    const { user } = await openCheckout();
    const setItem = jest.mocked(AsyncStorage.setItem);
    const removeItem = jest.mocked(AsyncStorage.removeItem);
    setItem.mockClear();
    removeItem.mockClear();

    await user.press(placeButton());
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledTimes(1);
    });

    const emptiedAt = setItem.mock.calls.findIndex(
      ([storageKey, value]) => storageKey === CART_STORAGE_KEY && value === serializeCart([]),
    );
    const removedAt = removeItem.mock.calls.findIndex(([storageKey]) => storageKey === ATTEMPT_KEY);
    expect(emptiedAt).toBeGreaterThanOrEqual(0);
    expect(removedAt).toBeGreaterThanOrEqual(0);
    const emptied = setItem.mock.invocationCallOrder[emptiedAt] ?? Infinity;
    const removed = removeItem.mock.invocationCallOrder[removedAt] ?? Infinity;
    const navigated = router.replace.mock.invocationCallOrder[0] ?? 0;
    // Dropping the record first would let a kill in between place the order twice.
    expect(emptied).toBeLessThan(removed);
    expect(removed).toBeLessThan(navigated);
  });

  describe('fingerprintOrder', () => {
    it('is the same for the same order, whatever the order of the lines', () => {
      const reversed = { ...order, items: [...CHECKOUT_ITEMS].reverse() };

      expect(fingerprintOrder(reversed)).toBe(fingerprintOrder(order));
      expect(fingerprintOrder({ ...order, addressId: ADDRESS_HOME_ID.toUpperCase() })).toBe(
        fingerprintOrder(order),
      );
      expect(fingerprintOrder({ ...order, note: '  ' })).toBe(fingerprintOrder(order));
    });

    it('differs when the address, a quantity, a product or the note differs', () => {
      const base = fingerprintOrder(order);

      expect(fingerprintOrder({ ...order, addressId: key(5) })).not.toBe(base);
      expect(
        fingerprintOrder({
          ...order,
          items: [{ productId: PRODUCT_A, quantity: 3 }, CHECKOUT_ITEMS[1]!],
        }),
      ).not.toBe(base);
      expect(fingerprintOrder({ ...order, items: [CHECKOUT_ITEMS[0]!] })).not.toBe(base);
      expect(fingerprintOrder({ ...order, note: 'Ring twice' })).not.toBe(base);
    });

    it('differs when only the variant of a line changes', () => {
      // The same product in another size is another order: a resumed key must not answer
      // for the earlier basket, and the API would call the two different details anyway.
      const base = fingerprintOrder(order);
      const variant = key(9);

      expect(
        fingerprintOrder({
          ...order,
          items: [{ productId: PRODUCT_A, variantId: variant, quantity: 2 }, CHECKOUT_ITEMS[1]!],
        }),
      ).not.toBe(base);
      // Two lines of the same product with different variants are not the same order either.
      expect(
        fingerprintOrder({
          ...order,
          items: [
            { productId: PRODUCT_A, variantId: key(9), quantity: 1 },
            { productId: PRODUCT_A, variantId: key(10), quantity: 1 },
          ],
        }),
      ).not.toBe(
        fingerprintOrder({
          ...order,
          items: [
            { productId: PRODUCT_A, variantId: key(9), quantity: 1 },
            { productId: PRODUCT_A, variantId: key(9), quantity: 1 },
          ],
        }),
      );
    });

    it('does not contain the note', () => {
      expect(fingerprintOrder({ ...order, note: 'Ring twice' })).toMatch(/^2:[0-9a-f]{14}$/);
    });
  });

  describe('beginAttempt', () => {
    it('makes and saves a key, then resumes it for the same order', async () => {
      const first = await beginAttempt(USER_ID, order);
      const again = await beginAttempt(USER_ID, order);

      expect(first).toEqual({ key: key(1), resumed: false, sameOrder: true });
      expect(again).toEqual({ key: key(1), resumed: true, sameOrder: true });
      expect(generated).toBe(1);
    });

    it('resumes the saved key after a restart, even for a changed order', async () => {
      await beginAttempt(USER_ID, order);
      simulateRestart();

      const same = await beginAttempt(USER_ID, order);
      simulateRestart();
      const changed = await beginAttempt(USER_ID, { ...order, note: 'Ring twice' });

      expect(same).toEqual({ key: key(1), resumed: true, sameOrder: true });
      expect(changed).toEqual({ key: key(1), resumed: true, sameOrder: false });
      expect(generated).toBe(1);
    });

    it('keeps each account’s attempt apart', async () => {
      await beginAttempt(USER_ID, order);
      const other = await beginAttempt('99999999-8888-4777-8666-555555555555', order);

      expect(other).toMatchObject({ key: key(2), resumed: false });
    });

    it('starts a new key after the attempt was settled', async () => {
      await beginAttempt(USER_ID, order);
      await settleAttempt(USER_ID);
      expect(await hasUnresolvedAttempt(USER_ID)).toBe(false);
      simulateRestart();

      expect(await beginAttempt(USER_ID, order)).toMatchObject({ key: key(2), resumed: false });
    });

    it('forgets an attempt older than 12 hours, and keeps one just under it', async () => {
      await saveAttempt({}, ATTEMPT_MAX_AGE_MS + 60_000);
      expect(await beginAttempt(USER_ID, order)).toMatchObject({ key: key(1), resumed: false });

      await resetCheckoutAttempts();
      await saveAttempt({}, ATTEMPT_MAX_AGE_MS - 60_000);
      expect(await beginAttempt(USER_ID, order)).toMatchObject({ key: key(77), resumed: true });
    });

    it.each([
      ['text that is not JSON', 'not json at all'],
      [
        'a key that is not a uuid',
        JSON.stringify({ v: 1, key: 'nope', fingerprint: '1:ab', startedAt: Date.now() }),
      ],
      [
        'an unknown format version',
        JSON.stringify({ v: 2, key: key(77), fingerprint: '1:ab', startedAt: Date.now() }),
      ],
      ['a missing start time', JSON.stringify({ v: 1, key: key(77), fingerprint: '1:ab' })],
      [
        'a start time far in the future',
        JSON.stringify({
          v: 1,
          key: key(77),
          fingerprint: '1:ab',
          startedAt: Date.now() + 24 * HOUR,
        }),
      ],
      ['a record far too large', 'x'.repeat(5_000)],
    ])('ignores a saved record with %s', async (_name, raw) => {
      await AsyncStorage.setItem(ATTEMPT_KEY, raw);

      expect(await beginAttempt(USER_ID, order)).toMatchObject({ key: key(1), resumed: false });
      expect(await storedAttempt()).toMatchObject({ key: key(1) });
    });

    it('goes on with a new key when the storage cannot be read', async () => {
      jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk error'));

      expect(await beginAttempt(USER_ID, order)).toMatchObject({ key: key(1), resumed: false });
    });

    it('goes on, and keeps the key for this run, when the storage cannot be written', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));

      const first = await beginAttempt(USER_ID, order);
      const again = await beginAttempt(USER_ID, order);

      expect(first.key).toBe(key(1));
      expect(again).toEqual({ key: key(1), resumed: true, sameOrder: true });
      expect(warn).toHaveBeenCalledWith(
        '[nilzora] the checkout attempt could not be saved on this device',
      );
      // Nothing sensitive is logged.
      expect(JSON.stringify(warn.mock.calls)).not.toContain(key(1));
      warn.mockRestore();
    });
  });
});

describe('the app is killed while the order is on its way', () => {
  it('does not place a second order after the restart', async () => {
    // A fake server that saves an order per key, and answers a repeat with the original.
    const saved = new Map<string, OrderDetail>();
    const api = createCheckoutApi();
    let sent = 0;
    api.placeOrder.mockImplementation((_token, body) => {
      const known = saved.get(body.idempotencyKey);
      if (known) return Promise.resolve({ order: known, created: false });
      const order = orderDetail(`NZ10000${saved.size + 1}`);
      saved.set(body.idempotencyKey, order);
      sent += 1;
      // The server committed; the app is killed before the answer arrives.
      if (sent === 1) return new Promise<PlaceOrderResponse>(() => undefined);
      return Promise.resolve({ order, created: true });
    });
    const cartStorage = createMemoryCartStorage();

    const before = await openCheckout(api, { cartStorage });
    await before.user.press(placeButton());
    await waitFor(() => {
      expect(api.placeOrder).toHaveBeenCalledTimes(1);
    });
    await before.cartStore.flush();
    await before.unmount();
    simulateRestart();

    // The next launch: the cart is read back from the device, still full.
    const after = await openCheckout(api, { cartStorage, cart: undefined });
    expect(after.cartStore.getSnapshot().items).toEqual(CHECKOUT_ITEMS);
    await after.user.press(placeButton());

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/order-success/[orderNumber]',
        params: { orderNumber: 'NZ100001' },
      });
    });
    expect(request(api, 1).idempotencyKey).toBe(request(api, 0).idempotencyKey);
    expect(generated).toBe(1);
    expect(saved.size).toBe(1);
    // The order that already existed is opened, and the customer is told so.
    expect(screen.getByText('Already placed')).toBeOnTheScreen();
    expect(
      screen.getByText('This order was already placed. Opening its confirmation…'),
    ).toBeOnTheScreen();
    expect(after.cartStore.getSnapshot().count).toBe(0);
    expect(await storedAttempt()).toBeNull();
    expect(await AsyncStorage.getItem(CART_STORAGE_KEY)).toBe(serializeCart([]));
  });

  it('keeps the key when the customer changed the order before retrying, so the API decides', async () => {
    const api = createCheckoutApi();
    // Every attempt is unanswered, so the record survives with its key.
    api.placeOrder.mockRejectedValue(new ApiError(0, 'timeout', 'slow'));
    const cartStorage = createMemoryCartStorage();
    const before = await openCheckout(api, { cartStorage });
    await before.user.press(placeButton());
    await screen.findByText('We could not confirm your order', {}, PATIENCE);
    await before.unmount();
    simulateRestart();

    // A quantity was lowered since.
    api.placeOrder.mockReset();
    api.placeOrder.mockResolvedValue({ order: orderDetail(), created: true });
    const after = await renderCommerce(<CheckoutScreen />, {
      api,
      cartStorage,
      cart: [
        { productId: PRODUCT_A, quantity: 1 },
        { productId: PRODUCT_B, quantity: 1 },
      ],
    });
    await after.user.press(await screen.findByRole('button', { name: /^Place order/ }));

    expect(request(api).idempotencyKey).toBe(key(1));
    expect(generated).toBe(1);
  });

  it('starts with a new key when the saved attempt is too old', async () => {
    await saveAttempt({}, 13 * HOUR);
    const { user, api } = await openCheckout();

    await user.press(placeButton());

    expect(request(api).idempotencyKey).toBe(key(1));
  });

  it('resumes a recent saved attempt with its own key', async () => {
    await saveAttempt({}, 2 * HOUR);
    const { user, api } = await openCheckout();

    await user.press(placeButton());

    expect(request(api).idempotencyKey).toBe(key(77));
    expect(generated).toBe(0);
  });

  it('still sends the order when the attempt cannot be saved, and reuses its key for a retry', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const api = createCheckoutApi();
    // Every attempt is unanswered, so the key is only kept in memory for this run.
    api.placeOrder.mockRejectedValue(new ApiError(0, 'network_error', 'offline'));
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
    const { user } = await openCheckout(api);

    await user.press(placeButton());
    await screen.findByText('We could not confirm your order', {}, PATIENCE);

    api.placeOrder.mockReset();
    api.placeOrder.mockResolvedValue({ order: orderDetail(), created: true });
    await user.press(placeButton());

    expect(api.placeOrder).toHaveBeenCalledTimes(1);
    expect(request(api).idempotencyKey).toBe(key(1));
    warn.mockRestore();
  });
});

describe('leaving checkout while the order is on its way', () => {
  it('blocks every way out until the answer arrives, then allows leaving to open the order', async () => {
    const api = createCheckoutApi();
    const pending = deferred<PlaceOrderResponse>();
    api.placeOrder.mockReturnValueOnce(pending.promise);
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const { user } = await openCheckout(api);
    expect(isLeavingBlocked()).toBe(false);
    expect(leaveGuard.stackOptions.at(-1)).toEqual({
      gestureEnabled: true,
      headerBackVisible: true,
    });

    await user.press(placeButton());

    expect(isLeavingBlocked()).toBe(true);
    // No swipe and no header back arrow either.
    expect(leaveGuard.stackOptions.at(-1)).toEqual({
      gestureEnabled: false,
      headerBackVisible: false,
    });
    expect(placeButton()).toBeDisabled();
    expect(screen.getByText('Placing your order. Please wait.')).toBeOnTheScreen();
    // Trying to leave (hardware back, say) says why it did not work.
    leaveGuard.onBlocked?.();
    expect(announce).toHaveBeenCalledWith('Your order is being placed. Please wait a moment.');

    pending.resolve(SUCCESS);
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledTimes(1);
    });
    // Leaving is allowed explicitly before the order page opens (the flag clears a render later).
    expect(leaveGuard.disablePrevention).toHaveBeenCalledTimes(1);
    expect(leaveGuard.disablePrevention.mock.invocationCallOrder[0]).toBeLessThan(
      router.replace.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('swallows the Android back button while the order is on its way, and only then', async () => {
    const remove = jest.fn();
    const listen = jest.spyOn(BackHandler, 'addEventListener').mockReturnValue({ remove });
    const api = createCheckoutApi();
    const pending = deferred<PlaceOrderResponse>();
    api.placeOrder.mockReturnValueOnce(pending.promise);
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const { user } = await openCheckout(api);
    expect(listen).not.toHaveBeenCalled();

    await user.press(placeButton());

    expect(listen).toHaveBeenCalledWith('hardwareBackPress', expect.any(Function));
    const handler = listen.mock.calls[0]?.[1];
    // Returning true means "handled": the app does not go back.
    expect(handler?.(undefined as never)).toBe(true);
    expect(announce).toHaveBeenCalledWith('Your order is being placed. Please wait a moment.');

    pending.resolve(SUCCESS);
    await waitFor(() => {
      expect(remove).toHaveBeenCalled();
    });
  });

  it('lets the customer leave again after a refused order', async () => {
    const api = createCheckoutApi();
    api.placeOrder.mockRejectedValueOnce(new ApiError(429, 'rate_limited', 'x'));
    const { user } = await openCheckout(api);

    await user.press(placeButton());
    await screen.findByText('Too many requests');

    expect(isLeavingBlocked()).toBe(false);
    expect(leaveGuard.stackOptions.at(-1)).toEqual({
      gestureEnabled: true,
      headerBackVisible: true,
    });
    expect(leaveGuard.disablePrevention).not.toHaveBeenCalled();
  });

  it('finishes an order whose screen is gone, but does not navigate from it', async () => {
    const api = createCheckoutApi();
    const pending = deferred<PlaceOrderResponse>();
    api.placeOrder.mockReturnValueOnce(pending.promise);
    const { user, unmount, cartStore, queryClient } = await openCheckout(api);
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    await user.press(placeButton());
    await unmount();

    await act(async () => {
      pending.resolve(SUCCESS);
      await pending.promise;
    });

    // The order exists, so its cart is emptied, the lists are refreshed and the key is let go...
    await waitFor(() => {
      expect(cartStore.getSnapshot().count).toBe(0);
    });
    await waitFor(async () => {
      expect(await hasUnresolvedAttempt(USER_ID)).toBe(false);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.orders.all(USER_ID) });
    expect(queryClient.getQueryData(queryKeys.orders.detail(USER_ID, 'NZ100042'))).toEqual({
      order: SUCCESS.order,
    });
    // ...but nothing is opened from a screen that is no longer there.
    expect(router.replace).not.toHaveBeenCalled();
    expect(leaveGuard.disablePrevention).not.toHaveBeenCalled();
  });

  it('leaves the cart alone when the screen is gone and the replayed order was cancelled', async () => {
    const api = createCheckoutApi();
    const pending = deferred<PlaceOrderResponse>();
    api.placeOrder.mockReturnValueOnce(pending.promise);
    const { user, unmount, cartStore } = await openCheckout(api);
    await user.press(placeButton());
    await unmount();

    await act(async () => {
      pending.resolve({
        order: { ...orderDetail('NZ100009'), status: 'cancelled' },
        created: false,
      });
      await pending.promise;
    });

    await waitFor(async () => {
      expect(await hasUnresolvedAttempt(USER_ID)).toBe(false);
    });
    expect(cartStore.getSnapshot().count).toBe(3);
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('the order page has the order before it asks for it', () => {
  it('puts the order in the cache in the shape getOrder returns', async () => {
    const { user, queryClient } = await openCheckout();

    await user.press(placeButton());

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalled();
    });
    const cached = queryClient.getQueryData(queryKeys.orders.detail(USER_ID, 'NZ100042'));
    expect(orderResponseSchema.safeParse(cached).success).toBe(true);
    expect(cached).toEqual({ order: SUCCESS.order });
  });

  it('shows the "Order placed" banner even when the follow-up request fails', async () => {
    const api = createCheckoutApi();
    api.getOrder.mockRejectedValue(new ApiError(0, 'network_error', 'offline'));
    const { user, unmount, queryClient, cartStore, manager } = await openCheckout(api);
    await user.press(placeButton());
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalled();
    });
    await unmount();

    searchParams.orderNumber = 'NZ100042';
    searchParams.placed = '1';
    await renderCommerce(<OrderRoute />, { api, queryClient, cart: cartStore, session: manager });

    expect(await screen.findByText(PLACED_MESSAGE)).toBeOnTheScreen();
    expect(screen.getByText('Blue mug')).toBeOnTheScreen();
  });
});

describe('an order that was already saved under the same key', () => {
  it('tells the customer it was already placed, empties the cart and opens it', async () => {
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
    expect(
      screen.getByText('This order was already placed. Opening its confirmation…'),
    ).toBeOnTheScreen();
    expect(cartStore.getSnapshot().count).toBe(0);
    expect(await hasUnresolvedAttempt(USER_ID)).toBe(false);
  });

  it('keeps the cart and says so when that earlier order was cancelled', async () => {
    const api = createCheckoutApi();
    api.placeOrder
      .mockResolvedValueOnce({
        order: { ...orderDetail('NZ100007'), status: 'cancelled', canCancel: false },
        created: false,
      })
      .mockResolvedValueOnce({ order: orderDetail('NZ100008'), created: true });
    const { user, cartStore } = await openCheckout(api);

    await user.press(placeButton());

    expect(
      await screen.findByText(
        'That earlier order was cancelled. Place the order again to reorder.',
      ),
    ).toBeOnTheScreen();
    expect(cartStore.getSnapshot().items).toEqual(CHECKOUT_ITEMS);
    expect(router.replace).not.toHaveBeenCalled();
    expect(isLeavingBlocked()).toBe(false);
    // The key is let go, so reordering is a new order with a new key.
    expect(await hasUnresolvedAttempt(USER_ID)).toBe(false);
    await user.press(placeButton());
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/order-success/[orderNumber]',
        params: { orderNumber: 'NZ100008' },
      });
    });
    expect(request(api, 0).idempotencyKey).toBe(key(1));
    expect(request(api, 1).idempotencyKey).toBe(key(2));
    expect(cartStore.getSnapshot().count).toBe(0);
  });
});

describe('the store switches cash on delivery off while the customer is checking out', () => {
  it('says nothing was charged, keeps the cart, and closes checkout', async () => {
    const api = createCheckoutApi({ codAvailable: true });
    const { user, cartStore } = await openCheckout(api);
    // The switch is flipped on the server after the page was loaded: the next answer from the
    // public profile reports it off, which is what the refusal below is caused by.
    api.publicStoreProfile.mockResolvedValue({ profile: fakeStoreProfile({ codAvailable: false }) });
    api.placeOrder.mockRejectedValue(
      new ApiError(409, 'payment_unavailable', 'cash on delivery is switched off'),
    );

    await user.press(placeButton());

    expect(await screen.findByText('Your order was not placed')).toBeOnTheScreen();
    expect(screen.getByText(/Nothing was charged/)).toBeOnTheScreen();
    // The re-read of the store profile closes checkout: the button stays, and says why.
    await waitFor(() => {
      expect(placeButton()).toBeDisabled();
    });
    expect(
      screen.getByText('Checkout is closed: cash on delivery is switched off right now.'),
    ).toBeOnTheScreen();
    expect(api.placeOrder).toHaveBeenCalledTimes(1);
    expect(cartStore.getSnapshot().items).toEqual(CHECKOUT_ITEMS);
  });
});

describe('prices that could not be refreshed', () => {
  it('says so, offers a retry and keeps the order closed until they are fresh', async () => {
    const api = createCheckoutApi();
    const { user, queryClient } = await openCheckout(api);
    api.quoteCheckout.mockRejectedValue(new ApiError(0, 'network_error', 'offline'));

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: [...queryKeys.user(USER_ID), 'checkout'] });
    });

    expect(
      await screen.findByText('Could not update prices. Try again to continue.'),
    ).toBeOnTheScreen();
    expect(screen.queryByText('Updating prices…')).not.toBeOnTheScreen();
    expect(screen.queryByText('Updating…')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Place order' })).toBeDisabled();
    await user.press(screen.getByRole('button', { name: 'Place order' }));
    expect(api.placeOrder).not.toHaveBeenCalled();

    api.quoteCheckout.mockResolvedValue({ quote: checkoutQuote([MUG, LAMP]) });
    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: PLACE_HOME })).toBeEnabled();
    expect(
      screen.queryByText('Could not update prices. Try again to continue.'),
    ).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeOnTheScreen();
  });
});

describe('the Place order button', () => {
  it('shows the amount with the taka sign but is spoken in words', async () => {
    await openCheckout();

    const button = placeButton();
    expect(screen.getByText('Place order · ৳2,260')).toBeOnTheScreen();
    expect(button.props.accessibilityLabel).toBe('Place order, total 2,260 taka');
    expect(button.props.accessibilityLabel).not.toContain('৳');
    expect(button.props.accessibilityHint).toBe('Paid in cash on delivery');
  });
});
