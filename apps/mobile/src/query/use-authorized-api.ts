import type { ApiClient } from '@nilzora/api-client';
import { useCallback } from 'react';
import { useApi } from '@/api/api-context';
import { useSession } from '@/auth/session-context';
import { ApiNotConfiguredError } from '@/lib/errors';

/** A call that needs the signed-in customer: it receives the client and a valid access token. */
export type AuthorizedCall<T> = (api: ApiClient, accessToken: string) => Promise<T>;

export type AuthorizedRun = <T>(call: AuthorizedCall<T>) => Promise<T>;

/**
 * Runs authenticated API calls through the session manager, which refreshes the access
 * token ahead of expiry, retries once after a 401, and ends the session (state moves to
 * `signed_out`) when it cannot continue. The token is handed to `call` and nowhere else.
 *
 * Rejects with `ApiNotConfiguredError` in a build without a valid API address, with
 * `SessionEndedError` when nobody is signed in or the session ended, and otherwise with
 * the call's own `ApiError`. Use describeApiError() to turn any of them into text.
 * The returned function keeps its identity until the API client or session manager changes.
 *
 * Pattern for an authenticated query (screens render it inside <SignedInGate>):
 *
 *   const run = useAuthorizedApi();
 *   const userId = useSignedInUserId();
 *   useQuery({
 *     queryKey: queryKeys.orders.list(userId, { page }),
 *     queryFn: ({ signal }) => run((api, token) => api.listOrders(token, { page }, { signal })),
 *     enabled: userId !== null,
 *   });
 *
 * A mutation is the same: `mutationFn: (body) => run((api, token) => api.createAddress(token, body))`.
 */
export function useAuthorizedApi(): AuthorizedRun {
  const api = useApi();
  const { manager } = useSession();
  return useCallback<AuthorizedRun>(
    (call) => {
      if (api === null || manager === null) return Promise.reject(new ApiNotConfiguredError());
      return manager.authorized((accessToken) => call(api, accessToken));
    },
    [api, manager],
  );
}
