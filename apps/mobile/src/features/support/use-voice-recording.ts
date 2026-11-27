import {
  CHAT_AUDIO_MAX_DURATION_MS,
  chatMediaMaxBytes,
  chatMediaMaxLabel,
  type CHAT_AUDIO_TYPES,
} from '@nilzora/contracts';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { levelOfMetering } from './voice-waveforms';
import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * Recording a voice message
 * -------------------------
 * The microphone is opened only when the person taps record, and closed the moment they stop or
 * leave the screen. Permission denial, an interrupted session and an unsupported environment are
 * all reported as sentences rather than thrown: a refusal must not take the conversation down.
 *
 * Voice is a speech recording, not music, so the preset is narrowed to one channel at 64 kbps —
 * the same audible quality for a spoken message at roughly half the bytes. The file is a
 * `.m4a` (AAC in an MP4 container) on Android and iOS, which is the `audio/mp4` the server
 * accepts and whose `ftyp` signature it can check; on web the platform records WebM instead, so
 * the type is derived from the file the recorder actually produced.
 *
 * The recording is a temporary file. It is deleted when the person discards it, and when the
 * screen unmounts with an unsent recording, so a cancelled message never leaks storage.
 */

/** One channel, 64 kbps: ample for speech, and half the bytes of the 128 kbps preset. */
const VOICE_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 64000,
  android: { ...RecordingPresets.HIGH_QUALITY.android, outputFormat: 'mpeg4', audioEncoder: 'aac' },
  // The input level, read with each status poll, is what the voice message's waveform is drawn
  // from: the loudness actually recorded, not a decorative pattern.
  isMeteringEnabled: true,
};

const MAX_BYTES = chatMediaMaxBytes('audio');
const MAX_LABEL = chatMediaMaxLabel('audio');
const MAX_DURATION_MS = CHAT_AUDIO_MAX_DURATION_MS;

export type VoicePhase = 'idle' | 'recording' | 'paused' | 'recorded';

export interface VoiceRecording {
  uri: string;
  /** What the server is told, and what the player shows before the audio has loaded. */
  durationMs: number;
  contentType: (typeof CHAT_AUDIO_TYPES)[number];
  byteSize: number;
  /** The input level (0–1) sampled while recording, oldest first; empty when none was read. */
  levels: number[];
}

/** The type of a recording, from the file the recorder produced (never from a guess). */
function contentTypeOf(uri: string): (typeof CHAT_AUDIO_TYPES)[number] | null {
  const extension = uri.split('?')[0]?.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'm4a' || extension === 'mp4' || extension === 'aac') return 'audio/mp4';
  if (extension === 'webm') return 'audio/webm';
  if (extension === 'ogg' || extension === 'opus') return 'audio/ogg';
  if (extension === 'mp3') return 'audio/mpeg';
  if (extension === 'wav') return 'audio/wav';
  return null;
}

