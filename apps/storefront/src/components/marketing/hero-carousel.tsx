'use client';

import { cn } from '@nilzora/ui';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type { HeroSlide } from '@/lib/hero-slides';
import { usePageVisible, usePrefersReducedMotion } from '@/lib/use-motion-preferences';
import { BANNER_CAPTION, BANNER_CTA, BANNER_HEADING, BANNER_SUBTEXT } from './banner-treatment';

/** A brisk but readable pace: each banner stays up for three and a half seconds. */
const INTERVAL_MS = 3500;
/** Horizontal travel, in CSS pixels, that counts as a swipe. */
const SWIPE_PX = 40;

function SlidePicture({
  slide,
  first,
  onLoad,
  onError,
}: {
  slide: HeroSlide;
  first: boolean;
  onLoad: (() => void) | undefined;
  onError: () => void;
}) {
  return (
    <picture>
      {slide.mobileSrc ? <source media="(max-width: 767px)" srcSet={slide.mobileSrc} /> : null}
      <img
        src={slide.desktopSrc}
        alt={slide.alt}
        loading={first ? 'eager' : 'lazy'}
        fetchPriority={first ? 'high' : 'auto'}
        decoding={first ? 'sync' : 'async'}
        draggable={false}
        onLoad={onLoad}
        onError={onError}
        className="size-full object-cover select-none"
      />
    </picture>
  );
}

/**
 * A slide's optional words, drawn on the artwork itself in a ~96% transparent container (a 4%
 * wash and a soft blur), so the banner stays the subject and the text never looks boxed. Nothing
 * is drawn for a picture-only banner.
 */
function SlideCaption({ slide }: { slide: HeroSlide }) {
  const heading = slide.heading ?? null;
  const text = slide.text ?? null;
  const cta = slide.ctaLabel ?? null;
  if (heading === null && text === null && cta === null) return null;
  return (
    <div
      className={cn(
        BANNER_CAPTION,
        'absolute bottom-11 left-3 max-w-[min(30rem,calc(100%-1.5rem))] justify-start sm:bottom-12 sm:left-5',
      )}
    >
      <div className="grid gap-0.5 sm:gap-1">
        {heading === null ? null : <p className={BANNER_HEADING}>{heading}</p>}
        {text === null ? null : <p className={BANNER_SUBTEXT}>{text}</p>}
      </div>
      {cta === null ? null : (
        <span className={BANNER_CTA}>
          {cta}
          <span aria-hidden="true">→</span>
        </span>
      )}
    </div>
  );
}

/**
 * The home banner carousel. It shows the uploaded artwork only: no text, button or tint is drawn
 * over a banner, and a banner with a link is one large link.
 *
 * - Advances every 3.5 seconds; pauses on hover, on keyboard focus, while the tab is hidden and
 *   when the visitor presses pause. It never auto-advances under prefers-reduced-motion.
 * - Arrows on larger screens, dots everywhere, swipe on touch screens, arrow keys when focused.
 * - The first banner loads eagerly with high priority; each later one is only requested shortly
 *   before it is shown.
 * - A banner whose image fails is dropped from the rotation; if none is left, `fallback` shows,
 *   so a broken image is never on screen.
 */
