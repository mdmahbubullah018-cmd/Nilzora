import type { CustomerNotificationKind } from '@nilzora/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSignedInUserId } from '@/auth/session-context';
import { queryKeys, useAuthorizedApi } from '@/query';

/*
 * The account's notification history on the device.
 *
 * Same API, same contracts and the same ownership rule as the website: a request carries a
 * session token, never an account id, and the database answers `auth.uid()`. One page at a
 * time, newest first with the id as tie-breaker, so loading more never repeats or skips a row.
 */

const PAGE_SIZE = 20;

/** One page of the signed-in account's notifications, optionally of one category. */
export function useMyNotifications(kind: CustomerNotificationKind | null) {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  return useInfiniteQuery({
    queryKey: queryKeys.notifications.list(userId, kind),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      run((client, token) =>
        client.myNotifications(
          token,
          { page: pageParam, pageSize: PAGE_SIZE, ...(kind === null ? {} : { kind }) },
          { signal },
        ),
      ),
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled: userId !== null,
  });
}

/** The unread count the account screen shows beside the notification row. */
export function useUnreadNotificationCount() {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  return useQuery({
    queryKey: queryKeys.notifications.unread(userId),
    queryFn: ({ signal }) =>
      run((client, token) => client.myUnreadNotifications(token, { signal })).then((r) => r.unread),
    enabled: userId !== null,
  });
}

/** Marks one notification read, then refreshes every notification list and the badge. */
export function useMarkNotificationRead() {
  const run = useAuthorizedApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => run((client, token) => client.markMyNotificationRead(token, id)),
    onSuccess: () => invalidateNotifications(queryClient),
  });
}

/** Marks everything read. */
export function useMarkAllNotificationsRead() {
  const run = useAuthorizedApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => run((client, token) => client.markAllMyNotificationsRead(token)),
    onSuccess: () => invalidateNotifications(queryClient),
  });
}

/**
 * One place that knows every cache a read state belongs to. The keys are account-scoped, so
 * this matches the notification subtree rather than naming one account's key.
 */
async function invalidateNotifications(
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  await queryClient.invalidateQueries({
    predicate: (query) => query.queryKey.includes('notifications'),
  });
}
