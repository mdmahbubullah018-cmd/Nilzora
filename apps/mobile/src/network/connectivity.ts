import { onlineManager, type QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { ApiError } from '@nilzora/api-client';

/*
 * Connectivity, without a network-info library
 * --------------------------------------------
 * The app learns it is offline the honest way: a request really failed to reach the server
 * (`network_error`). From then on React Query pauses fetching (no hammering a dead connection,
 * no battery spent on retries), cached data stays on screen, and one light probe of the API's
 * health route runs while the app is in the foreground, backing off from 8 s to 40 s. The first
 * answer flips the app back online, which resumes paused queries and refetches stale ones.
 *
 * Nothing here queues a customer's action for later: mutations are configured to run at once
 * and fail visibly (see query-client.ts), and the screens disable their server-dependent
 * buttons while this says offline.
 */

export const PROBE_FIRST_DELAY_MS = 8_000;
export const PROBE_MAX_DELAY_MS = 40_000;
export const PROBE_TIMEOUT_MS = 6_000;

type Listener = () => void;

let online = true;
const listeners = new Set<Listener>();

export function isOnline(): boolean {
  return online;
}

/** Records what the latest real contact with the server showed; notifies only on a change. */
export function reportConnection(reachable: boolean): void {
  if (online === reachable) return;
  online = reachable;
  onlineManager.setOnline(reachable);
  for (const listener of listeners) listener();
}

export function subscribeConnection(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `true` while the server can be reached (the default until a request proves otherwise). */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeConnection, isOnline, isOnline);
}

/** A failure to reach the server at all, as opposed to a slow or refused answer. */
export function isUnreachable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0 && error.code === 'network_error';
}

/** Forgets what was learned; tests only. */
export function resetConnection(): void {
  online = true;
  listeners.clear();
  onlineManager.setOnline(true);
}

export type Probe = (signal: AbortSignal) => Promise<boolean>;

let activeRetry: (() => Promise<boolean>) | null = null;

/** Looks for the server now (the Retry button); false when it still cannot be reached. */
export function retryConnection(): Promise<boolean> {
  return activeRetry?.() ?? Promise.resolve(isOnline());
}

/**
 * Watches the app's own queries and mutations for proof of (no) connection, and probes while
 * offline. Returns `retryNow` (for the Retry button) and the function that stops everything.
 */
export function startConnectivity(
  client: QueryClient,
  probe: Probe,
): { retryNow: () => Promise<boolean>; stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let delay = PROBE_FIRST_DELAY_MS;
  let probing: Promise<boolean> | null = null;
  // Only an app that is really in the background stops probing (the state can be unknown at start).
  let foreground = AppState.currentState !== 'background';

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const runProbe = (): Promise<boolean> => {
    // One probe at a time, however it was triggered.
    probing ??= (async () => {
      const controller = new AbortController();
      const abort = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        return await probe(controller.signal);
      } catch {
        return false;
      } finally {
        clearTimeout(abort);
      }
    })().finally(() => {
      probing = null;
    });
    return probing;
  };

  const schedule = () => {
    clearTimer();
    if (online || !foreground) return;
    timer = setTimeout(() => {
      timer = null;
      void check();
    }, delay);
    delay = Math.min(delay * 2, PROBE_MAX_DELAY_MS);
  };

  const check = async (): Promise<boolean> => {
    const reachable = await runProbe();
    if (reachable) {
      delay = PROBE_FIRST_DELAY_MS;
      reportConnection(true);
    }
    schedule();
    return reachable;
  };

  const onEvent = (event: { type: string; action?: { type?: string; error?: unknown } }) => {
    if (event.type !== 'updated') return;
    if (event.action?.type === 'success') {
      if (!online) delay = PROBE_FIRST_DELAY_MS;
      reportConnection(true);
    } else if (event.action?.type === 'error' && isUnreachable(event.action.error)) {
      reportConnection(false);
    }
  };

  const unsubscribeQueries = client.getQueryCache().subscribe(onEvent);
  const unsubscribeMutations = client.getMutationCache().subscribe(onEvent);
  const unsubscribeConnection = subscribeConnection(schedule);
  const appState = AppState.addEventListener('change', (status) => {
    foreground = status === 'active';
    if (!foreground) {
      clearTimer();
    } else if (!online) {
      // Back in the foreground while offline: look straight away, not after the next delay.
      delay = PROBE_FIRST_DELAY_MS;
      void check();
    }
  });
  schedule();

  const retryNow = () => {
    delay = PROBE_FIRST_DELAY_MS;
    return check();
  };
  activeRetry = retryNow;

  return {
    retryNow,
    stop: () => {
      if (activeRetry === retryNow) activeRetry = null;
      clearTimer();
      // Nothing is watching any more, so what was learned no longer applies.
      reportConnection(true);
      unsubscribeQueries();
      unsubscribeMutations();
      unsubscribeConnection();
      appState.remove();
    },
  };
}
