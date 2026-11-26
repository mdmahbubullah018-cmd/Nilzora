import { z } from 'zod';
import { chatAttachmentSchema } from './chat-admin';
import {
  CHAT_MESSAGE_KINDS,
  CHAT_PARTICIPANT_ROLES,
  chatMessageKindSchema,
  chatParticipantRoleSchema,
  type ChatMessageKind,
  type ChatParticipantRole,
} from './chat-enums';
import { chatReplySummarySchema, type ChatReplySummary } from './chat-reply';

export {
  CHAT_MESSAGE_KINDS,
  CHAT_PARTICIPANT_ROLES,
  chatMessageKindSchema,
  chatParticipantRoleSchema,
};
export type { ChatMessageKind, ChatParticipantRole };
export { chatReplySummarySchema };
export type { ChatReplySummary };

/*
 * Unified communication contract
 * ------------------------------
 * One conversation model serves customer support, order support, staff threads and
 * moderation. The kind decides who may see a thread; the API never trusts a kind, an
 * owner, a priority or a status sent by a client without checking it against the
 * signed-in account, and the database checks it again for every call.
 *
 * Realtime events are described at the bottom of this file. They are events, not
 * storage: a message reaches a client's socket only after it is committed, and a
 * reconnecting client re-reads anything it missed with `GET .../messages`.
 */

export const CHAT_CONVERSATION_KINDS = [
  'customer_support',
  'order_support',
  'internal_direct',
  'internal_group',
  'moderation',
] as const;
export type ChatConversationKind = (typeof CHAT_CONVERSATION_KINDS)[number];
export const chatConversationKindSchema = z.enum(CHAT_CONVERSATION_KINDS);

export const CHAT_CONVERSATION_STATUSES = ['open', 'pending', 'resolved', 'closed'] as const;
export type ChatConversationStatus = (typeof CHAT_CONVERSATION_STATUSES)[number];
export const chatConversationStatusSchema = z.enum(CHAT_CONVERSATION_STATUSES);

export const CHAT_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type ChatPriority = (typeof CHAT_PRIORITIES)[number];
export const chatPrioritySchema = z.enum(CHAT_PRIORITIES);

export const CHAT_REPORT_REASONS = ['spam', 'abuse', 'personal_information', 'other'] as const;
export type ChatReportReason = (typeof CHAT_REPORT_REASONS)[number];
export const chatReportReasonSchema = z.enum(CHAT_REPORT_REASONS);

/** Which slice of the support queue a list call asks for. */
export const CHAT_QUEUE_SCOPES = ['all', 'mine', 'unassigned'] as const;
export type ChatQueueScope = (typeof CHAT_QUEUE_SCOPES)[number];
export const chatQueueScopeSchema = z.enum(CHAT_QUEUE_SCOPES);

/** Longest message or internal note. Matches the database constraint. */
export const CHAT_MESSAGE_MAX_LENGTH = 4000;
/** A conversation subject is a short label for the list, never the conversation itself. */
export const CHAT_SUBJECT_MAX_LENGTH = 160;
export const CHAT_NOTE_MAX_LENGTH = 300;

/** One page of messages; capped well below anything a phone cannot render smoothly. */
export const CHAT_MESSAGE_PAGE_SIZE = 30;
export const CHAT_MESSAGE_PAGE_MAX = 100;
export const CHAT_CONVERSATION_PAGE_SIZE = 20;
export const CHAT_CONVERSATION_PAGE_MAX = 100;

export const chatSubjectSchema = z.string().trim().min(1).max(CHAT_SUBJECT_MAX_LENGTH);
export const chatBodySchema = z.string().trim().min(1).max(CHAT_MESSAGE_MAX_LENGTH);

/**
 * The reactions the product offers, in the order a picker shows them.
 *
 * The database accepts any short text as an emoji and keeps at most one reaction per account per
 * message, so this list is the whole of the product decision: the three clients share it rather
 * than each inventing its own set. `label` is the accessible name, because an emoji is not a name
 * a screen reader should be left to guess.
 */
export const CHAT_REACTIONS = [
  { emoji: '❤️', label: 'Love' },
  { emoji: '😂', label: 'Laugh' },
  { emoji: '😮', label: 'Wow' },
  { emoji: '😢', label: 'Sad' },
  { emoji: '😡', label: 'Angry' },
  { emoji: '👍', label: 'Like' },
  { emoji: '👎', label: 'Dislike' },
  { emoji: '🙏', label: 'Thanks' },
] as const;
export type ChatReaction = (typeof CHAT_REACTIONS)[number];

