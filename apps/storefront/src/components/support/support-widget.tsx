'use client';

import type {
  ChatConversationDetail,
  ChatConversationStatus,
  ChatConversationSummary,
  ChatMessage,
  ChatMessagePage,
  ChatReplySummary,
  PostedChatMessage,
  StartChatConversationRequest,
} from '@nilzora/contracts';
import { chatMediaKindOf, chatMessageSchema } from '@nilzora/contracts';
import {
  ChatImageLightbox,
  ChatMessagesSkeleton,
  LogoMark,
  VoiceRecorder,
  type ChatImageViewerImage,
  type RecordedVoice,
} from '@nilzora/ui';
import type { Route } from 'next';
import { ProductImage } from '@/components/catalog/product-image';
import {
  ArrowLeft,
  CircleAlert,
  LoaderCircle,
  Lock,
  Maximize2,
  MessageCircle,
  Minimize2,
  Mic,
  Package,
  RefreshCw,
  Send,
  ShoppingBag,
  WifiOff,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CsatPrompt, MessageFeedbackPrompt, PinnedNotice, ReplyTargetBar } from './support-extras';
import { AttachMenuButton, SelectedFileList } from './support-attach';
import { OutgoingBubble, SupportMessage } from './support-message';
import { ReactionsProvider } from './support-reactions';
import {
  QUEUED,
  uploadChosenFile,
  type ApiResult,
  type FileUploadState,
  type Outgoing,
  type SelectedChatFile,
} from './support-upload';
import { QuickReplies } from './quick-replies';
import { io, type Socket } from 'socket.io-client';
import { onOpenSupport, setSupportOpenState, type SupportOpenRequest } from '@/lib/support-events';
import { SupportReviewInvite } from './support-review-invite';
import {
  STATUS_LABEL,
  feedbackTargetId,
  isActiveStatus,
  isTimelineMessage,
  lastSeenCustomerMessageId,
  listPreview,
  mergeMessages,
  teamReadSeq,
  type FeedbackVerdict,
} from './support-model';

/*
 * The customer support widget
 * ---------------------------
 * It talks only to this app's own `/api/support` route, which runs on the server with the
 * session cookies: no token ever reaches the browser, and the browser never says who it is.
 *
 * Live updates come over Socket.IO with a two-minute ticket. They are an optimization, not
 * the source of truth: if the socket cannot connect the widget keeps working over REST and
 * says so, a reconnect re-reads the open thread, and every reconnect asks for a fresh ticket
 * (Socket.IO repeats the first handshake's data, which would be refused once it expired).
 *
 * "Seen" is drawn only from the team's own read position as the API stored it.
 */

type Connection = 'connecting' | 'live' | 'offline';

interface Ticket {
  ticket: string;
  expiresAt: number;
  url: string;
}

/** One of the customer's own recent orders, for the "about an order" picker. */
interface RecentOrder {
  orderNumber: string;
  status: string;
  itemCount: number;
  totalMinor: number;
  placedAt: string;
}

const TYPING_REPEAT_MS = 2_500;
const TYPING_IDLE_MS = 4_000;

/**
 * Releases uploads that no message ended up carrying.
 *
 * Best effort and never fatal: a discard that fails leaves one pending row behind, which the
 * database expires on its own, and that is far better than refusing to tell the customer what
 * went wrong with the message they actually sent.
 */
async function discardAttachments(conversationId: string, ids: readonly string[]): Promise<void> {
  void conversationId;
  await Promise.all(
    ids.map((id) => apiPost<null>({ op: 'discard-attachment', id }).catch(() => null)),
  );
}

function apiCode(payload: unknown): string | null {
  const code = (payload as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === 'string' ? code : null;
}

async function apiGet<T>(query: string): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`/api/support${query}`, { cache: 'no-store' });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        (payload as { error?: { message?: string } } | null)?.error?.message ??
        'Nilzora could not be reached.';
      return { ok: false, status: response.status, code: apiCode(payload), message };
    }
    return { ok: true, value: payload as T };
  } catch {
    return { ok: false, status: 0, code: null, message: 'Check your connection and try again.' };
  }
}

async function apiPost<T>(body: unknown): Promise<ApiResult<T>> {
  try {
    const response = await fetch('/api/support', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        (payload as { error?: { message?: string } } | null)?.error?.message ??
        'Nilzora could not be reached.';
      return { ok: false, status: response.status, code: apiCode(payload), message };
    }
    return { ok: true, value: payload as T };
  } catch {
    return { ok: false, status: 0, code: null, message: 'Check your connection and try again.' };
  }
}

/** Monday-to-Sunday short label; derived only from the timestamp, never from "now". */
function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function money(minor: number): string {
  return `৳${(minor / 100).toLocaleString('en-BD', { maximumFractionDigits: 2 })}`;
}

const STATUS_CHIP: Record<ChatConversationStatus, string> = {
  open: 'bg-primary-action/10 text-link ring-primary-action/25',
  pending: 'bg-warning/15 text-foreground ring-warning/40',
  resolved: 'bg-success/15 text-foreground ring-success/40',
  closed: 'bg-surface-muted text-muted-foreground ring-border',
};

