/*
 * A stand-in for the browser's XMLHttpRequest in component tests. It invents nothing: each test
 * plays the events a real request would fire (`progress`, `transferred`, `answer`, `fail`) and the
 * code under test must react to exactly those.
 */
export class FakeXhr {
  static all: FakeXhr[] = [];

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
  url = '';
  body: FormData | null = null;
  /** Exactly what send() was handed: a form for the picture routes, a file for chat. */
  sent: unknown = null;
  /** Headers the request set, so a test can assert the type a route will see. */
  headers: Record<string, string> = {};
  aborted = false;

  constructor() {
    FakeXhr.all.push(this);
  }

  static reset(): void {
    FakeXhr.all = [];
  }

  open(_method: string, url: string): void {
    this.url = url;
  }
  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
  send(body: FormData): void {
    this.body = body;
    this.sent = body;
  }
  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  /** The browser reports `loaded` of `total` request bytes sent. */
  progress(loaded: number, total: number): void {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }
  /** Every byte is sent; the server has not answered yet. */
  transferred(): void {
    this.upload.onload?.();
  }
  /** The server answered with this form state. */
  answer(body: object | string, status = 200): void {
    this.status = status;
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
    this.onload?.();
  }
  /** The connection failed. */
  fail(): void {
    this.onerror?.();
  }
}
