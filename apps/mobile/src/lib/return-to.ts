import type { Href } from 'expo-router';

/*
 * Return-to paths
 * ---------------
 * After signing in or registering, the customer goes back to where they were. The path
 * arrives as a route parameter, which anything that can open the app (a deep link, another
 * app) can set, so it is treated as untrusted input: it is accepted only when it is exactly
 * one of this app's own screens (an allow-list), and never as a URL. Everything else yields
 * null and the caller falls back to its default destination. Sign-in and registration are
 * not on the list, so a return trip can never loop back into them.
 */

const MAX_LENGTH = 200;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** Every screen a customer may be sent back to. Anchored; no query string or fragment. */
const ALLOWED: readonly RegExp[] = [
  /^\/$/,
  /^\/(?:shop|cart|orders|account|profile|payment|settings|returns|checkout|addresses|support)$/,
  /^\/addresses\/new$/,
  new RegExp(`^/addresses/${UUID}$`, 'i'),
  /^\/order\/NZ\d{6,12}$/,
  /^\/product\/[a-z0-9]+(?:-[a-z0-9]+)*$/,
];

/**
 * Characters and sequences that turn a path into something else: a scheme or host
 * (":", "//", backslash, "@"), a query or fragment ("?", "#"), encoded tricks ("%"), traversal
 * ("..") and whitespace or control characters. Refused up front, before the allow-list.
 */
const FORBIDDEN = /[\\:@?#%\s]|\/\/|\.\./;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * Returns `value` when it is a safe internal path from the allow-list, otherwise null.
 * Accepts the raw route parameter (`string | string[] | undefined`); a repeated parameter
 * (an array) is ambiguous and refused.
 */
export function parseReturnTo(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > MAX_LENGTH) return null;
  if (!value.startsWith('/') || FORBIDDEN.test(value) || hasControlCharacter(value)) return null;
  return ALLOWED.some((pattern) => pattern.test(value)) ? value : null;
}

type AuthRoute =
  '/sign-in' | '/register' | '/verify-email' | '/forgot-password' | '/reset-password';

/**
 * The href of an authentication screen, carrying a validated return path and, where the
 * screen needs it, the address the email was sent to. An unusable `returnTo` is left out,
 * so the screen falls back to its default.
 */
export function authHref(route: AuthRoute, returnTo: unknown, email?: string): Href {
  const safe = parseReturnTo(returnTo);
  const params: Record<string, string> = {};
  if (safe !== null) params.returnTo = safe;
  if (typeof email === 'string' && email.length > 0) params.email = email;
  // The typed route list is generated from app/ by Expo Router; each route here is a file.
  return Object.keys(params).length === 0 ? route : { pathname: route, params };
}
