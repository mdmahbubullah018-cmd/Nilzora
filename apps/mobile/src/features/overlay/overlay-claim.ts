import { useSyncExternalStore } from 'react';

/*
 * One full-screen overlay at a time
 * ---------------------------------
 * The launch sequence (the app's own introduction, then an onboarding campaign) and the
 * promotional popup both want the whole screen. They must never appear together: a popup over an
 * introduction is two interruptions stacked on one another.
 *
 * The launch sequence claims the screen while it is open; anything else that would cover the app
 * waits for the claim to be released rather than guessing from route names or timers.
 */

type Listener = () => void;

let owner: string | null = null;
const listeners = new Set<Listener>();

function announce(): void {
  for (const listener of listeners) listener();
}

/** Claims the full screen. Returns the release; calling it twice is harmless. */
export function claimOverlay(name: string): () => void {
  owner = name;
  announce();
  return () => {
    if (owner !== name) return;
    owner = null;
    announce();
  };
}

/** Who holds the screen, or null when nothing does. */
export function overlayOwner(): string | null {
  return owner;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current holder, as a value a component re-renders on. */
export function useOverlayOwner(): string | null {
  return useSyncExternalStore(subscribe, overlayOwner, overlayOwner);
}
