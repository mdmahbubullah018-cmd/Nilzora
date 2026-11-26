'use client';

import { Alert, Button, Field, Input, sendFormWithProgress, Textarea } from '@nilzora/ui';
import { useActionState, useEffect, useReducer, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { refreshReviewsAction, removeReviewPhotoAction } from '@/lib/picture-actions';
import {
  EMPTY_QUEUE,
  isUploading,
  photoReducer,
  photoTally,
  type Photo,
} from '@/lib/review-photos';
import {
  CsrfInput,
  FormMessage,
  IDLE_STATE,
  type CsrfField,
  type FormAction,
} from '../auth/form-kit';
import { ReviewPhotos } from './review-photos';

const MAX_BODY = 2000;
const MAX_TITLE = 120;
const UPLOAD_ROUTE = '/api/uploads/review-photo';

const LOST_BEFORE_SENT =
  'The connection was lost while the photo was being sent. Nothing was saved. Try again.';
const LOST_AFTER_SENT =
  'The connection was lost before Nilzora confirmed this photo. Reload the page to see what was saved.';
const SESSION_ENDED =
  'Your session may have ended, so this photo could not be confirmed. Sign in again and check your review.';

function SubmitButton({ busy }: { busy: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending || busy}>
      {pending || busy ? 'Posting review…' : 'Post review'}
    </Button>
  );
}

export interface ReviewFormProps {
  productId: string;
  slug: string;
  csrf: CsrfField;
  action: FormAction;
  /**
   * Told once the server has confirmed the review, so an entry point outside the product
   * page (an order line) can replace its own action with the review's status.
   */
  onSubmitted?: (() => void) | undefined;
}

/**
 * Rating, text and optional photos. The text is checked here for a quick answer and again by the
 * API and database.
 *
 * With photos the review is saved FIRST (a real answer from the server, with the review's id),
 * and only then is each photo sent to that review, one at a time, each with its own real upload
 * progress. So "your review was submitted" is never said before the server confirmed it, and a
 * photo that fails never undoes the review: it stays listed with a retry (when that is safe) or
 * a remove button. Without photos, or without JavaScript, the form posts as it always did.
 */