function StatusChip({ status }: { status: ChatConversationStatus }) {
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10px] font-semibold ring-1 ring-inset ${STATUS_CHIP[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function SupportWidget() {
  const [open, setOpen] = useState(false);
  // The centred large-screen layout (lg and up only; a phone keeps its own layout).
  const [expanded, setExpanded] = useState(false);
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [unread, setUnread] = useState(0);
  const [listState, setListState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [listMessage, setListMessage] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<ChatConversationDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [threadState, setThreadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  // The accounts currently present in the open thread, so the dot disappears again when the
  // last teammate leaves instead of staying on forever after the first join.
  const [onlineIds, setOnlineIds] = useState<readonly string[]>([]);

  const [draft, setDraft] = useState('');
  /** Only starting a thread needs a spinner; a reply appears at once and reports itself. */
  const [starting, setStarting] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  /** Written here, not yet confirmed by the API, drawn under the stored messages. */
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  /** The files chosen but not sent. Nothing here has been uploaded yet. */
  const [selected, setSelected] = useState<SelectedChatFile[]>([]);
  /** Why the last chosen files were refused, one sentence each. */
  const [attachProblems, setAttachProblems] = useState<string[]>([]);
  /** The voice recorder is open: summoned by the microphone button, never by the page. */
  const [voiceMode, setVoiceMode] = useState(false);
  const [voice, setVoice] = useState<RecordedVoice | null>(null);
  /** A short confirmation ("Message copied.", "Report sent."), shown above the composer. */
  const [notice, setNotice] = useState<string | null>(null);
  /** The picture opened full size from a message's actions menu. */
  const [viewer, setViewer] = useState<ChatImageViewerImage | null>(null);
  /** The customer's own "Was this helpful?" answers for this thread, from the API. */
  const [verdicts, setVerdicts] = useState<Readonly<Record<string, FeedbackVerdict>> | null>(null);
  /** True from the moment Send is pressed until the server has answered. */
  const [sending, setSending] = useState(false);
  /** The message the next send will answer, or null for a plain message. */
  const [reply, setReply] = useState<ChatReplySummary | null>(null);
  // Bumped by a realtime conversation:updated, so the open thread re-reads what changed.
  const [threadToken, setThreadToken] = useState(0);
  const [typingName, setTypingName] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>('offline');
  const [composing, setComposing] = useState<SupportOpenRequest | null>(null);
  const [orders, setOrders] = useState<RecentOrder[] | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const outboxRef = useRef<Outgoing[]>([]);
  const selfRef = useRef<string | null>(null);
  const prependRef = useRef<number | null>(null);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    outboxRef.current = outbox;
    selfRef.current = thread?.viewer.userId ?? null;
  }, [outbox, thread]);

  const refreshList = useCallback(async () => {
    setListState((current) => (current === 'ready' ? current : 'loading'));
    const result = await apiGet<{ conversations: ChatConversationSummary[]; unread: number }>(
      '?op=list',
    );
    if (!result.ok) {
      setSignedOut(result.status === 401);
      setListState('error');
      setListMessage(result.message);
      return;
    }
    setConversations(result.value.conversations);
    setUnread(result.value.unread);
    setListMessage(null);
    setListState('ready');
  }, []);

  /**
   * Shows a thread and nothing else: the messages, the presence and any row still waiting to be
   * sent all belong to the thread that was open, so they leave together.
   */
  const showThread = useCallback((conversationId: string | null) => {
    // A row that failed after its files landed leaves uploads behind: release them (best effort).
    for (const row of outboxRef.current) {
      const ids = Object.values(row.fileStates).flatMap((state) =>
        state.status === 'uploaded' ? [state.attachmentId] : [],
      );
      if (ids.length > 0) void discardAttachments(activeIdRef.current ?? '', ids);
    }
    setActiveId(conversationId);
    setThread(null);
    setMessages([]);
    setOlderCursor(null);
    setOutbox([]);
    setTypingName(null);
    setOnlineIds([]);
    setSendError(null);
    setSelected([]);
    setAttachProblems([]);
    setVoiceMode(false);
    setVoice(null);
    setVerdicts(null);
    setNotice(null);
    setReply(null);
  }, []);

  const openPanel = useCallback(() => {
    setOpen(true);
    void refreshList();
  }, [refreshList]);

  // Entry points anywhere on the site reach the widget through this event.
  useEffect(
    () =>
      onOpenSupport((request) => {
        setComposing(request);
        if (request.conversationId !== undefined) setThreadState('loading');
        showThread(request.conversationId ?? null);
        openPanel();
      }),
    [openPanel, showThread],
  );

  // The tab bar reads this mirror to show the Chat item's open state. The widget owns the panel.
  useEffect(() => {
    setSupportOpenState(open);
  }, [open]);
  useEffect(() => () => setSupportOpenState(false), []);

  // The customer's recent orders, read once per open panel, so a question can name one.
  useEffect(() => {
    if (!open || orders !== null) return;
    void (async () => {
      const result = await apiGet<{ orders: RecentOrder[] }>('?op=orders');
      setOrders(result.ok ? result.value.orders : []);
    })();
  }, [open, orders]);

  // Opening a thread reads it once; the socket only ever adds to what is already there.
  useEffect(() => {
    if (!open || activeId === null) return;
    let cancelled = false;
    void (async () => {
      const [detail, page] = await Promise.all([
        apiGet<ChatConversationDetail>(`?op=thread&id=${activeId}`),
        apiGet<ChatMessagePage>(`?op=messages&id=${activeId}`),
      ]);
      if (cancelled) return;
      if (!detail.ok || !page.ok) {
        setThreadState('error');
        setSendError('This conversation could not be opened.');
        return;
      }
      setThread(detail.value);
      // A re-read keeps any older page already on screen.
      setMessages((current) => mergeMessages(current, page.value.messages));
      setOlderCursor((current) => current ?? page.value.nextCursor);
      setThreadState('ready');
      setSendError(null);
      const newest = page.value.messages.at(-1);
      if (newest) void apiPost({ op: 'read', id: activeId, seq: newest.seq });
    })();
    return () => {
      cancelled = true;
    };
  }, [open, activeId, threadToken]);

  /*
   * The customer's own verdicts on this thread's replies. They are read only once the thread has
   * finished (resolved or closed), because that is the only time "Was this helpful?" can appear.
   * Until the answer is in, nothing is asked: a prompt is never shown first and withdrawn after,
   * and a read that fails asks nothing rather than risk asking twice.
   */
  const conversationStatus = thread?.conversation.status ?? null;
  useEffect(() => {
    if (!open || activeId === null) return;
    if (conversationStatus !== 'resolved' && conversationStatus !== 'closed') return;
    let cancelled = false;
    void (async () => {
      const result = await apiGet<{
        feedback: { messageId: string; verdict: FeedbackVerdict }[];
      }>(`?op=my-feedback&id=${activeId}`);
      if (cancelled || !result.ok || !Array.isArray(result.value.feedback)) return;
      setVerdicts((current) => ({
        ...(current ?? {}),
        ...Object.fromEntries(
          result.value.feedback.map((entry) => [entry.messageId, entry.verdict]),
        ),
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, activeId, conversationStatus, threadToken]);

  // A confirmation is a toast: it says its piece and goes away by itself.
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), 4_000);
    return () => clearTimeout(timer);
  }, [notice]);

  // New content scrolls into view; an older page keeps the reader's place instead.
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (container === null) return;
    if (prependRef.current !== null) {
      container.scrollTop += container.scrollHeight - prependRef.current;
      prependRef.current = null;
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [messages, outbox, typingName, threadState]);

  // One socket per open panel: a ticket, a handshake, then room events.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let socket: Socket | null = null;
    let connectedOnce = false;

    void (async () => {
      const ticket = await apiGet<Ticket>('?op=ticket');
      if (cancelled || !ticket.ok) {
        setConnection('offline');
        return;
      }
      setConnection('connecting');
      let unused: string | null = ticket.value.ticket;
      socket = io(ticket.value.url, {
        // The first handshake uses the ticket just issued; each reconnect asks for a new one.
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
        reconnectionDelayMax: 8_000,
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        setConnection('live');
        const current = activeIdRef.current;
        if (current) socket?.emit('conversation:join', { conversationId: current });
        if (connectedOnce) {
          // Anything sent while the connection was down is read again, not lost.
          void refreshList();
          setThreadToken((value) => value + 1);
        }
        connectedOnce = true;
      });
      socket.on('disconnect', () => setConnection('offline'));
      socket.on('connect_error', () => setConnection('offline'));
      socket.on('message:new', (event: { conversationId: string; message: ChatMessage }) => {
        if (event.conversationId !== activeIdRef.current) {
          void refreshList();
          return;
        }
        // Our own message is already on screen from the keystroke; while a row is still waiting
        // for its answer the echo would draw it twice, and the answer carries the stored copy.
        if (
          event.message.senderRole === 'customer' &&
          outboxRef.current.some((row) => row.state === 'sending')
        ) {
          return;
        }
        setMessages((current) => mergeMessages(current, [event.message]));
        setTypingName(null);
        if (event.message.senderRole !== 'customer') {
          void apiPost({ op: 'read', id: event.conversationId, seq: event.message.seq });
        }
      });
      socket.on(
        'message:read',
        (event: { conversationId: string; userId: string; seq: number }) => {
          if (event.conversationId !== activeIdRef.current || event.userId === selfRef.current)
            return;
          setThread((current) =>
            current === null
              ? current
              : {
                  ...current,
                  participants: current.participants.some((p) => p.userId === event.userId)
                    ? current.participants.map((participant) =>
                        participant.userId === event.userId
                          ? {
                              ...participant,
                              lastReadSeq: Math.max(participant.lastReadSeq, event.seq),
                            }
                          : participant,
                      )
                    : current.participants,
                },
          );
          // A teammate who was not a participant yet joined by reading: re-read the thread.
          setThreadToken((value) => value + 1);
        },
      );
      socket.on(
        'typing:update',
        (event: {
          conversationId: string;
          userId: string;
          name: string | null;
          typing: boolean;
        }) => {
          if (event.conversationId !== activeIdRef.current || event.userId === selfRef.current)
            return;
          setTypingName(event.typing ? (event.name ?? 'Support') : null);
        },
      );
      socket.on(
        'presence:update',
        (event: { conversationId: string; userId: string; online: boolean }) => {
          if (event.conversationId !== activeIdRef.current) return;
          setOnlineIds((current) =>
            event.online
              ? current.includes(event.userId)
                ? current
                : [...current, event.userId]
              : current.filter((id) => id !== event.userId),
          );
        },
      );
      /*
       * A pin, a reaction, a status or priority change or a rating: the widget re-reads the
       * thread rather than trusting the payload, so a repeated or missed event is harmless.
       */
      socket.on('conversation:updated', (event: { conversationId: string; change: string }) => {
        void refreshList();
        if (event.conversationId === activeIdRef.current && event.change !== 'message') {
          setThreadToken((value) => value + 1);
        }
      });
    })();

    return () => {
      cancelled = true;
      socket?.disconnect();
      socketRef.current = null;
      setConnection('offline');
      setOnlineIds([]);
    };
  }, [open, refreshList]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected || activeId === null) return;
    socket.emit('conversation:join', { conversationId: activeId });
    const timer = setInterval(() => socket.emit('presence:heartbeat'), 25_000);
    return () => {
      clearInterval(timer);
      socket.emit('conversation:leave', { conversationId: activeId });
    };
  }, [activeId, connection]);

  // Typing is announced at most every few seconds and stops by itself when the customer pauses.
  const lastTyping = useRef(0);
  const typingStop = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announceTyping = useCallback(() => {
    const socket = socketRef.current;
    const conversationId = activeIdRef.current;
    if (socket === null || !socket.connected || conversationId === null) return;
    const now = Date.now();
    if (now - lastTyping.current > TYPING_REPEAT_MS) {
      lastTyping.current = now;
      socket.emit('typing:start', { conversationId });
    }
    if (typingStop.current !== null) clearTimeout(typingStop.current);
    typingStop.current = setTimeout(() => {
      lastTyping.current = 0;
      socket.emit('typing:stop', { conversationId });
    }, TYPING_IDLE_MS);
  }, []);
  const stopTyping = useCallback(() => {
    if (typingStop.current !== null) clearTimeout(typingStop.current);
    lastTyping.current = 0;
    const conversationId = activeIdRef.current;
    if (conversationId !== null) socketRef.current?.emit('typing:stop', { conversationId });
  }, []);

  const loadOlder = useCallback(async () => {
    const conversationId = activeIdRef.current;
    if (conversationId === null || olderCursor === null || loadingOlder) return;
    setLoadingOlder(true);
    const page = await apiGet<ChatMessagePage>(
      `?op=messages&id=${conversationId}&before=${String(olderCursor)}`,
    );
    setLoadingOlder(false);
    if (activeIdRef.current !== conversationId) return;
    if (!page.ok) {
      setSendError(page.message);
      return;
    }
    prependRef.current = scrollRef.current?.scrollHeight ?? null;
    setMessages((current) => mergeMessages(current, page.value.messages));
    setOlderCursor(page.value.nextCursor);
  }, [loadingOlder, olderCursor]);

  /**
   * Posts one already-written row and reconciles the answer with what is on screen.
   *
   * Files travel first, one at a time, then the message that carries them. What already landed is
   * remembered on the row, so a retry uploads only the files that are still missing and, when every
   * file landed but the post failed, posts again without uploading anything. The post always
   * reuses the row's `clientMessageId`, so the API can tell a retry from a second message.
   */
  const deliver = useCallback(
    async (row: Outgoing) => {
      const conversationId = activeIdRef.current;
      setSending(true);
      try {
        if (conversationId === null) return;
        const states: Record<string, FileUploadState> = { ...row.fileStates };
        const update = (patch: Partial<Outgoing>) =>
          setOutbox((current) =>
            current.some((entry) => entry.clientMessageId === row.clientMessageId)
              ? current.map((entry) =>
                  entry.clientMessageId === row.clientMessageId
                    ? { ...entry, fileStates: { ...states }, ...patch }
                    : entry,
                )
              : [...current, { ...row, fileStates: { ...states }, ...patch }],
          );
        const fail = (message: string) => update({ state: 'failed', error: message });
        update({ state: 'sending', error: null });

        // Nothing is uploaded until the customer presses Send, and a message is never created
        // around a file that did not land.
        for (const chosen of row.files) {
          if (states[chosen.localId]?.status === 'uploaded') continue;
          states[chosen.localId] = {
            status: 'uploading',
            percent: 0,
            attachmentId: null,
            error: null,
          };
          update({});
          const uploadedOne = await uploadChosenFile(conversationId, chosen, (progress) => {
            states[chosen.localId] = progress.processing
              ? { status: 'processing', percent: 100, attachmentId: null, error: null }
              : { status: 'uploading', percent: progress.percent, attachmentId: null, error: null };
            update({});
          });
          if (!uploadedOne.ok) {
            states[chosen.localId] = {
              status: 'failed',
              percent: null,
              attachmentId: null,
              error: uploadedOne.message,
            };
            fail(uploadedOne.message);
            return;
          }
          states[chosen.localId] = {
            status: 'uploaded',
            percent: 100,
            attachmentId: uploadedOne.value.id,
            error: null,
          };
          update({});
        }
        const uploaded = row.files.flatMap((chosen) => {
          const state = states[chosen.localId];
          return state?.status === 'uploaded' ? [state.attachmentId] : [];
        });

        // A file message is posted through \`post\`, which stores the message and claims the uploads
        // in one call; plain text keeps the Phase 1 \`send\` path. A reply travels with either.
        const quoted = row.reply === null ? {} : { replyToId: row.reply.id };
        const result =
          uploaded.length === 0
            ? await apiPost<{ message: ChatMessage }>({
                op: 'send',
                id: conversationId,
                clientMessageId: row.clientMessageId,
                body: row.body,
                ...quoted,
              })
            : await apiPost<PostedChatMessage>({
                op: 'post',
                conversationId,
                clientMessageId: row.clientMessageId,
                body: row.body === '' ? undefined : row.body,
                attachmentIds: uploaded,
                ...quoted,
              });
        if (!result.ok) {
          // The files stay uploaded for the retry. Only when the API says they are gone are they
          // forgotten, so the next attempt uploads them again.
          if (result.code === 'attachment_not_found') {
            for (const chosen of row.files) states[chosen.localId] = QUEUED;
          }
          fail(result.message);
          return;
        }

        // \`post\` answers with the stored message plus the files it carries; the bubble renders both.
        const sent: ChatMessage =
          'attachments' in result.value
            ? chatMessageSchema.parse({
                ...result.value.message,
                attachments: result.value.attachments,
              })
            : result.value.message;
        setOutbox((current) =>
          current.filter((entry) => entry.clientMessageId !== row.clientMessageId),
        );
        // The reply was answered by this message, so the composer stops quoting it.
        setReply(null);
        if (activeIdRef.current !== conversationId) return;
        setMessages((current) => mergeMessages(current, [sent]));
        void refreshList();
      } finally {
        // The composer is free again whatever happened; the bubble reports the outcome.
        setSending(false);
      }
    },
    [refreshList],
  );

  /** Drops a row that did not send, releasing any files it had already uploaded. */
  const removeRow = useCallback((row: Outgoing) => {
    const ids = Object.values(row.fileStates).flatMap((state) =>
      state.status === 'uploaded' ? [state.attachmentId] : [],
    );
    setOutbox((current) =>
      current.filter((entry) => entry.clientMessageId !== row.clientMessageId),
    );
    const conversationId = activeIdRef.current;
    if (conversationId !== null && ids.length > 0) void discardAttachments(conversationId, ids);
  }, []);

  /** Starting a thread needs its id first, so this one path still waits for the API. */
  const startConversation = useCallback(
    async (body: string) => {
      setStarting(true);
      setSendError(null);
      const request: StartChatConversationRequest = {
        kind: composing?.orderNumber ? 'order_support' : 'customer_support',
        ...(composing?.orderNumber ? { orderNumber: composing.orderNumber } : {}),
        ...(composing?.productId ? { productId: composing.productId } : {}),
        ...(composing?.subject ? { subject: composing.subject } : {}),
        body,
      };
      const started = await apiPost<ChatConversationDetail>({ op: 'start', ...request });
      setStarting(false);
      if (!started.ok) {
        setSignedOut(started.status === 401);
        setSendError(started.message);
        return;
      }
      setDraft('');
      setComposing(null);
      setThread(started.value);
      setThreadState('ready');
      setActiveId(started.value.conversation.id);
      setThreadToken((value) => value + 1);
      void refreshList();
    },
    [composing, refreshList],
  );

  const setStatus = useCallback(
    async (status: 'open' | 'closed') => {
      const conversationId = activeIdRef.current;
      if (conversationId === null) return;
      setStatusBusy(true);
      setSendError(null);
      const result = await apiPost<ChatConversationDetail>({
        op: 'status',
        id: conversationId,
        status,
      });
      setStatusBusy(false);
      if (!result.ok) {
        setSendError(result.message);
        return;
      }
      setThread(result.value);
      setThreadToken((value) => value + 1);
      void refreshList();
    },
    [refreshList],
  );

  /**
   * The one Send action.
   *
   * Everything happens here: the chosen files are uploaded, then the message that carries them is
   * stored. The composer is cleared only after the server confirms, and a failure keeps both the
   * text and the files so the customer can press Retry instead of choosing everything again.
   */
  const submit = useCallback(() => {
    const body = draft.trim();
    // A file on its own is a valid message; text alone still needs to say something.
    if (body === '' && selected.length === 0) return;
    if (sending) return;
    if (activeId === null) {
      void startConversation(body);
      return;
    }
    // The draft and the files are detached from the composer here, so the next message can be
    // written while this one is still travelling. The quote travels with the row, so a retry
    // answers the same message rather than whatever is selected by then.
    const row: Outgoing = {
      clientMessageId: crypto.randomUUID(),
      body,
      files: [...selected],
      fileStates: Object.fromEntries(selected.map((entry) => [entry.localId, QUEUED])),
      reply,
      createdAt: new Date().toISOString(),
      state: 'sending',
      error: null,
    };
    setDraft('');
    setSelected([]);
    setAttachProblems([]);
    setReply(null);
    stopTyping();
    void deliver(row);
  }, [activeId, deliver, draft, reply, selected, sending, startConversation, stopTyping]);

  /**
   * Sends the recording that was previewed. It travels as a message of its own, through the same
   * row as every other file, so it shows progress, reports a failure and can be retried.
   */
  const sendVoice = useCallback(() => {
    if (voice === null || activeId === null || sending) return;
    const entry: SelectedChatFile = {
      localId: crypto.randomUUID(),
      file: new File([voice.blob], voice.fileName, { type: voice.contentType }),
      name: voice.fileName,
      kind: 'audio',
      durationMs: voice.durationMs,
    };
    const row: Outgoing = {
      clientMessageId: crypto.randomUUID(),
      body: '',
      files: [entry],
      fileStates: { [entry.localId]: QUEUED },
      reply,
      createdAt: new Date().toISOString(),
      state: 'sending',
      error: null,
    };
    setVoice(null);
    setVoiceMode(false);
    setReply(null);
    void deliver(row);
  }, [activeId, deliver, reply, sending, voice]);

  /** Walks the reader to a quoted message when it is on screen, and marks it briefly. */
  const jumpToMessage = useCallback((messageId: string) => {
    const target = document.getElementById(`support-message-${messageId}`);
    if (target === null) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.dataset.highlight = 'true';
    setTimeout(() => {
      delete target.dataset.highlight;
    }, 1_600);
  }, []);

  const activeConversation = thread?.conversation ?? null;
  const selfId = thread?.viewer.userId ?? null;
  const seenId = useMemo(
    () => lastSeenCustomerMessageId(messages, teamReadSeq(thread?.participants ?? [], selfId)),
    [messages, selfId, thread],
  );

  const feedbackTarget = useMemo(
    () =>
      feedbackTargetId({
        status: thread?.conversation.status ?? null,
        messages,
        resolvedAt: thread?.conversation.resolvedAt,
        lastCustomerMessageAt: thread?.conversation.lastCustomerMessageAt,
      }),
    [messages, thread],
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPanel}
        // Phones reach the same panel through the tab bar's Chat item, so the floating
        // launcher is desktop-only; its behaviour is unchanged from lg upwards.
        className="fixed right-4 bottom-6 z-40 hidden items-center gap-2 rounded-full bg-primary-action px-4 py-3 text-sm font-semibold text-primary-action-foreground shadow-lg transition hover:bg-primary-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:right-6 lg:flex"
        aria-label={
          unread > 0 ? `Open support chat, ${String(unread)} unread` : 'Open support chat'
        }
      >
        <MessageCircle aria-hidden className="size-5" />
        <span className="hidden sm:inline">Chat with us</span>
        {unread > 0 && (
          <span className="rounded-full bg-offer-badge px-2 py-0.5 text-xs font-bold text-offer-badge-foreground">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
    );
  }

  const inThread = activeId !== null;
  const hasContent = draft.trim() !== '' || selected.length > 0;
  // The microphone replaces Send while there is nothing to send, and only inside a thread:
  // a recording is uploaded to a conversation, which a brand-new question does not have yet.
  const showMic = inThread && !hasContent && !starting;
  const staffOnline = onlineIds.some((id) => id !== selfId);
  const status = activeConversation?.status ?? null;
  const closed = status === 'closed';
  const ordersToOffer = (orders ?? []).filter(
    (order) => order.orderNumber !== composing?.orderNumber,
  );

  return (
    <section
      aria-label="Customer support chat"
      data-expanded={expanded ? 'true' : undefined}
      className={`fixed inset-x-0 bottom-[calc(var(--nz-tabbar-h)+env(safe-area-inset-bottom))] z-50 flex h-[min(84dvh,640px)] flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl sm:inset-x-auto sm:right-6 sm:w-100 sm:rounded-2xl ${
        expanded
          ? 'lg:top-1/2 lg:right-auto lg:bottom-auto lg:left-1/2 lg:h-[min(86dvh,820px)] lg:w-[min(64rem,calc(100%_-_3rem))] lg:-translate-x-1/2 lg:-translate-y-1/2'
          : 'lg:bottom-6 lg:h-[min(88dvh,660px)]'
      }`}
    >
      <header className="flex items-center gap-2 border-b border-border bg-surface px-4 py-3">
        {inThread && (
          <button
            type="button"
            onClick={() => {
              setComposing(null);
              showThread(null);
              void refreshList();
            }}
            className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:size-9 pointer-coarse:size-11"
            aria-label="Back to your conversations"
          >
            <ArrowLeft aria-hidden className="size-4" />
          </button>
        )}
        {inThread ? null : <LogoMark size="sm" decorative className="shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {inThread ? (activeConversation?.subject ?? 'Conversation') : 'Nilzora support'}
            </span>
            {status === null ? null : <StatusChip status={status} />}
          </p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
            {connection === 'live' ? (
              typingName !== null && inThread ? (
                <span className="font-medium text-link">{typingName} is typing…</span>
              ) : (
                <>
                  <span
                    aria-hidden
                    className={
                      staffOnline
                        ? 'size-2 rounded-full bg-success'
                        : 'size-2 rounded-full bg-muted-slate'
                    }
                  />
                  {staffOnline ? 'A teammate is here' : 'Connected'}
                </>
              )
            ) : (
              <>
                <WifiOff aria-hidden className="size-3" />
                {connection === 'connecting' ? 'Connecting…' : 'Offline — your message still sends'}
              </>
            )}
          </p>
        </div>
        {/* Large screens only: a phone keeps the layout it has. */}
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="hidden size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:grid"
          aria-label={expanded ? 'Return to the compact chat window' : 'Expand the chat window'}
          aria-pressed={expanded}
        >
          {expanded ? (
            <Minimize2 aria-hidden className="size-4" />
          ) : (
            <Maximize2 aria-hidden className="size-4" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:size-9 pointer-coarse:size-11"
          aria-label="Close support chat"
        >
          <X aria-hidden className="size-4" />
        </button>
      </header>

      {/* Pinned: the customer always sees which product and order this thread is about,
          however far they scroll. Outside the scroll area, so it cannot scroll away. */}
      {signedOut || !inThread ? null : <ThreadContext detail={thread} />}
      {signedOut || !inThread ? null : <SupportReviewInvite detail={thread} />}

      <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4">
        {signedOut ? (
          <div className="grid justify-items-center gap-3 py-8 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-primary-action/10 text-link">
              <MessageCircle aria-hidden className="size-5" />
            </span>
            <p className="max-w-[30ch] text-sm text-muted-foreground">
              <Link
                href="/login"
                className="font-semibold text-link underline-offset-2 hover:underline"
              >
                Sign in
              </Link>{' '}
              to chat with our team. Your conversations stay in your account.
            </p>
          </div>
        ) : !inThread ? (
          <ConversationList
            state={listState}
            message={listMessage}
            conversations={conversations}
            onRetry={() => void refreshList()}
            onOpen={(conversationId) => {
              setComposing(null);
              setThreadState('loading');
              showThread(conversationId);
            }}
          />
        ) : threadState === 'error' ? (
          <div className="grid justify-items-center gap-3 py-8 text-center">
            <p className="flex items-center gap-2 text-sm text-danger">
              <CircleAlert aria-hidden className="size-4" />
              This conversation could not be opened.
            </p>
            <button
              type="button"
              onClick={() => {
                setThreadState('loading');
                setThreadToken((value) => value + 1);
              }}
              className="inline-flex min-h-11 sm:min-h-0 pointer-coarse:min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-surface-muted"
            >
              <RefreshCw aria-hidden className="size-3.5" />
              Try again
            </button>
          </div>
        ) : threadState === 'loading' && messages.length === 0 ? (
          <ChatMessagesSkeleton />
        ) : (
          <>
            {activeId === null ? null : <PinnedNotice conversationId={activeId} />}
            {olderCursor === null ? null : (
              <div className="mb-3 flex justify-center">
                <button
                  type="button"
                  onClick={() => void loadOlder()}
                  disabled={loadingOlder}
                  className="inline-flex min-h-11 sm:min-h-0 pointer-coarse:min-h-11 items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-muted disabled:opacity-60"
                >
                  {loadingOlder ? (
                    <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
                  ) : null}
                  {loadingOlder ? 'Loading…' : 'Show earlier messages'}
                </button>
              </div>
            )}
            {/* One read of the thread's reactions feeds every row; a row never fetches its own. */}
            <ReactionsProvider conversationId={activeId ?? ''} refreshToken={threadToken}>
              <ol>
                {messages.map((message, index) => {
                  const previous = messages[index - 1];
                  const showDay =
                    previous === undefined ||
                    new Date(previous.createdAt).toDateString() !==
                      new Date(message.createdAt).toDateString();
                  // One run of messages from one author reads as a block: no name repeated, and
                  // the bubbles sit closer together.
                  const sameRun =
                    !showDay &&
                    previous !== undefined &&
                    previous.kind !== 'system' &&
                    message.kind !== 'system' &&
                    previous.senderRole === message.senderRole &&
                    previous.senderId === message.senderId;
                  const firstRow = index === 0;
                  return (
                    <li
                      key={message.id}
                      id={`support-message-${message.id}`}
                      data-highlight={undefined}
                      className={`${firstRow ? '' : sameRun ? 'mt-1' : 'mt-3'} rounded-lg transition-colors data-[highlight=true]:bg-warning/15`}
                    >
                      {showDay && (
                        <p className="my-3 text-center text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                          {shortDate(message.createdAt)}
                        </p>
                      )}
                      {isTimelineMessage(message) ? (
                        <p className="text-center">
                          <span className="inline-block rounded-full bg-surface-muted px-3 py-1 text-xs text-muted-foreground">
                            {message.body}
                          </span>
                        </p>
                      ) : (
                        <>
                          <SupportMessage
                            message={message}
                            showName={!sameRun}
                            seen={message.id === seenId}
                            onReply={setReply}
                            onJump={jumpToMessage}
                            onNotice={setNotice}
                            onViewImage={setViewer}
                          />
                          {verdicts !== null && feedbackTarget === message.id ? (
                            <MessageFeedbackPrompt
                              messageId={message.id}
                              verdict={verdicts[message.id] ?? null}
                              onVerdict={(verdict) =>
                                setVerdicts((current) => ({
                                  ...(current ?? {}),
                                  [message.id]: verdict,
                                }))
                              }
                            />
                          ) : null}
                        </>
                      )}
                    </li>
                  );
                })}
                {outbox.map((row) => (
                  <li key={row.clientMessageId} className="mt-3">
                    <OutgoingBubble
                      row={row}
                      onRetry={() => void deliver(row)}
                      onRemove={() => removeRow(row)}
                    />
                  </li>
                ))}
                {typingName !== null && (
                  <li className="mt-2 text-xs text-muted-foreground">{typingName} is typing…</li>
                )}
              </ol>
            </ReactionsProvider>
          </>
        )}
      </div>

      {signedOut ? null : closed ? (
        <div className="grid gap-2 border-t border-border bg-surface-muted/60 p-3">
          {sendError !== null && (
            <p role="alert" className="text-xs text-danger">
              {sendError}
            </p>
          )}
          {activeId === null ? null : (
            <CsatPrompt
              conversationId={activeId}
              rating={thread?.conversation.csatRating ?? null}
            />
          )}
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock aria-hidden className="size-3.5 shrink-0" />
            This conversation is closed. Reopen it to write again, or start a new one.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={statusBusy}
              onClick={() => void setStatus('open')}
              className="inline-flex min-h-11 sm:min-h-0 pointer-coarse:min-h-11 items-center gap-1.5 rounded-lg bg-primary-action px-3 py-2 text-xs font-semibold text-primary-action-foreground hover:bg-primary-action-hover disabled:opacity-60"
            >
              {statusBusy ? (
                <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw aria-hidden className="size-3.5" />
              )}
              Reopen conversation
            </button>
            <button
              type="button"
              onClick={() => {
                setComposing({});
                showThread(null);
              }}
              className="inline-flex min-h-11 sm:min-h-0 pointer-coarse:min-h-11 items-center rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-surface"
            >
              New conversation
            </button>
          </div>
        </div>
      ) : (
        <form
          className="border-t border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {sendError !== null && (
            <p role="alert" className="mb-2 text-xs text-danger">
              {sendError}
            </p>
          )}
          {notice === null ? null : (
            <p
              role="status"
              className="mb-2 rounded-lg bg-surface-muted px-2.5 py-1.5 text-xs text-foreground"
            >
              {notice}
            </p>
          )}
          {attachProblems.length === 0 ? null : (
            <ul role="alert" className="mb-2 grid gap-0.5 text-xs text-danger">
              {attachProblems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
          {reply === null ? null : <ReplyTargetBar reply={reply} onCancel={() => setReply(null)} />}
          {draft.trim() === '' && selected.length === 0 && !voiceMode ? (
            <QuickReplies disabled={starting} onPick={(question) => setDraft(question)} />
          ) : null}
          {inThread && activeId !== null ? (
            <div className="mb-2 grid gap-2">
              {status === 'resolved' ? (
                <>
                  <CsatPrompt
                    conversationId={activeId}
                    rating={thread?.conversation.csatRating ?? null}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Our team marked this resolved. Reply here if you still need help.
                  </p>
                </>
              ) : null}
              <SelectedFileList
                selected={selected}
                disabled={starting || sending}
                onRemove={(localId) => {
                  setSelected((current) => current.filter((entry) => entry.localId !== localId));
                  setAttachProblems([]);
                }}
                onClear={() => {
                  setSelected([]);
                  setAttachProblems([]);
                }}
              />
            </div>
          ) : (
            <NewConversationContext
              composing={composing}
              orders={ordersToOffer}
              onOrder={(orderNumber) =>
                setComposing((current) => {
                  const base = { ...(current ?? {}) };
                  delete base.orderNumber;
                  delete base.subject;
                  return orderNumber === null ? base : { ...base, orderNumber };
                })
              }
              onClearProduct={() =>
                setComposing((current) => {
                  const base = { ...(current ?? {}) };
                  delete base.productId;
                  delete base.subject;
                  return base;
                })
              }
            />
          )}
          {voiceMode ? (
            <div
              role="group"
              aria-label="Voice message"
              className="rounded-lg border border-border bg-surface p-2"
            >
              <VoiceRecorder
                autoStart
                disabled={sending}
                onRecorded={setVoice}
                onSend={sendVoice}
                onDiscard={() => {
                  setVoice(null);
                  setVoiceMode(false);
                }}
              />
            </div>
          ) : (
            <div className="flex items-end gap-1.5">
              {inThread && activeId !== null ? (
                <AttachMenuButton
                  count={selected.length}
                  disabled={starting || sending}
                  onProblems={setAttachProblems}
                  onAdd={(added) => {
                    setSelected((current) => [
                      ...current,
                      ...added.map((entry) => ({
                        localId: crypto.randomUUID(),
                        file: entry.file,
                        name: entry.file.name,
                        kind: chatMediaKindOf(entry.file.type) ?? 'document',
                        durationMs: entry.durationMs,
                      })),
                    ]);
                  }}
                />
              ) : null}
              <label htmlFor="support-message" className="sr-only">
                Message
              </label>
              <textarea
                id="support-message"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  if (inThread) announceTyping();
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void submit();
                  }
                }}
                rows={1}
                maxLength={4000}
                placeholder={inThread ? 'Write a reply…' : 'Ask us anything about Nilzora'}
                className="max-h-28 min-h-11 flex-1 sm:min-h-10 pointer-coarse:min-h-11 resize-none rounded-lg border border-input-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              />
              {/* Nothing to send: the microphone. Text or a file: Send. Clearing it brings the
                  microphone back. Only an explicit press here ever asks for the microphone. */}
              {showMic ? (
                <button
                  type="button"
                  onClick={() => setVoiceMode(true)}
                  disabled={sending}
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg sm:size-10 pointer-coarse:size-11 bg-surface-muted text-foreground transition hover:bg-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Record a voice message"
                >
                  <Mic aria-hidden className="size-5" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={starting || sending || !hasContent}
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg sm:size-10 pointer-coarse:size-11 bg-primary-action text-primary-action-foreground transition hover:bg-primary-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Send message"
                >
                  {starting || sending ? (
                    <LoaderCircle aria-hidden className="size-4 animate-spin" />
                  ) : (
                    <Send aria-hidden className="size-4" />
                  )}
                </button>
              )}
            </div>
          )}
        </form>
      )}
      <ChatImageLightbox image={viewer} onClose={() => setViewer(null)} />
    </section>
  );
}

