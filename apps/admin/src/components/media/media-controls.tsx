'use client';

import type { MediaAsset } from '@nilzora/contracts';
import { Button, cn, formatBytes, Input, type SendOptions } from '@nilzora/ui';
import { Check, Copy, ImagePlus, Trash2, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useRef, useState, type DragEvent } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import { useInteractive } from '@/components/admin-kit/use-interactive';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { Rejections } from '@/components/catalog/product-image-gallery';
import { useUploadQueue, type QueueRejection } from '@/components/catalog/upload-queue';
import { deleteMediaAction, updateMediaAltAction, uploadMediaAction } from '@/lib/media-actions';
import { uploadEndpoint } from '@/lib/upload-routes';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

const ACCEPT = 'image/jpeg,image/png,image/webp';

/**
 * Adds pictures to the library: drop several or pick them, see each one's real byte
 * progress, retry a failed one. Without JavaScript it is a one-file form posting to the
 * same Server Action the upload route runs.
 */
export function MediaUploader({
  csrf,
  createRequest,
  onUploaded,
}: {
  csrf: CsrfInput;
  createRequest?: SendOptions['createRequest'];
  /**
   * Called after the server confirms one upload, with the new picture's own addresses, so a
   * picker can select it at once instead of asking staff to find it again in the library.
   */
  onUploaded?: (picture: { key: string; url: string; thumbUrl: string }) => void;
}) {
  const tx = useTx();
  const interactive = useInteractive();
  const router = useRouter();
  const [state, action, pending] = useActionState(uploadMediaAction, IDLE_STATE);
  const inputRef = useRef<HTMLInputElement>(null);
  const [rejections, setRejections] = useState<QueueRejection[]>([]);
  const [over, setOver] = useState(false);
  const queue = useUploadQueue({
    endpoint: uploadEndpoint('media'),
    createRequest,
    fields: () => ({ [csrf.name]: csrf.token }),
    onUploaded: (_item, answer) => {
      router.refresh();
      const key = answer.values?.mediaKey;
      const thumbUrl = answer.values?.mediaThumbUrl;
      const url = answer.values?.mediaUrl;
      if (key && thumbUrl && url) onUploaded?.({ key, url, thumbUrl });
    },
    onFinished: () => queue.clearDone(),
  });
  const waiting = queue.items.filter((item) => item.status === 'ready').length;
  const busy = pending || queue.busy;

  const pick = (files: readonly File[]) => {
    setRejections(queue.add(files));
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!interactive) return;
        event.preventDefault();
        void queue.start();
      }}
      className="grid gap-4"
    >
      <CsrfField csrf={csrf} />
      <label
        htmlFor="media-upload"
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event: DragEvent<HTMLLabelElement>) => {
          event.preventDefault();
          setOver(false);
          if (!busy) pick(Array.from(event.dataTransfer.files));
        }}
        className={cn(
          'grid cursor-pointer justify-items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors',
          over ? 'border-info-ink bg-info-soft' : 'border-hairline bg-neutral-soft/40 hover:bg-info-soft/50',
          busy && 'cursor-not-allowed opacity-60',
        )}
      >
        <span className="nz-float grid size-12 place-items-center rounded-full bg-info-soft text-info-ink ring-8 ring-info-soft">
          <ImagePlus aria-hidden="true" className="size-5" strokeWidth={1.75} />
        </span>
        <span className="text-sm font-semibold text-foreground">
          {interactive ? 'Drop pictures here or choose files' : 'Choose a picture'}
        </span>
        <span id="media-upload-hint" className="max-w-md text-xs text-muted-foreground">
          JPEG, PNG or WebP, up to 5 MB and at least 400 pixels on the shorter side. Stored as
          WebP with every piece of metadata removed.
        </span>
      </label>
      <input
        ref={inputRef}
        id="media-upload"
        type="file"
        name="image"
        accept={ACCEPT}
        multiple={interactive}
        disabled={busy}
        aria-label={tx("Add pictures")}
        aria-describedby="media-upload-hint"
        onChange={(event) => {
          if (interactive) pick(Array.from(event.currentTarget.files ?? []));
        }}
        className={
          interactive
            ? 'sr-only'
            : 'rounded-xl border border-input-border bg-surface p-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-soft file:px-3 file:py-1.5 file:text-sm file:font-semibold'
        }
      />
      <Rejections rejections={rejections} />
      {state.status !== 'idle' ? <ActionFeedback state={state} /> : null}

      {queue.items.length > 0 ? (
        <ul aria-label={tx("Pictures to upload")} className="grid gap-2">
          {queue.items.map((item) => (
            <li key={item.key} className="nz-panel-strong grid gap-2 rounded-xl border p-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium text-foreground"><AutoText value={item.file.name} /></span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {item.status === 'transferring'
                    ? `${String(item.percent)}% · ${formatBytes(item.loaded)} / ${formatBytes(item.total)}`
                    : item.status === 'processing'
                      ? 'Saving…'
                      : item.status === 'done'
                        ? 'Uploaded'
                        : formatBytes(item.file.size)}
                </span>
              </div>
              {item.status === 'transferring' || item.status === 'processing' ? (
                <div
                  role="progressbar"
                  aria-label={`Uploading ${item.file.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={item.percent}
                  className="h-2 overflow-hidden rounded-full bg-chart-track"
                >
                  <div
                    className="h-full rounded-full bg-chart-1 transition-[width] duration-150 motion-reduce:transition-none"
                    style={{ width: `${String(item.percent)}%` }}
                  />
                </div>
              ) : null}
              {item.status === 'error' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p role="alert" className="flex-1 text-xs font-medium text-danger-ink">
                    {item.message}
                  </p>
                  {item.canRetry ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => queue.retry(item.key)}
                      className="max-sm:min-h-11"
                    >
                      Try again<span className="sr-only">: {item.file.name}</span>
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {item.status === 'ready' || item.status === 'error' ? (
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={queue.busy}
                    onClick={() => queue.remove(item.key)}
                    className="max-sm:min-h-11"
                  >
                    Remove from queue<span className="sr-only">: {item.file.name}</span>
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div>
        <Button
          type="submit"
          loading={busy}
          disabled={interactive && waiting === 0}
          className="max-sm:min-h-11"
        >
          {busy ? null : <Upload aria-hidden="true" strokeWidth={1.75} />}
          {busy
            ? 'Uploading…'
            : interactive && waiting > 1
              ? `Upload ${String(waiting)} pictures`
              : 'Upload picture'}
        </Button>
      </div>
    </form>
  );
}

/** Copies a value to the clipboard and says so. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="rounded-xl max-sm:min-h-11"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          },
          () => setCopied(false),
        );
      }}
    >
      {copied ? (
        <Check aria-hidden="true" strokeWidth={1.75} />
      ) : (
        <Copy aria-hidden="true" strokeWidth={1.75} />
      )}
      {copied ? 'Copied' : label}
      <span role="status" className="sr-only">
        {copied ? `${label} copied` : ''}
      </span>
    </Button>
  );
}

/** Description, copy and delete controls of one library picture (settings.manage). */
export function MediaAssetControls({ asset, csrf }: { asset: MediaAsset; csrf: CsrfInput }) {
  const tx = useTx();
  const [altState, altAction, altPending] = useActionState(updateMediaAltAction, IDLE_STATE);
  const [deleteState, deleteAction] = useActionState(deleteMediaAction, IDLE_STATE);
  const altId = `media-alt-${asset.id}`;
  const altError =
    altState.fieldErrors?.alt ?? (altState.status === 'error' ? altState.message : undefined);
  return (
    <div className="grid gap-3">
      <form action={altAction} className="grid gap-1.5">
        <CsrfField csrf={csrf} />
        <input type="hidden" name="mediaId" value={asset.id} />
        <label htmlFor={altId} className="text-xs font-medium text-muted-foreground"><AutoText>Description</AutoText></label>
        <div className="flex gap-2">
          <Input
            id={altId}
            name="alt"
            maxLength={250}
            defaultValue={altState.values?.alt ?? asset.alt ?? ''}
            placeholder={tx("What the picture shows")}
            aria-invalid={altError ? true : undefined}
            aria-describedby={altError ? `${altId}-error` : undefined}
            className="h-9 min-w-0 flex-1 rounded-xl max-sm:h-11"
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            loading={altPending}
            className="h-9 shrink-0 rounded-xl max-sm:h-11"
          >
            {altPending ? null : <Check aria-hidden="true" strokeWidth={1.75} />}
            Save{' '}<span className="sr-only">description</span>
          </Button>
        </div>
        {altError ? (
          <p id={`${altId}-error`} className="text-xs font-medium text-danger-ink">
            {altError}
          </p>
        ) : altState.status === 'success' ? (
          <ActionFeedback state={altState} inline />
        ) : null}
      </form>
      <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
        <CopyButton value={asset.key} label={tx("Copy key")} />
        <CopyButton value={asset.url} label={tx("Copy URL")} />
        <ConfirmForm
          action={deleteAction}
          csrf={csrf}
          align="end"
          className="ml-auto"
          triggerVariant="ghost"
          trigger={
            <>
              <Trash2 aria-hidden="true" strokeWidth={1.75} />
              Delete
            </>
          }
          title={tx("Delete this picture?")}
          description={tx("It is removed from the library and storage. Pictures still used by the store profile, SEO, onboarding or a banner cannot be deleted.")}
          confirmLabel={tx("Delete picture")}
          hiddenFields={{ mediaId: asset.id }}
          error={deleteState.status === 'error' ? deleteState.message : undefined}
        />
      </div>
    </div>
  );
}
