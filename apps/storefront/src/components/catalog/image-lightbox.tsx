'use client';

import { cn } from '@nilzora/ui';
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent } from 'react';

export interface LightboxImage {
  /** The full-size picture. */
  url: string;
  /** The small version, for the strip of thumbnails. */
  thumbUrl: string;
  alt: string;
}

/** How far a finger must travel sideways for a swipe to change the picture. */
export const SWIPE_DISTANCE = 48;

/** The picture `step` places from `index`, wrapping round at either end. */
export function wrapIndex(index: number, step: number, count: number): number {
  if (count <= 0) return 0;
  return (((index + step) % count) + count) % count;
}

/**
 * A sideways swipe as a step (+1 next, −1 previous), or 0 for a tap, a scroll or a short drag.
 * Mostly-vertical movement is never a swipe, so the page can still be scrolled.
 */
export function swipeStep(dx: number, dy: number): number {
  if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}

export interface ImageLightboxProps {
  images: readonly LightboxImage[];
  /** The picture on show; null while the viewer is closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** Names the viewer for assistive technology, e.g. "Pictures of Clay Mug". */
  label: string;
}

/**
 * Full-screen pictures on the native <dialog>: focus stays inside, the page behind is inert
 * and Escape closes it, returning focus to whatever opened it. The arrow keys, the buttons and
 * a sideways swipe move between pictures; a picture can be zoomed to look closer.
 */
export function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
  label,
}: ImageLightboxProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const open = index !== null && images.length > 0;
  const current = open ? images[Math.min(index, images.length - 1)] : undefined;
  const count = images.length;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const move = (step: number) => {
    if (index === null || count < 2) return;
    setZoom(null);
    onIndexChange(wrapIndex(index, step, count));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    start.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const from = start.current;
    start.current = null;
    if (!from || zoom) return;
    const step = swipeStep(event.clientX - from.x, event.clientY - from.y);
    if (step !== 0) move(step);
  };

  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        setZoom(null);
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          move(1);
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          move(-1);
        }
      }}
      className="m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-brand-navy/95 p-0 text-white backdrop:bg-brand-navy/80 open:flex open:flex-col"
    >
      {current && index !== null ? (
        <>
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <p className="text-sm font-medium text-white/80 tabular-nums" aria-live="polite">
              {count > 1 ? `Picture ${index + 1} of ${count}` : current.alt}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-pressed={zoom !== null}
                aria-label={zoom ? 'Zoom out' : 'Zoom in'}
                onClick={() => setZoom(zoom ? null : { x: 50, y: 50 })}
                className="grid size-11 place-items-center rounded-full text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                {zoom ? (
                  <ZoomOut aria-hidden="true" className="size-5" />
                ) : (
                  <ZoomIn aria-hidden="true" className="size-5" />
                )}
              </button>
              <button
                type="button"
                aria-label="Close"
                autoFocus
                onClick={() => {
                  setZoom(null);
                  onClose();
                }}
                className="grid size-11 place-items-center rounded-full text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>
          </div>

          <div
            className="relative flex min-h-0 flex-1 touch-pan-y touch-pinch-zoom items-center justify-center overflow-hidden px-2 sm:px-16"
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              start.current = null;
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- already-optimised WebP from the media service */}
            <img
              key={current.url}
              src={current.url}
              alt={current.alt}
              draggable={false}
              onClick={(event) => {
                if (zoom) {
                  setZoom(null);
                  return;
                }
                const box = event.currentTarget.getBoundingClientRect();
                setZoom({
                  x: ((event.clientX - box.left) / box.width) * 100,
                  y: ((event.clientY - box.top) / box.height) * 100,
                });
              }}
              onPointerMove={(event) => {
                // With a mouse, a zoomed picture follows the pointer so every part can be seen.
                if (!zoom || event.pointerType !== 'mouse') return;
                const box = event.currentTarget.getBoundingClientRect();
                setZoom({
                  x: Math.min(100, Math.max(0, ((event.clientX - box.left) / box.width) * 100)),
                  y: Math.min(100, Math.max(0, ((event.clientY - box.top) / box.height) * 100)),
                });
              }}
              style={zoom ? { transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined}
              className={cn(
                'max-h-full max-w-full object-contain transition-transform duration-200 select-none motion-reduce:transition-none',
                zoom ? 'scale-[2.2] cursor-zoom-out' : 'cursor-zoom-in',
              )}
            />
            {count > 1 ? (
              <>
                <button
                  type="button"
                  aria-label="Previous picture"
                  onClick={() => move(-1)}
                  className="absolute top-1/2 left-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/12 text-white backdrop-blur transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:left-4"
                >
                  <ChevronLeft aria-hidden="true" className="size-5" />
                </button>
                <button
                  type="button"
                  aria-label="Next picture"
                  onClick={() => move(1)}
                  className="absolute top-1/2 right-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/12 text-white backdrop-blur transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:right-4"
                >
                  <ChevronRight aria-hidden="true" className="size-5" />
                </button>
              </>
            ) : null}
          </div>

          {count > 1 ? (
            <div
              role="group"
              aria-label="Choose a picture"
              className="flex justify-center gap-2 overflow-x-auto px-4 py-3 sm:py-4"
            >
              {images.map((image, position) => (
                <button
                  key={image.url}
                  type="button"
                  aria-pressed={position === index}
                  aria-label={`Show picture ${position + 1} of ${count}`}
                  onClick={() => {
                    setZoom(null);
                    onIndexChange(position);
                  }}
                  className={cn(
                    'size-14 shrink-0 overflow-hidden rounded-lg ring-1 ring-white/25 transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
                    position === index
                      ? 'opacity-100 ring-2 ring-white'
                      : 'opacity-60 hover:opacity-90',
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- already-optimised WebP from the media service */}
                  <img
                    src={image.thumbUrl}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover"
                  />
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </dialog>
  );
}
