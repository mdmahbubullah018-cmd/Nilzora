'use client';

import {
  chatMessageSchema,
  type ChatConversationDetail,
  type ChatConversationListResponse,
  type ChatConversationStatus,
  type ChatConversationSummary,
  type ChatInternalNote,
  type ChatMessage,
  type ChatMessageFeedbackEntry,
  type ChatMessagePage,
  type ChatNotesResponse,
  type ChatPinnedMessage,
  type ChatPriority,
  type ChatReactionSummaryItem,
  type ChatReplySummary,
  type ChatSavedReply,
  type ChatTag,
  type ChatTeamMember,
  type ChatTemplate,
  type Permission,
  type PostedChatMessage,
} from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { MessagesSquare } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from './client';
import { chatColumn } from './chat-style';
import { ContextPanel } from './context-panel';
import type { PendingAttachment } from './composer-media';
import {
  buildTimeline,
  customerLabel,
  customerReadSeq,
  lastSeenTeamMessageId,
  mergeMessages,
  type OutgoingReply,
} from './inbox-model';
import { QueueList, type QueueFilters } from './queue-list';
import {
  ReplyComposer,
  ThreadHeader,
  ThreadTimeline,
  type ComposerMode,
  type QuickText,
} from './thread-view';
import { useChatSocket } from './use-chat-socket';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * The Communication Center inbox
 * ------------------------------
 * The queue, the open thread and the customer beside it. Everything is read and written
 * through this app's `/api/support` route, which runs on the server with the operator's
 * session: the browser names only the conversation it is looking at, and the API decides what
 * this account may see and do (the queue itself comes from `chat_support_queue`, which applies
 * the same visibility rule as opening a thread).
 *
 * Freshness, in order of trust:
 *   1. REST reads are the truth: opening a thread, a filter, "Load more", a reconnect.
 *   2. The socket brings the open thread's new messages, typing and read receipts at once.
 *   3. The queue hears "changed" from the staff queue room (a payload-free hint) and re-reads
 *      over REST within a second. While the socket is down it falls back to a 20-second poll,
 *      and it is always re-read on focus; a slow poll remains as a safety net when live.
 */

const PAGE_SIZE = 30;
const POLL_MS = 20_000;
/** While the live feed is up, the poll only backstops a missed signal. */
const LIVE_POLL_EVERY = 3;
/** The channel two open tabs of this app use to avoid both polling the same queue. */
const QUEUE_CHANNEL = 'nilzora:communication-queue';
const TYPING_REPEAT_MS = 2_500;
const TYPING_IDLE_MS = 4_000;

/** Raised by another Communication section to open one thread in the inbox. */
export const OPEN_EVENT = 'nilzora:inbox:open';

type LoadState = 'loading' | 'ready' | 'error';

function queueQuery(filters: QueueFilters, page: number, pageSize: number): string {
  const query = new URLSearchParams({
    op: 'queue',
    page: String(page),
    pageSize: String(pageSize),
  });
  if (filters.scope !== 'all') query.set('scope', filters.scope);
  if (filters.status !== '') query.set('status', filters.status);
  if (filters.priority !== '') query.set('priority', filters.priority);
  if (filters.sort !== 'queue') query.set('sort', filters.sort);
  if (filters.search !== '') query.set('q', filters.search);
  return `?${query.toString()}`;
}

