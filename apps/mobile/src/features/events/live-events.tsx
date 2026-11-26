import { DOMAIN_EVENT_SOCKET_EVENT, type DomainEvent } from '@nilzora/contracts';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { io, type Socket } from 'socket.io-client';
import { getMobileApi, getMobileApiBaseUrl } from '@/auth/api';
import { useSession, useSignedInUserId } from '@/auth/session-context';
import { queryKeys } from '@/query/query-keys';

/*
 * Live order and notification updates, app-wide
 * ---------------------------------------------
 * While a customer is signed in, one socket listens for the store's domain events addressed to
 * them (their order moved on, a new notification arrived) and refreshes exactly the screens that
 * show those things. The socket is only the fast path:
 *
 *   - every (re)connect, and every return to the foreground, first asks GET /me/events for what
 *     happened after the last event this app processed, so a dropped connection loses nothing;
 *   - an event is processed once, by its `seq`, whether it arrived live, through the catch-up
 *     read, or both;
 *   - reconnection backs off exponentially (1 s doubling to 30 s, with jitter).
 *
 * Nothing is trusted from the event beyond "something changed": the screens re-read the order or
 * notification through the authorised REST endpoints.
 */

/** Which cached screens an event makes stale. */
export function invalidateFor(queryClient: QueryClient, userId: string, event: DomainEvent): void {
  if (event.type.startsWith('order.') || event.type === 'payment.collected') {
    void queryClient.invalidateQueries({ queryKey: queryKeys.orders.all(userId) });
  }
  if (event.type === 'customer_notification.created') {
    void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all(userId) });
  }
}

/** Remembers the highest seq processed, and processes each seq once. */
export function createEventCursor(start = 0) {
  let cursor = start;
  return {
    get value() {
      return cursor;
    },
    /** True the first time a seq above the cursor is seen; it then moves the cursor. */
    accept(seq: number): boolean {
      if (seq <= cursor) return false;
      cursor = seq;
      return true;
    },
  };
}

export function LiveEvents() {
  const { manager } = useSession();
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (manager === null || userId === null) return;
    const baseUrl = getMobileApiBaseUrl();
    const mobile = getMobileApi();
    if (baseUrl === null || !mobile.ok) return;
    const { api } = mobile;

    let cancelled = false;
    let socket: Socket | null = null;
    let cursor: ReturnType<typeof createEventCursor> | null = null;
    let catchingUp = false;

    const handle = (event: DomainEvent) => {
      if (cursor?.accept(event.seq)) invalidateFor(queryClient, userId, event);
    };

    /** Reads everything after the cursor, page by page; a failure just waits for the next try. */
    const catchUp = async () => {
      if (cursor === null || catchingUp) return;
      catchingUp = true;
      try {
        for (let page = 0; page < 10 && !cancelled; page += 1) {
          const after = cursor.value;
          const result = await manager.authorized((token) => api.myEvents(token, after, 100));
          for (const event of result.events) handle(event);
          if (!result.hasMore) break;
        }
      } catch {
        // Offline or signed out: the next connect or foreground tries again.
      } finally {
        catchingUp = false;
      }
    };

    void (async () => {
      try {
        // Start from "now": the screens already read the current state over REST.
        const start = await manager.authorized((token) => api.myEventsCursor(token));
        if (cancelled) return;
        cursor = createEventCursor(start.cursor);
        await manager.authorized((accessToken) => {
          if (cancelled) return Promise.resolve();
          let unused: string | null = accessToken;
          socket = io(baseUrl, {
            // A fresh token on every reconnect: the first one expires (see use-support-socket).
            auth: (callback) => {
              if (unused !== null) {
                callback({ token: unused });
                unused = null;
                return;
              }
              manager
                .authorized((token) => {
                  callback({ token });
                  return Promise.resolve();
                })
                .catch(() => callback({ token: '' }));
            },
            transports: ['websocket', 'polling'],
            reconnectionDelay: 1_000,
            reconnectionDelayMax: 30_000,
            randomizationFactor: 0.5,
          });
          socket.on('connect', () => void catchUp());
          socket.on(DOMAIN_EVENT_SOCKET_EVENT, (event: DomainEvent) => handle(event));
          return Promise.resolve();
        });
      } catch {
        // Not signed in, or the API is unreachable: screens keep working over REST.
      }
    })();

    // A backgrounded phone holds no connection; coming back reconnects and catches up.
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (socket && !socket.connected) socket.connect();
        void catchUp();
      } else {
        socket?.disconnect();
      }
    });

    return () => {
      cancelled = true;
      appState.remove();
      socket?.removeAllListeners();
      socket?.disconnect();
    };
  }, [manager, userId, queryClient]);

  return null;
}
