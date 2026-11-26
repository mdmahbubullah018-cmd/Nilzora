import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * A refresh the customer asked for (pull-to-refresh, or the screen reader's Refresh action).
 *
 *   const { onRefresh } = useManualRefresh(() => Promise.all([a.refetch(), b.refetch()]));
 *   <Screen onRefresh={onRefresh} ...>
 *
 * - One at a time: a second request while one runs is answered `busy` and starts nothing.
 * - Shown for at least REFRESH_MIN_MS, so a fast answer does not flicker.
 * - Never longer than REFRESH_MAX_MS: past that the refresh is reported as `failed`, never as
 *   a success. The requests themselves are not cancelled; if they finish later the screen
 *   simply shows the newer data.
 * - `failed` when anything rejects or a TanStack refetch result reports an error. Retries are
 *   the query client's own (bounded, transient errors only); nothing is retried here.
 * - After the screen has gone, nothing is set and the outcome is `cancelled`.
 */

export type RefreshOutcome = 'updated' | 'failed' | 'busy' | 'cancelled';

export const REFRESH_MIN_MS = 600;
export const REFRESH_MAX_MS = 10_000;

export interface ManualRefresh {
  /** True only while a refresh the customer asked for is running. */
  refreshing: boolean;
  /** Starts a refresh; resolves when it is over, with how it went. */
  onRefresh: () => Promise<RefreshOutcome>;
}

const TIMED_OUT = Symbol('timed-out');

/** Whether a refetch result (or several, from Promise.all) reports a failure. */
export function refreshFailed(result: unknown): boolean {
  if (Array.isArray(result)) return result.some(refreshFailed);
  if (typeof result !== 'object' || result === null) return false;
  const candidate = result as { isError?: unknown; status?: unknown };
  return candidate.isError === true || candidate.status === 'error';
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useManualRefresh(refetch: () => unknown): ManualRefresh {
  const [refreshing, setRefreshing] = useState(false);
  const running = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const onRefresh = useCallback(async (): Promise<RefreshOutcome> => {
    if (running.current) return 'busy';
    running.current = true;
    setRefreshing(true);
    const startedAt = Date.now();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), REFRESH_MAX_MS);
    });

    let outcome: RefreshOutcome;
    try {
      const result = await Promise.race([Promise.resolve().then(refetch), timeout]);
      outcome = result === TIMED_OUT || refreshFailed(result) ? 'failed' : 'updated';
    } catch {
      outcome = 'failed';
    } finally {
      clearTimeout(timer);
    }

    const remaining = REFRESH_MIN_MS - (Date.now() - startedAt);
    if (remaining > 0) await wait(remaining);

    running.current = false;
    if (!mounted.current) return 'cancelled';
    setRefreshing(false);
    return outcome;
  }, [refetch]);

  return { refreshing, onRefresh };
}
