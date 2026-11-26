import { useCallback, useEffect, useRef, useState } from 'react';
import {
  autoVoiceLocale,
  DEFAULT_VOICE_LOCALE,
  localeForTag,
  nativeSpeech,
  otherVoiceLocale,
  type SpeechErrorCode,
  type SpeechPhase,
  type VoiceLocale,
} from './native-speech';
import { ensureMicrophone } from './microphone-permission';
import { interpretVoiceQuery, type VoiceLanguage } from './voice-intent';

/*
 * One voice search, as a small state machine
 * ------------------------------------------
 *   idle → asking (microphone permission, only when needed) → listening → processing → ready
 *                                                  └─────────────→ error (retry or cancel)
 *
 * The live words arrive as partial results while the customer speaks; the final result replaces
 * them. At any time the customer may edit the text, which ends listening (and releases the
 * microphone) so typing never fights the recognizer. Nothing is searched here: the caller decides
 * what to do with the confirmed text. The microphone is released on cancel, on an error, on
 * unmount, and by the native module when the app goes to the background.
 */

export type VoiceState = 'idle' | 'asking' | 'listening' | 'processing' | 'ready' | 'error';

export interface VoiceProblem {
  code: SpeechErrorCode;
  /** For `permission`: whether the system will still show its prompt (else Settings is needed). */
  canAskAgain: boolean;
}

export interface VoiceSearch {
  state: VoiceState;
  /** The words to search: what was heard without the request words, or what was typed. */
  text: string;
  /** Exactly what the recogniser heard, shown beside `text` when the two differ. */
  heard: string;
  /** Which way the customer spoke (English, Bangla or a mix), for the interface. */
  language: VoiceLanguage | null;
  /** 0–1 input loudness while listening, for the animation. */
  level: number;
  problem: VoiceProblem | null;
  /** The language recognition is using: detected from the phone, never chosen by the customer. */
  locale: VoiceLocale;
  start: () => Promise<void>;
  /** Stop listening now and keep what was heard. */
  finish: () => void;
  cancel: () => void;
  /** The customer typed: end listening and keep their text. */
  edit: (text: string) => void;
}

interface TextPayload {
  text: string;
}
/** The final result, with the language the engine identified when the platform reports one. */
interface ResultPayload extends TextPayload {
  language?: string | null;
}
interface LanguagePayload {
  language: string;
}
interface ErrorPayload {
  code: SpeechErrorCode;
}
interface StatePayload {
  state: SpeechPhase;
}
interface LevelPayload {
  level: number;
}

/**
 * How long the window waits for a final answer after Stop. Android's recognizer normally answers
 * in well under a second; if it never does, the words heard so far are kept and the customer is
 * shown them instead of a screen that says "Finishing…" for ever.
 */
export const STOP_TIMEOUT_MS = 4000;

