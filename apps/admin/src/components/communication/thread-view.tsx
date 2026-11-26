'use client';

import {
  CHAT_CONVERSATION_STATUSES,
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_REACTIONS,
  CHAT_PRIORITIES,
  type ChatConversationDetail,
  type ChatConversationStatus,
  type ChatMessage,
  type ChatPinnedMessage,
  type ChatPriority,
  type ChatReactionSummaryItem,
  type ChatReplySummary,
  type ChatTeamMember,
} from '@nilzora/contracts';
import { ChatAttachmentList, ChatMessagesSkeleton, cn, pinnedPinLabel } from '@nilzora/ui';
import {
  ArrowDown,
  ArrowLeft,
  Bot,
  Check,
  CheckCheck,
  CircleAlert,
  FileText,
  Lock,
  LoaderCircle,
  MessagesSquare,
  Package,
  PanelRight,
  Pin,
  RefreshCw,
  CornerUpLeft,
  Send,
  StickyNote,
  SmilePlus,
  WifiOff,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Chip } from '@/components/admin-kit/chip';
import { chatAvatar, chatGhostButton, chatIconButton, chatPrimaryButton, chatSegment, chatSegmented, chatSelect, chatTimeline } from './chat-style';
import { chatMediaUrl } from '@/lib/chat-media';
import { ComposerMediaMenu, type PendingAttachment } from './composer-media';
import {
  clockTime,
  fullTime,
  initialsOf,
  PRIORITY_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  type OutgoingReply,
  type TimelineItem,
} from './inbox-model';
import type { Connection } from './use-chat-socket';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * The open conversation
 * ---------------------
 * Three parts, drawn by the Communication Center around one thread:
 *
 *   ThreadHeader   who the thread is with, the live state, and the queue controls the API
 *                  told us this account may use (status, priority, owner)
 *   ThreadTimeline the messages and the staff-only notes in the order they were written, with
 *                  older pages on demand and a way back to the newest message
 *   ReplyComposer  a reply or an internal note; replies appear at once and say whether they
 *                  reached the API, with a retry that can never post twice
 *
 * "Seen" is drawn only from the customer's own read position as the API stored it.
 */

