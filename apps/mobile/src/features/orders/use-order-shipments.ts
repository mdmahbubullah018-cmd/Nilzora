import type { CustomerShipmentsResponse } from '@nilzora/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSignedInUserId } from '@/auth/session-context';
import { queryKeys, useAuthorizedApi } from '@/query';

/**
 * The courier shipments of one of the account's own orders: courier, status, tracking code
 * and timeline. The server answers only for the caller's order and only shipments a courier
 * accepted. Pass `enabled: false` until the order is known to be worth asking about.
 */
export function useOrderShipments(
  orderNumber: string,
  enabled = true,
): UseQueryResult<CustomerShipmentsResponse> {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  return useQuery({
    queryKey: queryKeys.orders.shipments(userId, orderNumber),
    queryFn: ({ signal }) =>
      run((api, accessToken) => api.myOrderShipments(accessToken, orderNumber, { signal })),
    enabled: enabled && userId !== null && orderNumber !== '',
  });
}
