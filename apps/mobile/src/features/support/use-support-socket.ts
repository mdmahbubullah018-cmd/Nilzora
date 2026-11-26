import type { ChatMessage, ChatMessagePage } from '@nilzora/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { io, type Socket } from 'socket.io-client';
import { getMobileApiBaseUrl } from '@/auth/api';
import { useSession, useSignedInUserId } from '@/auth/session-context';
import { queryKeys } from '@/query/query-keys';
import { appendStoredMessage } from './optimistic-messages';

/*
 * Live updates for the customer's chat
 * ------------------------------------
 * The socket authenticates with the account's access token, which the session manager hands
 * over inside `authorized()` — the token never leaves that callback. Socket events are an
 * optimization: a thread is read over REST when it opens, so a missed event loses nothing.
 *
 * The app keeps working on a weak connection: if the socket cannot be reached the screen
 * says so and the pull-to-refresh read is still the source of truth.
 */

export type SupportConnection = 'connecting' | 'live' | 'offline';

export interface SupportSocket {
  connection: SupportConnection;
  /** The teammate currently typing in the open conversation, if any. */
  typingName: string | null;
  /** Tells the other side that this customer is writing; throttled to one event every 3s. */
  notifyTyping: () => void;
  notifyStoppedTyping: () => void;
}

export function useSupportSocket(conversationId: string | null): SupportSocket {
  const { manager } = useSession();
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<SupportConnection>('offline');
  const [typingName, setTypingName] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const activeRef = useRef<string | null>(null);
  const lastTypingRef = useRef(0);

  useEffect(() => {
    activeRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    if (manager === null) return;
    const baseUrl = getMobileApiBaseUrl();
    if (baseUrl === null) return;

    let cancelled = false;
    let socket: Socket | null = null;
    let appState: { remove: () => void } | null = null;

    void (async () => {
      try {
        await manager.authorized((accessToken) => {
          if (cancelled) return Promise.resolve();
          setConnection('connecting');
          let unused: string | null = accessToken;
          let connectedOnce = false;
          socket = io(baseUrl, {
            /*
             * Socket.IO repeats the first handshake's data on every reconnect, and an access token
             * expires; a fixed token would leave the chat offline for good after a long gap. The
             * first handshake uses the token just read, each reconnect asks the session for a
             * current one (refreshing it when needed).
             */
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
            reconnectionDelayMax: 10_000,
          });
          socketRef.current = socket;
          // A phone whose screen is off (or whose app is in the background) holds no open connection
          // and sends no heartbeat. Coming back reconnects with a current token, and the reconnect
          // re-reads whatever changed meanwhile (see the `connect` handler).
          const live = socket;
          appState = AppState.addEventListener('change', (state) => {
            if (state === 'active') {
              if (!live.connected) live.connect();
            } else {
              live.disconnect();
            }
          });

          socket.on('connect', () => {
            setConnection('live');
            const current = activeRef.current;
            if (current !== null) socket?.emit('conversation:join', { conversationId: current });
            // Anything sent while the connection was down is read again, not lost.
            if (connectedOnce) {
              void queryClient.invalidateQueries({ queryKey: queryKeys.support.all(userId) });
            }
            connectedOnce = true;
          });
          socket.on('disconnect', () => setConnection('offline'));
          socket.on('connect_error', () => setConnection('offline'));
          socket.on('message:new', (event: { conversationId: string; message: ChatMessage }) => {
            setTypingName(null);
            // The event carries the committed message, so it is merged into the cached thread
            // instead of re-reading the whole page. When the thread is not loaded yet there is
            // nothing to merge into, and the read that opens it will fetch everything anyway.
            const key = queryKeys.support.messages(userId, event.conversationId);
            if (queryClient.getQueryData(key) !== undefined) {
              queryClient.setQueryData<ChatMessagePage>(key, (page) =>
                appendStoredMessage(page, event.message),
              );
            }
            void queryClient.invalidateQueries({
              queryKey: queryKeys.support.conversations(userId),
            });
          });
          /*
           * One event covers everything that changes the thread rather than a message: a new
           * pin, a reaction, a status or priority change, a rating, an assignment. The client
           * re-reads what changed instead of trying to patch state from the payload, so a
           * missed or repeated event cannot leave the screen wrong.
           */
          socket.on('conversation:updated', (event: { conversationId: string; change: string }) => {
            const id = event.conversationId;
            void queryClient.invalidateQueries({
              queryKey: queryKeys.support.conversation(userId, id),
            });
            void queryClient.invalidateQueries({
              queryKey: queryKeys.support.conversations(userId),
            });
            if (event.change === 'pin' || event.change === 'reaction') {
              void queryClient.invalidateQueries({
                queryKey: queryKeys.support.pins(userId, id),
              });
              void queryClient.invalidateQueries({
                queryKey: queryKeys.support.reactions(userId, id),
              });
            }
            if (event.change === 'status' || event.change === 'message') {
              void queryClient.invalidateQueries({
                queryKey: queryKeys.support.messages(userId, id),
              });
            }
          });
          socket.on(
            'typing:update',
            (event: { conversationId: string; name: string | null; typing: boolean }) => {
              if (event.conversationId !== activeRef.current) return;
              setTypingName(event.typing ? (event.name ?? 'Support') : null);
            },
          );
          return Promise.resolve();
        });
      } catch {
        setConnection('offline');
      }
    })();

    return () => {
      cancelled = true;
      appState?.remove();
      socket?.disconnect();
      socketRef.current = null;
      setConnection('offline');
    };
  }, [manager, queryClient, userId]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected || conversationId === null) return;
    socket.emit('conversation:join', { conversationId });
    const timer = setInterval(() => socket.emit('presence:heartbeat'), 25_000);
    return () => {
      clearInterval(timer);
      setTypingName(null);
      socket.emit('conversation:leave', { conversationId });
    };
  }, [conversationId, connection]);

  return {
    connection,
    typingName,
    notifyTyping: () => {
      const socket = socketRef.current;
      if (!socket || conversationId === null) return;
      const now = Date.now();
      if (now - lastTypingRef.current < 3_000) return;
      lastTypingRef.current = now;
      socket.emit('typing:start', { conversationId });
    },
    notifyStoppedTyping: () => {
      const socket = socketRef.current;
      if (!socket || conversationId === null) return;
      lastTypingRef.current = 0;
      socket.emit('typing:stop', { conversationId });
    },
  };
}
