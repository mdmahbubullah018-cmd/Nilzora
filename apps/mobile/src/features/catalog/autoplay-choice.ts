/*
 * The shopper's own "pause / play" choice for a slideshow, kept for the session.
 *
 * It lives in memory, keyed by carousel, so leaving Home and coming back (the screen is
 * unmounted and mounted again) keeps what the shopper chose, and closing the app forgets it. It
 * is deliberately not written to disk: a pause is a request for this visit, not a setting.
 */

const choices = new Map<string, boolean>();

/** True when the shopper paused this slideshow, false when they chose to play it, else undefined. */
export function getAutoplayPaused(key: string): boolean | undefined {
  return choices.get(key);
}

export function setAutoplayPaused(key: string, paused: boolean): void {
  choices.set(key, paused);
}

/** For tests: forget every choice. */
export function resetAutoplayChoices(): void {
  choices.clear();
}