function formatClock(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export interface VoiceRecorder {
  phase: VoicePhase;
  /** "0:07" while recording, so the control can show it without a timer of its own. */
  clock: string;
  durationMs: number;
  failure: string | null;
  /** True when the failure is the operating system refusing the microphone (Settings can fix it). */
  denied: boolean;
  /** A take the recorder stopped on its own, when it reached the length ceiling. */
  finished: VoiceRecording | null;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<VoiceRecording | null>;
  cancel: () => void;
  /** Deletes a recorded file that will not be sent (after a discard or a screen change). */
  discard: () => void;
}

export function useVoiceRecorder(): VoiceRecorder {
  const recorder = useAudioRecorder(VOICE_OPTIONS);
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [durationMs, setDurationMs] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  /** The take the recorder stopped by itself at the length ceiling. */
  const [finished, setFinished] = useState<VoiceRecording | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const produced = useRef<string | null>(null);
  /** The levels of the take being recorded, one per status poll. */
  const levels = useRef<number[]>([]);
  /** The current `stop`, so the length timer can end the recording without reordering the hook. */
  const stopRef = useRef<(() => Promise<VoiceRecording | null>) | null>(null);

  const stopTimer = useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  /** Removes the temporary file, if this hook produced one. */
  const discard = useCallback(() => {
    const uri = produced.current;
    produced.current = null;
    if (uri === null) return;
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      // The operating system may already have removed it; nothing to report.
    }
  }, []);

  // Leaving the screen mid-recording must stop the microphone and remove the file.
  useEffect(
    () => () => {
      stopTimer();
      void (async () => {
        try {
          await recorder.stop();
        } catch {
          // Nothing was being recorded.
        }
        discard();
      })();
    },
    [discard, recorder, stopTimer],
  );

  const startTimer = useCallback(() => {
    stopTimer();
    timer.current = setInterval(() => {
      const status = recorder.getStatus();
      setDurationMs(status.durationMillis);
      const level = levelOfMetering(status.metering);
      if (level !== null) levels.current.push(level);
      // The ceiling is a product rule, not a guess: end the recording rather than let it grow to
      // something the API would refuse, and hand the customer what they said up to the limit.
      if (status.durationMillis >= MAX_DURATION_MS) {
        stopTimer();
        setFailure('A voice message may be at most five minutes long.');
        void (async () => {
          const take = await (stopRef.current?.() ?? Promise.resolve(null));
          if (take !== null) setFinished(take);
        })();
      }
    }, 250);
  }, [recorder, stopTimer]);

  const start = useCallback(async () => {
    setFailure(null);
    setDenied(false);
    setDurationMs(0);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setFailure(
          'Nilzora needs permission to use your microphone for a voice message. Turn it on in Settings.',
        );
        setDenied(true);
        return;
      }
      // Recording while capturing audio in the app's audio session (the default) keeps the
      // message audible on a call-less device and is what Expo recommends for voice notes.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      produced.current = null;
      levels.current = [];
      setPhase('recording');
      startTimer();
    } catch {
      setFailure('The microphone could not be started. Try again.');
      setPhase('idle');
      stopTimer();
    }
  }, [recorder, startTimer, stopTimer]);

  const pause = useCallback(() => {
    try {
      recorder.pause();
      setPhase('paused');
      stopTimer();
    } catch {
      setFailure('The recording could not be paused.');
    }
  }, [recorder, stopTimer]);

  const resume = useCallback(() => {
    try {
      recorder.record();
      setPhase('recording');
      startTimer();
    } catch {
      setFailure('The recording could not be resumed.');
    }
  }, [recorder, startTimer]);

  const stop = useCallback(async (): Promise<VoiceRecording | null> => {
    stopTimer();
    try {
      await recorder.stop();
    } catch {
      setFailure('The recording could not be saved. Try again.');
      setPhase('idle');
      return null;
    }
    const uri = recorder.uri;
    if (uri === null) {
      setFailure('The recording could not be saved. Try again.');
      setPhase('idle');
      return null;
    }
    // Remember the file now, whatever happens next: a take this hook cannot send must still be
    // removed rather than left in the cache.
    produced.current = uri;
    const contentType = contentTypeOf(uri);
    if (contentType === null) {
      discard();
      setFailure('This device recorded a format Nilzora cannot send. Try again.');
      setPhase('idle');
      return null;
    }
    let byteSize = 0;
    try {
      byteSize = new File(uri).size ?? 0;
    } catch {
      byteSize = 0;
    }
    if (byteSize <= 0) {
      discard();
      setFailure('The recording came out empty. Try again.');
      setPhase('idle');
      return null;
    }
    if (byteSize > MAX_BYTES) {
      discard();
      setFailure(`That recording is larger than ${MAX_LABEL}. Keep it shorter.`);
      setPhase('idle');
      return null;
    }
    const finalDuration = Math.max(durationMs, recorder.getStatus().durationMillis);
    produced.current = uri;
    setPhase('recorded');
    return {
      uri,
      durationMs: Math.max(1, Math.round(finalDuration)),
      contentType,
      byteSize,
      levels: [...levels.current],
    };
  }, [discard, durationMs, recorder, stopTimer]);

  const cancel = useCallback(() => {
    stopTimer();
    void (async () => {
      try {
        await recorder.stop();
      } catch {
        // Nothing was being recorded.
      }
      discard();
      setPhase('idle');
      setDurationMs(0);
      setFailure(null);
      setFinished(null);
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    })();
  }, [discard, recorder, stopTimer]);

  useEffect(() => {
    stopRef.current = stop;
    return () => {
      stopRef.current = null;
    };
  }, [stop]);

  return {
    phase,
    clock: formatClock(durationMs),
    durationMs,
    failure,
    denied,
    finished,
    start,
    pause,
    resume,
    stop,
    cancel,
    discard,
  };
}

/** "0:07" for a stored voice message, from the duration the database recorded. */
export function voiceClock(milliseconds: number | null): string {
  return formatClock(milliseconds ?? 0);
}

export { MAX_DURATION_MS as VOICE_MAX_DURATION_MS, MAX_LABEL as VOICE_MAX_LABEL };
