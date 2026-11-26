import type { ChatConversationStatus, ChatMessage, ChatParticipant } from '@nilzora/contracts';

/*
 * The support widget's pure rules
 * -------------------------------
 * Status words, how a stored message joins the ones on screen, and which of the customer's
 * messages the team has read. No fetching and no React, so each rule is tested on its own.
 */

export const STATUS_LABEL: Record<ChatConversationStatus, string> = {
  open: 'Open',
  pending: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

/** Open and in-progress threads are listed first, as the ones still being worked on. */
export function isActiveStatus(status: ChatConversationStatus): boolean {
  return status === 'open' || status === 'pending';
}

/**
 * Adds stored messages to the ones on screen: one copy per id, in sequence order. The socket
 * echo, the answer to a send and an older page all go through here, so none can appear twice.
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

/**
 * The furthest any teammate has read in this thread, from the participants the API returned.
 * Null when no teammate is a participant yet: nothing can honestly be called "seen" then.
 */
export function teamReadSeq(
  participants: readonly ChatParticipant[],
  selfId: string | null,
): number | null {
  let furthest: number | null = null;
  for (const participant of participants) {
    if (
      participant.userId === selfId ||
      participant.role === 'customer' ||
      participant.role === 'system'
    ) {
      continue;
    }
    furthest = Math.max(furthest ?? 0, participant.lastReadSeq);
  }
  return furthest === null || furthest === 0 ? null : furthest;
}

/** The newest of the customer's own messages the team has read, so "Seen" marks one bubble. */
export function lastSeenCustomerMessageId(
  messages: readonly ChatMessage[],
  readSeq: number | null,
): string | null {
  if (readSeq === null) return null;
  let found: string | null = null;
  for (const message of messages) {
    if (message.senderRole === 'customer' && message.seq <= readSeq) found = message.id;
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// Message rules shared by the bubble, the reaction bar, the actions menu and the feedback prompt
// ---------------------------------------------------------------------------------------------

type MessageLike = Pick<ChatMessage, 'kind' | 'senderRole'>;

/** A system note or an order event is a line of the timeline, not something a person said. */
export function isTimelineMessage(message: Pick<ChatMessage, 'kind'>): boolean {
  return message.kind === 'system' || message.kind === 'order_event';
}

/** Reactions apply to every message a person or the assistant wrote, and to nothing else. */
export function isReactable(message: Pick<ChatMessage, 'kind'>): boolean {
  return !isTimelineMessage(message);
}

/**
 * A reply from the team or the assistant: not the customer's own message, and not a timeline row.
 * This is what "Report" and "Was this helpful?" are about.
 */
export function isSupportReply(message: MessageLike): boolean {
  return (
    message.senderRole !== 'customer' &&
    message.senderRole !== 'system' &&
    !isTimelineMessage(message)
  );
}

/**
 * Report is offered for what someone else wrote, never for the customer's own words: a team
 * reply, and also a Nilzora Assistant reply. The assistant's rows carry `senderRole: 'system'`,
 * which `isSupportReply` excludes, but a customer must be able to flag a wrong automated answer
 * (the database function accepts any message of a conversation the caller can read). System
 * pills and order events are timeline rows and stay out.
 */
export function canReportMessage(message: MessageLike): boolean {
  if (message.senderRole === 'customer' || isTimelineMessage(message)) return false;
  return message.kind === 'automated' || isSupportReply(message);
}

/**
 * An attachment-only message is stored with its file names as the body. That text is bookkeeping,
 * not something the customer wrote, so it must never be drawn as a caption or quoted.
 */
export function isSyntheticAttachmentBody(
  body: string | null | undefined,
  attachments: readonly { fileName: string }[] | undefined,
): boolean {
  const text = (body ?? '').trim();
  if (text === '' || attachments === undefined || attachments.length === 0) return false;
  return text === attachments.map((attachment) => attachment.fileName).join(', ');
}

/** The text a bubble should draw: the real body, or '' when it is only the file names. */
export function visibleBody(
  message: Pick<ChatMessage, 'body'> & { attachments?: ChatMessage['attachments'] | undefined },
): string {
  const body = message.body ?? '';
  return isSyntheticAttachmentBody(body, message.attachments) ? '' : body;
}

const FILE_NAME = String.raw`[^,\\/]+\.(?:webp|jpe?g|png|pdf|txt|csv|docx|xlsx|webm|ogg|m4a|mp3|wav)`;
const FILE_NAME_LIST = new RegExp(`^${FILE_NAME}(?:, ${FILE_NAME})*$`, 'i');

/**
 * A quote or a list preview only knows that a message carried a file, not which files, so the
 * synthetic body is recognised by its shape: nothing but comma-separated file names.
 */
export function looksLikeFileNames(body: string | null | undefined): boolean {
  return FILE_NAME_LIST.test((body ?? '').trim());
}

/** The first line of a quote or preview for a message, never the synthetic file-name body. */
export function previewLine(input: {
  body: string | null | undefined;
  hasAttachment: boolean;
  deleted?: boolean | undefined;
}): string {
  if (input.deleted === true) return 'Message unavailable';
  const text = (input.body ?? '').trim();
  if (input.hasAttachment && (text === '' || looksLikeFileNames(text))) return 'Attachment';
  if (text === '') return 'Message';
  return text.split('\n')[0] ?? '';
}

/** The conversation list's preview line: a file-name-only preview reads as "Attachment". */
export function listPreview(preview: string | null): string {
  if (preview === null || preview.trim() === '') return 'No messages yet';
  return looksLikeFileNames(preview) ? 'Attachment' : preview;
}

export type FeedbackVerdict = 'helpful' | 'not_helpful';

/**
 * Which message, if any, may be asked "Was this helpful?".
 *
 * Only a finished conversation asks (resolved or closed), only about the last real reply from the
 * team, and a resolved one stops asking as soon as the customer has written since it was resolved:
 * that is a reopened conversation in all but name. A reply that already has a verdict is excluded
 * by the caller, because that map is read separately.
 */
export function feedbackTargetId(input: {
  status: ChatConversationStatus | null;
  messages: readonly ChatMessage[];
  resolvedAt: string | null | undefined;
  lastCustomerMessageAt: string | null | undefined;
}): string | null {
  if (input.status !== 'resolved' && input.status !== 'closed') return null;
  if (input.status === 'resolved' && input.resolvedAt && input.lastCustomerMessageAt) {
    if (Date.parse(input.lastCustomerMessageAt) > Date.parse(input.resolvedAt)) return null;
  }
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const candidate = input.messages[index];
    if (candidate !== undefined && isSupportReply(candidate)) return candidate.id;
  }
  return null;
}