/** The label a stored reaction is read out with, falling back to the emoji itself. */
export function chatReactionLabel(emoji: string): string {
  return CHAT_REACTIONS.find((reaction) => reaction.emoji === emoji)?.label ?? emoji;
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export const chatConversationSummarySchema = z.object({
  id: z.uuid(),
  kind: chatConversationKindSchema,
  status: chatConversationStatusSchema,
  priority: chatPrioritySchema,
  subject: z.string(),
  customerId: z.uuid().nullable(),
  customerName: z.string().nullable(),
  customerEmail: z.string().nullable(),
  orderId: z.uuid().nullable(),
  orderNumber: z.string().nullable(),
  productId: z.uuid().nullable(),
  productName: z.string().nullable(),
  assigneeId: z.uuid().nullable(),
  assigneeName: z.string().nullable(),
  lastMessageAt: z.string(),
  lastMessagePreview: z.string().nullable(),
  lastMessageSenderId: z.uuid().nullable(),
  messageCount: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
  latestSeq: z.number().int().nonnegative().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChatConversationSummary = z.infer<typeof chatConversationSummarySchema>;

export const chatParticipantSchema = z.object({
  userId: z.uuid(),
  role: chatParticipantRoleSchema,
  name: z.string().nullable(),
  email: z.string().nullable(),
  /** Every message at or below this sequence is read for this participant. */
  lastReadSeq: z.number().int().nonnegative(),
  lastDeliveredSeq: z.number().int().nonnegative(),
  joinedAt: z.string(),
});
export type ChatParticipant = z.infer<typeof chatParticipantSchema>;

/** What the caller may do in a thread, as the database decided it for this request. */
export const chatViewerSchema = z.object({
  userId: z.uuid(),
  role: chatParticipantRoleSchema,
  lastReadSeq: z.number().int().nonnegative(),
  isAssignee: z.boolean(),
  canReply: z.boolean(),
  canAssign: z.boolean(),
  canUseInternalNotes: z.boolean(),
});
export type ChatViewer = z.infer<typeof chatViewerSchema>;

export const chatCustomerContextSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
});
export type ChatCustomerContext = z.infer<typeof chatCustomerContextSchema>;

/**
 * One line of an order a support thread is about, as the context panel shows it. At most four
 * are carried; the order's own `itemCount` still counts the whole order.
 */
export const chatOrderItemSchema = z.object({
  productId: z.uuid().nullable(),
  name: z.string(),
  variantLabel: z.string().nullable(),
  quantity: z.number().int().min(1),
  /** The picture stored with the line, already resolved to its two public URLs. */
  image: z.object({ url: z.url(), thumbUrl: z.url(), alt: z.string().nullable() }).nullable(),
});
export type ChatOrderItem = z.infer<typeof chatOrderItemSchema>;

/** The order facts a support agent needs, and nothing about payment instruments. */
export const chatOrderContextSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  status: z.string(),
  paymentStatus: z.string(),
  totalMinor: z.number().int().nonnegative(),
  itemCount: z.number().int().positive(),
  placedAt: z.string(),
  /** What the order held, so a multi-product order stays identifiable. */
  items: z.array(chatOrderItemSchema).default([]),
});
export type ChatOrderContext = z.infer<typeof chatOrderContextSchema>;

export const chatProductContextSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  priceMinor: z.number().int().positive(),
  status: z.string(),
  /** The picture of the line bought (or the product's own when nothing was bought yet). */
  image: z
    .object({ url: z.url(), thumbUrl: z.url(), alt: z.string().nullable() })
    .nullable()
    .default(null),
  /** The options bought, e.g. 'Size: M / Colour: Navy'; null for a simple product. */
  variantLabel: z.string().nullable().default(null),
});
export type ChatProductContext = z.infer<typeof chatProductContextSchema>;

