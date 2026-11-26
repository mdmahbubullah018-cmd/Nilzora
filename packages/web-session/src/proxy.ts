import type { ApiClient } from '@nilzora/api-client';
import { NextResponse, type NextRequest } from 'next/server';
import type { WebSessionConfig } from './config';
import {
  clearSessionCookies,
  cookieNames,
  cookieOptions,
  writeSessionCookies,
  type CookieJar,
  type CookieOptions,
} from './cookies';
import { newCsrfSecret } from './csrf';
import { accessTokenNeedsRefresh, refreshSessionOnce } from './refresh';

const SAFE_METHODS = new Set(['GET', 'HEAD']);

interface CookieUpdate {
  name: string;
  /** null deletes the cookie. */
  value: string | null;
  options: CookieOptions;
}

/** Records cookie writes so they can be applied to both the request and the response. */
function recordingJar(source: NextRequest, updates: CookieUpdate[]): CookieJar {
  return {
    get: (name) => source.cookies.get(name)?.value || undefined,
    set: (name, value, options) => updates.push({ name, value, options }),
    delete: (name, options) => updates.push({ name, value: null, options }),
  };
}

/**
 * Runs before pages and Server Actions (the only places that may write cookies are
 * this proxy, Server Actions and Route Handlers; page rendering cannot). It:
 *
 *   - issues the CSRF cookie that forms are signed against, if missing (not cross-site);
 *   - refreshes an expired or nearly expired access token, writing the rotated pair;
 *   - clears the session when the API refuses the refresh (revoked, suspended, ...);
 *   - leaves cookies untouched when the API could not be reached.
 *
 * Changes are applied to the forwarded request too, so the page rendered for this
 * request already sees them. This never decides who is signed in: pages ask the API.
 */
export async function syncSessionCookies(
  request: NextRequest,
  config: WebSessionConfig,
  api: Pick<ApiClient, 'refresh'>,
  now: () => number = Date.now,
): Promise<NextResponse> {
  const names = cookieNames(config);
  const updates: CookieUpdate[] = [];
  const jar = recordingJar(request, updates);

  // Never for a cross-site post: it arrives without the SameSite=Lax cookie, and answering
  // it with a new one would let any site replace it and expire open forms. Page loads and
  // posts the browser marks same-origin (a header other sites cannot set) may get one, so
  // a form whose cookie was lost recovers after one failed submit, even without JavaScript.
  if (
    !jar.get(names.csrf) &&
    (SAFE_METHODS.has(request.method) || request.headers.get('sec-fetch-site') === 'same-origin')
  ) {
    jar.set(names.csrf, newCsrfSecret(), cookieOptions(config));
  }

  const accessToken = jar.get(names.access);
  const refreshToken = jar.get(names.refresh);
  // The expiry cookie written by the last refresh; 0 or a malformed value means "unknown".
  const reportedExpiry = Number(jar.get(names.expiresAt) ?? '');
  if (
    accessTokenNeedsRefresh(accessToken, now(), reportedExpiry > 0 ? reportedExpiry : undefined)
  ) {
    if (refreshToken) {
      const outcome = await refreshSessionOnce(api, refreshToken, now);
      if (outcome.kind === 'refreshed') writeSessionCookies(jar, config, outcome.session);
      else if (outcome.kind === 'rejected') clearSessionCookies(jar, config);
    } else if (accessToken) {
      clearSessionCookies(jar, config);
    }
  }

  for (const update of updates) {
    if (update.value === null) request.cookies.delete(update.name);
    else request.cookies.set(update.name, update.value);
  }
  const response = NextResponse.next({ request: { headers: request.headers } });
  for (const update of updates) {
    if (update.value === null) {
      response.cookies.set(update.name, '', { ...update.options, maxAge: 0 });
    } else {
      response.cookies.set(update.name, update.value, update.options);
    }
  }
  // A response that sets session cookies must never be stored by a shared cache.
  if (updates.length > 0) response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