const selectClass = chatSelect;

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export function ThreadHeader({
  detail,
  customerName,
  connection,
  typingName,
  team,
  currentUserId,
  currentUserName,
  busy,
  onStatus,
  onPriority,
  onAssign,
  onBack,
  onToggleDetails,
  detailsOpen,
}: {
  detail: ChatConversationDetail | null;
  customerName: string;
  connection: Connection;
  typingName: string | null;
  team: readonly ChatTeamMember[];
  currentUserId: string;
  currentUserName: string;
  busy: boolean;
  onStatus: (status: ChatConversationStatus) => void;
  onPriority: (priority: ChatPriority) => void;
  onAssign: (assigneeId: string | null) => void;
  onBack: () => void;
  onToggleDetails: () => void;
  detailsOpen: boolean;
}) {
  const tx = useTx();
  const conversation = detail?.conversation ?? null;
  const viewer = detail?.viewer ?? null;
  const staffKind = conversation !== null && conversation.kind !== 'moderation';
  // The assignable teammates: support staff for customer threads, moderators for moderation.
  const assignable = team.filter((member) =>
    staffKind ? member.canSupport : member.canModerate || member.canSupport,
  );
  const assigneeId = conversation?.assigneeId ?? null;
  const assigneeKnown =
    assigneeId === null ||
    assigneeId === currentUserId ||
    assignable.some((m) => m.userId === assigneeId);

  return (
    <header className="grid grid-cols-[minmax(0,1fr)] gap-2.5 border-b border-border/70 bg-surface/55 px-3 py-2.5 backdrop-blur-[2px] sm:px-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label={tx("Back to the conversation list")}
          className={cn(chatIconButton, 'lg:hidden')}
        >
          <ArrowLeft aria-hidden className="size-4" />
        </button>
        <span
          aria-hidden
          className={chatAvatar(conversation?.kind === 'moderation', 'size-9')}
        >
          {initialsOf(customerName)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex min-w-0 items-center gap-2">
            <span className="truncate font-display text-[0.95rem] font-semibold text-foreground">
              {customerName}
            </span>
            {conversation === null ? null : (
              <Chip tone={STATUS_TONE[conversation.status]} dot className="h-5 px-2 text-[10px]">
                {STATUS_LABEL[conversation.status]}
              </Chip>
            )}
          </h2>
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{conversation?.subject ?? 'Loading…'}</span>
            <span aria-hidden>·</span>
            <LiveState connection={connection} typingName={typingName} />
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleDetails}
          aria-pressed={detailsOpen}
          aria-label={detailsOpen ? 'Hide customer details' : 'Show customer details'}
          title={tx("Customer and order details")}
          className={cn(
            chatIconButton,
            'transition xl:hidden',
            detailsOpen && 'bg-info-soft text-info-ink hover:bg-info-soft hover:text-info-ink',
          )}
        >
          <PanelRight aria-hidden className="size-4" />
        </button>
      </div>

      {conversation === null || viewer === null ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex min-w-0 flex-1 basis-[calc(50%-0.5rem)] items-center gap-1.5 rounded-xl border border-border/70 bg-surface-muted/50 py-0.5 pr-0.5 pl-2 text-[11px] font-semibold text-muted-foreground sm:flex-none sm:basis-auto">
            <AutoText>Status</AutoText>
            <select
              value={conversation.status}
              disabled={busy || !viewer.canReply}
              onChange={(event) => onStatus(event.target.value as ChatConversationStatus)}
              className={cn(chatSelect, 'flex-1 border-transparent bg-surface sm:flex-none')}
            >
              {CHAT_CONVERSATION_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex min-w-0 flex-1 basis-[calc(50%-0.5rem)] items-center gap-1.5 rounded-xl border border-border/70 bg-surface-muted/50 py-0.5 pr-0.5 pl-2 text-[11px] font-semibold text-muted-foreground sm:flex-none sm:basis-auto">
            <AutoText>Priority</AutoText>
            <select
              value={conversation.priority}
              disabled={busy}
              onChange={(event) => onPriority(event.target.value as ChatPriority)}
              className={cn(chatSelect, 'flex-1 border-transparent bg-surface sm:flex-none')}
            >
              {[...CHAT_PRIORITIES].reverse().map((value) => (
                <option key={value} value={value}>
                  {PRIORITY_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
          {viewer.canAssign && conversation.kind !== 'internal_direct' ? (
            <label className="inline-flex min-w-0 flex-1 basis-[calc(50%-0.5rem)] items-center gap-1.5 rounded-xl border border-border/70 bg-surface-muted/50 py-0.5 pr-0.5 pl-2 text-[11px] font-semibold text-muted-foreground sm:flex-none sm:basis-auto">
              <AutoText>Owner</AutoText>
              <select
                value={assigneeId ?? ''}
                disabled={busy}
                onChange={(event) =>
                  onAssign(event.target.value === '' ? null : event.target.value)
                }
                className={cn(chatSelect, 'flex-1 max-w-48 border-transparent bg-surface sm:flex-none')}
              >
                <option value=""><AutoText>Unassigned</AutoText></option>
                <option value={currentUserId}>{currentUserName} (you)</option>
                {assignable
                  .filter((member) => member.userId !== currentUserId)
                  .map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.name ?? member.email ?? 'Teammate'} ·{' '}
                      {member.openCount + member.pendingCount} active
                    </option>
                  ))}
                {assigneeKnown ? null : <option value={assigneeId ?? ''}><AutoText>Current owner</AutoText></option>}
              </select>
            </label>
          ) : null}
          {conversation.status === 'open' || conversation.status === 'pending' ? (
            <button
              type="button"
              disabled={busy || !viewer.canReply}
              onClick={() => onStatus('resolved')}
              className={cn(chatPrimaryButton, 'ml-auto bg-success text-white hover:brightness-95')}
            >
              <Check aria-hidden className="size-3.5" /><AutoText>Resolve</AutoText></button>
          ) : (
            <button
              type="button"
              disabled={busy || !viewer.canReply}
              onClick={() => onStatus('open')}
              className={cn(chatGhostButton, 'ml-auto')}
            >
              <RefreshCw aria-hidden className="size-3.5" /><AutoText>Reopen</AutoText></button>
          )}
        </div>
      )}
    </header>
  );
}

function LiveState({
  connection,
  typingName,
}: {
  connection: Connection;
  typingName: string | null;
}) {
  const tx = useTx();
  if (connection === 'live') {
    return typingName === null ? (
      <span className="inline-flex shrink-0 items-center gap-1">
        <span aria-hidden className="size-1.5 rounded-full bg-success" /><AutoText>Live</AutoText></span>
    ) : (
      <span className="shrink-0 font-medium text-info-ink" aria-live="polite">
        {typingName} is typing…
      </span>
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1"
      title={tx("Messages still send; new ones appear when you reopen or refresh")}
    >
      <WifiOff aria-hidden className="size-3" />
      {connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

const NEAR_BOTTOM_PX = 96;

export function ThreadTimeline({
  conversationId,
  items,
  state,
  error,
  onRetryLoad,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  pins,
  reactions,
  seenMessageId,
  typingName,
  onPin,
  onReact,
  onRetryReply,
  onReplyMessage,
  onJumpToMessage,
}: {
  conversationId: string;
  items: readonly TimelineItem[];
  state: 'loading' | 'ready' | 'error';
  error: string | null;
  onRetryLoad: () => void;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  pins: readonly ChatPinnedMessage[];
  reactions: readonly ChatReactionSummaryItem[];
  seenMessageId: string | null;
  typingName: string | null;
  onPin: (message: ChatMessage, pinned: boolean) => void;
  onReact: (messageId: string, emoji: string) => void;
  onRetryReply: (reply: OutgoingReply) => void;
  /** Starts a reply that answers one particular message. */
  onReplyMessage: (message: ChatMessage) => void;
  onJumpToMessage: (messageId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const firstKeyRef = useRef<string | null>(null);
  const heightRef = useRef(0);
  const lastKeyRef = useRef<string | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [freshBelow, setFreshBelow] = useState(false);

  const scrollToBottom = useCallback((smooth: boolean) => {
    const element = scrollRef.current;
    if (element === null) return;
    element.scrollTo({ top: element.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // A different thread starts at its newest message.
  useLayoutEffect(() => {
    atBottomRef.current = true;
    firstKeyRef.current = null;
    lastKeyRef.current = null;
    const element = scrollRef.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [conversationId]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    const firstKey = items[0]?.key ?? null;
    const lastKey = items.at(-1)?.key ?? null;
    if (
      firstKeyRef.current !== null &&
      firstKey !== firstKeyRef.current &&
      lastKey === lastKeyRef.current
    ) {
      // An older page arrived above: keep the reader's place instead of jumping.
      element.scrollTop += element.scrollHeight - heightRef.current;
    } else if (lastKey !== lastKeyRef.current) {
      if (atBottomRef.current || lastKeyRef.current === null || lastKey?.startsWith('o:')) {
        element.scrollTop = element.scrollHeight;
      } else {
        // Something new arrived while the reader was further up; say so instead of moving.
        queueMicrotask(() => setFreshBelow(true));
      }
    }
    firstKeyRef.current = firstKey;
    lastKeyRef.current = lastKey;
    heightRef.current = element.scrollHeight;
  }, [items]);

  useEffect(() => {
    if (typingName !== null && atBottomRef.current) scrollToBottom(true);
  }, [scrollToBottom, typingName]);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (element === null) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    const near = distance < NEAR_BOTTOM_PX;
    atBottomRef.current = near;
    heightRef.current = element.scrollHeight;
    setShowJump(!near);
    if (near) setFreshBelow(false);
  }, []);

  const pinnedIds = new Set(pins.map((pin) => pin.id));

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {pins.length === 0 ? null : <PinnedStrip pins={pins} />}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={chatTimeline}
        aria-live="off"
      >
        {state === 'error' ? (
          <div className="grid h-full place-items-center">
            <div className="grid justify-items-center gap-3 text-center">
              <CircleAlert aria-hidden className="size-5 text-danger-ink" />
              <p className="text-sm text-foreground">
                {error ?? 'This conversation could not be opened.'}
              </p>
              <button
                type="button"
                onClick={onRetryLoad}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-surface-muted"
              >
                <RefreshCw aria-hidden className="size-3.5" /><AutoText>Try again</AutoText></button>
            </div>
          </div>
        ) : state === 'loading' ? (
          <ChatMessagesSkeleton />
        ) : items.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            <p className="text-sm text-muted-foreground"><AutoText>No messages yet.</AutoText></p>
          </div>
        ) : (
          <>
            {hasOlder ? (
              <div className="mb-4 flex justify-center">
                <button
                  type="button"
                  onClick={onLoadOlder}
                  disabled={loadingOlder}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-xs font-medium text-foreground hover:bg-surface-muted disabled:opacity-60"
                >
                  {loadingOlder ? (
                    <LoaderCircle aria-hidden className="size-3.5 motion-safe:animate-spin" />
                  ) : null}
                  {loadingOlder ? 'Loading…' : 'Load earlier messages'}
                </button>
              </div>
            ) : (
              <p className="mb-4 text-center text-[11px] text-muted-foreground"><AutoText>This is the start of the conversation.</AutoText></p>
            )}
            <ol className="grid grid-cols-[minmax(0,1fr)]">
              {items.map((item) => (
                <TimelineRow
                  key={item.key}
                  item={item}
                  pinned={item.type === 'message' && pinnedIds.has(item.message.id)}
                  reactions={reactions}
                  seen={item.type === 'message' && item.message.id === seenMessageId}
                  onPin={onPin}
                  onReact={onReact}
                  onRetryReply={onRetryReply}
                  onReply={onReplyMessage}
                  onJump={onJumpToMessage}
                />
              ))}
            </ol>
            {typingName === null ? null : (
              <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <span aria-hidden className="flex gap-0.5">
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.2s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.1s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
                </span>
                {typingName} is typing…
              </p>
            )}
          </>
        )}
      </div>
      {showJump || freshBelow ? (
        <button
          type="button"
          onClick={() => {
            scrollToBottom(true);
            setFreshBelow(false);
          }}
          className={cn(
            'absolute bottom-3 left-1/2 inline-flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full px-3 text-xs font-semibold shadow-lg ring-1 transition',
            freshBelow
              ? 'bg-primary-action text-primary-action-foreground ring-transparent'
              : 'bg-surface text-foreground ring-border',
          )}
        >
          <ArrowDown aria-hidden className="size-3.5" />
          {freshBelow ? 'New messages' : 'Latest'}
        </button>
      ) : null}
    </div>
  );
}

function PinnedStrip({ pins }: { pins: readonly ChatPinnedMessage[] }) {
  const [open, setOpen] = useState(false);
  const first = pins[0];
  if (first === undefined) return null;
  return (
    <div className="border-b border-warning-line bg-warning-soft/70 px-3 py-1.5 text-xs text-warning-ink sm:px-5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-md text-left transition-colors hover:text-warning-ink"
      >
        <Pin aria-hidden className="size-3.5 shrink-0" />
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <AutoText>Pinned</AutoText>
          <span className="rounded-full bg-warning/15 px-1.5 py-px text-[10px] font-bold tabular-nums">
            {pins.length}
          </span>
        </span>
        <span className="min-w-0 flex-1 truncate"><AutoText value={pinnedPinLabel(first)} /></span>
        {pins.length > 1 ? (
          <span className="shrink-0 rounded-full bg-warning/15 px-1.5 py-px text-[10px] font-semibold">
            +{pins.length - 1}
          </span>
        ) : null}
      </button>
      {open ? (
        <ul className="mt-1.5 grid gap-1 border-t border-warning-line/60 pt-1.5 pl-5.5">
          {pins.map((pin) => (
            <li key={pin.id} className="truncate">
              {pinnedPinLabel(pin)}
              <span className="text-warning-ink/70"> · {pin.senderName ?? 'Someone'}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TimelineRow({
  item,
  pinned,
  reactions,
  seen,
  onPin,
  onReact,
  onRetryReply,
  onReply,
  onJump,
}: {
  item: TimelineItem;
  pinned: boolean;
  reactions: readonly ChatReactionSummaryItem[];
  seen: boolean;
  onPin: (message: ChatMessage, pinned: boolean) => void;
  onReact: (messageId: string, emoji: string) => void;
  onRetryReply: (reply: OutgoingReply) => void;
  onReply: (message: ChatMessage) => void;
  onJump: (messageId: string) => void;
}) {
  const tx = useTx();
  // The reaction menu is open per row, so it lives with the row and closes on the next react.
  const [reactionsOpen, setReactionsOpen] = useState(false);
  if (item.type === 'day') {
    return (
      <li className="my-5 flex items-center gap-3 first:mt-0" aria-label={item.label}>
        <span aria-hidden className="h-px flex-1 bg-linear-to-r from-transparent to-border" />
        <span className="rounded-full border border-border/70 bg-surface/90 px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-muted-foreground uppercase shadow-[0_1px_2px_rgb(15_23_42/0.03)]">
          {item.label}
        </span>
        <span aria-hidden className="h-px flex-1 bg-linear-to-l from-transparent to-border" />
      </li>
    );
  }
  if (item.type === 'note') {
    return (
      <li className="mt-3 flex justify-end">
        <div className="w-full max-w-[min(36rem,88%)] rounded-xl rounded-br-md border border-dashed border-teal-line bg-teal-soft/60 px-3 py-2 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-teal-ink">
            <StickyNote aria-hidden className="size-3.5" />
            Internal note · {item.note.authorName ?? 'Staff'}
            <span className="font-normal opacity-80">· {clockTime(item.note.createdAt)}</span>
            <Lock aria-label={tx("Not visible to the customer")} className="ml-auto size-3" />
          </p>
          <p className="mt-1 text-sm wrap-break-word whitespace-pre-wrap text-foreground">
            {item.note.body}
          </p>
        </div>
      </li>
    );
  }
  if (item.type === 'outgoing') {
    const reply = item.reply;
    const failed = reply.state === 'failed';
    return (
      <li className="mt-3 flex flex-col items-end gap-1">
        <div
          className={cn(
            'max-w-[min(36rem,85%)] rounded-2xl rounded-br-md bg-primary-action px-3 py-2 text-sm text-primary-action-foreground shadow-[0_1px_2px_rgb(2_132_199/0.3)]',
            failed ? 'opacity-90 ring-2 ring-danger/60' : 'opacity-90',
          )}
        >
          {reply.reply === null ? null : <QuotedMessage reply={reply.reply} onJump={onJump} />}
          {reply.attachmentName === null ? null : (
            <span className="mb-1 flex items-center gap-2 rounded-lg bg-primary-action-foreground/15 px-2 py-1.5 text-xs">
              <FileText aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate"><AutoText value={reply.attachmentName} /></span>
            </span>
          )}
          {reply.body === '' ? null : (
            <p className="wrap-break-word whitespace-pre-wrap"><AutoText value={reply.body} /></p>
          )}
        </div>
        {failed ? (
          <span className="flex items-center gap-2 text-[11px]">
            <span className="text-danger-ink">{reply.error ?? 'Not sent.'}</span>
            <button
              type="button"
              onClick={() => onRetryReply(reply)}
              className="rounded-full border border-border bg-surface px-2 py-0.5 font-semibold text-foreground transition-colors hover:bg-surface-muted"
            ><AutoText>Retry</AutoText></button>
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <LoaderCircle aria-hidden className="size-3 motion-safe:animate-spin" /><AutoText>Sending…</AutoText></span>
        )}
      </li>
    );
  }

  const message = item.message;
  if (message.kind === 'system' || message.kind === 'order_event') {
    return (
      <li className="my-3 flex justify-center">
        <span
          title={fullTime(message.createdAt)}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-surface-muted/80 px-3 py-1 text-center text-[11px] text-muted-foreground"
        >
          {message.kind === 'order_event' ? <Package aria-hidden className="size-3" /> : null}
          {message.body}
          <span aria-hidden className="opacity-60">·</span>
          <time dateTime={message.createdAt}>{clockTime(message.createdAt)}</time>
        </span>
      </li>
    );
  }

  const fromCustomer = message.senderRole === 'customer';
  const automated = message.kind === 'automated';
  const author =
    message.senderName ?? (automated ? 'Nilzora Assistant' : fromCustomer ? 'Customer' : 'Team');
  const thumbs = reactions.find((entry) => entry.messageId === message.id && entry.emoji === '👍');

  return (
    <li
      id={`chat-message-${message.id}`}
      className={cn(
        'group flex gap-2 scroll-mt-4 rounded-xl transition-colors data-[highlight=true]:bg-warning/15',
        item.grouped ? 'mt-1' : 'mt-3',
        fromCustomer ? 'justify-start' : 'justify-end',
      )}
    >
      {fromCustomer ? (
        <span
          aria-hidden
          className={cn(
            chatAvatar(false, 'size-7'),
            'mt-auto text-[10px] shadow-[inset_0_1px_0_rgb(255_255_255/0.5)]',
            item.grouped && 'invisible',
          )}
        >
          {initialsOf(author)}
        </span>
      ) : null}
      <div
        className={cn(
          'flex max-w-[min(36rem,85%)] flex-col',
          fromCustomer ? 'items-start' : 'items-end',
        )}
      >
        {item.grouped ? null : (
          <p className="mb-1 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
            {automated ? <Bot aria-hidden className="size-3" /> : null}
            <span className="font-semibold text-body"><AutoText value={author} /></span>
            {automated ? <span><AutoText>· Automatic reply</AutoText></span> : null}
          </p>
        )}
        <div
          className={cn(
            'grid gap-2 rounded-2xl px-3.5 py-2 text-sm shadow-[0_1px_2px_rgb(15_23_42/0.05)]',
            fromCustomer
              ? 'rounded-bl-md border border-border/80 bg-surface text-foreground'
              : automated
                ? 'rounded-br-md border border-dashed border-info-line bg-info-soft/60 text-foreground'
                : 'rounded-br-md bg-primary-action text-primary-action-foreground shadow-[0_1px_2px_rgb(2_132_199/0.3)]',
            pinned && 'ring-2 ring-warning/70 ring-offset-1 ring-offset-surface',
          )}
        >
          {(message.replyTo ?? null) === null ? null : (
            <QuotedMessage reply={message.replyTo ?? quoteOf(message)} />
          )}
          {(message.attachments ?? []).length === 0 ? null : (
            <ChatAttachmentList
              attachments={message.attachments ?? []}
              tone={fromCustomer || automated ? 'incoming' : 'outgoing'}
              resolveMediaUrl={chatMediaUrl}
            />
          )}
          {message.body === null || message.body === '' ? null : (
            <p className="wrap-break-word whitespace-pre-wrap"><AutoText value={message.body} /></p>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
          <time dateTime={message.createdAt} title={fullTime(message.createdAt)}>
            {clockTime(message.createdAt)}
          </time>
          {message.editedAt === null ? null : <span><AutoText>· edited</AutoText></span>}
          {seen ? (
            <span className="inline-flex items-center gap-0.5 text-info-ink">
              · <CheckCheck aria-hidden className="size-3" /> Seen
            </span>
          ) : null}
          {thumbs !== undefined && thumbs.count > 0 ? (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-surface-muted px-1.5 py-px text-foreground">
              👍 {thumbs.count}
            </span>
          ) : null}
          <span className="flex items-center gap-0.5 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            <IconAction label={`Answer ${author}`} onClick={() => onReply(message)} active={false}>
              <CornerUpLeft aria-hidden className="size-3" />
            </IconAction>
            {/* The same eight reactions the customer's own clients offer, from one shared list. */}
            <span className="relative">
              <IconAction
                label={tx("React to this message")}
                onClick={() => setReactionsOpen((value) => !value)}
                active={reactionsOpen}
              >
                <SmilePlus aria-hidden className="size-3" />
              </IconAction>
              {reactionsOpen ? (
                <span
                  role="menu"
                  aria-label={tx("Choose a reaction")}
                  className="nz-panel absolute right-0 bottom-full z-20 mb-1.5 flex w-56 flex-wrap gap-0.5 rounded-xl border border-border p-1.5 shadow-lg"
                >
                  {CHAT_REACTIONS.map((reaction) => {
                    const tallied = reactions.find(
                      (entry) => entry.messageId === message.id && entry.emoji === reaction.emoji,
                    );
                    return (
                      <button
                        key={reaction.emoji}
                        type="button"
                        role="menuitemradio"
                        aria-checked={tallied?.mine === true}
                        aria-label={reaction.label}
                        title={reaction.label}
                        onClick={() => {
                          setReactionsOpen(false);
                          onReact(message.id, reaction.emoji);
                        }}
                        className={cn(
                          'grid size-7 place-items-center rounded-lg text-sm leading-none transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                          tallied?.mine === true && 'bg-info-soft ring-1 ring-info-line',
                        )}
                      >
                        {reaction.emoji}
                      </button>
                    );
                  })}
                </span>
              ) : null}
            </span>
            <IconAction
              label={pinned ? 'Unpin this message' : 'Pin this message'}
              onClick={() => onPin(message, pinned)}
              active={pinned}
            >
              <Pin aria-hidden className="size-3" />
            </IconAction>
          </span>
        </div>
      </div>
    </li>
  );
}

function IconAction({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'grid size-6 place-items-center rounded-md transition hover:bg-surface-muted hover:text-foreground',
        active ? 'text-info-ink' : 'text-muted-foreground',
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

export interface QuickText {
  id: string;
  label: string;
  group: 'saved' | 'template';
}

export type ComposerMode = 'reply' | 'note';

// ---------------------------------------------------------------------------
// Quoting a message
// ---------------------------------------------------------------------------

/** Who wrote the message being answered, in the words an operator uses for them. */
function replyLabel(reply: ChatReplySummary): string {
  if (reply.senderName !== null && reply.senderName !== '') return reply.senderName;
  if (reply.senderRole === 'customer') return 'the customer';
  if (reply.kind === 'automated') return 'the assistant';
  return 'a teammate';
}

/** One line of the quoted message: its text, or what kind of file it carried. */
function replySummary(reply: ChatReplySummary): string {
  if (reply.deleted) return 'Message unavailable';
  const text = (reply.body ?? '').trim();
  if (text !== '') return text.split('\n')[0] ?? '';
  return reply.hasAttachment ? 'Attachment' : 'Message';
}

/**
 * The quoted message shown above a reply.
 *
 * It is one short block, never a copy: who wrote it, then the first line or the kind of file.
 * Pressing it walks the operator to the original when that message is on screen, which is why
 * every row carries an anchor id. A message that has since been deleted says so instead of
 * disappearing, because a reply with no visible question reads like a mistake.
 */
function QuotedMessage({
  reply,
  onJump,
}: {
  reply: ChatReplySummary;
  onJump?: ((messageId: string) => void) | undefined;
}) {
  const content = (
    <>
      <span className="block font-semibold"><AutoText value={replyLabel(reply)} /></span>
      <span className="block truncate"><AutoText value={replySummary(reply)} /></span>
    </>
  );
  const className =
    'mb-1.5 w-full rounded-lg border-l-2 border-ring/60 bg-surface px-2 py-1 text-left text-[11px] text-muted-foreground';
  if (onJump === undefined || reply.deleted) {
    return <div className={className}><AutoText value={content} /></div>;
  }
  return (
    <button
      type="button"
      onClick={() => onJump(reply.id)}
      aria-label={`Go to the message from ${replyLabel(reply)}: ${replySummary(reply)}`}
      className={`${className} transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
    >
      {content}
    </button>
  );
}

/** The leaf a reply quotes when the message being answered is already on screen. */
function quoteOf(message: ChatMessage): ChatReplySummary {
  return {
    id: message.id,
    seq: message.seq,
    senderId: message.senderId,
    senderRole: message.senderRole,
    senderName: message.senderName,
    kind: message.kind,
    body: message.body,
    hasAttachment: (message.attachments ?? []).length > 0,
    deleted: false,
  };
}

export function ReplyComposer({
  conversationId,
  detail,
  mode,
  onMode,
  draft,
  onDraft,
  attachment,
  onAttachment,
  onAttachmentPending,
  attachmentPending,
  noteBusy,
  error,
  quickTexts,
  onQuickText,
  onSubmit,
  onTyping,
  onReopen,
  reply,
  onCancelReply,
}: {
  conversationId: string;
  detail: ChatConversationDetail | null;
  mode: ComposerMode;
  onMode: (mode: ComposerMode) => void;
  draft: string;
  onDraft: (value: string) => void;
  attachment: PendingAttachment | null;
  onAttachment: (attachment: PendingAttachment | null) => void;
  onAttachmentPending: (pending: boolean) => void;
  attachmentPending: boolean;
  noteBusy: boolean;
  error: string | null;
  quickTexts: readonly QuickText[];
  onQuickText: (choice: QuickText) => void;
  onSubmit: () => void;
  onTyping: () => void;
  onReopen: () => void;
  /** The message the next reply answers, or null for a plain one. */
  reply: ChatReplySummary | null;
  onCancelReply: () => void;
}) {
  const tx = useTx();
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const viewer = detail?.viewer ?? null;
  const status = detail?.conversation.status ?? null;
  const canNote = viewer?.canUseInternalNotes ?? false;
  const canReply = viewer?.canReply ?? false;

  // The box grows with what is written, up to six lines, then scrolls.
  useLayoutEffect(() => {
    const element = textRef.current;
    if (element === null) return;
    element.style.height = 'auto';
    element.style.height = `${String(Math.min(element.scrollHeight, 168))}px`;
  }, [draft]);

  if (detail === null) return null;

  if (mode === 'reply' && status === 'closed') {
    return (
      <div className="flex flex-wrap items-center gap-3 border-t border-border bg-surface-muted/60 px-4 py-3">
        <Lock aria-hidden className="size-4 text-muted-foreground" />
        <p className="min-w-0 flex-1 text-xs text-muted-foreground"><AutoText>This conversation is closed. Reopen it to reply, or leave an internal note.</AutoText></p>
        {canNote ? (
          <button
            type="button"
            onClick={() => onMode('note')}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground hover:bg-surface"
          >
            <StickyNote aria-hidden className="size-3.5" /><AutoText>Add a note</AutoText></button>
        ) : null}
        {canReply ? (
          <button
            type="button"
            onClick={onReopen}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary-action px-3 text-xs font-semibold text-primary-action-foreground hover:bg-primary-action-hover"
          >
            <RefreshCw aria-hidden className="size-3.5" /><AutoText>Reopen</AutoText></button>
        ) : null}
      </div>
    );
  }

  if (mode === 'reply' && !canReply) {
    return (
      <p className="border-t border-border bg-surface-muted/60 px-4 py-3 text-xs text-muted-foreground"><AutoText>You can read this conversation, but replying needs it assigned to you or left unassigned.</AutoText></p>
    );
  }

  const note = mode === 'note';
  const empty = draft.trim() === '' && (note || attachment === null);
  const remaining = CHAT_MESSAGE_MAX_LENGTH - draft.length;

  return (
    <form
      className={cn(
        'border-t px-3 pt-2.5 pb-3 transition-colors sm:px-4',
        note
          ? 'border-teal-line/70 bg-linear-to-b from-teal-soft/45 to-teal-soft/15'
          : 'border-border/70 bg-surface/60',
      )}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div role="group" aria-label={tx("Write")} className={chatSegmented}>
          <button
            type="button"
            aria-pressed={!note}
            onClick={() => onMode('reply')}
            className={chatSegment(!note)}
          >
            <MessagesSquare aria-hidden className="size-3.5" /><AutoText>Reply</AutoText></button>
          {canNote ? (
            <button
              type="button"
              aria-pressed={note}
              onClick={() => onMode('note')}
              className={chatSegment(note, 'moderator')}
            >
              <StickyNote aria-hidden className="size-3.5" /><AutoText>Internal note</AutoText></button>
          ) : null}
        </div>
        {note || quickTexts.length === 0 ? null : (
          <>
            <label htmlFor={`quick-${conversationId}`} className="sr-only"><AutoText>Insert a saved reply or template</AutoText></label>
            <select
              id={`quick-${conversationId}`}
              value=""
              onChange={(event) => {
                const chosen = quickTexts.find((entry) => entry.id === event.target.value);
                if (chosen !== undefined) onQuickText(chosen);
                textRef.current?.focus();
              }}
              className={cn(selectClass, 'max-w-52')}
            >
              <option value=""><AutoText>Insert text…</AutoText></option>
              {quickTexts.some((entry) => entry.group === 'saved') ? (
                <optgroup label={tx("Saved replies")}>
                  {quickTexts
                    .filter((entry) => entry.group === 'saved')
                    .map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                </optgroup>
              ) : null}
              {quickTexts.some((entry) => entry.group === 'template') ? (
                <optgroup label={tx("Approved templates")}>
                  {quickTexts
                    .filter((entry) => entry.group === 'template')
                    .map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                </optgroup>
              ) : null}
            </select>
          </>
        )}
        {note ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-ink">
            <Lock aria-hidden className="size-3" /><AutoText>Only your team sees notes</AutoText></span>
        ) : null}
      </div>

      {error === null ? null : (
        <p role="alert" className="mb-2 flex items-center gap-1.5 text-xs text-danger-ink">
          <CircleAlert aria-hidden className="size-3.5" />
          {error}
        </p>
      )}

      {note || reply === null ? null : (
        <div className="mb-2 flex items-start gap-2 rounded-lg border-l-2 border-ring bg-surface-muted px-2 py-1.5">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-foreground">
              Answering {replyLabel(reply)}
            </p>
            <p className="truncate text-[11px] text-muted-foreground"><AutoText value={replySummary(reply)} /></p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label={tx("Stop answering this message")}
            className="rounded p-0.5 text-muted-foreground transition hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </div>
      )}

      <div
        className={cn(
          'flex items-end gap-1.5 rounded-2xl border bg-surface p-1.5 shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition-shadow focus-within:ring-2',
          note
            ? 'border-teal-line focus-within:ring-teal-line/50'
            : 'border-input-border/80 focus-within:border-ring focus-within:ring-ring/25',
        )}
      >
        {note ? null : (
          <ComposerMediaMenu
            key={conversationId}
            conversationId={conversationId}
            attachment={attachment}
            onAttached={(value) => onAttachment(value)}
            onCleared={() => onAttachment(null)}
            onPendingChange={onAttachmentPending}
            disabled={false}
          />
        )}
        <label htmlFor={`composer-${conversationId}`} className="sr-only">
          {note ? 'Internal note' : 'Reply to the customer'}
        </label>
        <textarea
          ref={textRef}
          id={`composer-${conversationId}`}
          value={draft}
          onChange={(event) => {
            onDraft(event.target.value);
            if (!note) onTyping();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSubmit();
            }
          }}
          rows={1}
          maxLength={CHAT_MESSAGE_MAX_LENGTH}
          placeholder={note ? 'Write a note for the team…' : 'Write a reply…'}
          className="max-h-42 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={empty || (!note && attachmentPending) || noteBusy}
          title={!note && attachmentPending ? 'Upload the attachment first' : undefined}
          aria-label={note ? 'Save note' : 'Send reply'}
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-xl transition disabled:cursor-not-allowed disabled:opacity-40',
            note
              ? 'bg-moderator text-white shadow-[0_1px_2px_rgb(20_184_166/0.4)] hover:brightness-95'
              : 'bg-primary-action text-primary-action-foreground shadow-[0_1px_2px_rgb(2_132_199/0.4)] hover:bg-primary-action-hover',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          )}
        >
          {noteBusy ? (
            <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" />
          ) : (
            <Send aria-hidden className="size-4" />
          )}
        </button>
      </div>
      <p className="mt-1.5 flex justify-between gap-2 px-1 text-[10px] text-muted-foreground">
        <span className="hidden sm:inline"><AutoText>Enter to send · Shift + Enter for a new line</AutoText></span>
        {remaining < 400 ? <span className="tabular-nums">{remaining} left</span> : null}
      </p>
    </form>
  );
}
