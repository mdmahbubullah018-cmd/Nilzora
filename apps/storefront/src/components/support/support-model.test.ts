import type { ChatMessage, ChatParticipant } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import {
  isActiveStatus,
  lastSeenCustomerMessageId,
  mergeMessages,
  teamReadSeq,
} from './support-model';

const CUSTOMER = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';

function message(seq: number, senderRole: ChatMessage['senderRole'] = 'customer'): ChatMessage {
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    seq,
    senderId: senderRole === 'customer' ? CUSTOMER : AGENT,
    senderRole,
    senderName: null,
    kind: 'text',
    body: `Message ${String(seq)}`,
    replyToId: null,
    metadata: {},
    editedAt: null,
    createdAt: '2026-11-08T10:00:00.000Z',
    attachments: [],
  };
}

function participant(
  userId: string,
  role: ChatParticipant['role'],
  lastReadSeq: number,
): ChatParticipant {
  return {
    userId,
    role,
    name: null,
    email: null,
    lastReadSeq,
    lastDeliveredSeq: lastReadSeq,
    joinedAt: '',
  };
}

describe('support model', () => {
  it('merges stored messages without duplicates, oldest first', () => {
    expect(
      mergeMessages([message(3), message(1)], [message(1), message(2)]).map((m) => m.seq),
    ).toEqual([1, 2, 3]);
  });

  it('marks only the newest customer message a teammate has read', () => {
    const messages = [message(1), message(2), message(3, 'staff'), message(4)];
    const readSeq = teamReadSeq(
      [participant(CUSTOMER, 'customer', 4), participant(AGENT, 'staff', 2)],
      CUSTOMER,
    );
    expect(readSeq).toBe(2);
    expect(lastSeenCustomerMessageId(messages, readSeq)).toBe(messages[1]?.id);
  });

  it('claims nothing was seen before a teammate has read the thread', () => {
    expect(teamReadSeq([participant(CUSTOMER, 'customer', 4)], CUSTOMER)).toBeNull();
    expect(teamReadSeq([participant(AGENT, 'staff', 0)], CUSTOMER)).toBeNull();
    expect(lastSeenCustomerMessageId([message(1)], null)).toBeNull();
  });

  it('treats open and in-progress threads as active', () => {
    expect(isActiveStatus('open')).toBe(true);
    expect(isActiveStatus('pending')).toBe(true);
    expect(isActiveStatus('resolved')).toBe(false);
    expect(isActiveStatus('closed')).toBe(false);
  });
});
