/*
 * Browser-side signal that the cart changed, so the header badge can update without a
 * full page load. Client components only; carries the new unit count when known.
 */

export const CART_CHANGED_EVENT = 'nilzora:cart-changed';

export interface CartChangedDetail {
  count?: number;
}

export function announceCartChange(count?: number): void {
  window.dispatchEvent(
    new CustomEvent<CartChangedDetail>(CART_CHANGED_EVENT, { detail: { count } }),
  );
}
