/*
 * One voice message at a time
 * ---------------------------
 * Every bubble owns its own audio player, which is what keeps a long thread cheap: nothing is
 * loaded until someone taps play. The trade-off is that two players can run together, so this
 * module holds a single "who is speaking" reference. Starting a recording preview or a sent
 * voice note pauses whatever was playing, the way a messaging app should behave.
 *
 * It is deliberately not a store: no React state, no re-renders, just the one pointer.
 */

let speaking: (() => void) | null = null;

/** Starts one player, pausing the previous one if it is still going. */
export function claimVoiceAudio(pause: () => void): void {
  if (speaking !== null && speaking !== pause) speaking();
  speaking = pause;
}

/** Gives the slot back when a player stops or its bubble leaves the screen. */
export function releaseVoiceAudio(pause: () => void): void {
  if (speaking === pause) speaking = null;
}
