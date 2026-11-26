import type { WebSessionConfig } from './config';
import { cookieNames, cookieOptions, type CookieJar } from './cookies';

/**
 * Storefront cart cookie
 * ----------------------
 * Keeps the cart (in whatever compact form the storefront encodes it) between visits.
 * It is not a credential and not trusted: the browser's owner can rewrite it, so the
 * storefront validates it on every read and the API checks, prices and limits every
 * line again when quoting and placing an order.
 *
 * It has the session cookies' attributes (HttpOnly, SameSite=Lax, Path=/, Secure with
 * the `__Host-` prefix in production) under its own app-scoped name. Next.js lets only
 * Server Actions and Route Handlers write cookies: setting or clearing it while a page
 * renders throws.
 */

/** How long an untouched cart is kept. Every write starts the period again. */
export const CART_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/**
 * Longest value accepted, counted as sent. Next.js URL-encodes cookie values, so any
 * character outside `A-Z a-z 0-9 - _ . ! ~ * ' ( )` takes three or more bytes, and
 * browsers silently drop a cookie larger than about 4096 bytes.
 */
export const CART_COOKIE_MAX_LENGTH = 3000;

export interface CartCookie {
  /** The stored value; empty and oversized values read as absent. */
  get(): Promise<string | undefined>;
  /**
   * Stores the value for CART_COOKIE_MAX_AGE. An empty value clears the cookie; a value
   * that does not fit (see cartCookieValueFits) is refused with a RangeError.
   */
  set(value: string): Promise<void>;
  clear(): Promise<void>;
}

/** Whether a value can be stored: within CART_COOKIE_MAX_LENGTH once URL-encoded. */
export function cartCookieValueFits(value: string): boolean {
  try {
    return encodeURIComponent(value).length <= CART_COOKIE_MAX_LENGTH;
  } catch {
    // Unpaired surrogates cannot be encoded at all.
    return false;
  }
}

export function readCartCookie(
  jar: Pick<CookieJar, 'get'>,
  config: Pick<WebSessionConfig, 'app' | 'production'>,
): string | undefined {
  const value = jar.get(cookieNames(config).cart);
  // A cleared cookie reads as an empty string; anything longer than this server ever
  // writes is not worth parsing.
  return value && value.length <= CART_COOKIE_MAX_LENGTH ? value : undefined;
}

export function writeCartCookie(
  jar: CookieJar,
  config: Pick<WebSessionConfig, 'app' | 'production'>,
  value: string,
): void {
  if (value === '') {
    clearCartCookie(jar, config);
    return;
  }
  if (!cartCookieValueFits(value)) {
    // The message never includes the value.
    throw new RangeError(
      `The cart cookie value must be at most ${CART_COOKIE_MAX_LENGTH} characters once URL-encoded.`,
    );
  }
  jar.set(cookieNames(config).cart, value, cookieOptions(config, CART_COOKIE_MAX_AGE));
}

/** Deletes the cookie with its original attributes, which `__Host-` cookies require. */
export function clearCartCookie(
  jar: CookieJar,
  config: Pick<WebSessionConfig, 'app' | 'production'>,
): void {
  jar.delete(cookieNames(config).cart, cookieOptions(config));
}
