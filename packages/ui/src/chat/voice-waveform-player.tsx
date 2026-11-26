'use client';

import { Pause, Play, RotateCw } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import { cn } from '../lib/cn';

/*
 * A voice message on the web
 * --------------------------
 * A play button with a thin ring, the recording's waveform and its time — no filled colour block.
 * The bars are the recording's real loudness: the audio file is decoded in the browser (Web Audio)
 * and each bar is the peak of its slice. If the browser cannot decode it, the bars are all the
 * same low height, an honest "audio" mark rather than an invented shape. Played bars are drawn in
 * the strong ink; tapping or dragging on the bars seeks there, and the arrow keys step through it.
 */

export const VOICE_BARS = 40;
const RESTING = 0.18;

/** Peaks already computed, per media URL, so a re-render or a remount does not decode again. */
const peakCache = new Map<string, Promise<number[] | null>>();

/** The peak of each of `bars` slices of the first channel, scaled so the loudest bar is 1. */
export function peaksFromSamples(samples: Float32Array, bars = VOICE_BARS): number[] {
  if (samples.length === 0) return [];
  const out: number[] = [];
  for (let i = 0; i < bars; i += 1) {
    const from = Math.floor((i * samples.length) / bars);
    const to = Math.max(from + 1, Math.floor(((i + 1) * samples.length) / bars));
    let peak = 0;
    for (let j = from; j < to; j += 1) peak = Math.max(peak, Math.abs(samples[j] ?? 0));
    out.push(peak);
  }
  const loudest = Math.max(...out);
  return loudest <= 0
    ? out.map(() => 0)
    : out.map((peak) => Math.round((peak / loudest) * 100) / 100);
}

async function decodePeaks(url: string): Promise<number[] | null> {
  const Context =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (Context === undefined || typeof fetch !== 'function') return null;
  try {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    const context = new Context();
    try {
      const audio = await context.decodeAudioData(bytes);
      return peaksFromSamples(audio.getChannelData(0));
    } finally {
      void context.close().catch(() => undefined);
    }
  } catch {
    return null;
  }
}

function usePeaks(url: string, holder: RefObject<HTMLDivElement | null>): number[] | null {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    let alive = true;
    const start = () => {
      let pending = peakCache.get(url);
      if (pending === undefined) {
        pending = decodePeaks(url);
        peakCache.set(url, pending);
      }
      void pending.then((value) => {
        if (alive) setPeaks(value);
      });
    };
    // Decode only once the player is on screen: a long thread does not download every recording.
    const element = holder.current;
    if (element === null || typeof IntersectionObserver === 'undefined') {
      start();
      return () => {
        alive = false;
      };
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        start();
      }
    });
    observer.observe(element);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [url, holder]);
  return peaks;
}

function clock(milliseconds: number): string {
  const total = Math.max(0, Math.round(milliseconds / 1000));
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, '0')}`;
}

/** Only one voice message plays at a time on the page. */
let speaking: HTMLAudioElement | null = null;

export function VoiceWaveformPlayer({
  url,
  durationMs,
  className,
}: {
  url: string;
  durationMs: number | null;
  className?: string;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const holder = useRef<HTMLDivElement | null>(null);
  const decoded = usePeaks(url, holder);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState((durationMs ?? 0) / 1000);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const dragging = useRef(false);

  const bars =
    decoded !== null && decoded.length > 0 ? decoded : Array<number>(VOICE_BARS).fill(RESTING);
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;
  const played = Math.round(progress * bars.length);

  useEffect(
    () => () => {
      if (speaking === audio.current) speaking = null;
    },
    [],
  );

  const toggle = () => {
    const element = audio.current;
    if (element === null) return;
    if (!element.paused) {
      element.pause();
      return;
    }
    if (speaking !== null && speaking !== element) speaking.pause();
    speaking = element;
    void element.play().catch(() => setFailed(true));
  };

  const seekTo = (fraction: number) => {
    const element = audio.current;
    if (element === null || duration <= 0) return;
    const at = Math.min(1, Math.max(0, fraction)) * duration;
    element.currentTime = at;
    setPosition(at);
  };

  const seekFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width > 0) seekTo((event.clientX - box.left) / box.width);
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    const step = event.key === 'ArrowRight' ? 5 : event.key === 'ArrowLeft' ? -5 : null;
    if (event.key === 'Home') seekTo(0);
    else if (event.key === 'End') seekTo(1);
    else if (step !== null) seekTo((position + step) / duration);
    else return;
    event.preventDefault();
  };

  if (failed) {
    return (
      <button
        type="button"
        onClick={() => {
          setFailed(false);
          setAttempt((value) => value + 1);
        }}
        className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-surface px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <RotateCw aria-hidden className="size-3" />
        This recording could not be loaded. Try again.
      </button>
    );
  }

  return (
    <div
      ref={holder}
      className={cn('flex w-64 max-w-full items-center gap-2.5 py-0.5', className)}
      data-testid="voice-player"
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause the voice message' : 'Play the voice message'}
        className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-background text-foreground transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {playing ? (
          <Pause aria-hidden className="size-4 fill-current" />
        ) : (
          <Play aria-hidden className="size-4 translate-x-px fill-current" />
        )}
      </button>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <div
          role="slider"
          tabIndex={0}
          aria-label="Position in the voice message"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(position)}
          aria-valuetext={`${clock(position * 1000)} of ${clock(duration * 1000)}`}
          onKeyDown={onKey}
          onPointerDown={(event) => {
            dragging.current = true;
            event.currentTarget.setPointerCapture?.(event.pointerId);
            seekFromPointer(event);
          }}
          onPointerMove={(event) => {
            if (dragging.current) seekFromPointer(event);
          }}
          onPointerUp={() => {
            dragging.current = false;
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
          className="flex h-7 cursor-pointer touch-none items-center justify-between rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {bars.map((peak, index) => (
            <span
              // The bars never reorder: their index is their identity.
              key={index}
              aria-hidden
              data-played={index < played ? 'true' : undefined}
              className={cn(
                'w-[3px] rounded-full transition-colors',
                index < played ? 'bg-foreground' : 'bg-border',
              )}
              style={{ height: `${String(Math.round(3 + 21 * Math.min(1, Math.max(0, peak))))}px` }}
            />
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {position > 0
            ? `${clock(position * 1000)} / ${clock(duration * 1000)}`
            : clock(duration * 1000)}
        </span>
      </div>
      {/* A spoken recording has no caption track to offer; the player is the message itself. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a voice message cannot carry captions */}
      <audio
        key={attempt}
        ref={audio}
        preload="metadata"
        src={url}
        onError={() => setFailed(true)}
        onLoadedMetadata={(event) => {
          const seconds = event.currentTarget.duration;
          if (Number.isFinite(seconds) && seconds > 0) setDuration(seconds);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onEnded={() => {
          setPlaying(false);
          setPosition(0);
        }}
        className="hidden"
      />
    </div>
  );
}
