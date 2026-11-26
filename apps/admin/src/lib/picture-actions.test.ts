import { PRODUCT_IMAGE_MAX_BYTES } from '@nilzora/contracts';
import { ApiError, type ApiClient, type FormState } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { removeAvatarAction, uploadAvatarAction } from './avatar-actions';
import {
  removeCategoryBannerAction,
  removeCategoryImageAction,
  uploadCategoryBannerAction,
  uploadCategoryImageAction,
} from './category-image-actions';

type Outcome = 'ok' | 'untrusted' | 'signed_out' | 'unavailable';

const api = vi.hoisted(() => ({
  adminUploadCategoryImage: vi.fn(),
  adminRemoveCategoryImage: vi.fn(),
  adminUploadCategoryBanner: vi.fn(),
  adminRemoveCategoryBanner: vi.fn(),
  uploadMyAvatar: vi.fn(),
  removeMyAvatar: vi.fn(),
}));
const act = vi.hoisted((): { outcome: Outcome; calls: number } => ({ outcome: 'ok', calls: 0 }));
const revalidatePath = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((url: string): never => {
    throw new Error(`redirect:${url}`);
  }),
);

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
vi.mock('next/navigation', () => ({ redirect }));

const IDLE: FormState = { status: 'idle' };
const CATEGORY = '0c000000-0000-4000-8000-000000000001';
const API_TEXT = 'API text that must not reach the browser';
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4];

