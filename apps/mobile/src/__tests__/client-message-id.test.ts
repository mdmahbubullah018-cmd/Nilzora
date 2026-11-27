import { sendChatMessageRequestSchema } from '@nilzora/contracts';
import { newClientMessageId } from '@/features/support/use-support';

/*
 * The message id the app invents for itself must be one the API accepts. It is the only
 * thing that makes a retry idempotent, and a rejected id makes every send fail — so the
 * shape is checked against the very schema the server validates with, not a lookalike.
 */
describe('newClientMessageId', () => {
  it('is a version 4 UUID the API accepts, every time', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const id = newClientMessageId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(() =>
        sendChatMessageRequestSchema.parse({ clientMessageId: id, body: 'Hello' }),
      ).not.toThrow();
    }
  });

  it('never repeats itself', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newClientMessageId()));
    expect(ids.size).toBe(500);
  });
});
