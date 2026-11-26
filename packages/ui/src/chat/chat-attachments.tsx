'use client';

import type { ChatAttachment } from '@nilzora/contracts';
import { Download, FileText, ImageOff, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { safeImageName } from './chat-image-lightbox';
import { cn } from '../lib/cn';
import { formatBytes } from '../upload/transport';
import { ChatImageLightbox, type ChatImageViewerImage } from './chat-image-lightbox';
import { VoiceWaveformPlayer } from './voice-waveform-player';

/**
 * The files a chat message carries, on the web.
 *
 * A picture shows its thumbnail and opens the full-size one; a recording plays where it was sent;
 * anything else is a named link. The API resolved every URL from the object key, so a null URL
 * means "not configured or not recognised" and the attachment is shown by name only — never as a
 * broken image.
 *
 * The same component renders in the customer's widget and in the Admin Communication Center, so
 * both sides of a conversation show one attachment the same way.
 */
export interface ChatAttachmentListProps {
  attachments: readonly ChatAttachment[];
  /** An outgoing bubble is drawn on the accent colour, so its chips use the light foreground. */
  tone?: 'incoming' | 'outgoing';
  className?: string;
  /**
   * Where the API's media path is fetched from. Chat media is private, so the API answers
   * `/chat/attachments/<id>/media` and each app points that at its own authenticated proxy.
   * Defaults to the path itself, which is right when the app serves it under the same origin.
   */
  resolveMediaUrl?: (path: string) => string;
}

/** The upper-case extension a file card leads with, or null when the name has none. */
function extensionLabel(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return null;
  return fileName.slice(dot + 1).toUpperCase();
}

function attachmentKind(attachment: ChatAttachment): 'picture' | 'recording' | 'file' {
  if (attachment.contentType.startsWith('image/')) return 'picture';
  if (attachment.contentType.startsWith('audio/')) return 'recording';
  return 'file';
}

function chipFrame(tone: ChatAttachmentListProps['tone']): string {
  return cn(
    'flex w-64 max-w-full items-center gap-2.5 rounded-xl border px-2.5 py-2',
    tone === 'outgoing'
      ? 'border-primary-action-foreground/25 bg-primary-action-foreground/10'
      : 'border-hairline bg-surface',
  );
}

function FileChip({
  attachment,
  tone,
}: {
  attachment: ChatAttachment;
  tone: ChatAttachmentListProps['tone'];
}) {
  const extension = extensionLabel(attachment.fileName);
  const size = formatBytes(attachment.byteSize);
  const contents = (
    <>
      <span
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-lg',
          tone === 'outgoing'
            ? 'bg-primary-action-foreground/15'
            : 'bg-surface-muted text-foreground',
        )}
      >
        <FileText aria-hidden className="size-[18px]" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{attachment.fileName}</span>
        <span
          className={cn(
            'block text-xs',
            tone === 'outgoing' ? 'text-primary-action-foreground/80' : 'text-muted-foreground',
          )}
        >
          {extension === null ? size : `${extension} · ${size}`}
        </span>
      </span>
      {attachment.url === null ? null : (
        <Download aria-hidden className="size-4 shrink-0 opacity-70" strokeWidth={1.75} />
      )}
    </>
  );

  if (attachment.url === null) return <span className={chipFrame(tone)}>{contents}</span>;
  return (
    <a
      href={attachment.url}
      download={attachment.fileName}
      target="_blank"
      rel="noreferrer"
      className={cn(
        chipFrame(tone),
        'transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
      )}
    >
      {contents}
    </a>
  );
}

function Picture({
  attachment,
  tone,
}: {
  attachment: ChatAttachment;
  tone: ChatAttachmentListProps['tone'];
}) {
  const preview = attachment.thumbnailUrl ?? attachment.url;
  const [open, setOpen] = useState<ChatImageViewerImage | null>(null);
  // A stored URL can still fail to load: the object may be gone, or the bucket unreachable.
  // Saying so, and offering a fresh request, is better than an empty box.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Until the picture has arrived a placeholder holds its place, at the picture's own shape when
  // the size is known, so the thread does not jump when it loads.
  const [loaded, setLoaded] = useState<string | null>(null);
  if (preview === null) return <FileChip attachment={attachment} tone={tone} />;

  const frame = cn(
    'block overflow-hidden rounded-xl border',
    tone === 'outgoing' ? 'border-primary-action-foreground/25' : 'border-hairline bg-surface',
  );

  if (failed) {
    return (
      <button
        type="button"
        onClick={() => {
          setFailed(false);
          setAttempt((value) => value + 1);
        }}
        className={cn(
          frame,
          'flex items-center gap-2 px-3 py-2 text-left text-xs',
          tone === 'outgoing'
            ? 'text-primary-action-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <ImageOff aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate">{safeImageName(attachment.fileName)}</span>
        <span className="inline-flex items-center gap-1 font-medium">
          <RotateCw aria-hidden className="size-3" />
          Try again
        </span>
      </button>
    );
  }

  const image = (
    <img
      key={attempt}
      src={preview}
      alt={safeImageName(attachment.fileName)}
      width={attachment.width ?? undefined}
      height={attachment.height ?? undefined}
      loading="lazy"
      decoding="async"
      onLoad={() => setLoaded(preview)}
      onError={() => setFailed(true)}
      className="block max-h-64 w-full max-w-72 object-cover"
    />
  );
  const waiting = loaded !== preview;
  const placeholder = waiting ? (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 motion-safe:animate-pulse bg-surface-muted"
    />
  ) : null;
  // With the size known the <img> reserves its own shape; without it, hold a sensible minimum.
  const sized = attachment.width !== null && attachment.height !== null;

  // A picture without a stored original can only be looked at where it already is.
  if (attachment.url === null) {
    return (
      <span className={cn(frame, 'relative', waiting && !sized && 'min-h-32')}>
        {placeholder}
        {image}
      </span>
    );
  }

  const full = attachment.url;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen({ url: full, name: attachment.fileName })}
        aria-label={`${safeImageName(attachment.fileName)} (open the full picture)`}
        className={cn(
          frame,
          'relative',
          waiting && !sized && 'min-h-32',
          'transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:opacity-90',
        )}
      >
        {placeholder}
        {image}
      </button>
      <ChatImageLightbox image={open} onClose={() => setOpen(null)} />
    </>
  );
}

function Recording({
  attachment,
  tone,
}: {
  attachment: ChatAttachment;
  tone: ChatAttachmentListProps['tone'];
}) {
  if (attachment.url === null) return <FileChip attachment={attachment} tone={tone} />;
  return <VoiceWaveformPlayer url={attachment.url} durationMs={attachment.durationMs} />;
}

export function ChatAttachmentList({
  attachments,
  tone = 'incoming',
  className,
  resolveMediaUrl = (path) => path,
}: ChatAttachmentListProps) {
  if (attachments.length === 0) return null;

  return (
    <ul className={cn('grid gap-2', className)} aria-label="Attachments">
      {attachments.map((original) => {
        // Every consumer renders the resolved address; the API's private path stays the source.
        const attachment: ChatAttachment = {
          ...original,
          url: original.url === null ? null : resolveMediaUrl(original.url),
          thumbnailUrl:
            original.thumbnailUrl === null ? null : resolveMediaUrl(original.thumbnailUrl),
        };
        const kind = attachmentKind(attachment);
        return (
          <li key={attachment.id}>
            {kind === 'picture' ? (
              <Picture attachment={attachment} tone={tone} />
            ) : kind === 'recording' ? (
              <Recording attachment={attachment} tone={tone} />
            ) : (
              <FileChip attachment={attachment} tone={tone} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
