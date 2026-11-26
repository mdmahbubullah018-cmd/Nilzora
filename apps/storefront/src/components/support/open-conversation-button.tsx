'use client';

import { MessageCircle } from 'lucide-react';
import { openSupport } from '@/lib/support-events';

/** Opens the support widget straight on one conversation the customer already has. */
export function OpenConversationButton({
  conversationId,
  label,
}: {
  conversationId: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => openSupport({ conversationId })}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-body transition hover:border-border-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <MessageCircle aria-hidden className="size-4" />
      {label}
    </button>
  );
}
