import { PRODUCT_IMAGE_MAX_BYTES } from '@nilzora/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RESPOND_AS_STATE } from '@/lib/upload-routes';
import { POST } from './route';

const actions = vi.hoisted(() => ({
  product: vi.fn(),
  brand: vi.fn(),
  brandBanner: vi.fn(),
  banner: vi.fn(),
  bannerMobile: vi.fn(),
  categoryImage: vi.fn(),
  saveCategory: vi.fn(),
  avatar: vi.fn(),
  media: vi.fn(),
}));

vi.mock('@/lib/image-actions', () => ({ uploadProductImageAction: actions.product }));
vi.mock('@/lib/category-image-actions', () => ({
  uploadCategoryImageAction: actions.categoryImage,
  uploadCategoryBannerAction: vi.fn(),
}));
vi.mock('@/lib/catalog-actions', () => ({ saveCategoryAction: actions.saveCategory }));
vi.mock('@/lib/avatar-actions', () => ({ uploadAvatarAction: actions.avatar }));
vi.mock('@/lib/media-actions', () => ({ uploadMediaAction: actions.media }));
vi.mock('@/lib/merch-actions', () => ({
  uploadBrandLogoAction: actions.brand,
  uploadBrandBannerAction: actions.brandBanner,
  uploadBannerImageAction: actions.banner,
  uploadBannerMobileImageAction: actions.bannerMobile,
}));

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
});

function request(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3001/api/uploads/x', { method: 'POST', body, headers });
}

function form(): FormData {
  const data = new FormData();
  data.set('brandId', 'b1');
  data.set('image', new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' }));
  return data;
}

const params = (kind: string) => ({ params: Promise.resolve({ kind }) });

describe('POST /api/uploads/:kind', () => {
  it.each([
    ['product-image', 'product'],
    ['brand-logo', 'brand'],
    ['brand-banner', 'brandBanner'],
    ['banner-image', 'banner'],
    ['banner-mobile-image', 'bannerMobile'],
    ['category-image', 'categoryImage'],
    ['avatar', 'avatar'],
  ] as const)('runs the %s Server Action and returns its state', async (kind, action) => {
    actions[action].mockResolvedValue({ status: 'success', message: 'Done.' });

    const response = await POST(request(form()), params(kind));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ status: 'success', message: 'Done.' });
    const [, sent] = actions[action].mock.calls[0] as [unknown, FormData];
    expect(sent.get('brandId')).toBe('b1');
    expect(sent.get('image')).toBeInstanceOf(File);
    // The route, not the browser, asks for a state instead of a redirect.
    expect(sent.get(RESPOND_AS_STATE)).toBe('1');
  });

  it("returns the action's refusal untouched, so a failure is never reported as success", async () => {
    actions.brand.mockResolvedValue({ status: 'error', message: 'Your account cannot do this.' });

    const response = await POST(request(form()), params('brand-logo'));

    await expect(response.json()).resolves.toEqual({
      status: 'error',
      message: 'Your account cannot do this.',
    });
  });

  it('answers a refusal with the status that matches it, never with 200', async () => {
    actions.brand.mockResolvedValue({ status: 'error', message: 'The picture is too large.' });
    expect((await POST(request(form()), params('brand-logo'))).status).toBe(422);

    actions.brand.mockResolvedValue({ status: 'signed_out' });
    expect((await POST(request(form()), params('brand-logo'))).status).toBe(401);

    actions.brand.mockResolvedValue({
      status: 'error',
      message: 'This form has expired or did not come from Nilzora. Reload the page and try again.',
    });
    expect((await POST(request(form()), params('brand-logo'))).status).toBe(403);
  });

  it('runs the media library action for the media kind, answering with its state', async () => {
    actions.media.mockResolvedValue({
      status: 'success',
      message: 'Picture added to the library.',
    });

    const response = await POST(request(form()), params('media'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'success',
      message: 'Picture added to the library.',
    });
    const sent = actions.media.mock.calls[0]?.[1] as FormData;
    expect(sent.get(RESPOND_AS_STATE)).toBe('1');
    expect(actions.brand).not.toHaveBeenCalled();
  });

  it('knows only its own upload kinds', async () => {
    const response = await POST(request(form()), params('passport'));

    expect(response.status).toBe(404);
    expect(Object.values(actions).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('refuses an oversized body before reading it', async () => {
    const response = await POST(
      request(form(), { 'content-length': String(PRODUCT_IMAGE_MAX_BYTES * 2) }),
      params('brand-logo'),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ status: 'error' });
    expect(actions.brand).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a form', async () => {
    const response = await POST(
      request('not a form', { 'content-type': 'text/plain' }),
      params('brand-logo'),
    );

    expect(response.status).toBe(400);
    expect(actions.brand).not.toHaveBeenCalled();
  });

  describe('category-create', () => {
    const CATEGORY = '0c000000-0000-4000-8000-000000000001';

    it('creates the category, then attaches the picture to the NEW category id', async () => {
      actions.saveCategory.mockResolvedValue({
        status: 'success',
        message: 'Category created.',
        values: { categoryId: CATEGORY },
      });
      actions.categoryImage.mockResolvedValue({ status: 'success', message: 'Picture updated.' });

      const response = await POST(request(form()), params('category-create'));

      await expect(response.json()).resolves.toMatchObject({ status: 'success' });
      const [, saved] = actions.saveCategory.mock.calls[0] as [unknown, FormData];
      expect(saved.get(RESPOND_AS_STATE)).toBe('1');
      const [, picture] = actions.categoryImage.mock.calls[0] as [unknown, FormData];
      expect(picture.get('categoryId')).toBe(CATEGORY);
      expect(picture.get('image')).toBeInstanceOf(File);
    });

    it('says plainly when the category exists but its picture was not saved, and names it', async () => {
      actions.saveCategory.mockResolvedValue({
        status: 'success',
        values: { categoryId: CATEGORY },
      });
      actions.categoryImage.mockResolvedValue({
        status: 'error',
        message: 'The picture is too large.',
      });

      const response = await POST(request(form()), params('category-create'));
      const body = (await response.json()) as { status: string; message: string; values: object };

      expect(body.status).toBe('error');
      expect(body.message).toContain('category was created');
      expect(body.message).toContain('The picture is too large.');
      expect(body.values).toEqual({ categoryId: CATEGORY });
    });

    it('does not touch the picture when the category itself is refused', async () => {
      actions.saveCategory.mockResolvedValue({
        status: 'error',
        message: 'Check the highlighted fields.',
        fieldErrors: { name: 'Enter a name' },
      });

      const response = await POST(request(form()), params('category-create'));

      await expect(response.json()).resolves.toMatchObject({
        status: 'error',
        fieldErrors: { name: 'Enter a name' },
      });
      expect(actions.categoryImage).not.toHaveBeenCalled();
    });
  });
});
