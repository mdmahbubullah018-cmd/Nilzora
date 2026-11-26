'use client';

import { useEffect, useRef } from 'react';

/**
 * Closes the surrounding <details> popover on an outside click or on Escape.
 *
 * The range popover is a plain <details> so the filter still opens and submits without
 * JavaScript. Browsers do not close a <details> when the page is clicked elsewhere, which made
 * an open calendar stay behind on the dashboard; this adds only that behaviour, and nothing is
 * rendered, so the markup and its no-JavaScript behaviour are untouched.
 */
export function ClosePopoverOnOutside() {
  const anchor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const details = anchor.current?.closest('details');
    if (!details) return;
    const summary = details.querySelector('summary');

    const onPointerDown = (event: PointerEvent) => {
      if (!details.open) return;
      const target = event.target;
      if (target instanceof Node && details.contains(target)) return;
      details.open = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !details.open) return;
      details.open = false;
      if (summary instanceof HTMLElement) summary.focus();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return <span ref={anchor} hidden />;
}
