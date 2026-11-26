import type {
  ChatConversationDetail,
  ChatConversationListQuery,
  ChatConversationSummary,
  ChatInternalNote,
  ChatMessage,
  ChatMessagePage,
  ChatNotesResponse,
  ChatPriority,
  ChatQueueQuery,
  ChatReportResponse,
  SendChatMessageResponse,
  ChatSocketTicket,
  StartChatConversationRequest,
} from '@nilzora/contracts';
import { ChatRefusalError, type ChatRefusal } from '../modules/chat/errors';
import type { ChatStore, SendMessageInput } from '../modules/chat/store';

/*
 * In-memory stand-in for the chat functions, for unit tests of the API's own logic.
 * It copies the database's decisions only where the API depends on them: who may read a
 * thread (owner or staff), when a send is a duplicate, and which refusals are raised.
 * The rules themselves are covered by the pgTAP suite.
 */

export const CHAT_CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
export const CHAT_OTHER_CUSTOMER_ID = '22222222-2222-4222-8222-222222222222';
export const CHAT_STAFF_ID = '33333333-3333-4333-8333-333333333333';
export const CHAT_CONVERSATION_ID = '44444444-4444-4444-8444-444444444444';
export const CHAT_MESSAGE_ID = '55555555-5555-4555-8555-555555555555';

const FIXED_TIME = '2026-11-03T10:00:00.000Z';

function summary(overrides: Partial<ChatConversationSummary> = {}): ChatConversationSummary {
  return {
    id: CHAT_CONVERSATION_ID,
    kind: 'customer_support',
    status: 'open',
    priority: 'normal',
    subject: 'Do you ship to Sylhet?',
    customerId: CHAT_CUSTOMER_ID,
    customerName: 'Customer One',
    customerEmail: 'one@example.com',
    orderId: null,
    orderNumber: null,
    productId: null,
    productName: null,
    assigneeId: null,
    assigneeName: null,
    lastMessageAt: FIXED_TIME,
    lastMessagePreview: 'Do you ship to Sylhet?',
    lastMessageSenderId: CHAT_CUSTOMER_ID,
    messageCount: 1,
    unreadCount: 0,
    latestSeq: 1,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...overrides,
  };
}

function detail(overrides: Partial<ChatConversationSummary> = {}): ChatConversationDetail {
  const conversation = summary(overrides);
  return {
    conversation: {
      id: conversation.id,
      kind: conversation.kind,
      status: conversation.status,
      priority: conversation.priority,
      subject: conversation.subject,
      customerId: conversation.customerId,
      orderId: conversation.orderId,
      productId: conversation.productId,
      assigneeId: conversation.assigneeId,
      lastMessageAt: conversation.lastMessageAt,
      lastMessagePreview: conversation.lastMessagePreview,
      lastMessageSenderId: conversation.lastMessageSenderId,
      messageCount: conversation.messageCount,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      resolvedAt: null,
      closedAt: null,
    },
    viewer: {
      userId: CHAT_CUSTOMER_ID,
      role: 'customer',
      lastReadSeq: 0,
      isAssignee: false,
      canReply: true,
      canAssign: false,
      canUseInternalNotes: false,
    },
    customer: {
      id: CHAT_CUSTOMER_ID,
      name: 'Customer One',
      phone: '+8801712345678',
      email: 'one@example.com',
    },
    order: null,
    product: null,
    participants: [
      {
        userId: CHAT_CUSTOMER_ID,
        role: 'customer',
        name: 'Customer One',
        email: 'one@example.com',
        lastReadSeq: 0,
        lastDeliveredSeq: 0,
        joinedAt: FIXED_TIME,
      },
    ],
  };
}

function message(seq = 1, body = 'Do you ship to Sylhet?'): ChatMessage {
  return {
    id: CHAT_MESSAGE_ID,
    seq,
    senderId: CHAT_CUSTOMER_ID,
    senderRole: 'customer',
    senderName: 'Customer One',
    kind: 'text',
    body,
    replyToId: null,
    replyTo: null,
    metadata: {},
    editedAt: null,
    createdAt: FIXED_TIME,
    attachments: [],
  };
}

export class FakeChat implements ChatStore {
  readonly conversations = new Map<string, ChatConversationSummary>([
    [CHAT_CONVERSATION_ID, summary()],
  ]);
  readonly messageLog: ChatMessage[] = [message()];
  readonly noteLog: ChatInternalNote[] = [];
  readonly starts: StartChatConversationRequest[] = [];
  readonly sends: { conversationId: string; input: SendMessageInput }[] = [];
  readonly statuses: string[] = [];
  readonly assignments: { assigneeId: string | null }[] = [];
  readonly priorities: ChatPriority[] = [];
  /** Queue a refusal for the next call of a method, e.g. `refuse('send', 'conversation_closed')`. */
  readonly refusals = new Map<string, ChatRefusal>();
  allowAccess = true;
  duplicateNextSend = false;
  ticket: ChatSocketTicket | undefined = undefined;

