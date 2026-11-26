import { ApiError } from '@nilzora/api-client';
import { UploadTransferError, uploadPictureNative } from '@/uploads/native-upload';
import { FakeUploadTask, lastTask } from '@/test-utils/upload-fakes';

jest.mock(
  'expo-file-system',
  () =>
    jest.requireActual<{ expoFileSystemMock: object }>('@/test-utils/upload-fakes')
      .expoFileSystemMock,
);

beforeEach(() => FakeUploadTask.reset());

function start(overrides: { signal?: AbortSignal; accessToken?: string | null } = {}) {
  const events: string[] = [];
  const progress: { sent: number; total: number; percent: number }[] = [];
  const promise = uploadPictureNative({
    url: 'https://api.example.test/api/v1/me/avatar',
    accessToken: 'token-abc',
    uri: 'file:///cache/me.jpg',
    contentType: 'image/jpeg',
    parse: (body) =>
      typeof body === 'object' && body !== null && 'ok' in body ? { ok: true } : null,
    onProgress: (p) => {
      progress.push(p);
    },
    onSent: () => events.push('sent'),
    ...overrides,
  });
  return { promise, events, progress };
}

describe('uploadPictureNative', () => {
  it('posts the raw picture with the bearer token and its own content type', () => {
    void start().promise.catch(() => undefined);
    const task = lastTask();

    expect(task.uri).toBe('file:///cache/me.jpg');
    expect(task.url).toBe('https://api.example.test/api/v1/me/avatar');
    expect(task.options.httpMethod).toBe('POST');
    expect(task.options.uploadType).toBe(0); // binary body, not multipart
    expect(task.options.headers).toMatchObject({
      Authorization: 'Bearer token-abc',
      'Content-Type': 'image/jpeg',
    });
    // The request names no account.
    expect(JSON.stringify(task.options.headers)).not.toMatch(/user|owner|account/i);
  });

  it('sends no authorization header for a public upload', () => {
    void start({ accessToken: null }).promise.catch(() => undefined);
    const task = lastTask();

    expect(task.options.headers).toMatchObject({ 'Content-Type': 'image/jpeg' });
    expect(task.options.headers).not.toHaveProperty('Authorization');
  });

  it('reports only the bytes the native layer says it sent, and tells "sent" apart from "saved"', async () => {
    const { promise, events, progress } = start();
    const task = lastTask();

    task.progress(0, 4096);
    task.progress(1024, 4096);
    task.progress(4095, 4096);
    expect(progress.map((p) => p.percent)).toEqual([0, 25, 99]);
    expect(events).toEqual([]);

    task.progress(4096, 4096);
    expect(progress[progress.length - 1]?.percent).toBe(100);
    expect(events).toEqual(['sent']);

    // All bytes are out, but nothing is saved until the server answers.
    let settled = false;
    void promise.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    task.answer(200, { ok: true });
    await expect(promise).resolves.toEqual({ ok: true });
    expect(events).toEqual(['sent']); // reported once
    expect(task.release).toHaveBeenCalledTimes(1);
  });

  it('turns the API refusal into the app-wide ApiError with its code', async () => {
    const { promise } = start();
    const task = lastTask();
    task.progress(10, 10);
    task.answer(422, { error: { code: 'image_invalid', message: 'Cannot decode' } });

    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, code: 'image_invalid' });
  });

  it('does not trust a success answer that is not the promised shape', async () => {
    const { promise } = start();
    lastTask().answer(200, { surprise: true });
    await expect(promise).rejects.toMatchObject({ code: 'unexpected_response' });
  });

  it('copes with a proxy page instead of JSON', async () => {
    const { promise } = start();
    lastTask().answer(502, '<html>Bad gateway</html>');
    await expect(promise).rejects.toMatchObject({ status: 502, code: 'unexpected_response' });
  });

  it('says nothing was saved when the connection breaks mid-transfer', async () => {
    const { promise } = start();
    const task = lastTask();
    task.progress(500, 4096);
    task.fail();

    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UploadTransferError);
    expect(error).toMatchObject({ kind: 'network', allSent: false });
  });

  it('marks a break after the last byte as possibly saved', async () => {
    const { promise } = start();
    const task = lastTask();
    task.progress(4096, 4096);
    task.fail();

    await expect(promise).rejects.toMatchObject({ kind: 'network', allSent: true });
  });

  it('cancels through the abort signal', async () => {
    const controller = new AbortController();
    const { promise } = start({ signal: controller.signal });
    lastTask().progress(10, 4096);

    controller.abort();

    await expect(promise).rejects.toMatchObject({ kind: 'cancelled', allSent: false });
    expect(lastTask().release).toHaveBeenCalled();
  });
});
