'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { collectVoucherAction } from '@/lib/voucher-actions';

/**
 * Collect, then Use. The button turns into a Use link only after the server confirmed the
 * collection; a refusal keeps Collect and says why, in a live region.
 */
export function CollectVoucherButton({
  voucherId,
  csrf,
  usePath,
  onCollected,
}: {
  voucherId: string;
  csrf: { name: string; token: string };
  usePath: string;
  /** Told when the server confirmed the collection, so a parent can keep its own list in step. */
  onCollected?: () => void;
}) {
  const [collected, setCollected] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (collected) {
    return (
      <span className="flex items-center gap-2">
        <span role="status" className="text-xs font-medium text-green-700 sm:text-[13px]">
          Collected
        </span>
        <Link
          href={usePath as Route}
          className="inline-flex min-h-10 items-center rounded-full border-2 border-primary px-5 text-sm font-semibold text-primary transition-colors hover:bg-primary-action hover:text-primary-action-foreground"
        >
          Use
        </Link>
      </span>
    );
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          const form = new FormData();
          form.set(csrf.name, csrf.token);
          form.set('voucherId', voucherId);
          startTransition(async () => {
            const answer = await collectVoucherAction(form);
            if (answer.ok) {
              setCollected(true);
              onCollected?.();
            } else setMessage(answer.message ?? 'That voucher could not be collected.');
          });
        }}
        className="inline-flex min-h-10 items-center rounded-full bg-primary-action px-5 text-sm font-semibold text-primary-action-foreground shadow-sm transition-colors hover:bg-primary-action-hover disabled:opacity-60"
      >
        {pending ? 'Collecting…' : 'Collect'}
      </button>
      {message ? (
        <span role="alert" className="max-w-56 text-right text-xs text-red-700">
          {message}
        </span>
      ) : null}
    </span>
  );
}
