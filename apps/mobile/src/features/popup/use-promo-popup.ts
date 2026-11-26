import type { PublicPopup } from '@nilzora/contracts';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/api/api-context';
import { ApiNotConfiguredError } from '@/lib/errors';
import { useSession } from '@/auth/session-context';
import { queryKeys } from '@/query/query-keys';
import { popupMayShow } from './popup-history';

export interface PromoPopupState {
  /** The popup the store is showing, or null when there is nothing to show. */
  popup: PublicPopup | null;
  /**
   * False while the popup or this device's record of it is still being read. The screen renders
   * nothing until it is true, so a visitor never sees a flash of a popup they have dismissed.
   */
  settled: boolean;
}

/**
 * The promotional popup this device may be shown.
 *
 * The server decides whether a popup exists at all — switched on, inside its window — and the
 * device applies its own frequency rule (`popup-history.ts`), exactly as the storefront does.
 * One decision per app start: the popup is not re-asked for when the app returns to the
 * foreground, because the delay is measured from the launch.
 */
export function usePromoPopup(): PromoPopupState {
  const api = useApi();
  const { state: session } = useSession();
  // Who is looking decides which popups fit (an audience of signed-in customers or of guests);
  // while the saved session is still being restored that is not known yet, so nothing shows.
  const resolving = session.status === 'restoring';
  const signedIn = session.status === 'signed_in';
  const popupQuery = useQuery({
    queryKey: queryKeys.popup.list(),
    queryFn: ({ signal }) => {
      if (api === null) return Promise.reject(new ApiNotConfiguredError());
      return api.publicPopups('app', { signal });
    },
    // A popup that nothing carries is treated as "there is none", never as an error to show.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 0,
  });

  // The popups that fit this person, best first. Which one this device may still be shown is
  // decided next, from the device's own record.
  const fitting = (popupQuery.data?.popups ?? []).filter(
    (candidate) =>
      candidate.audience === 'all' || (candidate.audience === 'logged_in' ? signedIn : !signedIn),
  );
  const fittingIds = fitting.map((candidate) => candidate.id).join(',');
  const mayShowQuery = useQuery({
    queryKey: queryKeys.popup.mayShow(fittingIds === '' ? 'none' : fittingIds),
    queryFn: async () => {
      for (const candidate of fitting) {
        if (
          await popupMayShow({
            id: candidate.id,
            frequency: candidate.frequency,
            endsAt: candidate.endsAt,
          })
        ) {
          return candidate;
        }
      }
      return null;
    },
    enabled: fitting.length > 0 && !resolving,
    staleTime: 0,
    retry: 0,
  });

  if (resolving) return { popup: null, settled: false };
  if (fitting.length === 0) return { popup: null, settled: !popupQuery.isPending };
  if (mayShowQuery.isPending) return { popup: null, settled: false };
  return { popup: mayShowQuery.data ?? null, settled: true };
}
