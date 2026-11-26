'use client';

import type {
  ChatCsatResponse,
  ChatMessageFeedback,
  ChatPinnedMessage,
  ChatReplySummary,
  ChatSearchHit,
} from '@nilzora/contracts';
import { pinnedPinLabel } from '@nilzora/ui';
import { CircleAlert, LoaderCircle, Pin, Search, Star, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { previewLine, type FeedbackVerdict } from './support-model';
import { type ApiResult } from './support-upload';

/*
 * The support widget's smaller pieces
 * -----------------------------------
 * Pinned messages, the quote strips, message search, the per-reply feedback
 * prompt and the satisfaction prompt. They are separate components so the widget's conversation
 * state stays where it is and each piece can be read on its own. Reactions and the message actions
 * live in `support-reactions.tsx` and `support-message.tsx`.
 *
 * Everything here calls this app's `/api/support` route, so the browser never holds a token.
 */

const UNREACHABLE = 'Nilzora could not be reached. Try again in a moment.';

async function apiGet<T>(query: string): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`/api/support${query}`, { cache: 'no-store' });
    const payload: unknown =
      response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        code: (payload as { error?: { code?: string } } | null)?.error?.code ?? null,
        message:
          (payload as { error?: { message?: string } } | null)?.error?.message ?? UNREACHABLE,
      };
    }
    return { ok: true, value: payload as T };
  } catch {
    return { ok: false, status: 0, code: null, message: UNREACHABLE };
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
    const payload: unknown =
      response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        code: (payload as { error?: { code?: string } } | null)?.error?.code ?? null,
        message:
          (payload as { error?: { message?: string } } | null)?.error?.message ?? UNREACHABLE,
      };
    }
    return { ok: true, value: payload as T };
  } catch {
    return { ok: false, status: 0, code: null, message: UNREACHABLE };
  }
}

/**
 * The quiet "Was this helpful?" row under the last support reply of a finished conversation.
 *
 * Whether it may appear at all is decided by the caller (`feedbackTargetId`, plus the verdict the
 * API already holds for this customer), so this component only asks and records. The answer is Yes
 * or No: there is no free-text note. The verdict shown afterwards is the one the API stored.
 */