export const chatConversationDetailSchema = z.object({
  conversation: z.object({
    id: z.uuid(),
    kind: chatConversationKindSchema,
    status: chatConversationStatusSchema,
    priority: chatPrioritySchema,
    subject: z.string(),
    customerId: z.uuid().nullable(),
    orderId: z.uuid().nullable(),
    productId: z.uuid().nullable(),
    assigneeId: z.uuid().nullable(),
    lastMessageAt: z.string(),
    lastMessagePreview: z.string().nullable(),
    lastMessageSenderId: z.uuid().nullable(),
    messageCount: z.number().int().nonnegative(),
    createdAt: z.string(),
    updatedAt: z.string(),
    resolvedAt: z.string().nullable(),
    closedAt: z.string().nullable(),
    // Phase 2 measures. Optional so a caller written against the Phase 1 shape still parses;
    // the database always sends them once the Phase 2 migration is applied.
    firstResponseAt: z.string().nullable().optional(),
    lastCustomerMessageAt: z.string().nullable().optional(),
    lastStaffMessageAt: z.string().nullable().optional(),
    csatRating: z.number().int().min(1).max(5).nullable().optional(),
    escalatedAt: z.string().nullable().optional(),
    automationPaused: z.boolean().optional(),
    department: z.string().nullable().optional(),
    tags: z.array(z.object({ id: z.uuid(), slug: z.string(), label: z.string() })).optional(),
    pinnedCount: z.number().int().nonnegative().optional(),
    attachmentCount: z.number().int().nonnegative().optional(),
  }),
  viewer: chatViewerSchema,
  customer: chatCustomerContextSchema.nullable(),
  order: chatOrderContextSchema.nullable(),
  product: chatProductContextSchema.nullable(),
  participants: z.array(chatParticipantSchema),
});
export type ChatConversationDetail = z.infer<typeof chatConversationDetailSchema>;

/**
 * The one line a reply shows above itself.
 *
 * A quote cannot be resolved from the loaded page alone — the message being answered may be far
 * older — so the API resolves it and sends this leaf. `deleted` is how a quote of a message that
 * was taken down stays honest instead of disappearing; `body` is null in that case, and in that
 * case only.
 *
 * The shape itself lives in `chat-reply.ts`, which both this file and `chat-admin.ts` import.
 */

