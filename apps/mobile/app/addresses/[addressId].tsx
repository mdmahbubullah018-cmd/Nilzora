import { useLocalSearchParams } from 'expo-router';
import { SignedInGate } from '@/auth/signed-in-gate';
import { STACK_EDGES } from '@/components/screen';
import { AddressFormScreen } from '@/features/addresses/address-form-screen';
import { parseReturnTo } from '@/lib/return-to';

export default function EditAddressRoute() {
  const { addressId } = useLocalSearchParams<{ addressId: string }>();
  // Signing in brings the customer back here, but only for a well-formed address id.
  const returnTo = parseReturnTo(`/addresses/${addressId}`) ?? '/addresses';
  return (
    <SignedInGate returnTo={returnTo} purpose="edit a delivery address" edges={STACK_EDGES}>
      <AddressFormScreen addressId={addressId} />
    </SignedInGate>
  );
}
