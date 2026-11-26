import {
  PRODUCT_IMAGE_MAX_BYTES,
  productImageListResponseSchema,
  productImageUploadResponseSchema,
} from '@nilzora/contracts';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { IMAGE_CACHE_CONTROL } from '../modules/media/routes';
import { FakeIdentity } from './fakes';
import { captureLogs, testApp } from './helpers';
import { errorOf } from './commerce-helpers';
import { failingObjectStore, FakeProductImages, makeImage, type ProductState } from './media-fakes';

const BASE_URL = 'https://media.example.com';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

type Who = 'staff' | 'moderator' | 'customer' | 'denied';

function setup(options: { storage?: boolean; state?: ProductState } = {}) {
  const identity = new FakeIdentity();
  const users = {
    staff: identity.addUser({ email: 'staff@example.com', role: 'staff' }),
    moderator: identity.addUser({ email: 'moderator@example.com', role: 'moderator' }),
    customer: identity.addUser({ email: 'customer@example.com', role: 'customer' }),
    denied: identity.addUser({ email: 'denied@example.com', role: 'staff' }),
  };
  users.denied.overrides.set('products.update', 'deny');
  const tokens = Object.fromEntries(
    Object.entries(users).map(([who, user]) => [who, identity.tokenFor(user)]),
  ) as Record<Who, string>;

  const images = new FakeProductImages(identity);
  const productId = randomUUID();
  images.products.set(productId, options.state ?? 'draft');
  const objects = failingObjectStore();
  const logs = captureLogs('warn');
  const app = testApp({
    auth: identity.deps,
    logger: logs.logger,
    media: {
      images,
      storage:
        options.storage === false ? undefined : { objects: objects.store, publicBaseUrl: BASE_URL },
    },
  });

  const bearer = (pending: request.Test, who?: Who) =>
    who ? pending.set('Authorization', `Bearer ${tokens[who]}`) : pending;

  function upload(
    who: Who | undefined,
    body: Buffer,
    type = 'image/jpeg',
    query = '',
    product: string = productId,
  ) {
    return bearer(
      request(app)
        .post(`/api/v1/admin/products/${product}/images${query}`)
        .set('Content-Type', type),
      who,
    ).send(body);
  }

  return {
    identity,
    images,
    objects,
    logs,
    productId,
    app,
    upload,
    send: (method: 'put' | 'patch' | 'delete', path: string, who?: Who, body?: object) => {
      const pending = bearer(request(app)[method](`/api/v1${path}`), who);
      return body === undefined ? pending : pending.send(body);
    },
  };
}

type Setup = ReturnType<typeof setup>;

async function uploadOne(s: Setup, who: Who = 'staff') {
  const response = await s.upload(who, await makeImage('jpeg', 900, 700));
  expect(response.status).toBe(201);
  return productImageUploadResponseSchema.parse(response.body);
}

