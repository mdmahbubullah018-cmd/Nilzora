import type { ApiClient } from '@nilzora/api-client';
import { ApiError } from '@nilzora/api-client';
import { randomUUID } from 'expo-crypto';
import { lineKey, type CartItem } from './cart-items';
import type { CartStorage } from './cart-store';

/*
 * The server copy of the cart
 * ---------------------------
 * The device store is still the customer's cart: it is what the cart and checkout screens
 * show and what the order is built from. This module mirrors each change to the API so a
 * signed-in cart follows the account to another device and so staff can see checkouts that
 * were genuinely started. Nothing here is authoritative, and nothing here throws: a failed
 * mirror never blocks a cart change or an order.
 */

/** The guest cart handle. Not a credential: it only names a cart of ids and quantities. */
export const GUEST_HANDLE_KEY = 'nilzora.cart.handle.v1';

/** The checkout attempt this device is in, so it can be converted once an order exists. */
export const CHECKOUT_ATTEMPT_SYNC_KEY = 'nilzora.cart.checkout.v1';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CartSyncDeps {
  storage: CartStorage;
  /** The app's API client, or null in a build without one. */
  api: ApiClient | null;
  /** An authenticated call with a valid token; provided by the session manager. */
  authorized: <T>(call: (accessToken: string) => Promise<T>) => Promise<T>;
  /** Whether an account is signed in right now. */
  signedIn: () => boolean;
  /** Injectable for tests; defaults to expo-crypto's v4 UUID. */
  newHandle?: () => string;
}

export interface CartSync {
  /** Mirrors every line that changed between two cart snapshots. Never throws. */
  syncLines: (previous: readonly CartItem[], next: readonly CartItem[]) => Promise<void>;
  /** Folds this device's guest cart into the account cart, then forgets the handle. */
  mergeGuestCart: () => Promise<void>;
  /** Records that checkout genuinely started, and remembers the attempt. */
  startCheckout: (input: { addressId?: string; couponCode?: string }) => Promise<void>;
  /** Marks the remembered attempt converted. Only call it after an order exists. */
  convertCheckout: (orderNumber: string) => Promise<void>;
}

function lineOf(item: CartItem, quantity: number) {
  return {
    productId: item.productId,
    variantId: item.variantId ?? null,
    quantity,
  };
}

/** The lines whose quantity differs between two snapshots, including removed lines (0). */
export function changedLines(
  previous: readonly CartItem[],
  next: readonly CartItem[],
): { item: CartItem; quantity: number }[] {
  const before = new Map(previous.map((item) => [lineKey(item), item]));
  const after = new Map(next.map((item) => [lineKey(item), item]));
  const changes: { item: CartItem; quantity: number }[] = [];
  for (const [key, item] of after) {
    if (before.get(key)?.quantity !== item.quantity)
      changes.push({ item, quantity: item.quantity });
  }
  for (const [key, item] of before) {
    if (!after.has(key)) changes.push({ item, quantity: 0 });
  }
  return changes;
}

export function createCartSync({
  storage,
  api,
  authorized,
  signedIn,
  newHandle,
}: CartSyncDeps): CartSync {
  const mint = newHandle ?? (() => randomUUID());

  function report(step: string, error: unknown): void {
    console.warn(`[nilzora] the saved cart could not be updated (${step})`, {
      ...(error instanceof Error ? { name: error.name } : {}),
    });
  }

  async function readUuid(key: string): Promise<string | undefined> {
    try {
      const value = await storage.getItem(key);
      return value !== null && UUID.test(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  async function write(key: string, value: string): Promise<void> {
    try {
      await storage.setItem(key, value);
    } catch {
      report('save', new Error('storage write failed'));
    }
  }

  /** The handle to write with, minting one when this device has none. */
  async function guestHandle(): Promise<string> {
    const existing = await readUuid(GUEST_HANDLE_KEY);
    if (existing !== undefined) return existing;
    const handle = mint();
    await write(GUEST_HANDLE_KEY, handle);
    return handle;
  }

  /** Writes one line to the signed-in customer's cart, or to the guest cart for a visitor. */
  async function mirrorLine(item: CartItem, quantity: number): Promise<void> {
    const line = lineOf(item, quantity);
    if (signedIn()) {
      await authorized(async (token) => {
        await api?.setCartItem(token, line);
      });
      return;
    }
    if (api === null) return;
    const handle = await guestHandle();
    try {
      await api.setGuestCartItem({ ...line, token: handle });
    } catch (error) {
      // An unknown handle is the signal to create the guest cart once, then send the line.
      if (!(error instanceof ApiError) || error.code !== 'cart_guest_token_invalid') throw error;
      await api.startGuestCart(handle);
      await api.setGuestCartItem({ ...line, token: handle });
    }
  }

  return {
    async syncLines(previous, next) {
      if (api === null) return;
      for (const change of changedLines(previous, next)) {
        try {
          await mirrorLine(change.item, change.quantity);
        } catch (error) {
          report('line', error);
        }
      }
    },

    async mergeGuestCart() {
      try {
        const handle = await readUuid(GUEST_HANDLE_KEY);
        if (handle === undefined || !signedIn() || api === null) return;
        await authorized((token) => api.mergeGuestCart(token, handle));
        await storage.removeItem(GUEST_HANDLE_KEY);
      } catch (error) {
        report('merge', error);
      }
    },

    async startCheckout(input) {
      try {
        if (!signedIn() || api === null) return;
        const started = await authorized((token) => api.startCheckout(token, input));
        await write(CHECKOUT_ATTEMPT_SYNC_KEY, started.checkout.id);
      } catch (error) {
        report('checkout start', error);
      }
    },

    async convertCheckout(orderNumber) {
      try {
        const attempt = await readUuid(CHECKOUT_ATTEMPT_SYNC_KEY);
        if (attempt === undefined) return;
        if (signedIn() && api !== null) {
          await authorized((token) => api.checkoutConverted(token, attempt, orderNumber));
        }
        await storage.removeItem(CHECKOUT_ATTEMPT_SYNC_KEY);
      } catch (error) {
        report('checkout conversion', error);
      }
    },
  };
}
