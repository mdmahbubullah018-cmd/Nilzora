import type { NotificationPreferences, NotificationPreferencesPatch } from '@nilzora/contracts';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useSignedInUserId } from '@/auth/session-context';
import { queryKeys, useAuthorizedApi } from '@/query';

/*
 * The account's notification choices.
 *
 * The row lives on the server, keyed by the session's own account, so a choice follows the
 * customer to another phone and is enforced where a notification is written. A save sends
 * only the switch that moved; the rest keep their value.
 */

const isPreferencesQuery = (query: { queryKey: QueryKey }): boolean =>
  query.queryKey.includes('notification-preferences');

export function useNotificationPreferences() {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  return useQuery({
    queryKey: queryKeys.notifications.preferences(userId),
    queryFn: ({ signal }) =>
      run((client, token) => client.notificationPreferences(token, { signal })).then(
        (r) => r.preferences,
      ),
    enabled: userId !== null,
  });
}

/**
 * Saves one switch.
 *
 * The switch moves the moment it is pressed (`onMutate` writes the new value into the cache),
 * and the server's own answer replaces it when the request returns. A failure puts back exactly
 * what the server last confirmed, so the screen can never keep a value the database does not
 * have. Saves run one at a time in the order they were made (`scope`), so flipping a switch
 * twice quickly ends with the second press winning rather than whichever request finished last.
 */
export function useSaveNotificationPreferences() {
  const run = useAuthorizedApi();
  const queryClient = useQueryClient();
  return useMutation({
    scope: { id: 'notification-preferences' },
    mutationFn: (patch: NotificationPreferencesPatch) =>
      run((client, token) => client.saveNotificationPreferences(token, patch)).then(
        (r) => r.preferences,
      ),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ predicate: isPreferencesQuery });
      const previous = queryClient.getQueriesData<NotificationPreferences>({
        predicate: isPreferencesQuery,
      });
      queryClient.setQueriesData<NotificationPreferences>(
        { predicate: isPreferencesQuery },
        (row) => (row === undefined ? row : { ...row, ...patch }),
      );
      return { previous };
    },
    onError: (_error, _patch, context) => {
      for (const [key, row] of context?.previous ?? []) {
        if (row !== undefined) queryClient.setQueryData(key, row);
      }
    },
    onSuccess: (preferences: NotificationPreferences) => {
      // The server's answer is the truth: put it in the cache instead of guessing.
      queryClient.setQueriesData<NotificationPreferences>(
        { predicate: isPreferencesQuery },
        preferences,
      );
    },
  });
}