export function MessageFeedbackPrompt({
  messageId,
  verdict,
  onVerdict,
}: {
  messageId: string;
  /** The customer's stored verdict for this reply, or null when they have not given one. */
  verdict: FeedbackVerdict | null;
  onVerdict: (verdict: FeedbackVerdict) => void;
}) {
  const [thanked, setThanked] = useState(false);
  const [sending, setSending] = useState<FeedbackVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (next: FeedbackVerdict) => {
      setSending(next);
      setError(null);
      const result = await apiPost<ChatMessageFeedback>({
        op: 'message-feedback',
        messageId,
        verdict: next,
      });
      setSending(null);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setThanked(true);
      onVerdict(
        result.value?.verdict === 'helpful' || result.value?.verdict === 'not_helpful'
          ? result.value.verdict
          : next,
      );
    },
    [messageId, onVerdict],
  );

  // A verdict that was already stored never asks again, on this device or any other.
  if (verdict !== null && !thanked) return null;

  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground"
      data-testid="message-feedback"
    >
      {thanked ? (
        <span role="status">Thanks — your feedback helps us improve.</span>
      ) : (
        <>
          <span>Was this helpful?</span>
          <button
            type="button"
            onClick={() => void send('helpful')}
            disabled={sending !== null}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border px-2.5 sm:min-h-8 sm:min-w-0 pointer-coarse:min-h-11 hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
          >
            👍 Yes
          </button>
          <button
            type="button"
            onClick={() => void send('not_helpful')}
            disabled={sending !== null}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border px-2.5 sm:min-h-8 sm:min-w-0 pointer-coarse:min-h-11 hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
          >
            👎 No
          </button>
        </>
      )}
      {error === null ? null : (
        <p role="alert" className="w-full text-[11px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function PinnedNotice({ conversationId }: { conversationId: string }) {
  const [pins, setPins] = useState<ChatPinnedMessage[]>([]);

  useEffect(() => {
    void (async () => {
      const result = await apiGet<{ messages: ChatPinnedMessage[] }>(
        `?op=pins&id=${conversationId}`,
      );
      setPins(result.ok ? result.value.messages : []);
    })();
  }, [conversationId]);

  if (pins.length === 0) return null;
  return (
    <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
      <p className="flex items-center gap-1 font-semibold">
        <Pin aria-hidden className="size-3" />
        Pinned
      </p>
      <ul className="mt-0.5 grid gap-0.5">
        {pins.map((pin) => (
          <li key={pin.id} className="truncate">
            {pinnedPinLabel(pin)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The quoted message a reply shows above itself.
 *
 * It is one short block, never a copy of the original: the author's name, then the first line of
 * what they wrote — or the name of the file they sent, or "Message unavailable" when it has since
 * been deleted. Pressing it walks the reader to the original when that message is on screen, which
 * is why the list gives every bubble an anchor id.
 */
export function ReplyQuote({
  reply,
  onJump,
  tone = 'incoming',
}: {
  reply: ChatReplySummary;
  onJump?: ((messageId: string) => void) | undefined;
  tone?: 'incoming' | 'outgoing';
}) {
  const who = reply.senderName ?? (reply.senderRole === 'customer' ? 'Customer' : 'Nilzora team');
  const text = previewLine(reply);
  const className =
    tone === 'outgoing'
      ? 'mb-1.5 w-full rounded-lg border-l-2 border-primary-action-foreground/60 bg-primary-action-foreground/10 px-2 py-1 text-left text-[11px] text-primary-action-foreground'
      : 'mb-1.5 w-full rounded-lg border-l-2 border-link/60 bg-surface px-2 py-1 text-left text-[11px] text-muted-foreground';
  const content = (
    <>
      <span className="block font-semibold">{who}</span>
      <span className="block truncate">{text}</span>
    </>
  );
  if (onJump === undefined || reply.deleted) {
    return <div className={className}>{content}</div>;
  }
  return (
    <button
      type="button"
      onClick={() => onJump(reply.id)}
      className={`${className} transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
      aria-label={`Go to the message from ${who}: ${text}`}
    >
      {content}
    </button>
  );
}

/** The composer's "answering this message" strip, with the way out of it. */
export function ReplyTargetBar({
  reply,
  onCancel,
}: {
  reply: ChatReplySummary;
  onCancel: () => void;
}) {
  const who = reply.senderName ?? (reply.senderRole === 'customer' ? 'you' : 'Nilzora team');
  const text = previewLine(reply);
  return (
    <div className="mb-2 flex items-start gap-2 rounded-lg border-l-2 border-link bg-surface-muted px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-foreground">Replying to {who}</p>
        <p className="truncate text-[11px] text-muted-foreground">{text}</p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Stop replying to this message"
        className="rounded p-0.5 text-muted-foreground transition hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}

/** Message-body search inside the customer's own conversations. */ export function MessageSearch({
  onOpen,
}: {
  onOpen: (conversationId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ChatSearchHit[] | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  const search = useCallback(async () => {
    const text = query.trim();
    if (text.length < 2) {
      setHits(null);
      return;
    }
    setState('loading');
    const result = await apiGet<{ hits: ChatSearchHit[] }>(
      `?op=search&q=${encodeURIComponent(text)}`,
    );
    if (result.ok) {
      setHits(result.value.hits);
      setState('idle');
      return;
    }
    setState('error');
    setHits([]);
  }, [query]);

  return (
    <div className="grid gap-1">
      <label className="relative block">
        <span className="sr-only">Search your messages</span>
        <Search aria-hidden className="absolute top-2 left-2 size-3.5 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (event.target.value.trim() === '') setHits(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void search();
          }}
          placeholder="Search your messages"
          className="w-full rounded-md border border-input-border bg-surface py-1.5 pr-2 pl-7 text-xs text-foreground"
        />
      </label>
      {state === 'loading' ? <p className="text-[11px] text-muted-foreground">Searching…</p> : null}
      {state === 'error' ? (
        <p className="flex items-center gap-1 text-[11px] text-danger">
          <CircleAlert aria-hidden className="size-3" />
          Search is unavailable right now.
        </p>
      ) : null}
      {hits === null ? null : hits.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No message matches that word.</p>
      ) : (
        <ul className="grid max-h-32 gap-0.5 overflow-y-auto">
          {hits.map((hit) => (
            <li key={hit.messageId}>
              <button
                type="button"
                onClick={() => onOpen(hit.conversationId)}
                className="w-full truncate rounded px-1.5 py-1 text-left text-[11px] hover:bg-surface-muted"
              >
                <span className="font-medium text-foreground">{hit.conversationSubject}</span>{' '}
                <span className="text-muted-foreground">{hit.body}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The satisfaction prompt.
 *
 * It appears only for a resolved conversation the customer has not rated, which is the
 * lifecycle point the database accepts: rating an open thread is refused with
 * `rating_not_open`, and a second rating is ignored rather than overwriting the first.
 */
export function CsatPrompt({
  conversationId,
  rating,
}: {
  conversationId: string;
  rating: number | null;
}) {
  const [sent, setSent] = useState<ChatCsatResponse | null>(null);
  const [comment, setComment] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (value: number) => {
      setState('sending');
      setError(null);
      const result = await apiPost<ChatCsatResponse>({
        op: 'rating',
        conversationId,
        rating: value,
        comment: comment.trim() === '' ? undefined : comment.trim(),
      });
      if (!result.ok) {
        setError(result.message);
        setState('error');
        return;
      }
      setSent(result.value);
      setState('idle');
    },
    [comment, conversationId],
  );

  if (sent !== null) {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900">
        Thank you — your rating was saved.
      </p>
    );
  }
  if (rating !== null) return null;

  return (
    <div className="rounded-lg border border-border bg-surface-muted px-2.5 py-2 text-xs">
      <p className="font-medium text-foreground">How did we do?</p>
      <div className="mt-1 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            disabled={state === 'sending'}
            aria-label={`${String(value)} out of 5`}
            onClick={() => void submit(value)}
            className="grid size-11 shrink-0 place-items-center rounded text-amber-500 hover:bg-surface disabled:opacity-50 sm:size-8 pointer-coarse:size-11"
          >
            <Star aria-hidden className="size-4" />
          </button>
        ))}
        {state === 'sending' ? (
          <LoaderCircle aria-hidden className="size-3.5 animate-spin text-muted-foreground" />
        ) : null}
      </div>
      <label className="mt-1 grid gap-0.5">
        <span className="sr-only">Anything you would add (optional)</span>
        <input
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          maxLength={500}
          placeholder="Anything to add (optional)"
          className="rounded border border-input-border bg-surface px-1.5 py-1 text-[11px] text-foreground"
        />
      </label>
      {error === null ? null : (
        <p role="alert" className="mt-1 text-[11px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
