'use client';

import { CHAT_QUICK_QUESTIONS } from '@nilzora/contracts';

/*
 * The questions customers ask most, one tap away.
 *
 * The list itself comes from the shared contract, so the website and the Android app offer the
 * same options in the same words. A chip only *writes* the question into the message box; it never
 * sends it, so a tap cannot post a message the customer did not read first.
 */

export const QUICK_QUESTIONS: readonly { label: string; question: string }[] = CHAT_QUICK_QUESTIONS;

export function QuickReplies({
  onPick,
  disabled = false,
}: {
  /** Writes the question into the composer. It is never sent from here. */
  onPick: (question: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mb-2">
      <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
        Common questions — tap to put it in the box
      </p>
      <ul
        aria-label="Common questions"
        className="-mx-3 flex snap-x snap-mandatory gap-2 overflow-x-auto px-3 pb-1 scrollbar-none"
      >
        {QUICK_QUESTIONS.map((entry) => (
          <li key={entry.label} className="shrink-0 snap-start">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(entry.question)}
              className="inline-flex min-h-11 items-center sm:min-h-9 pointer-coarse:min-h-11 rounded-full border border-border bg-surface px-3 text-xs font-medium text-body transition hover:border-border-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {entry.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
