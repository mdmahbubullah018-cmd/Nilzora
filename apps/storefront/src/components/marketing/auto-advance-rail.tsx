'use client';

import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePageVisible, usePrefersReducedMotion } from '@/lib/use-motion-preferences';
import { useSessionFlag } from '@/lib/use-session-flag';

/** How long the rail rests on a collection before it moves to the next one. */
export const RAIL_ADVANCE_MS = 4500;
/** How long after a visitor touches, scrolls or types the rail leaves them alone. */
export const RAIL_IDLE_MS = 6000;
/** How long the rail takes to fade out (and again to fade back in) when it wraps to the start. */
export const RAIL_WRAP_FADE_MS = 160;
/** Where the visitor's pause is remembered for the visit. */
export const RAIL_PAUSE_KEY = 'nilzora:collection-rail:paused';
/**
 * A card counts as "ahead" only when it starts further right than this. It is wider than the
 * rail's own side padding, so a rail that has not snapped yet still moves a whole card.
 */
const AHEAD_PX = 24;
/** Fewer cards than this never overflow the row at any width, so there is nothing to pause. */
const MIN_CARDS_TO_SCROLL = 3;

/** Left edge of every card, measured from the start of the scrolled content. */
function cardOffsets(list: HTMLElement): number[] {
  const origin = list.getBoundingClientRect().left - list.scrollLeft;
  return Array.from(list.children, (card) => card.getBoundingClientRect().left - origin);
}

/** True when the rail is already showing its last card, so the next move is back to the start. */
export function isRailAtEnd(list: HTMLElement): boolean {
  const max = list.scrollWidth - list.clientWidth;
  return list.scrollLeft >= max - 2;
}

/** Where the next tick should scroll to: the next card, or the start after the last one. */
export function nextRailOffset(list: HTMLElement): number {
  const max = list.scrollWidth - list.clientWidth;
  const current = list.scrollLeft;
  if (current >= max - 2) return 0;
  const next = cardOffsets(list).find((offset) => offset > current + AHEAD_PX);
  if (next === undefined) return 0;
  return Math.min(next, max);
}

/**
 * Makes the collection rail it wraps a slideshow, without redesigning it: every few seconds it
 * scrolls the rail's own list to the next card (scrollLeft only, so nothing shifts on the page
 * and the page itself never scrolls). After the last card it fades the row out, jumps back to the
 * start while it is invisible and fades it back in, instead of sweeping visibly across every card.
 *
 * It rests while it could not be seen or is being used:
 * - the rail is off screen (IntersectionObserver) or the tab is hidden;
 * - the visitor hovers it or has keyboard focus inside it;
 * - the visitor touched, scrolled or typed in it in the last few seconds;
 * - the visitor pressed Pause (WCAG 2.2.2). The choice is remembered for the visit;
 * - the visitor prefers reduced motion (it never starts at all, nothing is animated, and the
 *   Pause control is not drawn). The preference is followed live if it changes while the page is open.
 * A rail whose cards all fit (nothing to scroll) is left alone. Every link and the manual
 * swipe, scrollbar and keyboard behaviour of the rail are untouched.
 *
 * Nothing here is announced: no live region wraps the rail, so a screen reader is never
 * interrupted by a move it did not ask for. Only a press of Pause or Play is announced.
 *
 * Layout: the Pause row below the rail is part of the server render at a fixed height, and
 * hidden for reduced motion by CSS (not by script), so starting or stopping the slideshow never
 * shifts anything on the page.
 *
 * The rail has no dots or previous / next buttons on purpose: they would add a second row to a
 * design that is a single slim band, and the rail already scrolls and snaps by swipe, scrollbar
 * and keyboard. Pause is the one added control.
 */
