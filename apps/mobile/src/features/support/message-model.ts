import type {
  ChatAttachment,
  ChatConversationDetail,
  ChatMessage,
  ChatReplySummary,
} from '@nilzora/contracts';

/*
 * What a message may do, and what it may show
 * -------------------------------------------
 * Pure rules for the conversation screen, kept out of the components so each one can be tested
 * without rendering anything:
 *
 *   - which messages take reactions, replies, reports and the "Was this helpful?" prompt;
 *   - the synthetic text the database stores for an attachment-only message;
 *   - where the long-press menu goes so it never leaves the screen.
 */

type KindOf = Pick<ChatMessage, 'kind'>;

/** System lines and order events are written by the platform: nobody reacts to or reports them. */
export function isPlatformLine(message: KindOf): boolean {
  return message.kind === 'system' || message.kind === 'order_event';
}

/** Every message a person or the assistant wrote takes a reaction. */
export function isReactable(message: KindOf): boolean {
  return !isPlatformLine(message);
}

/** Replying is offered for anything that is drawn as a bubble. */
export function isReplyable(message: KindOf): boolean {
  return !isPlatformLine(message);
}

/** The customer reports what the other side wrote, never their own words or a platform line. */
export function isReportable(message: Pick<ChatMessage, 'kind' | 'senderRole'>): boolean {
  return !isPlatformLine(message) && message.senderRole !== 'customer';
}

const FILE_NAME = /^[^,]+\.(?:webp|jpe?g|png|pdf|txt|csv|docx|xlsx|m4a|mp4|mp3|ogg|webm|wav)$/i;

/**
 * The text a bubble draws. When a message carries only files, the database stores their names
 * joined with ", " as its body (the list preview needs some text); that is not something the
 * customer wrote, so it is hidden whenever it equals the attachments' own names.
 */
export function visibleBody(message: {
  body: string | null;
  attachments?: readonly Pick<ChatAttachment, 'fileName'>[] | undefined;
}): string | null {
  const text = (message.body ?? '').trim();
  if (text === '') return null;
  const files = message.attachments ?? [];
  if (files.length > 0 && text === files.map((file) => file.fileName).join(', ')) return null;
  return message.body;
}

/**
 * The same rule for a place that only knows a message has an attachment (a reply quote, a list
 * preview): the body is hidden when every comma-separated part is a file name.
 */
export function visibleSnippet(body: string | null, hasAttachment: boolean): string | null {
  const text = (body ?? '').trim();
  if (text === '') return null;
  if (hasAttachment && text.split(', ').every((part) => FILE_NAME.test(part.trim()))) return null;
  return text;
}

/** What a reply quote shows of the message it answers. */
export function quoteSnippet(reply: ChatReplySummary): string {
  if (reply.deleted) return 'Message unavailable';
  const text = visibleSnippet(reply.body, reply.hasAttachment);
  if (text !== null) return text.split('\n')[0] ?? '';
  return reply.hasAttachment ? 'Attachment' : 'Message';
}

/** A conversation-list preview with a synthetic file-name body replaced by a plain word. */
export function previewText(preview: string | null): string {
  if (preview === null || preview.trim() === '') return 'No messages yet';
  return visibleSnippet(preview, true) ?? 'Attachment';
}

// ---------------------------------------------------------------------------
// "Was this helpful?"
// ---------------------------------------------------------------------------

type FeedbackConversation = Pick<
  ChatConversationDetail['conversation'],
  'status' | 'resolvedAt' | 'lastCustomerMessageAt'
>;

/** A reply a person on the support team wrote: not the customer, not automation, not a platform line. */
function isRealSupportReply(message: ChatMessage): boolean {
  return (
    message.senderRole !== 'customer' && message.senderRole !== 'system' && message.kind === 'text'
  );
}

/**
 * The one message that may ask "Was this helpful?", or null.
 *
 * Only a finished conversation asks, and only about its last real support reply. A resolved
 * thread stops asking once the customer writes again (the thread is effectively reopened), and a
 * verdict the customer already gave hides the prompt for good. `messages` is in thread order.
 */
