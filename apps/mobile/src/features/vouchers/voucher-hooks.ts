import { voucherUsePath, type Voucher } from '@nilzora/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Href } from 'expo-router';
import { useApi } from '@/api/api-context';
import { useSignedInUserId } from '@/auth/session-context';
import { categoryHref, productHref, shopHref } from '@/features/catalog/catalog-query';
import { ApiNotConfiguredError } from '@/lib/errors';
import { queryKeys, useAuthorizedApi } from '@/query';

/*
 * Vouchers on the device: the same API, contracts and rules as the website, so a voucher
 * collected on one shows on the other. Every rule (window, audience, cap, once per account,
 * the 4-day hiding after expiry) is the server's; the app only shows and asks.
 */

/** The Voucher Center; signed in, each voucher carries this account's own state. */
export function useVoucherCenter() {
  const api = useApi();
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  return useQuery({
    queryKey: queryKeys.vouchers.center(userId),
    queryFn: ({ signal }) => {
      if (userId !== null) {
        return run((client, token) => client.voucherCenter(token, { signal })).then((r) => r.vouchers);
      }
      if (api === null) return Promise.reject(new ApiNotConfiguredError());
      return api.voucherCenter(null, { signal }).then((r) => r.vouchers);
    },
  });
}

/** The vouchers that apply to one product (its own, its category's, the store's). */
export function useProductVouchers(slug: string) {
  const api = useApi();
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  return useQuery({
    queryKey: queryKeys.vouchers.product(userId, slug),
    queryFn: ({ signal }) => {
      if (userId !== null) {
        return run((client, token) => client.productVouchers(slug, token, { signal })).then(
          (r) => r.vouchers,
        );
      }
      if (api === null) return Promise.reject(new ApiNotConfiguredError());
      return api.productVouchers(slug, null, { signal }).then((r) => r.vouchers);
    },
    // Offers are optional: a failure leaves them out rather than showing an error on the product.
    retry: 0,
  });
}

/** The account's collected vouchers (My Vouchers). */
export function useMyVouchers() {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  return useQuery({
    queryKey: queryKeys.vouchers.mine(userId),
    queryFn: ({ signal }) =>
      run((client, token) => client.myVouchers(token, { signal })).then((r) => r.vouchers),
    enabled: userId !== null,
  });
}

/** Collects a voucher, then refreshes both lists so Collect turns into Use everywhere. */
export function useCollectVoucher() {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (voucherId: string) =>
      run((api, token) => api.collectVoucher(token, voucherId)).then((r) => r.voucher),
    onSuccess: (voucher: Voucher) => {
      client.setQueryData<Voucher[]>(queryKeys.vouchers.center(userId), (list) =>
        list?.map((item) => (item.id === voucher.id ? voucher : item)),
      );
      void client.invalidateQueries({ queryKey: queryKeys.vouchers.all(userId) });
    },
  });
}

/** Where "Use" goes in the app: the qualifying category or product, else the shop. */
export function voucherUseHref(voucher: Voucher): Href {
  const path = voucherUsePath(voucher);
  if (path.startsWith('/categories/')) return categoryHref(path.slice('/categories/'.length));
  if (path.startsWith('/products/')) return productHref(path.slice('/products/'.length));
  return shopHref();
}
