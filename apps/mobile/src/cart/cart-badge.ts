import { itemCountLabel } from '@/lib/money';

/**
 * The spoken name of the cart button in a tab header. A count is included only when the cart
 * holds something, so an empty cart is simply "Cart". The visible bubble shows the same units
 * and is hidden at zero.
 */
export function cartBadgeLabel(count: number): string {
  if (count <= 0) return 'Cart';
  return `Cart, ${itemCountLabel(count)}`;
}
