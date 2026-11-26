'use client';

import { cn } from '@nilzora/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A row that scrolls sideways, with a pair of arrows for a mouse.
 *
 * The row itself stays a plain `overflow-x-auto` list, so touch screens swipe it natively and a
 * trackpad scrolls it as usual. The arrows are the mouse's way to slide — hidden on touch-sized
 * screens, and hidden entirely while everything already fits. They step by one visible page
 * (the row's own width), landing on the same snap points a swipe would.
 */
export function ScrollRail({
  className,
  label = 'items',
  children,
}: {
  /** The row's own classes; it must keep `overflow-x-auto` for this to be a scroll container. */
  className?: string;
  /** What the row holds, for the arrows' spoken names ("Previous categories"). */
  label?: string;
  children: ReactNode;
}) {
  const rail = useRef<HTMLUListElement>(null);
  // Both edges are "reached" until the first measurement, so the arrows never flash on load.
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const element = rail.current;
    if (element === null) return;
    const max = element.scrollWidth - element.clientWidth;
    setEdges({
      start: element.scrollLeft <= 1,
      end: max <= 1 || element.scrollLeft >= max - 1,
    });
  }, []);

  useEffect(() => {
    const element = rail.current;
    if (element === null) return;
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [measure]);

  const page = (direction: -1 | 1) => {
    const element = rail.current;
    if (element === null) return;
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollBy({
      left: direction * element.clientWidth,
      behavior: reduce ? 'auto' : 'smooth',
    });
  };

  const arrow =
    'grid size-10 cursor-pointer place-items-center rounded-full border border-border/80 bg-surface text-brand-navy shadow-sm transition-colors duration-200 hover:border-primary/40 hover:text-primary disabled:cursor-default disabled:opacity-40 disabled:hover:border-border/80 disabled:hover:text-brand-navy';

  const scrollable = !(edges.start && edges.end);

  // `min-w-0`: as a grid or flex item this wrapper must be able to shrink below the rail's
  // content width, or the page scrolls sideways instead of the rail.
  return (
    <div className="group/rail min-w-0">
      <ul
        ref={rail}
        role="list"
        onScroll={measure}
        className={cn('scroll-smooth motion-reduce:scroll-auto', className)}
      >
        {children}
      </ul>
      {scrollable ? (
        <div className="mt-3 hidden justify-end gap-2 md:flex">
          <button
            type="button"
            aria-label={`Previous ${label}`}
            onClick={() => page(-1)}
            disabled={edges.start}
            className={arrow}
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </button>
          <button
            type="button"
            aria-label={`Next ${label}`}
            onClick={() => page(1)}
            disabled={edges.end}
            className={arrow}
          >
            <ChevronRight aria-hidden="true" className="size-5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
