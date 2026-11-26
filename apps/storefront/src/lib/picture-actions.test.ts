import { PRODUCT_IMAGE_MAX_BYTES } from '@nilzora/contracts';
import { ApiError, type ApiClient, type FormState } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  removeAvatarAction,
  removeReviewPhotoAction,
  uploadAvatarAction,
  uploadReviewPhotoAction,
} from './picture-actions';

type Kind = 'ok' | 'untrusted' | 'signed_out' | 'unavailable';

const api = vi.hoisted(() => ({
  uploadMyAvatar: vi.fn(),
  removeMyAvatar: vi.fn(),
  uploadReviewImage: vi.fn(),
  removeReviewImage: vi.fn(),
}));
const act = vi.hoisted((): { kind: Kind; calls: number } => ({ kind: 'ok', calls: 0 }));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('@/lib/session', () => ({
  session: {
    // The real act() checks Origin + CSRF, then runs the call with the session's token.
    act: async (_form: FormData, call: (client: ApiClient, token: string) => unknown) => {
      act.calls += 1;
      if (act.kind !== 'ok') return { kind: act.kind };
      return { kind: 'ok', value: await call(api as unknown as ApiClient, 'customer-token') };
    },
  },
}));
vi.mock('next/cache', () => ({ revalidatePath }));

const IDLE: FormState = { status: 'idle' };
const REVIEW = '0e000000-0000-4000-8000-000000000001';
const IMAGE = '0f000000-0000-4000-8000-000000000001';
const API_TEXT = 'API text that must not reach the browser';
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4];

const png = () => new File([new Uint8Array(PNG)], 'p.png', { type: 'image/png' });

function form(fields: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

function refusal(status: number, code: string): ApiError {
  return new ApiError(status, code, API_TEXT, 'req-1', {});
}

beforeEach(() => {
  act.kind = 'ok';
  act.calls = 0;
  revalidatePath.mockReset();
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('uploadAvatarAction', () => {
  it('uploads the picture for the signed-in account and names no account', async () => {
    api.uploadMyAvatar.mockResolvedValue({ avatar: {} });

    const state = await uploadAvatarAction(IDLE, form({ image: png(), userId: 'someone-else' }));

    expect(state).toEqual({ status: 'success', message: 'Profile picture updated.' });
    const args = api.uploadMyAvatar.mock.calls[0] as unknown[];
    expect(args[0]).toBe('customer-token');
    expect(JSON.stringify(args[1])).not.toContain('someone-else');
    expect(revalidatePath).toHaveBeenCalledWith('/account');
  });

  it('refuses a missing file, an oversized file and a renamed non-picture before any API call', async () => {
    const big = new File([new Uint8Array(8)], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: PRODUCT_IMAGE_MAX_BYTES + 1 });
    const fake = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])], 'cat.png', {
      type: 'image/png',
    });

    for (const data of [form({}), form({ image: big }), form({ image: fake })]) {
      expect((await uploadAvatarAction(IDLE, data)).status).toBe('error');
    }
    expect(act.calls).toBe(0);
    expect(api.uploadMyAvatar).not.toHaveBeenCalled();
  });

  it('turns every outcome into a fixed message and never shows the API text', async () => {
    act.kind = 'untrusted';
    expect((await uploadAvatarAction(IDLE, form({ image: png() }))).status).toBe('error');
    expect(api.uploadMyAvatar).not.toHaveBeenCalled();

    act.kind = 'signed_out';
    expect((await uploadAvatarAction(IDLE, form({ image: png() }))).status).toBe('signed_out');

    act.kind = 'unavailable';
    expect((await uploadAvatarAction(IDLE, form({ image: png() }))).message).toContain('Reload');

    act.kind = 'ok';
    api.uploadMyAvatar.mockRejectedValue(refusal(400, 'image_invalid'));
    const refused = await uploadAvatarAction(IDLE, form({ image: png() }));
    expect(refused.status).toBe('error');
    expect(JSON.stringify(refused)).not.toContain(API_TEXT);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('removeAvatarAction', () => {
  it('removes the signed-in account picture', async () => {
    api.removeMyAvatar.mockResolvedValue({ avatar: null });

    expect(await removeAvatarAction(IDLE, form({}))).toEqual({
      status: 'success',
      message: 'Profile picture removed.',
    });
    expect(api.removeMyAvatar).toHaveBeenCalledWith('customer-token');
  });
});

describe('uploadReviewPhotoAction', () => {
  it('attaches the photo to the named review and answers with the new photo id', async () => {
    api.uploadReviewImage.mockResolvedValue({
      image: { id: IMAGE, url: 'https://m/x/full.webp', thumbUrl: 'https://m/x/thumb.webp' },
      images: [],
    });

    const state = await uploadReviewPhotoAction(
      IDLE,
      form({ reviewId: REVIEW, slug: 'desk-lamp', image: png() }),
    );

    expect(state).toMatchObject({ status: 'success', values: { imageId: IMAGE } });
    const [token, reviewId] = api.uploadReviewImage.mock.calls[0] as [string, string];
    expect(token).toBe('customer-token');
    expect(reviewId).toBe(REVIEW);
    expect(revalidatePath).toHaveBeenCalledWith('/products/desk-lamp');
  });

  it('refuses a review id that is not a UUID and a slug that is not a slug, before any API call', async () => {
    expect(
      (
        await uploadReviewPhotoAction(
          IDLE,
          form({ reviewId: 'x', slug: 'desk-lamp', image: png() }),
        )
      ).status,
    ).toBe('error');
    expect(
      (
        await uploadReviewPhotoAction(
          IDLE,
          form({ reviewId: REVIEW, slug: '../../admin', image: png() }),
        )
      ).status,
    ).toBe('error');
    expect(act.calls).toBe(0);
  });

  it.each([
    ['review_photos_locked', 'soon after a review is posted'],
    ['review_photo_limit', 'at most 4 photos'],
    ['not_found', 'could not be found'],
  ])('explains %s in fixed words', async (code, fragment) => {
    api.uploadReviewImage.mockRejectedValue(refusal(409, code));

    const state = await uploadReviewPhotoAction(
      IDLE,
      form({ reviewId: REVIEW, slug: 'desk-lamp', image: png() }),
    );

    expect(state.status).toBe('error');
    expect(state.message).toContain(fragment);
    expect(JSON.stringify(state)).not.toContain(API_TEXT);
  });
});

describe('removeReviewPhotoAction', () => {
  it('removes the named photo', async () => {
    api.removeReviewImage.mockResolvedValue({ images: [] });

    const state = await removeReviewPhotoAction(IDLE, form({ imageId: IMAGE, slug: 'desk-lamp' }));

    expect(state).toEqual({ status: 'success', message: 'Photo removed.' });
    expect(api.removeReviewImage).toHaveBeenCalledWith('customer-token', IMAGE);
  });

  it('reports a photo that is not the account own as not found', async () => {
    api.removeReviewImage.mockRejectedValue(refusal(404, 'not_found'));

    const state = await removeReviewPhotoAction(IDLE, form({ imageId: IMAGE, slug: 'desk-lamp' }));

    expect(state.status).toBe('error');
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