describe('POST /api/v1/admin/products/:productId/images', () => {
  it('stores two WebP objects and registers the image, answering with public URLs', async () => {
    const s = setup();

    const response = await s.upload(
      'staff',
      await makeImage('jpeg', 2400, 1800),
      'image/jpeg',
      '?alt=Front%20view',
    );

    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const { image, images } = productImageUploadResponseSchema.parse(response.body);
    expect(images).toEqual([image]);
    expect(image).toMatchObject({ alt: 'Front view', width: 1600, height: 1200, position: 0 });
    expect(image.url).toBe(`${BASE_URL}/products/${s.productId}/${image.id}/full.webp`);
    expect(image.thumbUrl).toBe(`${BASE_URL}/products/${s.productId}/${image.id}/thumb.webp`);

    const stored = [...s.objects.memory.objects.values()];
    expect(stored.map((object) => object.key).sort()).toEqual([
      `products/${s.productId}/${image.id}/full.webp`,
      `products/${s.productId}/${image.id}/thumb.webp`,
    ]);
    for (const object of stored) {
      expect(object.contentType).toBe('image/webp');
      expect(object.cacheControl).toBe(IMAGE_CACHE_CONTROL);
    }
    expect(s.images.rows).toHaveLength(1);
  });

  it('builds the key from the product id and a server-generated id only', async () => {
    const s = setup();

    const response = await s.upload(
      'staff',
      await makeImage('png', 800, 800),
      'image/png; charset=binary',
      '?alt=x',
    );
    // A file name sent by the client plays no part in the key.
    expect(response.status).toBe(201);
    for (const key of s.objects.memory.objects.keys()) {
      expect(key).toMatch(new RegExp(`^products/${s.productId}/${UUID}/(full|thumb)\\.webp$`));
    }
  });

  it('puts later images last and stops at eight', async () => {
    const s = setup();
    for (let index = 0; index < 8; index += 1) {
      const { image } = await uploadOne(s);
      expect(image.position).toBe(index);
    }

    const ninth = await s.upload('staff', await makeImage('jpeg', 500, 500));

    expect(ninth.status).toBe(409);
    expect(errorOf(ninth.body).code).toBe('image_limit_reached');
    // The refused ninth image left nothing behind in storage.
    expect(s.objects.memory.objects.size).toBe(16);
  });

  it('answers 401 without a session and reads no body', async () => {
    const s = setup();

    const response = await s.upload(undefined, await makeImage());

    expect(response.status).toBe(401);
    expect(s.objects.state.puts).toBe(0);
  });

  it.each(['customer', 'moderator', 'denied'] as const)(
    'answers 403 for %s accounts',
    async (who) => {
      const s = setup();

      const response = await s.upload(who, await makeImage());

      expect(response.status).toBe(403);
      expect(errorOf(response.body).code).toBe('forbidden');
      expect(s.objects.state.puts).toBe(0);
      expect(s.images.rows).toHaveLength(0);
    },
  );

  it.each([
    'text/plain',
    'application/json',
    'image/gif',
    'image/svg+xml',
    'application/octet-stream',
    'text/html',
  ])('refuses the content type %s with 415 before reading the body', async (type) => {
    const s = setup();

    const response = await s.upload('staff', Buffer.from('not an image'), type);

    expect(response.status).toBe(415);
    expect(errorOf(response.body).code).toBe('unsupported_media_type');
    expect(s.objects.state.puts).toBe(0);
  });

  it('answers 413 for a body over the 5 MB limit', async () => {
    const s = setup();

    const response = await s.upload('staff', Buffer.alloc(PRODUCT_IMAGE_MAX_BYTES + 1, 1));

    expect(response.status).toBe(413);
    expect(errorOf(response.body).code).toBe('payload_too_large');
    expect(s.objects.state.puts).toBe(0);
  });

  it('answers 400 for an empty body', async () => {
    const s = setup();

    const response = await s.upload('staff', Buffer.alloc(0));

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('bad_request');
  });

  it.each([
    [
      'HTML sent as a JPEG',
      () => Buffer.from('<html><script>alert(1)</script></html>'),
      'unsupported_format',
    ],
    ['random bytes', () => Buffer.alloc(2048, 7), 'unsupported_format'],
  ])('refuses %s with image_invalid', async (_label, body, reason) => {
    const s = setup();

    const response = await s.upload('staff', body());

    expect(response.status).toBe(400);
    expect(errorOf(response.body)).toMatchObject({ code: 'image_invalid', details: { reason } });
    expect(s.objects.state.puts).toBe(0);
    expect(s.images.rows).toHaveLength(0);
  });

  it('refuses a picture that is too small', async () => {
    const s = setup();

    const response = await s.upload('staff', await makeImage('png', 300, 300), 'image/png');

    expect(response.status).toBe(400);
    expect(errorOf(response.body)).toMatchObject({
      code: 'image_invalid',
      details: { reason: 'too_small' },
    });
  });

  it('accepts a picture whose bytes differ from its declared type (re-encoded anyway)', async () => {
    const s = setup();

    const response = await s.upload('staff', await makeImage('png', 700, 700), 'image/jpeg');

    expect(response.status).toBe(201);
  });

  it('validates the product id and the description', async () => {
    const s = setup();
    const body = await makeImage();

    const badId = await s.upload('staff', body, 'image/jpeg', '', 'not-a-uuid');
    const longAlt = await s.upload('staff', body, 'image/jpeg', `?alt=${'x'.repeat(161)}`);

    expect(badId.status).toBe(400);
    expect(errorOf(badId.body).code).toBe('validation_failed');
    expect(longAlt.status).toBe(400);
    expect(errorOf(longAlt.body).code).toBe('validation_failed');
    expect(s.objects.state.puts).toBe(0);
  });

  it('answers 404 for an unknown product and removes the objects it stored', async () => {
    const s = setup();

    const response = await s.upload('staff', await makeImage(), 'image/jpeg', '', randomUUID());

    expect(response.status).toBe(404);
    expect(errorOf(response.body).code).toBe('not_found');
    expect(s.objects.memory.objects.size).toBe(0);
  });

  it('answers 409 for a product on sale and removes the objects it stored', async () => {
    const s = setup({ state: 'active' });

    const response = await s.upload('staff', await makeImage());

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('product_content_locked');
    expect(s.objects.state.puts).toBe(2);
    expect(s.objects.memory.objects.size).toBe(0);
  });

  it('answers 409 for a product under review and removes the objects it stored', async () => {
    const s = setup({ state: 'pending' });

    const response = await s.upload('staff', await makeImage());

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('product_under_review');
    expect(s.objects.memory.objects.size).toBe(0);
  });

  it('removes the objects when the database is unavailable, answering 503', async () => {
    const s = setup();
    s.images.nextOutage = true;

    const response = await s.upload('staff', await makeImage());

    expect(response.status).toBe(503);
    expect(errorOf(response.body).code).toBe('service_unavailable');
    expect(s.objects.memory.objects.size).toBe(0);
    expect(s.images.rows).toHaveLength(0);
  });

  it('removes the first object and registers nothing when the second put fails', async () => {
    const s = setup();
    s.objects.state.failPutAfter = 1;

    const response = await s.upload('staff', await makeImage());

    expect(response.status).toBe(503);
    expect(errorOf(response.body).code).toBe('service_unavailable');
    expect(s.objects.memory.objects.size).toBe(0);
    expect(s.images.rows).toHaveLength(0);
    expect(s.images.calls).not.toContain('add');
  });

  it('still answers with the refusal when the cleanup itself fails, and logs the orphan', async () => {
    const s = setup({ state: 'active' });
    s.objects.state.failDelete = true;

    const response = await s.upload('staff', await makeImage());

    expect(response.status).toBe(409);
    expect(s.logs.raw()).toContain('Picture objects not deleted');
    expect(s.logs.raw()).not.toContain('Bearer');
  });

  it('answers 503 media_unavailable when R2 is not configured, before reading the body', async () => {
    const s = setup({ storage: false });

    const response = await s.upload('staff', await makeImage());

    expect(response.status).toBe(503);
    expect(errorOf(response.body).code).toBe('media_unavailable');
    expect(s.images.calls).toEqual([]);
  });

  it('still refuses anonymous callers first when R2 is not configured', async () => {
    const s = setup({ storage: false });

    const response = await s.upload(undefined, await makeImage());

    expect(response.status).toBe(401);
  });
});

