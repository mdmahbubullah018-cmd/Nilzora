'use client';

import { MessageCircle } from 'lucide-react';
import { openSupport, type SupportOpenRequest } from '@/lib/support-events';

/**
 * Opens the support chat from anywhere on the storefront. Rendered as a real button so it
 * keeps its keyboard behaviour and its accessible name, and it carries the verified order or
 * product the question is about — the API re-checks ownership before using either.
 */
export function AskSupportButton({
  label,
  request,
  tone = 'quiet',
}: {
  label: string;
  request: SupportOpenRequest;
  tone?: 'quiet' | 'primary';
}) {
  return (
    <button
      type="button"
      onClick={() => openSupport(request)}
      className={
        tone === 'primary'
          ? 'inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary-action px-3 py-2 text-sm sm:min-h-0 pointer-coarse:min-h-11 font-semibold text-primary-action-foreground transition hover:bg-primary-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
          : 'inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm sm:min-h-0 pointer-coarse:min-h-11 font-medium text-body transition hover:border-border-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
      }
    >
      <MessageCircle aria-hidden className="size-4" />
      {label}
    </button>
  );
}
