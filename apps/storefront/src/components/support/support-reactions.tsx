'use client';

import type { ChatReactionResponse, ChatReactionSummaryItem } from '@nilzora/contracts';
import { CHAT_REACTIONS, chatReactionLabel } from '@nilzora/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { moveFocusWithKeys, useRovingItems } from './support-keyboard';
import { REACTION_TARGET } from './support-placement';

/*
 * Reactions for the open thread
 * -----------------------------
 * One read for the whole thread (`?op=reactions&id=`) feeds every message row through context:
 * a row never fetches on its own, so a thread of 40 messages costs one request, not 40.
 *
 * A press is applied to the screen at once and then replaced by what the API answered. If the API
 * refuses, the row goes back to exactly what it showed before and says why. While one message's
 * press is in flight that message accepts no second one, so a double tap cannot post twice.
 */

type ByMessage = Readonly<Record<string, readonly ChatReactionSummaryItem[]>>;

const UNREACHABLE = 'Nilzora could not be reached. Try again in a moment.';

/** The result of one toggle, applied to the rows of a single message without touching the others. */
export function applyToggle(
  items: readonly ChatReactionSummaryItem[],
  messageId: string,
  emoji: string,
): ChatReactionSummaryItem[] {
  const mine = items.find((item) => item.mine);
  // Whatever the account reacted with before is taken back; the same emoji again stops there.
  const withoutMine = items
    .map((item) => (item.mine ? { ...item, count: item.count - 1, mine: false } : item))
    .filter((item) => item.count > 0);
  if (mine?.emoji === emoji) return withoutMine;
  const existing = withoutMine.find((item) => item.emoji === emoji);
  if (existing !== undefined) {
    return withoutMine.map((item) =>
      item.emoji === emoji ? { ...item, count: item.count + 1, mine: true } : item,
    );
  }
  return [...withoutMine, { messageId, emoji, count: 1, mine: true }];
}

/** The API's answer for one message, as rows: every tally, and the caller's own when it was added. */
export function rowsFromResponse(response: ChatReactionResponse): ChatReactionSummaryItem[] {
  return response.summary
    .filter((tally) => tally.count > 0)
    .map((tally) => ({
      messageId: response.messageId,
      emoji: tally.emoji,
      count: tally.count,
      mine: response.added && tally.emoji === response.emoji,
    }));
}

function group(rows: readonly ChatReactionSummaryItem[]): ByMessage {
  const grouped: Record<string, ChatReactionSummaryItem[]> = {};
  for (const row of rows) (grouped[row.messageId] ??= []).push(row);
  return grouped;
}

interface ReactionsValue {
  forMessage: (messageId: string) => readonly ChatReactionSummaryItem[];
  isBusy: (messageId: string) => boolean;
  errorFor: (messageId: string) => string | null;
  toggle: (messageId: string, emoji: string) => Promise<void>;
}

const EMPTY: readonly ChatReactionSummaryItem[] = [];
const ReactionsContext = createContext<ReactionsValue | null>(null);

export function useReactions(): ReactionsValue {
  const value = useContext(ReactionsContext);
  if (value === null) throw new Error('useReactions needs a ReactionsProvider');
  return value;
}

