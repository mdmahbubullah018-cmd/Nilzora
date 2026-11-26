import type { ReturnListResponse, ReturnRequest, ReturnResponse } from '@nilzora/contracts';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useSignedInUserId } from '@/auth/session-context';
import { queryKeys, useAuthorizedApi } from '@/query';

/*
 * The customer's own returns. Every call goes to the API as the signed-in account, so the
 * server decides which orders may be returned, how many units, and whether a request can
 * still be cancelled. Nothing here is computed on the device.
 */

/** The account's return requests, newest first. The list is short, so it is one page. */
export function useReturns(): UseQueryResult<ReturnListResponse> {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  return useQuery({
    queryKey: queryKeys.returns.list(userId),
    queryFn: ({ signal }) => run((api, token) => api.myReturns(token, { signal })),
    enabled: userId !== null,
  });
}

/** One return request with its items, history and any refunds recorded against it. */
export function useReturn(returnId: string): UseQueryResult<ReturnResponse> {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  return useQuery({
    queryKey: queryKeys.returns.detail(userId, returnId),
    queryFn: ({ signal }) => run((api, token) => api.myReturn(token, returnId, { signal })),
    enabled: userId !== null && returnId !== '',
  });
}

export interface ReturnActions {
  /** Sends a return request; resolves with the saved request. */
  request: (input: ReturnRequest) => Promise<ReturnResponse>;
  /** Cancels a request that is still waiting for a decision. */
  cancel: (returnId: string) => Promise<void>;
  requesting: boolean;
  cancelling: boolean;
}

export function useReturnActions(): ReturnActions {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();

  const request = useMutation({
    mutationFn: (input: ReturnRequest) => run((api, token) => api.requestReturn(token, input)),
  });
  const cancel = useMutation({
    mutationFn: (returnId: string) => run((api, token) => api.cancelMyReturn(token, returnId)),
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.returns.all(userId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.orders.all(userId) });
  }, [queryClient, userId]);

  const requestReturn = useCallback(
    async (input: ReturnRequest) => {
      const saved = await request.mutateAsync(input);
      refresh();
      return saved;
    },
    [refresh, request],
  );

  const cancelReturn = useCallback(
    async (returnId: string) => {
      await cancel.mutateAsync(returnId);
      refresh();
    },
    [cancel, refresh],
  );

  return {
    request: requestReturn,
    cancel: cancelReturn,
    requesting: request.isPending,
    cancelling: cancel.isPending,
  };
}
