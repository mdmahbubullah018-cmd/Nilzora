import type { ChatConversationUpdate, ChatMessage } from '@nilzora/contracts';

/*
 * How the REST routes reach the live sockets
 * ------------------------------------------
 * REST handlers own the durable write; the realtime layer owns the broadcast. This tiny
 * interface keeps the two apart so a route stays testable without a socket server, and so
 * the API behaves identically when realtime is switched off: every call becomes a no-op
 * and clients fall back to re-reading over REST.
 *
 * A broadcast is always advisory. It happens after the database commit, so a client that
 * misses it (a dropped connection, a process that died between commit and emit) recovers
 * by re-reading the thread — the message is never only in an event.
 */

export interface ChatNotifier {
  message(conversationId: string, message: ChatMessage): void;
  read(conversationId: string, userId: string, seq: number): void;
  updated(conversationId: string, change: ChatConversationUpdate['change']): void;
  assigned(conversationId: string, assigneeId: string | null): void;
  /** A conversation appeared or moved in the staff queue (a new thread, for example). */
  queue(): void;
}

export const noopNotifier: ChatNotifier = {
  message: () => undefined,
  read: () => undefined,
  updated: () => undefined,
  assigned: () => undefined,
  queue: () => undefined,
};
