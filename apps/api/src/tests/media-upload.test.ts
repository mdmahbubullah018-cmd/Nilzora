import type { Response } from 'express';
import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { IMAGE_CACHE_CONTROL, createMemoryObjectStore } from '../modules/media/object-store';
import { variantKeys } from '../modules/media/images';
import { createPictureUploads } from '../modules/media/upload';
import { failingObjectStore, makeImage } from './media-fakes';

/**
 * The shared picture pipeline every upload feature goes through (products, categories,
 * brands, banners, the media library, avatars, review photos, chat attachments). The route
 * suites cover each feature end to end; these tests pin the rules the features rely on.
 */

function fakeResponse(warn = vi.fn()): Response & { sent: { status: number; body: unknown }[] } {
  const sent: { status: number; body: unknown }[] = [];
  const res = {
    locals: {},
    sent,
    req: { log: { warn } },
    status(code: number) {
      return {
        json(body: unknown) {
          sent.push({ status: code, body });
        },
      };
    },
  };
  return res as unknown as Response & { sent: { status: number; body: unknown }[] };
}

const logger = { warn: vi.fn(), error: vi.fn() } as unknown as Logger;

describe('createPictureUploads', () => {
  it('stores both WebP variants under the base key the caller chose', async () => {
    const objects = createMemoryObjectStore();
    const uploads = createPictureUploads({ objects, publicBaseUrl: 'https://media.example.com' });
    const base = 'products/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222';

    const stored = await uploads.storePictureAtBaseKey(await makeImage(), fakeResponse(), base);

    expect(stored?.key).toBe(base);
    const [fullKey, thumbKey] = variantKeys(base);
    expect([...objects.objects.keys()].sort()).toEqual([fullKey, thumbKey].sort());
    for (const key of [fullKey, thumbKey]) {
      expect(objects.objects.get(key)).toMatchObject({
        contentType: 'image/webp',
        cacheControl: IMAGE_CACHE_CONTROL,
      });
    }
    expect(stored?.bytes).toBeGreaterThan(0);
    expect(stored?.width).toBeGreaterThan(0);
  });

  it('appends a fresh UUID when the caller supplies a prefix instead of a key', async () => {
    const objects = createMemoryObjectStore();
    const uploads = createPictureUploads({ objects, publicBaseUrl: 'https://media.example.com' });

    const key = await uploads.storePicture(await makeImage(), fakeResponse(), 'avatars/user');

    expect(key).toMatch(/^avatars\/user\/[0-9a-f-]{36}$/);
  });

  it('refuses an empty body with 400 and stores nothing', async () => {
    const objects = createMemoryObjectStore();
    const uploads = createPictureUploads({ objects, publicBaseUrl: 'https://media.example.com' });
    const res = fakeResponse();

    const stored = await uploads.storePictureAtBaseKey(Buffer.alloc(0), res, 'media/x');

    expect(stored).toBeNull();
    expect(res.sent[0]?.status).toBe(400);
    expect(objects.objects.size).toBe(0);
  });

  it('refuses a body that is not a picture with the shared rejection', async () => {
    const objects = createMemoryObjectStore();
    const uploads = createPictureUploads({ objects, publicBaseUrl: 'https://media.example.com' });
    const res = fakeResponse();

    const stored = await uploads.storePictureAtBaseKey(Buffer.from('not an image'), res, 'media/x');

    expect(stored).toBeNull();
    expect(res.sent[0]).toMatchObject({
      status: 400,
      body: { error: { code: 'image_invalid' } },
    });
    expect(objects.objects.size).toBe(0);
  });

  it('reports an unavailable store and removes the object it managed to write', async () => {
    const failing = failingObjectStore();
    failing.state.failPutAfter = 1;
    const uploads = createPictureUploads({
      objects: failing.store,
      publicBaseUrl: 'https://media.example.com',
    });

    await expect(
      uploads.storePictureAtBaseKey(await makeImage(), fakeResponse(), 'media/x'),
    ).rejects.toThrow(/could not be stored/);
    expect(failing.state.deletes).toEqual([variantKeys('media/x')]);
  });

  it('treats a delete it cannot perform as an orphan to log, never as a failure', async () => {
    const failing = failingObjectStore();
    failing.state.failDelete = true;
    const uploads = createPictureUploads(
      { objects: failing.store, publicBaseUrl: 'https://media.example.com' },
      logger,
    );
    const warn = vi.fn<(first: unknown, message?: string) => void>();

    await expect(uploads.removePicture('media/x', fakeResponse(warn))).resolves.toBeUndefined();
    const call = warn.mock.calls[0];
    expect(call?.[0]).toMatchObject({ key: 'media/x' });
    expect(call?.[1]).toBe('Picture objects not deleted');
  });

  it('does nothing when there is no key to remove or no storage at all', async () => {
    const failing = failingObjectStore();
    const withStorage = createPictureUploads(
      { objects: failing.store, publicBaseUrl: 'https://media.example.com' },
      logger,
    );
    const withoutStorage = createPictureUploads(undefined, logger);

    await withStorage.removePicture(null, fakeResponse());
    await withoutStorage.removePicture('media/x', fakeResponse());

    expect(failing.state.deletes).toEqual([]);
  });
});