  private maybeRefuse(method: string): void {
    const refusal = this.refusals.get(method);
    if (refusal === undefined) return;
    this.refusals.delete(method);
    throw new ChatRefusalError(refusal);
  }

  start(_token: string, _userId: string, input: StartChatConversationRequest) {
    this.maybeRefuse('start');
    this.starts.push(input);
    return Promise.resolve(detail({ subject: input.subject ?? 'Support request' }));
  }

  list(
    _token: string,
    _userId: string,
    query: ChatConversationListQuery,
  ): Promise<{ conversations: ChatConversationSummary[]; total: number }> {
    this.maybeRefuse('list');
    const all = [...this.conversations.values()];
    return Promise.resolve({ conversations: all.slice(0, query.pageSize), total: all.length });
  }

  /** The operator queue: the queries are recorded so a test can assert what was asked for. */
  readonly queueQueries: ChatQueueQuery[] = [];

  queue(
    _token: string,
    _userId: string,
    query: ChatQueueQuery,
  ): Promise<{ conversations: ChatConversationSummary[]; total: number }> {
    this.maybeRefuse('queue');
    this.queueQueries.push(query);
    const all = [...this.conversations.values()];
    return Promise.resolve({ conversations: all.slice(0, query.pageSize), total: all.length });
  }

  unreadCount(): Promise<number> {
    this.maybeRefuse('unreadCount');
    return Promise.resolve(2);
  }

  detail(_token: string, _userId: string, conversationId: string) {
    this.maybeRefuse('detail');
    const found = this.conversations.get(conversationId);
    if (found === undefined) throw new ChatRefusalError('conversation_not_found');
    return Promise.resolve(detail(found));
  }

  messages(
    _token: string,
    _userId: string,
    _conversationId: string,
    page: { before?: number | undefined; limit: number },
  ): Promise<ChatMessagePage> {
    this.maybeRefuse('messages');
    const rows = this.messageLog.slice(0, page.limit);
    return Promise.resolve({
      messages: rows,
      nextCursor: rows.length === page.limit ? (rows[0]?.seq ?? null) : null,
    });
  }

  send(
    _token: string,
    _userId: string,
    conversationId: string,
    input: SendMessageInput,
  ): Promise<SendChatMessageResponse> {
    this.maybeRefuse('send');
    this.sends.push({ conversationId, input });
    const stored = message(this.messageLog.length + 1, input.body);
    if (!this.duplicateNextSend) this.messageLog.push(stored);
    return Promise.resolve({ message: stored, duplicate: this.duplicateNextSend, unread: 0 });
  }

  markRead(): Promise<number> {
    this.maybeRefuse('markRead');
    return Promise.resolve(0);
  }

  markDelivered(): Promise<void> {
    this.maybeRefuse('markDelivered');
    return Promise.resolve();
  }

  setStatus(_token: string, _userId: string, _id: string, status: string) {
    this.maybeRefuse('setStatus');
    this.statuses.push(status);
    return Promise.resolve(detail({ status: status as ChatConversationSummary['status'] }));
  }

  assign(_token: string, _userId: string, _id: string, assigneeId: string | null) {
    this.maybeRefuse('assign');
    this.assignments.push({ assigneeId });
    return Promise.resolve(detail({ assigneeId }));
  }

  setPriority(_token: string, _userId: string, _id: string, priority: ChatPriority) {
    this.maybeRefuse('setPriority');
    this.priorities.push(priority);
    return Promise.resolve(detail({ priority }));
  }

  addNote(_token: string, _userId: string, _id: string, body: string) {
    this.maybeRefuse('addNote');
    const note: ChatInternalNote = {
      id: CHAT_MESSAGE_ID,
      seq: this.noteLog.length + 1,
      authorId: CHAT_STAFF_ID,
      authorName: 'Staff One',
      body,
      createdAt: FIXED_TIME,
    };
    this.noteLog.push(note);
    return Promise.resolve(note);
  }

  notes(): Promise<ChatNotesResponse> {
    this.maybeRefuse('notes');
    return Promise.resolve({ notes: this.noteLog, nextCursor: null });
  }

  report(_token: string, _userId: string, messageId: string): Promise<ChatReportResponse> {
    this.maybeRefuse('report');
    return Promise.resolve({ id: CHAT_CONVERSATION_ID, messageId, status: 'open' });
  }

  canAccess(): Promise<boolean> {
    this.maybeRefuse('canAccess');
    return Promise.resolve(this.allowAccess);
  }
}
