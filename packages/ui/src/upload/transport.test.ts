import { describe, expect, it, vi } from 'vitest';
import { FakeXhr } from './fake-xhr';
import {
  formatBytes,
  percentOf,
  sendBodyWithProgress,
  sendFormWithProgress,
  type BodyOutcome,
  type TransferProgress,
  type UploadOutcome,
} from './transport';

describe('percentOf', () => {
  it('is the share of bytes sent, rounded down', () => {
    expect(percentOf(0, 1000)).toBe(0);
    expect(percentOf(460, 1000)).toBe(46);
    expect(percentOf(999, 1000)).toBe(99);
    expect(percentOf(1000, 1000)).toBe(100);
    expect(percentOf(4_600_000, 10_000_000)).toBe(46);
  });

  it('reaches 100 only when every byte is sent', () => {
    expect(percentOf(9_999_999, 10_000_000)).toBe(99);
    expect(percentOf(10_000_000, 10_000_000)).toBe(100);
  });

  it('never leaves 0..100 or returns a non-number', () => {
    expect(percentOf(2000, 1000)).toBe(100);
    expect(percentOf(-5, 1000)).toBe(0);
    expect(percentOf(50, 0)).toBe(0);
    expect(percentOf(Number.NaN, 100)).toBe(0);
    expect(percentOf(10, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('formatBytes', () => {
  it('writes sizes people can read', () => {
    expect(formatBytes(310)).toBe('310 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(4_823_449)).toBe('4.6 MB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB');
    expect(formatBytes(-1)).toBe('');
  });
});

function start(overrides: Partial<Parameters<typeof sendFormWithProgress>[0]> = {}) {
  const xhr = new FakeXhr();
  const progress: TransferProgress[] = [];
  const onTransferred = vi.fn();
  const body = new FormData();
  const done: { outcome?: UploadOutcome } = {};
  const promise = sendFormWithProgress({
    url: '/api/uploads/brand-logo',
    body,
    onProgress: (p) => progress.push(p),
    onTransferred,
    createRequest: () => xhr.asRequest(),
    ...overrides,
  }).then((outcome) => {
    done.outcome = outcome;
    return outcome;
  });
  return { xhr, progress, onTransferred, body, done, promise };
}

describe('sendFormWithProgress', () => {
  it('posts the form to the route and asks for JSON', () => {
    const { xhr, body } = start();

    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/uploads/brand-logo');
    expect(xhr.headers.Accept).toBe('application/json');
    expect(xhr.body).toBe(body);
  });

  it('reports exactly the byte counts the browser fires, with their percentage', () => {
    const { xhr, progress } = start();

    xhr.progress(1_000_000, 4_000_000);
    xhr.progress(3_000_000, 4_000_000);

    expect(progress).toEqual([
      { loaded: 1_000_000, total: 4_000_000, percent: 25 },
      { loaded: 3_000_000, total: 4_000_000, percent: 75 },
    ]);
  });

  it('ignores events whose total is unknown instead of guessing', () => {
    const { xhr, progress } = start();

    xhr.progress(500, 0, false);

    expect(progress).toEqual([]);
  });

  it('does not call the transfer finished until the browser says every byte was sent', () => {
    const { xhr, onTransferred } = start();

    xhr.progress(900, 1000);
    expect(onTransferred).not.toHaveBeenCalled();
    xhr.transferred();
    xhr.transferred();
    expect(onTransferred).toHaveBeenCalledTimes(1);
  });

  it("resolves with the server's answer only after the server responds", async () => {
    const { xhr, done, promise } = start();

    xhr.progress(1000, 1000);
    xhr.transferred();
    await Promise.resolve();
    expect(done.outcome).toBeUndefined();

    xhr.respond(200, { status: 'success', message: 'Logo updated.' });
    await expect(promise).resolves.toEqual({
      kind: 'answered',
      state: { status: 'success', message: 'Logo updated.' },
    });
  });

  it("passes on the action's fixed refusal messages", async () => {
    const { xhr, promise } = start();
    xhr.transferred();
    xhr.respond(200, {
      status: 'error',
      message: 'This image is larger than 5 MB.',
      fieldErrors: { image: 'Too big' },
    });

    await expect(promise).resolves.toMatchObject({
      kind: 'answered',
      state: { status: 'error', fieldErrors: { image: 'Too big' } },
    });
  });

  it('treats a failed request or an HTML page as something other than an answer', async () => {
    const html = start();
    html.xhr.transferred();
    html.xhr.respond(200, '<!doctype html><title>Sign in</title>');
    await expect(html.promise).resolves.toEqual({ kind: 'unexpected', status: 200 });

    const server = start();
    server.xhr.transferred();
    server.xhr.respond(500, { status: 'success' });
    await expect(server.promise).resolves.toEqual({ kind: 'unexpected', status: 500 });
  });

  it("shows the server's own message when a refusal carries its real status", async () => {
    const refused = start();
    refused.xhr.transferred();
    refused.xhr.respond(422, { status: 'error', message: 'This picture is too small.' });
    await expect(refused.promise).resolves.toEqual({
      kind: 'answered',
      state: { status: 'error', message: 'This picture is too small.' },
    });

    const expired = start();
    expired.xhr.transferred();
    expired.xhr.respond(403, { status: 'error', message: 'This form has expired.' });
    await expect(expired.promise).resolves.toMatchObject({ kind: 'answered' });
  });

  it('says whether the bytes were all sent when the connection fails', async () => {
    const early = start();
    early.xhr.progress(100, 1000);
    early.xhr.fail();
    await expect(early.promise).resolves.toEqual({ kind: 'network', transferred: false });

    const late = start();
    late.xhr.progress(1000, 1000);
    late.xhr.transferred();
    late.xhr.fail();
    await expect(late.promise).resolves.toEqual({ kind: 'network', transferred: true });
  });

  it('cancels the request when asked and settles only once', async () => {
    const controller = new AbortController();
    const { xhr, promise } = start({ signal: controller.signal });
    xhr.progress(10, 1000);

    controller.abort();

    expect(xhr.aborted).toBe(true);
    await expect(promise).resolves.toEqual({ kind: 'aborted', transferred: false });
    xhr.respond(200, { status: 'success' });
  });

  it('does not send anything when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { xhr, promise } = start({ signal: controller.signal });

    await expect(promise).resolves.toEqual({ kind: 'aborted', transferred: false });
    expect(xhr.body).toBeNull();
  });
});

function startBody(overrides: Partial<Parameters<typeof sendBodyWithProgress>[0]> = {}) {
  const xhr = new FakeXhr();
  const progress: TransferProgress[] = [];
  const onTransferred = vi.fn();
  const file = new File([new Uint8Array(2_000_000)], 'photo.png', { type: 'image/png' });
  const done: { outcome?: BodyOutcome } = {};
  const promise = sendBodyWithProgress({
    url: '/api/support/attachments?conversationId=c1',
    body: file,
    contentType: 'image/png',
    onProgress: (p) => progress.push(p),
    onTransferred,
    createRequest: () => xhr.asRequest(),
    ...overrides,
  }).then((outcome) => {
    done.outcome = outcome;
    return outcome;
  });
  return { xhr, progress, onTransferred, file, done, promise };
}

describe('sendBodyWithProgress', () => {
  it('sends the file itself, with the type the route expects', () => {
    const { xhr, file } = startBody();

    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/support/attachments?conversationId=c1');
    expect(xhr.headers['Content-Type']).toBe('image/png');
    expect(xhr.headers.Accept).toBe('application/json');
    // A raw body, not a multipart form: the route reads the bytes.
    expect(xhr.body).toBe(file);
  });

  it('reports the browser byte counts and the moment every byte is sent', () => {
    const { xhr, progress, onTransferred } = startBody();

    xhr.progress(500_000, 2_000_000);
    xhr.progress(2_000_000, 2_000_000);
    xhr.transferred();

    expect(progress.map((p) => p.percent)).toEqual([25, 100]);
    expect(onTransferred).toHaveBeenCalledTimes(1);
  });

  it('hands back the JSON body and the real status, successful or not', async () => {
    const created = startBody();
    created.xhr.respond(201, { id: 'attachment-1' });
    await expect(created.promise).resolves.toEqual({
      kind: 'answered',
      status: 201,
      body: { id: 'attachment-1' },
    });

    const refused = startBody();
    refused.xhr.respond(413, { error: { code: 'payload_too_large', message: 'Too large.' } });
    await expect(refused.promise).resolves.toMatchObject({
      kind: 'answered',
      status: 413,
      body: { error: { message: 'Too large.' } },
    });
  });

  it('leaves a non-JSON answer as a null body rather than inventing one', async () => {
    const { xhr, promise } = startBody();

    xhr.respond(502, '<html>gateway</html>');

    await expect(promise).resolves.toEqual({ kind: 'answered', status: 502, body: null });
  });

  it('reports a lost connection and whether every byte had been sent', async () => {
    const early = startBody();
    early.xhr.progress(100, 2_000_000);
    early.xhr.fail();
    await expect(early.promise).resolves.toEqual({ kind: 'network', transferred: false });

    const late = startBody();
    late.xhr.transferred();
    late.xhr.fail();
    await expect(late.promise).resolves.toEqual({ kind: 'network', transferred: true });
  });

  it('stops on an abort without pretending the file landed', async () => {
    const controller = new AbortController();
    const running = startBody({ signal: controller.signal });

    controller.abort();

    await expect(running.promise).resolves.toEqual({ kind: 'aborted', transferred: false });
  });
});