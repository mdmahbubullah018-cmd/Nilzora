import type {
  ChatMessage,
  ChatMessagePage,
  ChatReplySummary,
  PostedChatMessage,
} from '@nilzora/contracts';
import { chatMessageKindSchema, chatParticipantRoleSchema } from '@nilzora/contracts';

/*
 * Messages that are on their way
 * ------------------------------
 * A customer's message must appear the instant they press send, and must never vanish when the
 * request fails. So the thread renders two kinds of row:
 *
 *   stored   — a message the API committed; the only kind that survives a reload.
 *   outgoing — a local message that is being sent, or that failed and can be retried.
 *
 * The two are reconciled by `clientMessageId`, which the server stores as a deduplication key:
 * retrying re-uses the same id, so a request that reached the server but answered badly cannot
 * produce a second message.
 *
 * Everything here is pure so the rules can be tested without a screen or a network.
 */

/**
 * The full thread row for a message the attachment endpoint answered with.
 *
 * `POST /chat/messages` returns a deliberately small message envelope plus the attachment list
 * beside it (the read contract, `chatMessageSchema`, carries the attachments on the message
 * itself). This joins the two, parsing the two enum fields instead of trusting them, and marks
 * the message unedited — a message that was just created cannot have been edited.
 */
export function postedToStored(posted: PostedChatMessage): ChatMessage {
  return {
    ...posted.message,
    senderRole: chatParticipantRoleSchema.parse(posted.message.senderRole),
    kind: chatMessageKindSchema.parse(posted.message.kind),
    editedAt: null,
    attachments: posted.attachments,
  };
}

/** A local message is either still with the server, or refused by it. */
export type OutgoingStatus = 'sending' | 'failed';

/** One file already uploaded for a message that is still being sent. */
export interface OutgoingAttachment {
  id: string;
  fileName: string;
  localUri: string | null;
}

export interface OutgoingMessage {
  /** Generated once and reused on every retry. */
  clientMessageId: string;
  body: string;
  /** Local time the customer pressed send, so ordering and timestamps read naturally. */
  createdAt: string;
  /** The files waiting with this message, in the order they were chosen. */
  attachments: OutgoingAttachment[];
  /** The message this one answers, kept so a retry answers the same one. */
  reply: ChatReplySummary | null;
  /**
   * The newest stored sequence number when the customer pressed send. A stored customer message
   * with a higher one and the same content is this message arriving by another route (the socket
   * can beat the POST answer), so the two are never drawn together.
   */
  baseSeq?: number | null;
  status: OutgoingStatus;
  /** Why the last attempt failed; null while it is still sending. */
  failure: string | null;
}

/**
 * One row of the timeline. A discriminated union rather than a cast, so a stored message and a
 * local one can never be confused for each other when rendering or destructuring.
 */
export type TimelineRow =
  | { kind: 'stored'; key: string; message: ChatMessage }
  | { kind: 'outgoing'; key: string; message: OutgoingMessage };

export function storedRow(message: ChatMessage): TimelineRow {
  return { kind: 'stored', key: `stored:${message.id}`, message };
}

export function outgoingRow(message: OutgoingMessage): TimelineRow {
  return { kind: 'outgoing', key: `outgoing:${message.clientMessageId}`, message };
}

/** Whether every uploaded file of a local message is on the stored one, and no other. */
function sameFiles(
  outgoing: readonly OutgoingAttachment[],
  stored: readonly { id: string }[],
): boolean {
  if (outgoing.length !== stored.length) return false;
  const ids = new Set(stored.map((file) => file.id));
  return outgoing.every((file) => ids.has(file.id));
}

/**
 * Whether a stored message is the committed form of a local one.
 *
 * Three signals, strongest first: the client id the server kept in the message metadata (when it
 * returns one), the uploaded files' ids (a file belongs to exactly one message), and finally the
 * same words from the customer arriving after the local message was created.
 */
export function isTwin(local: OutgoingMessage, stored: ChatMessage): boolean {
  if (stored.metadata['clientMessageId'] === local.clientMessageId) return true;
  if (stored.senderRole !== 'customer') return false;
  if (local.attachments.length > 0) return sameFiles(local.attachments, stored.attachments);
  if (local.baseSeq === undefined || local.baseSeq === null) return false;
  return stored.seq > local.baseSeq && (stored.body ?? '').trim() === local.body.trim();
}

/**
 * The page to render: every committed message in sequence order, then the local ones that are
 * still waiting. A local message is dropped as soon as its stored twin arrives, so a successful
 * send never shows twice — once from the local row and once from the socket or the answer.
 * A stored message answers at most one local message, so two identical sends stay two bubbles.
 */
export function timelineRows(
  stored: readonly ChatMessage[],
  outgoing: readonly OutgoingMessage[],
): TimelineRow[] {
  const claimed = new Set<string>();
  const waiting = outgoing.filter((local) => {
    const twin = stored.find((message) => !claimed.has(message.id) && isTwin(local, message));
    if (twin === undefined) return true;
    claimed.add(twin.id);
    return false;
  });
  return [...stored.map(storedRow), ...waiting.map(outgoingRow)];
}

/** Replaces one local message, e.g. to mark it failed, leaving the rest in place. */
export function updateOutgoing(
  outgoing: readonly OutgoingMessage[],
  clientMessageId: string,
  change: Partial<Pick<OutgoingMessage, 'status' | 'failure'>>,
): OutgoingMessage[] {
  return outgoing.map((message) =>
    message.clientMessageId === clientMessageId ? { ...message, ...change } : message,
  );
}

/** Drops a local message once the server has it (or the customer discarded it). */
export function removeOutgoing(
  outgoing: readonly OutgoingMessage[],
  clientMessageId: string,
): OutgoingMessage[] {
  return outgoing.filter((message) => message.clientMessageId !== clientMessageId);
}

/**
 * Adds a committed message to a cached page without a refetch.
 *
 * A message the cache already holds is ignored: the same row arrives from the POST answer, the
 * socket event and a later page read, and only the first of them should count. A message older
 * than the page (a socket event for history) is inserted in sequence order rather than appended,
 * so the thread never reads out of order.
 */
export function appendStoredMessage(
  page: ChatMessagePage | undefined,
  message: ChatMessage,
): ChatMessagePage {
  const messages = page?.messages ?? [];
  if (messages.some((existing) => existing.id === message.id)) {
    return page ?? { messages, nextCursor: null };
  }
  const next = [...messages];
  const at = next.findIndex((existing) => existing.seq > message.seq);
  if (at === -1) next.push(message);
  else next.splice(at, 0, message);
  return { messages: next, nextCursor: page?.nextCursor ?? null };
}

/** Prepends a page of older history, keeping the thread ordered and de-duplicated. Used when the
 * customer scrolls back: a message already in the cache is not added twice.
 */
export function prependStoredMessages(
  page: ChatMessagePage | undefined,
  older: readonly ChatMessage[],
): ChatMessagePage {
  const existing = new Set((page?.messages ?? []).map((message) => message.id));
  const fresh = older.filter((message) => !existing.has(message.id));
  if (page === undefined) return { messages: [...fresh], nextCursor: null };
  return { messages: [...fresh, ...page.messages], nextCursor: page.nextCursor };
}
