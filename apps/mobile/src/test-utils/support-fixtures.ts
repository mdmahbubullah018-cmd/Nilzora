import type {
  ChatAttachment,
  ChatConversationDetail,
  ChatMessage,
  ChatReactionSummaryItem,
} from '@nilzora/contracts';
import { createFakeApiClient, type FakeApiClient } from './api-fakes';

/*
 * Fixtures for the support conversation screen's tests. Not imported by the app, so never bundled.
 */

export const CONVERSATION_ID = '00000000-0000-4000-8000-0000000000c1';
export const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000b1';
export const STAFF_ID = '00000000-0000-4000-8000-0000000000ff';
export const ATTACHMENT_ID = '00000000-0000-4000-8000-0000000000a1';

/** A conversation as the API answers it for the customer who owns it. */
export function conversation(
  overrides: Partial<ChatConversationDetail['conversation']> = {},
): ChatConversationDetail {
  return {
    conversation: {
      id: CONVERSATION_ID,
      kind: 'customer_support',
      status: 'open',
      priority: 'normal',
      subject: 'Where is my order?',
      customerId: CUSTOMER_ID,
      orderId: null,
      productId: null,
      assigneeId: null,
      lastMessageAt: '2026-11-05T10:00:00.000Z',
      lastMessagePreview: 'Hello',
      lastMessageSenderId: null,
      messageCount: 0,
      createdAt: '2026-11-05T09:00:00.000Z',
      updatedAt: '2026-11-05T10:00:00.000Z',
      resolvedAt: null,
      closedAt: null,
      csatRating: null,
      ...overrides,
    },
    viewer: {
      userId: CUSTOMER_ID,
      role: 'customer',
      lastReadSeq: 0,
      isAssignee: false,
      canReply: true,
      canAssign: false,
      canUseInternalNotes: false,
    },
    customer: null,
    order: null,
    product: null,
    participants: [],
  };
}

/** A stored message. Defaults to a text message from a staff member. */
export function storedMessage(seq: number, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    seq,
    senderId: STAFF_ID,
    senderRole: 'staff',
    senderName: 'Rumana',
    kind: 'text',
    body: `Message ${String(seq)}`,
    replyToId: null,
    metadata: {},
    editedAt: null,
    createdAt: '2026-11-05T10:01:00.000Z',
    attachments: [],
    ...overrides,
  };
}

/** A message the customer wrote. */
export function customerMessage(seq: number, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return storedMessage(seq, {
    senderId: CUSTOMER_ID,
    senderRole: 'customer',
    senderName: 'Customer',
    ...overrides,
  });
}

export function attachment(overrides: Partial<ChatAttachment> = {}): ChatAttachment {
  return {
    id: ATTACHMENT_ID,
    fileName: 'parcel.webp',
    contentType: 'image/webp',
    byteSize: 2048,
    width: 800,
    height: 600,
    durationMs: null,
    url: `/chat/attachments/${ATTACHMENT_ID}/media`,
    thumbnailUrl: `/chat/attachments/${ATTACHMENT_ID}/media?variant=thumb`,
    ...overrides,
  };
}

export function reaction(
  messageId: string,
  emoji: string,
  overrides: Partial<ChatReactionSummaryItem> = {},
): ChatReactionSummaryItem {
  return { messageId, emoji, count: 1, mine: false, ...overrides };
}

/** The API's answer to a successful attachment upload. */
export function uploadedAttachment(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTACHMENT_ID,
    conversationId: CONVERSATION_ID,
    objectKey: 'chat/attachments/one',
    fileName: 'receipt.webp',
    contentType: 'image/webp',
    byteSize: 4096,
    width: 800,
    height: 600,
    durationMs: null,
    status: 'pending' as const,
    ...overrides,
  };
}

/** A fake API for the screen: an empty open conversation that accepts every write. */
export function supportApi(
  options: {
    messages?: ChatMessage[];
    status?: ChatConversationDetail['conversation']['status'];
    detail?: Partial<ChatConversationDetail['conversation']>;
  } = {},
): FakeApiClient {
  const api = createFakeApiClient();
  api.getChatConversation.mockResolvedValue(
    conversation({ status: options.status ?? 'open', ...options.detail }),
  );
  api.listChatMessages.mockResolvedValue({ messages: options.messages ?? [], nextCursor: null });
  api.listChatPinnedMessages.mockResolvedValue({ messages: [] });
  api.listChatReactionSummary.mockResolvedValue({ reactions: [] });
  api.markChatRead.mockResolvedValue({ unread: 0 });
  api.listMyChatFeedback.mockResolvedValue({ feedback: [] });
  api.postChatMessage.mockResolvedValue({
    message: {
      id: '00000000-0000-4000-8000-0000000000d1',
      seq: 1,
      senderId: CUSTOMER_ID,
      senderRole: 'customer',
      senderName: 'Customer',
      kind: 'text',
      body: null,
      replyToId: null,
      metadata: {},
      createdAt: '2026-11-05T10:01:00.000Z',
    },
    duplicate: false,
    unreadCount: 0,
    attachments: [],
  });
  api.sendChatMessage.mockResolvedValue({
    message: customerMessage(1, { body: 'Hello' }),
    duplicate: false,
    unread: 0,
  });
  return api;
}
