import {
  mediaAssetResponseSchema,
  mediaListResponseSchema,
  PRODUCT_IMAGE_MAX_BYTES,
} from '@nilzora/contracts';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import sharp from 'sharp';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AdminRefusalError } from '../modules/admin/errors';
import {
  createPostgresMediaLibraryStore,
  createSupabaseMediaLibraryStore,
} from '../modules/admin/media-library-store';
import { StoreUnavailableError } from '../modules/commerce/errors';
import { IMAGE_CACHE_CONTROL } from '../modules/media/routes';
import type { SupabaseClients } from '../supabase/clients';
import { adminSetup, errorOf, MEDIA_BASE_URL, seedMediaAsset, type Who } from './admin-helpers';
import { testApp } from './helpers';
import { failingObjectStore, FakeProductImages, makeImage } from './media-fakes';

/*
 * The media library routes over the in-memory admin fake and an in-memory bucket (never
 * real storage): uploads through the shared picture pipeline, listing with public URLs,
 * descriptions, and deletion that refuses pictures still in use and removes objects only
 * after the database has committed. The SQL functions are covered by
 * supabase/tests/catalog_admin.test.sql.
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

function withStorage() {
  const setup = adminSetup({}, { storage: true });
  const upload = (body: Buffer, query = '', who: Who = 'owner', type = 'image/jpeg') =>
    setup.call('post', `/admin/media${query}`, who).set('Content-Type', type).send(body);
  const keys = () => [...setup.objects.memory.objects.keys()].sort();
  return { ...setup, upload, keys };
}

describe('POST /api/v1/admin/media', () => {
  it('stores two WebP objects under a server-made library key and records the picture', async () => {
    const setup = withStorage();
    const response = await setup.upload(
      await makeImage('jpeg', 2400, 1800),
      '?alt=%20Shop%20front%20&name=C%3A%5Cfakepath%5Cshop%20front%3Cx%3E.jpg',
    );

    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const { asset } = mediaAssetResponseSchema.parse(response.body);
    expect(asset.key).toMatch(new RegExp(`^library/${UUID}$`));
    expect(asset.id).toBe(asset.key.slice('library/'.length));
    expect(asset).toMatchObject({
      url: `${MEDIA_BASE_URL}/${asset.key}/full.webp`,
      thumbUrl: `${MEDIA_BASE_URL}/${asset.key}/thumb.webp`,
      contentType: 'image/webp',
      width: 1600,
      height: 1200,
      alt: 'Shop front',
      originalName: 'shop front x .jpg',
      uploadedBy: { id: setup.users.owner.id },
    });
    expect(setup.keys()).toEqual([`${asset.key}/full.webp`, `${asset.key}/thumb.webp`]);
    const full = setup.objects.memory.objects.get(`${asset.key}/full.webp`);
    expect(full).toMatchObject({ contentType: 'image/webp', cacheControl: IMAGE_CACHE_CONTROL });
    expect(asset.bytes).toBe(full?.body.length);
    const thumb = await sharp(
      setup.objects.memory.objects.get(`${asset.key}/thumb.webp`)?.body,
    ).metadata();
    expect(Math.max(thumb.width, thumb.height)).toBe(480);
    expect(setup.admin.audit.at(-1)).toMatchObject({
      action: 'media.uploaded',
      targetId: asset.id,
    });
  });

  it('turns the picture upright and strips its metadata', async () => {
    const setup = withStorage();
    const response = await setup.upload(await makeImage('jpeg', 800, 600, { exif: true }));

    const { asset } = mediaAssetResponseSchema.parse(response.body);
    const stored = setup.objects.memory.objects.get(`${asset.key}/full.webp`);
    const metadata = await sharp(stored?.body).metadata();
    expect([metadata.width, metadata.height]).toEqual([600, 800]);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    expect(asset.originalName).toBeNull();
    expect(asset.alt).toBeNull();
  });

  it('refuses an unsupported Content-Type before reading the body or asking the database', async () => {
    const setup = withStorage();
    const response = await setup.upload(Buffer.from('GIF89a'), '', 'owner', 'image/gif');

    expect(response.status).toBe(415);
    expect(errorOf(response.body).code).toBe('unsupported_media_type');
    expect(setup.admin.calls).toEqual([]);
    expect(setup.keys()).toEqual([]);
  });

  /*
   * Only the super admin holds settings.manage, so it is the only role that may add to the
   * library; an admin may read the list (it holds products.update) but not upload. The UI
   * hides the uploader for the other roles, and the server must refuse them even so.
   */
  it.each(['admin', 'staff', 'moderator', 'customer'] as const)(
    'refuses %s, who does not hold settings.manage, and stores nothing',
    async (who) => {
      const setup = withStorage();
      const response = await setup.upload(await makeImage('jpeg', 900, 700), '', who);

      expect(response.status).toBe(403);
      expect(errorOf(response.body).code).toBe('forbidden');
      expect(setup.admin.calls).toEqual([]);
      expect(setup.admin.mediaAssets).toEqual([]);
      expect(setup.keys()).toEqual([]);
    },
  );

  it('lets the super admin, the role that holds settings.manage, upload', async () => {
    const setup = withStorage();
    const response = await setup.upload(await makeImage('png', 900, 700), '', 'owner');

    expect(response.status).toBe(201);
    expect(setup.admin.mediaAssets).toHaveLength(1);
  });

  it.each([
    [
      'bytes that are not a picture',
      () => Promise.resolve(Buffer.from('not an image')),
      'unsupported_format',
    ],
    ['a picture under 400 pixels', () => makeImage('png', 300, 300), 'too_small'],
  ])('refuses %s with 400 image_invalid, storing nothing', async (_label, make, reason) => {
    const setup = withStorage();
    const response = await setup.upload(await make());

    expect(response.status).toBe(400);
    expect(errorOf(response.body)).toMatchObject({ code: 'image_invalid', details: { reason } });
    expect(setup.keys()).toEqual([]);
    expect(setup.admin.calls).toEqual([]);
  });

  it('answers 413 for a body over 5 MB', async () => {
    const setup = withStorage();
    const response = await setup.upload(Buffer.alloc(PRODUCT_IMAGE_MAX_BYTES + 1, 1));

    expect(response.status).toBe(413);
    expect(errorOf(response.body).code).toBe('payload_too_large');
    expect(setup.keys()).toEqual([]);
  });

  it('answers 400 for an empty body', async () => {
    const setup = withStorage();
    const response = await setup.upload(Buffer.alloc(0));

    expect(response.status).toBe(400);
    expect(setup.keys()).toEqual([]);
  });

  it('validates the description before storing anything', async () => {
    const setup = withStorage();
    const response = await setup.upload(await makeImage(), `?alt=${'x'.repeat(251)}`);

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(setup.keys()).toEqual([]);
  });

  it('removes the stored objects when the database refuses the record', async () => {
    const setup = withStorage();
    setup.admin.nextFailure = { code: 'NZ412' };
    const response = await setup.upload(await makeImage());

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('bad_request');
    expect(setup.keys()).toEqual([]);
    expect(setup.objects.state.deletes).toHaveLength(1);
  });

  it('answers 503 media_unavailable without storage', async () => {
    const setup = adminSetup();
    const response = await setup
      .call('post', '/admin/media', 'owner')
      .set('Content-Type', 'image/jpeg')
      .send(await makeImage());

    expect(response.status).toBe(503);
    expect(errorOf(response.body).code).toBe('media_unavailable');
  });
});

