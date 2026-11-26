import { SignedInGate } from '@/auth/signed-in-gate';
import { STACK_EDGES } from '@/components/screen';
import { CheckoutScreen } from '@/features/checkout/checkout-screen';

export default function CheckoutRoute() {
  return (
    <SignedInGate returnTo="/checkout" purpose="place your order" edges={STACK_EDGES}>
      <CheckoutScreen />
    </SignedInGate>
  );
}
