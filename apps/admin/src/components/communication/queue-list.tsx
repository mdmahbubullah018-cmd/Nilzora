'use client';

import {
  CHAT_CONVERSATION_STATUSES,
  CHAT_PRIORITIES,
  CHAT_QUEUE_SORTS,
  type ChatConversationStatus,
  type ChatConversationSummary,
  type ChatPriority,
  type ChatQueueSort,
  type ChatSearchHit,
} from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import {
  CircleAlert,
  Inbox,
  LoaderCircle,
  MessageSquareText,
  Package,
  RefreshCw,
  Search,
  ShoppingBag,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Chip } from '@/components/admin-kit/chip';
import { apiGet } from './client';
import {
  chatAvatar,
  chatColumn,
  chatField,
  chatSegment,
  chatSegmented,
  chatSelect,
} from './chat-style';
import {
  awaitingReply,
  customerLabel,
  initialsOf,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  relativeTime,
  SCOPES,
  SORT_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  type InboxScope,
} from './inbox-model';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * The queue column
 * ----------------
 * The list of conversations the API decided this account may work, with the filters that
 * narrow it. Every filter is a request to the API (never a filter over the loaded page), so
 * the count and the next page always agree with what is on screen.
 *
 * "Search messages" looks inside what was said rather than at the thread's name, customer or
 * order number; a hit opens the thread it came from.
 */

export interface QueueFilters {
  scope: InboxScope;
  status: ChatConversationStatus | '';
  priority: ChatPriority | '';
  sort: ChatQueueSort;
  search: string;
}

const selectClass = chatSelect;

