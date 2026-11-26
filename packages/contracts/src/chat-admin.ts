import { z } from 'zod';
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_PER_MESSAGE,
  CHAT_AUDIO_MAX_DURATION_MS,
  chatAttachmentTypeSchema,
} from './chat-media';
import { chatReplySummarySchema } from './chat-reply';

export type { ChatAttachmentType, ChatMediaKind } from './chat-media';
export {
  CHAT_ATTACHMENT_TYPES,
  CHAT_AUDIO_MAX_DURATION_MS,
  CHAT_AUDIO_TYPES,
  CHAT_DOCUMENT_TYPES,
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_TYPES,
  CHAT_MEDIA_KINDS,
  chatMediaKindOf,
  chatMediaMaxBytes,
  chatMediaMaxLabel,
  chatMediaRejection,
  sanitizeChatFileName,
} from './chat-media';

/*
 * Unified communication, Phase 2 contract
 * ---------------------------------------
 * Templates, automation, saved replies, tags, attachments, satisfaction, internal team
 * chat, the moderator review queue and the analytics report.
 *
 * Two rules shape everything here. Automation is data: a rule names a trigger, a small
 * condition document and a list of actions from a closed vocabulary, and the database
 * validator refuses anything outside it. And an attachment is a promise, not bytes: the
 * client asks for an upload slot inside the conversation's own key prefix, and the file
 * only appears in the thread once the message that carries it is stored.
 */

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const CHAT_TEMPLATE_CATEGORIES = [
  'greeting',
  'order_update',
  'shipping',
  'returns',
  'payment',
  'closing',
  'internal',
  'other',
] as const;
export type ChatTemplateCategory = (typeof CHAT_TEMPLATE_CATEGORIES)[number];
export const chatTemplateCategorySchema = z.enum(CHAT_TEMPLATE_CATEGORIES);

export const CHAT_TEMPLATE_LOCALES = ['en', 'bn'] as const;
export type ChatTemplateLocale = (typeof CHAT_TEMPLATE_LOCALES)[number];
export const chatTemplateLocaleSchema = z.enum(CHAT_TEMPLATE_LOCALES);

/**
 * The only variables a template may name. The database enforces the same list, so a
 * template that mentions anything else is refused when it is saved rather than rendered as
 * a stray brace to a customer.
 */
export const CHAT_TEMPLATE_VARIABLES = [
  'customer_name',
  'agent_name',
  'store_name',
  'order_number',
  'order_status',
  'payment_status',
  'product_name',
  'return_status',
  'refund_status',
  'support_hours',
] as const;
export type ChatTemplateVariable = (typeof CHAT_TEMPLATE_VARIABLES)[number];

export const CHAT_TEMPLATE_NAME_MAX = 120;
export const CHAT_TEMPLATE_BODY_MAX = 2000;

export const chatTemplateSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  category: chatTemplateCategorySchema,
  locale: chatTemplateLocaleSchema,
  body: z.string(),
  description: z.string().nullable(),
  variables: z.array(z.string()),
  isActive: z.boolean(),
  usageCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChatTemplate = z.infer<typeof chatTemplateSchema>;

export const chatTemplatesResponseSchema = z.object({
  templates: z.array(chatTemplateSchema),
});
export type ChatTemplatesResponse = z.infer<typeof chatTemplatesResponseSchema>;

export const saveChatTemplateSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(CHAT_TEMPLATE_NAME_MAX),
  category: chatTemplateCategorySchema,
  locale: chatTemplateLocaleSchema,
  body: z.string().trim().min(1).max(CHAT_TEMPLATE_BODY_MAX),
  description: z.string().trim().max(300).optional(),
  isActive: z.boolean().optional(),
});
export type SaveChatTemplate = z.infer<typeof saveChatTemplateSchema>;

export const renderChatTemplateSchema = z.object({
  templateId: z.uuid(),
  conversationId: z.uuid(),
});
export type RenderChatTemplate = z.infer<typeof renderChatTemplateSchema>;