export function useVoiceSearch(): VoiceSearch {
  const [state, setState] = useState<VoiceState>('idle');
  const [text, setText] = useState('');
  const [heard, setHeard] = useState('');
  const [language, setLanguage] = useState<VoiceLanguage | null>(null);
  const [level, setLevel] = useState(0);
  const [problem, setProblem] = useState<VoiceProblem | null>(null);
  const [locale, setLocale] = useState<VoiceLocale>(autoVoiceLocale);
  // Whether the customer is the author of the text now (typing), so a late partial never
  // overwrites it.
  const typed = useRef(false);
  const active = useRef(false);
  /** The language this attempt started in, so a fallback can tell what it is changing from. */
  const attemptLocale = useRef<VoiceLocale>(DEFAULT_VOICE_LOCALE);
  /** One automatic switch to the other language per attempt, so a phone lacking a model ends. */
  const retriedOther = useRef(false);
  /** Whether the engine said it was hearing speech: what tells a wrong language from silence. */
  const spoke = useRef(false);
  /** True from the tap until the recogniser is running, so a double tap cannot start two. */
  const starting = useRef(false);
  const beginRef = useRef<(target: VoiceLocale, forceLanguage: boolean) => Promise<void>>(() =>
    Promise.resolve(),
  );
  /** The pending "no final answer" timer, so it is cleared by whichever event arrives first. */
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Whether anything searchable has been heard, so a silent stop can say so. */
  const hasText = useRef(false);

  const clearStopTimer = useCallback(() => {
    if (stopTimer.current !== null) {
      clearTimeout(stopTimer.current);
      stopTimer.current = null;
    }
  }, []);

  const apply = useCallback((raw: string) => {
    const intent = interpretVoiceQuery(raw);
    hasText.current = intent.query.trim() !== '';
    setText(intent.query);
    setHeard(intent.heard);
    setLanguage(intent.heard === '' ? null : intent.language);
  }, []);

  const release = useCallback(() => {
    active.current = false;
    void nativeSpeech()
      ?.cancel()
      .catch(() => undefined);
  }, []);

  // Native events for the current attempt. Subscribed once; each handler ignores events that
  // arrive after the attempt ended.
  useEffect(() => {
    const speech = nativeSpeech();
    if (speech === null) return undefined;
    const subscriptions = [
      speech.addListener('onState', (payload: StatePayload) => {
        if (!active.current) return;
        // "hearing" is the engine saying it has speech: a failure after this is more likely the
        // wrong language than silence, which is what makes the automatic second attempt safe.
        if (payload.state === 'hearing') spoke.current = true;
        if (payload.state === 'processing') setState('processing');
        else setState('listening');
      }),
      speech.addListener('onPartial', (payload: TextPayload) => {
        if (!active.current || typed.current) return;
        if (payload.text.trim() !== '') spoke.current = true;
        // What the customer sees while speaking is what will be searched: request words
        // removed, known colours and garments in the catalogue's English, everything else as said.
        apply(payload.text);
      }),
      // Android 14 and later say which language they heard while the customer is still speaking.
      speech.addListener('onLanguage', (payload: LanguagePayload) => {
        if (!active.current) return;
        setLocale(localeForTag(payload.language, attemptLocale.current));
      }),
      speech.addListener('onLevel', (payload: LevelPayload) => {
        if (active.current) setLevel(payload.level);
      }),
      speech.addListener('onResult', (payload: ResultPayload) => {
        if (!active.current) return;
        active.current = false;
        clearStopTimer();
        if (payload.language != null) {
          setLocale(localeForTag(payload.language, attemptLocale.current));
        }
        if (!typed.current) apply(payload.text);
        setLevel(0);
        setState('ready');
      }),
      speech.addListener('onError', (payload: ErrorPayload) => {
        if (!active.current) return;
        active.current = false;
        clearStopTimer();
        setLevel(0);
        // Two reasons to listen once more in the other language, never a third time:
        //  - the phone has no model for the language it was listening in; or
        //  - the engine heard speech but matched no words, which is what a Bangla request sounds
        //    like to an English-only attempt (and the other way round).
        const wrongLanguage =
          payload.code === 'language' ||
          ((payload.code === 'no_speech' || payload.code === 'failed') && spoke.current);
        if (wrongLanguage && !retriedOther.current) {
          retriedOther.current = true;
          void beginRef.current(otherVoiceLocale(attemptLocale.current), true);
          return;
        }
        setProblem({ code: payload.code, canAskAgain: true });
        setState('error');
      }),
    ] as const;
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, [apply, clearStopTimer]);

  // Leaving the screen releases the microphone.
  useEffect(() => release, [release]);
  // And clears a pending "no final answer" timer.
  useEffect(() => clearStopTimer, [clearStopTimer]);

  const begin = useCallback(
    async (target: VoiceLocale, forceLanguage: boolean) => {
      const speech = nativeSpeech();
      if (speech === null) {
        starting.current = false;
        setProblem({ code: 'unavailable', canAskAgain: false });
        setState('error');
        return;
      }
      typed.current = false;
      hasText.current = false;
      spoke.current = false;
      clearStopTimer();
      setText('');
      setHeard('');
      setLanguage(null);
      setLevel(0);
      setProblem(null);
      setLocale(target);
      attemptLocale.current = target;

      // The system prompt appears only here, when the customer has tapped the microphone.
      setState('asking');
      const { granted, canAskAgain } = await ensureMicrophone();
      starting.current = false;
      if (!granted) {
        setProblem({ code: 'permission', canAskAgain });
        setState('error');
        return;
      }

      active.current = true;
      setState('listening');
      try {
        // `forceLanguage` is false on a first attempt: where the platform can identify the
        // language it is left to do so, and `target` is only the hint for platforms that cannot.
        await speech.start(target, forceLanguage);
      } catch {
        active.current = false;
        setProblem({ code: 'failed', canAskAgain: true });
        setState('error');
      }
    },
    [clearStopTimer],
  );

  useEffect(() => {
    beginRef.current = begin;
  }, [begin]);

  const start = useCallback(async () => {
    // One attempt at a time: a second tap while one is starting or listening does nothing.
    if (starting.current || active.current) return;
    starting.current = true;
    retriedOther.current = false;
    // The hint comes from the phone each time it starts, so a language change in Settings is
    // picked up without leaving the app. Where the platform identifies the language itself, the
    // hint is never sent and the spoken language decides.
    await begin(autoVoiceLocale(), false);
  }, [begin]);

  const finish = useCallback(() => {
    // The final result then arrives as `onResult`; a quiet recording ends in `no_speech`.
    void nativeSpeech()
      ?.stop()
      .catch(() => undefined);
    setState((current) => (current === 'listening' ? 'processing' : current));
    // A recognizer that never answers must not leave the window on "Finishing…": after a short
    // wait the words heard so far are shown, or the customer is told nothing was heard.
    clearStopTimer();
    stopTimer.current = setTimeout(() => {
      stopTimer.current = null;
      if (!active.current) return;
      active.current = false;
      setLevel(0);
      if (hasText.current) {
        setState((current) => (current === 'processing' ? 'ready' : current));
        return;
      }
      // Nothing was heard before Stop: say so rather than showing an empty box.
      setProblem({ code: 'no_speech', canAskAgain: true });
      setState((current) => (current === 'processing' ? 'error' : current));
    }, STOP_TIMEOUT_MS);
  }, [clearStopTimer]);

  const cancel = useCallback(() => {
    clearStopTimer();
    release();
    starting.current = false;
    typed.current = false;
    hasText.current = false;
    setText('');
    setHeard('');
    setLanguage(null);
    setLevel(0);
    setProblem(null);
    setState('idle');
  }, [clearStopTimer, release]);

  const edit = useCallback(
    (next: string) => {
      typed.current = true;
      hasText.current = next.trim() !== '';
      clearStopTimer();
      release();
      setLevel(0);
      setText(next);
      setLanguage(null);
      setProblem(null);
      setState('ready');
    },
    [clearStopTimer, release],
  );

  return { state, text, heard, language, level, problem, locale, start, finish, cancel, edit };
}
