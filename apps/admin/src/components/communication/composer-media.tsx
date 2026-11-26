'use client';

import {
  CHAT_ATTACHMENT_TYPES,
  chatMediaKindOf,
  chatMediaMaxBytes,
  chatMediaMaxLabel,
} from '@nilzora/contracts';
import { PendingAttachmentCard, usePendingUpload } from '@nilzora/ui';
import { Camera, FileText, ImageIcon, Mic, Paperclip, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { VoiceRecorder } from './voice-recorder';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * The Communication Center's media menu
 * ------------------------------------
 * One compact button, four clearly named actions — Image, File upload, Take photo, Record voice —
 * so an operator's reply bar stays clean. It posts to this app's own
 * `/api/support/attachments`, which forwards the bytes with the operator's session: the API still
 * decides whether this account may attach to this thread, so hiding a control is never the
 * authorization. Internal team threads use the same route, which is why their media is protected
 * by exactly the same membership check.
 *
 * "Take photo" is the same file input with `capture="environment"`; a phone opens its camera and a
 * desktop browser falls back to a picker. A captured picture travels the identical route.
 *
 * Choosing a file (or finishing a recording) only shows a preview: the bytes leave the browser
 * after the operator presses Upload, and the shared progress card then reports the browser's own
 * byte count until the server confirms the attachment.
 */

export interface PendingAttachment {
  id: string;
  fileName: string;
}

export function ComposerMediaMenu({
  conversationId,
  attachment,
  onAttached,
  onCleared,
  onPendingChange,
  disabled,
}: {
  conversationId: string;
  attachment: PendingAttachment | null;
  onAttached: (attachment: PendingAttachment) => void;
  onCleared: () => void;
  /** True while a chosen file is waiting to be uploaded, so the reply is not sent without it. */
  onPendingChange?: (pending: boolean) => void;
  disabled: boolean;
}) {
  const tx = useTx();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const cameraInput = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);

  const request = useCallback(
    (file: File) => {
      const contentType = (file.type || '').split(';')[0]?.trim().toLowerCase() ?? '';
      const kind = chatMediaKindOf(contentType);
      const query = new URLSearchParams({ conversationId, fileName: file.name });
      if (kind === 'audio' && durationMs !== null) {
        query.set('durationMs', String(Math.max(1, Math.round(durationMs))));
      }
      return { url: `/api/support/attachments?${query.toString()}`, contentType };
    },
    [conversationId, durationMs],
  );

  /** The attachment the route stored, or the message explaining that it did not. */
  const read = useCallback((body: unknown) => {
    const uploaded = body as { id?: unknown; fileName?: unknown } | null;
    if (typeof uploaded?.id !== 'string' || typeof uploaded.fileName !== 'string') {
      return 'That file could not be attached. Try again.';
    }
    return { id: uploaded.id, fileName: uploaded.fileName };
  }, []);

  const pending = usePendingUpload<PendingAttachment>({
    request,
    read,
    onUploaded: onAttached,
  });

  useEffect(() => {
    onPendingChange?.(pending.file !== null);
  }, [onPendingChange, pending.file]);

  const chooseFile = useCallback(
    (file: File) => {
      const contentType = (file.type || '').split(';')[0]?.trim().toLowerCase() ?? '';
      const kind = chatMediaKindOf(contentType);
      if (kind === null) {
        setRefusal('Attach a picture, a PDF, TXT, CSV, DOCX or XLSX file, or a voice recording.');
        return;
      }
      if (file.size > chatMediaMaxBytes(kind)) {
        setRefusal(`That file is larger than ${chatMediaMaxLabel(kind)}.`);
        return;
      }
      setRefusal(null);
      setDurationMs(null);
      pending.select(file);
    },
    [pending],
  );

  const clear = useCallback(() => {
    if (attachment !== null) {
      void fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'discard-attachment', id: attachment.id }),
      });
    }
    pending.clear();
    setDurationMs(null);
    onCleared();
    if (fileInput.current !== null) fileInput.current.value = '';
    if (cameraInput.current !== null) cameraInput.current.value = '';
  }, [attachment, onCleared, pending]);

  const choose = (input: HTMLInputElement | null) => {
    setOpen(false);
    input?.click();
  };
  const transferring =
    pending.state.phase === 'transferring' || pending.state.phase === 'processing';
  const busy = disabled || transferring || attachment !== null || pending.file !== null;

  return (
    <div className="relative flex items-center gap-1">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={tx("Add a picture, a file, a photo or a voice message")}
        disabled={disabled || transferring}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Paperclip aria-hidden className="size-4" />
      </button>

      {open ? (
        <ul
          role="menu"
          className="absolute bottom-full left-0 z-20 mb-1 w-44 overflow-hidden rounded-lg border border-border bg-background shadow-lg"
        >
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(fileInput.current)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground hover:bg-surface-muted"
            >
              <ImageIcon aria-hidden className="size-3.5" /><AutoText>Image</AutoText></button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(fileInput.current)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground hover:bg-surface-muted"
            >
              <FileText aria-hidden className="size-3.5" /><AutoText>File upload</AutoText></button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(cameraInput.current)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground hover:bg-surface-muted"
            >
              <Camera aria-hidden className="size-3.5" /><AutoText>Take photo</AutoText></button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setRecording(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground hover:bg-surface-muted"
            >
              <Mic aria-hidden className="size-3.5" /><AutoText>Record voice</AutoText></button>
          </li>
        </ul>
      ) : null}

      <input
        ref={fileInput}
        type="file"
        accept={CHAT_ATTACHMENT_TYPES.join(',')}
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) chooseFile(file);
        }}
        className="sr-only"
        aria-label={tx("Picture or file")}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) chooseFile(file);
        }}
        className="sr-only"
        aria-label={tx("Take a photo")}
      />

      {recording ? (
        <div className="absolute bottom-full left-0 z-20 mb-1 w-80 rounded-lg border border-border bg-background p-2 shadow-lg">
          <VoiceRecorder
            disabled={disabled || transferring}
            onRecorded={(voice) => {
              setRecording(false);
              setDurationMs(voice.durationMs);
              pending.select(
                new File([voice.blob], voice.fileName, { type: voice.contentType }),
              );
            }}
            onDiscard={() => setRecording(false)}
          />
        </div>
      ) : null}

      {pending.file === null ? null : (
        <div className="absolute bottom-full left-0 z-20 mb-1 w-80">
          <PendingAttachmentCard
            file={pending.file}
            state={pending.state}
            durationMs={durationMs}
            onUpload={() => void pending.start()}
            onRetry={() => void pending.start()}
            onCancel={pending.cancel}
            onRemove={clear}
            className="bg-background shadow-lg"
          />
        </div>
      )}

      {attachment === null ? null : (
        <span className="flex max-w-40 items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-foreground">
          <span className="truncate"><AutoText value={attachment.fileName} /></span>
          <button type="button" aria-label={tx("Remove the attachment")} onClick={clear}>
            <X aria-hidden className="size-3" />
          </button>
        </span>
      )}
      {refusal === null ? null : (
        <p role="alert" className="absolute bottom-full left-0 mb-11 w-64 text-[11px] text-danger">
          {refusal}
        </p>
      )}
    </div>
  );
}
