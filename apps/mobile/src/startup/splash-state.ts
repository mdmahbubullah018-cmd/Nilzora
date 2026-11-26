import { useSyncExternalStore } from 'react';

/*
 * Launch phase, shared by the animated splash and the work that waits for it.
 *
 * - `none`: no splash was started (tests, and any render tree without the root layout). Work
 *   gated on the splash runs straight away, so nothing waits on a splash that never comes.
 * - `showing`: the root layout asked for the splash (holdNativeSplash) and it is on screen.
 * - `finished`: the splash has started to leave; the first screen is the customer's.
 *
 * Reads are synchronous and the value only moves forward, so a component can read it during
 * render without tearing.
 */

export type SplashPhase = 'none' | 'showing' | 'finished';
type Phase = SplashPhase;

let phase: Phase = 'none';
const listeners = new Set<() => void>();

let startedAt = Date.now();

/** When this JavaScript bundle started running (ms since epoch). The splash's limits count from it. */
export function jsStartedAt(): number {
  return startedAt;
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** Marks the splash as on screen. Only the first call does anything. */
export function beginSplash(): void {
  if (phase !== 'none') return;
  phase = 'showing';
  emit();
}

/** Marks the splash as finished. Safe to call more than once. */
export function finishSplash(): void {
  if (phase === 'finished') return;
  phase = 'finished';
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isDone(): boolean {
  return phase !== 'showing';
}

function currentPhase(): Phase {
  return phase;
}

/**
 * Calls `listener` once, when a splash that is on screen finishes. Never calls it when no splash
 * was started or it has already finished. Returns the unsubscribe function.
 */
export function onSplashFinished(listener: () => void): () => void {
  if (phase !== 'showing') return () => undefined;
  const check = () => {
    if (phase !== 'finished') return;
    listeners.delete(check);
    listener();
  };
  listeners.add(check);
  return () => {
    listeners.delete(check);
  };
}

/** True once nothing is covering the first screen (or when no splash was ever shown). */
export function useSplashFinished(): boolean {
  return useSyncExternalStore(subscribe, isDone, isDone);
}

/** The launch phase itself, for work that must tell "no splash" from "the splash just left". */
export function useSplashPhase(): SplashPhase {
  return useSyncExternalStore(subscribe, currentPhase, currentPhase);
}

/** Tests only: back to "no splash". */
export function resetSplashStateForTests(): void {
  phase = 'none';
  startedAt = Date.now();
  emit();
}
