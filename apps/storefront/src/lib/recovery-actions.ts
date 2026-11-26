'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ApiError } from '@nilzora/web-session';
import { parseCart, serializeCart, type CartEntry } from '@/lib/cart';
import { session } from '@/lib/session';

/*
 * Opening a recovery link restores that customer's cart into their own, then sends them to
 * checkout. Two things the browser cannot influence decide whether it works: the token is the
 * capability, and the database refuses unless the signed-in account owns that checkout.
 *
 * The API writes the customer's saved cart; the storefront's cart is the cookie one, so the
 * restored lines are merged into that too — otherwise the customer would land on an empty cart.
 */

export interface RecoveryAnswer {
  ok: boolean;
  message?: string;
  /** How many lines were put back, for the confirmation line. */
  restoredLines?: number;
}

const tokenSchema = z.string().trim().regex(/^[0-9a-f]{64}$/i);

const SESSION_ENDED = 'Your session has ended. Sign in again to restore your cart.';
const UNAVAILABLE = 'Nilzora could not reach your cart. Please try again.';
const LINK_GONE = 'This recovery link has expired or has already been used.';
const STALE = 'This page is out of date. Reload it and try again.';

const MESSAGES: Record<string, string> = {
  recovery_link_invalid: LINK_GONE,
  cart_invalid: LINK_GONE,
  forbidden: 'That recovery link belongs to another customer.',
  not_found: LINK_GONE,
  rate_limited: 'Too many tries in a short time. Wait a moment, then try again.',
};

/** Adds the restored lines to the browser's cart, keeping any line already in it. */
async function mergeIntoCart(lines: readonly CartEntry[]): Promise<void> {
  if (lines.length === 0) return;
  const key = (entry: CartEntry) => `${entry.productId}:${entry.variantId ?? ''}`;
  const merged = new Map<string, CartEntry>();
  for (const entry of parseCart(await session.cartCookie.get())) merged.set(key(entry), entry);
  for (const line of lines) {
    const existing = merged.get(key(line));
    merged.set(key(line), {
      ...line,
      quantity: Math.min(100, (existing?.quantity ?? 0) + line.quantity),
    });
  }
  await session.cartCookie.set(serializeCart([...merged.values()]));
}

/** Puts the saved lines back into the signed-in customer's cart. */
export async function restoreRecoveryAction(formData: FormData): Promise<RecoveryAnswer> {
  const raw = formData.get('token');
  const parsed = tokenSchema.safeParse(typeof raw === 'string' ? raw : '');
  if (!parsed.success) return { ok: false, message: STALE };

  try {
    const outcome = await session.act(formData, (api, accessToken) =>
      api.restoreCheckoutRecovery(accessToken, parsed.data),
    );
    if (outcome.kind === 'signed_out') return { ok: false, message: SESSION_ENDED };
    if (outcome.kind === 'untrusted') return { ok: false, message: STALE };
    if (outcome.kind === 'unavailable') return { ok: false, message: UNAVAILABLE };
    await mergeIntoCart(
      outcome.value.lines.map((line) => ({
        productId: line.productId,
        // The cookie cart omits a variant rather than storing null.
        ...(line.variantId === null ? {} : { variantId: line.variantId }),
        quantity: line.quantity,
      })),
    );
    revalidatePath('/cart');
    revalidatePath('/checkout');
    return { ok: true, restoredLines: outcome.value.restoredLines };
  } catch (error) {
    if (!(error instanceof ApiError)) {
      console.error('[nilzora] cart recovery failed unexpectedly');
      return { ok: false, message: UNAVAILABLE };
    }
    if (error.status >= 500) {
      console.error('[nilzora] cart recovery failed', {
        code: error.code,
        status: error.status,
        requestId: error.requestId,
      });
      return { ok: false, message: UNAVAILABLE };
    }
    return { ok: false, message: MESSAGES[error.code] ?? LINK_GONE };
  }
}
