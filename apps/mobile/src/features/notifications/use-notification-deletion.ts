import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuthorizedApi } from '@/query';

/*
 * Deleting from the notification centre, with a short window to change your mind.
 *
 * A deletion is shown at once (the entry leaves the list) but is only sent to the server when the
 * window ends, so Undo is simply "do not send it": nothing has to be restored, and an entry that was
 * already deleted for good is never brought back. A second deletion, leaving the screen, or the app
 * going to the background ends the window early and sends the first one, so there is never more
 * than one pending batch and never a half-undone state. If the request fails the entries return
 * and the customer is told.
 *
 * "Clear all" sends a cut-off time rather than a list of ids: it clears everything the customer has
 * up to that moment (including older pages that were never loaded) and nothing that arrives later.
 */

/** How long Undo is offered. */
export const UNDO_WINDOW_MS = 3000;

export type PendingDeletion =
  { kind: 'one'; id: string } | { kind: 'all'; before: string; count: number };

export interface NotificationDeletion {
  /** The batch waiting out its undo window, if any. */
  pending: PendingDeletion | null;
  /** Why the last deletion could not be completed. */
  failure: string | null;
  /** Whether a row is currently hidden by a pending or just-sent deletion. */
  isHidden: (row: { id: string; createdAt: string }) => boolean;
  remove: (id: string) => void;
  clearAll: (count: number) => void;
  undo: () => void;
  dismissFailure: () => void;
}

export function useNotificationDeletion(): NotificationDeletion {
  const run = useAuthorizedApi();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingDeletion | null>(null);
  // What is out of the list: single ids, and a cut-off for Clear all. They stay hidden after the
  // request is sent until the refreshed list arrives, so nothing flashes back for a moment.
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  const [hiddenBefore, setHiddenBefore] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waiting = useRef<PendingDeletion | null>(null);

  const stopTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };

  const commit = useCallback(
    async (batch: PendingDeletion) => {
      try {
        if (batch.kind === 'all') {
          await run((client, token) => client.clearMyNotifications(token, batch.before));
        } else {
          await run((client, token) => client.deleteMyNotifications(token, [batch.id]));
        }
        await queryClient.invalidateQueries({
          predicate: (query) => query.queryKey.includes('notifications'),
        });
      } catch {
        setFailure(
          batch.kind === 'all'
            ? 'Your notifications could not be cleared. They are back in the list.'
            : 'That notification could not be deleted. It is back in the list.',
        );
      } finally {
        if (batch.kind === 'all')
          setHiddenBefore((current) => (current === batch.before ? null : current));
        else {
          setHiddenIds((current) => {
            const next = new Set(current);
            next.delete(batch.id);
            return next;
          });
        }
      }
    },
    [queryClient, run],
  );

  // The latest commit, read through a ref so `flush` keeps one identity: it is also the unmount
  // cleanup, and a changing identity would end the undo window early.
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });

  const flush = useCallback(() => {
    stopTimer();
    const batch = waiting.current;
    waiting.current = null;
    setPending(null);
    if (batch !== null) void commitRef.current(batch);
  }, []);

  const start = useCallback(
    (batch: PendingDeletion) => {
      // One window at a time: an earlier deletion is sent now, not left half-decided.
      flush();
      waiting.current = batch;
      setPending(batch);
      setFailure(null);
      timer.current = setTimeout(flush, UNDO_WINDOW_MS);
    },
    [flush],
  );

  const remove = useCallback(
    (id: string) => {
      setHiddenIds((current) => new Set(current).add(id));
      start({ kind: 'one', id });
    },
    [start],
  );

  const clearAll = useCallback(
    (count: number) => {
      const before = new Date().toISOString();
      setHiddenBefore(before);
      start({ kind: 'all', before, count });
    },
    [start],
  );

  const undo = useCallback(() => {
    stopTimer();
    const batch = waiting.current;
    waiting.current = null;
    setPending(null);
    if (batch === null) return;
    if (batch.kind === 'all') setHiddenBefore(null);
    else {
      setHiddenIds((current) => {
        const next = new Set(current);
        next.delete(batch.id);
        return next;
      });
    }
  }, []);

  // Leaving the screen, or the app going to the background, ends the window: the customer chose to
  // delete it, and a suspended timer must not leave the decision open.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flush();
    });
    return () => {
      subscription.remove();
      flush();
    };
  }, [flush]);

  const isHidden = useCallback(
    (row: { id: string; createdAt: string }) =>
      hiddenIds.has(row.id) || (hiddenBefore !== null && row.createdAt <= hiddenBefore),
    [hiddenBefore, hiddenIds],
  );

  return {
    pending,
    failure,
    isHidden,
    remove,
    clearAll,
    undo,
    dismissFailure: () => setFailure(null),
  };
}