export function ReactionsProvider({
  conversationId,
  refreshToken,
  children,
}: {
  conversationId: string;
  /** Bumped when a realtime update says something changed: the one read is repeated. */
  refreshToken: number;
  children: ReactNode;
}) {
  const [byMessage, setByMessage] = useState<ByMessage>({});
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const inFlight = useRef(new Set<string>());
  const current = useRef<ByMessage>({});
  // A read that started before a press must not overwrite what that press just answered.
  const writes = useRef(0);

  useEffect(() => {
    current.current = byMessage;
  }, [byMessage]);

  useEffect(() => {
    let cancelled = false;
    const startedAt = writes.current;
    void (async () => {
      try {
        const response = await fetch(`/api/support?op=reactions&id=${conversationId}`, {
          cache: 'no-store',
        });
        if (!response.ok) return;
        const payload = (await response.json().catch(() => null)) as {
          reactions?: ChatReactionSummaryItem[];
        } | null;
        if (cancelled || writes.current !== startedAt || !Array.isArray(payload?.reactions)) return;
        setByMessage(group(payload.reactions));
      } catch {
        // Reactions are decoration: a failed read leaves the row as it was.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, refreshToken]);

  const toggle = useCallback(
    async (messageId: string, emoji: string) => {
      if (inFlight.current.has(messageId)) return;
      inFlight.current.add(messageId);
      writes.current += 1;
      const before = current.current[messageId] ?? EMPTY;
      setBusy((set) => new Set(set).add(messageId));
      setErrors((map) => {
        const { [messageId]: _cleared, ...rest } = map;
        return rest;
      });
      setByMessage((map) => ({ ...map, [messageId]: applyToggle(before, messageId, emoji) }));
      try {
        const response = await fetch('/api/support', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'react', conversationId, messageId, emoji }),
          cache: 'no-store',
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            (payload as { error?: { message?: string } } | null)?.error?.message ?? UNREACHABLE,
          );
        }
        const answer = payload as ChatReactionResponse | null;
        if (answer === null || !Array.isArray(answer.summary)) throw new Error(UNREACHABLE);
        writes.current += 1;
        setByMessage((map) => ({ ...map, [messageId]: rowsFromResponse(answer) }));
      } catch (error) {
        // Back to exactly what was there, with the reason beside it.
        setByMessage((map) => ({ ...map, [messageId]: before }));
        setErrors((map) => ({
          ...map,
          [messageId]:
            error instanceof Error && error.message !== '' && error.message !== 'Failed to fetch'
              ? `Your reaction was not saved. ${error.message}`
              : `Your reaction was not saved. ${UNREACHABLE}`,
        }));
      } finally {
        inFlight.current.delete(messageId);
        setBusy((set) => {
          const next = new Set(set);
          next.delete(messageId);
          return next;
        });
      }
    },
    [conversationId],
  );

  const value = useMemo<ReactionsValue>(
    () => ({
      forMessage: (messageId) => byMessage[messageId] ?? EMPTY,
      isBusy: (messageId) => busy.has(messageId),
      errorFor: (messageId) => errors[messageId] ?? null,
      toggle,
    }),
    [busy, byMessage, errors, toggle],
  );

  return <ReactionsContext.Provider value={value}>{children}</ReactionsContext.Provider>;
}

/** The counts under a bubble. Pressing one is the same as choosing it in the bar. */
export function ReactionSummaryRow({
  messageId,
  align,
}: {
  messageId: string;
  align: 'start' | 'end';
}) {
  const reactions = useReactions();
  const rows = reactions.forMessage(messageId);
  const error = reactions.errorFor(messageId);
  const busy = reactions.isBusy(messageId);
  if (rows.length === 0 && error === null) return null;
  return (
    <div
      className={`mt-0.5 flex flex-wrap items-center gap-x-1 text-xs ${align === 'end' ? 'justify-end' : 'justify-start'}`}
    >
      {rows.map((item) => (
        <button
          key={item.emoji}
          type="button"
          disabled={busy}
          aria-label={`${chatReactionLabel(item.emoji)}: ${String(item.count)}${item.mine ? ', your reaction' : ''}`}
          aria-pressed={item.mine}
          onClick={() => void reactions.toggle(messageId, item.emoji)}
          className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full border px-3 leading-none transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60 ${
            item.mine
              ? 'border-link bg-primary-action/10 text-foreground'
              : 'border-border bg-surface text-muted-foreground'
          }`}
        >
          <span aria-hidden>{item.emoji}</span>
          <span aria-hidden>{item.count}</span>
        </button>
      ))}
      {error === null ? null : (
        <span role="alert" className="text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * The compact bar of reactions shown beside a pressed message. It only draws and reports a choice:
 * placement, dismissal and the request belong to the overlay and the store.
 */
export function ReactionBar({
  messageId,
  onChoose,
  columns = CHAT_REACTIONS.length,
}: {
  messageId: string;
  onChoose: (emoji: string) => void;
  /**
   * How many 44 px buttons fit across: the bar wraps into a grid of that many columns, so every
   * target keeps its full size on a narrow screen. Defaults to a single row.
   */
  columns?: number;
}) {
  const reactions = useReactions();
  const mine = reactions.forMessage(messageId).find((item) => item.mine)?.emoji ?? null;
  const busy = reactions.isBusy(messageId);
  const root = useRef<HTMLDivElement | null>(null);
  const onRovingFocus = useRovingItems(root);
  return (
    <div
      ref={root}
      role="toolbar"
      aria-label="React to this message"
      onFocus={onRovingFocus}
      onKeyDown={(event) => moveFocusWithKeys(event, 'grid', columns)}
      data-columns={columns}
      style={{ gridTemplateColumns: `repeat(${String(columns)}, ${String(REACTION_TARGET)}px)` }}
      className={`grid w-max border border-border bg-background p-1 shadow-lg ${
        columns >= CHAT_REACTIONS.length ? 'rounded-full' : 'rounded-2xl'
      }`}
    >
      {CHAT_REACTIONS.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          disabled={busy}
          aria-label={reaction.label}
          aria-pressed={mine === reaction.emoji}
          title={reaction.label}
          onClick={() => onChoose(reaction.emoji)}
          className={`grid size-11 place-items-center rounded-full text-xl leading-none transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-50 ${
            mine === reaction.emoji ? 'bg-primary-action/15 ring-2 ring-link' : ''
          }`}
        >
          <span aria-hidden>{reaction.emoji}</span>
        </button>
      ))}
    </div>
  );
}
