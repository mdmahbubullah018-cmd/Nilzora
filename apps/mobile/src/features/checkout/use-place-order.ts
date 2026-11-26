import {
  orderConfirmationPendingDetailsSchema,
  type CartItem,
  type OrderDetail,
  type OrderResponse,
  type PlaceOrderRequest,
  type PlaceOrderResponse,
} from '@nilzora/contracts';
import { ApiError } from '@nilzora/api-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { useSignedInUserId } from '@/auth/session-context';
import { CART_STORAGE_KEY, lineKey, serializeCart, useCart } from '@/cart';
import { useCartSync } from '@/cart/cart-sync-bridge';
import { queryKeys, useAuthorizedApi } from '@/query';
import { beginAttempt, settleAttempt } from './idempotency';
import {
  earlierOrderCancelled,
  interpretOrderError,
  outcomeUnknown,
  type OrderFailure,
} from './order-failure';

export interface PlaceOrderInput {
  addressId: string;
  items: readonly CartItem[];
  /** The customer's note; blank is left out. */
  note: string;
  /** The total the customer reviewed, from the latest checkout quote. The API compares it. */
  expectedTotalMinor: number;
  /** The coupon the quote applied; the order transaction prices it again. */
  couponCode?: string | undefined;
}

/**
 * `placed`: a new order was saved. `already_placed`: the API replayed an order saved
 * earlier under the same key (a retry after a lost answer, or after the app was killed).
 */
export type SavedKind = 'placed' | 'already_placed';

export type PlaceOrderResult =
  { ok: true; kind: SavedKind; order: OrderDetail } | { ok: false; failure: OrderFailure };

export interface PlaceOrderCallbacks {
  /** Runs right before the cart is cleared, so a screen can switch to its "placed" view first. */
  onSaved?: (kind: SavedKind, order: OrderDetail) => void;
}

/** The prefix of every cached cart quote (the cart screen's prices). */
const CART_QUOTES = queryKeys.cart.quote([]).slice(0, 2);

/** The first request and two safe replays of exactly the same one. */
const PLACE_ATTEMPTS = 3;
/** Waits between attempts: brief, so a slow answer is not followed by a long stare. */
const RETRY_DELAYS_MS = [250, 900];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Whether sending the very same request again could settle this one. A refusal (wrong total,
 * no stock, a used key) is final; a missing answer or a server error may hide a saved order.
 * An order the API names but could not read back is settled by reading it, not by replaying it.
 */
function mayRepeat(error: unknown): boolean {
  if (error instanceof ApiError && error.code === 'order_confirmation_pending') return false;
  return outcomeUnknown(error);
}

/** The order number the API named when it saved the order but could not read it back. */
function namedOrderNumber(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== 'order_confirmation_pending') return null;
  const details = orderConfirmationPendingDetailsSchema.safeParse(error.details);
  return details.success ? details.data.orderNumber : null;
}

/**
 * Sends the order, and sends the very same one again when the answer does not arrive. The
 * key makes a repeat a replay — the API answers with the order it already has — so a retry
 * can never become a second order. A refusal is final and stops at once; when every attempt
 * is still unanswered, `recover` gets the last error and may settle it another way (by
 * reading the order the API named). Whatever is left is thrown to the caller as before.
 */
async function placeUntilAnswered(
  send: () => Promise<PlaceOrderResponse>,
  recover: (error: unknown) => Promise<{ order: OrderDetail; created: boolean } | null>,
): Promise<{ order: OrderDetail; created: boolean }> {
  let lastError: unknown;
  for (let round = 0; round < PLACE_ATTEMPTS; round += 1) {
    if (round > 0) await wait(RETRY_DELAYS_MS[round - 1] ?? 900);
    try {
      return await send();
    } catch (error) {
      lastError = error;
      if (!mayRepeat(error)) break;
    }
  }
  const recovered = await recover(lastError);
  if (recovered !== null) return recovered;
  throw lastError;
}

/**
 * Writes the cart left after an order to the cart's own storage and waits for it. The cart
 * store saves on its own a moment after `removeMany()`, but the attempt record may only be
 * dropped once the remaining cart is safely on the device: if the app were killed in between,
 * a cart that still holds the ordered lines would mint a new key and could place them twice.
 * Lines the order did not take are written back exactly as they were.
 */
async function persistCartAfterOrder(remaining: readonly CartItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CART_STORAGE_KEY, serializeCart(remaining));
  } catch {
    console.warn('[nilzora] the cart could not be saved on this device');
  }
}