describe('GET /api/v1/admin/media', () => {
  it('lists pictures newest first with their public URLs, paged', async () => {
    const setup = withStorage();
    const older = seedMediaAsset(setup, { alt: 'Counter' });
    const newer = seedMediaAsset(setup, { alt: 'Window' });
    const response = await setup.call('get', '/admin/media?pageSize=1', 'staff');

    expect(response.status).toBe(200);
    const list = mediaListResponseSchema.parse(response.body);
    expect(list).toMatchObject({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
    expect(list.assets.map((asset) => asset.id)).toEqual([newer]);
    expect(list.assets[0]?.url).toBe(`${MEDIA_BASE_URL}/library/${newer}/full.webp`);
    const second = mediaListResponseSchema.parse(
      (await setup.call('get', '/admin/media?pageSize=1&page=2', 'staff')).body,
    );
    expect(second.assets.map((asset) => asset.id)).toEqual([older]);
  });

  it('searches the description and file name, and asks nothing for an empty search', async () => {
    const setup = withStorage();
    seedMediaAsset(setup, { alt: 'Counter' });
    const window = seedMediaAsset(setup, { alt: 'Window display' });
    const found = mediaListResponseSchema.parse(
      (await setup.call('get', '/admin/media?q=window', 'owner')).body,
    );
    const calls = setup.admin.calls.length;
    const nothing = mediaListResponseSchema.parse(
      (await setup.call('get', '/admin/media?q=%25%25', 'owner')).body,
    );

    expect(found.assets.map((asset) => asset.id)).toEqual([window]);
    expect(nothing).toMatchObject({ assets: [], total: 0 });
    expect(setup.admin.calls).toHaveLength(calls);
  });

  it.each(['page=0', 'pageSize=101', `q=${'a'.repeat(101)}`])('rejects %s', async (query) => {
    const setup = withStorage();
    const response = await setup.call('get', `/admin/media?${query}`, 'owner');

    expect(response.status).toBe(400);
    expect(setup.admin.calls).toEqual([]);
  });
});

describe('PATCH /api/v1/admin/media/:id', () => {
  it('changes the description, and an empty one removes it', async () => {
    const setup = withStorage();
    const id = seedMediaAsset(setup);
    const changed = await setup.call('patch', `/admin/media/${id}`, 'owner', { alt: ' Till ' });
    const removed = await setup.call('patch', `/admin/media/${id}`, 'owner', { alt: '' });

    expect(mediaAssetResponseSchema.parse(changed.body).asset.alt).toBe('Till');
    expect(mediaAssetResponseSchema.parse(removed.body).asset.alt).toBeNull();
  });

  it.each([
    ['an unknown picture', () => randomUUID(), { alt: 'x' }, 404],
    ['an id that is not a uuid', () => 'logo', { alt: 'x' }, 400],
    ['an extra field', () => randomUUID(), { alt: 'x', key: 'library/x' }, 400],
    ['a description over 250 characters', () => randomUUID(), { alt: 'x'.repeat(251) }, 400],
  ])('answers %s with %i', async (_label, id, body, status) => {
    const setup = withStorage();
    const response = await setup.call('patch', `/admin/media/${id()}`, 'owner', body);

    expect(response.status).toBe(status);
  });
});

describe('DELETE /api/v1/admin/media/:id', () => {
  async function uploaded() {
    const setup = withStorage();
    const response = await setup.upload(await makeImage());
    const { asset } = mediaAssetResponseSchema.parse(response.body);
    return { setup, asset };
  }

  it('deletes the record, then both objects', async () => {
    const { setup, asset } = await uploaded();
    const response = await setup.call('delete', `/admin/media/${asset.id}`, 'owner');

    expect(response.status).toBe(204);
    expect(setup.keys()).toEqual([]);
    expect(setup.objects.state.deletes).toEqual([
      [`${asset.key}/full.webp`, `${asset.key}/thumb.webp`],
    ]);
    expect(setup.admin.mediaAssets).toEqual([]);
    expect(setup.admin.audit.at(-1)).toMatchObject({ action: 'media.deleted' });
  });

  it('refuses a picture still in use with 409 in_use, keeping its objects', async () => {
    const { setup, asset } = await uploaded();
    setup.admin.mediaInUse.add(asset.key);
    const response = await setup.call('delete', `/admin/media/${asset.id}`, 'owner');

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('in_use');
    expect(setup.keys()).toHaveLength(2);
    expect(setup.objects.state.deletes).toEqual([]);
  });

  it('still answers 204 when the bucket cannot delete (the objects are orphans, not a broken page)', async () => {
    const { setup, asset } = await uploaded();
    setup.objects.state.failDelete = true;
    const response = await setup.call('delete', `/admin/media/${asset.id}`, 'owner');

    expect(response.status).toBe(204);
    expect(setup.admin.mediaAssets).toEqual([]);
  });

  it('answers 404 for an unknown picture without touching the bucket', async () => {
    const setup = withStorage();
    const response = await setup.call('delete', `/admin/media/${randomUUID()}`, 'owner');

    expect(response.status).toBe(404);
    expect(setup.objects.state.deletes).toEqual([]);
  });

  it('removes the objects only after the database transaction has committed', async () => {
    const setup = adminSetup();
    const id = randomUUID();
    const keys = [`library/${id}/full.webp`, `library/${id}/thumb.webp`];
    const statements: string[] = [];
    const client = {
      query: (sql: string) => {
        statements.push(sql.trim().split(/\s+/).slice(0, 2).join(' '));
        return Promise.resolve({
          rows: sql.includes('admin_delete_media') ? [{ value: keys }] : [],
        });
      },
      release: () => undefined,
    } as unknown as PoolClient;
    const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;
    const objects = failingObjectStore();
    let seenAtDelete: string[] = [];
    const app = testApp({
      auth: setup.identity.deps,
      admin: { ...setup.admin.stores, mediaLibrary: createPostgresMediaLibraryStore(pool) },
      media: {
        images: new FakeProductImages(setup.identity),
        storage: {
          objects: {
            put: objects.store.put,
            deleteMany: (deleted) => {
              seenAtDelete = [...statements];
              return objects.store.deleteMany(deleted);
            },
          },
          publicBaseUrl: MEDIA_BASE_URL,
        },
      },
    });

    const response = await request(app)
      .delete(`/api/v1/admin/media/${id}`)
      .set('Authorization', `Bearer ${setup.tokens.owner}`);

    expect(response.status).toBe(204);
    expect(objects.state.deletes).toEqual([keys]);
    expect(seenAtDelete.at(-1)).toBe('commit');
    expect(seenAtDelete).toContain('select public.admin_delete_media($1::uuid)');
  });
});

describe('the media library stores', () => {
  const stored = {
    id: '0f000000-0000-4000-8000-0000000000e1',
    key: 'library/0f000000-0000-4000-8000-0000000000e1',
    fullKey: 'library/0f000000-0000-4000-8000-0000000000e1/full.webp',
    thumbKey: 'library/0f000000-0000-4000-8000-0000000000e1/thumb.webp',
    contentType: 'image/webp',
    width: 1600,
    height: 1200,
    bytes: 1234,
    alt: null,
    originalName: 'front.jpg',
    uploadedBy: null,
    createdAt: '2026-11-02T10:00:00.123456+00:00',
  };
  const USER = '3f1c9c5e-9a52-4a52-8f0a-2a3a6f0e1111';

  function supabase(result: { data: unknown; error: unknown }) {
    const calls: { name: string; args: unknown }[] = [];
    const clients = {
      asUser: () => ({
        rpc: (name: string, args: unknown) => {
          calls.push({ name, args });
          return Promise.resolve(result);
        },
      }),
    } as unknown as SupabaseClients;
    return { store: createSupabaseMediaLibraryStore(clients), calls };
  }

  it('lists through the rpc with the paging and an ISO timestamp', async () => {
    const { store, calls } = supabase({ data: [{ asset: stored, total_count: 7 }], error: null });

    const page = await store.list('token', USER, 'front', { page: 2, pageSize: 5 });

    expect(page.total).toBe(7);
    expect(page.assets[0]?.createdAt).toBe('2026-11-02T10:00:00.123Z');
    expect(calls).toEqual([
      { name: 'admin_list_media', args: { p_q: 'front', p_page: 2, p_page_size: 5 } },
    ]);
  });

  it('refuses an answer outside the expected shape', async () => {
    const { store } = supabase({ data: { ...stored, key: 'avatars/x' }, error: null });

    await expect(
      store.record('token', USER, {
        id: stored.id,
        contentType: 'image/webp',
        width: 1,
        height: 1,
        bytes: 1,
        alt: null,
        originalName: null,
      }),
    ).rejects.toBeInstanceOf(StoreUnavailableError);
  });

  it('maps an in-use refusal (NZ442)', async () => {
    const { store } = supabase({ data: null, error: { code: 'NZ442', message: 'in use' } });

    const failure = await store.remove('token', USER, stored.id).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AdminRefusalError);
    expect((failure as AdminRefusalError).refusal).toBe('in_use');
  });

  it('accepts only library object keys back from a delete', async () => {
    const { store } = supabase({ data: ['products/x/full.webp'], error: null });

    await expect(store.remove('token', USER, stored.id)).rejects.toBeInstanceOf(
      StoreUnavailableError,
    );
  });
});
