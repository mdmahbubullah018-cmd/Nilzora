'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { sendBodyWithProgress } from './transport';
import { IDLE_UPLOAD, type UploadState } from './use-progress-upload';

/**
 * One attachment, chosen but not sent.
 *
 * Choosing a file only holds it: nothing reaches the network until `start()` is called, which
 * the UI does from its explicit Upload action. The bytes then travel with the browser's own
 * progress events, the display moves to "processing" once they are all sent, and success is
 * reported only for the server's confirmed answer.
 */
export interface PendingUploadOptions<Value> {
  /** Where this file goes, and the type the route must see in Content-Type. */
  request: (file: File) => { url: string; contentType: string };
  /** Reads a successful answer; returning a string means the server refused the file. */
  read: (body: unknown) => Value | string;
  /** Called once with the server's confirmed value. */
  onUploaded: (value: Value) => void;
  /** For tests. */
  createRequest?: (() => XMLHttpRequest) | undefined;
}

export interface PendingUpload<Value> {
  /** The chosen file, or null. */
  file: File | null;
  /**
   * Renamed for the upload display: the shared progress card reads `fileName`, so a single
   * state shape serves the picker and every other upload in the product.
   */
  state: UploadState;
  select: (file: File) => void;
  clear: () => void;
  /** Starts the transfer and resolves with the confirmed value, or null when it did not land. */
  start: () => Promise<Value | null>;
  cancel: () => void;
}

const LOST = 'The connection was lost before Nilzora confirmed the upload. Try again.';
const LOST_BEFORE_SENT = 'The connection was lost while the file was being sent. Nothing was saved.';

/** The message a refusal carries, without trusting anything else in the body. */
function refusalMessage(body: unknown, status: number): string {
  const error = (body as { error?: { message?: unknown } } | null)?.error;
  const message = typeof error?.message === 'string' ? error.message : '';
  if (message !== '' && message.length <= 200) return message;
  return status === 429
    ? 'Too many uploads in a short time. Wait a moment, then try again.'
    : 'That file could not be uploaded. Try again.';
}

export function usePendingUpload<Value>({
  request,
  read,
  onUploaded,
  createRequest,
}: PendingUploadOptions<Value>): PendingUpload<Value> {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>(IDLE_UPLOAD);
  const running = useRef<AbortController | null>(null);
  const pending = useRef<Promise<Value | null> | null>(null);
  const onUploadedRef = useRef(onUploaded);

  useEffect(() => {
    onUploadedRef.current = onUploaded;
  }, [onUploaded]);

  useEffect(
    () => () => {
      running.current?.abort();
    },
    [],
  );

  const select = useCallback((chosen: File) => {
    // A running transfer is left alone: the picker is disabled while one is in flight.
    if (running.current) return;
    setFile(chosen);
    setState(IDLE_UPLOAD);
  }, []);

  const cancel = useCallback(() => {
    running.current?.abort();
  }, []);

  const clear = useCallback(() => {
    running.current?.abort();
    setFile(null);
    setState(IDLE_UPLOAD);
  }, []);

  const start = useCallback(async (): Promise<Value | null> => {
    if (file === null) return null;
    if (pending.current) return pending.current;

    const controller = new AbortController();
    running.current = controller;
    const target = request(file);
    setState({ phase: 'transferring', fileName: file.name, loaded: 0, total: file.size, percent: 0 });

    const transfer = sendBodyWithProgress({
      url: target.url,
      body: file,
      contentType: target.contentType,
      signal: controller.signal,
      createRequest,
      onProgress: ({ loaded, total, percent }) =>
        setState({ phase: 'transferring', fileName: file.name, loaded, total, percent }),
      onTransferred: () => setState({ phase: 'processing', fileName: file.name, total: file.size }),
    });

    const attempt = transfer.then((outcome): Value | null => {
      running.current = null;
      pending.current = null;

      if (outcome.kind === 'aborted') {
        // Only a cancel the person asked for is reported as one; an unmount is silent.
        setState({ phase: 'idle' });
        return null;
      }
      if (outcome.kind === 'network') {
        setState({
          phase: 'error',
          fileName: file.name,
          message: outcome.transferred ? LOST : LOST_BEFORE_SENT,
          canRetry: !outcome.transferred,
        });
        return null;
      }
      if (outcome.status < 200 || outcome.status >= 300) {
        setState({
          phase: 'error',
          fileName: file.name,
          message: refusalMessage(outcome.body, outcome.status),
          // The route refused the request itself; nothing was stored, so sending it again is safe.
          canRetry: outcome.status < 500,
        });
        return null;
      }

      const value = read(outcome.body);
      if (typeof value === 'string') {
        setState({ phase: 'error', fileName: file.name, message: value, canRetry: true });
        return null;
      }
      setState({
        phase: 'success',
        fileName: file.name,
        message: 'Attached. Send the message when you are ready.',
      });
      setFile(null);
      onUploadedRef.current(value);
      return value;
    });

    pending.current = attempt;
    return attempt;
  }, [createRequest, file, read, request]);

  return { file, state, select, clear, start, cancel };
}
