import type { PublicOnboarding } from '@nilzora/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useApi } from '@/api/api-context';
import { useSession, useSignedInUserId } from '@/auth/session-context';
import { ApiNotConfiguredError } from '@/lib/errors';
import { queryKeys } from '@/query/query-keys';
import { useAuthorizedApi } from '@/query/use-authorized-api';
import { guestMaySee, readGuestHistory, recordGuestCompletion } from './onboarding-history';

export interface OnboardingState {
  /** The campaign to show now, or null when there is nothing to show. */
  campaign: PublicOnboarding | null;
  /**
   * False while the campaign or the device history is still being read. The gate renders
   * nothing until it is true, so a returning customer never sees a flash of the welcome
   * slides before the server says whether a campaign is due.
   */
  settled: boolean;
}

/**
 * The campaign this viewer should see, if any.
 *
 * Signed-in accounts let the server decide: it knows the campaign window, the audience and
 * the account's own completion history, and returns `campaign: null` when nothing is due.
 * A visitor without an account gets the same campaign document, and this device applies the
 * matching frequency rule from `onboarding-history.ts`. Device history is never uploaded and
 * an account's history never falls back to it.
 */
export function useOnboarding(): OnboardingState {
  const { state } = useSession();
  // Anything but `restoring` means we know whether an account is attached; guessing earlier
  // could fetch and show the guest campaign to a signed-in customer.
  const restored = state.status !== 'restoring';
  const userId = useSignedInUserId();
  const signedIn = userId !== null;
  const api = useApi();
  const run = useAuthorizedApi();

  const campaignQuery = useQuery({
    queryKey: queryKeys.onboarding.campaign(userId),
    queryFn: ({ signal }) => {
      if (signedIn) return run((client, token) => client.publicOnboarding(token, { signal }));
      if (api === null) return Promise.reject(new ApiNotConfiguredError());
      return api.publicOnboarding(null, { signal });
    },
    enabled: restored,
    // One decision per app start: a campaign shown on launch must not reappear every time
    // the app returns to the foreground, and a slow network must not hold the shop closed
    // (the app's own retry policy still covers connection failures).
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const historyQuery = useQuery({
    queryKey: queryKeys.onboarding.guestHistory(),
    queryFn: readGuestHistory,
    enabled: restored && !signedIn,
    staleTime: 0,
    retry: 0,
  });

  if (!restored) return { campaign: null, settled: false };
  const campaign = campaignQuery.data?.campaign ?? null;
  if (campaign === null) return { campaign: null, settled: !campaignQuery.isPending };
  if (signedIn) return { campaign, settled: true };
  if (historyQuery.isPending) return { campaign: null, settled: false };
  const maySee = guestMaySee(campaign, historyQuery.data ?? {});
  return { campaign: maySee ? campaign : null, settled: true };
}

/**
 * Records that the sequence was seen, so it is not shown again under the campaign's
 * frequency: the account's history is written on the server, a visitor's on this device.
 * Failure is reported to the caller — the gate still closes the overlay, because a network
 * problem must never trap someone in an introduction.
 */
export function useCompleteOnboarding(): (campaignId: string) => Promise<void> {
  const userId = useSignedInUserId();
  const run = useAuthorizedApi();
  const queryClient = useQueryClient();

  return useCallback(
    async (campaignId: string) => {
      if (userId === null) {
        await recordGuestCompletion(campaignId);
        await queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.guestHistory() });
        return;
      }
      await run((client, token) => client.completeOnboarding(token, campaignId));
      // The server's copy of "already seen" has changed; drop the cached campaign answer.
      await queryClient.invalidateQueries({
        queryKey: queryKeys.onboarding.campaign(userId),
      });
    },
    [queryClient, run, userId],
  );
}
