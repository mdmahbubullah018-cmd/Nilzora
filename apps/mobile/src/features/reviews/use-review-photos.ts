import { MAX_REVIEW_IMAGES, REVIEW_IMAGE_MIN_SIZE } from '@nilzora/contracts';
import { useCallback, useRef, useState } from 'react';
import type { SessionManager } from '@/auth/session-manager';
import { pickImages, type PickedImage } from '@/uploads/pick-images';
import { sendReviewPhoto } from '@/uploads/send-pictures';
import { describeUploadError, useNativeUpload } from '@/uploads/use-upload';

/*
 * The photos a customer attaches to a review. They are chosen first and sent one at a time,
 * and only once the review itself is saved: a photo belongs to a review that exists, and the API
 * and the database accept it only on the customer's own review that is still waiting for the
 * store to check it. Each photo has its own state, so one failure never hides the others, and a
 * failed photo can be tried again or removed without touching the review.
 */

export type PhotoStatus = 'queued' | 'uploading' | 'done' | 'failed';

export interface QueuedPhoto {
  key: string;
  image: PickedImage;
  status: PhotoStatus;
  /** Why it failed, in the app's words. */
  message?: string;
  /** The stored photo's id once the server has confirmed it. */
  imageId?: string;
}

export interface UploadRound {
  attempted: number;
  failed: number;
}

export function useReviewPhotos(manager: SessionManager | null) {
  const [photos, setPhotos] = useState<QueuedPhoto[]>([]);
  const [pickProblem, setPickProblem] = useState<string | null>(null);
  const upload = useNativeUpload();
  const latest = useRef<QueuedPhoto[]>([]);
  const sending = useRef(false);

  const commit = useCallback((next: QueuedPhoto[]) => {
    latest.current = next;
    setPhotos(next);
  }, []);

  const patch = useCallback(
    (key: string, change: Partial<QueuedPhoto>) =>
      commit(latest.current.map((p) => (p.key === key ? { ...p, ...change } : p))),
    [commit],
  );

  const add = useCallback(async () => {
    if (sending.current) return;
    setPickProblem(null);
    const room = MAX_REVIEW_IMAGES - latest.current.length;
    if (room <= 0) {
      setPickProblem(`A review can have up to ${String(MAX_REVIEW_IMAGES)} photos.`);
      return;
    }
    const result = await pickImages({ limit: room, minSide: REVIEW_IMAGE_MIN_SIZE });
    if (result.kind === 'cancelled') return;
    if (result.kind === 'error') {
      setPickProblem(result.message);
      return;
    }
    const known = new Set(latest.current.map((p) => p.image.uri));
    const fresh = result.images.filter((image) => !known.has(image.uri));
    const added: QueuedPhoto[] = fresh.map((image, index) => ({
      key: `${String(Date.now())}-${String(latest.current.length + index)}`,
      image,
      status: 'queued',
    }));
    commit([...latest.current, ...added]);
    const notes = [...result.rejected];
    if (fresh.length < result.images.length) notes.push('That photo is already in your list.');
    if (notes.length > 0) setPickProblem(notes.join(' '));
  }, [commit]);

  /** Takes a photo that has not been stored off the list. */
  const discard = useCallback(
    (key: string) => {
      if (sending.current) return;
      commit(latest.current.filter((p) => p.key !== key));
    },
    [commit],
  );

  /** Takes a stored photo off the list once the server has deleted it. */
  const forget = useCallback(
    (key: string) => commit(latest.current.filter((p) => p.key !== key)),
    [commit],
  );

  /**
   * Sends every photo that is waiting or failed to `reviewId`, one at a time. It stops at once if
   * the person cancels, leaving the rest waiting. Photos are never retried automatically.
   */
  const sendAll = useCallback(
    async (reviewId: string): Promise<UploadRound> => {
      if (sending.current) return { attempted: 0, failed: 0 };
      sending.current = true;
      let attempted = 0;
      let failed = 0;
      try {
        const todo = latest.current.filter((p) => p.status === 'queued' || p.status === 'failed');
        for (const photo of todo) {
          if (manager === null) {
            patch(photo.key, { status: 'failed', message: 'Sign in again, then try again.' });
            failed += 1;
            continue;
          }
          attempted += 1;
          patch(photo.key, { status: 'uploading' });
          let failure: ReturnType<typeof describeUploadError> | null = null;
          const answer = await upload.start(photo.image.fileName, async (controls) => {
            try {
              return await sendReviewPhoto(manager, reviewId, photo.image, controls);
            } catch (error) {
              failure = describeUploadError(error);
              throw error;
            }
          });
          if (answer !== null) {
            patch(photo.key, { status: 'done', imageId: answer.image.id });
            continue;
          }
          failed += 1;
          const reason = failure as ReturnType<typeof describeUploadError> | null;
          patch(photo.key, {
            status: 'failed',
            message: reason?.message ?? 'This photo could not be added.',
          });
          // A cancelled transfer stops the whole round: the person chose to.
          if (reason?.canRetry === true && reason.message.startsWith('Upload cancelled')) {
            for (const rest of todo.slice(todo.indexOf(photo) + 1)) {
              patch(rest.key, { status: 'queued' });
            }
            break;
          }
        }
      } finally {
        sending.current = false;
      }
      return { attempted, failed };
    },
    [manager, patch, upload],
  );

  return { photos, pickProblem, upload, add, discard, forget, sendAll };
}
