import { CHAT_ATTACHMENT_MAX_BYTES } from '@nilzora/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const attachments = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock('@/lib/support', () => ({ support: { uploadAttachment: attachments.upload } }));

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const MEGABYTE = 1024 * 1024;

/** A body of `size` bytes, built on its own ArrayBuffer so it is a plain request body. */
function picture(size: number) {
  const view = new Uint8Array(new ArrayBuffer(size));
  return view.fill(7);
}

beforeEach(() => {
  attachments.upload.mockReset();
  attachments.upload.mockResolvedValue({
    ok: true,
    value: {
      id: '22222222-2222-4222-8222-222222222222',
      conversationId: CONVERSATION_ID,
      fileName: 'photo.png',
      contentType: 'image/webp',
      byteSize: 3,
      width: 800,
      height: 600,
      status: 'pending',
    },
  });
});

function request(
  body: BodyInit,
  contentLength: number,
  options: { type?: string; fileName?: string; conversationId?: string; durationMs?: number } = {},
): Request {
  const query = new URLSearchParams({
    conversationId: options.conversationId ?? CONVERSATION_ID,
    fileName: options.fileName ?? 'photo.png',
    ...(options.durationMs === undefined ? {} : { durationMs: String(options.durationMs) }),
  });
  return new Request(`http://localhost:3000/api/support/attachments?${query.toString()}`, {
    method: 'POST',
    headers: {
      'content-type': options.type ?? 'image/png',
      'content-length': String(contentLength),
    },
    body,
  });
}

describe('POST /api/support/attachments', () => {
  it('forwards the picture and answers with the API attachment', async () => {
    const response = await POST(request(picture(3), 3));

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({ fileName: 'photo.png' });
    expect(attachments.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        fileName: 'photo.png',
        contentType: 'image/png',
      }),
    );
    const sent = attachments.upload.mock.calls[0]?.[0] as { body: Uint8Array };
    expect(sent.body.byteLength).toBe(3);
  });

  it('accepts a picture between the old 8 MB ceiling and the chat-attachment limit', async () => {
    // The bug this covers: the route capped at 8 MB while the contract, the API and the app
    // all allow CHAT_ATTACHMENT_MAX_BYTES, so a 9 MB picture was refused here for no reason.
    const body = picture(9 * MEGABYTE);
    expect(body.byteLength).toBeLessThan(CHAT_ATTACHMENT_MAX_BYTES);

    const response = await POST(request(body, body.byteLength));

    expect(response.status).toBe(201);
    expect(attachments.upload).toHaveBeenCalledTimes(1);
  });

  it('refuses a picture above the chat-attachment limit before forwarding it', async () => {
    const response = await POST(
      request(picture(CHAT_ATTACHMENT_MAX_BYTES + 1), CHAT_ATTACHMENT_MAX_BYTES + 1),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'validation_failed', message: 'That file is larger than 10 MB.' },
    });
    expect(attachments.upload).not.toHaveBeenCalled();
  });

  it('refuses an empty or missing body', async () => {
    const response = await POST(request(picture(0), 0));

    expect(response.status).toBe(400);
    expect(attachments.upload).not.toHaveBeenCalled();
  });

  it('refuses an unsupported picture type', async () => {
    const response = await POST(request(picture(3), 3, { type: 'image/gif' }));

    expect(response.status).toBe(400);
    expect(attachments.upload).not.toHaveBeenCalled();
  });

  it('refuses a conversation id that is not a uuid', async () => {
    const response = await POST(request(picture(3), 3, { conversationId: 'not-a-uuid' }));

    expect(response.status).toBe(400);
    expect(attachments.upload).not.toHaveBeenCalled();
  });

  it('passes the API refusal through unchanged, including media_unavailable', async () => {
    attachments.upload.mockResolvedValue({
      ok: false,
      status: 503,
      code: 'media_unavailable',
      message: 'Picture uploads are unavailable right now.',
    });

    const response = await POST(request(picture(3), 3));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'media_unavailable', message: 'Picture uploads are unavailable right now.' },
    });
  });

  it('passes a permission refusal through unchanged', async () => {
    attachments.upload.mockResolvedValue({
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'You cannot attach to this conversation.',
    });

    const response = await POST(request(picture(3), 3));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'forbidden' } });
  });

  it('forwards a recording length for audio only', async () => {
    const ogg = new Uint8Array(new ArrayBuffer(120));
    ogg.set([0x4f, 0x67, 0x67, 0x53], 0);

    await POST(
      request(ogg, ogg.byteLength, {
        type: 'audio/ogg',
        fileName: 'voice.ogg',
        durationMs: 42_500,
      }),
    );

    expect(attachments.upload).toHaveBeenLastCalledWith(
      expect.objectContaining({ contentType: 'audio/ogg', durationMs: 42_500 }),
    );

    // The same parameter on a picture is dropped rather than sent to a database that refuses it.
    await POST(request(picture(3), 3, { durationMs: 42_500 }));

    const sent = attachments.upload.mock.calls.at(-1)?.[0] as { durationMs?: number };
    expect(sent.durationMs).toBeUndefined();
  });

  it('refuses a recording length beyond five minutes', async () => {
    const ogg = new Uint8Array(new ArrayBuffer(120));
    ogg.set([0x4f, 0x67, 0x67, 0x53], 0);

    const response = await POST(
      request(ogg, ogg.byteLength, {
        type: 'audio/ogg',
        fileName: 'voice.ogg',
        durationMs: 300_001,
      }),
    );

    expect(response.status).toBe(400);
    expect(attachments.upload).not.toHaveBeenCalled();
  });
});
