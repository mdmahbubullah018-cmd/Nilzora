'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The sticky glass top bar. Once the page has scrolled under it, it becomes slightly more
 * opaque (data-scrolled, styled in globals.css) so the breadcrumb stays crisp over
 * content. One passive listener; no state, so scrolling never re-renders anything.
 */
export function Topbar({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const header = ref.current;
    if (!header) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      header.toggleAttribute('data-scrolled', window.scrollY > 4);
    };
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <header
      ref={ref}
      className="nz-glass nz-topbar sticky top-0 z-30 border-x-0 border-t-0 border-b"
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-workspace-accent/70 to-transparent"
      />
      {children}
    </header>
  );
}
