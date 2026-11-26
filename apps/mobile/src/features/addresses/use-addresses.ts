import { ApiError } from '@nilzora/api-client';
import type { Address, AddressInput } from '@nilzora/contracts';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useSignedInUserId } from '@/auth/session-context';
import { queryKeys, useAuthorizedApi } from '@/query';
import { sortAddresses } from './address-format';

/*
 * The signed-in customer's address book. The list is one query; every change goes to the
 * API and then refreshes it (and the checkout prices, because an address decides the
 * delivery charge). Screens render these inside <SignedInGate>.
 */

/** The account's addresses, default first. */
export function useAddresses() {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  return useQuery({
    queryKey: queryKeys.addresses.list(userId),
    queryFn: ({ signal }) =>
      run(async (api, accessToken) => {
        const { addresses } = await api.listAddresses(accessToken, { signal });
        return sortAddresses(addresses);
      }),
    enabled: userId !== null,
  });
}

/** Marks the address list and every checkout price of this account stale. */
function refreshAddressData(queryClient: QueryClient, userId: string | null): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.addresses.all(userId) }),
    queryClient.invalidateQueries({ queryKey: [...queryKeys.user(userId), 'checkout'] }),
  ]);
}

/** Puts a saved address into the cached list, so a screen that opens next already has it. */
function withSavedAddress(list: readonly Address[], saved: Address): Address[] {
  const known = list.some((address) => address.id === saved.id);
  const others = list.map((address) =>
    address.id !== saved.id && saved.isDefault ? { ...address, isDefault: false } : address,
  );
  return sortAddresses(
    known
      ? others.map((address) => (address.id === saved.id ? saved : address))
      : [...others, saved],
  );
}

/** Creates an address, or replaces `addressId` when given. Resolves with the saved address. */
export function useSaveAddress(addressId?: string) {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddressInput) =>
      run(async (api, accessToken) => {
        const { address } =
          addressId === undefined
            ? await api.createAddress(accessToken, input)
            : await api.updateAddress(accessToken, addressId, input);
        return address;
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData<Address[]>(queryKeys.addresses.list(userId), (list) =>
        list === undefined ? list : withSavedAddress(list, saved),
      );
    },
    onSettled: () => refreshAddressData(queryClient, userId),
  });
}

/** Deletes an address. One that is already gone counts as deleted: it is what was asked for. */
export function useDeleteAddress() {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (addressId: string) =>
      run(async (api, accessToken) => {
        try {
          await api.deleteAddress(accessToken, addressId);
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 404)) throw error;
        }
      }),
    onSettled: () => refreshAddressData(queryClient, userId),
  });
}

/**
 * Makes an address the default. The API replaces whole addresses, so the current fields are
 * read from the API (never from a possibly stale screen) and sent back with `isDefault`.
 */
export function useMakeDefaultAddress() {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (addressId: string) =>
      run(async (api, accessToken) => {
        const { addresses } = await api.listAddresses(accessToken);
        const current = addresses.find((address) => address.id === addressId);
        if (current === undefined) {
          throw new ApiError(404, 'not_found', 'The address does not exist');
        }
        if (current.isDefault) return current;
        const { address } = await api.updateAddress(accessToken, addressId, {
          label: current.label,
          recipientName: current.recipientName,
          phone: current.phone,
          division: current.division,
          district: current.district,
          area: current.area,
          addressLine: current.addressLine,
          postalCode: current.postalCode,
          landmark: current.landmark,
          isDefault: true,
        });
        return address;
      }),
    onSettled: () => refreshAddressData(queryClient, userId),
  });
}
