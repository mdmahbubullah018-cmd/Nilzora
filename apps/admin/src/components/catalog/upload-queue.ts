'use client';

import { sendFormWithProgress, type SendOptions, type UploadAnswer } from '@nilzora/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { checkReportedFile } from './image-upload';

/*
 * A queue of picture uploads to one of the admin's upload routes. Files are sent one at a
 * time with real byte progress (XMLHttpRequest upload events), each through the same
 * Server Action the page's no-JavaScript form uses, so the origin, CSRF, file and
 * permission checks all run on the server for every file. Only the server's own answer
 * counts as success.
 */

export type QueueStatus = 'ready' | 'transferring' | 'processing' | 'done' | 'error';

export interface QueueItem {
  key: string;
  /** What will be sent: the picked file, or its crop. */
  file: File;
  /** The file as picked, so a crop can always start again from it. */
  original: File;
  cropped: boolean;
  alt: string;
  status: QueueStatus;
  loaded: number;
  total: number;
  percent: number;
  message?: string;
  /** True only when nothing can have reached the server, so sending again is safe. */
  canRetry?: boolean;
}

export interface QueueRejection {
  name: string;
  message: string;
}

const LOST_BEFORE_SENT =
  'The connection was lost while the file was being sent. Nothing was saved. Try again.';
const LOST_AFTER_SENT =
  'The connection was lost before Nilzora confirmed the upload. Reload the page and check before trying again.';
const SESSION_ENDED =
  'Your session may have ended, so the upload could not be confirmed. Sign in again, then check before trying again.';
const CANCELLED = 'Upload cancelled. Nothing was saved.';

export interface UploadQueueOptions {
  /** The same-origin upload route, e.g. /api/uploads/product-image. */
  endpoint: string;
  /** Fields every upload carries (CSRF token, record id). */
  fields: () => Record<string, string>;
  /** Extra fields per file (e.g. its description and name). */
  fileFields?: (item: QueueItem) => Record<string, string>;
  /** How many more files fit (e.g. a product's remaining picture slots). */
  capacity?: number;
  /** After each upload the server confirmed. */
  onUploaded?: (item: QueueItem, answer: UploadAnswer) => void;
  /** Once the queue has run dry, with the number of files uploaded in that run. */
  onFinished?: (uploaded: number) => void;
  /** For tests; the browser's XMLHttpRequest by default. */
  createRequest?: SendOptions['createRequest'];
}

let sequence = 0;

