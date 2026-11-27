import {
  avatarResponseSchema,
  meResponseSchema,
  MAX_REVIEW_IMAGES,
  AVATAR_MAX_BYTES,
  PRODUCT_IMAGE_MAX_BYTES,
  reviewImageListResponseSchema,
  reviewImageUploadResponseSchema,
} from '@nilzora/contracts';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { attachmentsRouter } from '../modules/attachments/routes';
import type { AvatarDirectory } from '../modules/users/avatar-directory';
import { AttachmentsUnavailableError } from '../modules/attachments/store';
import { FakeAttachments } from './attachment-fakes';
import { errorOf } from './commerce-helpers';
import { FakeIdentity } from './fakes';
import { captureLogs, testApp } from './helpers';
import { failingObjectStore, makeImage } from './media-fakes';

const BASE_URL = 'https://media.example.com';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const noLimit: RequestHandler = (_req, _res, next) => next();

function setup(options: { storage?: boolean; directory?: AvatarDirectory } = {}) {
  const identity = new FakeIdentity();
  const ana = identity.addUser({ email: 'ana@example.com', role: 'customer' });
  const ben = identity.addUser({ email: 'ben@example.com', role: 'customer' });
  const staff = identity.addUser({ email: 'staff@example.com', role: 'staff' });
  const tokens = {
    ana: identity.tokenFor(ana),
    ben: identity.tokenFor(ben),
    staff: identity.tokenFor(staff),
  };
  const store = new FakeAttachments();
  const objects = failingObjectStore();
  const logs = captureLogs('warn');
  const storage =
    options.storage === false ? undefined : { objects: objects.store, publicBaseUrl: BASE_URL };
  const app = testApp({
    auth: identity.deps,
    logger: logs.logger,
    avatars: {
      store,
      mediaBaseUrl: BASE_URL,
      ...(options.directory ? { directory: options.directory } : {}),
    },
    modules: [
      attachmentsRouter({
        ...identity.deps,
        store,
        storage,
        limiter: noLimit,
        logger: logs.logger,
      }),
    ],
  });
  type Who = keyof typeof tokens;

  const as = (pending: request.Test, who?: Who) =>
    who ? pending.set('Authorization', `Bearer ${tokens[who]}`) : pending;

  return {
    app,
    store,
    objects,
    logs,
    users: { ana, ben, staff },
    tokens,
    keys: () => [...objects.memory.objects.keys()].sort(),
    avatar: (who: Who | undefined, body: Buffer | string, type = 'image/jpeg') =>
      as(request(app).post('/api/v1/me/avatar').set('Content-Type', type), who).send(body),
    removeAvatar: (who?: Who) => as(request(app).delete('/api/v1/me/avatar'), who),
    addPhoto: (
      who: Who | undefined,
      reviewId: string,
      body: Buffer | string,
      type = 'image/jpeg',
    ) =>
      as(
        request(app).post(`/api/v1/me/reviews/${reviewId}/images`).set('Content-Type', type),
        who,
      ).send(body),
    removePhoto: (who: Who | undefined, imageId: string) =>
      as(request(app).delete(`/api/v1/me/review-images/${imageId}`), who),
    me: (who: Who) => as(request(app).get('/api/v1/me'), who),
  };
}

