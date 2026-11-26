import { ApiError, type ApiClient } from '@nilzora/api-client';
import type { MeResponse } from '@nilzora/contracts';
import type { SessionTokens } from './cookies';

export type SessionUser = MeResponse['user'];

/**
 * The visitor's session as verified by the API. A cookie alone proves nothing: only
 * `signed_in` (from a successful GET /me) counts as authenticated. Role and
 * permissions are the API's answer for this request, for shaping pages; every
 * protected API call is still authorised by the API itself.
 */
export type SessionState =
  | { status: 'signed_in'; user: SessionUser }
  | { status: 'signed_out' }
  | { status: 'suspended' }
  /** The API could not be reached; the visitor is neither confirmed nor refused. */
  | { status: 'unavailable' };

/**
 * `refreshToken` matters only without an access token. Behind the proxy, a refresh
 * cookie survives alone only when the refresh could not be decided (a refused one is
 * cleared, a successful one writes a new access token), so the API was unreachable.
 */
export async function readSession(
  api: Pick<ApiClient, 'getMe'>,
  accessToken: string | undefined,
  refreshToken?: string,
): Promise<SessionState> {
  if (!accessToken) return refreshToken ? { status: 'unavailable' } : { status: 'signed_out' };
  try {
    const { user } = await api.getMe(accessToken);
    return { status: 'signed_in', user };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401 || error.code === 'account_unavailable') {
        return { status: 'signed_out' };
      }
      if (error.code === 'account_suspended') return { status: 'suspended' };
    }
    return { status: 'unavailable' };
  }
}

/** An authenticated API call, given the request's client and the session's access token. */
export type SessionCall<T> = (api: ApiClient, accessToken: string) => Promise<T>;

/** What an authenticated call produced, or why it could not be answered. */
export type SessionRead<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'signed_out' }
  /** The API could not be reached or failed; the visitor is neither confirmed nor refused. */
  | { kind: 'unavailable' };

/**
 * An authenticated call for a Server Component, which cannot write cookies: there is
 * no refresh here (the proxy refreshes before the page renders) and no cookie is ever
 * changed. Without an access token, a lone refresh token means the refresh could not
 * be decided (see readSession). A 401 is signed out, a network failure, timeout or
 * server error is unavailable, and any other error is the caller's to map (a 404 to
 * notFound(), for example).
 */
export async function readWithAccessToken<T>(
  api: ApiClient,
  tokens: SessionTokens,
  call: SessionCall<T>,
): Promise<SessionRead<T>> {
  const { accessToken, refreshToken } = tokens;
  if (!accessToken) return refreshToken ? { kind: 'unavailable' } : { kind: 'signed_out' };
  try {
    return { kind: 'ok', value: await call(api, accessToken) };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) return { kind: 'signed_out' };
      // Status 0 is also the client refusing a bad request (invalid_request): not an outage.
      const unreachable = error.code === 'network_error' || error.code === 'timeout';
      if (unreachable || error.status >= 500) return { kind: 'unavailable' };
    }
    throw error;
  }
}
