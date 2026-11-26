'use client';

import { useEffect } from 'react';
import { announceCartChange } from '@/lib/cart-events';

/**
 * Placing an order empties the cart in a Server Action that ends in a redirect, so the
 * header badge hears about it here, on the order page that follows. No count is
 * announced: the badge asks for the cart again, which stays right when this page is
 * reloaded after the customer has started a new cart.
 */
export function CartClearedSignal() {
  useEffect(() => {
    announceCartChange();
  }, []);
  return null;
}
