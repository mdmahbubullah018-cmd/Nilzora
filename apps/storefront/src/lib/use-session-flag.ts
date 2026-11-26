'use client';

import { useCallback, useSyncExternalStore } from 'react';

/*
 * A true/false choice that lasts for the visit: a shopper who paused a slideshow on one page
 * still finds it paused on the next, and the choice is forgotten when the tab is closed.
 *
 * It lives in sessionStorage, with an in-memory copy for the browsers (private windows, blocked
 * site data) where storage throws, so the choice at least lasts until the page is left. It is
 * read with useSyncExternalStore, so server render and hydration agree (the server snapshot is
 * `false`) and the client corrects itself afterwards without a mismatch.
 */

const memory = new Map<string, boolean>();
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function read(key: string): boolean {
  const remembered = memory.get(key);
  if (remembered !== undefined) return remembered;
  try {
    return window.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** For tests: forget every remembered choice. */
export function resetSessionFlags(): void {
  memory.clear();
  for (const listener of listeners) listener();
}

export function useSessionFlag(key: string): readonly [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => false,
  );
  const update = useCallback(
    (next: boolean) => {
      memory.set(key, next);
      try {
        window.sessionStorage.setItem(key, next ? '1' : '0');
      } catch {
        // Storage is unavailable: the in-memory copy above still holds the choice.
      }
      for (const listener of listeners) listener();
    },
    [key],
  );
  return [value, update] as const;
}
