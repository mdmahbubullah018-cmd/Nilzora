import type { ChatReplySummary } from '@nilzora/contracts';
import { sendBodyWithProgress } from '@nilzora/ui';

/*
 * Uploading one chosen file
 * -------------------------
 * The browser sends the file itself to this app's `/api/support/attachments` route with
 * XMLHttpRequest, because only an XHR reports how many request bytes have really left the browser.
 * That number is the browser's transfer to this site; once the last byte is out the server still
 * checks, re-encodes and stores the file, which is reported as a separate "processing" step rather
 * than a made-up percentage.
 */

export type ChatFileKind = 'image' | 'document' | 'audio';

/** One file the customer has chosen but not sent. Nothing here has been uploaded yet. */
export interface SelectedChatFile {
  /** Stable in this browser only, so a file can be removed from the row by identity. */
  localId: string;
  file: File;
  name: string;
  kind: ChatFileKind;
  /** A recording's length; null for every other kind. */
  durationMs: number | null;
}

export type FileUploadState =
  | { status: 'queued'; percent: null; attachmentId: null; error: null }
  | { status: 'uploading'; percent: number; attachmentId: null; error: null }
  | { status: 'processing'; percent: 100; attachmentId: null; error: null }
  | { status: 'uploaded'; percent: 100; attachmentId: string; error: null }
  | { status: 'failed'; percent: null; attachmentId: null; error: string };

export const QUEUED: FileUploadState = {
  status: 'queued',
  percent: null,
  attachmentId: null,
  error: null,
};

/**
 * A message the customer has written that the API has not confirmed yet.
 *
 * It is on screen from the keystroke. The `clientMessageId` is generated once and reused by every
 * retry: the API stores it beside the message and answers a repeat with the copy it already has.
 * `fileStates` remembers which files already landed, so a retry uploads only what is missing and,
 * when every file landed but the post failed, posts again without uploading anything.
 */
export interface Outgoing {
  clientMessageId: string;
  body: string;
  files: SelectedChatFile[];
  fileStates: Record<string, FileUploadState>;
  reply: ChatReplySummary | null;
  createdAt: string;
  state: 'sending' | 'failed';
  error: string | null;
}

export type ApiResult<T> =
  { ok: true; value: T } | { ok: false; status: number; code: string | null; message: string };

export const CONNECTION_MESSAGE = 'Check your connection and try again.';

/** The sentence for a failed upload, from the API's fixed code or, failing that, the status. */
export function uploadFailureMessage(
  status: number,
  code: string | null,
  serverMessage: string | null,
): string {
  if (status === 413) return 'That file is too large to send.';
  if (status === 408 || status === 504) return 'The upload took too long. Try again.';
  if (status === 429 || code === 'rate_limited')
    return 'You are uploading too quickly. Wait a moment.';
  if (serverMessage !== null && serverMessage !== '') return serverMessage;
  return 'That file could not be uploaded. Try again.';
}

export type UploadProgress = (progress: { percent: number; processing: boolean }) => void;

/** Uploads one chosen file and answers with the id of the attachment record the route created. */
export async function uploadChosenFile(
  conversationId: string,
  entry: SelectedChatFile,
  onProgress: UploadProgress,
): Promise<ApiResult<{ id: string; fileName: string }>> {
  const contentType = (entry.file.type || '').split(';')[0]?.trim().toLowerCase() ?? '';
  const query = new URLSearchParams({ conversationId, fileName: entry.name });
  if (entry.kind === 'audio' && entry.durationMs !== null) {
    query.set('durationMs', String(Math.max(1, Math.round(entry.durationMs))));
  }
  const outcome = await sendBodyWithProgress({
    url: `/api/support/attachments?${query.toString()}`,
    body: entry.file,
    contentType,
    onProgress: (progress) => onProgress({ percent: progress.percent, processing: false }),
    onTransferred: () => onProgress({ percent: 100, processing: true }),
  });

  if (outcome.kind !== 'answered') {
    return {
      ok: false,
      status: 0,
      code: null,
      message: outcome.transferred
        ? 'The connection dropped while the file was being processed. Try again.'
        : CONNECTION_MESSAGE,
    };
  }
  const payload = outcome.body as {
    id?: unknown;
    fileName?: unknown;
    error?: { code?: unknown; message?: unknown };
  } | null;
  if (outcome.status < 200 || outcome.status >= 300) {
    return {
      ok: false,
      status: outcome.status,
      code: typeof payload?.error?.code === 'string' ? payload.error.code : null,
      message: uploadFailureMessage(
        outcome.status,
        typeof payload?.error?.code === 'string' ? payload.error.code : null,
        typeof payload?.error?.message === 'string' ? payload.error.message : null,
      ),
    };
  }
  if (typeof payload?.id !== 'string' || typeof payload.fileName !== 'string') {
    return {
      ok: false,
      status: 0,
      code: null,
      message: 'That file could not be uploaded. Try again.',
    };
  }
  return { ok: true, value: { id: payload.id, fileName: payload.fileName } };
}
