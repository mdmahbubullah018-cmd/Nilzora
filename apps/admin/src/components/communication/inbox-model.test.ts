import type { ChatConversationSummary, ChatInternalNote, ChatMessage } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import {
  awaitingReply,
  buildTimeline,
  customerReadSeq,
  dayLabel,
  initialsOf,
  lastSeenTeamMessageId,
  mergeMessages,
  relativeTime,
} from './inbox-model';

const CUSTOMER = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';

function message(seq: number, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    seq,
    senderId: CUSTOMER,
    senderRole: 'customer',
    senderName: 'Rina',
    kind: 'text',
    body: `Message ${String(seq)}`,
    replyToId: null,
    metadata: {},
    editedAt: null,
    createdAt: `2026-11-08T10:0${String(seq)}:00.000Z`,
    attachments: [],
    ...overrides,
  };
}

function summary(overrides: Partial<ChatConversationSummary> = {}): ChatConversationSummary {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    kind: 'customer_support',
    status: 'open',
    priority: 'normal',
    subject: 'Delivery',
    customerId: CUSTOMER,
    customerName: 'Rina Akter',
    customerEmail: 'rina@example.com',
    orderId: null,
    orderNumber: null,
    productId: null,
    productName: null,
    assigneeId: null,
    assigneeName: null,
    lastMessageAt: '2026-11-08T10:00:00.000Z',
    lastMessagePreview: 'Hello',
    lastMessageSenderId: CUSTOMER,
    messageCount: 1,
    unreadCount: 1,
    latestSeq: 1,
    createdAt: '2026-11-08T10:00:00.000Z',
    updatedAt: '2026-11-08T10:00:00.000Z',
    ...overrides,
  };
}

describe('mergeMessages', () => {
  it('keeps one copy of each message, in sequence order', () => {
    const merged = mergeMessages([message(2), message(3)], [message(3), message(1)]);
    expect(merged.map((entry) => entry.seq)).toEqual([1, 2, 3]);
  });
});

describe('buildTimeline', () => {
  it('interleaves notes by time, separates days and groups one author’s run', () => {
    const note: ChatInternalNote = {
      id: '44444444-4444-4444-8444-444444444444',
      seq: 1,
      authorId: AGENT,
      authorName: 'Agent',
      body: 'Called the courier',
      createdAt: '2026-11-08T10:02:30.000Z',
    };
    const items = buildTimeline(
      [message(1), message(2), message(3)],
      [note],
      [],
      new Date('2026-11-08T12:00:00Z'),
    );
    expect(items.map((item) => item.type)).toEqual([
      'day',
      'message',
      'message',
      'note',
      'message',
    ]);
    expect(items[0]).toMatchObject({ type: 'day', label: 'Today' });
    expect(items[1]).toMatchObject({ grouped: false });
    expect(items[2]).toMatchObject({ grouped: true });
    // A note breaks the run, so the next message shows its author again.
    expect(items[4]).toMatchObject({ grouped: false });
  });

  it('puts replies still on their way at the end', () => {
    const items = buildTimeline(
      [message(1)],
      [],
      [
        {
          clientMessageId: '55555555-5555-4555-8555-555555555555',
          body: 'On it',
          attachmentId: null,
          attachmentName: null,
          reply: null,
          createdAt: '2026-11-08T10:05:00.000Z',
          state: 'sending',
          error: null,
        },
      ],
    );
    expect(items.at(-1)?.type).toBe('outgoing');
  });
});

describe('read receipts', () => {
  it('marks only the newest team message the customer has read', () => {
    const messages = [
      message(1),
      message(2, { senderId: AGENT, senderRole: 'staff' }),
      message(3, { senderId: AGENT, senderRole: 'staff' }),
      message(4, { senderId: AGENT, senderRole: 'staff' }),
    ];
    const participants = [
      {
        userId: CUSTOMER,
        role: 'customer' as const,
        name: null,
        email: null,
        lastReadSeq: 3,
        lastDeliveredSeq: 3,
        joinedAt: '',
      },
    ];
    const readSeq = customerReadSeq(participants, CUSTOMER);
    expect(readSeq).toBe(3);
    expect(lastSeenTeamMessageId(messages, readSeq)).toBe(messages[2]?.id);
  });

  it('claims nothing was seen when the customer is not a participant', () => {
    expect(customerReadSeq([], CUSTOMER)).toBeNull();
    expect(lastSeenTeamMessageId([message(1, { senderRole: 'staff' })], null)).toBeNull();
  });
});

describe('queue helpers', () => {
  it('owes a reply when the customer wrote last in an open or resolved thread', () => {
    expect(awaitingReply(summary())).toBe(true);
    expect(awaitingReply(summary({ status: 'resolved' }))).toBe(true);
    expect(awaitingReply(summary({ lastMessageSenderId: AGENT }))).toBe(false);
    expect(awaitingReply(summary({ status: 'closed' }))).toBe(false);
  });

  it('formats times from the timestamp only', () => {
    const now = new Date('2026-11-08T12:00:00Z');
    expect(relativeTime('2026-11-08T11:59:30Z', now)).toBe('now');
    expect(relativeTime('2026-11-08T11:15:00Z', now)).toBe('45m');
    expect(relativeTime('2026-11-08T09:00:00Z', now)).toBe('3h');
    expect(relativeTime('2026-11-06T12:00:00Z', now)).toBe('2d');
    expect(dayLabel('2026-11-07T12:00:00', new Date('2026-11-08T12:00:00'))).toBe('Yesterday');
  });

  it('builds initials from a name or an email', () => {
    expect(initialsOf('Rina Akter')).toBe('RA');
    expect(initialsOf('karim.hasan@example.com')).toBe('KH');
    expect(initialsOf('')).toBe('?');
  });
});
