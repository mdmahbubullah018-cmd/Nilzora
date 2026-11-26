import type { ChatMessage, ChatMessagePage, PostedChatMessage } from '@nilzora/contracts';
import {
  appendStoredMessage,
  postedToStored,
  prependStoredMessages,
  removeOutgoing,
  timelineRows,
  updateOutgoing,
  type OutgoingMessage,
} from '@/features/support/optimistic-messages';

/*
 * The rules behind an instantly-visible, never-lost message. Nothing here touches the network:
 * these are the decisions the thread makes about what to draw, tested on their own.
 */

function message(seq: number, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    seq,
    senderId: '00000000-0000-4000-8000-0000000000b1',
    senderRole: 'customer',
    senderName: 'Customer',
    kind: 'text',
    body: `Message ${String(seq)}`,
    replyToId: null,
    metadata: {},
    editedAt: null,
    createdAt: `2026-11-06T10:0${String(seq % 10)}:00.000Z`,
    attachments: [],
    ...overrides,
  };
}

function outgoing(overrides: Partial<OutgoingMessage> = {}): OutgoingMessage {
  return {
    clientMessageId: 'client-1',
    body: 'Hello',
    createdAt: '2026-11-06T10:05:00.000Z',
    attachments: [],
    reply: null,
    status: 'sending',
    failure: null,
    ...overrides,
  };
}

function page(messages: ChatMessage[], nextCursor: number | null = null): ChatMessagePage {
  return { messages, nextCursor };
}

describe('a local message and its stored twin', () => {
  const FILE = '00000000-0000-4000-8000-0000000000f1';
  const stored = (seq: number, overrides: Partial<ChatMessage> = {}) =>
    message(seq, {
      attachments: [
        {
          id: FILE,
          fileName: 'shot.webp',
          contentType: 'image/webp',
          byteSize: 4096,
          width: 8,
          height: 8,
          durationMs: null,
          url: null,
          thumbnailUrl: null,
        },
      ],
      body: 'shot.webp',
      ...overrides,
    });
  const withFile = outgoing({
    body: '',
    attachments: [{ id: FILE, fileName: 'shot.webp', localUri: 'file:///cache/shot.jpg' }],
  });

  it('draws a picture once when the stored copy arrives before the POST answers', () => {
    const rows = timelineRows([message(1), stored(2)], [withFile]);

    expect(rows.map((row) => row.kind)).toEqual(['stored', 'stored']);
  });

  it('matches by the stored client id when the server returns one', () => {
    const rows = timelineRows(
      [message(2, { metadata: { clientMessageId: 'client-1' } })],
      [outgoing({ body: 'different words' })],
    );

    expect(rows.map((row) => row.kind)).toEqual(['stored']);
  });

  it('matches a text message by its words once it is newer than the send point', () => {
    const local = outgoing({ body: 'Hello', baseSeq: 5 });

    expect(timelineRows([message(6, { body: 'Hello' })], [local]).map((r) => r.kind)).toEqual([
      'stored',
    ]);
    // The same words from before the send are an earlier message, not this one.
    expect(timelineRows([message(4, { body: 'Hello' })], [local]).map((r) => r.kind)).toEqual([
      'stored',
      'outgoing',
    ]);
  });

  it('keeps a failed local message and a stranger with other files apart', () => {
    const other = stored(2, {
      attachments: [{ ...stored(2).attachments[0]!, id: '00000000-0000-4000-8000-0000000000f2' }],
    });
    const rows = timelineRows([other], [{ ...withFile, status: 'failed', failure: 'Offline' }]);

    expect(rows.map((row) => row.kind)).toEqual(['stored', 'outgoing']);
  });

  it('lets one stored message answer only one local message', () => {
    const first = outgoing({ clientMessageId: 'a', body: 'Hi', baseSeq: 0 });
    const second = outgoing({ clientMessageId: 'b', body: 'Hi', baseSeq: 0 });

    const rows = timelineRows([message(1, { body: 'Hi' })], [first, second]);

    expect(rows.map((row) => row.kind)).toEqual(['stored', 'outgoing']);
  });
});