export function feedbackTargetId(
  conversation: FeedbackConversation | null,
  messages: readonly ChatMessage[],
  answered: ReadonlySet<string>,
): string | null {
  if (conversation === null) return null;
  if (conversation.status !== 'resolved' && conversation.status !== 'closed') return null;
  if (conversation.status === 'resolved') {
    const resolvedAt = Date.parse(conversation.resolvedAt ?? '');
    if (Number.isNaN(resolvedAt)) return null;
    const lastWrote = Date.parse(conversation.lastCustomerMessageAt ?? '');
    if (!Number.isNaN(lastWrote) && lastWrote > resolvedAt) return null;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message !== undefined && isRealSupportReply(message)) {
      return answered.has(message.id) ? null : message.id;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The long-press menu's position
// ---------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The smallest touch target (dp) for any reaction control. */
export const REACTION_TARGET = 44;

export interface ReactionBarGrid {
  columns: number;
  rows: number;
  /** Each button is exactly this square (dp). */
  item: number;
  width: number;
  height: number;
}

/**
 * How the reaction bar is laid out: as many 44 dp columns as fit across the usable width,
 * balanced over the fewest rows (eight reactions on a 360 dp phone are 4 x 2, not 7 + 1). On a
 * wide screen everything fits and the bar stays one row. `available` is the width between the
 * safe-area insets and margins.
 */
export function reactionBarGrid(input: {
  count: number;
  available: number;
  padding?: number;
  target?: number;
}): ReactionBarGrid {
  const target = input.target ?? REACTION_TARGET;
  const padding = input.padding ?? 4;
  const count = Math.max(1, input.count);
  const fitting = Math.max(1, Math.floor((input.available - padding * 2) / target));
  const rows = Math.ceil(count / fitting);
  const columns = Math.ceil(count / rows);
  return {
    columns,
    rows,
    item: target,
    width: columns * target + padding * 2,
    height: rows * target + padding * 2,
  };
}

export interface MenuLayoutInput {
  /** The pressed bubble, in window coordinates. */
  anchor: Rect;
  window: { width: number; height: number };
  insets: { top: number; bottom: number; left: number; right: number };
  /** True when the customer wrote the message, so the menu lines up with the right edge. */
  mine: boolean;
  bar: { width: number; height: number };
  list: { width: number; height: number };
  gap?: number;
  margin?: number;
}

export interface MenuLayout {
  bar: { x: number; y: number };
  /** `height` is the list's own height, shortened (it then scrolls) when the screen is too short. */
  list: { x: number; y: number; height: number };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/**
 * Places the reaction bar and the action list around the pressed bubble: the bar above it, the
 * list below, both lined up with the bubble's own edge and clamped inside the safe area. When
 * either would not fit that way, the two are placed as ONE stacked block (bar, gap, list) below
 * the bubble, else above it, else slid into the safe area - so they can never overlap each other.
 * When even the block is taller than the safe area, the list is shortened and scrolls. Nothing is
 * ever placed off-screen.
 */
export function computeMenuLayout(input: MenuLayoutInput): MenuLayout {
  const gap = input.gap ?? 8;
  const margin = input.margin ?? 12;
  const { anchor, window, insets, bar, list } = input;
  const top = insets.top + margin;
  const bottom = window.height - insets.bottom - margin;
  const left = insets.left + margin;
  const right = window.width - insets.right - margin;

  const alignedX = (width: number) =>
    clamp(input.mine ? anchor.x + anchor.width - width : anchor.x, left, right - width);

  const between = bar.height > 0 && list.height > 0 ? gap : 0;
  // The list gives way first: it is the part that can scroll.
  const listHeight = Math.min(list.height, Math.max(0, bottom - top - bar.height - between));
  const total = bar.height + between + listHeight;

  const barAbove = anchor.y - gap - bar.height;
  const listBelow = anchor.y + anchor.height + gap;
  const splitFits =
    (bar.height === 0 || barAbove >= top) &&
    (listHeight === 0 || (listBelow >= top && listBelow + listHeight <= bottom));

  let barY: number;
  let listY: number;
  if (splitFits) {
    barY = barAbove;
    listY = listBelow;
  } else {
    const below = anchor.y + anchor.height + gap;
    const above = anchor.y - gap - total;
    const fits = (y: number) => y >= top && y + total <= bottom;
    const blockY = fits(below) ? below : fits(above) ? above : clamp(below, top, bottom - total);
    barY = blockY;
    listY = blockY + bar.height + between;
  }

  return {
    bar: { x: alignedX(bar.width), y: barY },
    list: { x: alignedX(list.width), y: listY, height: listHeight },
  };
}
