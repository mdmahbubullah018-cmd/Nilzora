import { PRODUCT_IMAGE_MAX_BYTES } from '@nilzora/contracts';
import { ApiError, type ApiClient, type FormState } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  removeBannerMobileImageAction,
  reorderBannersAction,
  uploadBannerMobileImageAction,
} from './merch-actions';

/*
 * The banner actions added with the storefront-content work: the small-screen picture
 * (upload and removal) and moving a banner among those of its placement. The pictures are
 * built in memory here; nothing is sent to the API, the media service or any bucket.
 */

type Outcome = 'ok' | 'untrusted' | 'signed_out' | 'unavailable';

const api = vi.hoisted(() => ({
  adminUploadBannerMobileImage: vi.fn(),
  adminRemoveBannerMobileImage: vi.fn(),
  adminReorderBanners: vi.fn(),
}));
const act = vi.hoisted((): { outcome: Outcome; calls: number } => ({ outcome: 'ok', calls: 0 }));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('@/lib/session', () => ({
  session: {
    act: async (_formData: FormData, call: (client: ApiClient, token: string) => unknown) => {
      act.calls += 1;
      if (act.outcome !== 'ok') return { kind: act.outcome };
      return { kind: 'ok', value: await call(api as unknown as ApiClient, 'access-token') };
    },
  },
}));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`redirect:${url}`);
  }),
}));

const IDLE: FormState = { status: 'idle' };
const BANNER = '0b000000-0000-4000-8000-000000000001';
const A = '1d000000-0000-4000-8000-00000000000a';
const B = '1d000000-0000-4000-8000-00000000000b';
const C = '1d000000-0000-4000-8000-00000000000c';
const CATEGORY = '0c000000-0000-4000-8000-000000000001';
const API_TEXT = 'API text that must not reach the browser';
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4];

