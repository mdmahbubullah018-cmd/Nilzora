import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const media = vi.hoisted(() => ({ media: vi.fn() }));
vi.mock('@/lib/support', () => ({ support: { media: media.media } }));

const ATTACHMENT_ID = '11111111-1111-4111-8111-111111111111';

function request(query = ''): Request {
  return new Request(`http://localhost:3001/api/support/media/${ATTACHMENT_ID}${query}`);
}

function context(attachmentId: string) {
  return { params: Promise.resolve({ attachmentId }) };
}

beforeEach(() => {
  media.media.mockReset();
  media.media.mockResolvedValue({
    ok: true,
    value: {
      bytes: new Uint8Array([1, 2, 3]),
      fileName: 'voice.ogg',
      contentType: 'audio/ogg',
    },
  });
});

describe('GET /api/support/media/[attachmentId]', () => {
  it('streams the bytes with headers that keep them private', async () => {
    const response = await GET(request(), context(ATTACHMENT_ID));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-type')).toBe('audio/ogg');
    expect(response.headers.get('content-length')).toBe('3');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('accept-ranges')).toBe('none');
    expect(response.headers.get('content-disposition')).toBe('inline; filename="voice.ogg"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(media.media).toHaveBeenCalledWith(ATTACHMENT_ID, 'full');
  });

  it('asks for the thumbnail only when the variant says so', async () => {
    await GET(request('?variant=thumb'), context(ATTACHMENT_ID));
    expect(media.media).toHaveBeenLastCalledWith(ATTACHMENT_ID, 'thumb');

    await GET(request('?variant=huge'), context(ATTACHMENT_ID));
    expect(media.media).toHaveBeenLastCalledWith(ATTACHMENT_ID, 'full');
  });

  it('refuses an id that is not a uuid before reaching the API', async () => {
    const response = await GET(request(), context('../../etc/passwd'));

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      error: { code: 'not_found', message: 'That file is not available' },
    });
    expect(media.media).not.toHaveBeenCalled();
  });

  it('passes a permission refusal through unchanged and stays uncacheable', async () => {
    media.media.mockResolvedValue({
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'That file is not available.',
    });

    const response = await GET(request(), context(ATTACHMENT_ID));

    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      error: { code: 'forbidden', message: 'That file is not available.' },
    });
  });

  it('passes a media outage through so the client can retry', async () => {
    media.media.mockResolvedValue({
      ok: false,
      status: 503,
      code: 'media_unavailable',
      message: 'That file cannot be opened right now.',
    });

    const response = await GET(request(), context(ATTACHMENT_ID));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'media_unavailable' } });
  });

  it('strips characters a filename could use to break out of the header', async () => {
    media.media.mockResolvedValue({
      ok: true,
      value: {
        bytes: new Uint8Array([1]),
        fileName: 'a"b\\c\r\nd.ogg',
        contentType: 'audio/ogg',
      },
    });

    const response = await GET(request(), context(ATTACHMENT_ID));

    expect(response.headers.get('content-disposition')).toBe('inline; filename="a_b_c__d.ogg"');
  });
});
