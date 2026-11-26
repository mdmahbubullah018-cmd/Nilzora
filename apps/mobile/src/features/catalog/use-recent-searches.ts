import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createRecentSearchStore, type RecentSearchesStore } from './recent-searches';

export interface RecentSearchesHandle {
  /** Newest first. */
  queries: readonly string[];
  /** Puts a term at the top; safe to call repeatedly with the same term. */
  remember: (query: string) => void;
  clear: () => void;
}

/**
 * The device-local search history. It is stored with AsyncStorage next to the cart and the
 * wishlist, and is never sent to the server.
 */
export function useRecentSearches(store?: RecentSearchesStore): RecentSearchesHandle {
  const [created] = useState(() => store ?? createRecentSearchStore({ storage: AsyncStorage }));
  const active = store ?? created;

  useEffect(() => {
    void active.hydrate();
  }, [active]);

  const snapshot = useSyncExternalStore(active.subscribe, active.getSnapshot, active.getSnapshot);
  const remember = useCallback((query: string) => active.remember(query), [active]);
  const clear = useCallback(() => active.clear(), [active]);

  return useMemo(
    () => ({ queries: snapshot.queries, remember, clear }),
    [snapshot.queries, remember, clear],
  );
}
