import { focusManager, QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useSession } from '@/auth/session-context';
import type { SessionState } from '@/auth/session-manager';
import { getMobileApi } from '@/auth/api';
import {
  isOnline,
  reportConnection,
  startConnectivity,
  subscribeConnection,
  type Probe,
} from '@/network/connectivity';
import { startPublicCache } from './public-cache';
import { createAppQueryClient } from './query-client';
import { USER_QUERY_ROOT } from './query-keys';

/*
 * Offline note: React Query learns about connectivity from the platform. We deliberately do
 * not add NetInfo, so "reconnect" never fires on its own in the app; coming back to the
 * foreground (below) is what refetches stale data, and a failed fetch is retried by the
 * query client's retry policy.
 */

/** One light request to the API's health route: any answer at all means the server is reachable. */
const probeApiHealth: Probe = async (signal) => {
  const mobile = getMobileApi();
  if (!mobile.ok) return false;
  await mobile.api.getHealth({ signal });
  return true;
};

/** Tells React Query the app is "focused" only while it is in the foreground. */
function useAppStateFocus(): void {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      focusManager.setFocused(status === 'active');
    });
    return () => {
      subscription.remove();
      focusManager.setFocused(undefined);
    };
  }, []);
}

/** Removes every signed-in account's cached data (and anything still loading for it). */
export function clearUserData(queryClient: QueryClient): void {
  const userQueries = { queryKey: [USER_QUERY_ROOT] };
  void queryClient.cancelQueries(userQueries);
  queryClient.removeQueries(userQueries);
  queryClient.getMutationCache().clear();
}

function signedInId(state: SessionState): string | null {
  return state.status === 'signed_in' ? state.user.id : null;
}

/**
 * Clears the account-scoped cache the moment the account changes or signs out, before React
 * renders anything for the next account. Transient states (restoring, offline, suspended)
 * keep the cache: the same customer is usually coming back. Query keys also carry the user
 * id, so even without this a different account could never read the previous one's data.
 */
function useClearUserDataOnAccountChange(queryClient: QueryClient): void {
  const { manager } = useSession();
  useEffect(() => {
    if (manager === null) return;
    let lastUserId = signedInId(manager.getState());
    return manager.subscribe(() => {
      const state = manager.getState();
      const userId = signedInId(state);
      if (userId !== null) {
        if (lastUserId !== null && lastUserId !== userId) clearUserData(queryClient);
        lastUserId = userId;
      } else if (state.status === 'signed_out') {
        clearUserData(queryClient);
        lastUserId = null;
      }
    });
  }, [manager, queryClient]);
}

/** A saved session that could not be checked because the server was unreachable means offline. */
function useSessionReachability(enabled: boolean): void {
  const { manager } = useSession();
  useEffect(() => {
    // Like the connectivity monitor, only for the app's own client (never a test's injected one).
    if (!enabled || manager === null) return;
    const stopSession = manager.subscribe(() => {
      if (manager.getState().status === 'offline') reportConnection(false);
    });
    // Back online with a saved session that could not be checked: check it now, once.
    const stopConnection = subscribeConnection(() => {
      if (isOnline() && manager.getState().status === 'offline') void manager.restore();
    });
    return () => {
      stopSession();
      stopConnection();
    };
  }, [enabled, manager]);
}

export interface AppQueryProviderProps {
  children: ReactNode;
  /** Tests inject a client with retries disabled. */
  client?: QueryClient;
}

/**
 * Provides the QueryClient, refetches stale data when the app returns to the foreground,
 * and clears one account's cached data before the next account (or a guest) can see it.
 * Must sit inside <SessionProvider>.
 */
export function AppQueryProvider({ children, client }: AppQueryProviderProps) {
  const [queryClient] = useState(() => client ?? createAppQueryClient());
  // Only the app's own client keeps the public catalog on the device; a client a test
  // injects never touches storage.
  useEffect(() => {
    if (client !== undefined) return;
    return startPublicCache(queryClient);
  }, [client, queryClient]);
  // Learns about connectivity from real requests; probes only while offline. A client a test
  // injects stays out of it, like the catalog cache.
  useEffect(() => {
    if (client !== undefined) return;
    return startConnectivity(queryClient, probeApiHealth).stop;
  }, [client, queryClient]);
  useSessionReachability(client === undefined);
  useAppStateFocus();
  useClearUserDataOnAccountChange(queryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
