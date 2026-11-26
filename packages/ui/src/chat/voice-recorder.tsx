'use client';

import {
  CHAT_AUDIO_MAX_DURATION_MS,
  chatMediaMaxBytes,
  chatMediaMaxLabel,
} from '@nilzora/contracts';
import { Clock, LoaderCircle, Mic, Pause, Play, Send, Square, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Every recorder button. Below `sm` (every phone) and on any touch screen (`pointer-coarse`) it is
 * 44px square, the minimum touch target; only a mouse at `sm` and wider gets the compact 36px
 * button. `shrink-0` is load-bearing: in a flex row a button would otherwise give up width to its
 * neighbours and fall under 44px.
 */
const VOICE_BUTTON =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-full sm:size-9 sm:pointer-coarse:size-11';

/*
 * The voice recorder
 * ------------------
 * A browser recording made with `MediaRecorder`, which every current browser on a desktop or an
 * Android phone provides; no dependency is added for it. The microphone is opened only when
 * someone presses record, and both the recorder's tracks and the object URL are released on
 * stop, on discard and when the form goes away — a composer that kept a microphone open after a
 * cancelled message would be a real privacy problem, not just a leak.
 *
 * The format is whatever the browser actually produced, read from `MediaRecorder.mimeType`, and
 * mapped onto the server's audio allowlist. A browser whose recorder produces something else (or
 * none at all) is told plainly rather than being allowed to send a file the API will refuse.
 *
 * The ceilings are the shared contract's: five minutes and 10 MB, checked before anything is
 * uploaded, so a long take is stopped rather than sent and rejected.
 *
 * One component serves the customer's storefront widget and the Admin Communication Center, so
 * both sides of a conversation record a voice note the same way.
 */

const MAX_BYTES = chatMediaMaxBytes('audio');
const MAX_LABEL = chatMediaMaxLabel('audio');
const MAX_DURATION_MS = CHAT_AUDIO_MAX_DURATION_MS;

/** The audio types a browser may report, in the order we ask for them. */
const PREFERRED_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4'] as const;

/** The container a browser's recorder reports → the type the server accepts. */
function mappedTypeOf(reported: string): 'audio/webm' | 'audio/ogg' | 'audio/mp4' | null {
  const normalised = reported.split(';')[0]?.trim().toLowerCase() ?? '';
  if (normalised === 'audio/webm' || normalised === 'audio/ogg' || normalised === 'audio/mp4') {
    return normalised;
  }
  return null;
}

function extensionFor(type: string): string {
  if (type === 'audio/ogg') return 'ogg';
  if (type === 'audio/mp4') return 'm4a';
  return 'webm';
}

function clockOf(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export interface RecordedVoice {
  blob: Blob;
  contentType: 'audio/webm' | 'audio/ogg' | 'audio/mp4';
  durationMs: number;
  fileName: string;
}

export type VoiceRecorderState = 'idle' | 'recording' | 'paused' | 'recorded' | 'unsupported';

export function VoiceRecorder({
  onRecorded,
  onDiscard,
  disabled,
  maxDurationMs = MAX_DURATION_MS,
  autoStart = false,
  onSend,
}: {
  onRecorded: (voice: RecordedVoice) => void;
  onDiscard: () => void;
  disabled: boolean;
  /**
   * Begin recording as soon as the recorder appears. Only for a recorder the person summoned with
   * an explicit press (the composer's microphone button): it is the press that asks for the
   * microphone, never the page loading.
   */
  autoStart?: boolean;
  /**
   * When given, the finished take stays on screen with its length and a player, and a Send button
   * next to Discard: the person hears it and decides. Without it the recorder only reports the
   * take through `onRecorded` and leaves the decision to the host form.
   */
  onSend?: () => void;
  /** The ceiling, overridable only so a test can witness it without waiting five minutes. */
  maxDurationMs?: number;
}) {
  const ceiling = maxDurationMs;
  const [state, setState] = useState<VoiceRecorderState>('idle');
  const [durationMs, setDurationMs] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const elapsed = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const url = useRef<string | null>(null);
  const alive = useRef(true);
  const autoStarted = useRef(false);

  const stopTimer = useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  /** Releases the object URL and any preview element's source. */
  const releaseUrl = useCallback(() => {
    const current = url.current;
    url.current = null;
    setPreviewUrl(null);
    if (current !== null) URL.revokeObjectURL(current);
  }, []);

  // Leaving the form mid-recording must close the microphone and free the blob.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(
    () => () => {
      stopTimer();
      const active = recorder.current;
      if (active !== null && active.state !== 'inactive') active.stop();
      active?.stream.getTracks().forEach((track) => {
        track.stop();
      });
      recorder.current = null;
      const current = url.current;
      if (current !== null) URL.revokeObjectURL(current);
    },
    [stopTimer],
  );

  const supported = useCallback((): boolean => {
    return (
      typeof window !== 'undefined' &&
      typeof window.MediaRecorder !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function'
    );
  }, []);

  const start = useCallback(async () => {
    setFailure(null);
    if (!supported()) {
      setState('unsupported');
      setFailure('This browser cannot record audio. Use the file upload instead.');
      return;
    }
    const type = PREFERRED_TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (type === undefined) {
      setState('unsupported');
      setFailure('This browser cannot record audio in a format Nilzora accepts.');
      return;
    }
    try {
      // Permission is requested here — at the moment of recording, never on page load.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current) {
        // The recorder went away while the browser was asking: do not leave the microphone open.
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }
      const media = new MediaRecorder(stream, { mimeType: type });
      chunks.current = [];
      media.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      media.onstop = () => {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        const recorded = new Blob(chunks.current, { type: media.mimeType || type });
        const contentType = mappedTypeOf(media.mimeType || type) ?? type;
        const finalDuration = elapsed.current + (Date.now() - startedAt.current);
        if (recorded.size === 0) {
          setFailure('The recording came out empty. Try again.');
          setState('idle');
          return;
        }
        if (recorded.size > MAX_BYTES) {
          setFailure(`That recording is larger than ${MAX_LABEL}. Keep it shorter.`);
          setState('idle');
          return;
        }
        if (finalDuration > ceiling) {
          setFailure('A voice message may be at most five minutes long.');
          setState('idle');
          return;
        }
        releaseUrl();
        const objectUrl = URL.createObjectURL(recorded);
        url.current = objectUrl;
        setPreviewUrl(objectUrl);
        setDurationMs(finalDuration);
        setState('recorded');
        onRecorded({
          blob: recorded,
          contentType,
          durationMs: Math.max(1, Math.round(finalDuration)),
          fileName: `voice-${String(Date.now())}.${extensionFor(contentType)}`,
        });
      };
      recorder.current = media;
      startedAt.current = Date.now();
      elapsed.current = 0;
      setDurationMs(0);
      media.start();
      setState('recording');
      stopTimer();
      timer.current = setInterval(() => {
        const total = elapsed.current + (Date.now() - startedAt.current);
        setDurationMs(total);
        if (total >= ceiling) {
          // Stop at the ceiling rather than letting the operator record something unsendable.
          setFailure('A voice message may be at most five minutes long.');
          media.stop();
          stopTimer();
        }
      }, 250);
    } catch (error) {
      if (!alive.current) return;
      setState('idle');
      const name = (error as { name?: unknown } | null)?.name;
      setFailure(
        name === 'NotFoundError' || name === 'OverconstrainedError'
          ? 'No microphone was found on this device.'
          : 'Nilzora needs permission to use your microphone. Allow it for this site in your browser settings, then try again.',
      );
    }
  }, [ceiling, onRecorded, releaseUrl, stopTimer, supported]);

  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    autoStarted.current = true;
    void start();
  }, [autoStart, start]);

  const pause = useCallback(() => {
    const active = recorder.current;
    if (active === null || active.state !== 'recording') return;
    active.pause();
    elapsed.current += Date.now() - startedAt.current;
    stopTimer();
    setState('paused');
  }, [stopTimer]);

  const resume = useCallback(() => {
    const active = recorder.current;
    if (active === null || active.state !== 'paused') return;
    startedAt.current = Date.now();
    active.resume();
    setState('recording');
    timer.current = setInterval(() => {
      setDurationMs(elapsed.current + (Date.now() - startedAt.current));
    }, 250);
  }, []);

  const stop = useCallback(() => {
    const active = recorder.current;
    if (active === null || active.state === 'inactive') return;
    // A paused recorder's elapsed time was already banked, so only a running one adds more.
    if (active.state === 'recording') elapsed.current += Date.now() - startedAt.current;
    stopTimer();
    active.stop();
  }, [stopTimer]);

  const discard = useCallback(() => {
    const active = recorder.current;
    if (active !== null && active.state !== 'inactive') {
      // Cancelling throws the take away: its events are unhooked first so no blob is published,
      // then the recorder is stopped and the microphone closed.
      active.ondataavailable = null;
      active.onstop = null;
      active.stop();
      active.stream.getTracks().forEach((track) => {
        track.stop();
      });
    }
    recorder.current = null;
    stopTimer();
    elapsed.current = 0;
    releaseUrl();
    setDurationMs(0);
    setState('idle');
    setFailure(null);
    onDiscard();
  }, [onDiscard, releaseUrl, stopTimer]);

  return (
    <div className="grid min-w-0 gap-1">
      {state === 'recorded' && previewUrl !== null ? (
        // The player takes a row of its own, the full width of the composer, and the controls sit
        // under it: a player squeezed beside two 44px buttons pushed Send off a 360px screen.
        // A plain element with the blob's URL: no autoplay, and the listener hears the take
        // before deciding to send it. A recording cannot carry a caption track.
        // eslint-disable-next-line jsx-a11y/media-has-caption -- a voice message has no captions
        <audio src={previewUrl} controls preload="metadata" className="h-10 w-full min-w-0" />
      ) : null}
      {/* `flex-wrap` is the safety net: at 320px or in a narrow admin pane the controls drop to a
          second line instead of overflowing. The clock takes the slack (`mr-auto`), so the
          buttons stay together on the right. */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span
          className="mr-auto flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground"
          aria-live="polite"
        >
          <Clock aria-hidden className="size-3" />
          {clockOf(durationMs)}
          <span className="text-muted-foreground/70">/ max {MAX_LABEL}</span>
        </span>

        {state === 'recording' ? (
          <>
            <button
              type="button"
              onClick={pause}
              aria-label="Pause recording"
              className={`${VOICE_BUTTON} bg-surface-muted text-foreground`}
            >
              <Pause aria-hidden className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={stop}
              aria-label="Stop recording"
              className={`${VOICE_BUTTON} bg-danger text-white`}
            >
              <Square aria-hidden className="size-3" />
            </button>
          </>
        ) : state === 'paused' ? (
          <>
            <button
              type="button"
              onClick={resume}
              aria-label="Resume recording"
              className={`${VOICE_BUTTON} bg-surface-muted text-foreground`}
            >
              <Play aria-hidden className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={stop}
              aria-label="Stop recording"
              className={`${VOICE_BUTTON} bg-danger text-white`}
            >
              <Square aria-hidden className="size-3" />
            </button>
          </>
        ) : state === 'recorded' ? (
          <>
            <button
              type="button"
              onClick={discard}
              aria-label="Discard the recording"
              className={`${VOICE_BUTTON} bg-surface-muted text-danger`}
            >
              <Trash2 aria-hidden className="size-3.5" />
            </button>
            {onSend === undefined ? null : (
              <button
                type="button"
                onClick={onSend}
                aria-label="Send the voice message"
                className={`${VOICE_BUTTON} bg-primary-action text-primary-action-foreground`}
              >
                <Send aria-hidden className="size-3.5" />
              </button>
            )}
          </>
        ) : (
          <>
            {autoStart ? (
              <button
                type="button"
                onClick={() => {
                  onDiscard();
                }}
                aria-label="Close the recorder"
                className={`${VOICE_BUTTON} text-muted-foreground`}
              >
                <X aria-hidden className="size-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void start()}
              disabled={disabled}
              aria-label="Record a voice message"
              className={`${VOICE_BUTTON} bg-surface-muted text-foreground disabled:opacity-50`}
            >
              {disabled ? (
                <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
              ) : (
                <Mic aria-hidden className="size-3.5" />
              )}
            </button>
          </>
        )}
        {state === 'recording' || state === 'paused' ? (
          <button
            type="button"
            onClick={discard}
            aria-label="Cancel the recording"
            className={`${VOICE_BUTTON} text-muted-foreground`}
          >
            <Trash2 aria-hidden className="size-3.5" />
          </button>
        ) : null}
      </div>
      {failure === null ? null : (
        <p role="alert" className="text-[11px] text-danger">
          {failure}
        </p>
      )}
    </div>
  );
}
