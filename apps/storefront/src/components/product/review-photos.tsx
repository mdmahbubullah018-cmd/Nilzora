'use client';

import { SelectedImagePreview } from '@nilzora/ui';
import { MAX_REVIEW_IMAGES, PRODUCT_IMAGE_CONTENT_TYPES } from '@nilzora/contracts';
import { AlertCircle, Check, ImagePlus, RotateCw, X } from 'lucide-react';
import { useRef } from 'react';
import { uploadStateOf, type Photo } from '@/lib/review-photos';

const ACCEPT = PRODUCT_IMAGE_CONTENT_TYPES.join(',');

export interface ReviewPhotosProps {
  photos: readonly Photo[];
  /** Why the last choice dropped some files. */
  notice: string | null;
  /** The picker is shown only before the review is saved; afterwards photos can still be listed. */
  canAdd: boolean;
  /** Disables adding and removing while the review or its photos are on their way. */
  locked: boolean;
  onChoose: (files: File[]) => void;
  onRemove: (photo: Photo) => void;
  onRetry: (photo: Photo) => void;
  onCancel: () => void;
}

/**
 * The photos for a review as one compact grid: every photo is the same small square, cropped to
 * fit, with its own remove button and its own real upload progress or outcome on the tile, so a
 * photo of any size can never stretch the form and one failed photo never hides the others. The
 * add tile sits in the grid itself and the counter ("2/4") says how many places are left. A
 * preview's temporary address is released when a photo is removed or the form goes away.
 */
export function ReviewPhotos({
  photos,
  notice,
  canAdd,
  locked,
  onChoose,
  onRemove,
  onRetry,
  onCancel,
}: ReviewPhotosProps) {
  const input = useRef<HTMLInputElement>(null);
  const full = photos.length >= MAX_REVIEW_IMAGES;
  const failed = photos.filter((photo) => photo.status === 'failed');

  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor="review-photos" className="text-sm font-medium text-foreground">
          Photos (optional)
        </label>
        <span
          className="text-xs font-medium text-muted-foreground tabular-nums"
          aria-live="polite"
          aria-label={`${String(photos.length)} of ${String(MAX_REVIEW_IMAGES)} photos chosen`}
        >
          {photos.length}/{MAX_REVIEW_IMAGES}
        </span>
      </div>

      {canAdd ? (
        <input
          ref={input}
          id="review-photos"
          type="file"
          multiple
          accept={ACCEPT}
          disabled={locked || full}
          aria-describedby="review-photos-hint"
          className="sr-only"
          onChange={(event) => {
            onChoose(Array.from(event.currentTarget.files ?? []));
            // The files are held in the form's own list; the field itself starts empty again.
            event.currentTarget.value = '';
          }}
        />
      ) : null}

      {photos.length > 0 || canAdd ? (
        <ul role="list" className="grid max-w-sm grid-cols-4 gap-2">
          {photos.map((photo) => {
            const state = uploadStateOf(photo);
            const busy = photo.status === 'sending' || photo.status === 'processing';
            const removable =
              photo.status === 'selected' || photo.status === 'failed' || photo.status === 'done';
            return (
              <li
                key={photo.key}
                className="relative aspect-square overflow-hidden rounded-lg border border-border bg-surface-muted"
              >
                <SelectedImagePreview
                  file={photo.file}
                  className="size-full rounded-none border-0"
                />
                {busy ? (
                  <div className="absolute inset-x-0 bottom-0 bg-black/55 px-1.5 py-1.5">
                    <div
                      role="progressbar"
                      aria-label={`Uploading ${photo.file.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={state.phase === 'processing' ? undefined : photo.percent}
                      aria-valuetext={state.phase === 'processing' ? 'Saving' : undefined}
                      className="block h-1 overflow-hidden rounded-full bg-white/30"
                    >
                      <span
                        className="block h-full bg-white transition-[width] motion-reduce:transition-none"
                        style={{
                          width: `${String(state.phase === 'processing' ? 100 : photo.percent)}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : null}
                {photo.status === 'done' ? (
                  <span
                    role="img"
                    aria-label="Added to your review"
                    className="absolute bottom-1 left-1 grid size-5 place-items-center rounded-full bg-success text-white"
                  >
                    <Check aria-hidden="true" className="size-3" />
                  </span>
                ) : null}
                {photo.status === 'failed' ? (
                  <div className="absolute inset-0 grid place-items-center bg-danger/70 text-white">
                    {photo.canRetry ? (
                      <button
                        type="button"
                        onClick={() => onRetry(photo)}
                        disabled={locked}
                        aria-label={`Try again: ${photo.file.name}`}
                        className="grid size-11 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-white"
                      >
                        <RotateCw aria-hidden="true" className="size-5" />
                      </button>
                    ) : (
                      <AlertCircle aria-hidden="true" className="size-5" />
                    )}
                  </div>
                ) : null}
                {removable ? (
                  <button
                    type="button"
                    disabled={locked}
                    aria-label={`Remove photo ${photo.file.name}`}
                    onClick={() => onRemove(photo)}
                    className="absolute top-1 right-1 grid size-6 cursor-pointer place-items-center rounded-full bg-black/65 text-white transition-colors hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white disabled:opacity-50 motion-reduce:transition-none after:absolute after:-inset-2.5 after:content-['']"
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                ) : null}
              </li>
            );
          })}
          {canAdd && !full ? (
            <li className="aspect-square">
              <button
                type="button"
                disabled={locked}
                onClick={() => input.current?.click()}
                aria-label={photos.length === 0 ? 'Add photos' : 'Add more photos'}
                className="grid size-full cursor-pointer place-items-center rounded-lg border border-dashed border-border-strong text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
              >
                <ImagePlus aria-hidden="true" className="size-6" />
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}

      <p id="review-photos-hint" className="text-xs text-muted-foreground">
        Up to {MAX_REVIEW_IMAGES} photos. JPEG, PNG or WebP, 5 MB each.
      </p>

      {notice ? (
        <p role="alert" className="text-sm text-danger">
          {notice}
        </p>
      ) : null}
      {failed.length > 0 ? (
        <ul role="alert" className="grid gap-0.5 text-sm text-danger">
          {failed.map((photo) => (
            <li key={photo.key}>
              <span className="font-medium">{photo.file.name}:</span>{' '}
              {photo.message ?? 'The photo could not be added.'}
            </li>
          ))}
        </ul>
      ) : null}
      {photos.some((photo) => photo.status === 'sending') ? (
        <button
          type="button"
          onClick={onCancel}
          className="w-fit text-sm font-medium text-link underline-offset-4 hover:underline"
        >
          Stop sending
        </button>
      ) : null}
    </div>
  );
}
