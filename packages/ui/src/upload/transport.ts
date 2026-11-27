/*
 * Browser upload transport
 * ------------------------
 * Posts a form to one of the admin upload routes with XMLHttpRequest, because `fetch` cannot
 * report how many request bytes have left the browser and an XHR's `upload` events can. The
 * numbers shown to the person come straight from those events; nothing is estimated or timed.
 *
 * What the bytes measure: the browser's transfer to this admin site. Once the last byte is sent
 * the server still has to check the picture, resize it, store it and record it, so the transport
 * reports that as a separate step ("processing") and only a real answer from the server counts
 * as success.
 */

/** Whole percent of `total` that `loaded` covers: 0 until bytes move, 100 only when all did. */
export function percentOf(loaded: number, total: number): number {
  if (!Number.isFinite(loaded) || !Number.isFinite(total) || total <= 0 || loaded <= 0) return 0;
  return Math.min(100, Math.floor((loaded / total) * 100));
}

/** "4.6 MB", "812 KB" or "310 B": the size of a transfer for people. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

/**
 * What an upload route answers with: the same shape as an app's form state, so the browser can
 * show the server's own fixed messages. `success` is the only status that means it worked.
 */
export interface UploadAnswer {
  status: 'idle' | 'error' | 'success' | 'signed_out';
  message?: string;
  fieldErrors?: Partial<Record<string, string>>;
  /** Non-secret values the server echoed back, e.g. the id of a record it created. */
  values?: Partial<Record<string, string>>;
}

export interface TransferProgress {
  loaded: number;
  total: number;
  percent: number;
}

/** How an upload ended. Only `answered` carries a verdict from the server. */
export type UploadOutcome =
  /** The server answered with the form state its action chose (success or a fixed error). */
  | { kind: 'answered'; state: UploadAnswer }
  /** The connection failed. `transferred` says whether every byte had already been sent. */
  | { kind: 'network'; transferred: boolean }
  /** The answer was not an upload answer at all, e.g. the sign-in page after the session ended. */
  | { kind: 'unexpected'; status: number }
  /** The caller cancelled it. */
  | { kind: 'aborted'; transferred: boolean };

export interface SendOptions {
  url: string;
  body: FormData;
  /** Called with real byte counts each time the browser reports transfer progress. */
  onProgress: (progress: TransferProgress) => void;
  /** Called once, when the browser has sent the last byte and is waiting for the server. */
  onTransferred: () => void;
  signal?: AbortSignal | undefined;
  /** For tests; the browser's XMLHttpRequest by default. */
  createRequest?: (() => XMLHttpRequest) | undefined;
}

/**
 * A file sent as the request body itself (the chat attachment routes read the bytes, not a
 * multipart part), which is why the type travels in `Content-Type` instead of a boundary.
 */
export interface SendBodyOptions {
  url: string;
  body: Blob;
  contentType: string;
  onProgress: (progress: TransferProgress) => void;
  onTransferred: () => void;
  signal?: AbortSignal | undefined;
  createRequest?: (() => XMLHttpRequest) | undefined;
}

/** How an upload route answered a raw body: any JSON body, with its real status. */
export type BodyOutcome =
  | { kind: 'answered'; status: number; body: unknown }
  | { kind: 'network'; transferred: boolean }
  | { kind: 'aborted'; transferred: boolean };

const VALID_STATUSES: readonly string[] = ['idle', 'error', 'success', 'signed_out'];

/** A body that looks like a form state, or null (anything else is not from the upload route). */
function parseState(text: string): UploadAnswer | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return null;
    const status = (value as { status?: unknown }).status;
    if (typeof status !== 'string' || !VALID_STATUSES.includes(status)) return null;
    return value as UploadAnswer;
  } catch {
    return null;
  }
}

interface ProgressOptions {
  url: string;
  body: FormData | Blob;
  /** Undefined for a form: the browser writes its own multipart boundary. */
  contentType?: string | undefined;
  onProgress: (progress: TransferProgress) => void;
  onTransferred: () => void;
  signal?: AbortSignal | undefined;
  createRequest?: (() => XMLHttpRequest) | undefined;
}

/** What the browser reported, before the caller reads the answer: raw bytes and their count. */
type RawOutcome =
  | { kind: 'answered'; status: number; text: string }
  | { kind: 'network'; transferred: boolean }
  | { kind: 'aborted'; transferred: boolean };

/**
 * The one place the browser's own byte count is read. `XMLHttpRequest` is used because its
 * upload events are the only browser API that reports how many request bytes have really
 * left; `fetch` cannot. Nothing here estimates, times or invents a percentage.
 */
function sendWithProgress(options: ProgressOptions): Promise<RawOutcome> {
  const { url, body, contentType, onProgress, onTransferred, signal, createRequest } = options;
  return new Promise<RawOutcome>((resolve) => {
    const request = createRequest ? createRequest() : new XMLHttpRequest();
    let transferred = false;
    let settled = false;

    const finish = (outcome: RawOutcome) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolve(outcome);
    };
    const markTransferred = () => {
      if (transferred) return;
      transferred = true;
      onTransferred();
    };
    function onAbort() {
      request.abort();
      finish({ kind: 'aborted', transferred });
    }

    request.upload.onprogress = (event: ProgressEvent) => {
      if (!event.lengthComputable) return;
      onProgress({
        loaded: event.loaded,
        total: event.total,
        percent: percentOf(event.loaded, event.total),
      });
    };
    // Fires when the request body has been fully sent, before the server's answer.
    request.upload.onload = markTransferred;
    request.onerror = () => finish({ kind: 'network', transferred });
    request.ontimeout = () => finish({ kind: 'network', transferred });
    request.onabort = () => finish({ kind: 'aborted', transferred });
    request.onload = () =>
      finish({ kind: 'answered', status: request.status, text: request.responseText });

    if (signal?.aborted) {
      finish({ kind: 'aborted', transferred: false });
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    request.open('POST', url);
    request.setRequestHeader('Accept', 'application/json');
    if (contentType !== undefined) request.setRequestHeader('Content-Type', contentType);
    request.send(body);
  });
}

export async function sendFormWithProgress(options: SendOptions): Promise<UploadOutcome> {
  const outcome = await sendWithProgress({ ...options, contentType: undefined });
  if (outcome.kind !== 'answered') return outcome;

  // A route answers a refusal with a real status and the same form state, so the body decides
  // what the person is told; the status is for logs and monitoring, not for guessing. An
  // error status that claims success is not an answer at all.
  const state = parseState(outcome.text);
  const ok = outcome.status >= 200 && outcome.status < 300;
  const trust = state !== null && (ok || state.status !== 'success');
  return trust && state !== null
    ? { kind: 'answered', state }
    : { kind: 'unexpected', status: outcome.status };
}

/** Sends one file as the body and hands back whatever JSON the route answered, with its status. */
export async function sendBodyWithProgress(options: SendBodyOptions): Promise<BodyOutcome> {
  const outcome = await sendWithProgress(options);
  if (outcome.kind !== 'answered') return outcome;

  let body: unknown = null;
  try {
    body = JSON.parse(outcome.text) as unknown;
  } catch {
    body = null;
  }
  return { kind: 'answered', status: outcome.status, body };
}
