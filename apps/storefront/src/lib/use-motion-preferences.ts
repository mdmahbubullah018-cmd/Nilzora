'use client';

import { useSyncExternalStore } from 'react';

/*
 * Two browser preferences that decide whether something may move by itself: the visitor's
 * "reduce motion" setting, and whether the tab is on screen at all. Shared by every auto-
 * advancing surface (the hero carousel, the collection rail) so they all obey the same rules.
 *
 * Both are external stores read with useSyncExternalStore, so they stay in step with the system
 * setting while the page is open and never cause a hydration mismatch: the server snapshot
 * assumes motion is allowed and the tab is visible, and the client corrects it on hydration.
 */

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function reducedMotionQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION) : null;
}

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = reducedMotionQuery();
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

/** True when the visitor asked the system for less motion. Server render assumes motion. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => reducedMotionQuery()?.matches ?? false,
    () => false,
  );
}

/** False while the tab is in the background, so nothing advances unseen. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== 'hidden',
    () => true,
  );
}