export const renderedChatTemplateSchema = z.object({
  templateId: z.uuid(),
  name: z.string(),
  locale: chatTemplateLocaleSchema,
  body: z.string(),
});
export type RenderedChatTemplate = z.infer<typeof renderedChatTemplateSchema>;

// ---------------------------------------------------------------------------
// Saved replies
// ---------------------------------------------------------------------------

export const CHAT_SAVED_REPLY_VISIBILITIES = ['personal', 'shared'] as const;
export type ChatSavedReplyVisibility = (typeof CHAT_SAVED_REPLY_VISIBILITIES)[number];
export const chatSavedReplyVisibilitySchema = z.enum(CHAT_SAVED_REPLY_VISIBILITIES);

export const chatSavedReplySchema = z.object({
  id: z.uuid(),
  visibility: chatSavedReplyVisibilitySchema,
  title: z.string(),
  shortcut: z.string().nullable(),
  body: z.string(),
  usageCount: z.number().int().nonnegative(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChatSavedReply = z.infer<typeof chatSavedReplySchema>;

export const chatSavedRepliesResponseSchema = z.object({
  replies: z.array(chatSavedReplySchema),
});
export type ChatSavedRepliesResponse = z.infer<typeof chatSavedRepliesResponseSchema>;

export const saveChatSavedReplySchema = z.object({
  id: z.uuid().optional(),
  visibility: chatSavedReplyVisibilitySchema,
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
  shortcut: z
    .string()
    .trim()
    .regex(/^\/[a-z0-9_-]{1,24}$/, 'Shortcuts look like /refund')
    .optional(),
  isActive: z.boolean().optional(),
});
export type SaveChatSavedReply = z.infer<typeof saveChatSavedReplySchema>;

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export const chatTagSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  conversationCount: z.number().int().nonnegative(),
});
export type ChatTag = z.infer<typeof chatTagSchema>;

export const chatTagsResponseSchema = z.object({ tags: z.array(chatTagSchema) });
export type ChatTagsResponse = z.infer<typeof chatTagsResponseSchema>;

export const saveChatTagSchema = z.object({
  id: z.uuid().optional(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,32}$/, 'Use 2-32 lowercase letters, digits or dashes'),
  label: z.string().trim().min(1).max(40),
  description: z.string().trim().max(200).optional(),
  isActive: z.boolean().optional(),
});
export type SaveChatTag = z.infer<typeof saveChatTagSchema>;

export const setChatConversationTagsSchema = z.object({
  conversationId: z.uuid(),
  tagIds: z.array(z.uuid()).max(12),
});
export type SetChatConversationTags = z.infer<typeof setChatConversationTagsSchema>;

export const chatConversationTagSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  label: z.string(),
});
export type ChatConversationTag = z.infer<typeof chatConversationTagSchema>;

/*
 * Attachments
 * -----------
 * The kinds, types and limits live in ./chat-media, shared by the API, both web apps and the
 * app; this module only states the shapes of the records (and re-exports the rest for the
 * callers that imported them from here).
 */

export const uploadChatAttachmentQuerySchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  /**
   * How long a recording runs, measured by the recorder. Optional because a picture or a document
   * has no length, and because an older client does not send it.
   */
  durationMs: z.coerce.number().int().positive().max(CHAT_AUDIO_MAX_DURATION_MS).optional(),
});
export type UploadChatAttachmentQuery = z.infer<typeof uploadChatAttachmentQuerySchema>;

export const beginChatAttachmentSchema = z.object({
  conversationId: z.uuid(),
  objectKey: z.string().trim().min(1).max(300),
  fileName: z.string().trim().min(1).max(200),
  contentType: chatAttachmentTypeSchema,
  byteSize: z.number().int().positive().max(CHAT_ATTACHMENT_MAX_BYTES),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /** A recording's length. Refused for anything that is not audio, and capped at five minutes. */
  durationMs: z.number().int().positive().max(CHAT_AUDIO_MAX_DURATION_MS).optional(),
});
export type BeginChatAttachment = z.infer<typeof beginChatAttachmentSchema>;