function file(bytes: readonly number[], name = 'wide.png', type = 'image/png'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function form(fields: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

function refusal(status: number, code: string): ApiError {
  return new ApiError(status, code, API_TEXT, 'req-1');
}

beforeEach(() => {
  act.outcome = 'ok';
  act.calls = 0;
  revalidatePath.mockReset();
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({});
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('uploadBannerMobileImageAction', () => {
  it('sends the bytes, as the type they really are, to the banner named by the form', async () => {
    const state = await uploadBannerMobileImageAction(
      IDLE,
      // Reported as a JPEG, but its bytes say PNG: the bytes decide.
      form({ bannerId: BANNER, image: file(PNG, 'phone.jpg', 'image/jpeg') }),
    );
    expect(state).toEqual({ status: 'success', message: 'Small-screen picture updated.' });
    const [token, id, image] = api.adminUploadBannerMobileImage.mock.calls[0] as [
      string,
      string,
      { bytes: Uint8Array; contentType: string },
    ];
    expect(token).toBe('access-token');
    expect(id).toBe(BANNER);
    expect(image.contentType).toBe('image/png');
    expect([...image.bytes]).toEqual(PNG);
    expect(revalidatePath).toHaveBeenCalledWith('/admin/banners');
  });

  it('refuses a bad banner id, a missing file, a big file and a non-image before any API call', async () => {
    const cases: FormData[] = [
      form({ bannerId: 'nope', image: file(PNG) }),
      form({ bannerId: BANNER }),
      form({ bannerId: BANNER, image: file(new Array<number>(PRODUCT_IMAGE_MAX_BYTES + 1).fill(7)) }),
      form({ bannerId: BANNER, image: file([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) }),
    ];
    for (const data of cases) {
      expect((await uploadBannerMobileImageAction(IDLE, data)).status).toBe('error');
    }
    expect(api.adminUploadBannerMobileImage).not.toHaveBeenCalled();
    expect(act.calls).toBe(0);
  });

  it('shows a fixed message for a refusal and never the API text', async () => {
    api.adminUploadBannerMobileImage.mockRejectedValue(refusal(403, 'forbidden'));
    const state = await uploadBannerMobileImageAction(IDLE, form({ bannerId: BANNER, image: file(PNG) }));
    expect(state.status).toBe('error');
    expect(JSON.stringify(state)).not.toContain(API_TEXT);
    expect(revalidatePath).not.toHaveBeenCalled();

    api.adminUploadBannerMobileImage.mockRejectedValue(refusal(503, 'media_unavailable'));
    const off = await uploadBannerMobileImageAction(IDLE, form({ bannerId: BANNER, image: file(PNG) }));
    expect(off.message).toContain('media storage is off');
  });

  it('reaches no API with an untrusted form and sends a signed-out visitor to sign in', async () => {
    act.outcome = 'untrusted';
    expect((await uploadBannerMobileImageAction(IDLE, form({ bannerId: BANNER, image: file(PNG) }))).status).toBe(
      'error',
    );
    expect(api.adminUploadBannerMobileImage).not.toHaveBeenCalled();

    act.outcome = 'signed_out';
    await expect(
      uploadBannerMobileImageAction(IDLE, form({ bannerId: BANNER, image: file(PNG) })),
    ).rejects.toThrow(/redirect:/);
  });
});

describe('removeBannerMobileImageAction', () => {
  it('removes the small-screen picture of the named banner', async () => {
    const state = await removeBannerMobileImageAction(IDLE, form({ bannerId: BANNER }));
    expect(state).toEqual({ status: 'success', message: 'Small-screen picture removed.' });
    expect(api.adminRemoveBannerMobileImage).toHaveBeenCalledWith('access-token', BANNER);
    expect(revalidatePath).toHaveBeenCalledWith('/admin/banners');
  });

  it('needs a valid banner id and a refusal shows a fixed message', async () => {
    expect((await removeBannerMobileImageAction(IDLE, form({ bannerId: 'x' }))).status).toBe('error');
    expect(api.adminRemoveBannerMobileImage).not.toHaveBeenCalled();

    api.adminRemoveBannerMobileImage.mockRejectedValue(refusal(403, 'forbidden'));
    const state = await removeBannerMobileImageAction(IDLE, form({ bannerId: BANNER }));
    expect(state.status).toBe('error');
    expect(JSON.stringify(state)).not.toContain(API_TEXT);
  });
});

describe('reorderBannersAction', () => {
  const ORDER = `${A},${B},${C}`;
  const STALE = 'The banners changed since this page loaded. Reload it and try again.';

  it('sends the whole placement in its new order', async () => {
    const state = await reorderBannersAction(
      IDLE,
      form({ bannerId: B, direction: 'earlier', placement: 'home_hero', categoryId: '', order: ORDER }),
    );
    expect(state).toEqual({ status: 'success', message: 'Order saved.' });
    expect(api.adminReorderBanners).toHaveBeenLastCalledWith('access-token', {
      placement: 'home_hero',
      categoryId: null,
      ids: [B, A, C],
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/banners');
  });

  it('keeps a category strip in its category', async () => {
    await reorderBannersAction(
      IDLE,
      form({ bannerId: B, direction: 'later', placement: 'category', categoryId: CATEGORY, order: ORDER }),
    );
    expect(api.adminReorderBanners).toHaveBeenLastCalledWith('access-token', {
      placement: 'category',
      categoryId: CATEGORY,
      ids: [A, C, B],
    });
  });

  it('refuses a move past either end, an id outside the order, a placement/category mismatch and bad ids', async () => {
    const base = { placement: 'home_hero', categoryId: '', order: ORDER };
    expect(await reorderBannersAction(IDLE, form({ ...base, bannerId: A, direction: 'earlier' }))).toEqual({
      status: 'error',
      message: STALE,
    });
    expect(await reorderBannersAction(IDLE, form({ ...base, bannerId: C, direction: 'later' }))).toEqual({
      status: 'error',
      message: STALE,
    });
    expect(
      await reorderBannersAction(IDLE, form({ ...base, bannerId: B, direction: 'later', order: `${A},${C}` })),
    ).toEqual({ status: 'error', message: STALE });
    // A hero banner cannot carry a category; a category strip needs one.
    expect(
      await reorderBannersAction(IDLE, form({ ...base, bannerId: B, direction: 'later', categoryId: CATEGORY })),
    ).toEqual({ status: 'error', message: STALE });
    expect(
      await reorderBannersAction(IDLE, form({ ...base, bannerId: B, direction: 'later', placement: 'category' })),
    ).toEqual({ status: 'error', message: STALE });
    expect(
      await reorderBannersAction(IDLE, form({ ...base, bannerId: B, direction: 'later', placement: 'sidebar' })),
    ).toEqual({ status: 'error', message: STALE });

    for (const bad of [
      { ...base, bannerId: 'nope', direction: 'later' },
      { ...base, bannerId: B, direction: 'sideways' },
    ]) {
      expect(await reorderBannersAction(IDLE, form(bad))).toEqual({
        status: 'error',
        message: 'This page is out of date. Reload it and try again.',
      });
    }
    expect(api.adminReorderBanners).not.toHaveBeenCalled();
  });

  it('answers a refused order with a fixed message and an untrusted form with no call', async () => {
    const fields = { bannerId: B, direction: 'later', placement: 'home_hero', categoryId: '', order: ORDER };
    api.adminReorderBanners.mockRejectedValue(refusal(400, 'bad_request'));
    const refused = await reorderBannersAction(IDLE, form(fields));
    expect(refused).toEqual({ status: 'error', message: STALE });
    expect(JSON.stringify(refused)).not.toContain(API_TEXT);

    api.adminReorderBanners.mockClear();
    act.outcome = 'untrusted';
    expect((await reorderBannersAction(IDLE, form(fields))).status).toBe('error');
    expect(api.adminReorderBanners).not.toHaveBeenCalled();
  });
});
