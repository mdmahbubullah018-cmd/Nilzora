import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

/*
 * The support widget's server endpoint. The browser sends `{ op, ...fields }`; the strict
 * request schemas must see only the fields, or every reply, file message, rating and receipt
 * is refused. A customer may only close or reopen a thread, and a write the API answers with no
 * content becomes a bodiless 204.
 */

const gateway = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  postMessage: vi.fn(),
  markRead: vi.fn(),
  submitRating: vi.fn(),
  setStatus: vi.fn(),
  discardAttachment: vi.fn(),
  myMessageFeedback: vi.fn(),
  reactionSummary: vi.fn(),
  reportMessage: vi.fn(),
  toggleReaction: vi.fn(),
  submitMessageFeedback: vi.fn(),
}));
vi.mock('@/lib/support', () => ({ support: gateway }));
const sessionRead = vi.hoisted(() => vi.fn());
vi.mock('@/lib/session', () => ({ session: { read: sessionRead } }));
vi.mock('@nilzora/web-session', () => ({ getApiUrl: () => 'http://api.test' }));

const CONVERSATION = '44444444-4444-4444-8444-444444444444';
const UPLOAD = '55555555-5555-4555-8555-555555555555';
const CLIENT = '66666666-6666-4666-8666-666666666666';
const MESSAGE = '77777777-7777-4777-8777-777777777777';

function post(body: unknown): Request {
  return new Request('http://localhost:3000/api/support', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  for (const mock of Object.values(gateway)) {
    mock.mockReset();
    mock.mockResolvedValue({ ok: true, value: { ok: true } });
  }
});

describe('POST /api/support (storefront)', () => {
  it('accepts a reply, a file message, a read receipt and a rating with their op', async () => {
    const answers = await Promise.all([
      POST(post({ op: 'send', id: CONVERSATION, clientMessageId: CLIENT, body: 'Thanks' })),
      POST(
        post({
          op: 'post',
          conversationId: CONVERSATION,
          clientMessageId: CLIENT,
          attachmentIds: [UPLOAD],
        }),
      ),
      POST(post({ op: 'read', id: CONVERSATION, seq: 3 })),
      POST(post({ op: 'rating', conversationId: CONVERSATION, rating: 5 })),
    ]);
    expect(answers.map((response) => response.status)).toEqual([201, 201, 200, 201]);
    expect(gateway.sendMessage).toHaveBeenCalledWith(CONVERSATION, {
      clientMessageId: CLIENT,
      body: 'Thanks',
    });
  });

  it('lets a customer reopen or close a thread, and nothing else', async () => {
    expect((await POST(post({ op: 'status', id: CONVERSATION, status: 'open' }))).status).toBe(200);
    expect((await POST(post({ op: 'status', id: CONVERSATION, status: 'resolved' }))).status).toBe(
      400,
    );
    expect(gateway.setStatus).toHaveBeenCalledTimes(1);
  });

  it('answers a discarded upload with a bodiless 204', async () => {
    gateway.discardAttachment.mockResolvedValue({ ok: true, value: undefined });
    const response = await POST(post({ op: 'discard-attachment', id: UPLOAD }));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('forwards the quoted message on both the text and the file path', async () => {
    const quoted = '77777777-7777-4777-8777-777777777777';
    await POST(
      post({
        op: 'send',
        id: CONVERSATION,
        clientMessageId: CLIENT,
        body: 'That one',
        replyToId: quoted,
      }),
    );
    await POST(
      post({
        op: 'post',
        conversationId: CONVERSATION,
        clientMessageId: CLIENT,
        attachmentIds: [UPLOAD],
        replyToId: quoted,
      }),
    );
    expect(gateway.sendMessage).toHaveBeenCalledWith(CONVERSATION, {
      clientMessageId: CLIENT,
      body: 'That one',
      replyToId: quoted,
    });
    expect(gateway.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentIds: [UPLOAD], replyToId: quoted }),
    );
  });

  it('leaves the quote out when the customer is not answering anything', async () => {
    await POST(post({ op: 'send', id: CONVERSATION, clientMessageId: CLIENT, body: 'Plain' }));
    expect(gateway.sendMessage).toHaveBeenCalledWith(CONVERSATION, {
      clientMessageId: CLIENT,
      body: 'Plain',
    });
  });

  it('reports a message with a fixed reason and refuses an unknown one', async () => {
    gateway.reportMessage.mockResolvedValue({
      ok: true,
      value: { id: CLIENT, messageId: MESSAGE, status: 'open' },
    });
    const accepted = await POST(post({ op: 'report', messageId: MESSAGE, reason: 'abuse' }));
    expect(accepted.status).toBe(201);
    expect(gateway.reportMessage).toHaveBeenCalledWith(MESSAGE, 'abuse', undefined);
    const refused = await POST(post({ op: 'report', messageId: MESSAGE, reason: 'rude' }));
    expect(refused.status).toBe(400);
    expect(gateway.reportMessage).toHaveBeenCalledTimes(1);
  });

  it('toggles a reaction for one message and answers with the API tallies', async () => {
    gateway.toggleReaction.mockResolvedValue({
      ok: true,
      value: { messageId: MESSAGE, emoji: '👍', added: true, summary: [{ emoji: '👍', count: 1 }] },
    });
    const response = await POST(
      post({ op: 'react', conversationId: CONVERSATION, messageId: MESSAGE, emoji: '👍' }),
    );
    expect(response.status).toBe(200);
    expect(gateway.toggleReaction).toHaveBeenCalledWith(CONVERSATION, MESSAGE, '👍');
    expect(((await response.json()) as { added: boolean }).added).toBe(true);
  });

  it('records a helpful verdict with no note, and refuses an unknown verdict', async () => {
    const accepted = await POST(
      post({ op: 'message-feedback', messageId: MESSAGE, verdict: 'helpful' }),
    );
    expect(accepted.status).toBe(200);
    expect(gateway.submitMessageFeedback).toHaveBeenCalledWith(MESSAGE, { verdict: 'helpful' });
    const refused = await POST(
      post({ op: 'message-feedback', messageId: MESSAGE, verdict: 'meh' }),
    );
    expect(refused.status).toBe(400);
  });
});