export function ReviewForm({ productId, slug, csrf, action, onSubmitted }: ReviewFormProps) {
  const [state, formAction] = useActionState(action, IDLE_STATE);
  const [local, setLocal] = useState<typeof state | null>(null);
  const [queue, dispatch] = useReducer(photoReducer, EMPTY_QUEUE);
  const [savedReviewId, setSavedReviewId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const active = useRef<AbortController | null>(null);
  const stopped = useRef(false);

  useEffect(
    () => () => {
      stopped.current = true;
      active.current?.abort();
    },
    [],
  );

  const shown = local ?? state;
  // The server's own answer, whichever way the form was sent: through useActionState
  // without photos, or by calling the action directly when photos are queued.
  const saved = state.status === 'success' || local?.status === 'success';
  useEffect(() => {
    if (saved) onSubmitted?.();
  }, [saved, onSubmitted]);
  const errors = shown.fieldErrors ?? {};
  const uploading = isUploading(queue);

  /** Sends one photo to the saved review, reporting the browser's real byte counts. */
  async function sendPhoto(reviewId: string, photo: Photo): Promise<void> {
    const controller = new AbortController();
    active.current = controller;
    dispatch({ type: 'sending', key: photo.key });
    const body = new FormData();
    body.set(csrf.name, csrf.token);
    body.set('reviewId', reviewId);
    body.set('slug', slug);
    body.set('image', photo.file);

    const outcome = await sendFormWithProgress({
      url: UPLOAD_ROUTE,
      body,
      signal: controller.signal,
      onProgress: ({ loaded, total, percent }) =>
        dispatch({ type: 'progress', key: photo.key, loaded, total, percent }),
      onTransferred: () => dispatch({ type: 'processing', key: photo.key }),
    });
    active.current = null;

    if (outcome.kind === 'aborted') {
      stopped.current = true;
      dispatch({ type: 'failed', key: photo.key, message: 'Upload cancelled.', canRetry: true });
    } else if (outcome.kind === 'network') {
      dispatch({
        type: 'failed',
        key: photo.key,
        message: outcome.transferred ? LOST_AFTER_SENT : LOST_BEFORE_SENT,
        canRetry: !outcome.transferred,
      });
    } else if (outcome.kind === 'unexpected') {
      dispatch({ type: 'failed', key: photo.key, message: SESSION_ENDED, canRetry: false });
    } else if (outcome.state.status === 'success' && outcome.state.values?.imageId) {
      dispatch({ type: 'done', key: photo.key, imageId: outcome.state.values.imageId });
    } else {
      dispatch({
        type: 'failed',
        key: photo.key,
        message: outcome.state.message ?? 'The photo could not be added.',
        // The server looked at the photo and refused it: choosing another is safe.
        canRetry: outcome.state.status === 'error',
      });
    }
  }

  async function sendAll(reviewId: string, photos: readonly Photo[]): Promise<void> {
    stopped.current = false;
    for (const photo of photos) {
      if (stopped.current) break;
      await sendPhoto(reviewId, photo);
    }
  }

  async function removePhoto(photo: Photo): Promise<void> {
    if (photo.status === 'done' && photo.imageId) {
      const body = new FormData();
      body.set(csrf.name, csrf.token);
      body.set('imageId', photo.imageId);
      body.set('slug', slug);
      const result = await removeReviewPhotoAction(IDLE_STATE, body);
      if (result.status !== 'success') {
        dispatch({
          type: 'failed',
          key: photo.key,
          message: result.message ?? 'The photo could not be removed.',
          canRetry: false,
        });
        return;
      }
    }
    dispatch({ type: 'remove', key: photo.key });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    // Without photos the form posts through its Server Action, with or without JavaScript.
    if (queue.photos.length === 0) return;
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setLocal(null);
    try {
      const result = await action(IDLE_STATE, new FormData(event.currentTarget));
      if (result.status !== 'success') {
        // The text and the chosen photos stay exactly as they were.
        setLocal(result);
        return;
      }
      setLocal(result);
      const reviewId = result.values?.reviewId;
      if (reviewId) {
        setSavedReviewId(reviewId);
        await sendAll(reviewId, queue.photos);
        // The review was saved without refreshing the page; now that its photos are on it, show it.
        await refreshReviewsAction(slug).catch(() => undefined);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (shown.status === 'success' && queue.photos.length === 0) {
    return (
      <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
        {shown.message ?? 'Thank you. Your review is published.'}
      </p>
    );
  }

  if (savedReviewId !== null) {
    const { done, failed, total } = photoTally(queue);
    return (
      <div className="grid gap-4">
        <Alert tone="success">
          Thank you. Your review is published.{' '}
          {total === 0
            ? ''
            : uploading
              ? `Adding your photos… ${String(done)} of ${String(total)} done.`
              : failed === 0
                ? `${String(done)} of ${String(total)} photos added.`
                : `${String(done)} of ${String(total)} photos added; ${String(failed)} could not be.`}
        </Alert>
        <ReviewPhotos
          photos={queue.photos}
          notice={queue.notice}
          canAdd={false}
          locked={uploading}
          onChoose={() => undefined}
          onRemove={(photo) => void removePhoto(photo)}
          onRetry={(photo) => void sendPhoto(savedReviewId, photo)}
          onCancel={() => active.current?.abort()}
        />
      </div>
    );
  }

  return (
    <form action={formAction} onSubmit={(event) => void onSubmit(event)} className="grid gap-4">
      <CsrfInput csrf={csrf} />
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="slug" value={slug} />
      {queue.photos.length > 0 ? <input type="hidden" name="deferRefresh" value="1" /> : null}
      <FormMessage state={shown} />

      <Field id="review-rating" label="Your rating" error={errors.rating} required>
        {() => (
          <div
            className="flex items-center gap-1"
            role="radiogroup"
            aria-labelledby="review-rating"
          >
            {[5, 4, 3, 2, 1].map((star) => (
              <label key={star} className="cursor-pointer">
                <input
                  type="radio"
                  name="rating"
                  value={star}
                  defaultChecked={shown.values?.rating === String(star)}
                  className="peer sr-only"
                  required
                />
                <span className="grid size-9 place-items-center rounded-md border border-border text-sm font-semibold text-body peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:text-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
                  {star}
                  <span className="sr-only"> out of 5</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </Field>

      <Field
        id="review-title"
        label="Title (optional)"
        error={errors.title}
        hint={`Up to ${String(MAX_TITLE)} characters.`}
      >
        {(control) => (
          <Input
            {...control}
            name="title"
            maxLength={MAX_TITLE}
            defaultValue={shown.values?.title ?? ''}
          />
        )}
      </Field>

      <Field
        id="review-body"
        label="Your review"
        error={errors.body}
        hint={`At least 10 characters, up to ${String(MAX_BODY)}.`}
        required
      >
        {(control) => (
          <Textarea
            {...control}
            name="body"
            rows={4}
            maxLength={MAX_BODY}
            defaultValue={shown.values?.body ?? ''}
          />
        )}
      </Field>

      <ReviewPhotos
        photos={queue.photos}
        notice={queue.notice}
        canAdd
        locked={submitting}
        onChoose={(files) => dispatch({ type: 'choose', files })}
        onRemove={(photo) => dispatch({ type: 'remove', key: photo.key })}
        onRetry={() => undefined}
        onCancel={() => active.current?.abort()}
      />

      <div>
        <SubmitButton busy={submitting} />
      </div>
    </form>
  );
}
