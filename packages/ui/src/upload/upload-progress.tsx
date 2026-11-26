'use client';

import { RotateCw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Alert } from '../components/alert';
import { Button } from '../components/button';
import { Spinner } from '../components/loading';
import { cn } from '../lib/cn';
import { formatBytes } from './transport';
import type { UploadState } from './use-progress-upload';

/**
 * A small preview of the file the person picked. The browser's temporary URL is released as soon
 * as the file changes or the preview goes away, so abandoned picks do not hold memory.
 */
export function SelectedImagePreview({
  file,
  className,
}: {
  file: File | null;
  className?: string;
}) {
  const image = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const element = image.current;
    if (!file || !element) return;
    const objectUrl = URL.createObjectURL(file);
    element.src = objectUrl;
    return () => {
      element.removeAttribute('src');
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  if (!file) return null;
  return (
    <img
      ref={image}
      alt=""
      className={cn('size-16 shrink-0 rounded-lg border border-border object-cover', className)}
    />
  );
}

export interface UploadProgressProps {
  state: UploadState;
  /** Offered only when the state says a retry is safe. */
  onRetry?: () => void;
  /** Offered while bytes are still being sent, when the person may stop the transfer. */
  onCancel?: () => void;
  className?: string;
}

/**
 * What an upload is doing right now. The bar and the percentage are the browser's own count of
 * bytes sent; once they are all sent the display says the server is still working and shows no
 * percentage, and only the server's answer turns it into success or an error.
 */
export function UploadProgress({ state, onRetry, onCancel, className }: UploadProgressProps) {
  if (state.phase === 'idle') return null;

  const frame = cn(
    'grid gap-2 rounded-xl border border-border bg-surface/80 p-3 text-sm backdrop-blur-sm',
    className,
  );

  return (
    <div className={frame}>
      <p className="truncate font-medium text-foreground" title={state.fileName}>
        {state.fileName}
      </p>

      {state.phase === 'transferring' ? (
        <>
          <div className="flex items-baseline justify-between gap-3 text-muted-foreground">
            <span>Uploading… {state.percent}%</span>
            <span className="tabular-nums">
              {formatBytes(state.loaded)} / {formatBytes(state.total)}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label={`Uploading ${state.fileName}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={state.percent}
            aria-valuetext={`${state.percent}% uploaded`}
            className="h-2 overflow-hidden rounded-full bg-surface-muted"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out motion-reduce:transition-none"
              style={{ width: `${state.percent}%` }}
            />
          </div>
          {onCancel ? (
            <div>
              <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
                Cancel upload
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      {state.phase === 'processing' ? (
        <p role="status" className="flex items-center gap-2 text-muted-foreground">
          <Spinner label="" className="[&_svg]:size-4" />
          <span>Sent {formatBytes(state.total)}. Checking and saving the image…</span>
        </p>
      ) : null}

      {state.phase === 'success' ? (
        <Alert tone="success" className="p-3">
          {state.message}
        </Alert>
      ) : null}

      {state.phase === 'error' ? (
        <div className="grid gap-2">
          <Alert tone="danger" className="p-3">
            {state.message}
          </Alert>
          {state.canRetry && onRetry ? (
            <div>
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                <RotateCw aria-hidden="true" />
                Try again
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