/**
 * Places the Cash-on-Delivery order. The idempotency key and the double-tap guard live
 * here, so no screen can get either wrong:
 *
 * - one attempt at a time: a second call while one runs returns null and sends nothing;
 * - the key (see idempotency.ts) is saved to the device before the order is sent, reused
 *   after anything that leaves the outcome unknown (including a restart), and replaced only
 *   once the answer is definitive;
 * - a lost answer is not a failure: the very same request is sent again (a replay the API
 *   answers with the order it already has), and an order the API saved but could not read
 *   back is read by its own number. Only when both fail does the customer hear "we could not
 *   confirm";
 * - the total sent is the one the customer reviewed; the API compares it, never uses it.
 *
 * When the order is saved the hook finishes the job whether or not the screen is still
 * there: it puts the returned order into the cache (so the order page shows it even if the
 * next request fails), refreshes the lists, empties the cart and waits until the empty cart
 * is stored, and only then forgets the key. Opening the order page is the screen's job.
 * A replay of an earlier order that was cancelled leaves the cart alone.
 *
 * It resolves instead of throwing: `ok: true` with the order, or `ok: false` with what the
 * customer should be told (see order-failure.ts).
 */
export function usePlaceOrder() {
  const run = useAuthorizedApi();
  const checkoutSync = useCartSync();
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();
  const { removeMany, items: cartItems } = useCart();
  const inFlight = useRef(false);
  const [placing, setPlacing] = useState(false);

  const place = useCallback(
    async (
      input: PlaceOrderInput,
      callbacks: PlaceOrderCallbacks = {},
    ): Promise<PlaceOrderResult | null> => {
      // A ref, not state: two taps in the same frame both see the first one running.
      if (userId === null || inFlight.current) return null;
      inFlight.current = true;
      setPlacing(true);
      try {
        const note = input.note.trim();
        // The variant travels with the product: the API prices and reserves that combination.
        const items = input.items.map(({ productId, variantId, quantity }) =>
          variantId ? { productId, variantId, quantity } : { productId, quantity },
        );
        const attempt = await beginAttempt(userId, { addressId: input.addressId, items, note });
        // Recorded before the order is sent, so a checkout that never completes is still a
        // genuine attempt; it only refreshes the same attempt if one is already open.
        await checkoutSync?.startCheckout({
          addressId: input.addressId,
          ...(input.couponCode === undefined ? {} : { couponCode: input.couponCode }),
        });
        const request: PlaceOrderRequest = {
          idempotencyKey: attempt.key,
          addressId: input.addressId,
          items,
          ...(note === '' ? {} : { note }),
          expectedTotalMinor: input.expectedTotalMinor,
          ...(input.couponCode === undefined ? {} : { couponCode: input.couponCode }),
        };
        const send = () => run((api, token) => api.placeOrder(token, request));

        const { order, created } = await placeUntilAnswered(send, async (error) => {
          // The API saved the order and only its read-back failed: it named the order, so
          // reading that order by its own number settles the checkout without ordering again.
          const orderNumber = namedOrderNumber(error);
          if (orderNumber === null) return null;
          try {
            const read = await run((api, token) => api.getOrder(token, orderNumber));
            return { order: read.order, created: true };
          } catch {
            return null;
          }
        });

        // The order exists: show it at once on its page, and bring the lists up to date.
        const detail: OrderResponse = { order };
        queryClient.setQueryData(queryKeys.orders.detail(userId, order.orderNumber), detail);
        void queryClient.invalidateQueries({ queryKey: queryKeys.orders.all(userId) });
        // Stock has moved behind every product page and listing.
        void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.all });

        if (!created && order.status === 'cancelled') {
          // The key belonged to an earlier order that was cancelled: nothing new was placed,
          // and the cart still holds what the customer wanted.
          await settleAttempt(userId);
          return { ok: false, failure: earlierOrderCancelled() };
        }

        const kind: SavedKind = created ? 'placed' : 'already_placed';
        callbacks.onSaved?.(kind, order);
        // The order exists, so the attempt converts; a failed or refused checkout never does.
        await checkoutSync?.convertCheckout(order.orderNumber);
        // Only the lines this order took leave the cart: anything the customer kept — including
        // everything they had deselected — stays exactly where it was.
        const ordered = new Set(input.items.map((item) => lineKey(item)));
        const remaining = cartItems.filter((item) => !ordered.has(lineKey(item)));
        removeMany(input.items);
        await persistCartAfterOrder(remaining);
        await settleAttempt(userId);
        return { ok: true, kind, order };
      } catch (error) {
        const failure = interpretOrderError(error);
        if (!failure.keepKey) await settleAttempt(userId);
        if (failure.refresh !== 'none') {
          void queryClient.invalidateQueries({ queryKey: [...queryKeys.user(userId), 'checkout'] });
          void queryClient.invalidateQueries({ queryKey: CART_QUOTES });
        }
        if (failure.refresh === 'addresses') {
          void queryClient.invalidateQueries({ queryKey: queryKeys.addresses.all(userId) });
        }
        if (failure.refresh === 'store') {
          // The store's payment switch is what refused the order, so re-read it: the checkout
          // then shows its "temporarily unavailable" state instead of the same button again.
          void queryClient.invalidateQueries({ queryKey: queryKeys.site.storeProfile() });
        }
        return { ok: false, failure };
      } finally {
        inFlight.current = false;
        setPlacing(false);
      }
    },
    [checkoutSync, cartItems, queryClient, removeMany, run, userId],
  );

  return { place, placing };
}