export function QueueList({
  conversations,
  total,
  state,
  error,
  activeId,
  currentUserId,
  filters,
  onFilters,
  onSelect,
  onRetry,
  hasMore,
  loadingMore,
  onLoadMore,
  className,
}: {
  conversations: readonly ChatConversationSummary[];
  total: number;
  state: 'loading' | 'ready' | 'error';
  error: string | null;
  activeId: string | null;
  currentUserId: string;
  filters: QueueFilters;
  onFilters: (next: Partial<QueueFilters>) => void;
  onSelect: (conversationId: string) => void;
  onRetry: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  className?: string;
}) {
  const tx = useTx();
  const [mode, setMode] = useState<'threads' | 'messages'>('threads');
  const [text, setText] = useState(filters.search);
  const [hits, setHits] = useState<ChatSearchHit[] | null>(null);
  const [hitsState, setHitsState] = useState<'idle' | 'loading' | 'error'>('idle');

  // Typing settles for a moment before the queue is asked again, so each key is not a request.
  useEffect(() => {
    if (mode !== 'threads') return;
    const value = text.trim();
    if (value === filters.search) return;
    const timer = setTimeout(() => onFilters({ search: value }), 300);
    return () => clearTimeout(timer);
  }, [filters.search, mode, onFilters, text]);

  useEffect(() => {
    if (mode !== 'messages') return;
    const value = text.trim();
    let cancelled = false;
    const timer = setTimeout(() => {
      if (value.length < 2) {
        setHits(null);
        setHitsState('idle');
        return;
      }
      setHitsState('loading');
      void apiGet<{ hits: ChatSearchHit[] }>(`?op=search&q=${encodeURIComponent(value)}`).then(
        (result) => {
          if (cancelled) return;
          setHits(result.ok ? result.value.hits : []);
          setHitsState(result.ok ? 'idle' : 'error');
        },
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, text]);

  const filtered =
    filters.status !== '' ||
    filters.priority !== '' ||
    filters.search !== '' ||
    filters.scope !== 'all';

  return (
    <section aria-label={tx('Conversations')} className={cn(chatColumn, className)}>
      <div className="grid gap-3 border-b border-border/70 bg-surface/55 p-3 backdrop-blur-[2px]">
        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">
              {mode === 'threads' ? 'Search conversations' : 'Search message text'}
            </span>
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              type="search"
              placeholder={
                mode === 'threads' ? 'Name, email, order or subject' : 'Words from a message'
              }
              className={cn(chatField, 'pr-8 pl-9')}
            />
            {text === '' ? null : (
              <button
                type="button"
                aria-label={tx('Clear the search')}
                onClick={() => setText('')}
                className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            )}
          </label>
          <button
            type="button"
            aria-pressed={mode === 'messages'}
            onClick={() => {
              setMode((value) => (value === 'threads' ? 'messages' : 'threads'));
              setHits(null);
            }}
            title={tx('Search inside what was said')}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition',
              mode === 'messages'
                ? 'border-info-line bg-info-soft text-info-ink'
                : 'border-border text-muted-foreground hover:bg-surface-muted hover:text-foreground',
            )}
          >
            <MessageSquareText aria-hidden className="size-3.5" />
            <span className="hidden sm:inline">
              <AutoText>Messages</AutoText>
            </span>
          </button>
        </div>

        {mode === 'threads' ? (
          <>
            <div
              role="group"
              aria-label={tx('Which conversations')}
              className={cn(chatSegmented, 'grid grid-cols-3')}
            >
              {SCOPES.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={filters.scope === option.key}
                  onClick={() => onFilters({ scope: option.key })}
                  className={cn(chatSegment(filters.scope === option.key), 'justify-center px-1')}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <select
                aria-label={tx('Status')}
                value={filters.status}
                onChange={(event) =>
                  onFilters({ status: event.target.value as ChatConversationStatus | '' })
                }
                className={selectClass}
              >
                <option value="">
                  <AutoText>Any status</AutoText>
                </option>
                {CHAT_CONVERSATION_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {STATUS_LABEL[value]}
                  </option>
                ))}
              </select>
              <select
                aria-label={tx('Priority')}
                value={filters.priority}
                onChange={(event) =>
                  onFilters({ priority: event.target.value as ChatPriority | '' })
                }
                className={selectClass}
              >
                <option value="">
                  <AutoText>Any priority</AutoText>
                </option>
                {[...CHAT_PRIORITIES].reverse().map((value) => (
                  <option key={value} value={value}>
                    {PRIORITY_LABEL[value]}
                  </option>
                ))}
              </select>
              <select
                aria-label={tx('Sort')}
                value={filters.sort}
                onChange={(event) => onFilters({ sort: event.target.value as ChatQueueSort })}
                className={cn(selectClass, 'col-span-2')}
              >
                {CHAT_QUEUE_SORTS.map((value) => (
                  <option key={value} value={value}>
                    {SORT_LABEL[value]}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Finds words in messages across every thread you can open. Choose a result to open its
            conversation.
          </p>
        )}
      </div>

      <div className="nz-scroll min-h-0 flex-1 overflow-y-auto">
        {mode === 'messages' ? (
          <MessageHits
            hits={hits}
            state={hitsState}
            query={text.trim()}
            onOpen={(conversationId) => onSelect(conversationId)}
          />
        ) : state === 'error' ? (
          <div className="grid justify-items-center gap-3 p-6 text-center">
            <CircleAlert aria-hidden className="size-5 text-danger-ink" />
            <p className="text-sm text-foreground">{error ?? 'The queue could not be loaded.'}</p>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-surface-muted"
            >
              <RefreshCw aria-hidden className="size-3.5" />
              <AutoText>Try again</AutoText>
            </button>
          </div>
        ) : state === 'loading' && conversations.length === 0 ? (
          <ul
            aria-label={tx('Loading conversations')}
            className="grid grid-cols-[minmax(0,1fr)] gap-0"
          >
            {[0, 1, 2, 3, 4].map((row) => (
              <li key={row} className="flex gap-3 border-b border-border/60 px-3 py-3.5">
                <span className="nz-shimmer size-9 shrink-0 rounded-full bg-surface-muted ring-1 ring-border/40" />
                <span className="grid flex-1 gap-2">
                  <span className="nz-shimmer h-3 w-2/3 rounded bg-surface-muted" />
                  <span className="nz-shimmer h-3 w-full rounded bg-surface-muted/80" />
                </span>
              </li>
            ))}
          </ul>
        ) : conversations.length === 0 ? (
          <div className="grid justify-items-center gap-2.5 px-6 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-linear-to-b from-info-soft to-surface text-info-ink ring-1 ring-info-line">
              <Inbox aria-hidden className="size-5" />
            </span>
            <p className="font-display text-sm font-semibold text-foreground">
              {filtered ? 'Nothing matches this view' : 'The queue is clear'}
            </p>
            <p className="max-w-[32ch] text-xs leading-relaxed text-muted-foreground">
              {filtered
                ? 'Try another status, priority or search, or switch to All.'
                : 'New customer conversations appear here as soon as they arrive.'}
            </p>
            {filtered ? (
              <button
                type="button"
                onClick={() => {
                  setText('');
                  onFilters({ scope: 'all', status: '', priority: '', search: '' });
                }}
                className="mt-1 inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-semibold text-foreground transition-colors hover:bg-surface-muted"
              >
                <AutoText>Clear filters</AutoText>
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <p className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              {total} conversation{total === 1 ? '' : 's'}
              {state === 'loading' ? (
                <LoaderCircle
                  aria-label={tx('Refreshing')}
                  className="size-3 motion-safe:animate-spin"
                />
              ) : null}
            </p>
            <ul className="grid grid-cols-[minmax(0,1fr)]">
              {conversations.map((item) => (
                <li key={item.id}>
                  <QueueRow
                    item={item}
                    active={item.id === activeId}
                    mine={item.assigneeId === currentUserId}
                    onSelect={() => onSelect(item.id)}
                  />
                </li>
              ))}
            </ul>
            {hasMore ? (
              <div className="p-3">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={onLoadMore}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-surface-muted disabled:opacity-60"
                >
                  {loadingMore ? (
                    <LoaderCircle aria-hidden className="size-3.5 motion-safe:animate-spin" />
                  ) : null}
                  {loadingMore ? 'Loading…' : 'Load more conversations'}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function QueueRow({
  item,
  active,
  mine,
  onSelect,
}: {
  item: ChatConversationSummary;
  active: boolean;
  mine: boolean;
  onSelect: () => void;
}) {
  const name = customerLabel(item);
  const unread = item.unreadCount > 0;
  const waiting = awaitingReply(item);
  const KindIcon = item.orderNumber ? Package : item.productName ? ShoppingBag : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'group/row relative flex w-full gap-3 border-b border-border/60 px-3 py-3 text-left transition-colors duration-150',
        'focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        active ? 'bg-info-soft/60' : 'hover:bg-surface-muted/60',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-2 left-0 w-0.75 rounded-full bg-primary transition-opacity',
          active ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-30',
        )}
      />
      <span
        aria-hidden
        className={cn(
          chatAvatar(item.kind === 'moderation'),
          'shadow-[inset_0_1px_0_rgb(255_255_255/0.6)]',
        )}
      >
        {initialsOf(name)}
      </span>
      <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-0.5">
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-sm',
              unread ? 'font-semibold text-foreground' : 'font-medium text-foreground',
            )}
          >
            {unread ? (
              <span
                aria-hidden
                className="mr-1.5 inline-block size-1.5 -translate-y-px rounded-full bg-info-ink align-middle"
              />
            ) : null}
            {name}
          </span>
          <time
            dateTime={item.lastMessageAt}
            title={new Date(item.lastMessageAt).toLocaleString('en-GB')}
            className={cn(
              'shrink-0 text-[11px] tabular-nums',
              unread ? 'font-semibold text-info-ink' : 'text-muted-foreground',
            )}
          >
            {relativeTime(item.lastMessageAt)}
          </time>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 truncate text-xs font-medium text-body">
          {KindIcon === null ? null : (
            <KindIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 truncate">
            <AutoText value={item.subject} />
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {item.lastMessagePreview?.trim() || 'No messages yet'}
          </span>
          {unread ? (
            <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary-action px-1.5 text-[10px] font-bold text-primary-action-foreground">
              <span className="sr-only">Unread messages: </span>
              {item.unreadCount > 99 ? '99+' : item.unreadCount}
            </span>
          ) : null}
        </span>
        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
          <Chip tone={STATUS_TONE[item.status]} className="h-5 px-2 text-[10px]">
            {STATUS_LABEL[item.status]}
          </Chip>
          {item.priority === 'high' || item.priority === 'urgent' ? (
            <Chip tone={PRIORITY_TONE[item.priority]} className="h-5 px-2 text-[10px]">
              {PRIORITY_LABEL[item.priority]}
            </Chip>
          ) : null}
          {waiting ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-warning-ink">
              <span aria-hidden className="size-1.5 rounded-full bg-warning" />
              <AutoText>Awaiting reply</AutoText>
            </span>
          ) : null}
          <span className="ml-auto truncate text-[10px] text-muted-foreground">
            {item.assigneeId === null
              ? 'Unassigned'
              : mine
                ? 'You'
                : (item.assigneeName ?? 'Teammate')}
          </span>
        </span>
      </span>
    </button>
  );
}

function MessageHits({
  hits,
  state,
  query,
  onOpen,
}: {
  hits: ChatSearchHit[] | null;
  state: 'idle' | 'loading' | 'error';
  query: string;
  onOpen: (conversationId: string) => void;
}) {
  if (query.length < 2) {
    return (
      <p className="px-4 py-8 text-center text-xs text-muted-foreground">
        <AutoText>Type at least two letters to search what customers and the team wrote.</AutoText>
      </p>
    );
  }
  if (state === 'loading' && hits === null) {
    return (
      <p className="flex items-center justify-center gap-2 px-4 py-8 text-xs text-muted-foreground">
        <LoaderCircle aria-hidden className="size-3.5 motion-safe:animate-spin" />
        <AutoText>Searching…</AutoText>
      </p>
    );
  }
  if (state === 'error') {
    return (
      <p className="px-4 py-8 text-center text-xs text-danger-ink">
        <AutoText>The search could not be completed. Try again in a moment.</AutoText>
      </p>
    );
  }
  if (hits === null || hits.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-xs text-muted-foreground">
        No message mentions “{query}”.
      </p>
    );
  }
  return (
    <ul className="grid">
      {hits.map((hit) => (
        <li key={hit.messageId}>
          <button
            type="button"
            onClick={() => onOpen(hit.conversationId)}
            className="grid w-full gap-0.5 border-b border-border px-3 py-2.5 text-left hover:bg-surface-muted/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                {hit.conversationSubject}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {relativeTime(hit.createdAt)}
              </span>
            </span>
            <span className="line-clamp-2 text-xs text-muted-foreground">
              <span className="font-medium text-body">{hit.senderName ?? 'System'}:</span>{' '}
              {hit.body}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
