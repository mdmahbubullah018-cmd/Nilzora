import { ApiError } from '@nilzora/api-client';
import type { ChatAttachmentType, ProductImageContentType } from '@nilzora/contracts';
import { File, UploadType } from 'expo-file-system';
import { percentOf, type TransferProgress } from './progress';

/**
 * Any type this app may upload as a raw body: the picture types the profile and review forms
 * use, plus the documents and recordings a support message may carry. A single union so one
 * transport serves every upload rather than one per feature.
 */
export type UploadContentType = ProductImageContentType | ChatAttachmentType;

/*
 * The native upload transport
 * ---------------------------
 * Sends one picture, as the raw request body, to the API with the platform's own upload task
 * (expo-file-system). The task reports how many bytes the native HTTP layer has really sent,
 * and that is the only number the progress bar ever shows: nothing is estimated or timed.
 *
 * `bytesSent === totalBytes` means the phone has sent everything, not that the picture is
 * saved: the server still has to check, resize and record it. The transport therefore reports
 * that moment separately (`onSent`) and resolves only with the server's own answer.
 */

export type UploadFailureKind =
  /** The server answered with a refusal (an ApiError with its code is thrown instead). */
  | 'refused'
  /** The connection failed or was interrupted. `sent` says whether every byte had gone out. */
  | 'network'
  /** The person stopped it. */
  | 'cancelled';

/** Thrown when the transfer itself failed (not when the server refused the picture). */
export class UploadTransferError extends Error {
  override readonly name = 'UploadTransferError';
  readonly kind: Exclude<UploadFailureKind, 'refused'>;
  /** True when every byte had been sent before the failure, so the server may have saved it. */
  readonly allSent: boolean;

  constructor(kind: Exclude<UploadFailureKind, 'refused'>, allSent: boolean) {
    super(`Upload ${kind}`);
    this.kind = kind;
    this.allSent = allSent;
  }
}

export interface UploadRequest<T> {
  /** The full address, e.g. https://api.example.com/api/v1/me/avatar */
  url: string;
  /** The session's token, or null for a public upload that carries no credentials. */
  accessToken: string | null;
  /** A local picture or file the picker produced (file:// or content://). */
  uri: string;
  contentType: UploadContentType;
  /** Reads the server's success answer; null when it is not the shape the contract promises. */
  parse: (body: unknown) => T | null;
  signal?: AbortSignal | undefined;
  /** Called with the native layer's real byte counts. */
  onProgress: (progress: TransferProgress) => void;
  /** Called once, when every byte has been sent and the server is working. */
  onSent: () => void;
}

/** A refusal in the API's error envelope, as the same ApiError the rest of the app handles. */
function refusalFrom(status: number, body: string): ApiError {
  let code = 'unexpected_response';
  let message = 'The server could not process the picture.';
  try {
    const parsed: unknown = JSON.parse(body);
    const error = (parsed as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    if (typeof error?.code === 'string') code = error.code;
    if (typeof error?.message === 'string') message = error.message;
  } catch {
    // Not JSON (a proxy's page, for instance): keep the generic refusal.
  }
  return new ApiError(status, code, message);
}

export async function uploadPictureNative<T>(request: UploadRequest<T>): Promise<T> {
  let totalSeen = 0;
  let sentSeen = 0;
  let sentReported = false;
  const reportSent = () => {
    if (sentReported) return;
    sentReported = true;
    request.onSent();
  };

  const task = new File(request.uri).createUploadTask(request.url, {
    httpMethod: 'POST',
    uploadType: UploadType.BINARY_CONTENT,
    headers: {
      ...(request.accessToken === null ? {} : { Authorization: `Bearer ${request.accessToken}` }),
      'Content-Type': request.contentType,
      Accept: 'application/json',
    },
    ...(request.signal ? { signal: request.signal } : {}),
    onProgress: ({ bytesSent, totalBytes }) => {
      sentSeen = bytesSent;
      totalSeen = totalBytes;
      request.onProgress({
        sent: bytesSent,
        total: totalBytes,
        percent: percentOf(bytesSent, totalBytes),
      });
      if (totalBytes > 0 && bytesSent >= totalBytes) reportSent();
    },
  });

  let result;
  try {
    result = await task.uploadAsync();
  } catch (error) {
    const cancelled =
      request.signal?.aborted === true ||
      (error as { name?: unknown } | null)?.name === 'AbortError';
    const allSent = totalSeen > 0 && sentSeen >= totalSeen;
    throw new UploadTransferError(cancelled ? 'cancelled' : 'network', allSent);
  } finally {
    task.release();
  }

  // The request finished: the bytes are certainly all sent, whatever the last event said.
  reportSent();
  if (result.status < 200 || result.status >= 300) throw refusalFrom(result.status, result.body);
  let body: unknown;
  try {
    body = JSON.parse(result.body);
  } catch {
    throw refusalFrom(result.status, '');
  }
  const parsed = request.parse(body);
  if (parsed === null) throw refusalFrom(result.status, '');
  return parsed;
}
