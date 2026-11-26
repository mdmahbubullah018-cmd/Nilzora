'use client';

import { useEffect, useRef } from 'react';
import { announceCartChange } from '@/lib/cart-events';

/*
 * Removing the last line replaces the cart with its empty state in the same render, so
 * the line forms (and their message area) are gone before they can report. This signal
 * sits in the empty state instead: the header badge asks for the cart again, and when
 * the empty state follows a removal, focus moves to the page heading and the removal is
 * announced. A plain visit to an empty cart moves no focus and announces nothing.
 */

let removalPending = false;

/** Called by the remove form just before it posts. */
export function noteCartRemoval(): void {
  removalPending = true;
}

/** Called when the line forms report the removal themselves (the cart is not empty). */
export function clearCartRemovalNote(): void {
  removalPending = false;
}

export function CartEmptiedSignal() {
  const status = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    announceCartChange();
    if (!removalPending) return;
    removalPending = false;
    const heading = document.querySelector<HTMLElement>('main h1');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
    // Written into the live region after it is on the page, so it is announced.
    if (status.current)
      status.current.textContent = 'Removed from your cart. Your cart is now empty.';
  }, []);

  return <p ref={status} role="status" className="sr-only" />;
}
