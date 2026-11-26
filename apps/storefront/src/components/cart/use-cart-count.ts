'use client';

import { useEffect, useState } from 'react';
import { CART_CHANGED_EVENT } from '@/lib/cart-events';

/*
 * The cart's unit count, shared by the header and the mobile tab bar.
 *
 * Catalog pages are cached and the same for everyone, so the count is not in the HTML: this
 * asks /api/cart once the page is open, again when the window regains focus (another tab may
 * have changed the cart) and whenever a form on this page announces a change. Until the count
 * is known it stays null, so no surface claims a number it does not have.
 */

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function useCartCount(): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let inFlight: AbortController | undefined;

    async function refresh() {
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;
      try {
        const response = await fetch('/api/cart', {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (!response.ok) return;
        const body: unknown = await response.json();
        if (typeof body === 'object' && body !== null && 'count' in body && isCount(body.count)) {
          setCount(body.count);
        }
      } catch {
        // Offline, or replaced by a newer request: keep what is shown.
      }
    }

    const onFocus = () => void refresh();
    const onCartChanged = (event: Event) => {
      const detail: unknown = event instanceof CustomEvent ? event.detail : undefined;
      const announced =
        typeof detail === 'object' && detail !== null && 'count' in detail
          ? detail.count
          : undefined;
      if (isCount(announced)) {
        // The page's own action knows the new count; an older request must not undo it.
        inFlight?.abort();
        setCount(announced);
      } else {
        void refresh();
      }
    };

    void refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener(CART_CHANGED_EVENT, onCartChanged);
    return () => {
      inFlight?.abort();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(CART_CHANGED_EVENT, onCartChanged);
    };
  }, []);

  return count;
}
