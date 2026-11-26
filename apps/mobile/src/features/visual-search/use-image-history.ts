import { useCallback, useEffect, useState } from 'react';
import { imageHistory, type ImageHistoryEntry, type ImageHistoryStore } from './search-history';

export interface ImageHistoryHandle {
  /** Newest first. */
  entries: readonly ImageHistoryEntry[];
  remember: (entry: ImageHistoryEntry) => void;
  forget: (uri: string) => void;
}

/** The device-local list of pictures searched from the camera (see search-history.ts). */
export function useImageHistory(store: ImageHistoryStore = imageHistory): ImageHistoryHandle {
  const [entries, setEntries] = useState<readonly ImageHistoryEntry[]>(() => store.getEntries());

  useEffect(() => {
    let active = true;
    void store.hydrate().then(() => {
      if (active) setEntries(store.getEntries());
    });
    return () => {
      active = false;
    };
  }, [store]);

  const remember = useCallback(
    (entry: ImageHistoryEntry) => {
      store.remember(entry);
      setEntries(store.getEntries());
    },
    [store],
  );

  const forget = useCallback(
    (uri: string) => {
      store.forget(uri);
      setEntries(store.getEntries());
    },
    [store],
  );

  return { entries, remember, forget };
}
