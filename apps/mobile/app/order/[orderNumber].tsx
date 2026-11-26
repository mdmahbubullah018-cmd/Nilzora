import { useLocalSearchParams } from 'expo-router';
import { SignedInGate } from '@/auth/signed-in-gate';
import { STACK_EDGES } from '@/components/screen';
import { OrderDetailScreen, OrderNotFoundScreen } from '@/features/orders/order-detail';
import { isOrderNumber, singleParam } from '@/features/orders/status';

export default function OrderRoute() {
  const params = useLocalSearchParams<{ orderNumber?: string; placed?: string }>();
  // Route parameters are untrusted (a deep link or a notification can set them).
  const candidate = singleParam(params.orderNumber);
  const orderNumber = isOrderNumber(candidate) ? candidate : null;
  const placed = singleParam(params.placed) === '1';

  return (
    <SignedInGate
      title="Order"
      purpose="see this order"
      edges={STACK_EDGES}
      returnTo={orderNumber === null ? undefined : `/order/${orderNumber}`}
    >
      {orderNumber === null ? (
        <OrderNotFoundScreen />
      ) : (
        <OrderDetailScreen orderNumber={orderNumber} placed={placed} />
      )}
    </SignedInGate>
  );
}
