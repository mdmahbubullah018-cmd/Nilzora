import { SignedInGate } from '@/auth/signed-in-gate';
import { STACK_EDGES } from '@/components/screen';
import { useProductQuestion } from '@/features/support/product-question';
import { SupportInboxScreen } from '@/features/support/support-inbox-screen';

export default function SupportRoute() {
  // A product question that arrived from a product page survives the sign-in round trip, so
  // the gate can say what the account is actually needed for.
  const question = useProductQuestion();
  return (
    <SignedInGate
      returnTo="/support"
      purpose={question === null ? 'see your support conversations' : 'ask about this product'}
      edges={STACK_EDGES}
    >
      <SupportInboxScreen />
    </SignedInGate>
  );
}
