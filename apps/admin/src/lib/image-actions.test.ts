import { PRODUCT_IMAGE_MAX_BYTES } from '@nilzora/contracts';
import { ApiError, type ApiClient, type FormState } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedirectSignal, throwRedirect } from '@/test/redirect';
import { RESPOND_AS_STATE } from '@/lib/upload-routes';
import {
  deleteProductImageAction,
  moveProductImageAction,
  reorderProductImagesAction,
  updateProductImageAltAction,
  uploadProductImageAction,
} from './image-actions';

type Outcome = 'ok' | 'untrusted' | 'signed_out' | 'unavailable';

const api = vi.hoisted(() => ({
  adminUploadProductImage: vi.fn(),
  adminUpdateProductImage: vi.fn(),
  adminReorderProductImages: vi.fn(),
  adminDeleteProductImage: vi.fn(),
}));
const act = vi.hoisted((): { outcome: Outcome; calls: number } => ({ outcome: 'ok', calls: 0 }));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('@/lib/session', () => ({
  session: {
    // The real act() checks Origin + CSRF, then runs the call with the session's token.
    act: async (_formData: FormData, call: (client: ApiClient, token: string) => unknown) => {
      act.calls += 1;
      if (act.outcome !== 'ok') return { kind: act.outcome };
      return { kind: 'ok', value: await call(api as unknown as ApiClient, 'access-token') };
    },
  },
}));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(throwRedirect) }));

const IDLE: FormState = { status: 'idle' };
const PRODUCT = '0d000000-0000-4000-8000-000000000001';
const IMAGE_A = '1a000000-0000-4000-8000-00000000000a';
const IMAGE_B = '1a000000-0000-4000-8000-00000000000b';
const IMAGE_C = '1a000000-0000-4000-8000-00000000000c';
const API_TEXT = 'API text that must not reach the browser';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2];

