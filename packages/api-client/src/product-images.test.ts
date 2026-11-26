import type { ProductImage } from '@nilzora/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient, IMAGE_UPLOAD_TIMEOUT_MS } from './client';

const TOKEN = 'staff-access-token';
const PRODUCT = '0d000000-0000-4000-8000-000000000001';
const IMAGE = '1a000000-0000-4000-8000-000000000001';

const image: ProductImage = {
  id: IMAGE,
  url: 'https://media.example.com/products/p/i/full.webp',
  thumbUrl: 'https://media.example.com/products/p/i/thumb.webp',
  alt: null,
  width: 1200,
  height: 900,
  position: 0,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function bodyText(init: RequestInit): string {
  return typeof init.body === 'string' ? init.body : '';
}

function setup(respond: () => Response = () => jsonResponse({ images: [image] })) {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(respond()));
  const client = createApiClient({ baseUrl: 'http://localhost:4000', fetch: fetchMock });
  const sent = () => {
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    return { url: typeof url === 'string' ? url : '', init: init as RequestInit };
  };
  return { client, fetchMock, sent };
}

describe('adminUploadProductImage', () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

  it('posts the raw bytes with the image content type, not JSON', async () => {
    const { client, sent } = setup(() => jsonResponse({ image, images: [image] }, 201));

    const result = await client.adminUploadProductImage(TOKEN, PRODUCT, {
      bytes,
      contentType: 'image/jpeg',
    });

    const { url, init } = sent();
    expect(url).toBe(`http://localhost:4000/api/v1/admin/products/${PRODUCT}/images`);
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('Content-Type')).toBe('image/jpeg');
    expect(headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(init.body).toBe(bytes);
    expect(result.image.id).toBe(IMAGE);
  });

  it('puts the description in the query, encoded', async () => {
    const { client, sent } = setup(() => jsonResponse({ image, images: [image] }, 201));

    await client.adminUploadProductImage(TOKEN, PRODUCT, {
      bytes,
      contentType: 'image/webp',
      alt: 'Front & back/side?',
    });

    expect(sent().url).toBe(
      `http://localhost:4000/api/v1/admin/products/${PRODUCT}/images?alt=Front+%26+back%2Fside%3F`,
    );
  });

  it('refuses an unsafe product id before sending anything', async () => {
    const { client, fetchMock } = setup();

    await expect(
      client.adminUploadProductImage(TOKEN, '..', { bytes, contentType: 'image/png' }),
    ).rejects.toMatchObject({ status: 0, code: 'invalid_request' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives an upload longer than an ordinary call before it times out', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn<typeof fetch>(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      );
      const client = createApiClient({ baseUrl: 'http://localhost:4000', fetch: fetchMock });
      const pending = client.adminUploadProductImage(TOKEN, PRODUCT, {
        bytes,
        contentType: 'image/png',
      });
      const outcome = pending.catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(10_001);
      expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(IMAGE_UPLOAD_TIMEOUT_MS);
      expect(await outcome).toMatchObject({ code: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports the API refusal code and details', async () => {
    const { client } = setup(() =>
      jsonResponse(
        {
          error: {
            code: 'image_invalid',
            message: 'The image is not usable',
            requestId: 'req-1',
            details: { reason: 'too_small' },
          },
        },
        400,
      ),
    );

    await expect(
      client.adminUploadProductImage(TOKEN, PRODUCT, { bytes, contentType: 'image/png' }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'image_invalid',
      details: { reason: 'too_small' },
    });
  });

  it('rejects a response that is not an upload result', async () => {
    const { client } = setup(() => jsonResponse({ images: [] }, 201));

    await expect(
      client.adminUploadProductImage(TOKEN, PRODUCT, { bytes, contentType: 'image/png' }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('product image changes', () => {
  it('patches the description as JSON', async () => {
    const { client, sent } = setup();

    await client.adminUpdateProductImage(TOKEN, IMAGE, { alt: 'Blue lamp' });

    const { url, init } = sent();
    expect(url).toBe(`http://localhost:4000/api/v1/admin/product-images/${IMAGE}`);
    expect(init.method).toBe('PATCH');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(bodyText(init))).toEqual({ alt: 'Blue lamp' });
  });

  it('puts the new order as JSON', async () => {
    const { client, sent } = setup();

    await client.adminReorderProductImages(TOKEN, PRODUCT, { imageIds: [IMAGE] });

    const { url, init } = sent();
    expect(url).toBe(`http://localhost:4000/api/v1/admin/products/${PRODUCT}/images/order`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(bodyText(init))).toEqual({ imageIds: [IMAGE] });
  });

  it('deletes by image id and returns the remaining images', async () => {
    const { client, sent } = setup(() => jsonResponse({ images: [] }));

    const result = await client.adminDeleteProductImage(TOKEN, IMAGE);

    const { url, init } = sent();
    expect(url).toBe(`http://localhost:4000/api/v1/admin/product-images/${IMAGE}`);
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
    expect(result.images).toEqual([]);
  });

  it.each(['..', '.', ''])('refuses the image id %j before sending', async (id) => {
    const { client, fetchMock } = setup();

    await expect(client.adminUpdateProductImage(TOKEN, id, { alt: null })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(client.adminDeleteProductImage(TOKEN, id)).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
