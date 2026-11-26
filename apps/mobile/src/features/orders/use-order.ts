import { ApiError } from '@nilzora/api-client';
import { useQuery } from '@tanstack/react-query';
import { useSignedInUserId } from '@/auth/session-context';
import { queryKeys, useAuthorizedApi } from '@/query';

/** The server answers 404 both for a missing order and for another customer's order. */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.code === 'not_found');
}

/**
 * One order, cached under the signed-in account so the order page, the receipt and checkout
 * all read the same copy.
 */
export function useOrder(orderNumber: string) {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  return useQuery({
    queryKey: queryKeys.orders.detail(userId, orderNumber),
    queryFn: ({ signal }) =>
      run((api, accessToken) => api.getOrder(accessToken, orderNumber, { signal })),
    enabled: userId !== null,
  });
}
