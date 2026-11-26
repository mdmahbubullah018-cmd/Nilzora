import 'server-only';
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { ApiError } from '@nilzora/web-session';
import { session } from '@/lib/session';

/*
 * The server copy of the cart
 * ---------------------------
 * The cookie is still the customer's cart: it is what the cart and checkout pages read and
 * what the order is built from. This module mirrors each change to the API so a signed-in
 * cart follows the account to another device and so staff can see checkouts that were
 * genuinely started. Nothing here is authoritative: prices, stock and totals stay with the
 * quote and order functions, and every call is best effort, because a cart change must
 * never fail just because the mirror did.
 *
 * A signed-out visitor's cart is named by an opaque handle in its own HttpOnly cookie.
 * Holding the handle is the only way to reach that cart; it is folded into the account
 * cart on sign-in and then forgotten.
 */

/** The guest cart handle. Not a credential: it only names a cart of ids and quantities. */
export const GUEST_HANDLE_COOKIE = 'nz_cart_handle';

/** The checkout attempt this browser is in, so it can be converted once an order exists. */
export const CHECKOUT_COOKIE = 'nz_checkout';

const GUEST_HANDLE_MAX_AGE = 30 * 24 * 60 * 60;
const CHECKOUT_MAX_AGE = 2 * 24 * 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge,
  };
}

async function readUuid(name: string): Promise<string | undefined> {
  const store = await cookies();
  const value = store.get(name)?.value ?? '';
  return UUID.test(value) ? value : undefined;
}

/** The handle this browser already carries, or undefined when it has none (or a bad one). */
export function guestHandle(): Promise<string | undefined> {
  return readUuid(GUEST_HANDLE_COOKIE);
}

/**
 * The handle to use for a write, minting one when the browser has none. Only Server
 * Actions and Route Handlers may set cookies, so this is never called while rendering.
 */
async function ensureGuestHandle(): Promise<string> {
  const existing = await guestHandle();
  if (existing !== undefined) return existing;
  const handle = randomUUID();
  const store = await cookies();
  store.set(GUEST_HANDLE_COOKIE, handle, cookieOptions(GUEST_HANDLE_MAX_AGE));
  return handle;
}

/** Drops the handle once its cart has been folded into an account. */
export async function forgetGuestHandle(): Promise<void> {
  const store = await cookies();
  store.delete(GUEST_HANDLE_COOKIE);
}

function lineOf(entry: { productId: string; variantId?: string }, quantity: number) {
  return { productId: entry.productId, variantId: entry.variantId ?? null, quantity };
}

/**
 * Mirrors one line change. A signed-in visitor writes to their own cart; a guest writes to
 * the cart its handle names. An unknown handle is refused, which is the signal to create
 * the guest cart once and send the line again.
 */
export async function mirrorLine(
  entry: { productId: string; variantId?: string },
  quantity: number,
): Promise<void> {
  const line = lineOf(entry, quantity);
  try {
    const state = await session.getSession();
    if (state.status === 'signed_in') {
      await session.read((api, accessToken) => api.setCartItem(accessToken, line));
      return;
    }
    const api = await session.api();
    const handle = await ensureGuestHandle();
    try {
      await api.setGuestCartItem({ ...line, token: handle });
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'cart_guest_token_invalid') throw error;
      await api.startGuestCart(handle);
      await api.setGuestCartItem({ ...line, token: handle });
    }
  } catch (error) {
    reportMirrorFailure('line', error);
  }
}

/**
 * Folds this browser's guest cart into the signed-in account's cart, then forgets the
 * handle. Called after a successful sign-in, so a cart filled beforehand is not lost.
 * A failure leaves the cookie cart untouched: the customer can still check out.
 */
export async function mergeGuestCartOnSignIn(): Promise<void> {
  try {
    const handle = await guestHandle();
    if (handle === undefined) return;
    const state = await session.getSession();
    if (state.status !== 'signed_in') return;
    await session.read((api, accessToken) => api.mergeGuestCart(accessToken, handle));
    await forgetGuestHandle();
  } catch (error) {
    reportMirrorFailure('merge', error);
  }
}

/**
 * Records that checkout genuinely started for this cart, and remembers the attempt so it
 * can be converted later. Repeating it only refreshes the same attempt, so a page refresh
 * or a changed address never creates a second one.
 */
export async function recordCheckoutStart(input: {
  addressId?: string;
  couponCode?: string;
}): Promise<void> {
  try {
    const state = await session.getSession();
    if (state.status !== 'signed_in') return;
    const started = await session.read((api, accessToken) => api.startCheckout(accessToken, input));
    if (started.kind !== 'ok') return;
    const store = await cookies();
    store.set(CHECKOUT_COOKIE, started.value.checkout.id, cookieOptions(CHECKOUT_MAX_AGE));
  } catch (error) {
    reportMirrorFailure('checkout start', error);
  }
}

/**
 * Marks the remembered attempt converted. Only ever called after the API answered with an
 * order, so a refused or failed checkout never converts; the order number it names is
 * looked up against the caller's own orders, so it cannot convert someone else's.
 */
export async function recordCheckoutConverted(orderNumber: string): Promise<void> {
  try {
    const attempt = await readUuid(CHECKOUT_COOKIE);
    if (attempt === undefined) return;
    const state = await session.getSession();
    if (state.status !== 'signed_in') return;
    await session.read((api, accessToken) =>
      api.checkoutConverted(accessToken, attempt, orderNumber),
    );
    const store = await cookies();
    store.delete(CHECKOUT_COOKIE);
  } catch (error) {
    reportMirrorFailure('checkout conversion', error);
  }
}

/** A mirror failure is never shown to the customer and never carries a token or handle. */
function reportMirrorFailure(step: string, error: unknown): void {
  console.error('[nilzora] the saved cart could not be updated', {
    step,
    ...(error instanceof ApiError ? { code: error.code, status: error.status } : {}),
  });
}
