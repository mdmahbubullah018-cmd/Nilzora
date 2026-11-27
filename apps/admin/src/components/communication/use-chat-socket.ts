'use client';

import {
  CHAT_CLIENT_EVENTS,
  CHAT_SERVER_EVENTS,
  type ChatMessage,
  type ChatTypingUpdate,
} from '@nilzora/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { apiGet } from './client';

/*
 * One realtime connection for a Communication screen
 * --------------------------------------------------
 * The socket is an optimisation over REST, never the source of truth: every event is a hint to
 * re-read or to merge a stored message, and a reconnect re-reads whatever was missed.
 *
 * The handshake carries a two-minute ticket from this app's `/api/support?op=ticket`. Socket.IO
 * reuses the handshake data on every reconnect, so a fixed ticket would be refused once it
 * expired and the screen would stay offline for good; the `auth` callback below asks for a
 * fresh ticket on each attempt instead.
 *
 * The socket opens once per screen. Handlers live in a ref, so a change of filter or of the open
 * thread never tears the connection down; only the joined room follows the open thread.
 */

export type Connection = 'connecting' | 'live' | 'offline';

interface Ticket {
  ticket: string;
  expiresAt: number;
  url: string;
}

export interface ChatSocketHandlers {
  onMessage?: (event: { conversationId: string; message: ChatMessage }) => void;
  onUpdated?: (event: { conversationId: string; change: string }) => void;
  onAssigned?: (event: { conversationId: string; assigneeId: string | null }) => void;
  onTyping?: (event: ChatTypingUpdate) => void;
  onRead?: (event: { conversationId: string; userId: string; seq: number }) => void;
  /** The staff queue changed (a new thread, a reply, an assignment): re-read it over REST. */
  onQueueChanged?: () => void;
  /** After a dropped connection comes back: re-read what may have been missed. */
  onReconnected?: () => void;
}

const HEARTBEAT_MS = 25_000;

export function useChatSocket(activeId: string | null, handlers: ChatSocketHandlers) {
  const [connection, setConnection] = useState<Connection>('connecting');
  const socketRef = useRef<Socket | null>(null);
  const handlersRef = useRef(handlers);
  const activeRef = useRef(activeId);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    activeRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    let cancelled = false;
    let socket: Socket | null = null;
    let connectedOnce = false;

    void (async () => {
      const first = await apiGet<Ticket>('?op=ticket');
      if (cancelled) return;
      if (!first.ok) {
        setConnection('offline');
        return;
      }
      let unused: string | null = first.value.ticket;
      socket = io(first.value.url, {
        // The first handshake uses the ticket just issued; every reconnect asks for a new one.
        auth: (callback) => {
          if (unused !== null) {
            callback({ ticket: unused });
            unused = null;
            return;
          }
          void apiGet<Ticket>('?op=ticket').then((next) => {
            callback({ ticket: next.ok ? next.value.ticket : '' });
          });
        },
        transports: ['websocket', 'polling'],
        reconnectionDelayMax: 10_000,
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        setConnection('live');
        // Every (re)connect joins the staff queue feed again: rooms do not survive a reconnect.
        socket?.emit(CHAT_CLIENT_EVENTS.joinQueue);
        const current = activeRef.current;
        if (current !== null) socket?.emit(CHAT_CLIENT_EVENTS.join, { conversationId: current });
        if (connectedOnce) handlersRef.current.onReconnected?.();
        connectedOnce = true;
      });
      socket.on('disconnect', () => setConnection('offline'));
      socket.on('connect_error', () => setConnection('offline'));
      socket.io.on('reconnect_attempt', () => setConnection('connecting'));
      socket.on(
        CHAT_SERVER_EVENTS.newMessage,
        (event: { conversationId: string; message: ChatMessage }) =>
          handlersRef.current.onMessage?.(event),
      );
      socket.on(CHAT_SERVER_EVENTS.updated, (event: { conversationId: string; change: string }) =>
        handlersRef.current.onUpdated?.(event),
      );
      socket.on(
        CHAT_SERVER_EVENTS.assigned,
        (event: { conversationId: string; assigneeId: string | null }) =>
          handlersRef.current.onAssigned?.(event),
      );
      socket.on(CHAT_SERVER_EVENTS.queueChanged, () => handlersRef.current.onQueueChanged?.());
      socket.on(CHAT_SERVER_EVENTS.typing, (event: ChatTypingUpdate) =>
        handlersRef.current.onTyping?.(event),
      );
      socket.on(
        CHAT_SERVER_EVENTS.read,
        (event: { conversationId: string; userId: string; seq: number }) =>
          handlersRef.current.onRead?.(event),
      );
    })();

    return () => {
      cancelled = true;
      socket?.disconnect();
      socketRef.current = null;
    };
  }, []);

  // The room follows the open thread; the heartbeat keeps this account's presence honest.
  useEffect(() => {
    const socket = socketRef.current;
    if (socket === null || connection !== 'live' || activeId === null) return;
    socket.emit(CHAT_CLIENT_EVENTS.join, { conversationId: activeId });
    const timer = setInterval(() => socket.emit(CHAT_CLIENT_EVENTS.heartbeat), HEARTBEAT_MS);
    return () => {
      clearInterval(timer);
      socket.emit(CHAT_CLIENT_EVENTS.leave, { conversationId: activeId });
    };
  }, [activeId, connection]);

  /** Tells the room this operator is (or stopped) typing; the server throttles and expires it. */
  const typing = useCallback((active: boolean) => {
    const socket = socketRef.current;
    const conversationId = activeRef.current;
    if (socket === null || !socket.connected || conversationId === null) return;
    socket.emit(active ? CHAT_CLIENT_EVENTS.typingStart : CHAT_CLIENT_EVENTS.typingStop, {
      conversationId,
    });
  }, []);

  return { connection, typing };
}