export function HeroCarousel({
  slides,
  fallback,
  className,
}: {
  slides: readonly HeroSlide[];
  fallback: ReactNode;
  className?: string;
}) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [requested, setRequested] = useState<ReadonlySet<string>>(
    () => new Set(slides.slice(0, 1).map((slide) => slide.id)),
  );
  const [current, setCurrent] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [stopped, setStopped] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const pageVisible = usePageVisible();
  const firstImage = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);

  const live = useMemo(() => slides.filter((slide) => !failed.has(slide.id)), [slides, failed]);
  const count = live.length;
  const index = count === 0 ? 0 : current % count;

  const request = useCallback((ids: readonly (string | undefined)[]) => {
    setRequested((previous) => {
      const missing = ids.filter((id): id is string => id !== undefined && !previous.has(id));
      return missing.length === 0 ? previous : new Set([...previous, ...missing]);
    });
  }, []);

  const fail = useCallback((id: string) => {
    setFailed((previous) => (previous.has(id) ? previous : new Set([...previous, id])));
  }, []);

  const goTo = useCallback(
    (next: number) => {
      if (count === 0) return;
      const target = ((next % count) + count) % count;
      setCurrent(target);
      request([live[target]?.id, live[(target + 1) % count]?.id]);
    },
    [count, live, request],
  );

  // An image that failed or finished before hydration fired its event too early to be seen.
  useEffect(() => {
    const image = firstImage.current?.querySelector('img');
    const first = slides[0];
    if (!image || !first || !image.complete) return;
    if (image.naturalWidth === 0) fail(first.id);
    else request([slides[1]?.id]);
  }, [slides, fail, request]);

  const autoplay = count > 1 && !hovered && !focused && !stopped && !reducedMotion && pageVisible;

  useEffect(() => {
    if (!autoplay) return;
    const timer = window.setTimeout(() => goTo(index + 1), INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [autoplay, index, goTo]);

  if (count === 0) return <>{fallback}</>;

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse') return;
    swipe.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy)) return;
    swiped.current = true;
    goTo(dx < 0 ? index + 1 : index - 1);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowRight') goTo(index + 1);
    else if (event.key === 'ArrowLeft') goTo(index - 1);
    else return;
    event.preventDefault();
  };

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured banners"
      className={cn('group/hero relative size-full touch-pan-y overflow-hidden', className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        swipe.current = null;
      }}
      onClickCapture={(event) => {
        // A swipe across a linked banner must not also open it.
        if (!swiped.current) return;
        swiped.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={onKeyDown}
    >
      <div aria-live={autoplay ? 'off' : 'polite'} className="relative size-full">
        {live.map((slide, i) => {
          const active = i === index;
          const isFirst = slide.id === slides[0]?.id;
          // The visible banner is always mounted, even if an earlier one failed before it was requested.
          const picture =
            active || requested.has(slide.id) ? (
              <SlidePicture
                slide={slide}
                first={isFirst}
                onLoad={active ? () => request([live[(i + 1) % count]?.id]) : undefined}
                onError={() => fail(slide.id)}
              />
            ) : null;
          return (
            <div
              key={slide.id}
              ref={isFirst ? firstImage : undefined}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
              aria-hidden={!active}
              inert={!active}
              className={cn(
                'absolute inset-0 transition-opacity duration-700 ease-soft motion-reduce:transition-none',
                active ? 'z-1 opacity-100' : 'opacity-0',
              )}
            >
              {slide.href ? (
                <Link
                  href={slide.href}
                  draggable={false}
                  className="block size-full focus-visible:-outline-offset-4"
                >
                  {picture}
                  <SlideCaption slide={slide} />
                </Link>
              ) : (
                <>
                  {picture}
                  <SlideCaption slide={slide} />
                </>
              )}
            </div>
          );
        })}
      </div>

      {count > 1 ? (
        <>
          <button
            type="button"
            aria-label="Previous banner"
            onClick={() => goTo(index - 1)}
            className="absolute top-1/2 left-2 z-2 grid size-7 before:absolute before:-inset-2 -translate-y-1/2 cursor-pointer place-items-center rounded-full nz-glass-control text-white opacity-80 transition-[opacity,background-color,scale] duration-300 hover:opacity-100 focus-visible:opacity-100 active:scale-95 motion-reduce:transition-none sm:left-3 md:size-8 md:opacity-0 md:group-hover/hero:opacity-100 md:focus-visible:opacity-100 lg:left-5"
          >
            <ChevronLeft aria-hidden="true" className="size-3 md:size-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="Next banner"
            onClick={() => goTo(index + 1)}
            className="absolute top-1/2 right-2 z-2 grid size-7 before:absolute before:-inset-2 -translate-y-1/2 cursor-pointer place-items-center rounded-full nz-glass-control text-white opacity-80 transition-[opacity,background-color,scale] duration-300 hover:opacity-100 focus-visible:opacity-100 active:scale-95 motion-reduce:transition-none sm:right-3 md:size-8 md:opacity-0 md:group-hover/hero:opacity-100 md:focus-visible:opacity-100 lg:right-5"
          >
            <ChevronRight aria-hidden="true" className="size-3 md:size-3.5" strokeWidth={2} />
          </button>

          <div className="absolute inset-x-0 bottom-1 z-2 flex justify-center sm:bottom-2">
            {/*
              The visible shell is only as tall as the dots it frames: a slim 16px pill drawn
              behind the row. The buttons on top keep a 44px-tall, 24px-wide target, so the
              control reads like a native page indicator instead of a row of large discs.
            */}
            <div className="relative flex items-center gap-1">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-1.5 top-1/2 h-[18px] -translate-y-1/2 rounded-full bg-brand-navy/25 ring-1 ring-white/20 shadow-[0_1px_4px_rgba(15,23,42,0.22)] backdrop-blur-[3px]"
              />
              {live.map((slide, i) => (
                <button
                  key={slide.id}
                  type="button"
                  aria-label={`Show banner ${i + 1} of ${count}`}
                  aria-current={i === index ? 'true' : undefined}
                  onClick={() => goTo(i)}
                  className="group/dot relative grid h-11 w-6 cursor-pointer place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-white"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'h-1 rounded-full bg-white shadow-[0_1px_2px_rgba(15,23,42,0.5)] transition-[width,opacity] duration-500 ease-soft motion-reduce:transition-none',
                      i === index ? 'w-4 opacity-100' : 'w-1 opacity-55 group-hover/dot:opacity-90',
                    )}
                  />
                </button>
              ))}
              {reducedMotion ? null : (
                <button
                  type="button"
                  aria-label={stopped ? 'Play banners' : 'Pause banners'}
                  onClick={() => setStopped((value) => !value)}
                  // The press area stays 44px; only the visible disc and glyph shrink, so the
                  // control reads as a quiet detail of the banner instead of a second button.
                  className="relative grid h-11 w-7 cursor-pointer place-items-center rounded-full text-white transition-[scale] duration-200 focus-visible:outline-2 focus-visible:outline-white active:scale-95 motion-reduce:transition-none"
                >
                  <span className="grid size-[18px] place-items-center rounded-full bg-brand-navy/35 ring-1 ring-white/35">
                    {stopped ? (
                      <Play aria-hidden="true" className="size-2 fill-current" />
                    ) : (
                      <Pause aria-hidden="true" className="size-2 fill-current" />
                    )}
                  </span>
                </button>
              )}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
