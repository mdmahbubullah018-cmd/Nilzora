import { ApiError, type ApiClient, type FormState } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RESPOND_AS_STATE } from '@/lib/upload-routes';
import { deleteMediaAction, updateMediaAltAction, uploadMediaAction } from './media-actions';
import { deleteBrandAction } from './merch-actions';
import { checkSlugAction } from './slug-actions';

/*
 * The slug check, the media library and brand deletion: each goes through session.act
 * (Origin and CSRF before any API call) and shows only fixed messages.
 */

type Outcome = 'ok' | 'untrusted' | 'signed_out' | 'unavailable';

const api = vi.hoisted(() => ({
  adminSlugAvailability: vi.fn(),
  adminUploadMedia: vi.fn(),
  adminUpdateMedia: vi.fn(),
  adminDeleteMedia: vi.fn(),
  adminDeleteBrand: vi.fn(),
}));
const session = vi.hoisted((): { outcome: Outcome } => ({ outcome: 'ok' }));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('@/lib/session', () => ({
  session: {
    act: async (_formData: FormData, call: (client: ApiClient, token: string) => unknown) => {
      if (session.outcome !== 'ok') return { kind: session.outcome };
      return { kind: 'ok', value: await call(api as unknown as ApiClient, 'access-token') };
    },
  },
}));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', async () => {
  const { throwRedirect } = await import('@/test/redirect');
  return { redirect: vi.fn(throwRedirect) };
});

const IDLE: FormState = { status: 'idle' };
const ID = '0d000000-0000-4000-8000-000000000001';
const API_TEXT = 'API text that must not reach the browser';
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4];