describe('the timeline', () => {
  it('draws committed messages first and the local ones after them', () => {
    const rows = timelineRows([message(1), message(2)], [outgoing()]);

    expect(rows.map((row) => row.kind)).toEqual(['stored', 'stored', 'outgoing']);
    expect(rows[2]?.key).toBe('outgoing:client-1');
  });

  it('gives every row a stable key of its own', () => {
    const rows = timelineRows(
      [message(1)],
      [outgoing(), outgoing({ clientMessageId: 'client-2' })],
    );

    expect(new Set(rows.map((row) => row.key)).size).toBe(3);
  });

  it('marks a local message failed without losing it', () => {
    const failed = updateOutgoing([outgoing()], 'client-1', {
      status: 'failed',
      failure: 'Network unreachable',
    });

    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ status: 'failed', failure: 'Network unreachable' });
  });

  it('removes a local message once the server has it', () => {
    expect(removeOutgoing([outgoing()], 'client-1')).toEqual([]);
    // A different id is untouched, so two messages in flight never remove each other.
    expect(removeOutgoing([outgoing()], 'client-2')).toHaveLength(1);
  });
});

describe('merging a committed message into the cache', () => {
  it('appends a newer message', () => {
    const merged = appendStoredMessage(page([message(1)]), message(2));

    expect(merged.messages.map((entry) => entry.seq)).toEqual([1, 2]);
  });

  it('ignores a message the page already holds, so the socket and the answer cannot duplicate it', () => {
    const once = appendStoredMessage(page([message(1)]), message(2));
    const twice = appendStoredMessage(once, message(2));

    expect(twice.messages).toHaveLength(2);
  });

  it('inserts a message in sequence order rather than always at the end', () => {
    const merged = appendStoredMessage(page([message(1), message(3)]), message(2));

    expect(merged.messages.map((entry) => entry.seq)).toEqual([1, 2, 3]);
  });

  it('creates a page when the thread was not cached yet', () => {
    expect(appendStoredMessage(undefined, message(1))).toEqual({
      messages: [message(1)],
      nextCursor: null,
    });
  });

  it('keeps the existing next cursor', () => {
    expect(appendStoredMessage(page([message(2)], 2), message(3)).nextCursor).toBe(2);
  });
});

describe('loading older history', () => {
  it('puts the older page in front, without repeating a message already shown', () => {
    const merged = prependStoredMessages(page([message(3), message(4)], 3), [
      message(1),
      message(2),
      message(3),
    ]);

    expect(merged.messages.map((entry) => entry.seq)).toEqual([1, 2, 3, 4]);
  });

  it('starts a page from the history when nothing was cached', () => {
    expect(prependStoredMessages(undefined, [message(1)])).toEqual(page([message(1)]));
  });
});

describe('reading a message the attachment endpoint answered with', () => {
  it('joins the envelope with the attachments beside it and marks it unedited', () => {
    const posted: PostedChatMessage = {
      message: {
        id: '00000000-0000-4000-8000-000000000009',
        seq: 9,
        senderId: '00000000-0000-4000-8000-0000000000b1',
        senderRole: 'customer',
        senderName: 'Customer',
        kind: 'text',
        body: null,
        replyToId: null,
        metadata: {},
        createdAt: '2026-11-06T10:09:00.000Z',
      },
      duplicate: false,
      unreadCount: 0,
      attachments: [
        {
          id: '00000000-0000-4000-8000-0000000000a1',
          fileName: 'receipt.webp',
          contentType: 'image/webp',
          byteSize: 4096,
          width: 800,
          height: 600,
          durationMs: null,
          url: 'https://media.example.test/chat/receipt/full.webp',
          thumbnailUrl: 'https://media.example.test/chat/receipt/thumb.webp',
        },
      ],
    };

    const stored = postedToStored(posted);

    expect(stored.senderRole).toBe('customer');
    expect(stored.kind).toBe('text');
    expect(stored.editedAt).toBeNull();
    expect(stored.attachments).toHaveLength(1);
    expect(stored.attachments[0]?.fileName).toBe('receipt.webp');
  });
});