describe('POST /api/v1/me/avatar', () => {
  it('needs a signed-in account', async () => {
    const s = setup();

    const response = await s.avatar(undefined, await makeImage('jpeg', 600, 600));

    expect(response.status).toBe(401);
    expect(s.keys()).toEqual([]);
  });

  it('stores a 512 px picture under the caller own folder and answers with public URLs', async () => {
    const s = setup();

    const response = await s.avatar('ana', await makeImage('jpeg', 1800, 1200));

    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const { avatar } = avatarResponseSchema.parse(response.body);
    expect(avatar?.url).toMatch(
      new RegExp(`^${BASE_URL}/avatars/${s.users.ana.id}/${UUID}/full\\.webp$`),
    );
    expect(s.keys()).toHaveLength(2);
    for (const key of s.keys()) {
      expect(key).toMatch(new RegExp(`^avatars/${s.users.ana.id}/${UUID}/(full|thumb)\\.webp$`));
    }
    expect(s.store.avatars.get(s.users.ana.id)).toBeDefined();
    // Nothing is saved for anyone else.
    expect(s.store.avatars.has(s.users.ben.id)).toBe(false);
  });

  it('lets staff set their own picture too, and only their own', async () => {
    const s = setup();

    const response = await s.avatar('staff', await makeImage('png', 400, 400), 'image/png');

    expect(response.status).toBe(201);
    expect([...s.store.avatars.keys()]).toEqual([s.users.staff.id]);
  });

  it('keeps the old picture until the new one is saved, then deletes only the old objects', async () => {
    const s = setup();
    await s.avatar('ana', await makeImage('jpeg', 600, 600));
    const first = s.store.avatars.get(s.users.ana.id) as string;
    expect(s.objects.state.deletes).toEqual([]);

    const response = await s.avatar('ana', await makeImage('jpeg', 700, 700));

    expect(response.status).toBe(201);
    const second = s.store.avatars.get(s.users.ana.id) as string;
    expect(second).not.toBe(first);
    expect(s.keys()).toEqual([`${second}/full.webp`, `${second}/thumb.webp`].sort());
    expect(s.objects.state.deletes.flat().sort()).toEqual(
      [`${first}/full.webp`, `${first}/thumb.webp`].sort(),
    );
  });

  it('removes the new objects and keeps the old picture when the record cannot be saved', async () => {
    const s = setup();
    await s.avatar('ana', await makeImage('jpeg', 600, 600));
    const first = s.store.avatars.get(s.users.ana.id) as string;
    s.store.failWrites = new AttachmentsUnavailableError('database down');

    const response = await s.avatar('ana', await makeImage('jpeg', 700, 700));

    expect(response.status).toBe(503);
    // The profile still points at the first picture, and its objects are untouched.
    expect(s.store.avatars.get(s.users.ana.id)).toBe(first);
    expect(s.keys()).toEqual([`${first}/full.webp`, `${first}/thumb.webp`].sort());
  });

  it('answers 503 and stores nothing when storage fails part-way', async () => {
    const s = setup();
    s.objects.state.failPutAfter = 1;

    const response = await s.avatar('ana', await makeImage('jpeg', 600, 600));

    expect(response.status).toBe(503);
    expect(s.store.calls).not.toContain('setAvatar');
    expect(s.keys()).toEqual([]);
  });

  it('answers 503 media_unavailable when storage is not configured', async () => {
    const s = setup({ storage: false });

    const response = await s.avatar('ana', await makeImage('jpeg', 600, 600));

    expect(response.status).toBe(503);
    expect(errorOf(response.body).code).toBe('media_unavailable');
  });

  it.each(['text/plain', 'application/pdf', 'image/gif', 'image/svg+xml'])(
    'refuses the content type %s before reading the body',
    async (type) => {
      const s = setup();

      const response = await s.avatar('ana', 'whatever', type);

      expect(response.status).toBe(415);
      expect(errorOf(response.body).code).toBe('unsupported_media_type');
      expect(s.keys()).toEqual([]);
    },
  );

  it('decodes the real content: a text file labelled image/jpeg is refused', async () => {
    const s = setup();

    const response = await s.avatar('ana', 'this is not a picture at all');

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('image_invalid');
    expect(s.store.calls).toEqual([]);
  });

  it('refuses a picture smaller than 128 pixels and says so', async () => {
    const s = setup();

    const response = await s.avatar('ana', await makeImage('jpeg', 100, 100));

    expect(response.status).toBe(400);
    expect(errorOf(response.body).message).toContain('at least 128 pixels');
    expect(s.keys()).toEqual([]);
  });

  it('accepts a 128 pixel picture (smaller than a product image may be)', async () => {
    const s = setup();

    const response = await s.avatar('ana', await makeImage('png', 128, 128), 'image/png');

    expect(response.status).toBe(201);
  });

  it('refuses a body over the avatar 3 MB limit', async () => {
    const s = setup();

    const response = await s.avatar('ana', Buffer.alloc(AVATAR_MAX_BYTES + 1));

    expect(response.status).toBe(413);
    expect(errorOf(response.body).code).toBe('payload_too_large');
    // Nothing was stored for a body it never read.
    expect(s.keys()).toEqual([]);
  });

  it('never lets a client choose whose picture it is: the route has no user id to send', async () => {
    const s = setup();

    const response = await request(s.app)
      .post(`/api/v1/me/avatar?userId=${s.users.ben.id}`)
      .set('Authorization', `Bearer ${s.tokens.ana}`)
      .set('Content-Type', 'image/jpeg')
      .send(await makeImage('jpeg', 600, 600));

    expect(response.status).toBe(201);
    expect(s.store.avatars.has(s.users.ben.id)).toBe(false);
    expect(s.store.avatars.has(s.users.ana.id)).toBe(true);
  });
});

