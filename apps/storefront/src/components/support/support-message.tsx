'use client';

import type { ChatMessage, ChatReplySummary, ChatReportReason } from '@nilzora/contracts';
import { CHAT_REACTIONS, CHAT_REPORT_REASONS } from '@nilzora/contracts';
import {
  ChatAttachmentList,
  copyToClipboard,
  formatBytes,
  type ChatImageViewerImage,
} from '@nilzora/ui';
import {
  CheckCheck,
  CornerUpLeft,
  Copy,
  Eye,
  FileText,
  Flag,
  LoaderCircle,
  Mic,
  MoreHorizontal,
  SmilePlus,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { chatMediaUrl } from '@/lib/chat-media';
import { ReplyQuote } from './support-extras';
import { SwipeToReply } from './support-swipe';
import {
  computePlacement,
  overlayMaxHeight,
  reactionGrid,
  type Placement,
} from './support-placement';
import { focusableItems, moveFocusWithKeys, tabStopOf, useRovingItems } from './support-keyboard';
import { canReportMessage, isReactable, visibleBody } from './support-model';
import { ReactionBar, ReactionSummaryRow, useReactions } from './support-reactions';
import { type Outgoing } from './support-upload';
import { useObjectUrl } from './use-object-url';

/*
 * One message in the thread
 * -------------------------
 * The bubble, the two small controls beside it (react, more) and the floating reaction bar and
 * actions menu they open. On a touch screen a long press opens both together. Both float in a
 * portal with fixed coordinates, so the thread's scroller can never clip them.
 */

export function clockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** Who a message is from, in words a customer recognises. */
export function senderLabel(message: ChatMessage): string {
  if (message.senderName !== null && message.senderName !== '') return message.senderName;
  if (message.kind === 'automated') return 'Nilzora Assistant';
  if (message.senderRole === 'moderator') return 'Nilzora moderation';
  return 'Nilzora team';
}

/** The leaf a reply quotes when the message being answered is already on screen. */
export function quoteOf(message: ChatMessage): ChatReplySummary {
  return {
    id: message.id,
    seq: message.seq,
    senderId: message.senderId,
    senderRole: message.senderRole,
    senderName: message.senderName,
    kind: message.kind,
    body: visibleBody(message) === '' ? null : message.body,
    hasAttachment: (message.attachments ?? []).length > 0,
    deleted: false,
  };
}

export const REPORT_REASON_LABEL: Record<ChatReportReason, string> = {
  spam: 'Spam or unwanted',
  abuse: 'Abusive or offensive',
  personal_information: 'Shares personal information',
  other: 'Something else',
};

// ---------------------------------------------------------------------------------------------
// Long press
// ---------------------------------------------------------------------------------------------

const LONG_PRESS_MS = 480;
const LONG_PRESS_SLOP_PX = 10;

/** A touch or pen held in place. A mouse never long-presses: it has hover and right-click. */
export function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const touching = useRef(false);
  const latest = useRef(onLongPress);
  useEffect(() => {
    latest.current = onLongPress;
  }, [onLongPress]);

  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);
  useEffect(() => clear, [clear]);

  return {
    onPointerDown: (event: ReactPointerEvent) => {
      if (event.pointerType === 'mouse') return;
      touching.current = true;
      fired.current = false;
      clear();
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        latest.current();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: ReactPointerEvent) => {
      const start = origin.current;
      if (start === null) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_SLOP_PX)
        clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    // Android turns a long press into a context menu; ours replaces it.
    onContextMenu: (event: { preventDefault: () => void }) => {
      if (touching.current || fired.current) event.preventDefault();
    },
    // The release that ends a long press must not also be read as a tap on a link inside.
    onClickCapture: (event: { preventDefault: () => void; stopPropagation: () => void }) => {
      if (!fired.current) return;
      fired.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The floating layer
// ---------------------------------------------------------------------------------------------

export interface OverlayPlacement {
  /** Where the stacked bar + menu sit as one unit. */
  unit: Placement;
  columns: number;
  maxHeight: number;
}

const OVERLAY_MARGIN = 12;

function viewportSize(): { width: number; height: number } {
  // The visual viewport follows the on-screen keyboard and pinch zoom; fall back to the layout one.
  const visual = window.visualViewport;
  return {
    width: Math.round(visual?.width ?? window.innerWidth),
    height: Math.round(visual?.height ?? window.innerHeight),
  };
}

/**
 * The reaction bar and the actions menu, drawn as one stacked unit. They are placed together, so
 * they can never overlap each other; on a viewport too short for both, the menu scrolls inside
 * the unit instead of running off the screen.
 */
function MessageOverlay({
  anchor,
  side,
  bar,
  menu,
  onClose,
}: {
  anchor: HTMLElement;
  /** Which side of the thread the bubble is on, so the unit lines up with it. */
  side: 'start' | 'end';
  /** Receives the number of 44 px columns that fit, so the bar can wrap on a narrow screen. */
  bar: ((columns: number) => ReactNode) | null;
  menu: ReactNode | null;
  onClose: (restoreFocus: boolean) => void;
}) {
  const unitRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<OverlayPlacement | null>(null);
  const hasBar = bar !== null;

  const measure = useCallback(() => {
    const unit = unitRef.current;
    if (unit === null) return;
    const rect = anchor.getBoundingClientRect();
    const box = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
    const viewport = viewportSize();
    const columns = reactionGrid({
      count: CHAT_REACTIONS.length,
      viewportWidth: viewport.width,
      margin: OVERLAY_MARGIN,
    }).columns;
    const maxHeight = overlayMaxHeight(viewport.height, OVERLAY_MARGIN);
    const size = unit.getBoundingClientRect();
    const unitPlacement = computePlacement({
      anchor: box,
      popup: { width: size.width, height: Math.min(size.height, maxHeight) },
      viewport,
      align: side,
      margin: OVERLAY_MARGIN,
      prefer: hasBar ? 'above' : 'below',
    });
    // Same answer as before: no state change, so no extra render.
    setPlacement((previous) =>
      previous !== null &&
      previous.columns === columns &&
      previous.maxHeight === maxHeight &&
      previous.unit.top === unitPlacement.top &&
      previous.unit.left === unitPlacement.left &&
      previous.unit.side === unitPlacement.side
        ? previous
        : { columns, maxHeight, unit: unitPlacement },
    );
  }, [anchor, hasBar, side]);

  // Before paint, so the first frame is already in place and never jumps. A second pass runs
  // when the column count changed the bar's height.
  useLayoutEffect(() => {
    measure();
  }, [measure, bar, menu, placement?.columns]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose(true);
        return;
      }
      if (event.key !== 'Tab') return;
      // The layer is at the end of <body>, so the natural Tab order would walk out of it (or never
      // enter it). Tab instead cycles through its widgets, the bar then the menu, and stays there
      // until the layer closes. From outside (focus still on the trigger) it moves in.
      const stops: { region: HTMLElement; stop: HTMLElement }[] = [];
      for (const region of [barRef.current, menuRef.current]) {
        const stop = tabStopOf(region);
        if (region !== null && stop !== null) stops.push({ region, stop });
      }
      if (stops.length === 0) return;
      event.preventDefault();
      const active = document.activeElement;
      const at = stops.findIndex((entry) => entry.region.contains(active));
      const step = event.shiftKey ? -1 : 1;
      const next =
        at === -1
          ? event.shiftKey
            ? stops.length - 1
            : 0
          : (at + step + stops.length) % stops.length;
      stops[next]?.stop.focus({ preventScroll: true });
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target === null) return;
      if (unitRef.current?.contains(target)) return;
      // The control that opened the layer toggles it itself; closing here first would make its
      // click open it again.
      if (
        target instanceof Element &&
        target.closest('button[aria-haspopup][aria-expanded="true"]') !== null
      )
        return;
      onClose(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    // The thread scrolls under the overlay: follow the bubble instead of leaving a stray bar.
    window.addEventListener('scroll', measure, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure, onClose]);

  // Keyboard users land inside the layer that opened. The layer is `visibility: hidden` until it
  // has been measured, and a hidden element cannot take focus, so this waits for the placed,
  // visible commit (a layout effect, so before paint) instead of running on mount.
  const placed = placement !== null;
  const landed = useRef(false);
  useLayoutEffect(() => {
    if (!placed || landed.current) return;
    landed.current = true;
    const first = focusableItems(menuRef.current ?? barRef.current)[0];
    first?.focus({ preventScroll: true });
  }, [placed]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={unitRef}
      data-testid="message-overlay-layer"
      style={{
        position: 'fixed',
        top: placement?.unit.top ?? 0,
        left: placement?.unit.left ?? 0,
        maxHeight: placement?.maxHeight,
        // Hidden until measured, so nothing flashes at the corner of the screen.
        visibility: placement === null ? 'hidden' : 'visible',
      }}
      className={`z-70 flex w-max max-w-[calc(100vw-24px)] flex-col gap-1.5 ${side === 'end' ? 'items-end' : 'items-start'}`}
    >
      {bar === null ? null : (
        <div ref={barRef} data-testid="reaction-bar-layer" className="shrink-0">
          {bar(placement?.columns ?? CHAT_REACTIONS.length)}
        </div>
      )}
      {menu === null ? null : (
        <div
          ref={menuRef}
          data-testid="message-menu-layer"
          className="min-h-0 overflow-y-auto overscroll-contain rounded-xl"
        >
          {menu}
        </div>
      )}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------------------------
// The actions menu
// ---------------------------------------------------------------------------------------------

const MENU_ITEM =
  'flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-foreground hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:opacity-60';

function MessageMenu({
  message,
  onReply,
  onNotice,
  onViewImage,
  onClose,
}: {
  message: ChatMessage;
  onReply: (reply: ChatReplySummary) => void;
  onNotice: (text: string) => void;
  onViewImage: (image: ChatImageViewerImage) => void;
  /** `restoreFocus` is false when something else (the composer, the picture viewer) takes focus. */
  onClose: (restoreFocus: boolean) => void;
}) {
  const [reporting, setReporting] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const onRovingFocus = useRovingItems(rootRef);
  // Switching between the actions and the report reasons replaces every item; the one that was
  // focused is gone, so focus would fall to <body> and out of the overlay's reach.
  const switched = useRef(false);
  useLayoutEffect(() => {
    if (!switched.current) {
      switched.current = true;
      return;
    }
    focusableItems(rootRef.current)[0]?.focus({ preventScroll: true });
  }, [reporting, rootRef]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = visibleBody(message);
  const files = (message.attachments ?? []).filter((attachment) => attachment.url !== null);

  const report = async (reason: ChatReportReason) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'report', messageId: message.id, reason }),
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(payload?.error?.message ?? 'The report could not be sent. Try again.');
        return;
      }
      onNotice('Thanks — your report was sent to our team.');
      onClose(true);
    } catch {
      setError('Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (reporting) {
    return (
      <div
        ref={rootRef}
        role="menu"
        aria-label="Report this message"
        onFocus={onRovingFocus}
        onKeyDown={(event) => moveFocusWithKeys(event, 'vertical')}
        className="w-60 overflow-hidden rounded-xl border border-border bg-background shadow-lg"
      >
        <p className="border-b border-border px-3 py-2 text-xs font-semibold text-foreground">
          Why are you reporting this?
        </p>
        {CHAT_REPORT_REASONS.map((reason) => (
          <button
            key={reason}
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => void report(reason)}
            className={MENU_ITEM}
          >
            {REPORT_REASON_LABEL[reason]}
          </button>
        ))}
        {error === null ? null : (
          <p role="alert" className="px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setReporting(false);
            setError(null);
          }}
          className={`${MENU_ITEM} border-t border-border text-muted-foreground`}
        >
          {busy ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null}
          Back
        </button>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label="Message actions"
      onFocus={onRovingFocus}
      onKeyDown={(event) => moveFocusWithKeys(event, 'vertical')}
      className="w-52 overflow-hidden rounded-xl border border-border bg-background shadow-lg"
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onReply(quoteOf(message));
          onClose(false);
        }}
        className={MENU_ITEM}
      >
        <CornerUpLeft aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        Reply
      </button>
      {text === '' ? null : (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            void copyToClipboard(text).then((copied) => {
              onNotice(copied ? 'Message copied.' : 'Copying is not available in this browser.');
            });
            onClose(true);
          }}
          className={MENU_ITEM}
        >
          <Copy aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          Copy
        </button>
      )}
      {files.map((attachment) => {
        const url = chatMediaUrl(attachment.url ?? '');
        const label = files.length === 1 ? 'View attachment' : `View ${attachment.fileName}`;
        if (attachment.contentType.startsWith('image/')) {
          return (
            <button
              key={attachment.id}
              type="button"
              role="menuitem"
              onClick={() => {
                onViewImage({ url, name: attachment.fileName });
                onClose(false);
              }}
              className={MENU_ITEM}
            >
              <Eye aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{label}</span>
            </button>
          );
        }
        return (
          <a
            key={attachment.id}
            role="menuitem"
            href={url}
            download={attachment.fileName}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              onClose(true);
            }}
            className={MENU_ITEM}
          >
            <Eye aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{label}</span>
          </a>
        );
      })}
      {canReportMessage(message) ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => setReporting(true)}
          className={`${MENU_ITEM} border-t border-border`}
        >
          <Flag aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          Report
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// A stored message
// ---------------------------------------------------------------------------------------------