/**
 * The record the API creates for an upload, before it is attached to a message. `durationMs` is
 * the voice message's length, measured by the recorder that captured it.
 */
export const chatAttachmentUploadSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  objectKey: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  byteSize: z.number().int().positive(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().int().positive().nullable().optional(),
  status: z.enum(['pending', 'attached', 'discarded']),
});
export type ChatAttachmentUpload = z.infer<typeof chatAttachmentUploadSchema>;

export const chatAttachmentSchema = z.object({
  id: z.uuid(),
  fileName: z.string(),
  contentType: z.string(),
  byteSize: z.number().int().positive(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  /** A voice message's length, so the player can show it before the audio has loaded. */
  durationMs: z.number().int().positive().nullable().default(null),
  /**
   * The public URLs of the stored variants, resolved by the API from the configured media base
   * and the upload's object key. A client never builds one of these itself; null when media
   * storage is off.
   */
  url: z.string().nullable().default(null),
  thumbnailUrl: z.string().nullable().default(null),
});
export type ChatAttachment = z.infer<typeof chatAttachmentSchema>;

export const postChatMessageSchema = z.object({
  conversationId: z.uuid(),
  clientMessageId: z.uuid(),
  body: z.string().trim().max(4000).optional(),
  attachmentIds: z.array(z.uuid()).max(CHAT_ATTACHMENT_MAX_PER_MESSAGE).optional(),
  /** The message this one answers, or null for none. Checked against the conversation. */
  replyToId: z.uuid().nullable().optional(),
});
export type PostChatMessage = z.infer<typeof postChatMessageSchema>;

export const postedChatMessageSchema = z.object({
  message: z.object({
    id: z.uuid(),
    seq: z.number().int().positive(),
    senderId: z.uuid().nullable(),
    senderRole: z.string(),
    senderName: z.string().nullable(),
    kind: z.string(),
    body: z.string().nullable(),
    replyToId: z.uuid().nullable(),
    /** The message this one quotes, already described; null when it is not a reply. */
    replyTo: chatReplySummarySchema.nullable().optional(),
    metadata: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
  }),
  duplicate: z.boolean(),
  unreadCount: z.number().int().nonnegative(),
  attachments: z.array(chatAttachmentSchema),
});
export type PostedChatMessage = z.infer<typeof postedChatMessageSchema>;

// ---------------------------------------------------------------------------
// Satisfaction
// ---------------------------------------------------------------------------

export const submitChatCsatSchema = z.object({
  conversationId: z.uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});
export type SubmitChatCsat = z.infer<typeof submitChatCsatSchema>;

export const chatCsatResponseSchema = z.object({
  conversationId: z.uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable(),
  createdAt: z.string(),
});
export type ChatCsatResponse = z.infer<typeof chatCsatResponseSchema>;

// ---------------------------------------------------------------------------
// Moderator review queue
// ---------------------------------------------------------------------------

export const CHAT_REPORT_STATUSES = ['open', 'reviewing', 'dismissed', 'actioned'] as const;
export type ChatReportStatus = (typeof CHAT_REPORT_STATUSES)[number];
export const chatReportStatusSchema = z.enum(CHAT_REPORT_STATUSES);

export const CHAT_REPORT_ACTIONS = [
  'message_deleted',
  'member_warned',
  'no_action',
  'escalated',
] as const;
export type ChatReportAction = (typeof CHAT_REPORT_ACTIONS)[number];
export const chatReportActionSchema = z.enum(CHAT_REPORT_ACTIONS);

export const chatReportQueueItemSchema = z.object({
  id: z.uuid(),
  status: chatReportStatusSchema,
  reason: z.string(),
  details: z.string().nullable(),
  actionTaken: chatReportActionSchema.nullable(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  messageId: z.uuid(),
  messageBody: z.string().nullable(),
  messageSenderName: z.string().nullable(),
  messageCreatedAt: z.string(),
  conversationId: z.uuid(),
  conversationSubject: z.string(),
  conversationKind: z.string(),
  reporterId: z.uuid().nullable(),
  reporterName: z.string().nullable(),
});
export type ChatReportQueueItem = z.infer<typeof chatReportQueueItemSchema>;

export const chatReportQueueResponseSchema = z.object({
  reports: z.array(chatReportQueueItemSchema),
  totalCount: z.number().int().nonnegative(),
});
export type ChatReportQueueResponse = z.infer<typeof chatReportQueueResponseSchema>;

export const decideChatReportSchema = z.object({
  reportId: z.uuid(),
  status: z.enum(['reviewing', 'dismissed', 'actioned']),
  actionTaken: chatReportActionSchema.optional(),
  note: z.string().trim().max(300).optional(),
});
export type DecideChatReport = z.infer<typeof decideChatReportSchema>;

/** What `decide_chat_report` answers: the decision, not the whole report. */
export const chatReportDecisionSchema = z.object({
  id: z.uuid(),
  status: z.string(),
  actionTaken: chatReportActionSchema.nullable(),
  resolvedAt: z.string().nullable(),
});
export type ChatReportDecideResponse = z.infer<typeof chatReportDecisionSchema>;

// ---------------------------------------------------------------------------
// Pins and reactions
// ---------------------------------------------------------------------------

export const chatPinnedMessageSchema = z.object({
  id: z.uuid(),
  body: z.string().nullable(),
  senderName: z.string().nullable(),
  pinnedAt: z.string(),
  pinnedByName: z.string().nullable(),
  /**
   * A safe summary of the first file the pinned message carries, so a pinned picture or
   * recording is not an empty line. There is no object key and no URL here: the bytes are read
   * through the authorized media route, exactly as in the thread.
   */
  attachment: z
    .object({
      id: z.uuid(),
      fileName: z.string(),
      /** The stored MIME type; the strip derives "picture", "voice" or "file" from it. */
      contentType: z.string(),
      durationMs: z.number().int().positive().nullable(),
    })
    .nullable()
    .default(null),
});
export type ChatPinnedMessage = z.infer<typeof chatPinnedMessageSchema>;

export const chatPinnedMessagesResponseSchema = z.object({
  messages: z.array(chatPinnedMessageSchema),
});
export type ChatPinnedMessagesResponse = z.infer<typeof chatPinnedMessagesResponseSchema>;

// ---------------------------------------------------------------------------
// Per-message feedback
// ---------------------------------------------------------------------------

/** Which way one support reply landed. Narrower than conversation-level CSAT, and separate. */
export const chatFeedbackVerdictSchema = z.enum(['helpful', 'not_helpful']);
export type ChatFeedbackVerdict = z.infer<typeof chatFeedbackVerdictSchema>;

export const chatMessageFeedbackSchema = z.object({
  id: z.uuid(),
  messageId: z.uuid(),
  verdict: chatFeedbackVerdictSchema,
  comment: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChatMessageFeedback = z.infer<typeof chatMessageFeedbackSchema>;

export const submitChatMessageFeedbackSchema = z.strictObject({
  verdict: chatFeedbackVerdictSchema,
  /** Optional short note; the database trims it and refuses more than 500 characters. */
  comment: z.string().trim().max(500).optional(),
});
export type SubmitChatMessageFeedback = z.infer<typeof submitChatMessageFeedbackSchema>;

/** One thread's feedback, as support staff read it. */
export const chatMessageFeedbackEntrySchema = z.object({
  id: z.uuid(),
  messageId: z.uuid(),
  customerName: z.string().nullable(),
  verdict: chatFeedbackVerdictSchema,
  comment: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChatMessageFeedbackEntry = z.infer<typeof chatMessageFeedbackEntrySchema>;

export const chatMessageFeedbackResponseSchema = z.object({
  feedback: z.array(chatMessageFeedbackEntrySchema),
});
export type ChatMessageFeedbackResponse = z.infer<typeof chatMessageFeedbackResponseSchema>;

/**
 * GET /chat/conversations/:conversationId/my-feedback: the signed-in customer's own verdicts on
 * that thread's replies (never anyone else's, never their notes), so the "Was this helpful?"
 * prompt can stay hidden for a reply they already rated, across reloads and devices.
 */
export const chatMyFeedbackResponseSchema = z.object({
  feedback: z.array(z.object({ messageId: z.uuid(), verdict: chatFeedbackVerdictSchema })),
});
export type ChatMyFeedbackResponse = z.infer<typeof chatMyFeedbackResponseSchema>;

export const chatReactionTallySchema = z.object({
  emoji: z.string(),
  count: z.number().int().nonnegative(),
});
export type ChatReactionTally = z.infer<typeof chatReactionTallySchema>;

export const chatReactionResponseSchema = z.object({
  messageId: z.uuid(),
  emoji: z.string(),
  added: z.boolean(),
  summary: z.array(chatReactionTallySchema),
});
export type ChatReactionResponse = z.infer<typeof chatReactionResponseSchema>;

export const chatReactionSummaryItemSchema = z.object({
  messageId: z.uuid(),
  emoji: z.string(),
  count: z.number().int().nonnegative(),
  mine: z.boolean(),
});
export type ChatReactionSummaryItem = z.infer<typeof chatReactionSummaryItemSchema>;

export const chatReactionSummaryResponseSchema = z.object({
  reactions: z.array(chatReactionSummaryItemSchema),
});
export type ChatReactionSummaryResponse = z.infer<typeof chatReactionSummaryResponseSchema>;

// ---------------------------------------------------------------------------
// Automation
// ---------------------------------------------------------------------------

export const CHAT_AUTOMATION_TRIGGERS = [
  'conversation_created',
  'message_received',
  'conversation_resolved',
  'conversation_reopened',
  'priority_changed',
  'assignee_changed',
  'order_status_changed',
  'return_status_changed',
  'refund_status_changed',
  'csat_received',
] as const;
export type ChatAutomationTrigger = (typeof CHAT_AUTOMATION_TRIGGERS)[number];
export const chatAutomationTriggerSchema = z.enum(CHAT_AUTOMATION_TRIGGERS);

export const CHAT_AUTOMATION_ACTION_TYPES = [
  'reply_template',
  'system_message',
  'set_status',
  'set_priority',
  'set_tags',
  'assign_to',
  'escalate',
  'notify_staff',
  'pause_automation',
  'schedule',
] as const;
export type ChatAutomationActionType = (typeof CHAT_AUTOMATION_ACTION_TYPES)[number];
export const chatAutomationActionTypeSchema = z.enum(CHAT_AUTOMATION_ACTION_TYPES);

export const CHAT_AUTOMATION_CONDITION_KEYS = [
  'kinds',
  'statuses',
  'priorities',
  'keywords',
  'orderStatuses',
  'minMessages',
  'maxMessages',
] as const;

export const chatAutomationConditionSchema = z.object({
  kinds: z.array(z.string()).optional(),
  statuses: z.array(z.string()).optional(),
  priorities: z.array(z.string()).optional(),
  keywords: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  orderStatuses: z.array(z.string()).optional(),
  minMessages: z.number().int().nonnegative().optional(),
  maxMessages: z.number().int().nonnegative().optional(),
});
export type ChatAutomationCondition = z.infer<typeof chatAutomationConditionSchema>;

/**
 * One action. Every field except `type` is optional and only meaningful for some types,
 * which is why the union is modelled as a flat object plus a discriminator: the database
 * validates the combination, and this schema validates the shape a client may send.
 *
 * A `schedule` action may nest other actions one level deep — a scheduled action may not
 * itself schedule, which keeps the queue bounded.
 */
const chatAutomationBaseActionSchema = z.object({
  type: chatAutomationActionTypeSchema,
  templateId: z.uuid().optional(),
  templateName: z.string().trim().min(1).max(120).optional(),
  locale: chatTemplateLocaleSchema.optional(),
  body: z.string().trim().max(1000).optional(),
  value: z.union([z.string(), z.array(z.string())]).optional(),
  userId: z.uuid().optional(),
  permission: z.string().trim().max(80).optional(),
  title: z.string().trim().max(120).optional(),
  delaySeconds: z.number().int().nonnegative().max(2592000).optional(),
});

export const chatAutomationActionSchema = chatAutomationBaseActionSchema.extend({
  actions: z.array(chatAutomationBaseActionSchema).max(10).optional(),
});
export type ChatAutomationAction = z.infer<typeof chatAutomationActionSchema>;

export const chatAutomationRuleSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  trigger: chatAutomationTriggerSchema,
  conditions: chatAutomationConditionSchema,
  actions: z.array(chatAutomationActionSchema),
  position: z.number().int(),
  stopProcessing: z.boolean(),
  cooldownSeconds: z.number().int().nonnegative(),
  isActive: z.boolean(),
  runCount: z.number().int().nonnegative(),
  lastRunAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChatAutomationRule = z.infer<typeof chatAutomationRuleSchema>;

export const chatAutomationRulesResponseSchema = z.object({
  rules: z.array(chatAutomationRuleSchema),
});
export type ChatAutomationRulesResponse = z.infer<typeof chatAutomationRulesResponseSchema>;

export const saveChatAutomationRuleSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300).optional(),
  trigger: chatAutomationTriggerSchema,
  conditions: chatAutomationConditionSchema,
  actions: z.array(chatAutomationActionSchema).min(1).max(10),
  position: z.number().int().min(0).max(100000).optional(),
  stopProcessing: z.boolean().optional(),
  cooldownSeconds: z.number().int().min(0).max(2592000).optional(),
  isActive: z.boolean().optional(),
});
export type SaveChatAutomationRule = z.infer<typeof saveChatAutomationRuleSchema>;

export const CHAT_AUTOMATION_RUN_STATUSES = ['applied', 'skipped', 'failed'] as const;
export type ChatAutomationRunStatus = (typeof CHAT_AUTOMATION_RUN_STATUSES)[number];
export const chatAutomationRunStatusSchema = z.enum(CHAT_AUTOMATION_RUN_STATUSES);

export const chatAutomationRunSchema = z.object({
  id: z.uuid(),
  ruleId: z.uuid(),
  ruleName: z.string().nullable(),
  trigger: chatAutomationTriggerSchema,
  conversationId: z.uuid().nullable(),
  status: chatAutomationRunStatusSchema,
  actionsTaken: z.array(z.unknown()),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type ChatAutomationRun = z.infer<typeof chatAutomationRunSchema>;

export const chatAutomationRunsResponseSchema = z.object({
  runs: z.array(chatAutomationRunSchema),
  totalCount: z.number().int().nonnegative(),
});
export type ChatAutomationRunsResponse = z.infer<typeof chatAutomationRunsResponseSchema>;

export const previewChatAutomationRuleSchema = z.object({
  ruleId: z.uuid(),
  conversationId: z.uuid(),
});
export type PreviewChatAutomationRule = z.infer<typeof previewChatAutomationRuleSchema>;

export const chatAutomationPreviewSchema = z.object({
  ruleId: z.uuid(),
  conversationId: z.uuid(),
  wouldRun: z.boolean(),
  actions: z.array(chatAutomationActionSchema),
  reasons: z.array(z.string()),
});
export type ChatAutomationPreview = z.infer<typeof chatAutomationPreviewSchema>;

// ---------------------------------------------------------------------------
// Internal team chat
// ---------------------------------------------------------------------------

export const startInternalChatSchema = z.object({
  kind: z.enum(['internal_direct', 'internal_group']),
  subject: z.string().trim().max(160).optional(),
  body: z.string().trim().max(4000).optional(),
  participantIds: z.array(z.uuid()).min(1).max(50),
  department: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{1,40}$/)
    .optional(),
});
export type StartInternalChat = z.infer<typeof startInternalChatSchema>;

export const chatInternalChannelSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  status: z.string(),
  subject: z.string(),
  department: z.string().nullable(),
  employeeCount: z.number().int().nonnegative(),
  lastMessageAt: z.string(),
  lastMessagePreview: z.string().nullable(),
  unreadCount: z.number().int().nonnegative(),
});
export type ChatInternalChannel = z.infer<typeof chatInternalChannelSchema>;

export const chatInternalChannelsResponseSchema = z.object({
  channels: z.array(chatInternalChannelSchema),
  totalCount: z.number().int().nonnegative(),
});
export type ChatInternalChannelsResponse = z.infer<typeof chatInternalChannelsResponseSchema>;

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const chatSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
  limit: z.number().int().min(1).max(100).optional(),
});
export type ChatSearchQuery = z.infer<typeof chatSearchQuerySchema>;