function file(bytes: readonly number[], name = 'photo.png', type = 'image/png'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function form(fields: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

function refusal(status: number, code: string): ApiError {
  return new ApiError(status, code, API_TEXT, 'req-1', {});
}

beforeEach(() => {
  act.outcome = 'ok';
  act.calls = 0;
  revalidatePath.mockReset();
  redirect.mockClear();
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('category banner actions', () => {
  it('uploads the banner as the type its bytes say, never touching the cover picture', async () => {
    api.adminUploadCategoryBanner.mockResolvedValue({ category: {} });

    const state = await uploadCategoryBannerAction(
      IDLE,
      form({ categoryId: CATEGORY, image: file(PNG, 'banner.jpg', 'image/jpeg') }),
    );

    expect(state).toEqual({ status: 'success', message: 'Banner updated.' });
    const [token, id, image] = api.adminUploadCategoryBanner.mock.calls[0] as [
      string,
      string,
      { bytes: Uint8Array; contentType: string },
    ];
    expect([token, id, image.contentType]).toEqual(['access-token', CATEGORY, 'image/png']);
    expect(api.adminUploadCategoryImage).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/categories/${CATEGORY}`);
  });

  it('refuses a bad id, a missing file and a non-image before any API call', async () => {
    for (const data of [
      form({ categoryId: 'nope', image: file(PNG) }),
      form({ categoryId: CATEGORY }),
      form({ categoryId: CATEGORY, image: file([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) }),
    ]) {
      expect((await uploadCategoryBannerAction(IDLE, data)).status).toBe('error');
    }
    expect(api.adminUploadCategoryBanner).not.toHaveBeenCalled();
  });

  it('removes the banner', async () => {
    api.adminRemoveCategoryBanner.mockResolvedValue(undefined);

    const state = await removeCategoryBannerAction(IDLE, form({ categoryId: CATEGORY }));

    expect(state).toEqual({ status: 'success', message: 'Banner removed.' });
    expect(api.adminRemoveCategoryBanner).toHaveBeenCalledWith('access-token', CATEGORY);
  });
});

describe('uploadCategoryImageAction', () => {
  it('sends the bytes, as the type they really are, to the category named by the form', async () => {
    api.adminUploadCategoryImage.mockResolvedValue({ category: {} });

    const state = await uploadCategoryImageAction(
      IDLE,
      // Reported as a JPEG, but its bytes say PNG: the bytes decide.
      form({ categoryId: CATEGORY, image: file(PNG, 'cover.jpg', 'image/jpeg') }),
    );

    expect(state).toEqual({ status: 'success', message: 'Picture updated.' });
    const [token, id, image] = api.adminUploadCategoryImage.mock.calls[0] as [
      string,
      string,
      { bytes: Uint8Array; contentType: string },
    ];
    expect(token).toBe('access-token');
    expect(id).toBe(CATEGORY);
    expect(image.contentType).toBe('image/png');
    expect([...image.bytes]).toEqual(PNG);
    expect(revalidatePath).toHaveBeenCalledWith('/admin/categories');
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/categories/${CATEGORY}`);
  });

  it('refuses a bad category id, a missing file, a big file and a non-image before any API call', async () => {
    const cases: FormData[] = [
      form({ categoryId: 'nope', image: file(PNG) }),
      form({ categoryId: CATEGORY }),
      form({
        categoryId: CATEGORY,
        image: file(new Array<number>(PRODUCT_IMAGE_MAX_BYTES + 1).fill(7)),
      }),
      form({ categoryId: CATEGORY, image: file([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) }),
    ];
    for (const data of cases) {
      const state = await uploadCategoryImageAction(IDLE, data);
      expect(state.status).toBe('error');
    }
    expect(api.adminUploadCategoryImage).not.toHaveBeenCalled();
    expect(act.calls).toBe(0);
  });

  it('shows a fixed message for a refusal and never the API text', async () => {
    api.adminUploadCategoryImage.mockRejectedValue(refusal(403, 'forbidden'));

    const state = await uploadCategoryImageAction(
      IDLE,
      form({ categoryId: CATEGORY, image: file(PNG) }),
    );

    expect(state.status).toBe('error');
    expect(state.message).toContain('permission');
    expect(JSON.stringify(state)).not.toContain(API_TEXT);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('reaches no API with an untrusted form, and sends a signed-out visitor to sign in', async () => {
    act.outcome = 'untrusted';
    const untrusted = await uploadCategoryImageAction(
      IDLE,
      form({ categoryId: CATEGORY, image: file(PNG) }),
    );
    expect(untrusted.status).toBe('error');
    expect(api.adminUploadCategoryImage).not.toHaveBeenCalled();

    act.outcome = 'signed_out';
    await expect(
      uploadCategoryImageAction(IDLE, form({ categoryId: CATEGORY, image: file(PNG) })),
    ).rejects.toThrow(/redirect:/);
  });
});

describe('removeCategoryImageAction', () => {
  it('removes the picture of the named category', async () => {
    api.adminRemoveCategoryImage.mockResolvedValue(undefined);

    const state = await removeCategoryImageAction(IDLE, form({ categoryId: CATEGORY }));

    expect(state).toEqual({ status: 'success', message: 'Picture removed.' });
    expect(api.adminRemoveCategoryImage).toHaveBeenCalledWith('access-token', CATEGORY);
  });

  it('needs a valid category id', async () => {
    const state = await removeCategoryImageAction(IDLE, form({ categoryId: 'x' }));

    expect(state.status).toBe('error');
    expect(api.adminRemoveCategoryImage).not.toHaveBeenCalled();
  });
});

describe('uploadAvatarAction', () => {
  it('uploads the picture for the signed-in account, naming no account', async () => {
    api.uploadMyAvatar.mockResolvedValue({ avatar: {} });

    // Even a smuggled "userId" field changes nothing: the action never reads one.
    const state = await uploadAvatarAction(
      IDLE,
      form({ image: file(PNG), userId: 'someone-else' }),
    );

    expect(state).toEqual({ status: 'success', message: 'Profile picture updated.' });
    expect(api.uploadMyAvatar).toHaveBeenCalledTimes(1);
    const args = api.uploadMyAvatar.mock.calls[0] as unknown[];
    expect(args).toHaveLength(2);
    expect(args[0]).toBe('access-token');
    expect(JSON.stringify(args[1])).not.toContain('someone-else');
    expect(revalidatePath).toHaveBeenCalledWith('/admin', 'layout');
  });

  it('refuses a non-image before any API call', async () => {
    const state = await uploadAvatarAction(
      IDLE,
      form({ image: file([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) }),
    );

    expect(state.status).toBe('error');
    expect(api.uploadMyAvatar).not.toHaveBeenCalled();
  });

  it('keeps the old picture on screen and says so when the API cannot confirm', async () => {
    api.uploadMyAvatar.mockRejectedValue(refusal(503, 'service_unavailable'));

    const state = await uploadAvatarAction(IDLE, form({ image: file(PNG) }));

    expect(state.status).toBe('error');
    expect(state.message).toContain('Reload');
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('removeAvatarAction', () => {
  it('removes the signed-in account picture', async () => {
    api.removeMyAvatar.mockResolvedValue({ avatar: null });

    const state = await removeAvatarAction(IDLE, form({}));

    expect(state).toEqual({ status: 'success', message: 'Profile picture removed.' });
    expect(api.removeMyAvatar).toHaveBeenCalledWith('access-token');
  });
});