function form(fields: Record<string, string | File>): FormData {
  const data = new FormData();
  data.set('csrf_token', 'signed');
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

function refusal(status: number, code: string): ApiError {
  return new ApiError(status, code, API_TEXT, 'req-1');
}

beforeEach(() => {
  session.outcome = 'ok';
  for (const fn of Object.values(api)) fn.mockReset();
  revalidatePath.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('checkSlugAction', () => {
  it('asks the API about the address, leaving out the item being edited', async () => {
    api.adminSlugAvailability.mockResolvedValue({
      available: true,
      reason: null,
      suggestion: null,
    });
    await expect(
      checkSlugAction(form({ kind: 'product', slug: 'desk-lamp', excludeId: ID })),
    ).resolves.toEqual({ state: 'available' });
    expect(api.adminSlugAvailability).toHaveBeenCalledWith('access-token', {
      kind: 'product',
      slug: 'desk-lamp',
      excludeId: ID,
    });
  });

  it('passes on a taken or reserved address with the suggestion', async () => {
    api.adminSlugAvailability.mockResolvedValue({
      available: false,
      reason: 'taken',
      suggestion: 'desk-lamp-2',
    });
    await expect(checkSlugAction(form({ kind: 'product', slug: 'desk-lamp' }))).resolves.toEqual({
      state: 'taken',
      suggestion: 'desk-lamp-2',
    });

    api.adminSlugAvailability.mockResolvedValue({
      available: false,
      reason: 'reserved',
      suggestion: 'cart-2',
    });
    await expect(checkSlugAction(form({ kind: 'brand', slug: 'cart' }))).resolves.toEqual({
      state: 'reserved',
      suggestion: 'cart-2',
    });
  });

  it('never asks the API for an unknown kind or an untrusted form, and never redirects', async () => {
    await expect(checkSlugAction(form({ kind: 'order', slug: 'x' }))).resolves.toEqual({
      state: 'unknown',
    });
    session.outcome = 'untrusted';
    await expect(checkSlugAction(form({ kind: 'product', slug: 'x' }))).resolves.toEqual({
      state: 'unknown',
    });
    session.outcome = 'signed_out';
    await expect(checkSlugAction(form({ kind: 'product', slug: 'x' }))).resolves.toEqual({
      state: 'unknown',
    });
    expect(api.adminSlugAvailability).not.toHaveBeenCalled();

    session.outcome = 'ok';
    api.adminSlugAvailability.mockRejectedValue(refusal(403, 'forbidden'));
    await expect(checkSlugAction(form({ kind: 'product', slug: 'x' }))).resolves.toEqual({
      state: 'unknown',
    });
  });
});

describe('media library actions', () => {
  const picture = () => new File([new Uint8Array(PNG)], 'front.jpg', { type: 'image/jpeg' });

  it('uploads the bytes as the type they really are, with the description and file name', async () => {
    // A picker selects the picture it just uploaded from these values, so they are part of
    // the answer, not just the message.
    api.adminUploadMedia.mockResolvedValue({
      asset: {
        key: 'library/00000000-0000-4000-8000-000000000001',
        url: 'https://media.example.com/library/1/full.webp',
        thumbUrl: 'https://media.example.com/library/1/thumb.webp',
      },
    });
    const state = await uploadMediaAction(
      IDLE,
      form({ image: picture(), alt: ' Shop front ', [RESPOND_AS_STATE]: '1' }),
    );
    expect(state).toEqual({
      status: 'success',
      message: 'Picture added to the library.',
      values: {
        alt: 'Shop front',
        mediaKey: 'library/00000000-0000-4000-8000-000000000001',
        mediaUrl: 'https://media.example.com/library/1/full.webp',
        mediaThumbUrl: 'https://media.example.com/library/1/thumb.webp',
      },
    });
    const sent = api.adminUploadMedia.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(sent.contentType).toBe('image/png');
    expect(sent.alt).toBe('Shop front');
    expect(sent.name).toBe('front.jpg');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/media');
  });

  it('refuses a non-image and a long description before any API call', async () => {
    const notImage = await uploadMediaAction(
      IDLE,
      form({ image: new File(['hello'], 'a.png', { type: 'image/png' }) }),
    );
    expect(notImage.fieldErrors?.image).toBe('Upload a JPEG, PNG or WebP picture.');
    const long = await uploadMediaAction(IDLE, form({ image: picture(), alt: 'x'.repeat(251) }));
    expect(long.fieldErrors?.alt).toMatch(/under 250 characters/);
    expect(api.adminUploadMedia).not.toHaveBeenCalled();
  });

  it('explains a missing permission without the API text', async () => {
    api.adminUploadMedia.mockRejectedValue(refusal(403, 'forbidden'));
    const state = await uploadMediaAction(IDLE, form({ image: picture() }));
    expect(state.message).toMatch(/“Manage store settings” permission/);
    expect(state.message).not.toContain(API_TEXT);
  });

  it('saves and clears a description', async () => {
    api.adminUpdateMedia.mockResolvedValue({ asset: {} });
    await updateMediaAltAction(IDLE, form({ mediaId: ID, alt: 'Logo' }));
    await updateMediaAltAction(IDLE, form({ mediaId: ID, alt: '  ' }));
    expect(api.adminUpdateMedia.mock.calls[0]?.slice(1)).toEqual([ID, { alt: 'Logo' }]);
    expect(api.adminUpdateMedia.mock.calls[1]?.slice(1)).toEqual([ID, { alt: null }]);
  });

  it('deletes a picture, and explains one still in use', async () => {
    api.adminDeleteMedia.mockResolvedValue(undefined);
    await expect(deleteMediaAction(IDLE, form({ mediaId: ID }))).resolves.toEqual({
      status: 'success',
      message: 'Picture deleted.',
    });

    api.adminDeleteMedia.mockRejectedValue(refusal(409, 'in_use'));
    const used = await deleteMediaAction(IDLE, form({ mediaId: ID }));
    expect(used.message).toMatch(/still used by the store profile, SEO, onboarding or a banner/);

    const tampered = await deleteMediaAction(IDLE, form({ mediaId: '../x' }));
    expect(tampered.message).toMatch(/out of date/);
    expect(api.adminDeleteMedia).toHaveBeenCalledTimes(2);
  });
});

describe('deleteBrandAction', () => {
  it('deletes the brand named by the form', async () => {
    api.adminDeleteBrand.mockResolvedValue(undefined);
    await expect(deleteBrandAction(IDLE, form({ brandId: ID }))).resolves.toEqual({
      status: 'success',
      message: 'Brand deleted.',
    });
    expect(api.adminDeleteBrand).toHaveBeenCalledWith('access-token', ID);
    expect(revalidatePath).toHaveBeenCalledWith('/admin/brands');
  });

  it('explains a brand still used by products, and a missing permission', async () => {
    api.adminDeleteBrand.mockRejectedValue(refusal(409, 'brand_in_use'));
    const used = await deleteBrandAction(IDLE, form({ brandId: ID }));
    expect(used.message).toMatch(/Products still use this brand/);
    expect(used.message).not.toContain(API_TEXT);

    api.adminDeleteBrand.mockRejectedValue(refusal(403, 'forbidden'));
    const forbidden = await deleteBrandAction(IDLE, form({ brandId: ID }));
    expect(forbidden.message).toMatch(/“Publish products” permission/);
  });

  it('reaches no API with a tampered id or an untrusted form', async () => {
    const tampered = await deleteBrandAction(IDLE, form({ brandId: 'nope' }));
    expect(tampered.message).toMatch(/out of date/);
    session.outcome = 'untrusted';
    const untrusted = await deleteBrandAction(IDLE, form({ brandId: ID }));
    expect(untrusted.status).toBe('error');
    expect(api.adminDeleteBrand).not.toHaveBeenCalled();
  });
});
