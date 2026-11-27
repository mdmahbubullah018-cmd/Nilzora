'use client';

import { Button } from '@nilzora/ui';
import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { startImageSearchJobAction } from '@/lib/image-search-actions';

function JobButton({
  kind,
  label,
  pendingLabel,
  variant,
  disabled,
}: {
  kind: 'backfill' | 'reindex_all' | 'retry_failed';
  label: string;
  pendingLabel: string;
  variant: 'primary' | 'outline';
  disabled: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="kind"
      value={kind}
      variant={variant}
      loading={pending}
      disabled={disabled}
      className="rounded-xl max-sm:min-h-11"
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}

export interface ImageSearchJobControlsProps {
  csrf: CsrfInput;
  /** True while a job is queued or running: a second one would work on the same rows. */
  busy: boolean;
  failedCount: number;
}

/**
 * The three jobs. While one is running every button is disabled and the page refreshes itself,
 * so progress is read from the database rather than from what the click said would happen.
 */
export function ImageSearchJobControls({ csrf, busy, failedCount }: ImageSearchJobControlsProps) {
  const router = useRouter();
  const [state, action] = useActionState(startImageSearchJobAction, IDLE_STATE);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => router.refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [busy, router]);

  return (
    <div className="grid gap-3">
      <form action={action} className="flex flex-wrap gap-2">
        <CsrfField csrf={csrf} />
        <JobButton
          kind="backfill"
          label="Backfill new pictures"
          pendingLabel="Starting…"
          variant="primary"
          disabled={busy}
        />
        <JobButton
          kind="reindex_all"
          label="Reindex everything"
          pendingLabel="Starting…"
          variant="outline"
          disabled={busy}
        />
        <JobButton
          kind="retry_failed"
          label={failedCount > 0 ? `Retry failed (${failedCount})` : 'Retry failed'}
          pendingLabel="Starting…"
          variant="outline"
          disabled={busy || failedCount === 0}
        />
      </form>
      <ActionFeedback state={state} />
      {busy ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <RefreshCw
            aria-hidden="true"
            className="size-3.5 animate-spin motion-reduce:animate-none"
          />
          A job is running. This page refreshes every few seconds; you can leave it and come back.
        </p>
      ) : null}
    </div>
  );
}