describe('DELETE /api/v1/me/avatar', () => {
  it('needs a signed-in account', async () => {
    expect((await setup().removeAvatar()).status).toBe(401);
  });

  it('clears the caller picture and deletes its objects', async () => {
    const s = setup();
    await s.avatar('ana', await makeImage('jpeg', 600, 600));
    await s.avatar('ben', await makeImage('jpeg', 600, 600));
    const bens = s.store.avatars.get(s.users.ben.id) as string;

    const response = await s.removeAvatar('ana');

    expect(response.status).toBe(200);
    expect(avatarResponseSchema.parse(response.body)).toEqual({ avatar: null });
    expect(s.store.avatars.has(s.users.ana.id)).toBe(false);
    // Ben's picture and objects are untouched.
    expect(s.store.avatars.get(s.users.ben.id)).toBe(bens);
    expect(s.keys()).toEqual([`${bens}/full.webp`, `${bens}/thumb.webp`].sort());
  });

  it('is harmless when there is no picture', async () => {
    const s = setup();

    const response = await s.removeAvatar('ana');

    expect(response.status).toBe(200);
    expect(s.objects.state.deletes).toEqual([]);
  });
});

describe('GET /api/v1/me', () => {
  it('carries the profile picture once one is set', async () => {
    const s = setup();
    await s.avatar('ana', await makeImage('jpeg', 600, 600));

    const response = await s.me('ana');

    expect(response.status).toBe(200);
    const parsed = meResponseSchema.parse(response.body);
    expect(parsed.user.profile.avatar?.thumbUrl).toMatch(/\/thumb\.webp$/);
    expect(meResponseSchema.parse((await s.me('ben')).body).user.profile.avatar).toBeNull();
  });

  it('carries the picture a Google sign-in supplied, until the customer uploads one', async () => {
    const directory: AvatarDirectory = {
      forUsers: (ids) =>
        Promise.resolve(
          new Map(
            ids.map((id) => [
              id,
              { customKey: null, googleUrl: 'https://lh3.googleusercontent.com/a/x' },
            ]),
          ),
        ),
    };
    const s = setup({ directory });

    const fromGoogle = meResponseSchema.parse((await s.me('ana')).body).user.profile;
    expect(fromGoogle.googleAvatar).toBe('https://lh3.googleusercontent.com/a/x');
    expect(fromGoogle.avatar).toBeNull();

    // An upload wins over it, and the Google picture is still reported for the fallback.
    await s.avatar('ana', await makeImage('jpeg', 600, 600));
    const afterUpload = meResponseSchema.parse((await s.me('ana')).body).user.profile;
    expect(afterUpload.avatar?.thumbUrl).toMatch(/\/thumb\.webp$/);
    expect(afterUpload.googleAvatar).toBe('https://lh3.googleusercontent.com/a/x');
  });

  it('still answers, without a picture, when the picture cannot be read', async () => {
    const s = setup();
    s.store.failReads = new AttachmentsUnavailableError('functions not installed');

    const response = await s.me('ana');

    expect(response.status).toBe(200);
    expect(meResponseSchema.parse(response.body).user.profile.avatar).toBeNull();
  });
});

