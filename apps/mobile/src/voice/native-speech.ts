import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

/*
 * The app's side of the voice-search native module (modules/nilzora-speech, Android's own
 * SpeechRecognizer). The module is loaded optionally: a build that does not contain it (an
 * older installed app, iOS, the web, tests) answers "not supported" and the microphone is simply
 * not offered, instead of crashing.
 */

export type SpeechErrorCode =
  'no_speech' | 'network' | 'permission' | 'busy' | 'language' | 'audio' | 'unavailable' | 'failed';

/** What the recognizer is doing, as it reports it. */
export type SpeechPhase = 'starting' | 'listening' | 'hearing' | 'processing';

interface Subscription {
  remove: () => void;
}

export interface NativeSpeech {
  isAvailable: () => boolean;
  /**
   * Starts listening. `forceLanguage` turns automatic identification off for this attempt and
   * listens in `locale` instead — what the app does when it deliberately tries again in the other
   * language. Older builds of the module take one argument; it is optional here for that reason.
   */
  start: (locale: string, forceLanguage?: boolean) => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => Promise<void>;
  /** Whether this platform can identify the spoken language itself (Android 14 and later). */
  canDetectLanguage?: () => boolean;
  addListener: (event: string, listener: (payload: never) => void) => Subscription;
}

let native: NativeSpeech | null | undefined;

/** The native module, or null when this build does not have it. Looked up once. */
export function nativeSpeech(): NativeSpeech | null {
  native ??=
    Platform.OS === 'android' ? requireOptionalNativeModule<NativeSpeech>('NilzoraSpeech') : null;
  return native;
}

/** Tests inject a fake module (or null) here. */
export function setNativeSpeechForTests(module: NativeSpeech | null | undefined): void {
  native = module;
}

/** Whether voice search can be offered at all on this phone. */
export function isVoiceSearchSupported(): boolean {
  const module = nativeSpeech();
  if (module === null) return false;
  try {
    return module.isAvailable();
  } catch {
    return false;
  }
}

/**
 * The languages voice search offers: the app's own English and Bangla, as the store serves both.
 * They are not a picker — the customer never chooses — but the two models the recognizer is
 * allowed to identify and the hints the app falls back on when a platform cannot identify.
 */
export const VOICE_LOCALES = [
  { id: 'en-US', label: 'English' },
  { id: 'bn-BD', label: 'বাংলা' },
] as const;
export type VoiceLocale = (typeof VOICE_LOCALES)[number]['id'];
export const DEFAULT_VOICE_LOCALE: VoiceLocale = 'en-US';

/**
 * Whether the recognizer on this phone can identify the spoken language by itself. From Android
 * 14 the platform listens without being told a language and reports which one it heard; below
 * that, recognition runs in one language at a time and the app switches languages itself after a
 * failed attempt (see `useVoiceSearch`).
 */
export function canDetectSpokenLanguage(): boolean {
  const module = nativeSpeech();
  if (module === null) return false;
  try {
    return module.canDetectLanguage?.() ?? false;
  } catch {
    return false;
  }
}

/**
 * The language a first attempt starts in, from the phone's own settings: a phone set to Bengali
 * starts in Bangla, every other phone in English.
 *
 * This is only the *hint*. Where the platform identifies the spoken language (Android 14+), the
 * hint is not sent at all and English speech is recognised as English on a Bengali phone, and the
 * other way round. Where it cannot, the hint decides the first attempt and the opposite language
 * is tried automatically when the recognizer hears speech but matches nothing.
 */
export function autoVoiceLocale(): VoiceLocale {
  let tag: string | null = null;
  try {
    tag = new Intl.DateTimeFormat().resolvedOptions().locale ?? null;
  } catch {
    // An engine without Intl: English is the safe default.
    tag = null;
  }
  return tag !== null && tag.toLowerCase().startsWith('bn') ? 'bn-BD' : DEFAULT_VOICE_LOCALE;
}

/** The other language of the two — what a second attempt switches to. */
export function otherVoiceLocale(locale: VoiceLocale): VoiceLocale {
  return locale === 'en-US' ? 'bn-BD' : 'en-US';
}

/**
 * The store's language for a tag the recognizer reported, e.g. `bn-IN`, `bn-BD`, `en-GB`. An
 * unknown tag falls back to the language the attempt started in, so the window never claims a
 * language it cannot name.
 */
export function localeForTag(tag: string | null | undefined, fallback: VoiceLocale): VoiceLocale {
  if (tag === null || tag === undefined) return fallback;
  const lower = tag.toLowerCase();
  if (lower.startsWith('bn')) return 'bn-BD';
  if (lower.startsWith('en')) return 'en-US';
  return fallback;
}
