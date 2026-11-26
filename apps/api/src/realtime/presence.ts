/*
 * Presence
 * --------
 * "Online" is a claim the server makes about a connection, not one a client can make
 * about itself. A socket counts as present in a conversation only while it keeps sending
 * heartbeats; once its last heartbeat is older than the time-to-live, a sweep closes it and
 * the other members are told the account left. A phone that loses its network in a tunnel
 * therefore stops showing as online instead of staying online forever.
 *
 * Presence is scoped to a conversation rather than to the whole application: a customer
 * browsing the shop is not "online" to a support agent who is not in a thread with them.
 *
 * This registry is process memory, which is right for one API instance. Several instances
 * need the Socket.IO Redis adapter, whose presence is shared.
 */

export interface PresenceRegistry {
  /** Records that a socket is present in a conversation. */
  add(socketId: string, userId: string, conversationId: string): void;
  /** Records a heartbeat for the socket across every conversation it is in. */
  touch(socketId: string): boolean;
  /** Forgets one conversation for a socket; answers the account it belonged to. */
  remove(socketId: string, conversationId: string): string | undefined;
  /** Forgets the socket everywhere; answers the conversations and account it was in. */
  removeAll(socketId: string): { userId: string; conversationIds: string[] } | undefined;
  /** Whether the account currently has a present socket in the conversation. */
  isOnline(conversationId: string, userId: string): boolean;
  /** The accounts present in the conversation, limited to `userIds`. */
  onlineIn(conversationId: string, userIds: readonly string[]): string[];
  /** Sockets whose heartbeat lapsed by `at`: the caller should disconnect them. */
  expired(at?: number): string[];
  /** How many present sockets the conversation has (used by tests and diagnostics). */
  size(conversationId: string): number;
}

export interface PresenceOptions {
  /** How long a socket may stay silent before it stops counting as present. */
  ttlMs?: number;
  now?: () => number;
}

const DEFAULT_TTL_MS = 60_000;

export function createPresenceRegistry(options: PresenceOptions = {}): PresenceRegistry {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;
  const sockets = new Map<string, { userId: string; rooms: Set<string>; lastSeen: number }>();
  const rooms = new Map<string, Map<string, Set<string>>>();

  function detach(socketId: string, conversationId: string): void {
    const members = rooms.get(conversationId);
    const entry = sockets.get(socketId);
    if (!members) return;
    const owned = entry ? members.get(entry.userId) : undefined;
    if (owned) {
      owned.delete(socketId);
      if (owned.size === 0) members.delete(entry!.userId);
    }
    if (members.size === 0) rooms.delete(conversationId);
  }

  return {
    add(socketId, userId, conversationId) {
      const entry = sockets.get(socketId);
      if (entry) {
        entry.lastSeen = now();
        entry.rooms.add(conversationId);
      } else {
        sockets.set(socketId, { userId, rooms: new Set([conversationId]), lastSeen: now() });
      }
      const members = rooms.get(conversationId) ?? new Map<string, Set<string>>();
      const owned = members.get(userId) ?? new Set<string>();
      owned.add(socketId);
      members.set(userId, owned);
      rooms.set(conversationId, members);
    },

    touch(socketId) {
      const entry = sockets.get(socketId);
      if (!entry) return false;
      entry.lastSeen = now();
      return true;
    },

    remove(socketId, conversationId) {
      const entry = sockets.get(socketId);
      if (!entry) return undefined;
      detach(socketId, conversationId);
      entry.rooms.delete(conversationId);
      if (entry.rooms.size === 0) sockets.delete(socketId);
      return entry.userId;
    },

    removeAll(socketId) {
      const entry = sockets.get(socketId);
      if (!entry) return undefined;
      const conversationIds = [...entry.rooms];
      for (const conversationId of conversationIds) detach(socketId, conversationId);
      sockets.delete(socketId);
      return { userId: entry.userId, conversationIds };
    },

    isOnline(conversationId, userId) {
      const owned = rooms.get(conversationId)?.get(userId);
      if (!owned) return false;
      for (const socketId of owned) {
        const entry = sockets.get(socketId);
        if (entry && now() - entry.lastSeen <= ttlMs) return true;
      }
      return false;
    },

    onlineIn(conversationId, userIds) {
      return userIds.filter((userId) => this.isOnline(conversationId, userId));
    },

    expired(at = now()) {
      const stale: string[] = [];
      for (const [socketId, entry] of sockets) {
        if (at - entry.lastSeen > ttlMs) stale.push(socketId);
      }
      return stale;
    },

    size(conversationId) {
      return rooms.get(conversationId)?.size ?? 0;
    },
  };
}
