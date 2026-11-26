import type { AuthSession } from '@nilzora/contracts';
import type { WebApp, WebSessionConfig } from './config';

/**
 * Session cookies
 * ---------------
 * The API issues bearer tokens; the web servers keep them in cookies that browser
 * scripts cannot read (HttpOnly), that only travel with same-site navigations and
 * same-origin posts (SameSite=Lax), and that are Secure with the `__Host-` prefix in
 * production (no Domain attribute, so a sibling subdomain cannot set or read them).
 *
 * Each app uses its own names: browsers do not separate cookies by port, so the local
 * storefront (3000) and admin (3001) would otherwise share one session.
 */

const APP_PREFIX: Record<WebApp, string> = { storefront: 'nzs', admin: 'nza' };

/** How long a session survives without use. Staff sessions end sooner. */
export const REFRESH_COOKIE_MAX_AGE: Record<WebApp, number> = {
  storefront: 30 * 24 * 60 * 60,
  admin: 12 * 60 * 60,
};

export interface CookieNames {
  access: string;
  refresh: string;
  csrf: string;
  /** Unix seconds at which the access token expires; the API's own answer, not a JWT claim. */
  expiresAt: string;
  /** The storefront cart (see cart-cookie.ts). Not part of the session, never a credential. */
  cart: string;
}

export function cookieNames(config: Pick<WebSessionConfig, 'app' | 'production'>): CookieNames {
  const prefix = `${config.production ? '__Host-' : ''}${APP_PREFIX[config.app]}`;
  return {
    access: `${prefix}_at`,
    refresh: `${prefix}_rt`,
    csrf: `${prefix}_csrf`,
    expiresAt: `${prefix}_exp`,
    cart: `${prefix}_cart`,
  };
}

export interface CookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge?: number;
}

export function cookieOptions(
  config: Pick<WebSessionConfig, 'production'>,
  maxAge?: number,
): CookieOptions {
  return {
    httpOnly: true,
    secure: config.production,
    sameSite: 'lax',
    path: '/',
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}

/** The cookie operations shared by Next.js request, response and `cookies()` stores. */
export interface CookieJar {
  get(name: string): string | undefined;
  set(name: string, value: string, options: CookieOptions): void;
  delete(name: string, options: CookieOptions): void;
}

export interface SessionTokens {
  accessToken?: string;
  refreshToken?: string;
  /**
   * When the access token expires (unix seconds), as reported by the API. Opaque tokens
   * carry no readable claims, so this cookie is what tells the proxy when to refresh.
   */
  accessExpiresAt?: number;
}

/**
 * The browser's session tokens. A cookie the proxy has just cleared reads as an empty
 * string inside an action, so empty values count as absent: they are never sent.
 */
export function sessionTokens(
  jar: Pick<CookieJar, 'get'>,
  config: Pick<WebSessionConfig, 'app' | 'production'>,
): SessionTokens {
  const names = cookieNames(config);
  const expiresAt = Number(jar.get(names.expiresAt) ?? '');
  return {
    accessToken: jar.get(names.access) || undefined,
    refreshToken: jar.get(names.refresh) || undefined,
    ...(Number.isFinite(expiresAt) && expiresAt > 0 ? { accessExpiresAt: expiresAt } : {}),
  };
}

export function writeSessionCookies(
  jar: CookieJar,
  config: Pick<WebSessionConfig, 'app' | 'production'>,
  session: AuthSession,
): void {
  const names = cookieNames(config);
  // The access cookie lapses with the token, which prompts a refresh on the next request.
  const maxAge = Math.max(session.expiresIn, 1);
  jar.set(names.access, session.accessToken, cookieOptions(config, maxAge));
  jar.set(names.expiresAt, String(session.expiresAt), cookieOptions(config, maxAge));
  jar.set(
    names.refresh,
    session.refreshToken,
    cookieOptions(config, REFRESH_COOKIE_MAX_AGE[config.app]),
  );
}

export function clearSessionCookies(
  jar: CookieJar,
  config: Pick<WebSessionConfig, 'app' | 'production'>,
): void {
  const names = cookieNames(config);
  jar.delete(names.access, cookieOptions(config));
  jar.delete(names.expiresAt, cookieOptions(config));
  jar.delete(names.refresh, cookieOptions(config));
}