describe('PATCH /api/v1/admin/product-images/:imageId', () => {
  it('changes and clears the description, answering with the product images', async () => {
    const s = setup();
    const { image } = await uploadOne(s);

    const changed = await s.send('patch', `/admin/product-images/${image.id}`, 'staff', {
      alt: '  Side view ',
    });
    const cleared = await s.send('patch', `/admin/product-images/${image.id}`, 'staff', {
      alt: '',
    });

    expect(changed.status).toBe(200);
    expect(productImageListResponseSchema.parse(changed.body).images[0]?.alt).toBe('Side view');
    expect(productImageListResponseSchema.parse(cleared.body).images[0]?.alt).toBeNull();
  });

  it('answers 404 for an unknown image', async () => {
    const s = setup();

    const response = await s.send('patch', `/admin/product-images/${randomUUID()}`, 'staff', {
      alt: 'x',
    });

    expect(response.status).toBe(404);
  });

  it('answers 409 for a product on sale', async () => {
    const s = setup();
    const { image } = await uploadOne(s);
    s.images.products.set(s.productId, 'active');

    const response = await s.send('patch', `/admin/product-images/${image.id}`, 'staff', {
      alt: 'x',
    });

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('product_content_locked');
  });

  it.each([
    ['an over-long description', { alt: 'x'.repeat(161) }],
    ['an unknown field', { alt: 'x', position: 3 }],
    ['a missing description', {}],
  ])('rejects %s', async (_label, body) => {
    const s = setup();
    const { image } = await uploadOne(s);

    const response = await s.send('patch', `/admin/product-images/${image.id}`, 'staff', body);

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
  });

  it('refuses callers without products.update and anonymous callers', async () => {
    const s = setup();
    const { image } = await uploadOne(s);

    const moderator = await s.send('patch', `/admin/product-images/${image.id}`, 'moderator', {
      alt: 'x',
    });
    const anonymous = await s.send('patch', `/admin/product-images/${image.id}`, undefined, {
      alt: 'x',
    });

    expect(moderator.status).toBe(403);
    expect(anonymous.status).toBe(401);
  });

  it('answers 503 media_unavailable without R2', async () => {
    const s = setup({ storage: false });

    const response = await s.send('patch', `/admin/product-images/${randomUUID()}`, 'staff', {
      alt: 'x',
    });

    expect(response.status).toBe(503);
    expect(errorOf(response.body).code).toBe('media_unavailable');
  });
});

