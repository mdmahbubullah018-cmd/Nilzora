import { useLocalSearchParams } from 'expo-router';
import { SignedInGate } from '@/auth/signed-in-gate';
import { STACK_EDGES } from '@/components/screen';
import {
  orderNumberFromParams,
  OrderSuccessScreen,
} from '@/features/checkout/order-success-screen';
import { OrderNotFoundScreen } from '@/features/orders/order-detail';

export default function OrderSuccessRoute() {
  const params = useLocalSearchParams<{ orderNumber?: string }>();
  // Route parameters are untrusted (a deep link can set them).
  const orderNumber = orderNumberFromParams(params.orderNumber);

  return (
    <SignedInGate
      title="Order confirmation"
      purpose="see this order"
      edges={STACK_EDGES}
      returnTo={orderNumber === null ? undefined : `/order-success/${orderNumber}`}
    >
      {orderNumber === null ? (
        <OrderNotFoundScreen />
      ) : (
        <OrderSuccessScreen orderNumber={orderNumber} />
      )}
    </SignedInGate>
  );
}
