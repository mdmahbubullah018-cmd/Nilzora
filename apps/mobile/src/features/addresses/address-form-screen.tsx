import { ApiError } from '@nilzora/api-client';
import { MAX_ADDRESSES, type Address, type AddressInput } from '@nilzora/contracts';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { MapPinOff } from 'lucide-react-native';
import { useSession } from '@/auth/session-context';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Notice } from '@/components/notice';
import { queryViewState, QueryStateView } from '@/components/query-state';
import { Screen, STACK_EDGES } from '@/components/screen';
import { describeApiError } from '@/lib/errors';
import { parseReturnTo } from '@/lib/return-to';
import { AddressForm, type AddressSubmitResult } from './address-form';
import {
  EMPTY_ADDRESS_VALUES,
  fieldErrorsFromApi,
  valuesFromAddress,
  type AddressFormValues,
} from './address-form-model';
import { formatBdPhone } from './address-format';
import { ADDRESSES_HREF } from './routes';
import { useAddresses, useSaveAddress } from './use-addresses';

const CHECK_FIELDS = 'Check the highlighted fields.';

/** What the failed save means for the form: field messages when the API named fields, else words. */
function failureOf(error: unknown): AddressSubmitResult {
  if (error instanceof ApiError && error.code === 'validation_failed') {
    const fieldErrors = fieldErrorsFromApi(error.details);
    if (Object.keys(fieldErrors).length > 0) {
      return { ok: false, message: CHECK_FIELDS, fieldErrors };
    }
  }
  const { title, message } = describeApiError(error);
  return { ok: false, title, message };
}

/**
 * "New address" (no `addressId`) and "Edit address" (the id from the route). The address
 * being edited comes from the account's address list, so a deleted or foreign id ends in
 * a not-found state instead of an empty form. After saving the customer returns to where
 * they came from: the checkout (with the saved address selected), another allowed
 * `returnTo` screen, or the previous screen. Render it inside <SignedInGate>.
 */
export function AddressFormScreen({ addressId }: { addressId?: string }) {
  const router = useRouter();
  const { returnTo: requestedReturnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const returnTo = parseReturnTo(requestedReturnTo);
  const { state } = useSession();
  const query = useAddresses();
  const save = useSaveAddress(addressId);

  const backToList = () => {
    if (router.canGoBack()) router.back();
    else router.replace(ADDRESSES_HREF);
  };

  function finish(saved: Address) {
    if (returnTo === '/checkout') {
      // Back at checkout, the address just saved is the one selected for delivery.
      router.dismissTo({ pathname: '/checkout', params: { address: saved.id } });
    } else if (returnTo !== null) {
      router.dismissTo(returnTo as Href);
    } else {
      backToList();
    }
  }

  async function submit(input: AddressInput): Promise<AddressSubmitResult> {
    try {
      finish(await save.mutateAsync(input));
      return { ok: true };
    } catch (error) {
      return failureOf(error);
    }
  }

  const view = queryViewState(query);
  if (view === 'loading') {
    return (
      <Screen edges={STACK_EDGES}>
        <QueryStateView state="loading" loadingLabel="Loading your addresses" />
      </Screen>
    );
  }
  if (view === 'error' || query.data === undefined) {
    return (
      <Screen edges={STACK_EDGES}>
        <QueryStateView
          state="error"
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isRefetching}
        />
      </Screen>
    );
  }

  const addresses = query.data;
  const editing = addressId === undefined ? null : addresses.find((a) => a.id === addressId);

  if (addressId !== undefined && editing === undefined) {
    return (
      <Screen edges={STACK_EDGES}>
        <Card>
          <EmptyState
            icon={MapPinOff}
            title="Address not found"
            description="This address may have been deleted. Your saved addresses are in your address book."
          />
        </Card>
        <Button label="Back to addresses" onPress={() => router.replace(ADDRESSES_HREF)} />
      </Screen>
    );
  }

  if (addressId === undefined && addresses.length >= MAX_ADDRESSES) {
    return (
      <Screen edges={STACK_EDGES}>
        <Notice tone="info" title="Address limit reached">
          {`You can keep up to ${MAX_ADDRESSES} addresses. Delete one to add another.`}
        </Notice>
        <Button label="Back to addresses" onPress={backToList} />
      </Screen>
    );
  }

  let initial: AddressFormValues = EMPTY_ADDRESS_VALUES;
  if (editing) {
    initial = valuesFromAddress(editing);
  } else if (state.status === 'signed_in') {
    // A new address starts from the name and phone on the account, when it has them.
    const { fullName, phone } = state.user.profile;
    initial = {
      ...EMPTY_ADDRESS_VALUES,
      recipientName: fullName ?? '',
      phone: phone === null ? '' : formatBdPhone(phone),
    };
  }

  return (
    <AddressForm
      // A different address (or a new one) starts a clean form.
      key={addressId ?? 'new'}
      initial={initial}
      defaultChoice={
        editing
          ? editing.isDefault
            ? 'current'
            : 'offer'
          : addresses.length === 0
            ? 'first'
            : 'offer'
      }
      submitLabel={editing ? 'Save changes' : 'Save address'}
      onSubmit={submit}
    />
  );
}