/**
 * What the open thread is about, pinned above the messages so it stays visible while the
 * customer scrolls. It is deliberately one short row: the picture, the product, the variant
 * that was bought and the order it came from. When a thread is about an order with several
 * products, the order's own lines are shown as a small stack, so the product under discussion
 * is identifiable rather than guessed. A thread with no order and no product renders nothing,
 * and the panel never shows the previous conversation's context because it is built from the
 * conversation that is open right now.
 */
function ThreadContext({ detail }: { detail: ChatConversationDetail | null }) {
  if (detail === null) return null;
  const { order, product } = detail;
  if (order === null && product === null) return null;

  // The line this thread is about, and (for an order) its other lines as small pictures.
  const lines = order?.items ?? [];
  const main = product
    ? {
        name: product.name,
        variant: product.variantLabel,
        image: product.image,
        href: `/products/${product.slug}` as Route,
      }
    : (() => {
        const [first] = lines;
        if (!first) {
          return { name: `Order ${order?.number ?? ''}`, variant: null, image: null, href: null };
        }
        return {
          name: first.name,
          variant: first.variantLabel,
          image: first.image,
          href: null,
        };
      })();
  const others = product ? lines.filter((line) => line.productId !== product.id) : [];

  return (
    <div className="border-b border-border bg-surface-muted/70 px-4 py-2">
      <div className="flex items-center gap-3">
        <div className="shrink-0">
          <ProductImage
            image={main.image}
            productName={main.name}
            variant="thumb"
            decorative
            size="sm"
            className="size-10"
          />
        </div>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="truncate text-xs font-semibold text-foreground">{main.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {main.variant ? `${main.variant} · ` : ''}
            {order !== null
              ? `Order ${order.number}`
              : product !== null
                ? money(product.priceMinor)
                : ''}
          </p>
        </div>
        {others.length > 0 ? (
          <div className="flex shrink-0 -space-x-2" aria-hidden>
            {others.slice(0, 2).map((line, index) => (
              <ProductImage
                key={`${line.name}-${String(index)}`}
                image={line.image}
                productName={line.name}
                variant="thumb"
                decorative
                size="sm"
                className="size-6 rounded-md ring-2 ring-surface-muted"
              />
            ))}
          </div>
        ) : null}
        {main.href !== null ? (
          <Link
            href={main.href}
            className="inline-flex min-h-11 sm:min-h-0 pointer-coarse:min-h-11 shrink-0 items-center rounded-md px-2 py-1 text-[11px] font-semibold text-link hover:underline"
          >
            View
          </Link>
        ) : order !== null ? (
          <Link
            href={`/account/orders/${encodeURIComponent(order.number)}`}
            className="inline-flex min-h-11 sm:min-h-0 pointer-coarse:min-h-11 shrink-0 items-center rounded-md px-2 py-1 text-[11px] font-semibold text-link hover:underline"
          >
            View
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** The order or product a new question is about, and a way to pick one of the customer's orders. */
function NewConversationContext({
  composing,
  orders,
  onOrder,
  onClearProduct,
}: {
  composing: SupportOpenRequest | null;
  orders: readonly RecentOrder[];
  onOrder: (orderNumber: string | null) => void;
  onClearProduct: () => void;
}) {
  const orderNumber = composing?.orderNumber ?? null;
  const productId = composing?.productId ?? null;
  return (
    <div className="mb-2 grid gap-1.5">
      {orderNumber !== null ? (
        <p className="flex items-center gap-2 rounded-lg bg-surface-muted px-2.5 py-1.5 text-xs text-foreground">
          <Package aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            About order <span className="font-semibold">{orderNumber}</span>
          </span>
          <button
            type="button"
            onClick={() => onOrder(null)}
            aria-label="Do not link an order"
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </p>
      ) : productId !== null ? (
        <p className="flex items-center gap-2 rounded-lg bg-surface-muted px-2.5 py-1.5 text-xs text-foreground">
          <ShoppingBag aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            {composing?.subject ?? 'About this product'}
          </span>
          <button
            type="button"
            onClick={onClearProduct}
            aria-label="Do not link the product"
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </p>
      ) : null}
      {productId === null && orders.length > 0 ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">
            {orderNumber === null ? 'About an order?' : 'Another order?'}
          </span>
          <select
            value=""
            onChange={(event) => {
              if (event.target.value !== '') onOrder(event.target.value);
            }}
            className="min-h-11 sm:min-h-0 pointer-coarse:min-h-11 min-w-0 flex-1 rounded-lg border border-input-border bg-background px-2 py-1 text-xs text-foreground"
          >
            <option value="">Choose one of your orders</option>
            {orders.map((order) => (
              <option key={order.orderNumber} value={order.orderNumber}>
                {order.orderNumber} · {shortDate(order.placedAt)} · {money(order.totalMinor)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

function ConversationList({
  state,
  message,
  conversations,
  onOpen,
  onRetry,
}: {
  state: 'idle' | 'loading' | 'ready' | 'error';
  message: string | null;
  conversations: ChatConversationSummary[];
  onOpen: (conversationId: string) => void;
  onRetry: () => void;
}) {
  if (state === 'loading' || state === 'idle') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle aria-hidden className="size-4 animate-spin" />
        Loading your conversations…
      </p>
    );
  }
  if (state === 'error') {
    return (
      <div className="grid justify-items-start gap-2">
        <p className="text-sm text-muted-foreground">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-11 sm:min-h-0 pointer-coarse:min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-surface-muted"
        >
          <RefreshCw aria-hidden className="size-3.5" />
          Try again
        </button>
      </div>
    );
  }
  if (conversations.length === 0) {
    return (
      <div className="space-y-2 py-6 text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-primary-action/10 text-link">
          <MessageCircle aria-hidden className="size-5" />
        </span>
        <p className="text-sm font-semibold text-foreground">How can we help?</p>
        <p className="mx-auto max-w-[30ch] text-sm text-muted-foreground">
          Write your question below — about an order, a product or anything else. A member of our
          team replies here, and you will see it without reloading.
        </p>
      </div>
    );
  }
  const active = conversations.filter((conversation) => isActiveStatus(conversation.status));
  const earlier = conversations.filter((conversation) => !isActiveStatus(conversation.status));
  return (
    <div className="grid min-w-0 gap-4">
      {active.length === 0 ? null : (
        <ConversationGroup title="Active" items={active} onOpen={onOpen} />
      )}
      {earlier.length === 0 ? null : (
        <ConversationGroup title="Earlier" items={earlier} onOpen={onOpen} />
      )}
      <p className="text-center text-[11px] text-muted-foreground">
        Or write below to start a new conversation.
      </p>
    </div>
  );
}

function ConversationGroup({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: ChatConversationSummary[];
  onOpen: (conversationId: string) => void;
}) {
  return (
    // min-w-0: a grid item defaults to min-width:auto, so a nowrap subject would widen this
    // column past the panel and the row's truncate would never cut it.
    <section aria-label={title} className="min-w-0">
      <h3 className="mb-1 truncate px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <ul className="space-y-0.5">
        {items.map((conversation) => (
          <li key={conversation.id}>
            <button
              type="button"
              onClick={() => onOpen(conversation.id)}
              className="flex min-h-11 w-full items-start gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span
                aria-hidden
                className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary-action/10 text-link"
              >
                {conversation.orderNumber ? (
                  <Package className="size-4" />
                ) : (
                  <MessageCircle className="size-4" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span
                    className={`truncate text-sm text-foreground ${conversation.unreadCount > 0 ? 'font-semibold' : 'font-medium'}`}
                  >
                    {conversation.subject}
                  </span>
                  {conversation.unreadCount > 0 && (
                    <span className="rounded-full bg-primary-action px-1.5 text-[10px] font-bold text-primary-action-foreground">
                      <span className="sr-only">New replies: </span>
                      {conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {listPreview(conversation.lastMessagePreview)}
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <StatusChip status={conversation.status} />
                  {conversation.orderNumber ? (
                    <span className="truncate text-[11px] text-muted-foreground">
                      Order {conversation.orderNumber}
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {shortDate(conversation.lastMessageAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