type OverlayMode = 'react' | 'menu' | 'both';

/** What is open, and the bubble it is anchored to (read when it opened, never during render). */
interface OpenOverlay {
  mode: OverlayMode;
  anchor: HTMLElement;
}

const SIDE_BUTTON =
  'grid size-11 shrink-0 place-items-center self-end rounded-full text-muted-foreground transition hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:sr-only';

export function SupportMessage({
  message,
  showName,
  seen,
  onReply,
  onJump,
  onNotice,
  onViewImage,
}: {
  message: ChatMessage;
  showName: boolean;
  seen: boolean;
  onReply: (reply: ChatReplySummary) => void;
  onJump: (messageId: string) => void;
  onNotice: (text: string) => void;
  onViewImage: (image: ChatImageViewerImage) => void;
}) {
  const mine = message.senderRole === 'customer';
  const reactable = isReactable(message);
  const reactions = useReactions();
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const reactTrigger = useRef<HTMLButtonElement | null>(null);
  const moreTrigger = useRef<HTMLButtonElement | null>(null);
  const [overlay, setOverlay] = useState<OpenOverlay | null>(null);
  const [lastTrigger, setLastTrigger] = useState<'react' | 'more' | null>(null);

  const body = visibleBody(message);
  const attachments = message.attachments ?? [];
  // Pictures, voice messages and files sit on a neutral surface with a thin border on both sides:
  // the accent fill behind a waveform or a file card reads as a heavy block.
  const filled = mine && attachments.length === 0;
  const pressing = useLongPress(() => {
    setLastTrigger(null);
    if (bubbleRef.current !== null) {
      setOverlay({ mode: reactable ? 'both' : 'menu', anchor: bubbleRef.current });
    }
  });

  const close = useCallback(
    (restoreFocus: boolean) => {
      setOverlay(null);
      if (restoreFocus) {
        (lastTrigger === 'react' ? reactTrigger.current : moreTrigger.current)?.focus();
      }
    },
    [lastTrigger],
  );

  const toggle = (mode: OverlayMode) => {
    const anchor = bubbleRef.current;
    if (anchor === null) return;
    setOverlay((current) => (current?.mode === mode ? null : { mode, anchor }));
  };

  const reactButton = reactable ? (
    <button
      ref={reactTrigger}
      type="button"
      aria-haspopup="true"
      aria-expanded={overlay?.mode === 'react'}
      aria-label={`React to the message from ${senderLabel(message)}`}
      onClick={() => {
        setLastTrigger('react');
        toggle('react');
      }}
      className={SIDE_BUTTON}
    >
      <SmilePlus aria-hidden className="size-4" />
    </button>
  ) : null;
  const moreButton = (
    <button
      ref={moreTrigger}
      type="button"
      aria-haspopup="menu"
      aria-expanded={overlay?.mode === 'menu'}
      aria-label={`More actions for the message from ${senderLabel(message)}`}
      onClick={() => {
        setLastTrigger('more');
        toggle('menu');
      }}
      className={SIDE_BUTTON}
    >
      <MoreHorizontal aria-hidden className="size-4" />
    </button>
  );

  return (
    <div className="group/msg">
      <SwipeToReply enabled={message.kind !== 'system'} onReply={() => onReply(quoteOf(message))}>
        <div
          className={
            mine ? 'flex min-w-0 justify-end gap-0.5' : 'flex min-w-0 justify-start gap-0.5'
          }
        >
          {mine ? (
            <>
              {moreButton}
              {reactButton}
            </>
          ) : null}
          <div
            ref={bubbleRef}
            {...pressing}
            data-tone={filled ? 'filled' : attachments.length > 0 ? 'media' : 'plain'}
            className={
              filled
                ? 'max-w-[85%] min-w-0 rounded-2xl rounded-br-md bg-primary-action px-3 py-2 text-sm text-primary-action-foreground [-webkit-touch-callout:none] [@media(hover:none)]:select-none'
                : attachments.length > 0
                  ? `max-w-[85%] min-w-0 rounded-2xl ${mine ? 'rounded-br-md' : 'rounded-bl-md'} border border-border bg-background p-2 text-sm text-foreground [-webkit-touch-callout:none] [@media(hover:none)]:select-none`
                  : 'max-w-[85%] min-w-0 rounded-2xl rounded-bl-md border border-border bg-surface-muted px-3 py-2 text-sm text-foreground [-webkit-touch-callout:none] [@media(hover:none)]:select-none'
            }
          >
            {mine || !showName ? null : (
              <p className="mb-1 text-[11px] font-semibold text-muted-foreground">
                {senderLabel(message)}
              </p>
            )}
            {(message.replyTo ?? null) === null ? null : (
              <ReplyQuote
                reply={message.replyTo ?? quoteOf(message)}
                onJump={onJump}
                tone={filled ? 'outgoing' : 'incoming'}
              />
            )}
            {/* A message can be a picture, a file or a recording on its own, with no text at all. */}
            {attachments.length > 0 ? (
              <ChatAttachmentList
                attachments={attachments}
                tone="incoming"
                className={body === '' ? undefined : 'mb-2'}
                resolveMediaUrl={chatMediaUrl}
              />
            ) : null}
            {body === '' ? null : (
              <p
                className={`wrap-anywhere whitespace-pre-wrap ${filled || attachments.length === 0 ? '' : 'px-1'}`}
              >
                {body}
              </p>
            )}
            <p
              className={
                filled
                  ? 'mt-1 flex items-center justify-end gap-1 text-[10px] text-primary-action-foreground/80'
                  : 'mt-1 flex items-center justify-end gap-1 px-1 text-[10px] text-muted-foreground'
              }
            >
              {clockTime(message.createdAt)}
              {seen ? (
                <>
                  <span aria-hidden>·</span>
                  <CheckCheck aria-hidden className="size-3" />
                  Seen
                </>
              ) : null}
            </p>
          </div>
          {mine ? null : (
            <>
              {reactButton}
              {moreButton}
            </>
          )}
        </div>
      </SwipeToReply>

      {reactable ? (
        <ReactionSummaryRow messageId={message.id} align={mine ? 'end' : 'start'} />
      ) : null}

      {overlay === null ? null : (
        <MessageOverlay
          anchor={overlay.anchor}
          side={mine ? 'end' : 'start'}
          onClose={close}
          bar={
            overlay.mode === 'menu' || !reactable
              ? null
              : (columns: number) => (
                  <ReactionBar
                    messageId={message.id}
                    columns={columns}
                    onChoose={(emoji) => {
                      // Back to the control that opened the bar, so a keyboard user is not dropped
                      // at the top of the page.
                      close(true);
                      void reactions.toggle(message.id, emoji);
                    }}
                  />
                )
          }
          menu={
            overlay.mode === 'react' ? null : (
              <MessageMenu
                message={message}
                onReply={onReply}
                onNotice={onNotice}
                onViewImage={onViewImage}
                onClose={close}
              />
            )
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// A message on its way out
// ---------------------------------------------------------------------------------------------

function OutgoingFile({
  entry,
  state,
}: {
  entry: Outgoing['files'][number];
  state: Outgoing['fileStates'][string] | undefined;
}) {
  const preview = useObjectUrl(entry.file, entry.kind === 'image');
  const status = state?.status ?? 'queued';
  const detail =
    status === 'uploading'
      ? `Uploading ${String(state?.percent ?? 0)}%`
      : status === 'processing'
        ? 'Processing…'
        : status === 'uploaded'
          ? 'Uploaded'
          : status === 'failed'
            ? 'Not uploaded'
            : 'Waiting';
  return (
    <li className="flex items-center gap-2 rounded-xl border border-border bg-surface p-1.5 text-xs text-foreground">
      {preview !== null ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local blob, never a stored URL
        <img src={preview} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-muted">
          {entry.kind === 'audio' ? (
            <Mic aria-hidden className="size-4" />
          ) : (
            <FileText aria-hidden className="size-4" />
          )}
        </span>
      )}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate font-medium">{entry.name}</span>
        <span className="text-[10px] text-muted-foreground">
          {formatBytes(entry.file.size)} · {detail}
        </span>
        {status === 'uploading' || status === 'processing' ? (
          <span
            role="progressbar"
            aria-label={`Uploading ${entry.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            {...(status === 'uploading' ? { 'aria-valuenow': state?.percent ?? 0 } : {})}
            className="block h-1 overflow-hidden rounded-full bg-border"
          >
            <span
              className={`block h-full rounded-full bg-foreground ${status === 'processing' ? 'w-full animate-pulse' : ''}`}
              style={
                status === 'uploading' ? { width: `${String(state?.percent ?? 0)}%` } : undefined
              }
            />
          </span>
        ) : null}
      </span>
    </li>
  );
}

/** A message on its way out: shown at once, and honest about it until the API agrees. */
export function OutgoingBubble({
  row,
  onRetry,
  onRemove,
}: {
  row: Outgoing;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const allUploaded =
    row.files.length > 0 &&
    row.files.every((f) => row.fileStates[f.localId]?.status === 'uploaded');
  return (
    <div className="flex flex-col items-end gap-1">
      <div
        className={
          row.files.length === 0
            ? 'max-w-[85%] min-w-0 rounded-2xl rounded-br-md bg-primary-action px-3 py-2 text-sm text-primary-action-foreground'
            : 'max-w-[85%] min-w-0 rounded-2xl rounded-br-md border border-border bg-background p-2 text-sm text-foreground'
        }
      >
        {row.reply === null ? null : (
          <ReplyQuote reply={row.reply} tone={row.files.length === 0 ? 'outgoing' : 'incoming'} />
        )}
        {row.files.length === 0 ? null : (
          <ul aria-label="Files being sent" className="mb-1 grid gap-1.5">
            {row.files.map((entry) => (
              <OutgoingFile
                key={entry.localId}
                entry={entry}
                state={row.fileStates[entry.localId]}
              />
            ))}
          </ul>
        )}
        {row.body === '' ? null : (
          // wrap-anywhere, not break-words: an unbroken URL has no break opportunity, and
          // break-word would still let it widen the bubble and the panel with it.
          <p className="wrap-anywhere whitespace-pre-wrap">{row.body}</p>
        )}
        <p
          className={
            row.files.length === 0
              ? 'mt-1 text-right text-[10px] text-primary-action-foreground/70'
              : 'mt-1 px-1 text-right text-[10px] text-muted-foreground'
          }
        >
          {row.state === 'sending' ? 'Sending…' : 'Not sent'} · {clockTime(row.createdAt)}
        </p>
      </div>
      {row.state === 'failed' ? (
        <span className="flex max-w-[85%] flex-wrap items-center justify-end gap-2">
          <span className="text-[11px] text-danger">
            {row.error ?? 'This did not send.'}
            {allUploaded ? ' Your files are already uploaded.' : ''}
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border px-3 sm:min-h-8 sm:min-w-0 pointer-coarse:min-h-11 text-[11px] font-semibold text-foreground transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label="Retry sending this message"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full px-2 sm:min-h-8 sm:min-w-0 pointer-coarse:min-h-11 text-[11px] font-medium text-muted-foreground transition hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label="Remove this message that was not sent"
          >
            <X aria-hidden className="size-3" />
            Remove
          </button>
        </span>
      ) : null}
    </div>
  );
}
