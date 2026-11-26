import { ApiError } from '@nilzora/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { describeApiError } from '@/lib/errors';
import { SessionEndedError } from '@/auth/session-manager';
import { UploadTransferError } from './native-upload';
import type { TransferProgress } from './progress';

/** Where one upload stands. `processing` begins only once every byte has really been sent. */
export type UploadState =
  | { phase: 'idle' }
  | { phase: 'transferring'; fileName: string; sent: number; total: number; percent: number }
  | { phase: 'processing'; fileName: string; total: number }
  | { phase: 'success'; fileName: string }
  | {
      phase: 'error';
      fileName: string;
      message: string;
      /** True only when nothing can have been saved, so sending it again is safe. */
      canRetry: boolean;
    }
  | { phase: 'cancelled'; fileName: string };

export const IDLE_UPLOAD: UploadState = { phase: 'idle' };

const LOST_BEFORE_SENT =
  'The connection was lost while the picture was being sent. Nothing was saved. Try again.';
const LOST_AFTER_SENT =
  'The connection was lost before Nilzora confirmed the picture. Check your account before trying again.';
const SESSION_ENDED = 'Your session has ended. Sign in again, then try again.';

/** The API's own refusals for pictures, in fixed words (never the server's text). */
const REFUSALS: Partial<Record<string, string>> = {
  image_invalid: 'This picture could not be used. Choose another JPEG, PNG or WebP.',
  unsupported_media_type: 'Upload a JPEG, PNG or WebP picture.',
  payload_too_large: 'This picture is larger than 5 MB. Choose a smaller one.',
  review_photos_locked: 'Photos can only be added soon after a review is posted.',
  review_photo_limit: 'A review keeps at most 4 photos. Remove one to add another.',
  media_unavailable: 'Picture uploads are not available right now. Please try again later.',
  forbidden: 'This account cannot change its pictures right now.',
  not_found: 'This review or photo could not be found.',
};

/** What a failed upload means for the person, and whether trying again is safe. */
export function describeUploadError(error: unknown): { message: string; canRetry: boolean } {
  if (error instanceof UploadTransferError) {
    if (error.kind === 'cancelled' && !error.allSent) {
      return { message: 'Upload cancelled. Nothing was saved.', canRetry: true };
    }
    return error.allSent
      ? { message: LOST_AFTER_SENT, canRetry: false }
      : { message: LOST_BEFORE_SENT, canRetry: true };
  }
  if (error instanceof SessionEndedError) return { message: SESSION_ENDED, canRetry: false };
  if (error instanceof ApiError) {
    const known = REFUSALS[error.code];
    if (known !== undefined) {
      // The server looked at the picture and refused it: choosing another one is safe.
      return { message: known, canRetry: error.status >= 400 && error.status < 500 };
    }
  }
  const described = describeApiError(error);
  // An unconfirmed answer may hide a saved picture, so it is never retried automatically.
  return { message: described.message, canRetry: false };
}

export interface UploadControls {
  onProgress: (progress: TransferProgress) => void;
  onSent: () => void;
  signal: AbortSignal;
}

export interface NativeUpload {
  state: UploadState;
  /** True from the first byte until the server has answered: controls should lock. */
  busy: boolean;
  /**
   * Runs one upload. Ignored while another is running. Resolves with the server's answer, or
   * null when it failed or was cancelled (the state says which).
   */
  start: <T>(fileName: string, run: (controls: UploadControls) => Promise<T>) => Promise<T | null>;
  /** Stops the transfer while bytes are still going out. */
  cancel: () => void;
  reset: () => void;
}

/**
 * Drives one upload's state: real byte progress from the native layer, a separate "processing"
 * step once every byte is sent, and success only when the server's answer arrives. A second
 * start is refused while one is running, leaving the screen cancels the transfer, and a
 * failed upload is never retried automatically.
 */
export function useNativeUpload(): NativeUpload {
  const [state, setState] = useState<UploadState>(IDLE_UPLOAD);
  const running = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      running.current?.abort();
    };
  }, []);

  const show = useCallback((next: UploadState) => {
    if (mounted.current) setState(next);
  }, []);

  const start = useCallback<NativeUpload['start']>(
    async (fileName, run) => {
      if (running.current) return null;
      const controller = new AbortController();
      running.current = controller;
      show({ phase: 'transferring', fileName, sent: 0, total: 0, percent: 0 });
      try {
        const answer = await run({
          signal: controller.signal,
          onProgress: ({ sent, total, percent }) =>
            show({ phase: 'transferring', fileName, sent, total, percent }),
          onSent: () => show({ phase: 'processing', fileName, total: 0 }),
        });
        show({ phase: 'success', fileName });
        return answer;
      } catch (error) {
        if (error instanceof UploadTransferError && error.kind === 'cancelled') {
          show({ phase: 'cancelled', fileName });
        } else {
          show({ phase: 'error', fileName, ...describeUploadError(error) });
        }
        return null;
      } finally {
        running.current = null;
      }
    },
    [show],
  );

  const cancel = useCallback(() => {
    running.current?.abort();
  }, []);

  const reset = useCallback(() => {
    if (!running.current) setState(IDLE_UPLOAD);
  }, []);

  return {
    state,
    busy: state.phase === 'transferring' || state.phase === 'processing',
    start,
    cancel,
    reset,
  };
}
