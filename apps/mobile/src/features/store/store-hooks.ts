import type { StoreProfileResponse } from '@nilzora/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApi } from '@/api/api-context';
import { ApiNotConfiguredError } from '@/lib/errors';
import { queryKeys } from '@/query';

/**
 * The store's public contact details.
 *
 * Only the public profile is read: the API serves nothing private from this endpoint, so the
 * screen cannot show what the store has not chosen to publish.
 */
export function useStoreProfile(): UseQueryResult<StoreProfileResponse> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.site.storeProfile(),
    queryFn: async ({ signal }) => {
      if (api === null) throw new ApiNotConfiguredError();
      return api.publicStoreProfile({ signal });
    },
  });
}