describe('PUT /api/v1/admin/products/:productId/images/order', () => {
  it('reorders the images and answers with the new order', async () => {
    const s = setup();
    const first = (await uploadOne(s)).image;
    const second = (await uploadOne(s)).image;

    const response = await s.send('put', `/admin/products/${s.productId}/images/order`, 'staff', {
      imageIds: [second.id, first.id],
    });

    expect(response.status).toBe(200);
    const { images } = productImageListResponseSchema.parse(response.body);
    expect(images.map((image) => [image.id, image.position])).toEqual([
      [second.id, 0],
      [first.id, 1],
    ]);
  });

  it.each([
    ['an image left out', (ids: string[]) => ({ imageIds: [ids[0]] })],
    ['a repeated image', (ids: string[]) => ({ imageIds: [ids[0], ids[0]] })],
    ['a foreign image', (ids: string[]) => ({ imageIds: [ids[0], randomUUID()] })],
  ])('refuses a list with %s', async (_label, body) => {
    const s = setup();
    const ids = [(await uploadOne(s)).image.id, (await uploadOne(s)).image.id];

    const response = await s.send(
      'put',
      `/admin/products/${s.productId}/images/order`,
      'staff',
      body(ids),
    );

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('bad_request');
  });

  it.each([
    ['an empty list', { imageIds: [] }],
    ['ids that are not UUIDs', { imageIds: ['one'] }],
    ['an unknown field', { imageIds: [randomUUID()], extra: true }],
    ['more than eight ids', { imageIds: Array.from({ length: 9 }, () => randomUUID()) }],
  ])('rejects %s', async (_label, body) => {
    const s = setup();

    const response = await s.send(
      'put',
      `/admin/products/${s.productId}/images/order`,
      'staff',
      body,
    );

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
  });

  it('refuses callers without products.update', async () => {
    const s = setup();

    const response = await s.send(
      'put',
      `/admin/products/${s.productId}/images/order`,
      'customer',
      {
        imageIds: [randomUUID()],
      },
    );

    expect(response.status).toBe(403);
  });
});

describe('DELETE /api/v1/admin/product-images/:imageId', () => {
  it('removes the row first and the objects after it, closing the gap', async () => {
    const s = setup();
    const first = (await uploadOne(s)).image;
    const second = (await uploadOne(s)).image;

    const response = await s.send('delete', `/admin/product-images/${first.id}`, 'staff');

    expect(response.status).toBe(200);
    const { images } = productImageListResponseSchema.parse(response.body);
    expect(images.map((image) => [image.id, image.position])).toEqual([[second.id, 0]]);
    expect([...s.objects.memory.objects.keys()].sort()).toEqual([
      `products/${s.productId}/${second.id}/full.webp`,
      `products/${s.productId}/${second.id}/thumb.webp`,
    ]);
  });

  it('keeps the objects when the database refuses the delete', async () => {
    const s = setup();
    const { image } = await uploadOne(s);
    s.images.products.set(s.productId, 'active');

    const response = await s.send('delete', `/admin/product-images/${image.id}`, 'staff');

    expect(response.status).toBe(409);
    expect(s.objects.memory.objects.size).toBe(2);
    expect(s.objects.state.deletes).toEqual([]);
  });

  it('keeps the row deleted and logs orphans when R2 fails', async () => {
    const s = setup();
    const { image } = await uploadOne(s);
    s.objects.state.failDelete = true;

    const response = await s.send('delete', `/admin/product-images/${image.id}`, 'staff');

    expect(response.status).toBe(200);
    expect(productImageListResponseSchema.parse(response.body).images).toEqual([]);
    expect(s.images.rows).toHaveLength(0);
    expect(s.logs.raw()).toContain('Picture objects not deleted');
  });

  it('answers 404 for an unknown or already deleted image', async () => {
    const s = setup();
    const { image } = await uploadOne(s);
    await s.send('delete', `/admin/product-images/${image.id}`, 'staff');

    const again = await s.send('delete', `/admin/product-images/${image.id}`, 'staff');

    expect(again.status).toBe(404);
  });

  it('refuses callers without products.update and anonymous callers', async () => {
    const s = setup();
    const { image } = await uploadOne(s);

    const moderator = await s.send('delete', `/admin/product-images/${image.id}`, 'moderator');
    const anonymous = await s.send('delete', `/admin/product-images/${image.id}`);
    const badId = await s.send('delete', '/admin/product-images/nope', 'staff');

    expect(moderator.status).toBe(403);
    expect(anonymous.status).toBe(401);
    expect(badId.status).toBe(400);
    expect(s.objects.memory.objects.size).toBe(2);
  });
});
