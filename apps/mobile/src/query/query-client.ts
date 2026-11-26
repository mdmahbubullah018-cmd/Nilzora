import { QueryClient } from '@tanstack/react-query';
import { isTransientError } from '@/lib/errors';

export const QUERY_STALE_TIME_MS = 30_000;
export const QUERY_GC_TIME_MS = 10 * 60_000;
/** Automatic retries after the first failure, for connection and server failures only. */
export const MAX_QUERY_RETRIES = 2;

/**
 * Retry only what can fix itself: the network, a timeout or a 5xx. A 4xx (validation,
 * not found, rate limit, an ended session) repeats with the same answer, and an
 * unexpected error is a bug, so neither is retried. `failureCount` is 0 after the first failure.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  return failureCount < MAX_QUERY_RETRIES && isTransientError(error);
}

/** 1 s, then 2 s (capped at 8 s). `failureCount` is 0 before the first retry. */
export function queryRetryDelay(failureCount: number): number {
  return Math.min(1000 * 2 ** failureCount, 8000);
}

/**
 * The app's QueryClient. Queries are cached briefly (a customer flicking between tabs
 * should not wait) but treated as stale quickly, because stock and prices move.
 * Mutations are never retried automatically: placing an order is retried by the screen
 * with the same idempotency key, never by the library.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: QUERY_STALE_TIME_MS,
        gcTime: QUERY_GC_TIME_MS,
        retry: shouldRetryQuery,
        retryDelay: queryRetryDelay,
        refetchOnReconnect: true,
        // Wired to the app coming to the foreground (see AppQueryProvider), not to a browser tab.
        refetchOnWindowFocus: true,
      },
      // A customer's action is never held back to run later on its own: it runs now and fails
      // visibly when the server cannot be reached (and the screens disable it while offline).
      mutations: { retry: false, networkMode: 'always' },
    },
  });
}
