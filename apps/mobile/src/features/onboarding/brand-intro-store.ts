import AsyncStorage from '@react-native-async-storage/async-storage';

/*
 * First-launch introduction
 * -------------------------
 * The four-screen welcome is the app's own, not a server campaign: it has to be on screen the
 * first time the app opens, before any request has finished, and it never needs a network.
 *
 * It is remembered per install under a versioned key. The version is part of the key on
 * purpose: a redesigned introduction ships as `v2`, which new *and* existing customers see
 * once, while every other local value (session, cart, notification choice) is untouched. Each
 * key is language-neutral — it records only that this introduction was shown.
 */

const KEY_PREFIX = 'nilzora.onboarding.intro.';
/**
 * Bump only when the introduction itself changes and should be shown once more. Version 3 is
 * the five-step interactive tutorial (browse → photos → colour and size → cart → cash on
 * delivery), which replaces the four illustrated screens of version 2: installations that
 * finished version 2 see the tutorial once, on their next launch, without losing the session,
 * the cart or any other local value. The flag is never cleared on sign-out, so it survives
 * logging out, and it lives in app storage, so it survives an app update too.
 */
export const BRAND_INTRO_VERSION = 3;

const STORAGE_KEY = `${KEY_PREFIX}v${String(BRAND_INTRO_VERSION)}`;

/** True when this install has already finished or skipped the current introduction. */
export async function brandIntroSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(STORAGE_KEY)) === 'done';
  } catch {
    // Unreadable storage: show it again rather than block the first launch on a guess.
    return false;
  }
}

/**
 * Records that the introduction is finished (or skipped). Resolves either way: a failure to
 * store means it may appear once more, which is far better than trapping anyone behind it.
 */
export async function completeBrandIntro(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, 'done');
  } catch {
    // Nothing else to do; the next launch asks again.
  }
}
