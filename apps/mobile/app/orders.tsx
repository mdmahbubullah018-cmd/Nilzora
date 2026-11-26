import { SignedInGate } from '@/auth/signed-in-gate';
import { STACK_EDGES } from '@/components/screen';
import { OrdersList } from '@/features/orders/orders-list';

export default function OrdersScreen() {
  return (
    // A stack screen above the tabs: it keeps the native header and needs no bar space.
    // The header already names the screen, so nothing below repeats "Orders".
    <SignedInGate purpose="see and follow your orders" returnTo="/orders" edges={STACK_EDGES}>
      <OrdersList bottomSpace={0} />
    </SignedInGate>
  );
}
