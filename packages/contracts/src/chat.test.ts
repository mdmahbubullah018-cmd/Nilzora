import { describe, expect, it } from 'vitest';
import { sendChatMessageRequestSchema } from './chat';

/*
 * One wire detail that the Android app depends on: it writes "no quoted message" as null.
 * The API must read null and "absent" the same way, or a send from the app is refused with a
 * validation error the customer cannot act on.
 */
describe('sendChatMessageRequestSchema', () => {
  const clientMessageId = '00000000-0000-4000-8000-000000000001';

  it('accepts a message that quotes nothing, written as null or left out', () => {
    expect(
      sendChatMessageRequestSchema.parse({ clientMessageId, body: 'Hello', replyToId: null })
        .replyToId,
    ).toBeNull();
    expect(
      sendChatMessageRequestSchema.parse({ clientMessageId, body: 'Hello' }).replyToId,
    ).toBeUndefined();
  });

  it('still insists on a real message id when something is quoted', () => {
    expect(() =>
      sendChatMessageRequestSchema.parse({ clientMessageId, body: 'Hi', replyToId: 'nope' }),
    ).toThrow();
  });

  it('keeps the body rules: empty and over-long text are refused', () => {
    expect(() => sendChatMessageRequestSchema.parse({ clientMessageId, body: '   ' })).toThrow();
    expect(() =>
      sendChatMessageRequestSchema.parse({ clientMessageId, body: 'x'.repeat(4001) }),
    ).toThrow();
  });
});
