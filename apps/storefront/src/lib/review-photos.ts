import { checkReportedFile, MAX_REVIEW_IMAGES } from '@nilzora/contracts';
import type { UploadState } from '@nilzora/ui';

/*
 * The photos a customer is attaching to a review.
 *
 * A pure reducer, so what the screen shows for every step can be tested without a browser:
 * choosing files (checked against the same rules the API applies), the bytes of each upload as
 * the browser reports them, the server's answer, a failure, and removal. A photo is "done" only
 * when the server confirmed it; its bytes having been sent is a separate, earlier step.
 */

export type PhotoStatus =
  /** Chosen, not sent yet. */
  | 'selected'
  /** Bytes are being sent. */
  | 'sending'
  /** Every byte is sent; waiting for the server to check and save it. */
  | 'processing'
  /** The server confirmed the photo is on the review. */
  | 'done'
  | 'failed';

export interface Photo {
  /** Local identity (the same file chosen twice is refused, so this is stable). */
  key: string;
  file: File;
  status: PhotoStatus;
  loaded: number;
  total: number;
  percent: number;
  /** Set once the server confirmed the photo; needed to remove it. */
  imageId?: string;
  /** A failure's explanation, or a note on a refused file. */
  message?: string;
  /** Sending it again is safe (it never reached the server, or the server refused it). */
  canRetry: boolean;
}

export interface PhotoQueue {
  photos: readonly Photo[];
  /** Why the most recent choice dropped some files, if it did. */
  notice: string | null;
}

export const EMPTY_QUEUE: PhotoQueue = { photos: [], notice: null };

export type PhotoAction =
  | { type: 'choose'; files: readonly File[]; limit?: number }
  | { type: 'remove'; key: string }
  | { type: 'sending'; key: string }
  | { type: 'progress'; key: string; loaded: number; total: number; percent: number }
  | { type: 'processing'; key: string }
  | { type: 'done'; key: string; imageId: string }
  | { type: 'failed'; key: string; message: string; canRetry: boolean }
  | { type: 'reset' };

/** The same picture picked twice (name, size and modified time all equal) is one picture. */
export function photoKey(file: File): string {
  return `${file.name}:${String(file.size)}:${String(file.lastModified)}`;
}

function update(queue: PhotoQueue, key: string, change: Partial<Photo>): PhotoQueue {
  return {
    ...queue,
    photos: queue.photos.map((photo) => (photo.key === key ? { ...photo, ...change } : photo)),
  };
}

export function photoReducer(queue: PhotoQueue, action: PhotoAction): PhotoQueue {
  switch (action.type) {
    case 'choose': {
      const limit = action.limit ?? MAX_REVIEW_IMAGES;
      const photos = [...queue.photos];
      const problems = new Set<string>();
      for (const file of action.files) {
        const key = photoKey(file);
        if (photos.some((photo) => photo.key === key)) continue;
        const refusal = checkReportedFile(file);
        if (refusal !== null) {
          problems.add(`${file.name}: ${refusal}`);
          continue;
        }
        if (photos.length >= limit) {
          problems.add(`A review keeps at most ${String(limit)} photos.`);
          continue;
        }
        photos.push({
          key,
          file,
          status: 'selected',
          loaded: 0,
          total: file.size,
          percent: 0,
          canRetry: false,
        });
      }
      return { photos, notice: problems.size === 0 ? null : [...problems].join(' ') };
    }
    case 'remove':
      return { ...queue, photos: queue.photos.filter((photo) => photo.key !== action.key) };
    case 'sending':
      return update(queue, action.key, {
        status: 'sending',
        loaded: 0,
        percent: 0,
        message: undefined,
        canRetry: false,
      });
    case 'progress':
      return update(queue, action.key, {
        loaded: action.loaded,
        total: action.total,
        percent: action.percent,
      });
    case 'processing':
      return update(queue, action.key, { status: 'processing' });
    case 'done':
      return update(queue, action.key, {
        status: 'done',
        imageId: action.imageId,
        percent: 100,
        message: undefined,
        canRetry: false,
      });
    case 'failed':
      return update(queue, action.key, {
        status: 'failed',
        message: action.message,
        canRetry: action.canRetry,
      });
    case 'reset':
      return EMPTY_QUEUE;
  }
}

/** How many photos the server confirmed, out of how many were chosen. */
export function photoTally(queue: PhotoQueue): { done: number; failed: number; total: number } {
  return {
    done: queue.photos.filter((photo) => photo.status === 'done').length,
    failed: queue.photos.filter((photo) => photo.status === 'failed').length,
    total: queue.photos.length,
  };
}

/** True while any photo is on its way (so the form must not be left or resubmitted). */
export function isUploading(queue: PhotoQueue): boolean {
  return queue.photos.some((photo) => photo.status === 'sending' || photo.status === 'processing');
}

/** What the shared progress display shows for a photo (nothing before it is sent). */
export function uploadStateOf(photo: Photo): UploadState {
  const fileName = photo.file.name;
  switch (photo.status) {
    case 'selected':
      return { phase: 'idle' };
    case 'sending':
      return {
        phase: 'transferring',
        fileName,
        loaded: photo.loaded,
        total: photo.total,
        percent: photo.percent,
      };
    case 'processing':
      return { phase: 'processing', fileName, total: photo.file.size };
    case 'done':
      return { phase: 'success', fileName, message: 'Photo added to your review.' };
    case 'failed':
      return {
        phase: 'error',
        fileName,
        message: photo.message ?? 'The photo could not be added.',
        canRetry: photo.canRetry,
      };
  }
}
