import type {
  ChatConversationStatus,
  ChatConversationSummary,
  ChatInternalNote,
  ChatMessage,
  ChatParticipant,
  ChatPriority,
  ChatQueueSort,
  ChatReplySummary,
} from '@nilzora/contracts';
import type { StatusTone } from '@/components/admin-kit/status-tones';

/*
 * The Communication Center's pure rules
 * -------------------------------------
 * Labels, tones and the small calculations the inbox draws from: how a thread's messages and
 * staff notes interleave, which reply the customer has seen, and how a stored message replaces
 * the copy the operator was still waiting on. No fetching and no React here, so each rule is
 * tested on its own.
 */

export const STATUS_LABEL: Record<ChatConversationStatus, string> = {
  open: 'Open',
  pending: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const STATUS_TONE: Record<ChatConversationStatus, StatusTone> = {
  open: 'primary',
  pending: 'warning',
  resolved: 'success',
  closed: 'neutral',
};

export const PRIORITY_LABEL: Record<ChatPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

export const PRIORITY_TONE: Record<ChatPriority, StatusTone> = {
  low: 'neutral',
  normal: 'neutral',
  high: 'warning',
  urgent: 'danger',
};

export const SORT_LABEL: Record<ChatQueueSort, string> = {
  queue: 'Needs attention first',
  recent: 'Most recent activity',
  oldest: 'Oldest activity',
};

export const SCOPES = [
  { key: 'all', label: 'All' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'mine', label: 'Mine' },
] as const;
export type InboxScope = (typeof SCOPES)[number]['key'];

/** Who the thread is with, in the words the list shows. */
export function customerLabel(conversation: ChatConversationSummary): string {
  if (conversation.kind === 'moderation') return 'Moderation';
  return conversation.customerName?.trim() || conversation.customerEmail || 'Customer';
}

/** Initials for the list's avatar, from the name the API gave (never invented). */
export function initialsOf(name: string): string {
  const words = name
    .replace(/@.*$/, '')
    .split(/[\s._-]+/)
    .filter((word) => word !== '');
  const letters = words.length === 0 ? ['?'] : words.slice(0, 2).map((word) => word[0] ?? '');
  return letters.join('').toUpperCase();
}

/**
 * True when the last word in an active thread is the customer's: someone on the team owes a
 * reply. A resolved thread the customer wrote in again counts too — the queue surfaces it.
 */
export function awaitingReply(conversation: ChatConversationSummary): boolean {
  if (conversation.status === 'closed') return false;
  return (
    conversation.customerId !== null &&
    conversation.lastMessageSenderId !== null &&
    conversation.lastMessageSenderId === conversation.customerId
  );
}

/** "now", "5m", "3h", "2d", or a short date — always derived from the timestamp given. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${String(Math.floor(seconds / 60))}m`;
  if (seconds < 86_400) return `${String(Math.floor(seconds / 3600))}h`;
  if (seconds < 7 * 86_400) return `${String(Math.floor(seconds / 86_400))}d`;
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function clockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function fullTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "Today", "Yesterday" or a date, for the separators between days in a thread. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const startOf = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/**
 * Adds stored messages to the ones on screen: one copy per id, in sequence order. Used for the
 * socket echo, the API's answer to a send and an older page alike, so none of them can draw a
 * message twice.
 */
export function mergeMessages(
  current: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/** A reply the operator wrote that the API has not confirmed yet. */
export interface OutgoingReply {
  clientMessageId: string;
  body: string;
  attachmentId: string | null;
  attachmentName: string | null;
  /** The message this one answers, kept so a retry answers the same one. */
  reply: ChatReplySummary | null;
  createdAt: string;
  state: 'sending' | 'failed';
  error: string | null;
}

export type TimelineItem =
  | { type: 'day'; key: string; label: string }
  | { type: 'message'; key: string; message: ChatMessage; grouped: boolean }
  | { type: 'note'; key: string; note: ChatInternalNote }
  | { type: 'outgoing'; key: string; reply: OutgoingReply };

function dayKey(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toDateString();
}

/**
 * One timeline for the thread: customer-visible messages and staff-only notes in the order they
 * were written, a separator wherever the day changes, and the replies still on their way at the
 * end. Consecutive messages from one author are `grouped` so the name is not repeated.
 */
export function buildTimeline(
  messages: readonly ChatMessage[],
  notes: readonly ChatInternalNote[],
  outgoing: readonly OutgoingReply[],
  now: Date = new Date(),
): TimelineItem[] {
  const entries: { at: number; order: number; item: TimelineItem; createdAt: string }[] = [];
  messages.forEach((message, index) => {
    entries.push({
      at: new Date(message.createdAt).getTime(),
      order: index,
      createdAt: message.createdAt,
      item: { type: 'message', key: `m:${message.id}`, message, grouped: false },
    });
  });
  notes.forEach((note, index) => {
    entries.push({
      at: new Date(note.createdAt).getTime(),
      order: messages.length + index,
      createdAt: note.createdAt,
      item: { type: 'note', key: `n:${note.id}`, note },
    });
  });
  entries.sort((a, b) => a.at - b.at || a.order - b.order);

  const items: TimelineItem[] = [];
  let lastDay = '';
  let previous: ChatMessage | null = null;
  for (const entry of entries) {
    const day = dayKey(entry.createdAt);
    if (day !== lastDay) {
      items.push({ type: 'day', key: `d:${day}`, label: dayLabel(entry.createdAt, now) });
      lastDay = day;
      previous = null;
    }
    if (entry.item.type === 'message') {
      const message = entry.item.message;
      const grouped =
        previous !== null &&
        previous.kind !== 'system' &&
        message.kind !== 'system' &&
        previous.senderRole === message.senderRole &&
        previous.senderId === message.senderId &&
        new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000;
      items.push({ ...entry.item, grouped });
      previous = message;
    } else {
      items.push(entry.item);
      previous = null;
    }
  }
  for (const reply of outgoing) {
    items.push({ type: 'outgoing', key: `o:${reply.clientMessageId}`, reply });
  }
  return items;
}

/**
 * The highest sequence the customer has read, from the participants the API returned, or null
 * when the customer is not a participant (nothing can honestly be called "seen" then).
 */
export function customerReadSeq(
  participants: readonly ChatParticipant[],
  customerId: string | null,
): number | null {
  if (customerId === null) return null;
  const customer = participants.find((participant) => participant.userId === customerId);
  return customer === undefined ? null : customer.lastReadSeq;
}

/**
 * The id of the newest team message the customer has read, so the "Seen" mark sits on exactly
 * one bubble. Null when the customer has read none of the team's messages.
 */
export function lastSeenTeamMessageId(
  messages: readonly ChatMessage[],
  readSeq: number | null,
): string | null {
  if (readSeq === null) return null;
  let found: string | null = null;
  for (const message of messages) {
    if (message.senderRole === 'customer' || message.kind === 'system') continue;
    if (message.seq <= readSeq) found = message.id;
  }
  return found;
}
