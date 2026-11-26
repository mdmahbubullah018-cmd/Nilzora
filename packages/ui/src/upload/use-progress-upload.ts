'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  sendFormWithProgress,
  type SendOptions,
  type TransferProgress,
  type UploadAnswer,
} from './transport';

/** Where an upload stands. `processing` begins only once every byte has really been sent. */
export type UploadState =
  | { phase: 'idle' }
  | { phase: 'transferring'; fileName: string; loaded: number; total: number; percent: number }
  | { phase: 'processing'; fileName: string; total: number }
  | { phase: 'success'; fileName: string; message: string }
  | {
      phase: 'error';
      fileName: string;
      message: string;
      fieldErrors?: UploadAnswer['fieldErrors'];
      /** Non-secret values the server echoed, e.g. the id of a record that was created. */
      values?: UploadAnswer['values'];
      /** True only when nothing can have reached the server, so sending it again is safe. */
      canRetry: boolean;
    };

export const IDLE_UPLOAD: UploadState = { phase: 'idle' };

const SESSION_ENDED =
  'Your session may have ended, so the upload could not be confirmed. Sign in again, then check before trying again.';
const LOST_BEFORE_SENT =
  'The connection was lost while the file was being sent. Nothing was saved. Try again.';
const LOST_AFTER_SENT =
  'The connection was lost before Nilzora confirmed the upload. Reload the page and check for the image before trying again.';

export interface UseProgressUploadOptions {
  /** The same-origin upload route, e.g. /api/uploads/brand-logo. */
  endpoint: string;
  /** Runs once the server confirmed the whole operation (the picture is stored and recorded). */
  onSuccess: (state: UploadAnswer) => void;
  /** For tests. */
  createRequest?: SendOptions['createRequest'];
}

export interface ProgressUpload {
  state: UploadState;
  /** True from the first byte until the server has answered: the form should be locked. */
  busy: boolean;
  /** Sends the form's fields and file. Ignored while another send is running. */
  send: (form: HTMLFormElement, file: { name: string; size: number }) => void;
  cancel: () => void;
  reset: () => void;
}

/**
 * Drives one upload form: real byte progress while sending, a distinct "processing" step while
 * the server checks and stores the picture, and success only after the server's own answer. A
 * second send is refused while one is running, and an unmounting form cancels its transfer.
 */
export function useProgressUpload({
  endpoint,
  onSuccess,
  createRequest,
}: UseProgressUploadOptions): ProgressUpload {
  const [state, setState] = useState<UploadState>(IDLE_UPLOAD);
  const running = useRef<AbortController | null>(null);
  const onSuccessRef = useRef(onSuccess);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(
    () => () => {
      running.current?.abort();
    },
    [],
  );

  const send = useCallback<ProgressUpload['send']>(
    (form, file) => {
      if (running.current) return;
      const controller = new AbortController();
      running.current = controller;
      const fileName = file.name;
      setState({ phase: 'transferring', fileName, loaded: 0, total: file.size, percent: 0 });

      const onProgress = ({ loaded, total, percent }: TransferProgress) => {
        setState({ phase: 'transferring', fileName, loaded, total, percent });
      };
      const onTransferred = () => {
        setState({ phase: 'processing', fileName, total: file.size });
      };

      void sendFormWithProgress({
        url: endpoint,
        body: new FormData(form),
        onProgress,
        onTransferred,
        signal: controller.signal,
        createRequest,
      }).then((outcome) => {
        running.current = null;
        if (outcome.kind === 'aborted') {
          // Unmounted or cancelled: the form is gone or reset, so there is nothing to show.
          if (controller.signal.aborted) setState(IDLE_UPLOAD);
          return;
        }
        if (outcome.kind === 'network') {
          setState({
            phase: 'error',
            fileName,
            message: outcome.transferred ? LOST_AFTER_SENT : LOST_BEFORE_SENT,
            canRetry: !outcome.transferred,
          });
          return;
        }
        if (outcome.kind === 'unexpected') {
          setState({ phase: 'error', fileName, message: SESSION_ENDED, canRetry: false });
          return;
        }
        const answer = outcome.state;
        if (answer.status === 'success') {
          setState({
            phase: 'success',
            fileName,
            message: answer.message ?? 'Image uploaded successfully.',
          });
          onSuccessRef.current(answer);
          return;
        }
        setState({
          phase: 'error',
          fileName,
          message:
            answer.message ??
            (answer.status === 'signed_out' ? SESSION_ENDED : 'The upload was not accepted.'),
          fieldErrors: answer.fieldErrors,
          values: answer.values,
          // The server looked at the file and refused it: choosing a corrected file is safe.
          canRetry: answer.status === 'error',
        });
      });
    },
    [endpoint, createRequest],
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
    send,
    cancel,
    reset,
  };
}