export const chatMessageSchema = z.object({
  id: z.uuid(),
  /** Ordering key and pagination cursor. */
  seq: z.number().int().nonnegative(),
  senderId: z.uuid().nullable(),
  senderRole: chatParticipantRoleSchema,
  senderName: z.string().nullable(),
  kind: chatMessageKindSchema,
  body: z.string().nullable(),
  replyToId: z.uuid().nullable(),
  /** The message this one quotes, resolved by the API; null or absent when it is not a reply. */
  replyTo: chatReplySummarySchema.nullable().optional(),
  metadata: z.record(z.string(), z.unknown()),
  editedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  /**
   * The files this message carries, each with the public URLs the API resolved. Older messages
   * carry none, so the list defaults to empty rather than being absent.
   */
  attachments: z.array(chatAttachmentSchema).default([]),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatInternalNoteSchema = z.object({
  id: z.uuid(),
  seq: z.number().int().nonnegative(),
  authorId: z.uuid().nullable(),
  authorName: z.string().nullable(),
  body: z.string(),
  createdAt: z.string(),
});
export type ChatInternalNote = z.infer<typeof chatInternalNoteSchema>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** POST /chat/conversations — opens a thread, or continues the caller's live one. */
export const startChatConversationRequestSchema = z
  .strictObject({
    kind: chatConversationKindSchema,
    /** An order number the caller placed; the database refuses anyone else's order. */
    orderNumber: z.string().trim().min(3).max(40).optional(),
    /** A published product the question is about. */
    productId: z.uuid().optional(),
    subject: chatSubjectSchema.optional(),
    body: chatBodySchema.optional(),
    /** Staff-only kinds: who else is in the conversation. */
    participants: z.array(z.uuid()).max(50).optional(),
  })
  .refine((value) => value.body !== undefined || value.orderNumber !== undefined, {
    error: 'Write a message or name an order to start a conversation',
    path: ['body'],
  });
export type StartChatConversationRequest = z.input<typeof startChatConversationRequestSchema>;

export const chatConversationListQuerySchema = z.object({
  scope: chatQueueScopeSchema.default('all'),
  status: chatConversationStatusSchema.optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(CHAT_CONVERSATION_PAGE_MAX)
    .default(CHAT_CONVERSATION_PAGE_SIZE),
});
export type ChatConversationListQuery = z.infer<typeof chatConversationListQuerySchema>;

/**
 * How the operator queue is ordered. `queue` puts the threads that need a person first (open,
 * pending, or resolved with a customer reply after it), then by priority, then most recent.
 */
/** How a conversation can be ordered in the operator queue. */
export const CHAT_QUEUE_SORTS = ['queue', 'recent', 'oldest'] as const;
export type ChatQueueSort = (typeof CHAT_QUEUE_SORTS)[number];
export const chatQueueSortSchema = z.enum(CHAT_QUEUE_SORTS);

/**
 * GET /chat/admin/queue — the operator inbox. Lists only the customer and moderation threads
 * the caller may open, never their internal team threads; answered with the list shape above.
 */
export const chatQueueQuerySchema = z.object({
  scope: chatQueueScopeSchema.default('all'),
  status: chatConversationStatusSchema.optional(),
  priority: chatPrioritySchema.optional(),
  search: z.string().trim().max(120).optional(),
  sort: chatQueueSortSchema.default('queue'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(CHAT_CONVERSATION_PAGE_MAX)
    .default(CHAT_CONVERSATION_PAGE_SIZE),
});
export type ChatQueueQuery = z.infer<typeof chatQueueQuerySchema>;

export const chatMessagePageQuerySchema = z.object({
  /** Cursor: load the page that ends just before this sequence. */
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(CHAT_MESSAGE_PAGE_MAX).default(CHAT_MESSAGE_PAGE_SIZE),
});
export type ChatMessagePageQuery = z.infer<typeof chatMessagePageQuerySchema>;

/**
 * POST /chat/conversations/:conversationId/messages
 *
 * `clientMessageId` is the sender's own identifier for this message. A retry with the
 * same value returns the message stored the first time instead of posting a duplicate,
 * so a flaky connection cannot double-send.
 */
export const sendChatMessageRequestSchema = z.strictObject({
  clientMessageId: z.uuid(),
  body: chatBodySchema,
  /**
   * The message being quoted, or null for none. Clients that model an absent reply as null
   * are accepted: the API treats both as "no quoted message", and the app stores nothing.
   */
  replyToId: z.uuid().nullable().optional(),
});
export type SendChatMessageRequest = z.input<typeof sendChatMessageRequestSchema>;

export const markChatReadRequestSchema = z.strictObject({
  /** Highest sequence the caller has seen. */
  seq: z.number().int().nonnegative(),
});
export type MarkChatReadRequest = z.input<typeof markChatReadRequestSchema>;

export const setChatStatusRequestSchema = z.strictObject({
  status: chatConversationStatusSchema,
});
export type SetChatStatusRequest = z.input<typeof setChatStatusRequestSchema>;

export const assignChatRequestSchema = z.strictObject({
  /** Null returns the thread to the unassigned queue. */
  assigneeId: z.uuid().nullable(),
  note: z.string().trim().max(CHAT_NOTE_MAX_LENGTH).optional(),
});
export type AssignChatRequest = z.input<typeof assignChatRequestSchema>;

export const setChatPriorityRequestSchema = z.strictObject({
  priority: chatPrioritySchema,
});
export type SetChatPriorityRequest = z.input<typeof setChatPriorityRequestSchema>;

export const addChatNoteRequestSchema = z.strictObject({ body: chatBodySchema });
export type AddChatNoteRequest = z.input<typeof addChatNoteRequestSchema>;

export const reportChatMessageRequestSchema = z.strictObject({
  reason: chatReportReasonSchema,
  details: z.string().trim().max(500).optional(),
});
export type ReportChatMessageRequest = z.input<typeof reportChatMessageRequestSchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const chatConversationListResponseSchema = z.object({
  conversations: z.array(chatConversationSummarySchema),
  /** The caller's total unread messages, for the navigation badge. */
  unread: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});
export type ChatConversationListResponse = z.infer<typeof chatConversationListResponseSchema>;

export const chatConversationResponseSchema = chatConversationDetailSchema;
export type ChatConversationResponse = z.infer<typeof chatConversationResponseSchema>;

export const chatMessagePageSchema = z.object({
  /** Oldest first, so a screen can append without reversing. */
  messages: z.array(chatMessageSchema),
  /** Pass as `before` to load the previous page; null when the thread starts here. */
  nextCursor: z.number().int().positive().nullable(),
});
export type ChatMessagePage = z.infer<typeof chatMessagePageSchema>;

export const sendChatMessageResponseSchema = z.object({
  message: chatMessageSchema,
  /** True when this was a retry of a message already stored. */
  duplicate: z.boolean(),
  unread: z.number().int().nonnegative(),
});
export type SendChatMessageResponse = z.infer<typeof sendChatMessageResponseSchema>;

/**
 * GET /chat/admin/team — one teammate who can take a conversation or join a team thread, and the
 * conversations they hold now. Staff accounts only; a customer never appears here.
 */
export const chatTeamMemberSchema = z.object({
  userId: z.uuid(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  /** The account's role name, e.g. "staff" or "moderator". */
  role: z.string(),
  /** May be assigned customer conversations (admin workspace). */
  canSupport: z.boolean(),
  /** May work moderation threads (moderator workspace). */
  canModerate: z.boolean(),
  /** May be added to an internal team thread. */
  canUseInternal: z.boolean(),
  openCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  /** Resolved or closed in the last 30 days while assigned to this teammate. */
  resolvedRecentCount: z.number().int().nonnegative(),
});
export type ChatTeamMember = z.infer<typeof chatTeamMemberSchema>;

export const chatTeamResponseSchema = z.object({ members: z.array(chatTeamMemberSchema) });
export type ChatTeamResponse = z.infer<typeof chatTeamResponseSchema>;

export const chatUnreadCountSchema = z.object({ unread: z.number().int().nonnegative() });
export type ChatUnreadCount = z.infer<typeof chatUnreadCountSchema>;

export const chatNotesResponseSchema = z.object({
  notes: z.array(chatInternalNoteSchema),
  nextCursor: z.number().int().positive().nullable(),
});
export type ChatNotesResponse = z.infer<typeof chatNotesResponseSchema>;

export const chatReportResponseSchema = z.object({
  id: z.uuid(),
  messageId: z.uuid(),
  status: z.string(),
});
export type ChatReportResponse = z.infer<typeof chatReportResponseSchema>;

/**
 * POST /chat/socket-ticket
 *
 * The web apps keep the API tokens in HttpOnly cookies, so the browser cannot read them
 * to open a socket. This short-lived, single-account ticket is what the browser may
 * carry instead: it authorizes a socket handshake and nothing else — it is not accepted
 * by any REST route.
 */
export const chatSocketTicketSchema = z.object({
  ticket: z.string().min(16),
  /** Unix time (seconds) after which the ticket is refused. */
  expiresAt: z.number().int().positive(),
});
export type ChatSocketTicket = z.infer<typeof chatSocketTicketSchema>;

// ---------------------------------------------------------------------------
// Realtime event contract
// ---------------------------------------------------------------------------

/** Client to server, validated with the schemas below. */
export const CHAT_CLIENT_EVENTS = {
  join: 'conversation:join',
  leave: 'conversation:leave',
  send: 'message:send',
  read: 'message:read',
  typingStart: 'typing:start',
  typingStop: 'typing:stop',
  heartbeat: 'presence:heartbeat',
  /** Staff only: subscribe to "the queue changed" signals (no conversation content). */
  joinQueue: 'queue:join',
} as const;

/** Server to client. A client must treat every one of them as advisory: re-read on join. */
export const CHAT_SERVER_EVENTS = {
  joined: 'conversation:joined',
  newMessage: 'message:new',
  ack: 'message:ack',
  failed: 'message:failed',
  read: 'message:read',
  updated: 'conversation:updated',
  assigned: 'conversation:assigned',
  typing: 'typing:update',
  presence: 'presence:update',
  /** Staff queue room: refused with `failed` unless the account may work a queue. */
  queueJoined: 'queue:joined',
  /** Payload-free hint that the staff queue changed: re-read it over REST. */
  queueChanged: 'queue:changed',
} as const;

export const chatJoinPayloadSchema = z.strictObject({ conversationId: z.uuid() });
export type ChatJoinPayload = z.input<typeof chatJoinPayloadSchema>;

export const chatLeavePayloadSchema = z.strictObject({ conversationId: z.uuid() });
export type ChatLeavePayload = z.input<typeof chatLeavePayloadSchema>;

/** Same shape as the REST send, so the two paths cannot drift apart. */
export const chatSendPayloadSchema = sendChatMessageRequestSchema.extend({
  conversationId: z.uuid(),
});
export type ChatSendPayload = z.input<typeof chatSendPayloadSchema>;

export const chatReadPayloadSchema = z.strictObject({
  conversationId: z.uuid(),
  seq: z.number().int().nonnegative(),
});
export type ChatReadPayload = z.input<typeof chatReadPayloadSchema>;

export const chatTypingPayloadSchema = z.strictObject({ conversationId: z.uuid() });
export type ChatTypingPayload = z.input<typeof chatTypingPayloadSchema>;

/** Acknowledgement for `message:send`; only ever sent after the message is committed. */
export interface ChatSendAck {
  ok: boolean;
  /** Present when ok: the stored message. */
  message?: ChatMessage;
  duplicate?: boolean;
  unread?: number;
  /** Present when not ok: a stable code the client can show and react to. */
  code?: string;
  error?: string;
}

export interface ChatTypingUpdate {
  conversationId: string;
  userId: string;
  name: string | null;
  typing: boolean;
}

export interface ChatPresenceUpdate {
  conversationId: string;
  userId: string;
  online: boolean;
}

export interface ChatConversationUpdate {
  conversationId: string;
  /** What changed, so a client can refetch just that. */
  change: 'message' | 'assigned' | 'status' | 'priority' | 'read' | 'pin' | 'reaction' | 'rating';
}