export const chatSearchHitSchema = z.object({
  messageId: z.uuid(),
  conversationId: z.uuid(),
  conversationSubject: z.string(),
  body: z.string(),
  senderName: z.string().nullable(),
  createdAt: z.string(),
});
export type ChatSearchHit = z.infer<typeof chatSearchHitSchema>;

export const chatSearchResponseSchema = z.object({ hits: z.array(chatSearchHitSchema) });
export type ChatSearchResponse = z.infer<typeof chatSearchResponseSchema>;

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export const chatAnalyticsSchema = z.object({
  range: z.object({ from: z.string(), to: z.string() }),
  conversations: z.object({
    created: z.number().int().nonnegative(),
    byKind: z.record(z.string(), z.number()),
    byStatus: z.record(z.string(), z.number()),
    waitingNow: z.number().int().nonnegative(),
    unassignedNow: z.number().int().nonnegative(),
  }),
  firstResponse: z.object({
    answered: z.number().int().nonnegative(),
    averageSeconds: z.number(),
    p50Seconds: z.number(),
    p90Seconds: z.number(),
  }),
  resolution: z.object({
    resolved: z.number().int().nonnegative(),
    averageSeconds: z.number(),
  }),
  messages: z.object({
    total: z.number().int().nonnegative(),
    fromCustomers: z.number().int().nonnegative(),
    fromStaff: z.number().int().nonnegative(),
    automated: z.number().int().nonnegative(),
  }),
  satisfaction: z.object({
    responses: z.number().int().nonnegative(),
    average: z.number(),
    five: z.number().int().nonnegative(),
    four: z.number().int().nonnegative(),
    three: z.number().int().nonnegative(),
    two: z.number().int().nonnegative(),
    one: z.number().int().nonnegative(),
  }),
  automation: z.object({
    activeRules: z.number().int().nonnegative(),
    applied: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    pendingJobs: z.number().int().nonnegative(),
  }),
  moderation: z.object({
    openReports: z.number().int().nonnegative(),
    resolved: z.number().int().nonnegative(),
  }),
  agents: z.array(
    z.object({
      userId: z.uuid(),
      name: z.string().nullable(),
      conversations: z.number().int().nonnegative(),
      resolved: z.number().int().nonnegative(),
      averageFirstResponseSeconds: z.number(),
    }),
  ),
  daily: z.array(
    z.object({
      date: z.string(),
      created: z.number().int().nonnegative(),
      messages: z.number().int().nonnegative(),
    }),
  ),
});
export type ChatAnalytics = z.infer<typeof chatAnalyticsSchema>;

export const chatAnalyticsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type ChatAnalyticsQuery = z.infer<typeof chatAnalyticsQuerySchema>;
