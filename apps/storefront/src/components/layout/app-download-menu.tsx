'use client';

import { cn } from '@nilzora/ui';
import { Smartphone } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { AppDownloadLinks } from '@/lib/app-links';
import { publishedBadges, StoreBadgeOptions } from '@/components/marketing/store-badges';

/*
 * The app download control
 * ------------------------
 * A single small phone glyph in the desktop header, immediately left of the search field. It
 * draws nothing at all when the store has published neither listing, so the header never carries
 * a dead control.
 *
 * Opening it:
 *   hover   — a mouse pointer, with a short close delay so the gap between the glyph and the
 *             panel can be crossed without the panel vanishing underneath the pointer;
 *   click   — which is what a touch screen sends, and what a keyboard's Enter or Space sends;
 *   focus   — a keyboard visitor tabbing onto it sees the panel without pressing anything.
 *
 * It closes on Escape, on a pointer down anywhere outside, and when focus leaves for good.
 * The panel is positioned absolutely, so opening it never moves the header, and it is drawn
 * above the page (z-50) rather than inside a clipped container.
 */

/** Long enough to cross the gap, short enough not to feel sticky. */
const CLOSE_DELAY_MS = 180;

export function AppDownloadMenu({
  links,
  /** True while the header is see-through over the home banner, where content is white. */
  onDark,
}: {
  links: AppDownloadLinks;
  onDark: boolean;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  /** What opened the panel. A click on a hover-opened panel pins it instead of closing it. */
  const openedBy = useRef<'hover' | 'click'>('hover');
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set while Escape is handing focus back, so that focus does not re-open the panel. */
  const skipFocusOpen = useRef(false);

  const clearTimer = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const close = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  const scheduleClose = useCallback(() => {
    clearTimer();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  // A pointer press outside the control dismisses the panel, the way a menu should behave.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapper.current?.contains(event.target as Node) === true) return;
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [close, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      // Returning focus must not count as arriving at the control, or the panel reopens.
      skipFocusOpen.current = true;
      trigger.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [close, open]);

  if (publishedBadges(links).length === 0) return null;

  return (
    <div
      ref={wrapper}
      // The desktop header is the only header that carries this control: below xl it is not
      // rendered at all, and the download strip under the trusted section is the way in.
      className="relative hidden xl:block"
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse') return;
        clearTimer();
        // A panel pinned by a click stays pinned; hovering it again does not change that.
        if (!open) openedBy.current = 'hover';
        setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'mouse') return;
        // Only a panel that a pointer opened closes with the pointer.
        if (openedBy.current === 'click') return;
        scheduleClose();
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        close();
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label="Download the Nilzora app"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          clearTimer();
          if (!open) {
            openedBy.current = 'click';
            setOpen(true);
            return;
          }
          // Hover already opened it: the press pins it — moving away no longer closes it, and
          // the next press is what closes it.
          if (openedBy.current === 'hover') {
            openedBy.current = 'click';
            return;
          }
          setOpen(false);
        }}
        onFocus={() => {
          if (skipFocusOpen.current) {
            skipFocusOpen.current = false;
            return;
          }
          clearTimer();
          if (!open) openedBy.current = 'hover';
          setOpen(true);
        }}
        className={cn(
          // No fill at any time: the glyph and its label carry the hover, so the header never
          // shows a coloured box behind them. 44px stays the touch target.
          'relative grid min-h-11 min-w-11 shrink-0 cursor-pointer content-center place-items-center gap-0 rounded-full px-1 transition-[color,opacity,scale] duration-300 hover:opacity-80 active:scale-95 motion-reduce:transition-none',
          // Brand blue on the frosted light bar, white over the banner and any image header: the
          // colour follows the header's own solid state, never a guess.
          onDark ? 'text-white' : 'text-primary-action',
        )}
      >
        <Smartphone aria-hidden="true" className="size-4.5" />
        <span aria-hidden="true" className="text-[0.5625rem] leading-none font-semibold">
          Get App
        </span>
      </button>

      {open ? (
        <div
          id={panelId}
          // A non-modal menu of two links: the button owns the name, the panel holds the options.
          role="group"
          aria-label="Download the Nilzora app"
          // Wider and roomier than a pair of tiny icons: the store wording has to be readable at
          // a glance. Anchored to the control's centre, and never wider than the viewport.
          className="absolute top-full left-1/2 z-50 mt-2 w-max max-w-[min(22rem,calc(100vw-2rem))] min-w-60 -translate-x-1/2 rounded-2xl border border-border/70 bg-surface/70 p-4 shadow-lg shadow-brand-navy/10 backdrop-blur-xl"
        >
          <p className="mb-2 text-xs font-semibold text-foreground">Download the Nilzora Apps</p>
          <StoreBadgeOptions links={links} size="md" className="flex-col items-start gap-3" />
        </div>
      ) : null}
    </div>
  );
}
