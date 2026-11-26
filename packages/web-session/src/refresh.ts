import { createHash } from 'node:crypto';
import { ApiError, type ApiClient } from '@nilzora/api-client';
import type { AuthSession } from '@nilzora/contracts';

export type RefreshOutcome =
  /** New tokens: store both; the old refresh token is spent. */
  | { kind: 'refreshed'; session: AuthSession }
  /** The session is over (revoked, expired, suspended): clear it. */
  | { kind: 'rejected' }
  /** Nothing was decided (network, outage, rate limit): keep the cookies, try later. */
  | { kind: 'unavailable' };

/** Requests arriving just after a refresh reuse its result instead of spending the old token again. */
const REUSE_WINDOW_MS = 5_000;

interface Flight {
  promise: Promise<RefreshOutcome>;
  settledAt?: number;
}

/** Keyed by a hash of the refresh token, so raw tokens are not kept as map keys. */
const flights = new Map<string, Flight>();

function classify(error: unknown): RefreshOutcome {
  if (error instanceof ApiError && [400, 401, 403].includes(error.status)) {
    return { kind: 'rejected' };
  }
  return { kind: 'unavailable' };
}

/**
 * Refreshes a session at most once per refresh token within this process. Concurrent
 * requests carrying the same expired session share one call to the API, so rotation
 * never races with itself. Failures that decided nothing are not remembered.
 */
export function refreshSessionOnce(
  api: Pick<ApiClient, 'refresh'>,
  refreshToken: string,
  now: () => number = Date.now,
): Promise<RefreshOutcome> {
  const time = now();
  for (const [key, flight] of flights) {
    if (flight.settledAt !== undefined && time - flight.settledAt > REUSE_WINDOW_MS) {
      flights.delete(key);
    }
  }

  const key = createHash('sha256').update(refreshToken).digest('base64url');
  const existing = flights.get(key);
  if (existing) return existing.promise;

  const flight: Flight = {
    promise: api
      .refresh(refreshToken)
      .then((session): RefreshOutcome => ({ kind: 'refreshed', session }), classify),
  };
  flights.set(key, flight);
  void flight.promise.then((outcome) => {
    if (outcome.kind === 'unavailable') flights.delete(key);
    else flight.settledAt = now();
  });
  return flight.promise;
}

/** Test hook: forgets every remembered refresh. */
export function resetRefreshFlights(): void {
  flights.clear();
}

/** Seconds before expiry at which an access token is refreshed ahead of use. */
export const REFRESH_MARGIN_SECONDS = 60;

/**
 * Reads the `exp` claim WITHOUT verifying the signature. Used only to decide when to
 * refresh; the API verifies every token it receives.
 */
export function accessTokenExpiry(accessToken: string): number | undefined {
  const payload = accessToken.split('.')[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
    if (typeof claims !== 'object' || claims === null || !('exp' in claims)) return undefined;
    return typeof claims.exp === 'number' ? claims.exp : undefined;
  } catch {
    return undefined;
  }
}

export function accessTokenNeedsRefresh(
  accessToken: string | undefined,
  nowMs: number,
  /**
   * Expiry reported by the API. Opaque tokens cannot be decoded, so without this the
   * proxy would refresh on every request; the cookie written beside the token carries it.
   */
  expiresAt?: number,
): boolean {
  if (!accessToken) return true;
  const expiry = expiresAt ?? accessTokenExpiry(accessToken);
  return expiry === undefined || expiry - REFRESH_MARGIN_SECONDS <= nowMs / 1000;
}

