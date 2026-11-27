import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

/*
 * The Communication Center's server endpoint. Two regressions are held down here: the browser
 * sends `{ op, ...fields }` and the strict request schemas must see only the fields (they
 * refused every reply, note and queue change while `op` was still in the object), and a write
 * the API answers with no content must become a bodiless 204 (`NextResponse.json(undefined)`
 * throws, which turned every successful pin, archive and rule toggle into a 500).
 */

const gateway = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  addNote: vi.fn(),
  setStatus: vi.fn(),
  assign: vi.fn(),
  markRead: vi.fn(),
  pinMessage: vi.fn(),
  setAutomationRuleActive: vi.fn(),
  queue: vi.fn(),
}));
vi.mock('@/lib/support', () => ({ support: gateway }));
vi.mock('@nilzora/web-session', () => ({ getApiUrl: () => 'http://api.test' }));

const CONVERSATION = '44444444-4444-4444-8444-444444444444';
const MESSAGE = '55555555-5555-4555-8555-555555555555';
const CLIENT = '66666666-6666-4666-8666-666666666666';

function post(body: unknown): Request {
  return new Request('http://localhost:3001/api/support', {
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

describe('POST /api/support', () => {
  it('accepts a reply, a note, a read receipt and the queue controls with their op', async () => {
    const answers = await Promise.all([
      POST(post({ op: 'send', id: CONVERSATION, clientMessageId: CLIENT, body: 'On it' })),
      POST(post({ op: 'note', id: CONVERSATION, body: 'Called the courier' })),
      POST(post({ op: 'read', id: CONVERSATION, seq: 4 })),
      POST(post({ op: 'status', id: CONVERSATION, status: 'resolved' })),
      POST(post({ op: 'assignee', id: CONVERSATION, assigneeId: null })),
    ]);
    expect(answers.map((response) => response.status)).toEqual([201, 201, 200, 200, 200]);
    expect(gateway.sendMessage).toHaveBeenCalledWith(CONVERSATION, {
      clientMessageId: CLIENT,
      body: 'On it',
    });
    expect(gateway.addNote).toHaveBeenCalledWith(CONVERSATION, 'Called the courier');
    expect(gateway.setStatus).toHaveBeenCalledWith(CONVERSATION, 'resolved');
  });

  it('still refuses a field the operation does not take', async () => {
    const response = await POST(
      post({ op: 'note', id: CONVERSATION, body: 'x', authorId: CLIENT }),
    );
    expect(response.status).toBe(400);
    expect(gateway.addNote).not.toHaveBeenCalled();
  });

  it('answers a write with no content as a bodiless 204', async () => {
    gateway.pinMessage.mockResolvedValue({ ok: true, value: undefined });
    gateway.setAutomationRuleActive.mockResolvedValue({ ok: true, value: undefined });
    const pinned = await POST(
      post({ op: 'pin', conversationId: CONVERSATION, messageId: MESSAGE }),
    );
    const toggled = await POST(post({ op: 'automation-toggle', ruleId: MESSAGE, isActive: false }));
    expect(pinned.status).toBe(204);
    expect(toggled.status).toBe(204);
    expect(await pinned.text()).toBe('');
  });
});

describe('GET /api/support?op=queue', () => {
  it('passes the queue filters through to the gateway', async () => {
    gateway.queue.mockResolvedValue({ ok: true, value: { conversations: [] } });
    const response = await GET(
      new Request(
        'http://localhost:3001/api/support?op=queue&scope=mine&sort=oldest&priority=urgent&q=refund',
      ),
    );
    expect(response.status).toBe(200);
    expect(gateway.queue).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'mine',
        sort: 'oldest',
        priority: 'urgent',
        search: 'refund',
      }),
    );
  });
});
