import { useLocalSearchParams } from 'expo-router';
import { SignedInGate } from '@/auth/signed-in-gate';
import { STACK_EDGES } from '@/components/screen';
import { OrderNotFoundScreen } from '@/features/orders/order-detail';
import { isOrderNumber, singleParam } from '@/features/orders/status';
import { ReceiptScreen } from '@/features/receipt/receipt-screen';

export default function ReceiptRoute() {
  const params = useLocalSearchParams<{ orderNumber?: string }>();
  // Route parameters are untrusted (a deep link can set them).
  const candidate = singleParam(params.orderNumber);
  const orderNumber = isOrderNumber(candidate) ? candidate : null;

  return (
    <SignedInGate
      title="Receipt"
      purpose="see this receipt"
      edges={STACK_EDGES}
      returnTo={orderNumber === null ? undefined : `/receipt/${orderNumber}`}
    >
      {orderNumber === null ? <OrderNotFoundScreen /> : <ReceiptScreen orderNumber={orderNumber} />}
    </SignedInGate>
  );
}