function file(bytes: readonly number[], name = 'photo.jpg', type = 'image/jpeg'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function form(fields: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

function uploadForm(image: string | File | null, extra: Record<string, string> = {}): FormData {
  const data = form({ productId: PRODUCT, ...extra });
  if (image !== null) data.set('image', image);
  return data;
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.catch((e: unknown) => e);
  if (!(error instanceof RedirectSignal)) throw new Error('expected a redirect');
  return error.url;
}

function refusal(status: number, code: string, details?: unknown): ApiError {
  return new ApiError(status, code, API_TEXT, 'req-1', details === undefined ? {} : { details });
}

beforeEach(() => {
  act.outcome = 'ok';
  act.calls = 0;
  revalidatePath.mockReset();
  for (const fn of Object.values(api)) fn.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('every image action', () => {
  const cases = [
    ['upload', () => uploadProductImageAction(IDLE, uploadForm(file(PNG)))],
    [
      'description',
      () =>
        updateProductImageAltAction(IDLE, form({ productId: PRODUCT, imageId: IMAGE_A, alt: 'x' })),
    ],
    [
      'move',
      () =>
        moveProductImageAction(
          IDLE,
          form({
            productId: PRODUCT,
            imageId: IMAGE_A,
            direction: 'later',
            order: `${IMAGE_A},${IMAGE_B}`,
          }),
        ),
    ],
    [
      'removal',
      () => deleteProductImageAction(IDLE, form({ productId: PRODUCT, imageId: IMAGE_A })),
    ],
  ] as const;

  it.each(cases)('%s: an untrusted form reaches no API', async (_name, run) => {
    act.outcome = 'untrusted';
    const state = await run();
    expect(state.status).toBe('error');
    expect(state.message).toMatch(/expired/);
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each(cases)('%s: a lapsed session goes to sign in and back', async (_name, run) => {
    act.outcome = 'signed_out';
    const error = await run().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RedirectSignal);
    expect((error as RedirectSignal).url).toBe(
      `/login?next=${encodeURIComponent(`/admin/products/${PRODUCT}`)}`,
    );
  });

  it.each(cases)('%s: an unreachable API is reported without API text', async (_name, run) => {
    act.outcome = 'unavailable';
    const state = await run();
    expect(state.status).toBe('error');
    expect(state.message).toMatch(/could not be reached/);
  });

  it.each(cases)('%s: a missing product id is refused before anything runs', async (name) => {
    const bare = form({ imageId: IMAGE_A });
    const state =
      name === 'upload'
        ? await uploadProductImageAction(IDLE, bare)
        : name === 'description'
          ? await updateProductImageAltAction(IDLE, bare)
          : name === 'move'
            ? await moveProductImageAction(IDLE, bare)
            : await deleteProductImageAction(IDLE, bare);
    expect(state.status).toBe('error');
    expect(act.calls).toBe(0);
  });
});

describe('uploadProductImageAction', () => {
  const stored = { image: { id: IMAGE_A }, images: [] };

  it('sends the bytes with the type they really are, whatever the browser called them', async () => {
    api.adminUploadProductImage.mockResolvedValue(stored);

    // A PNG named .jpg and reported as image/jpeg: the bytes decide.
    const url = await redirectOf(
      uploadProductImageAction(IDLE, uploadForm(file(PNG, 'photo.jpg', 'image/jpeg'))),
    );

    expect(url).toBe(`/admin/products/${PRODUCT}?notice=image-added`);
    expect(api.adminUploadProductImage).toHaveBeenCalledTimes(1);
    const [token, productId, image] = api.adminUploadProductImage.mock.calls[0] as [
      string,
      string,
      { bytes: Uint8Array; contentType: string; alt?: string },
    ];
    expect(token).toBe('access-token');
    expect(productId).toBe(PRODUCT);
    expect(image.contentType).toBe('image/png');
    expect([...image.bytes]).toEqual(PNG);
    expect(image).not.toHaveProperty('alt');
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/products/${PRODUCT}`);
    expect(revalidatePath).toHaveBeenCalledWith('/admin/products');
  });

  it('answers with a state instead of redirecting when the upload route asks, so the browser can show progress', async () => {
    api.adminUploadProductImage.mockResolvedValue(stored);

    const state = await uploadProductImageAction(
      IDLE,
      uploadForm(file(PNG), { [RESPOND_AS_STATE]: '1' }),
    );

    expect(state).toEqual({ status: 'success', message: 'Image added to the product.' });
    expect(api.adminUploadProductImage).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/products/${PRODUCT}`);
  });

  it.each([
    ['jpeg', JPEG, 'image/jpeg'],
    ['webp', WEBP, 'image/webp'],
  ])('recognises %s bytes', async (_name, bytes, contentType) => {
    api.adminUploadProductImage.mockResolvedValue(stored);

    await redirectOf(uploadProductImageAction(IDLE, uploadForm(file(bytes, 'x.bin', ''))));

    expect(api.adminUploadProductImage.mock.calls[0]?.[2]).toMatchObject({ contentType });
  });

  it('passes a trimmed description along', async () => {
    api.adminUploadProductImage.mockResolvedValue(stored);

    await redirectOf(
      uploadProductImageAction(IDLE, uploadForm(file(PNG), { alt: '  Blue lamp  ' })),
    );

    expect(api.adminUploadProductImage.mock.calls[0]?.[2]).toMatchObject({ alt: 'Blue lamp' });
  });

  it.each([
    ['nothing chosen', null],
    ['text instead of a file', 'not a file'],
    ['an empty file', file([])],
    ['a file that is not a picture', file([0x3c, 0x68, 0x74, 0x6d, 0x6c], 'photo.jpg')],
    ['a GIF', file([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 'a.gif', 'image/gif')],
    ['a type the API does not accept', file(PNG, 'a.svg', 'image/svg+xml')],
  ] as const)('refuses %s without calling the API', async (_name, image) => {
    const state = await uploadProductImageAction(IDLE, uploadForm(image));

    expect(state.status).toBe('error');
    expect(state.fieldErrors?.image).toBeTruthy();
    expect(act.calls).toBe(0);
    expect(api.adminUploadProductImage).not.toHaveBeenCalled();
  });

  it('refuses a file over 5 MB without calling the API', async () => {
    const big = new File([new Uint8Array(PRODUCT_IMAGE_MAX_BYTES + 1)], 'big.png', {
      type: 'image/png',
    });

    const state = await uploadProductImageAction(IDLE, uploadForm(big));

    expect(state.fieldErrors?.image).toMatch(/5 MB/);
    expect(api.adminUploadProductImage).not.toHaveBeenCalled();
  });

  it('refuses a description over 160 characters and keeps what was typed', async () => {
    const alt = 'a'.repeat(161);

    const state = await uploadProductImageAction(IDLE, uploadForm(file(PNG), { alt }));

    expect(state.fieldErrors?.alt).toMatch(/160/);
    expect(state.values?.alt).toBe(alt);
    expect(api.adminUploadProductImage).not.toHaveBeenCalled();
  });

  it.each([
    ['too_small', /too small/],
    ['too_large', /too large/],
    ['animated', /Animated/],
    ['corrupt', /could not be read/],
    ['unsupported_format', /JPEG, PNG or WebP/],
  ])('explains an image refused as %s', async (reason, message) => {
    api.adminUploadProductImage.mockRejectedValue(refusal(400, 'image_invalid', { reason }));

    const state = await uploadProductImageAction(IDLE, uploadForm(file(PNG)));

    expect(state.status).toBe('error');
    expect(state.message).toMatch(message);
    expect(state.message).not.toContain(API_TEXT);
  });

  it.each([
    [409, 'image_limit_reached', /at most 8 images/],
    [409, 'product_content_locked', /on sale/],
    [409, 'product_under_review', /under review/],
    [503, 'media_unavailable', /not set up/],
    [413, 'payload_too_large', /5 MB/],
    [415, 'unsupported_media_type', /JPEG, PNG or WebP/],
    [403, 'forbidden', /permission/],
    [404, 'not_found', /no longer exists/],
    [429, 'rate_limited', /Too many/],
    [400, 'image_invalid', /could not be used/],
  ])('maps %s %s to a fixed message', async (status, code, message) => {
    api.adminUploadProductImage.mockRejectedValue(refusal(status, code));

    const state = await uploadProductImageAction(IDLE, uploadForm(file(PNG), { alt: 'Kept' }));

    expect(state.status).toBe('error');
    expect(state.message).toMatch(message);
    expect(state.message).not.toContain(API_TEXT);
    expect(state.values?.alt).toBe('Kept');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('does not suggest retrying an upload whose outcome is unknown', async () => {
    api.adminUploadProductImage.mockRejectedValue(refusal(503, 'service_unavailable'));

    const state = await uploadProductImageAction(IDLE, uploadForm(file(PNG)));

    expect(state.message).toMatch(/Reload the page and check the images/);
  });

  it('shows nothing of an unexpected failure', async () => {
    api.adminUploadProductImage.mockRejectedValue(new Error(API_TEXT));

    const state = await uploadProductImageAction(IDLE, uploadForm(file(PNG)));

    expect(state.status).toBe('error');
    expect(JSON.stringify(state)).not.toContain(API_TEXT);
  });
});

describe('updateProductImageAltAction', () => {
  const fields = { productId: PRODUCT, imageId: IMAGE_A };

  it('saves the description and returns to the product', async () => {
    api.adminUpdateProductImage.mockResolvedValue({ images: [] });

    const url = await redirectOf(
      updateProductImageAltAction(IDLE, form({ ...fields, alt: ' Blue lamp ' })),
    );

    expect(url).toBe(`/admin/products/${PRODUCT}?notice=image-saved`);
    expect(api.adminUpdateProductImage).toHaveBeenCalledWith('access-token', IMAGE_A, {
      alt: 'Blue lamp',
    });
  });

  it('clears the description with an empty value', async () => {
    api.adminUpdateProductImage.mockResolvedValue({ images: [] });

    await redirectOf(updateProductImageAltAction(IDLE, form({ ...fields, alt: '   ' })));

    expect(api.adminUpdateProductImage).toHaveBeenCalledWith('access-token', IMAGE_A, { alt: '' });
  });

  it('refuses a description over 160 characters', async () => {
    const state = await updateProductImageAltAction(
      IDLE,
      form({ ...fields, alt: 'a'.repeat(161) }),
    );

    expect(state.fieldErrors?.alt).toMatch(/160/);
    expect(api.adminUpdateProductImage).not.toHaveBeenCalled();
  });

  it('maps a locked product to a fixed message', async () => {
    api.adminUpdateProductImage.mockRejectedValue(refusal(409, 'product_content_locked'));

    const state = await updateProductImageAltAction(IDLE, form({ ...fields, alt: 'x' }));

    expect(state.message).toMatch(/on sale/);
    expect(state.message).not.toContain(API_TEXT);
    expect(state.values?.alt).toBe('x');
  });
});

describe('moveProductImageAction', () => {
  const order = `${IMAGE_A},${IMAGE_B},${IMAGE_C}`;
  const base = { productId: PRODUCT, order };

  it('swaps the image with its neighbour and sends every id once', async () => {
    api.adminReorderProductImages.mockResolvedValue({ images: [] });

    const url = await redirectOf(
      moveProductImageAction(IDLE, form({ ...base, imageId: IMAGE_B, direction: 'earlier' })),
    );

    expect(url).toBe(`/admin/products/${PRODUCT}?notice=image-moved`);
    expect(api.adminReorderProductImages).toHaveBeenCalledWith('access-token', PRODUCT, {
      imageIds: [IMAGE_B, IMAGE_A, IMAGE_C],
    });
  });

  it('moves an image later', async () => {
    api.adminReorderProductImages.mockResolvedValue({ images: [] });

    await redirectOf(
      moveProductImageAction(IDLE, form({ ...base, imageId: IMAGE_B, direction: 'later' })),
    );

    expect(api.adminReorderProductImages.mock.calls[0]?.[2]).toEqual({
      imageIds: [IMAGE_A, IMAGE_C, IMAGE_B],
    });
  });

  it.each([
    ['the first image earlier', IMAGE_A, 'earlier', order],
    ['the last image later', IMAGE_C, 'later', order],
    ['an unknown direction', IMAGE_B, 'sideways', order],
    ['an image that is not in the order', IMAGE_B, 'later', `${IMAGE_A},${IMAGE_C}`],
    ['an order with a repeated id', IMAGE_B, 'later', `${IMAGE_A},${IMAGE_B},${IMAGE_B}`],
    ['an order with a bad id', IMAGE_B, 'later', `${IMAGE_A},${IMAGE_B},nope`],
  ])('refuses %s without calling the API', async (_name, imageId, direction, listed) => {
    const state = await moveProductImageAction(
      IDLE,
      form({ productId: PRODUCT, imageId, direction, order: listed }),
    );

    expect(state.status).toBe('error');
    expect(state.message).toMatch(/Reload the page/);
    expect(api.adminReorderProductImages).not.toHaveBeenCalled();
  });

  it('tells the admin to reload when the images changed since the page loaded', async () => {
    api.adminReorderProductImages.mockRejectedValue(refusal(400, 'bad_request'));

    const state = await moveProductImageAction(
      IDLE,
      form({ ...base, imageId: IMAGE_B, direction: 'later' }),
    );

    expect(state.message).toMatch(/images changed/);
    expect(state.message).not.toContain(API_TEXT);
  });

  it('maps a product under review to a fixed message', async () => {
    api.adminReorderProductImages.mockRejectedValue(refusal(409, 'product_under_review'));

    const state = await moveProductImageAction(
      IDLE,
      form({ ...base, imageId: IMAGE_B, direction: 'later' }),
    );

    expect(state.message).toMatch(/under review/);
  });
});

describe('setting the cover and dragging into a new order', () => {
  const order = `${IMAGE_A},${IMAGE_B},${IMAGE_C}`;

  it('moves an image to the front as the cover', async () => {
    api.adminReorderProductImages.mockResolvedValue({ images: [] });

    const url = await redirectOf(
      moveProductImageAction(
        IDLE,
        form({ productId: PRODUCT, order, imageId: IMAGE_C, direction: 'first' }),
      ),
    );

    expect(url).toBe(`/admin/products/${PRODUCT}?notice=image-cover`);
    expect(api.adminReorderProductImages).toHaveBeenCalledWith('access-token', PRODUCT, {
      imageIds: [IMAGE_C, IMAGE_A, IMAGE_B],
    });
  });

  it('refuses to make the cover the cover again', async () => {
    const state = await moveProductImageAction(
      IDLE,
      form({ productId: PRODUCT, order, imageId: IMAGE_A, direction: 'first' }),
    );
    expect(state.message).toMatch(/Reload the page/);
    expect(api.adminReorderProductImages).not.toHaveBeenCalled();
  });

  it('saves a dragged order that names exactly the rendered images', async () => {
    api.adminReorderProductImages.mockResolvedValue({ images: [] });

    const url = await redirectOf(
      reorderProductImagesAction(
        IDLE,
        form({ productId: PRODUCT, order, next: `${IMAGE_B},${IMAGE_C},${IMAGE_A}` }),
      ),
    );

    expect(url).toBe(`/admin/products/${PRODUCT}?notice=image-cover`);
    expect(api.adminReorderProductImages).toHaveBeenCalledWith('access-token', PRODUCT, {
      imageIds: [IMAGE_B, IMAGE_C, IMAGE_A],
    });
  });

  it.each([
    ['a missing image', `${IMAGE_A},${IMAGE_B}`],
    ['an image that was not rendered', `${IMAGE_A},${IMAGE_B},1a000000-0000-4000-8000-0000000000ff`],
    ['a repeated image', `${IMAGE_A},${IMAGE_A},${IMAGE_B}`],
    ['a bad id', `${IMAGE_A},${IMAGE_B},nope`],
  ])('refuses an order with %s without calling the API', async (_name, next) => {
    const state = await reorderProductImagesAction(IDLE, form({ productId: PRODUCT, order, next }));
    expect(state.status).toBe('error');
    expect(state.message).toMatch(/Reload the page/);
    expect(api.adminReorderProductImages).not.toHaveBeenCalled();
  });

  it('reaches no API with an untrusted form, and maps a locked product', async () => {
    act.outcome = 'untrusted';
    const untrusted = await reorderProductImagesAction(
      IDLE,
      form({ productId: PRODUCT, order, next: `${IMAGE_B},${IMAGE_A},${IMAGE_C}` }),
    );
    expect(untrusted.status).toBe('error');
    expect(api.adminReorderProductImages).not.toHaveBeenCalled();

    act.outcome = 'ok';
    api.adminReorderProductImages.mockRejectedValue(refusal(409, 'product_content_locked'));
    const locked = await reorderProductImagesAction(
      IDLE,
      form({ productId: PRODUCT, order, next: `${IMAGE_B},${IMAGE_A},${IMAGE_C}` }),
    );
    expect(locked.message).toMatch(/on sale, so its images cannot change/);
    expect(locked.message).not.toContain(API_TEXT);
  });
});

describe('deleteProductImageAction', () => {
  const fields = { productId: PRODUCT, imageId: IMAGE_A };

  it('removes the image and returns to the product', async () => {
    api.adminDeleteProductImage.mockResolvedValue({ images: [] });

    const url = await redirectOf(deleteProductImageAction(IDLE, form(fields)));

    expect(url).toBe(`/admin/products/${PRODUCT}?notice=image-removed`);
    expect(api.adminDeleteProductImage).toHaveBeenCalledWith('access-token', IMAGE_A);
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/products/${PRODUCT}`);
  });

  it.each([
    [403, 'forbidden', /permission/],
    [404, 'not_found', /no longer exists/],
    [409, 'product_content_locked', /on sale/],
    [409, 'product_under_review', /under review/],
    [503, 'media_unavailable', /not set up/],
  ])('maps %s %s to a fixed message', async (status, code, message) => {
    api.adminDeleteProductImage.mockRejectedValue(refusal(status, code));

    const state = await deleteProductImageAction(IDLE, form(fields));

    expect(state.status).toBe('error');
    expect(state.message).toMatch(message);
    expect(state.message).not.toContain(API_TEXT);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
