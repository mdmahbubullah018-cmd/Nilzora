'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/*
 * The thin progress bar across the top of the admin while a page change is in flight.
 *
 * It starts when the visitor activates an in-app link (a click on an <a> that stays on this
 * site, opens in this tab and is not a download or a hash jump) and finishes when the address
 * changes. It creeps toward 90% so a slow page still looks alive, snaps to 100% when the new
 * page arrives, then fades. A link that never leads to a new address (the same page, a refused
 * navigation) is given up on after a short while rather than spinning forever.
 *
 * No library: one listener on the document and two timers. It is hidden from assistive
 * technology (the page's own loading state carries the announcement) and, with reduced motion
 * asked for, it fills without easing.
 */

const GIVE_UP_MS = 8000;

function leadsElsewhere(event: MouseEvent): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const anchor = (event.target as Element | null)?.closest?.('a[href]');
  if (!(anchor instanceof HTMLAnchorElement)) return false;
  if (anchor.target !== '' && anchor.target !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;
  const next = new URL(anchor.href, window.location.href);
  if (next.origin !== window.location.origin) return false;
  // A jump within the same page (a hash) is not a navigation.
  if (next.pathname === window.location.pathname && next.search === window.location.search) {
    return false;
  }
  return true;
}

export function RouteProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const address = `${pathname}?${search}`;
  const [progress, setProgress] = useState<number | null>(null);
  const timers = useRef<number[]>([]);
  const last = useRef(address);

  const clear = () => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  };

  useEffect(() => {
    const begin = (event: MouseEvent) => {
      if (!leadsElsewhere(event)) return;
      clear();
      setProgress(8);
      const creep = (value: number) => {
        timers.current.push(
          window.setTimeout(() => {
            setProgress((current) => (current === null ? null : Math.min(90, value)));
            if (value < 90) creep(value + (90 - value) * 0.18);
          }, 220),
        );
      };
      creep(24);
      timers.current.push(window.setTimeout(() => setProgress(null), GIVE_UP_MS));
    };
    document.addEventListener('click', begin, true);
    return () => {
      document.removeEventListener('click', begin, true);
      clear();
    };
  }, []);

  // The new page has arrived: fill the bar, then let it fade.
  useEffect(() => {
    if (last.current === address) return;
    last.current = address;
    clear();
    setProgress(100);
    timers.current.push(window.setTimeout(() => setProgress(null), 260));
  }, [address]);

  if (progress === null) return null;
  return (
    <div
      aria-hidden="true"
      data-route-progress=""
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5"
    >
      <div
        className="h-full bg-primary shadow-[0_0_8px_var(--color-primary)] motion-safe:transition-[width,opacity] motion-safe:duration-300 motion-safe:ease-out"
        style={{ width: `${String(progress)}%`, opacity: progress >= 100 ? 0.6 : 1 }}
      />
    </div>
  );
}
