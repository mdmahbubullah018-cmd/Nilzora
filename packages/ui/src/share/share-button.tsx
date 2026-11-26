'use client';

import type { ShareTarget } from '@nilzora/contracts';
import { Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { runShare, type ShareOutcome } from './share-action';

/*
 * The share control
 * -----------------
 * One button for every "share this" in the storefront and the admin. It hands the record's own
 * title, line and canonical address to the platform share sheet and, where that is missing,
 * copies the link — reporting only what actually happened.
 *
 * `icon` is the compact form that sits on a card or in a toolbar; `label` is the one that sits
 * beside a page title. Both are real buttons with a specific accessible name ("Share Clay Mug"),
 * and the outcome is announced in a live region whether or not there is room to show it.
 */

type Status = 'idle' | 'busy' | 'shared' | 'copied' | 'failed';

const CONFIRMATION_MS = 2500;

const MESSAGES: Record<Exclude<Status, 'idle' | 'busy'>, string> = {
  shared: 'Shared',
  copied: 'Link copied',
  failed: 'This could not be shared. Please try again.',
};

export interface ShareButtonProps {
  target: ShareTarget;
  /** `icon` for a card or toolbar; `label` for a page title or a header row. */
  variant?: 'icon' | 'label';
  /** The size of the icon form: `sm` on a product card, `md` beside a page title. */
  size?: 'sm' | 'md';
  /**
   * Where the button sits. `surface` (the default) is the light card: white glass, dark icon.
   * `onMedia` is for a photograph — a category or brand banner — where it becomes a navy glass
   * disc with a white icon, which stays legible on a pale picture as well as a dark one.
   */
  tone?: 'surface' | 'onMedia';
  /** The visible word, for the `label` form. */
  label?: string;
  className?: string;
}

export function ShareButton({
  target,
  variant = 'icon',
  size = 'sm',
  tone = 'surface',
  label = 'Share',
  className,
}: ShareButtonProps) {
  const [status, setStatus] = useState<Status>('idle');
  // A tap that is already being handled must not start a second share sheet.
  const running = useRef(false);

  useEffect(() => {
    if (status === 'idle' || status === 'busy') return;
    const timer = setTimeout(() => setStatus('idle'), CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [status]);

  async function share() {
    if (running.current) return;
    running.current = true;
    setStatus('busy');
    let outcome: ShareOutcome = 'failed';
    try {
      outcome = await runShare({ title: target.title, text: target.text, url: target.url });
    } catch {
      outcome = 'failed';
    } finally {
      running.current = false;
    }
    // A cancelled sheet is the shopper's own choice; saying anything would be noise.
    setStatus(outcome === 'cancelled' ? 'idle' : outcome);
  }

  const message =
    status === 'shared' || status === 'copied' || status === 'failed' ? MESSAGES[status] : '';
  // Always announced, never in the way: the icon form has no room for the words, and the label
  // form has already changed its own label.
  const spoken = (
    <span role="status" aria-live="polite" className="sr-only">
      {message}
    </span>
  );
  const name = `Share ${target.title}`;

  if (variant === 'label') {
    return (
      <span className={cn('inline-flex items-center gap-2', className)}>
        <button
          type="button"
          onClick={() => void share()}
          aria-label={name}
          aria-busy={status === 'busy' || undefined}
          title={`Share a link to ${target.title}`}
          className={cn(
            'inline-flex h-9 touch-manipulation items-center justify-center gap-2 rounded-full px-3.5',
            'border border-border bg-surface text-sm font-semibold text-body shadow-xs',
            'transition-[color,background-color,border-color,scale] duration-200 ease-soft',
            'hover:border-primary/40 hover:text-primary active:scale-95',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            'motion-reduce:transition-none motion-reduce:active:scale-100',
            status === 'failed' && 'border-danger/40 text-danger',
            status === 'busy' && 'opacity-70',
          )}
        >
          <Share2 aria-hidden="true" className="size-4" strokeWidth={1.75} />
          {status === 'shared' || status === 'copied' ? message : label}
        </button>
        {spoken}
      </span>
    );
  }

  return (
    <span className={cn('relative z-10 inline-flex', className)}>
      <button
        type="button"
        onClick={() => void share()}
        aria-label={name}
        aria-busy={status === 'busy' || undefined}
        title={`Share a link to ${target.title}`}
        className={cn(
          'inline-flex touch-manipulation items-center justify-center rounded-full',
          tone === 'onMedia'
            ? // On a photograph: the glyph alone, white with a soft dark halo so it reads on a
              // pale banner and a dark one. No disc, no ring, no shadow box behind it.
              'text-white drop-shadow-[0_1px_3px_rgba(15,23,42,0.85)]'
            : 'bg-surface/90 text-body shadow-sm ring-1 ring-border/70 backdrop-blur',
          'transition-[color,opacity,scale] duration-200 ease-soft',
          tone === 'onMedia' ? 'hover:text-white hover:opacity-80' : 'hover:text-primary hover:ring-primary/40 active:scale-95',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          'motion-reduce:transition-none motion-reduce:active:scale-100',
          status === 'failed' &&
            (tone === 'onMedia' ? 'text-rose-100' : 'text-danger ring-danger/40'),
          status === 'busy' && 'opacity-70',
          size === 'md' ? 'size-10' : 'size-9',
        )}
      >
        <Share2
          aria-hidden="true"
          className={size === 'md' ? 'size-5' : 'size-[1.15rem]'}
          strokeWidth={1.9}
        />
      </button>
      {spoken}
    </span>
  );
}
