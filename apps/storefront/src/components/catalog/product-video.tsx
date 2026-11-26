'use client';

import type { ProductVideo } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { CircleAlert, LoaderCircle, Play, RotateCcw } from 'lucide-react';
import { useRef, useState } from 'react';

/*
 * Product videos inside the gallery. The stage is a native HTML5 player in the same square
 * frame as the pictures, with the browser's own accessible controls (play, seek, volume, full
 * screen). Nothing is autoplayed. Buffering shows a spinner, and a file the browser cannot play
 * says so in place, with a retry, instead of sending the shopper elsewhere.
 *
 * The thumbnail is the video's own first frame: `#t=0.1` asks the browser to seek just past the
 * start once the metadata has loaded, so no separate poster image has to exist.
 */

type StageState = 'idle' | 'loading' | 'ready' | 'buffering' | 'error';

export function ProductVideoStage({
  video,
  productName,
  position,
}: {
  video: ProductVideo;
  productName: string;
  /** 1-based number among the product's videos, for the accessible name. */
  position: number;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<StageState>('idle');
  const label = video.title ?? `${productName}, video ${String(position)}`;

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-black ring-1 ring-border ring-inset">
      <video
        ref={ref}
        // A fresh element per video, so a previous one never keeps playing behind it.
        key={video.id}
        controls
        playsInline
        preload="metadata"
        aria-label={label}
        className="size-full object-contain"
        onLoadStart={() => {
          setState('loading');
        }}
        onLoadedData={() => {
          setState('ready');
        }}
        onWaiting={() => {
          setState('buffering');
        }}
        onPlaying={() => {
          setState('ready');
        }}
        onCanPlay={() => {
          setState((current) => (current === 'error' ? current : 'ready'));
        }}
        onError={() => {
          setState('error');
        }}
      >
        <source src={video.url} type={video.contentType} />
      </video>

      {state === 'loading' || state === 'buffering' ? (
        <span
          role="status"
          className="pointer-events-none absolute inset-0 grid place-items-center"
        >
          <LoaderCircle aria-hidden="true" className="size-9 animate-spin text-white/90" />
          <span className="sr-only">{state === 'loading' ? 'Loading the video' : 'Buffering'}</span>
        </span>
      ) : null}

      {state === 'error' ? (
        <div
          role="alert"
          className="absolute inset-0 grid place-items-center bg-black/80 p-6 text-center text-white"
        >
          <div className="grid justify-items-center gap-3">
            <CircleAlert aria-hidden="true" className="size-8" />
            <p className="text-sm font-medium">This video could not be played right now.</p>
            <button
              type="button"
              onClick={() => {
                setState('loading');
                ref.current?.load();
              }}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-semibold text-foreground"
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              Try again
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A gallery thumbnail for a video: its first frame, a play mark and a "Video" tag. */
export function ProductVideoThumb({
  video,
  className,
}: {
  video: ProductVideo;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={cn('relative block size-full bg-slate-900', className)}>
      {failed ? null : (
        <video
          src={`${video.url}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
          aria-hidden="true"
          className="size-full object-cover"
          onError={() => {
            setFailed(true);
          }}
        />
      )}
      <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-black/25">
        <span className="grid size-7 place-items-center rounded-full bg-white/90 shadow">
          <Play className="ml-0.5 size-3.5 fill-current text-foreground" />
        </span>
      </span>
      <span
        aria-hidden="true"
        className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 text-[9px] font-semibold tracking-wide text-white uppercase"
      >
        Video
      </span>
    </span>
  );
}
