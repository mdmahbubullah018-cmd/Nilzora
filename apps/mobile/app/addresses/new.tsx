import { SignedInGate } from '@/auth/signed-in-gate';
import { STACK_EDGES } from '@/components/screen';
import { AddressFormScreen } from '@/features/addresses/address-form-screen';

export default function NewAddressRoute() {
  return (
    <SignedInGate returnTo="/addresses/new" purpose="add a delivery address" edges={STACK_EDGES}>
      <AddressFormScreen />
    </SignedInGate>
  );
}