export function AutoAdvanceRail({
  children,
  intervalMs = RAIL_ADVANCE_MS,
  idleMs = RAIL_IDLE_MS,
  itemCount,
  subject = 'collection slideshow',
  pauseKey = RAIL_PAUSE_KEY,
}: {
  children: ReactNode;
  intervalMs?: number;
  idleMs?: number;
  /**
   * How many cards the rail holds. With three or more (the fewest that can overflow the row) a
   * Pause / Play control is drawn under the rail; without it, none is.
   */
  itemCount?: number;
  /** What the control pauses, for its label: "Pause collection slideshow". */
  subject?: string;
  pauseKey?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const pageVisible = usePageVisible();
  const [paused, setPaused] = useSessionFlag(pauseKey);
  const [inView, setInView] = useState(false);
  const [engaged, setEngaged] = useState(false);
  // What a screen reader is told after Pause or Play is pressed, and only then.
  const [announcement, setAnnouncement] = useState('');
  // The time before which a recent touch, scroll or key press keeps the rail still.
  const restUntil = useRef(0);

  // Watch the rail: whether it is on screen, and whether the visitor is using it.
  useEffect(() => {
    const element = box.current;
    if (!element) return;

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => {
        const latest = entries.at(-1);
        if (latest) setInView(latest.isIntersecting);
      });
      observer.observe(element);
    }

    let hovering = false;
    let focusInside = false;
    const sync = () => setEngaged(hovering || focusInside);
    const onEnter = () => {
      hovering = true;
      sync();
    };
    const onLeave = () => {
      hovering = false;
      sync();
    };
    const onFocusIn = () => {
      focusInside = true;
      sync();
    };
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return;
      focusInside = false;
      sync();
    };
    const onTouched = () => {
      restUntil.current = Date.now() + idleMs;
    };

    element.addEventListener('mouseenter', onEnter);
    element.addEventListener('mouseleave', onLeave);
    element.addEventListener('focusin', onFocusIn);
    element.addEventListener('focusout', onFocusOut);
    const touches = ['pointerdown', 'touchstart', 'wheel', 'keydown'] as const;
    for (const type of touches) element.addEventListener(type, onTouched, { passive: true });

    return () => {
      observer?.disconnect();
      element.removeEventListener('mouseenter', onEnter);
      element.removeEventListener('mouseleave', onLeave);
      element.removeEventListener('focusin', onFocusIn);
      element.removeEventListener('focusout', onFocusOut);
      for (const type of touches) element.removeEventListener(type, onTouched);
    };
  }, [idleMs]);

  // Without an IntersectionObserver there is no way to tell, so assume the rail can be seen
  // rather than never move.
  const seen = typeof IntersectionObserver === 'undefined' || inView;
  const running = seen && pageVisible && !engaged && !reducedMotion && !paused;

  useEffect(() => {
    if (!running) return;
    let wrapTimer: number | null = null;
    const listOf = () => box.current?.querySelector('ul') ?? null;
    const restore = (list: HTMLElement | null) => {
      if (!list) return;
      list.style.opacity = '';
      list.style.transition = '';
    };
    const timer = window.setInterval(() => {
      if (Date.now() < restUntil.current || wrapTimer !== null) return;
      const list = listOf();
      if (!list || list.scrollWidth <= list.clientWidth) return;
      if (!isRailAtEnd(list)) {
        list.scrollTo({ left: nextRailOffset(list), behavior: 'smooth' });
        return;
      }
      // From the last card back to the first: fade out, jump unseen, fade in. A smooth scroll
      // would sweep visibly past every card.
      list.style.transition = `opacity ${String(RAIL_WRAP_FADE_MS)}ms ease`;
      list.style.opacity = '0';
      wrapTimer = window.setTimeout(() => {
        list.scrollTo({ left: 0, behavior: 'instant' });
        list.style.opacity = '1';
        wrapTimer = window.setTimeout(() => {
          restore(list);
          wrapTimer = null;
        }, RAIL_WRAP_FADE_MS);
      }, RAIL_WRAP_FADE_MS);
    }, intervalMs);
    return () => {
      window.clearInterval(timer);
      if (wrapTimer !== null) window.clearTimeout(wrapTimer);
      // Stopped mid-fade (hovered, paused, hidden): never leave the row dim.
      restore(listOf());
    };
  }, [running, intervalMs]);

  const showControl = itemCount !== undefined && itemCount >= MIN_CARDS_TO_SCROLL;

  return (
    <>
      <div ref={box}>{children}</div>
      {showControl ? (
        // Always in the page, at a fixed height: starting the slideshow moves nothing. Reduced
        // motion hides it with CSS (nothing moves, so there is nothing to pause). With exactly
        // three cards the whole row fits from `lg` up, so it is hidden there too.
        <div
          className={`flex min-h-11 items-center justify-end motion-reduce:hidden ${
            itemCount === MIN_CARDS_TO_SCROLL ? 'lg:hidden' : ''
          }`}
        >
          <button
            type="button"
            aria-label={`${paused ? 'Play' : 'Pause'} ${subject}`}
            onClick={() => {
              const next = !paused;
              setPaused(next);
              setAnnouncement(next ? `Paused ${subject}` : `Playing ${subject}`);
            }}
            className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          >
            {paused ? (
              <Play aria-hidden="true" className="size-3.5 fill-current" />
            ) : (
              <Pause aria-hidden="true" className="size-3.5 fill-current" />
            )}
            {paused ? 'Play' : 'Pause'}
          </button>
          {/* Empty until the visitor presses the button: an automatic move is never announced. */}
          <span role="status" aria-live="polite" className="sr-only">
            {announcement}
          </span>
        </div>
      ) : null}
    </>
  );
}