function replaceUrlParam(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  window.history.replaceState(window.history.state, '', url.toString());
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

export function CommunicationCenter({
  initial,
  initialConversationId,
  currentUserId,
  currentUserName,
  permissions,
  onActiveConversation,
  onUnread,
}: {
  initial: ChatConversationListResponse;
  /** A thread named in the address (`?c=`), opened on arrival. */
  initialConversationId?: string | null | undefined;
  currentUserId: string;
  currentUserName: string;
  permissions: readonly Permission[];
  /** Reported upward so the other communication tabs can preview against the open thread. */
  onActiveConversation?: ((id: string | null) => void) | undefined;
  /** The account's unread total, for the Inbox tab's badge. */
  onUnread?: ((unread: number) => void) | undefined;
}) {
  const tx = useTx();
  const held = useMemo(() => new Set(permissions), [permissions]);

  // ------------------------------------------------------------------ queue
  const [filters, setFilters] = useState<QueueFilters>({
    scope: 'all',
    status: '',
    priority: '',
    sort: 'queue',
    search: '',
  });
  const [conversations, setConversations] = useState<ChatConversationSummary[]>(
    initial.conversations,
  );
  const [total, setTotal] = useState(initial.total);
  const [pagesLoaded, setPagesLoaded] = useState(1);
  const [totalPages, setTotalPages] = useState(initial.totalPages);
  const [listState, setListState] = useState<LoadState>('ready');
  const [listError, setListError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestRef = useRef(0);
  const filtersRef = useRef(filters);
  const pagesRef = useRef(pagesLoaded);
  /**
   * True while a queue read is on the wire. Poll ticks and the "changed" signal skip rather
   * than stack another request on top of one that has not answered — with a slow connection
   * that is what turned a 20-second poll into a growing queue of reads.
   */
  const inFlightRef = useRef(false);
  /** The tab that most recently read the queue, so two tabs do not duplicate every poll. */
  const lastOtherPollRef = useRef(0);

  useEffect(() => {
    filtersRef.current = filters;
    pagesRef.current = pagesLoaded;
  }, [filters, pagesLoaded]);

  useEffect(() => {
    onUnread?.(initial.unread);
  }, [initial.unread, onUnread]);

  /** Re-reads the queue from page one, as far as the operator had scrolled, for these filters. */
  const reloadQueue = useCallback(
    async (next: QueueFilters, pages = 1) => {
      const ticket = ++requestRef.current;
      setListState('loading');
      inFlightRef.current = true;
      const size = Math.min(100, PAGE_SIZE * pages);
      const result = await apiGet<ChatConversationListResponse>(queueQuery(next, 1, size));
      // The request has answered, so another may start. Whether its answer may be *used* is
      // the ticket's decision below: a stale reply never overwrites a newer read.
      inFlightRef.current = false;
      if (ticket !== requestRef.current) return;
      if (!result.ok) {
        setListState('error');
        setListError(result.message);
        return;
      }
      setConversations(result.value.conversations);
      setTotal(result.value.total);
      setTotalPages(Math.ceil(result.value.total / PAGE_SIZE));
      setPagesLoaded(Math.max(1, Math.ceil(result.value.conversations.length / PAGE_SIZE)));
      setListError(null);
      setListState('ready');
      onUnread?.(result.value.unread);
    },
    [onUnread],
  );

  const changeFilters = useCallback(
    (change: Partial<QueueFilters>) => {
      const next = { ...filtersRef.current, ...change };
      setFilters(next);
      void reloadQueue(next);
    },
    [reloadQueue],
  );

  const loadMore = useCallback(async () => {
    const page = pagesRef.current + 1;
    setLoadingMore(true);
    const result = await apiGet<ChatConversationListResponse>(
      queueQuery(filtersRef.current, page, PAGE_SIZE),
    );
    setLoadingMore(false);
    if (!result.ok) {
      setListError(result.message);
      return;
    }
    setConversations((current) => {
      const seen = new Set(current.map((item) => item.id));
      return [...current, ...result.value.conversations.filter((item) => !seen.has(item.id))];
    });
    setTotal(result.value.total);
    setTotalPages(result.value.totalPages);
    setPagesLoaded(page);
  }, []);

  // Several events in a row (a message, then its "updated") re-read the queue once.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleQueueRefresh = useCallback(() => {
    if (refreshTimer.current !== null) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void reloadQueue(filtersRef.current, pagesRef.current);
    }, 600);
  }, [reloadQueue]);

  useEffect(
    () => () => {
      if (refreshTimer.current !== null) clearTimeout(refreshTimer.current);
    },
    [],
  );

  // Offline, the queue is polled while the tab is visible; live, the poll is a slow backstop.
  // Either way it is re-read when the operator comes back.
  //
  // Three guards keep the poll from becoming the load it is meant to avoid:
  //   * a tick is skipped while the previous read is still on the wire (`inFlightRef`);
  //   * a hidden tab does not poll at all, and re-reads the moment it is shown or focused;
  //   * when several tabs of this app are open, a tab that has seen another tab read the queue
  //     within this interval leaves the turn to it, so the poll happens once rather than once
  //     per tab. `BroadcastChannel` is the only requirement; where it is missing (or the page
  //     is restored from a bfcache without listeners) each tab behaves exactly as before.
  const liveRef = useRef(false);
  useEffect(() => {
    let ticks = 0;
    const channel =
      typeof window.BroadcastChannel === 'function'
        ? new window.BroadcastChannel(QUEUE_CHANNEL)
        : null;
    if (channel !== null) {
      channel.onmessage = () => {
        lastOtherPollRef.current = Date.now();
      };
    }

    const read = () => {
      if (document.visibilityState !== 'visible' || inFlightRef.current) return;
      lastOtherPollRef.current = 0;
      channel?.postMessage('read');
      void reloadQueue(filtersRef.current, pagesRef.current);
    };
    const timer = setInterval(() => {
      ticks += 1;
      if (liveRef.current && ticks % LIVE_POLL_EVERY !== 0) return;
      // Another tab read the queue a moment ago: its answer is the same as ours would be.
      if (Date.now() - lastOtherPollRef.current < POLL_MS / 2) return;
      read();
    }, POLL_MS);
    const onVisible = read;
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(timer);
      channel?.close();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [reloadQueue]);

  // ----------------------------------------------------------------- thread
  const [activeId, setActiveId] = useState<string | null>(initialConversationId ?? null);
  const [mobileThread, setMobileThread] = useState(initialConversationId != null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detail, setDetail] = useState<ChatConversationDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [notes, setNotes] = useState<ChatInternalNote[]>([]);
  const [threadState, setThreadState] = useState<LoadState>(
    initialConversationId == null ? 'ready' : 'loading',
  );
  const [threadError, setThreadError] = useState<string | null>(null);
  const [threadToken, setThreadToken] = useState(0);
  const [pins, setPins] = useState<ChatPinnedMessage[]>([]);
  const [reactions, setReactions] = useState<ChatReactionSummaryItem[]>([]);
  const [feedback, setFeedback] = useState<ChatMessageFeedbackEntry[]>([]);
  const [outbox, setOutbox] = useState<OutgoingReply[]>([]);
  const [typingName, setTypingName] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [composerMode, setComposerMode] = useState<ComposerMode>('reply');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const [attachmentPending, setAttachmentPending] = useState(false);
  /** The message the next reply answers, or null for a plain one. */
  const [replyTarget, setReplyTarget] = useState<ChatReplySummary | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const activeRef = useRef(activeId);
  const outboxRef = useRef(outbox);
  const detailRef = useRef(detail);

  useEffect(() => {
    activeRef.current = activeId;
    onActiveConversation?.(activeId);
  }, [activeId, onActiveConversation]);

  useEffect(() => {
    outboxRef.current = outbox;
    detailRef.current = detail;
  }, [outbox, detail]);

  /** Marks the newest message read, once the operator is actually looking at the thread. */
  const markRead = useCallback((conversationId: string, seq: number) => {
    if (document.visibilityState !== 'visible') return;
    void apiPost({ op: 'read', id: conversationId, seq });
    setConversations((current) =>
      current.map((item) => (item.id === conversationId ? { ...item, unreadCount: 0 } : item)),
    );
  }, []);

  const readExtras = useCallback(async (conversationId: string) => {
    const [pinList, totals, verdicts] = await Promise.all([
      apiGet<{ messages: ChatPinnedMessage[] }>(`?op=pins&id=${conversationId}`),
      apiGet<{ reactions: ChatReactionSummaryItem[] }>(`?op=reactions&id=${conversationId}`),
      apiGet<{ feedback: ChatMessageFeedbackEntry[] }>(`?op=feedback&id=${conversationId}`),
    ]);
    if (activeRef.current !== conversationId) return;
    // Each is optional context: a refusal leaves its section empty rather than blocking replies.
    setPins(pinList.ok ? pinList.value.messages : []);
    setReactions(totals.ok ? totals.value.reactions : []);
    setFeedback(verdicts.ok ? verdicts.value.feedback : []);
  }, []);

  // Opening a thread reads it in full; `threadToken` re-reads it after a reconnect or retry.
  useEffect(() => {
    if (activeId === null) return;
    let cancelled = false;
    void (async () => {
      const [thread, page, notesPage] = await Promise.all([
        apiGet<ChatConversationDetail>(`?op=thread&id=${activeId}`),
        apiGet<ChatMessagePage>(`?op=messages&id=${activeId}`),
        apiGet<ChatNotesResponse>(`?op=notes&id=${activeId}`),
      ]);
      if (cancelled) return;
      if (!thread.ok || !page.ok) {
        setThreadState('error');
        setThreadError(
          (!thread.ok ? thread.message : !page.ok ? page.message : null) ??
            'That conversation could not be opened.',
        );
        return;
      }
      // A re-read of the thread already on screen keeps the older pages the operator loaded.
      const sameThread = detailRef.current?.conversation.id === activeId;
      setDetail(thread.value);
      setMessages((current) =>
        sameThread ? mergeMessages(current, page.value.messages) : page.value.messages,
      );
      if (!sameThread) setOlderCursor(page.value.nextCursor);
      setNotes(notesPage.ok ? notesPage.value.notes : []);
      setThreadState('ready');
      setThreadError(null);
      const newest = page.value.messages.at(-1);
      if (newest) markRead(activeId, newest.seq);
      await readExtras(activeId);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId, threadToken, markRead, readExtras]);

  const select = useCallback((conversationId: string) => {
    setMobileThread(true);
    setDetailsOpen(false);
    replaceUrlParam('c', conversationId);
    if (conversationId === activeRef.current) return;
    setActiveId(conversationId);
    setDetail(null);
    setMessages([]);
    setNotes([]);
    setPins([]);
    setReactions([]);
    setFeedback([]);
    setOutbox([]);
    setOlderCursor(null);
    setTypingName(null);
    setThreadState('loading');
    setThreadError(null);
    setActionError(null);
    setAttachment(null);
    setComposerMode('reply');
  }, []);

  // Another section (the review queue) asks for a thread by raising this event.
  useEffect(() => {
    const listener = (event: Event) => {
      const conversationId = (event as CustomEvent<unknown>).detail;
      if (typeof conversationId === 'string') select(conversationId);
    };
    window.addEventListener(OPEN_EVENT, listener);
    return () => window.removeEventListener(OPEN_EVENT, listener);
  }, [select]);

  const loadOlder = useCallback(async () => {
    const conversationId = activeRef.current;
    if (conversationId === null || olderCursor === null) return;
    setLoadingOlder(true);
    const result = await apiGet<ChatMessagePage>(
      `?op=messages&id=${conversationId}&before=${String(olderCursor)}`,
    );
    setLoadingOlder(false);
    if (activeRef.current !== conversationId) return;
    if (!result.ok) {
      setActionError(result.message);
      return;
    }
    setMessages((current) => mergeMessages(current, result.value.messages));
    setOlderCursor(result.value.nextCursor);
  }, [olderCursor]);

  // ----------------------------------------------------------------- socket
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketHandlers = useMemo(
    () => ({
      onMessage: (event: { conversationId: string; message: ChatMessage }) => {
        scheduleQueueRefresh();
        if (event.conversationId !== activeRef.current) return;
        // Our own reply is already on screen as "Sending…"; the API's answer replaces it.
        if (event.message.senderId === currentUserId && outboxRef.current.length > 0) return;
        setMessages((current) => mergeMessages(current, [event.message]));
        setTypingName(null);
        if (event.message.senderId !== currentUserId)
          markRead(event.conversationId, event.message.seq);
      },
      onUpdated: (event: { conversationId: string; change: string }) => {
        scheduleQueueRefresh();
        if (
          event.conversationId !== activeRef.current ||
          event.change === 'message' ||
          event.change === 'read'
        ) {
          return;
        }
        const conversationId = event.conversationId;
        if (event.change === 'pin' || event.change === 'reaction') {
          void readExtras(conversationId);
          return;
        }
        void apiGet<ChatConversationDetail>(`?op=thread&id=${conversationId}`).then((thread) => {
          if (thread.ok && activeRef.current === conversationId) setDetail(thread.value);
        });
      },
      onAssigned: () => scheduleQueueRefresh(),
      onQueueChanged: () => scheduleQueueRefresh(),
      onRead: (event: { conversationId: string; userId: string; seq: number }) => {
        if (event.conversationId !== activeRef.current || event.userId === currentUserId) return;
        setDetail((current) =>
          current === null
            ? current
            : {
                ...current,
                participants: current.participants.map((participant) =>
                  participant.userId === event.userId
                    ? { ...participant, lastReadSeq: Math.max(participant.lastReadSeq, event.seq) }
                    : participant,
                ),
              },
        );
      },
      onTyping: (event: {
        conversationId: string;
        userId: string;
        name: string | null;
        typing: boolean;
      }) => {
        if (event.conversationId !== activeRef.current || event.userId === currentUserId) return;
        if (typingTimer.current !== null) clearTimeout(typingTimer.current);
        const current = detailRef.current;
        const customerName =
          current?.customer?.id === event.userId ? (current.customer.name ?? 'The customer') : null;
        setTypingName(event.typing ? (event.name ?? customerName ?? 'Someone') : null);
        if (event.typing) {
          typingTimer.current = setTimeout(() => setTypingName(null), 6_000);
        }
      },
      onReconnected: () => {
        void reloadQueue(filtersRef.current, pagesRef.current);
        setThreadToken((value) => value + 1);
      },
    }),
    [currentUserId, markRead, readExtras, reloadQueue, scheduleQueueRefresh],
  );
  const { connection, typing } = useChatSocket(activeId, socketHandlers);
  useEffect(() => {
    liveRef.current = connection === 'live';
  }, [connection]);

  const lastTypingSent = useRef(0);
  const typingStop = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announceTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current > TYPING_REPEAT_MS) {
      lastTypingSent.current = now;
      typing(true);
    }
    if (typingStop.current !== null) clearTimeout(typingStop.current);
    typingStop.current = setTimeout(() => {
      lastTypingSent.current = 0;
      typing(false);
    }, TYPING_IDLE_MS);
  }, [typing]);

  // --------------------------------------------------------- queue controls
  const applyDetail = useCallback(
    async (body: Record<string, unknown>) => {
      if (activeRef.current === null) return;
      setActionBusy(true);
      setActionError(null);
      const result = await apiPost<ChatConversationDetail>({ ...body, id: activeRef.current });
      setActionBusy(false);
      if (!result.ok) {
        setActionError(result.message);
        return;
      }
      setDetail(result.value);
      // A status change writes a line into the thread; re-read so it appears in place.
      setThreadToken((value) => value + 1);
      scheduleQueueRefresh();
    },
    [scheduleQueueRefresh],
  );

  const setStatus = useCallback(
    (status: ChatConversationStatus) => void applyDetail({ op: 'status', status }),
    [applyDetail],
  );
  const setPriority = useCallback(
    (priority: ChatPriority) => void applyDetail({ op: 'priority', priority }),
    [applyDetail],
  );
  const setAssignee = useCallback(
    (assigneeId: string | null) => void applyDetail({ op: 'assignee', assigneeId }),
    [applyDetail],
  );

  // ------------------------------------------------- team, tags, quick text
  const [team, setTeam] = useState<ChatTeamMember[]>([]);
  const [tags, setTags] = useState<ChatTag[] | null>(null);
  const [tagsBusy, setTagsBusy] = useState(false);
  const [savedReplies, setSavedReplies] = useState<ChatSavedReply[]>([]);
  const [templates, setTemplates] = useState<ChatTemplate[]>([]);

  // Tags, saved replies and templates belong to the support workspace; the database refuses them
  // to a moderator-only account, so they are not asked for there.
  const supportDesk = held.has('admin_workspace.access');
  useEffect(() => {
    void (async () => {
      const members = await apiGet<{ members: ChatTeamMember[] }>('?op=team');
      setTeam(members.ok ? members.value.members : []);
      if (!supportDesk) return;
      const [tagList, replies, library] = await Promise.all([
        apiGet<{ tags: ChatTag[] }>('?op=tags'),
        apiGet<{ replies: ChatSavedReply[] }>('?op=saved-replies'),
        apiGet<{ templates: ChatTemplate[] }>('?op=templates'),
      ]);
      setTags(tagList.ok ? tagList.value.tags : null);
      setSavedReplies(replies.ok ? replies.value.replies.filter((reply) => reply.isActive) : []);
      setTemplates(
        library.ok
          ? library.value.templates.filter(
              (template) => template.isActive && template.category !== 'internal',
            )
          : [],
      );
    })();
  }, [supportDesk]);

  const quickTexts = useMemo<QuickText[]>(
    () => [
      ...savedReplies.map((reply) => ({
        id: `saved:${reply.id}`,
        label: reply.shortcut === null ? reply.title : `${reply.shortcut} · ${reply.title}`,
        group: 'saved' as const,
      })),
      ...templates.map((template) => ({
        id: `template:${template.id}`,
        label: `${template.name} (${template.locale.toUpperCase()})`,
        group: 'template' as const,
      })),
    ],
    [savedReplies, templates],
  );

  const saveTags = useCallback(async (tagIds: string[]) => {
    const conversationId = activeRef.current;
    if (conversationId === null) return;
    setTagsBusy(true);
    const result = await apiPost<null>({ op: 'tags-set', conversationId, tagIds });
    setTagsBusy(false);
    if (!result.ok) {
      setActionError(result.message);
      return;
    }
    const thread = await apiGet<ChatConversationDetail>(`?op=thread&id=${conversationId}`);
    if (thread.ok && activeRef.current === conversationId) setDetail(thread.value);
  }, []);

  // --------------------------------------------------------------- composer
  const draftKey = activeId === null ? '' : `${composerMode}:${activeId}`;
  const draft = drafts[draftKey] ?? '';
  const setDraft = useCallback(
    (value: string) => setDrafts((current) => ({ ...current, [draftKey]: value })),
    [draftKey],
  );

  const insertQuickText = useCallback(
    async (choice: QuickText) => {
      const conversationId = activeRef.current;
      if (conversationId === null) return;
      let text: string | null = null;
      if (choice.group === 'saved') {
        text = savedReplies.find((reply) => `saved:${reply.id}` === choice.id)?.body ?? null;
      } else {
        // A template is filled in by the API with this conversation's real values.
        const result = await apiPost<{ body: string }>({
          op: 'template-render',
          templateId: choice.id.slice('template:'.length),
          conversationId,
        });
        if (!result.ok) {
          setActionError(result.message);
          return;
        }
        text = result.value.body;
      }
      if (text === null) return;
      const key = `reply:${conversationId}`;
      setDrafts((current) => {
        const existing = (current[key] ?? '').trimEnd();
        return { ...current, [key]: existing === '' ? text : `${existing}\n${text}` };
      });
    },
    [savedReplies],
  );

  /** Sends one already-written reply; a retry reuses its id, so the API never stores it twice. */
  const deliver = useCallback(
    async (row: OutgoingReply) => {
      const conversationId = activeRef.current;
      if (conversationId === null) return;
      setOutbox((current) =>
        current.some((entry) => entry.clientMessageId === row.clientMessageId)
          ? current.map((entry) =>
              entry.clientMessageId === row.clientMessageId
                ? { ...entry, state: 'sending', error: null }
                : entry,
            )
          : [...current, { ...row, state: 'sending', error: null }],
      );
      const quoted = row.reply === null ? {} : { replyToId: row.reply.id };
      const result =
        row.attachmentId === null
          ? await apiPost<{ message: ChatMessage }>({
              op: 'send',
              id: conversationId,
              clientMessageId: row.clientMessageId,
              body: row.body,
              ...quoted,
            })
          : await apiPost<PostedChatMessage>({
              op: 'post',
              id: conversationId,
              clientMessageId: row.clientMessageId,
              ...(row.body === '' ? {} : { body: row.body }),
              attachmentIds: [row.attachmentId],
              ...quoted,
            });
      if (!result.ok) {
        setOutbox((current) =>
          current.map((entry) =>
            entry.clientMessageId === row.clientMessageId
              ? { ...entry, state: 'failed', error: result.message }
              : entry,
          ),
        );
        return;
      }
      const stored: ChatMessage =
        'attachments' in result.value
          ? chatMessageSchema.parse({
              ...result.value.message,
              attachments: result.value.attachments,
            })
          : result.value.message;
      setOutbox((current) =>
        current.filter((entry) => entry.clientMessageId !== row.clientMessageId),
      );
      // The quote has been answered by this message, so the composer stops pointing at it.
      setReplyTarget(null);
      if (activeRef.current === conversationId) {
        setMessages((current) => mergeMessages(current, [stored]));
      }
      scheduleQueueRefresh();
    },
    [scheduleQueueRefresh],
  );

  const submit = useCallback(async () => {
    const conversationId = activeRef.current;
    if (conversationId === null) return;
    const body = draft.trim();
    if (composerMode === 'note') {
      if (body === '' || noteBusy) return;
      setNoteBusy(true);
      setActionError(null);
      const note = await apiPost<ChatInternalNote>({ op: 'note', id: conversationId, body });
      setNoteBusy(false);
      if (!note.ok) {
        setActionError(note.message);
        return;
      }
      setNotes((current) => [...current, note.value]);
      setDraft('');
      return;
    }
    if ((body === '' && attachment === null) || attachmentPending) return;
    const row: OutgoingReply = {
      clientMessageId: crypto.randomUUID(),
      body,
      attachmentId: attachment?.id ?? null,
      attachmentName: attachment?.fileName ?? null,
      reply: replyTarget,
      createdAt: new Date().toISOString(),
      state: 'sending',
      error: null,
    };
    // The composer is free again at once; the reply reports its own progress in the thread.
    setDraft('');
    setAttachment(null);
    setReplyTarget(null);
    setActionError(null);
    if (typingStop.current !== null) clearTimeout(typingStop.current);
    lastTypingSent.current = 0;
    typing(false);
    await deliver(row);
  }, [
    attachment,
    attachmentPending,
    composerMode,
    deliver,
    draft,
    noteBusy,
    replyTarget,
    setDraft,
    typing,
  ]);

  // ------------------------------------------------------- pins, reactions
  const togglePin = useCallback(
    async (message: ChatMessage, pinned: boolean) => {
      const conversationId = activeRef.current;
      if (conversationId === null) return;
      const result = await apiPost<null>({
        op: pinned ? 'unpin' : 'pin',
        conversationId,
        messageId: message.id,
      });
      if (!result.ok) {
        setActionError(result.message);
        return;
      }
      await readExtras(conversationId);
    },
    [readExtras],
  );

  const react = useCallback(
    async (messageId: string, emoji: string) => {
      const conversationId = activeRef.current;
      if (conversationId === null) return;
      const result = await apiPost<{ added: boolean }>({
        op: 'react',
        conversationId,
        messageId,
        emoji,
      });
      if (!result.ok) {
        setActionError(result.message);
        return;
      }
      await readExtras(conversationId);
    },
    [readExtras],
  );

  // ----------------------------------------------------------------- render
  const timeline = useMemo(() => buildTimeline(messages, notes, outbox), [messages, notes, outbox]);
  const seenMessageId = useMemo(
    () =>
      lastSeenTeamMessageId(
        messages,
        detail === null
          ? null
          : customerReadSeq(detail.participants, detail.conversation.customerId),
      ),
    [detail, messages],
  );
  const activeSummary = conversations.find((item) => item.id === activeId) ?? null;
  const headerName =
    detail?.customer?.name ??
    detail?.customer?.email ??
    (activeSummary === null ? 'Conversation' : customerLabel(activeSummary));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:h-[calc(100dvh-20.5rem)] lg:min-h-96 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] xl:grid-cols-[minmax(17rem,21rem)_minmax(0,1fr)_minmax(15rem,19rem)]">
      <QueueList
        conversations={conversations}
        total={total}
        state={listState}
        error={listError}
        activeId={activeId}
        currentUserId={currentUserId}
        filters={filters}
        onFilters={changeFilters}
        onSelect={select}
        onRetry={() => void reloadQueue(filtersRef.current)}
        hasMore={pagesLoaded < totalPages}
        loadingMore={loadingMore}
        onLoadMore={() => void loadMore()}
        className={cn(
          'h-[calc(100dvh-20.5rem)] min-h-80 lg:h-auto lg:min-h-0',
          mobileThread && 'hidden lg:flex',
        )}
      />

      <section
        aria-label={tx('Conversation')}
        className={cn(
          chatColumn,
          'h-[calc(100dvh-20.5rem)] min-h-80 lg:h-auto lg:min-h-0',
          !mobileThread && 'hidden lg:flex',
        )}
      >````````
        {activeId === null ? (
          <div className="grid flex-1 place-items-center p-8 text-center">
            <div className="grid max-w-sm justify-items-center gap-4">
              <span className="relative grid size-16 place-items-center rounded-2xl bg-linear-to-b from-info-soft to-surface text-info-ink ring-1 ring-info-line">
                <MessagesSquare aria-hidden className="size-7" />
                <span
                  aria-hidden
                  className="absolute -right-1 -bottom-1 size-3 rounded-full bg-success ring-2 ring-surface"
                />
              </span>
              <div className="grid gap-1.5">
                <p className="font-display text-base font-semibold text-foreground">
                  <AutoText>Choose a conversation</AutoText>
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  <AutoText>
                    Pick a thread from the queue to read it, reply, or hand it to a teammate.
                  </AutoText>
                </p>
              </div>
            </div>
          </div>
        ) : (
          <>
            <ThreadHeader
              detail={detail}
              customerName={headerName}
              connection={connection}
              typingName={typingName}
              team={team}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              busy={actionBusy}
              onStatus={setStatus}
              onPriority={setPriority}
              onAssign={setAssignee}
              onBack={() => {
                setMobileThread(false);
                replaceUrlParam('c', null);
              }}
              onToggleDetails={() => setDetailsOpen((value) => !value)}
              detailsOpen={detailsOpen}
            />
            <ThreadTimeline
              conversationId={activeId}
              items={timeline}
              state={threadState}
              error={threadError}
              onRetryLoad={() => {
                setThreadState('loading');
                setThreadToken((value) => value + 1);
              }}
              hasOlder={olderCursor !== null}
              loadingOlder={loadingOlder}
              onLoadOlder={() => void loadOlder()}
              pins={pins}
              reactions={reactions}
              seenMessageId={seenMessageId}
              typingName={typingName}
              onPin={(message, pinned) => void togglePin(message, pinned)}
              onReact={(messageId, emoji) => void react(messageId, emoji)}
              onRetryReply={(reply) => void deliver(reply)}
              onReplyMessage={(message) => {
                setReplyTarget(quoteOf(message));
                setComposerMode('reply');
              }}
              onJumpToMessage={(messageId) => {
                const target = document.getElementById(`chat-message-${messageId}`);
                if (target === null) return;
                target.scrollIntoView({ block: 'center', behavior: 'smooth' });
                target.dataset.highlight = 'true';
                setTimeout(() => {
                  delete target.dataset.highlight;
                }, 1_600);
              }}
            />
            {threadState === 'ready' ? (
              <ReplyComposer
                conversationId={activeId}
                detail={detail}
                mode={composerMode}
                onMode={setComposerMode}
                draft={draft}
                onDraft={setDraft}
                attachment={attachment}
                onAttachment={setAttachment}
                onAttachmentPending={setAttachmentPending}
                attachmentPending={attachmentPending}
                noteBusy={noteBusy}
                error={actionError}
                quickTexts={quickTexts}
                onQuickText={(choice) => void insertQuickText(choice)}
                onSubmit={() => void submit()}
                onTyping={announceTyping}
                onReopen={() => setStatus('open')}
                reply={replyTarget}
                onCancelReply={() => setReplyTarget(null)}
              />
            ) : null}
          </>
        )}
      </section>

      {activeId === null ? (
        <ContextPanel
          detail={null}
          permissions={held}
          feedback={[]}
          tags={tags}
          tagsBusy={false}
          onTags={() => undefined}
          onClose={() => setDetailsOpen(false)}
          className="hidden xl:flex"
        />
      ) : (
        <>
          {detailsOpen ? (
            <button
              type="button"
              aria-label={tx('Close details')}
              onClick={() => setDetailsOpen(false)}
              className="fixed inset-0 z-40 bg-overlay/40 xl:hidden"
            />
          ) : null}
          <ContextPanel
            detail={detail}
            permissions={held}
            feedback={feedback}
            tags={tags}
            tagsBusy={tagsBusy}
            onTags={(ids) => void saveTags(ids)}
            onClose={() => setDetailsOpen(false)}
            className={cn(
              'xl:static xl:z-auto xl:flex xl:w-auto xl:shadow-none',
              detailsOpen
                ? 'fixed inset-y-3 right-3 z-50 flex w-[min(22rem,calc(100vw-1.5rem))] shadow-2xl'
                : 'hidden',
            )}
          />
        </>
      )}
    </div>
  );
}