export function useUploadQueue({
  endpoint,
  fields,
  fileFields,
  capacity,
  onUploaded,
  onFinished,
  createRequest,
}: UploadQueueOptions) {
  const [items, setItemsState] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const current = useRef<QueueItem[]>([]);
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const options = useRef({ fields, fileFields, onUploaded, onFinished, createRequest, endpoint });

  useEffect(() => {
    options.current = { fields, fileFields, onUploaded, onFinished, createRequest, endpoint };
  });

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  const commit = useCallback((next: QueueItem[]) => {
    current.current = next;
    setItemsState(next);
  }, []);

  const update = useCallback(
    (key: string, patch: Partial<QueueItem>) => {
      commit(current.current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
    },
    [commit],
  );

  /** Adds picked or dropped files; the ones that cannot be sent are returned with why. */
  const add = useCallback(
    (files: readonly File[]): QueueRejection[] => {
      const rejections: QueueRejection[] = [];
      const waiting = current.current.filter((item) => item.status !== 'done').length;
      let room = capacity === undefined ? Number.POSITIVE_INFINITY : capacity - waiting;
      const added: QueueItem[] = [];
      for (const file of files) {
        const refusal = checkReportedFile(file);
        if (refusal) {
          rejections.push({ name: file.name, message: refusal });
          continue;
        }
        if (room <= 0) {
          rejections.push({
            name: file.name,
            message:
              capacity !== undefined && capacity - waiting <= 0
                ? 'There is no room for more pictures. Remove one first.'
                : 'There is no room for this picture: the limit is reached.',
          });
          continue;
        }
        room -= 1;
        sequence += 1;
        added.push({
          key: `upload-${String(sequence)}`,
          file,
          original: file,
          cropped: false,
          alt: '',
          status: 'ready',
          loaded: 0,
          total: file.size,
          percent: 0,
        });
      }
      if (added.length > 0) commit([...current.current, ...added]);
      return rejections;
    },
    [capacity, commit],
  );

  const remove = useCallback(
    (key: string) => {
      const item = current.current.find((candidate) => candidate.key === key);
      if (!item || item.status === 'transferring' || item.status === 'processing') return;
      commit(current.current.filter((candidate) => candidate.key !== key));
    },
    [commit],
  );

  const sendOne = useCallback(
    async (item: QueueItem): Promise<boolean> => {
      const { fields: base, fileFields: extra, endpoint: url, createRequest: create } =
        options.current;
      const body = new FormData();
      for (const [name, value] of Object.entries(base())) body.set(name, value);
      for (const [name, value] of Object.entries(extra?.(item) ?? {})) body.set(name, value);
      body.set('image', item.file, item.file.name);

      const abort = new AbortController();
      controller.current = abort;
      update(item.key, {
        status: 'transferring',
        loaded: 0,
        total: item.file.size,
        percent: 0,
        message: undefined,
        canRetry: undefined,
      });
      const outcome = await sendFormWithProgress({
        url,
        body,
        signal: abort.signal,
        createRequest: create,
        onProgress: ({ loaded, total, percent }) =>
          update(item.key, { status: 'transferring', loaded, total, percent }),
        onTransferred: () => update(item.key, { status: 'processing', percent: 100 }),
      });
      controller.current = null;

      if (outcome.kind === 'aborted') {
        update(item.key, {
          status: 'error',
          message: outcome.transferred ? LOST_AFTER_SENT : CANCELLED,
          canRetry: !outcome.transferred,
        });
        return false;
      }
      if (outcome.kind === 'network') {
        update(item.key, {
          status: 'error',
          message: outcome.transferred ? LOST_AFTER_SENT : LOST_BEFORE_SENT,
          canRetry: !outcome.transferred,
        });
        return false;
      }
      if (outcome.kind === 'unexpected') {
        update(item.key, { status: 'error', message: SESSION_ENDED, canRetry: false });
        return false;
      }
      const answer = outcome.state;
      if (answer.status === 'success') {
        update(item.key, { status: 'done', message: answer.message ?? 'Uploaded.' });
        const done = current.current.find((candidate) => candidate.key === item.key);
        if (done) options.current.onUploaded?.(done, answer);
        return true;
      }
      update(item.key, {
        status: 'error',
        message:
          answer.fieldErrors?.image ??
          answer.message ??
          (answer.status === 'signed_out' ? SESSION_ENDED : 'The upload was not accepted.'),
        // The server looked at the file and refused it: choosing a corrected file is safe.
        canRetry: answer.status === 'error',
      });
      return false;
    },
    [update],
  );

  /** Sends every waiting file, one after the other. */
  const start = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    let uploaded = 0;
    for (;;) {
      const next = current.current.find((item) => item.status === 'ready');
      if (!next) break;
      if (await sendOne(next)) uploaded += 1;
    }
    running.current = false;
    setBusy(false);
    if (uploaded > 0) options.current.onFinished?.(uploaded);
  }, [sendOne]);

  /** Sends one failed file again (only offered when that is safe). */
  const retry = useCallback(
    (key: string) => {
      update(key, { status: 'ready', message: undefined, canRetry: undefined });
      void start();
    },
    [start, update],
  );

  /** Stops the transfer in progress; later files stay waiting. */
  const cancel = useCallback(() => {
    controller.current?.abort();
  }, []);

  /** Drops the files that finished, e.g. once the page lists them. */
  const clearDone = useCallback(() => {
    commit(current.current.filter((item) => item.status !== 'done'));
  }, [commit]);

  return { items, busy, add, remove, retry, start, cancel, update, clearDone };
}

export type UploadQueue = ReturnType<typeof useUploadQueue>;
