import { PRODUCT_IMAGE_MAX_BYTES } from '@nilzora/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const actions = vi.hoisted(() => ({ avatar: vi.fn(), photo: vi.fn() }));
vi.mock('@/lib/picture-actions', () => ({
  uploadAvatarAction: actions.avatar,
  uploadReviewPhotoAction: actions.photo,
}));

beforeEach(() => {
  actions.avatar.mockReset();
  actions.photo.mockReset();
});

function request(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/uploads/x', { method: 'POST', body, headers });
}

function form(): FormData {
  const data = new FormData();
  data.set('reviewId', 'r1');
  data.set('image', new File([new Uint8Array([1, 2, 3])], 'p.png', { type: 'image/png' }));
  return data;
}

const params = (kind: string) => ({ params: Promise.resolve({ kind }) });

describe('POST /api/uploads/:kind', () => {
  it.each([
    ['avatar', 'avatar'],
    ['review-photo', 'photo'],
  ] as const)('runs the %s Server Action and returns its state', async (kind, action) => {
    actions[action].mockResolvedValue({ status: 'success', message: 'Done.' });

    const response = await POST(request(form()), params(kind));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ status: 'success', message: 'Done.' });
    const [, sent] = actions[action].mock.calls[0] as [unknown, FormData];
    // (jsdom's File and the one a Request builds are different classes, so check the contents.)
    expect((sent.get('image') as File).size).toBe(3);
    expect(sent.get('reviewId')).toBe('r1');
  });

  it("returns the action's refusal untouched, never a success", async () => {
    actions.photo.mockResolvedValue({ status: 'signed_out', message: 'Your session has ended.' });

    const response = await POST(request(form()), params('review-photo'));

    await expect(response.json()).resolves.toEqual({
      status: 'signed_out',
      message: 'Your session has ended.',
    });
  });

  it('knows only avatar and review-photo uploads', async () => {
    for (const kind of ['brand-logo', 'constructor', '__proto__', '']) {
      const response = await POST(request(form()), params(kind));
      expect(response.status).toBe(404);
    }
    expect(actions.avatar).not.toHaveBeenCalled();
    expect(actions.photo).not.toHaveBeenCalled();
  });

  it('refuses an oversized body before reading it', async () => {
    const response = await POST(
      request(form(), { 'content-length': String(PRODUCT_IMAGE_MAX_BYTES * 2) }),
      params('avatar'),
    );

    expect(response.status).toBe(413);
    expect(actions.avatar).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a form', async () => {
    const response = await POST(
      request('not a form', { 'content-type': 'text/plain' }),
      params('avatar'),
    );

    expect(response.status).toBe(400);
    expect(actions.avatar).not.toHaveBeenCalled();
  });
});
