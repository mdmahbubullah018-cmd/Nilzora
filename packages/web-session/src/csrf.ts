import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookieNames, cookieOptions, type CookieJar } from './cookies';
import type { WebSessionConfig } from './config';

/**
 * CSRF protection for cookie-authenticated form posts (signed double-submit):
 *
 *   1. A random value lives in an HttpOnly, SameSite=Lax cookie set by this server.
 *   2. Forms carry HMAC(SESSION_SECRET, cookie value), rendered by the server.
 *   3. Every state-changing post must come from this app's exact Origin and carry a
 *      token matching its own cookie.
 *
 * Another site cannot read the cookie or the page, cannot compute the HMAC without the
 * server secret, and its posts carry its own Origin.
 */

export const CSRF_FIELD = 'csrf_token';

export function newCsrfSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function csrfTokenFor(
  config: Pick<WebSessionConfig, 'app' | 'sessionSecret'>,
  cookieValue: string,
): string {
  return createHmac('sha256', config.sessionSecret)
    .update(`nilzora-csrf:${config.app}:${cookieValue}`)
    .digest('base64url');
}

export function verifyCsrfToken(
  config: Pick<WebSessionConfig, 'app' | 'sessionSecret'>,
  cookieValue: string | undefined,
  submitted: unknown,
): boolean {
  if (!cookieValue || typeof submitted !== 'string' || submitted.length > 128) return false;
  const expected = Buffer.from(csrfTokenFor(config, cookieValue));
  const actual = Buffer.from(submitted);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Requires the browser to state this app's exact origin. A missing Origin is refused
 * (current browsers always send one with POST), and so is any cross-site fetch.
 */
export function isSameOriginRequest(
  headers: Pick<Headers, 'get'>,
  config: Pick<WebSessionConfig, 'appOrigin'>,
): boolean {
  const fetchSite = headers.get('sec-fetch-site');
  if (fetchSite !== null && fetchSite !== 'same-origin') return false;
  return headers.get('origin') === config.appOrigin;
}

/** Issues a fresh CSRF cookie, e.g. after sign-in and sign-out. Returns the new value. */
export function rotateCsrfCookie(
  jar: CookieJar,
  config: Pick<WebSessionConfig, 'app' | 'production'>,
): string {
  const value = newCsrfSecret();
  jar.set(cookieNames(config).csrf, value, cookieOptions(config));
  return value;
}
