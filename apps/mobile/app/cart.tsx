import { CartScreen } from '@/features/cart/cart-screen';

/**
 * The cart, opened from the Home header. It is a screen above the tabs now (the bar's fourth
 * item is Chat), so the route moved out of app/(tabs) without changing the screen itself.
 */
export default function CartRoute() {
  return <CartScreen />;
}