describe('POST /api/v1/me/reviews/:reviewId/images', () => {
  it('needs a signed-in account', async () => {
    const s = setup();
    const review = s.store.addReview(s.users.ana.id);

    expect((await s.addPhoto(undefined, review, await makeImage('jpeg', 800, 800))).status).toBe(
      401,
    );
  });

  it('stores the photo under the review folder and lists the review photos in order', async () => {
    const s = setup();
    const review = s.store.addReview(s.users.ana.id);

    const first = await s.addPhoto('ana', review, await makeImage('jpeg', 2000, 1500));
    const second = await s.addPhoto('ana', review, await makeImage('png', 800, 800), 'image/png');

    expect(first.status).toBe(201);
    const one = reviewImageUploadResponseSchema.parse(first.body);
    expect(one.image.url).toMatch(
      new RegExp(`^${BASE_URL}/review-images/${review}/${UUID}/full\\.webp$`),
    );
    const two = reviewImageUploadResponseSchema.parse(second.body);
    expect(two.images.map((image) => image.id)).toEqual([one.image.id, two.image.id]);
    for (const key of s.keys()) {
      expect(key).toMatch(new RegExp(`^review-images/${review}/${UUID}/(full|thumb)\\.webp$`));
    }
    expect(s.keys()).toHaveLength(4);
  });

  it("refuses someone else's review, and removes the object it had stored", async () => {
    const s = setup();
    const bensReview = s.store.addReview(s.users.ben.id);

    const response = await s.addPhoto('ana', bensReview, await makeImage('jpeg', 800, 800));

    expect(response.status).toBe(404);
    expect(errorOf(response.body).code).toBe('not_found');
    expect(s.store.images).toHaveLength(0);
    expect(s.keys()).toEqual([]);
  });

  it('treats an unknown review exactly like another customer review', async () => {
    const s = setup();

    const response = await s.addPhoto('ana', randomUUID(), await makeImage('jpeg', 800, 800));

    expect(response.status).toBe(404);
    expect(s.keys()).toEqual([]);
  });

  it.each(['approved', 'rejected'] as const)(
    'refuses new photos on a %s review, so moderated content cannot change',
    async (status) => {
      const s = setup();
      const review = s.store.addReview(s.users.ana.id, status);

      const response = await s.addPhoto('ana', review, await makeImage('jpeg', 800, 800));

      expect(response.status).toBe(409);
      expect(errorOf(response.body).code).toBe('review_photos_locked');
      expect(s.keys()).toEqual([]);
    },
  );

  it('stops at the photo limit and cleans up the extra upload', async () => {
    const s = setup();
    const review = s.store.addReview(s.users.ana.id);
    for (let index = 0; index < MAX_REVIEW_IMAGES; index += 1) {
      expect((await s.addPhoto('ana', review, await makeImage('jpeg', 600, 600))).status).toBe(201);
    }

    const response = await s.addPhoto('ana', review, await makeImage('jpeg', 600, 600));

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('review_photo_limit');
    expect(s.store.images).toHaveLength(MAX_REVIEW_IMAGES);
    expect(s.keys()).toHaveLength(MAX_REVIEW_IMAGES * 2);
  });

  it('removes the object when the record cannot be saved', async () => {
    const s = setup();
    const review = s.store.addReview(s.users.ana.id);
    s.store.failWrites = new AttachmentsUnavailableError('database down');

    const response = await s.addPhoto('ana', review, await makeImage('jpeg', 600, 600));

    expect(response.status).toBe(503);
    expect(s.keys()).toEqual([]);
  });

  it('refuses a photo smaller than 300 pixels', async () => {
    const s = setup();
    const review = s.store.addReview(s.users.ana.id);

    const response = await s.addPhoto('ana', review, await makeImage('jpeg', 200, 200));

    expect(response.status).toBe(400);
    expect(errorOf(response.body).message).toContain('at least 300 pixels');
    expect(s.store.calls).toEqual([]);
  });

  it('decodes the real content and checks the content type and size', async () => {
    const s = setup();
    const review = s.store.addReview(s.users.ana.id);

    expect((await s.addPhoto('ana', review, 'not a picture')).status).toBe(400);
    expect((await s.addPhoto('ana', review, 'x', 'application/pdf')).status).toBe(415);
    expect(
      (await s.addPhoto('ana', review, Buffer.alloc(PRODUCT_IMAGE_MAX_BYTES + 1))).status,
    ).toBe(413);
    expect(s.keys()).toEqual([]);
  });

  it('refuses a review id that is not a UUID before reading the body', async () => {
    const s = setup();

    const response = await s.addPhoto('ana', 'not-a-uuid', await makeImage('jpeg', 800, 800));

    expect(response.status).toBe(400);
    expect(s.keys()).toEqual([]);
  });

  it('answers 503 media_unavailable when storage is not configured', async () => {
    const s = setup({ storage: false });
    const review = s.store.addReview(s.users.ana.id);

    const response = await s.addPhoto('ana', review, await makeImage('jpeg', 800, 800));

    expect(response.status).toBe(503);
    expect(errorOf(response.body).code).toBe('media_unavailable');
  });
});

describe('DELETE /api/v1/me/review-images/:imageId', () => {
  it('removes the own photo, its objects, and answers with the remaining photos', async () => {
    const s = setup();
    const review = s.store.addReview(s.users.ana.id);
    const a = reviewImageUploadResponseSchema.parse(
      (await s.addPhoto('ana', review, await makeImage('jpeg', 600, 600))).body,
    );
    const b = reviewImageUploadResponseSchema.parse(
      (await s.addPhoto('ana', review, await makeImage('jpeg', 600, 600))).body,
    );

    const response = await s.removePhoto('ana', a.image.id);

    expect(response.status).toBe(200);
    const { images } = reviewImageListResponseSchema.parse(response.body);
    expect(images.map((image) => image.id)).toEqual([b.image.id]);
    // Exactly the removed photo's two objects were deleted; the other photo's two remain.
    expect(s.objects.state.deletes.flat()).toHaveLength(2);
    expect(s.keys()).toHaveLength(2);
    expect(s.keys().every((key) => key.startsWith(`review-images/${review}/`))).toBe(true);
  });

  it("cannot remove another customer's photo, and leaves their objects alone", async () => {
    const s = setup();
    const review = s.store.addReview(s.users.ben.id);
    const photo = reviewImageUploadResponseSchema.parse(
      (await s.addPhoto('ben', review, await makeImage('jpeg', 600, 600))).body,
    );

    const response = await s.removePhoto('ana', photo.image.id);

    expect(response.status).toBe(404);
    expect(s.store.images).toHaveLength(1);
    expect(s.keys()).toHaveLength(2);
  });

  it('needs a signed-in account and a UUID', async () => {
    const s = setup();

    expect((await s.removePhoto(undefined, randomUUID())).status).toBe(401);
    expect((await s.removePhoto('ana', 'nope')).status).toBe(400);
  });
});