describe('GET /api/support (storefront)', () => {
  function get(query: string): Request {
    return new Request(`http://localhost:3000/api/support?${query}`);
  }

  it('reads the thread reactions once for the whole conversation', async () => {
    gateway.reactionSummary.mockResolvedValue({ ok: true, value: { reactions: [] } });
    const response = await GET(get(`op=reactions&id=${CONVERSATION}`));
    expect(response.status).toBe(200);
    expect(gateway.reactionSummary).toHaveBeenCalledWith(CONVERSATION);
  });

  it('answers my-feedback with the customer own verdicts, read through the gateway', async () => {
    gateway.myMessageFeedback.mockResolvedValue({
      ok: true,
      value: { feedback: [{ messageId: MESSAGE, verdict: 'helpful' }] },
    });
    const response = await GET(get(`op=my-feedback&id=${CONVERSATION}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      feedback: [{ messageId: MESSAGE, verdict: 'helpful' }],
    });
    expect(gateway.myMessageFeedback).toHaveBeenCalledWith(CONVERSATION);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('refuses my-feedback for an id that is not a conversation id', async () => {
    const response = await GET(get('op=my-feedback&id=not-a-uuid'));
    expect(response.status).toBe(400);
    expect(gateway.myMessageFeedback).not.toHaveBeenCalled();
  });

  it('passes the API refusal through with its fixed message', async () => {
    gateway.myMessageFeedback.mockResolvedValue({
      ok: false,
      status: 404,
      code: 'conversation_not_found',
      message: 'That conversation is no longer available.',
    });
    const response = await GET(get(`op=my-feedback&id=${CONVERSATION}`));
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'conversation_not_found',
    );
  });
});

describe('GET /api/support?op=review-invite', () => {
  const PRODUCT = '0b9f7f5e-6a14-4c43-8d63-2d1e8f3b7a01';
  const pending = {
    items: [
      {
        productId: PRODUCT,
        productName: 'Cotton kurta',
        productSlug: 'cotton-kurta',
        variantLabel: null,
        image: null,
        orderNumber: 'NZ100042',
        deliveredAt: '2026-01-07T10:00:00.000Z',
      },
    ],
  };

  function invite(query: string) {
    return GET(new Request(`http://localhost:3000/api/support?op=review-invite&${query}`));
  }

  it("answers with the account's own unreviewed product of that order, and only the card's fields", async () => {
    sessionRead.mockResolvedValue({ kind: 'ok', value: pending });
    const response = await invite('order=NZ100042');
    expect(await response.json()).toEqual({
      item: { productId: PRODUCT, productName: 'Cotton kurta', orderNumber: 'NZ100042' },
    });
  });

  it('answers none for another order, another product, or a failed read', async () => {
    sessionRead.mockResolvedValue({ kind: 'ok', value: pending });
    expect(await (await invite('order=NZ999999')).json()).toEqual({ item: null });
    expect(await (await invite(`order=NZ100042&product=${CONVERSATION}`)).json()).toEqual({
      item: null,
    });
    sessionRead.mockResolvedValue({ kind: 'unavailable' });
    expect(await (await invite('order=NZ100042')).json()).toEqual({ item: null });
  });

  it('refuses a malformed order or product', async () => {
    expect((await invite('order=%3Cscript%3E')).status).toBe(400);
    expect((await invite('order=NZ100042&product=nope')).status).toBe(400);
  });
});
