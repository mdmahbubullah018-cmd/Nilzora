import type { CampaignSummary } from '@nilzora/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApi } from '@/api/api-context';
import { ApiNotConfiguredError } from '@/lib/errors';

/*
 * Live discount campaigns. The prices themselves are already in every product payload —
 * the API resolves a campaign before it answers — so these hooks only feed banners and
 * labels. The stale time is short because a campaign can start or end at any minute.
 */

/** How long a campaign feed is reused before the app asks again. */
export const CAMPAIGN_STALE_TIME_MS = 60_000;

/** Campaigns a shopper may see: all of them, or the ones reaching one category. */
export function useCampaigns(category?: string): UseQueryResult<readonly CampaignSummary[]> {
  const api = useApi();
  return useQuery({
    queryKey: ['catalog', 'campaigns', category ?? null],
    staleTime: CAMPAIGN_STALE_TIME_MS,
    queryFn: async ({ signal }) => {
      if (api === null) throw new ApiNotConfiguredError();
      return (await api.listCampaigns(category === undefined ? {} : { category }, { signal }))
        .campaigns;
    },
  });
}
