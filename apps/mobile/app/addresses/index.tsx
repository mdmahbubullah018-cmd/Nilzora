import { SignedInGate } from '@/auth/signed-in-gate';
import { STACK_EDGES } from '@/components/screen';
import { AddressesScreen } from '@/features/addresses/addresses-screen';

export default function AddressesRoute() {
  return (
    <SignedInGate
      returnTo="/addresses"
      purpose="manage your delivery addresses"
      edges={STACK_EDGES}
    >
      <AddressesScreen />
    </SignedInGate>
  );
}
