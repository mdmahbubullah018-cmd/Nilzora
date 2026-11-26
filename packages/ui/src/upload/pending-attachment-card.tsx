'use client';

import { FileText, Mic, Upload } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '../components/button';
import { cn } from '../lib/cn';
import { formatBytes } from './transport';
import { UploadProgress, type UploadProgressProps } from './upload-progress';
import type { UploadState } from './use-progress-upload';

/**
 * A chosen attachment, before and while it is sent.
 *
 * The file is only held until the person presses Upload; the preview shows what will be sent
 * (a thumbnail for a picture, a player for a recording, the name and size for anything else),
 * and the transfer itself is the shared progress card, so the percentage is the browser's own
 * count of bytes rather than an animation.
 */
export interface PendingAttachmentCardProps {
  file: File;
  state: UploadState;
  /** The recording's length, so an audio preview can show it before playback. */
  durationMs?: number | null;
  onUpload: () => void;
  onRemove: () => void;
  onCancel?: UploadProgressProps['onCancel'];
  onRetry?: UploadProgressProps['onRetry'];
  className?: string;
}

function AudioPreview({ file }: { file: File }) {
  const player = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = player.current;
    if (!element) return;
    const objectUrl = URL.createObjectURL(file);
    element.src = objectUrl;
    return () => {
      element.removeAttribute('src');
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption -- a recorded voice message has no captions
    <audio ref={player} controls preload="metadata" className="h-8 w-full max-w-56" />
  );
}

function PicturePreview({ file }: { file: File }) {
  const image = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const element = image.current;
    if (!element) return;
    const objectUrl = URL.createObjectURL(file);
    element.src = objectUrl;
    return () => {
      element.removeAttribute('src');
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return (
    <img
      ref={image}
      alt=""
      className="size-16 shrink-0 rounded-lg border border-border object-cover"
    />
  );
}

function kindOf(file: File): 'image' | 'audio' | 'file' {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'file';
}

function durationLabel(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000);
  return `${String(Math.floor(totalSeconds / 60))}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

export function PendingAttachmentCard({
  file,
  state,
  durationMs,
  onUpload,
  onRemove,
  onCancel,
  onRetry,
  className,
}: PendingAttachmentCardProps) {
  const idle = state.phase === 'idle';
  const kind = kindOf(file);

  return (
    <div
      className={cn(
        'grid gap-2 rounded-xl border border-border bg-surface/80 p-2.5 text-sm',
        className,
      )}
    >
      {idle ? (
        <div className="flex items-center gap-3">
          {kind === 'image' ? <PicturePreview file={file} /> : null}
          {kind === 'audio' ? <AudioPreview file={file} /> : null}
          {kind === 'file' ? (
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-info-soft text-info-ink">
              <FileText aria-hidden className="size-4" strokeWidth={1.75} />
            </span>
          ) : null}
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="truncate font-medium text-foreground" title={file.name}>
              {file.name}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {kind === 'audio' ? (
                <Mic aria-hidden className="size-3" strokeWidth={1.75} />
              ) : null}
              {formatBytes(file.size)}
              {kind === 'audio' && durationMs !== undefined && durationMs !== null
                ? ` · ${durationLabel(durationMs)}`
                : ''}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <Button type="button" size="sm" onClick={onUpload}>
              <Upload aria-hidden="true" />
              Upload
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
              Remove
            </Button>
          </span>
        </div>
      ) : (
        <div className="grid gap-2">
          <UploadProgress state={state} onCancel={onCancel} onRetry={onRetry} />
          {state.phase === 'error' ? (
            <div>
              <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
                Remove
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
