import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import type { R2Config } from '../config/env';
import {
  createMemoryObjectStore,
  createR2ObjectStore,
  r2ClientOptions,
} from '../modules/media/object-store';

const CONFIG: R2Config = {
  accountId: '0123456789abcdef0123456789abcdef',
  accessKeyId: 'AKIATESTTESTTEST',
  secretAccessKey: 'test-secret-not-real',
  bucket: 'nilzora-test',
  publicBaseUrl: 'https://media.example.com',
};

describe('createR2ObjectStore', () => {
  it('puts an object with its type, cache policy and length into the configured bucket', async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = createR2ObjectStore(CONFIG, { send });
    const body = Buffer.from('webp-bytes');

    await store.put({
      key: 'products/p/i/full.webp',
      body,
      contentType: 'image/webp',
      cacheControl: 'public, max-age=31536000, immutable',
    });

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]?.[0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'nilzora-test',
      Key: 'products/p/i/full.webp',
      Body: body,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
      ContentLength: body.length,
    });
  });

  it('propagates a failed put', async () => {
    const store = createR2ObjectStore(CONFIG, {
      send: vi.fn().mockRejectedValue(new Error('403')),
    });

    await expect(
      store.put({ key: 'k', body: Buffer.from('x'), contentType: 'image/webp', cacheControl: 'x' }),
    ).rejects.toThrow('403');
  });

  it('deletes every key with its own DeleteObject call', async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = createR2ObjectStore(CONFIG, { send });

    await store.deleteMany(['a/full.webp', 'a/thumb.webp']);

    const commands = send.mock.calls.map((call) => call[0] as DeleteObjectCommand);
    expect(commands.every((command) => command instanceof DeleteObjectCommand)).toBe(true);
    expect(commands.map((command) => command.input)).toEqual([
      { Bucket: 'nilzora-test', Key: 'a/full.webp' },
      { Bucket: 'nilzora-test', Key: 'a/thumb.webp' },
    ]);
  });

  it('still tries every key when one delete fails, then reports the failure', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({});
    const store = createR2ObjectStore(CONFIG, { send });

    await expect(store.deleteMany(['a/full.webp', 'a/thumb.webp'])).rejects.toBeInstanceOf(
      AggregateError,
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('builds a real client without calling the network at construction', () => {
    expect(() => createR2ObjectStore(CONFIG)).not.toThrow();
  });

  it('refuses an account id that cannot produce an endpoint', () => {
    expect(() => createR2ObjectStore({ ...CONFIG, accountId: 'not-an-account' })).toThrow(
      /R2_ACCOUNT_ID/,
    );
  });
});

describe('r2ClientOptions', () => {
  it('derives the S3 endpoint from the account id and keeps the region R2 expects', () => {
    expect(r2ClientOptions(CONFIG)).toEqual({
      region: 'auto',
      endpoint: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
      credentials: {
        accessKeyId: CONFIG.accessKeyId,
        secretAccessKey: CONFIG.secretAccessKey,
      },
      forcePathStyle: false,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  });

  it('never takes the S3 endpoint from the public base URL', () => {
    const options = r2ClientOptions({ ...CONFIG, publicBaseUrl: 'https://cdn.example.com' });

    expect(options.endpoint).not.toContain('cdn.example.com');
    expect(options.endpoint.endsWith('.r2.cloudflarestorage.com')).toBe(true);
  });
});

describe('createMemoryObjectStore', () => {
  it('stores and deletes objects', async () => {
    const store = createMemoryObjectStore();
    await store.put({
      key: 'a',
      body: Buffer.from('1'),
      contentType: 'image/webp',
      cacheControl: 'x',
    });
    await store.put({
      key: 'b',
      body: Buffer.from('2'),
      contentType: 'image/webp',
      cacheControl: 'x',
    });

    await store.deleteMany(['a', 'missing']);

    expect([...store.objects.keys()]).toEqual(['b']);
  });
});
