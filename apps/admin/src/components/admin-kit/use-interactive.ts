'use client';

import { useSyncExternalStore } from 'react';

const noSubscribe = () => () => undefined;

/**
 * False while rendering on the server and while hydrating, true once the page is
 * interactive: for components that render a no-JavaScript fallback first and then
 * enhance it, without a hydration mismatch.
 */
export function useInteractive(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}
