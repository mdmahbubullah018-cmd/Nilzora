'use client';

import { MAX_PRODUCT_VIDEOS, PRODUCT_VIDEO_MAX_BYTES, type ProductVideo } from '@nilzora/contracts';
import { Button, formatBytes, Input, sendFormWithProgress } from '@nilzora/ui';
import { ArrowDown, ArrowUp, Film, Trash2, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useRef, useState } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { uploadEndpoint } from '@/lib/upload-routes';
import { deleteProductVideoAction, moveProductVideoAction } from '@/lib/video-actions';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * A product's videos: a preview of each with its title, controls to move or remove it, and
 * an uploader that shows real byte progress. Every change runs through a Server Action
 * (origin, CSRF, session, permission and product-state checks happen on the server).
 */

type UploadPhase =
  | { kind: 'idle' }
  | { kind: 'sending'; percent: number }
  | { kind: 'processing' }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string };

export function ProductVideos({
  productId,
  videos,
  csrf,
  editable,
}: {
  productId: string;
  /** null when the videos could not be read (storage not set up or the API unavailable). */
  videos: readonly ProductVideo[] | null;
  csrf: CsrfInput;
  editable: boolean;
}) {
  if (videos === null) {
    return (
      <p className="rounded-xl border border-dashed border-hairline px-4 py-3 text-sm text-muted-foreground">
        Product videos could not be loaded right now. Media storage may not be set up on this server
        yet. Reload the page to try again.
      </p>
    );
  }
  const order = videos.map((video) => video.id).join(',');
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Film aria-hidden="true" className="size-4 text-muted-foreground" />
          Videos
          <span className="text-xs font-normal text-muted-foreground">
            {videos.length} of {MAX_PRODUCT_VIDEOS}
          </span>
        </h3>
      </div>
      {videos.length === 0 ? (
        <p className="text-sm text-muted-foreground"><AutoText>No videos yet. A short clip (MP4 or WebM, up to 40 MB) shows the product in use.</AutoText></p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {videos.map((video, index) => (
            <VideoCard
              key={video.id}
              productId={productId}
              video={video}
              order={order}
              first={index === 0}
              last={index === videos.length - 1}
              csrf={csrf}
              editable={editable}
            />
          ))}
        </ul>
      )}
      {editable && videos.length < MAX_PRODUCT_VIDEOS ? (
        <VideoUploader productId={productId} csrf={csrf} />
      ) : null}
    </div>
  );
}

function VideoCard({
  productId,
  video,
  order,
  first,
  last,
  csrf,
  editable,
}: {
  productId: string;
  video: ProductVideo;
  order: string;
  first: boolean;
  last: boolean;
  csrf: CsrfInput;
  editable: boolean;
}) {
  const tx = useTx();
  const [moveState, move, moving] = useActionState(moveProductVideoAction, IDLE_STATE);
  const [deleteState, remove] = useActionState(deleteProductVideoAction, IDLE_STATE);
  const label = video.title ?? `Product video ${String(video.position + 1)}`;
  return (
    <li className="grid gap-2 rounded-2xl border border-hairline bg-surface p-3">
      <video
        src={video.url}
        controls
        preload="metadata"
        aria-label={label}
        className="aspect-video w-full rounded-xl bg-black object-contain"
      />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground"><AutoText value={label} /></p>
          <p className="text-xs text-muted-foreground">
            {video.contentType === 'video/mp4' ? 'MP4' : 'WebM'} · {formatBytes(video.bytes)}
          </p>
        </div>
        {editable ? (
          <div className="flex shrink-0 items-center gap-1">
            {(['earlier', 'later'] as const).map((direction) => {
              const disabled = direction === 'earlier' ? first : last;
              const Icon = direction === 'earlier' ? ArrowUp : ArrowDown;
              return (
                <form key={direction} action={move}>
                  <CsrfField csrf={csrf} />
                  <input type="hidden" name="productId" value={productId} />
                  <input type="hidden" name="videoId" value={video.id} />
                  <input type="hidden" name="order" value={order} />
                  <input type="hidden" name="direction" value={direction} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    disabled={disabled || moving}
                    aria-label={`Move ${label} ${direction}`}
                  >
                    <Icon aria-hidden="true" className="size-4" />
                  </Button>
                </form>
              );
            })}
            <ConfirmForm
              action={remove}
              csrf={csrf}
              trigger={
                <>
                  <Trash2 aria-hidden="true" className="size-4" />
                  <span className="sr-only">Remove {label}</span>
                </>
              }
              triggerVariant="ghost"
              title={tx("Remove this video?")}
              description={tx("Shoppers will no longer see it, and the file is deleted from storage. This cannot be undone.")}
              confirmLabel={tx("Remove video")}
              hiddenFields={{ productId, videoId: video.id }}
              error={deleteState.status === 'error' ? deleteState.message : undefined}
            />
          </div>
        ) : null}
      </div>
      <ActionFeedback state={moveState} inline />
    </li>
  );
}

