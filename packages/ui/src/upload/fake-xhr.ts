/*
 * A stand-in for XMLHttpRequest in tests. It does not invent progress: the test calls
 * `progress()`, `transferred()` and `respond()` to play the events a browser would fire, and the
 * code under test must react to exactly those. Used where jsdom has no real network.
 */
export class FakeXhr {
  upload: {
    onprogress: ((event: ProgressEvent) => void) | null;
    onload: (() => void) | null;
  } = { onprogress: null, onload: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = '';
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown = null;
  aborted = false;

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
  send(body: unknown): void {
    this.body = body;
  }
  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  /** The browser reports `loaded` of `total` request bytes sent. */
  progress(loaded: number, total: number, lengthComputable = true): void {
    this.upload.onprogress?.({ lengthComputable, loaded, total } as ProgressEvent);
  }
  /** The browser has sent the last byte and now waits for the server. */
  transferred(): void {
    this.upload.onload?.();
  }
  /** The server answered. */
  respond(status: number, body: unknown): void {
    this.status = status;
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
    this.onload?.();
  }
  /** The connection failed. */
  fail(): void {
    this.onerror?.();
  }

  asRequest(): XMLHttpRequest {
    return this as unknown as XMLHttpRequest;
  }
}
