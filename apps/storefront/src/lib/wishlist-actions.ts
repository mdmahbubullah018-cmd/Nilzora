'use server';

import { wishlistResponseSchema, type WishlistItem } from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { ApiError, type ApiClient } from '@nilzora/web-session';
import { session } from '@/lib/session';

/*
 * The signed-in customer's wishlist, as the storefront changes it.
 *
 * Every call runs through session.act(), which checks this app's Origin and CSRF token before
 * any API call, so a request built by a client component still cannot be replayed from another
 * site. The API decides whose list it is from the session: no account id is ever sent, and a
 * refusal comes back as one of the fixed messages below, never as the API's own text.
 */

export interface WishlistAnswer {
  ok: boolean;
  items: WishlistItem[];
  message?: string;
}

const SESSION_ENDED = 'Your session has ended. Sign in again to keep your wishlist.';
const UNAVAILABLE = 'Nilzora could not reach your wishlist. Please try again.';
const GENERIC = 'That could not be saved to your wishlist. Please try again.';
const STALE = 'This page is out of date. Reload it and try again.';

const MESSAGES: Record<string, string> = {
  not_found: 'This product is no longer available to save.',
  forbidden: 'This account cannot change its wishlist right now.',
  rate_limited: 'Too many changes in a short time. Wait a moment, then try again.',
};

const EMPTY: WishlistItem[] = [];

function failure(message: string): WishlistAnswer {
  return { ok: false, items: EMPTY, message };
}

function fromError(error: unknown): WishlistAnswer {
  if (error instanceof ApiError) {
    if (error.status === 401) return failure(SESSION_ENDED);
    if (error.status === 0 || error.status >= 500) return failure(UNAVAILABLE);
    const known = MESSAGES[error.code];
    if (known !== undefined) return failure(known);
  }
  return failure(GENERIC);
}

/** Turns the session's outcome into the single answer the browser sees. */
function settle(outcome: { kind: string; value?: unknown }): WishlistAnswer {
  if (outcome.kind === 'ok') return outcome.value as WishlistAnswer;
  if (outcome.kind === 'untrusted') return failure(STALE);
  if (outcome.kind === 'signed_out') return failure(SESSION_ENDED);
  return failure(UNAVAILABLE);
}

/** Saves a product, or removes it when `intent` says so. Answers the list as it now is. */
export async function setWishlistItemAction(formData: FormData): Promise<WishlistAnswer> {
  const productId = uuidSchema.safeParse(formData.get('productId'));
  if (!productId.success) return failure('Choose a product first.');
  const removing = formData.get('intent') === 'remove';

  try {
    const outcome = await session.act(formData, async (api: ApiClient, accessToken: string) => {
      const list = removing
        ? await api.removeFromWishlist(accessToken, productId.data)
        : await api.addToWishlist(accessToken, productId.data);
      return { ok: true, items: wishlistResponseSchema.parse(list).items } satisfies WishlistAnswer;
    });
    return settle(outcome);
  } catch (error) {
    return fromError(error);
  }
}

/**
 * Folds the products a visitor saved before signing in into the account. Idempotent: the
 * database skips anything already saved, so a second run after a refresh adds nothing.
 */
export async function mergeWishlistAction(formData: FormData): Promise<WishlistAnswer> {
  const submitted = formData.get('slugs');
  const slugs = (typeof submitted === 'string' ? submitted : '')
    .split('\n')
    .map((slug) => slug.trim())
    .filter((slug) => slug !== '')
    .slice(0, 200);
  if (slugs.length === 0) return { ok: true, items: EMPTY };

  try {
    const outcome = await session.act(formData, async (api: ApiClient, accessToken: string) => {
      const list = await api.mergeWishlist(accessToken, slugs);
      return { ok: true, items: wishlistResponseSchema.parse(list).items } satisfies WishlistAnswer;
    });
    return settle(outcome);
  } catch (error) {
    return fromError(error);
  }
}