function VideoUploader({ productId, csrf }: { productId: string; csrf: CsrfInput }) {
  const tx = useTx();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [phase, setPhase] = useState<UploadPhase>({ kind: 'idle' });
  const busy = phase.kind === 'sending' || phase.kind === 'processing';

  async function send() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setPhase({ kind: 'error', message: 'Choose a video to upload.' });
      return;
    }
    if (file.size > PRODUCT_VIDEO_MAX_BYTES) {
      setPhase({
        kind: 'error',
        message: 'This video is larger than 40 MB. Choose a shorter or smaller one.',
      });
      return;
    }
    const body = new FormData();
    body.set(csrf.name, csrf.token);
    body.set('productId', productId);
    body.set('title', title);
    body.set('video', file);
    setPhase({ kind: 'sending', percent: 0 });
    const outcome = await sendFormWithProgress({
      url: uploadEndpoint('product-video'),
      body,
      onProgress: ({ percent }) => {
        setPhase({ kind: 'sending', percent });
      },
      onTransferred: () => {
        setPhase({ kind: 'processing' });
      },
    });
    if (outcome.kind === 'answered' && outcome.state.status === 'success') {
      setPhase({ kind: 'done', message: outcome.state.message ?? 'Video added to the product.' });
      setTitle('');
      if (fileRef.current) fileRef.current.value = '';
      router.refresh();
      return;
    }
    const message =
      outcome.kind === 'answered'
        ? (outcome.state.message ?? 'The video could not be uploaded.')
        : outcome.kind === 'network' && outcome.transferred
          ? 'The connection was lost before Nilzora confirmed the upload. Reload the page and check before trying again.'
          : outcome.kind === 'unexpected'
            ? 'Your session may have ended. Sign in again, then check before trying again.'
            : 'The upload did not finish. Nothing was saved. Try again.';
    setPhase({ kind: 'error', message });
  }

  return (
    <div className="grid gap-3 rounded-2xl border border-dashed border-hairline p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label
            className="text-sm font-medium text-foreground"
            htmlFor={`video-file-${productId}`}
          ><AutoText>Video file</AutoText></label>
          <input
            ref={fileRef}
            id={`video-file-${productId}`}
            type="file"
            accept="video/mp4,video/webm"
            disabled={busy}
            className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface-muted file:px-3 file:py-2 file:text-sm file:font-medium"
          />
          <p className="text-xs text-muted-foreground"><AutoText>MP4 or WebM, up to 40 MB.</AutoText></p>
        </div>
        <div className="grid gap-1.5">
          <label
            className="text-sm font-medium text-foreground"
            htmlFor={`video-title-${productId}`}
          >
            Title (optional)
          </label>
          <Input
            id={`video-title-${productId}`}
            value={title}
            maxLength={160}
            disabled={busy}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            placeholder={tx("e.g. The jacket in daylight")}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => void send()} disabled={busy}>
          <Upload aria-hidden="true" className="size-4" />
          {busy ? 'Uploading…' : 'Upload video'}
        </Button>
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {phase.kind === 'sending'
            ? `Sending… ${String(phase.percent)}%`
            : phase.kind === 'processing'
              ? 'Checking and saving the video…'
              : ''}
        </p>
      </div>
      {phase.kind === 'sending' ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${String(phase.percent)}%` }}
          />
        </div>
      ) : null}
      {phase.kind === 'done' ? (
        <p role="status" className="text-sm font-medium text-success-ink">
          {phase.message}
        </p>
      ) : null}
      {phase.kind === 'error' ? (
        <p role="alert" className="text-sm font-medium text-danger-ink">
          {phase.message}
        </p>
      ) : null}
    </div>
  );
}
