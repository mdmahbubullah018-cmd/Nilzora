import {
  chatAttachmentUploadSchema,
  chatMessageFeedbackResponseSchema,
  chatMyFeedbackResponseSchema,
  chatMessageFeedbackSchema,
  chatAutomationPreviewSchema,
  chatAutomationRulesResponseSchema,
  chatAutomationRunsResponseSchema,
  chatConversationDetailSchema,
  chatCsatResponseSchema,
  chatInternalChannelsResponseSchema,
  chatPinnedMessagesResponseSchema,
  chatReactionResponseSchema,
  chatReactionSummaryResponseSchema,
  chatReportQueueResponseSchema,
  chatSavedRepliesResponseSchema,
  chatSearchResponseSchema,
  chatTagsResponseSchema,
  chatTemplateSchema,
  chatTemplatesResponseSchema,
  chatAnalyticsSchema,
  chatReplySummarySchema,
  chatTeamResponseSchema,
  postedChatMessageSchema,
  renderedChatTemplateSchema,
  type ChatAnalytics,
  type ChatAnalyticsQuery,
  type ChatAttachmentUpload,
  type ChatTeamResponse,
  type ChatAutomationPreview,
  type ChatAutomationRulesResponse,
  type ChatAutomationRunsResponse,
  type ChatConversationDetail,
  type ChatCsatResponse,
  type ChatInternalChannelsResponse,
  type ChatMessageFeedback,
  type ChatMessageFeedbackResponse,
  type ChatMyFeedbackResponse,
  type ChatPinnedMessagesResponse,
  type ChatReactionResponse,
  type ChatReplySummary,
  type ChatReactionSummaryResponse,
  type ChatReportQueueResponse,
  type ChatSavedRepliesResponse,
  type ChatSearchResponse,
  type ChatTagsResponse,
  type ChatTemplate,
  type ChatTemplatesResponse,
  type DecideChatReport,
  type PostedChatMessage,
  type PostChatMessage,
  type PreviewChatAutomationRule,
  type RenderedChatTemplate,
  type RenderChatTemplate,
  type SaveChatAutomationRule,
  type SaveChatSavedReply,
  type SaveChatTag,
  type SaveChatTemplate,
  type BeginChatAttachment,
  type SubmitChatMessageFeedback,
} from '@nilzora/contracts';
import type { Pool } from 'pg';
import { isoTimestamp } from '../commerce/errors';
import type { SupabaseClients } from '../../supabase/clients';
import type { Rpc } from '../db-rpc';
import type { StoredAttachment, AttachmentRow } from './attachment-media';
import { fromAttachmentRow, withAttachmentUrlsOf } from './attachment-media';
import { ChatRefusalError, toChatError } from './errors';
import { postgresChatRpc, supabaseChatRpc } from './store';

/*
 * The Phase 2 half of the unified communication store
 * ---------------------------------------------------
 * Templates, automation, saved replies, tags, attachments, satisfaction, internal team
 * chat, search, the moderator review queue and the analytics report.
 *
 * It is a separate store because it answers a different question. `ChatStore` is the
 * conversation the caller is having; this is the machinery that surrounds every
 * conversation, and almost every method needs a different permission. Splitting it keeps
 * each file readable and makes it obvious which permission a route depends on.
 *
 * As with Phase 1, no rule is decided here: every method calls one database function that
 * checks the caller itself, and a `jsonb` answer is validated against the contract before
 * it is served.
 */

/** One row of `chat_attachment_media(uuid)`, in PostgreSQL's column names. */
interface MediaRow {
  attachment_id: string;
  conversation_id: string;
  object_key: string;
  content_type: string;
  file_name: string;
  byte_size: number | string;
}

/** The private object behind one chat attachment, after the database authorized the caller. */
export interface ChatAttachmentMedia {
  attachmentId: string;
  conversationId: string;
  objectKey: string;
  contentType: string;
  fileName: string;
  byteSize: number;
}

export interface ChatAdminStore {
  /** The teammates who can take a conversation or join a team thread, with their workload. */
  team(accessToken: string, userId: string): Promise<ChatTeamResponse>;
  templates(
    accessToken: string,
    userId: string,
    includeArchived: boolean,
  ): Promise<ChatTemplatesResponse>;
  saveTemplate(accessToken: string, userId: string, input: SaveChatTemplate): Promise<ChatTemplate>;
  archiveTemplate(accessToken: string, userId: string, templateId: string): Promise<void>;
  renderTemplate(
    accessToken: string,
    userId: string,
    input: RenderChatTemplate,
  ): Promise<RenderedChatTemplate>;
  savedReplies(accessToken: string, userId: string): Promise<ChatSavedRepliesResponse>;
  saveSavedReply(accessToken: string, userId: string, input: SaveChatSavedReply): Promise<void>;
  deleteSavedReply(accessToken: string, userId: string, replyId: string): Promise<void>;
  tags(accessToken: string, userId: string): Promise<ChatTagsResponse>;
  saveTag(accessToken: string, userId: string, input: SaveChatTag): Promise<void>;
  setConversationTags(
    accessToken: string,
    userId: string,
    conversationId: string,
    tagIds: string[],
  ): Promise<void>;
  beginAttachment(
    accessToken: string,
    userId: string,
    input: BeginChatAttachment,
  ): Promise<ChatAttachmentUpload>;
  discardAttachment(accessToken: string, userId: string, attachmentId: string): Promise<void>;
  /** The private object behind one attachment, or a refusal when the caller may not read it. */
  attachmentMedia(
    accessToken: string,
    userId: string,
    attachmentId: string,
  ): Promise<ChatAttachmentMedia>;
  /** Records the customer's helpful / not-helpful verdict on one support reply. */
  submitMessageFeedback(
    accessToken: string,
    userId: string,
    messageId: string,
    input: SubmitChatMessageFeedback,
  ): Promise<ChatMessageFeedback>;
  /** The thread's feedback, for an account that may support it. */
  messageFeedback(
    accessToken: string,
    userId: string,
    conversationId: string,
  ): Promise<ChatMessageFeedbackResponse>;
  /** Only the caller's own verdicts in a thread they may read: no comments, nobody else's. */
  myMessageFeedback(
    accessToken: string,
    userId: string,
    conversationId: string,
  ): Promise<ChatMyFeedbackResponse>;
  postMessage(
    accessToken: string,
    userId: string,
    input: PostChatMessage,
  ): Promise<PostedChatMessage>;
  /**
   * The one-line description of a quoted message, so a reply the sender just wrote shows its
   * quote immediately instead of only after the thread is re-read.
   */
  replySummary(
    accessToken: string,
    userId: string,
    conversationId: string,
    messageId: string,
  ): Promise<ChatReplySummary | null>;
  submitCsat(
    accessToken: string,
    userId: string,
    conversationId: string,
    rating: number,
    comment?: string,
  ): Promise<ChatCsatResponse>;
  reportQueue(
    accessToken: string,
    userId: string,
    status: 'open' | 'reviewing' | 'dismissed' | 'actioned' | 'all',
    page: { limit: number; offset: number },
  ): Promise<ChatReportQueueResponse>;
  decideReport(
    accessToken: string,
    userId: string,
    input: DecideChatReport,
  ): Promise<ChatReportDecideResponse>;
  deleteMessage(accessToken: string, userId: string, messageId: string): Promise<void>;
  pinMessage(accessToken: string, userId: string, messageId: string): Promise<void>;
  unpinMessage(accessToken: string, userId: string, messageId: string): Promise<void>;
  pinnedMessages(
    accessToken: string,
    userId: string,
    conversationId: string,
  ): Promise<ChatPinnedMessagesResponse>;
  toggleReaction(
    accessToken: string,
    userId: string,
    messageId: string,
    emoji: string,
  ): Promise<ChatReactionResponse>;
  reactionSummary(
    accessToken: string,
    userId: string,
    conversationId: string,
  ): Promise<ChatReactionSummaryResponse>;
  startInternalChat(
    accessToken: string,
    userId: string,
    input: {
      kind: 'internal_direct' | 'internal_group';
      subject?: string | undefined;
      body?: string | undefined;
      participantIds: string[];
      department?: string | undefined;
    },
  ): Promise<ChatConversationDetail>;
  internalChannels(
    accessToken: string,
    userId: string,
    page: { limit: number; offset: number },
  ): Promise<ChatInternalChannelsResponse>;
  search(
    accessToken: string,
    userId: string,
    query: { q: string; limit: number },
  ): Promise<ChatSearchResponse>;
  analytics(accessToken: string, userId: string, query: ChatAnalyticsQuery): Promise<ChatAnalytics>;
  automationRules(accessToken: string, userId: string): Promise<ChatAutomationRulesResponse>;
  saveAutomationRule(
    accessToken: string,
    userId: string,
    input: SaveChatAutomationRule,
  ): Promise<void>;
  setAutomationRuleActive(
    accessToken: string,
    userId: string,
    ruleId: string,
    isActive: boolean,
  ): Promise<void>;
  deleteAutomationRule(accessToken: string, userId: string, ruleId: string): Promise<void>;
  automationRuns(
    accessToken: string,
    userId: string,
    page: { limit: number; offset: number },
  ): Promise<ChatAutomationRunsResponse>;
  previewAutomationRule(
    accessToken: string,
    userId: string,
    input: PreviewChatAutomationRule,
  ): Promise<ChatAutomationPreview>;
}

/** `decide_chat_report` answers a small record of the decision. */
export interface ChatReportDecideResponse {
  id: string;
  status: string;
  actionTaken: string | null;
  resolvedAt: string | null;
}

/** One row of `chat_team_members()`, in PostgreSQL's column names. */
interface TeamMemberRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  can_support: boolean;
  can_moderate: boolean;
  can_use_internal: boolean;
  open_count: number | string;
  pending_count: number | string;
  resolved_recent_count: number | string;
}

interface TemplateRow {
  id: string;
  name: string;
  category: string;
  locale: string;
  body: string;
  description: string | null;
  variables: string[] | null;
  is_active: boolean;
  usage_count: number | string;
  created_at: string | Date;
  updated_at: string | Date;
}

interface SavedReplyRow {
  id: string;
  visibility: string;
  title: string;
  shortcut: string | null;
  body: string;
  usage_count: number | string;
  is_active: boolean;
  created_at: string | Date;
  updated_at: string | Date;
}

interface TagRow {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  is_active: boolean;
  conversation_count: number | string;
}

interface ReportRow {
  id: string;
  status: string;
  reason: string;
  details: string | null;
  action_taken: string | null;
  created_at: string | Date;
  resolved_at: string | Date | null;
  message_id: string;
  message_body: string | null;
  message_sender_name: string | null;
  message_created_at: string | Date;
  conversation_id: string;
  conversation_subject: string;
  conversation_kind: string;
  reporter_id: string | null;
  reporter_name: string | null;
  total_count: number | string;
}

interface ChannelRow {
  id: string;
  kind: string;
  status: string;
  subject: string;
  department: string | null;
  employee_count: number | string;
  last_message_at: string | Date;
  last_message_preview: string | null;
  unread_count: number | string;
  total_count: number | string;
}

interface SearchRow {
  message_id: string;
  conversation_id: string;
  conversation_subject: string;
  body: string;
  sender_name: string | null;
  created_at: string | Date;
}

interface PinnedRow {
  id: string;
  body: string | null;
  sender_name: string | null;
  pinned_at: string | Date;
  pinned_by_name: string | null;
  /** Null when the pinned message carries no file. */
  attachment_id: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  attachment_duration_ms: number | null;
}

/** One row of `chat_message_feedback(uuid)`, in PostgreSQL's column names. */
interface FeedbackRow {
  id: string;
  message_id: string;
  customer_name: string | null;
  verdict: 'helpful' | 'not_helpful';
  comment: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface MyFeedbackRow {
  message_id: string;
  verdict: 'helpful' | 'not_helpful';
}

interface ReactionRow {
  message_id: string;
  emoji: string;
  reaction_count: number | string;
  mine: boolean;
}

/** One row of `chat_message_summaries(p_conversation_id, p_message_ids)`. */
interface ReplySummaryRow {
  id: string;
  seq: number | string;
  sender_id: string | null;
  sender_role: ChatReplySummary['senderRole'];
  sender_name: string | null;
  kind: ChatReplySummary['kind'];
  body: string | null;
  has_attachment: boolean;
  deleted: boolean;
}

interface RuleRow {
  id: string;
  name: string;
  description: string | null;
  trigger: string;
  conditions: unknown;
  actions: unknown;
  position: number | string;
  stop_processing: boolean;
  cooldown_seconds: number | string;
  is_active: boolean;
  run_count: number | string;
  last_run_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface RunRow {
  id: string;
  rule_id: string;
  rule_name: string | null;
  trigger: string;
  conversation_id: string | null;
  status: string;
  actions_taken: unknown;
  error: string | null;
  created_at: string | Date;
  total_count: number | string;
}

function count(value: number | string | null): number {
  return value === null ? 0 : Number(value);
}

function templateOf(row: TemplateRow): ChatTemplate {
  return {
    id: row.id,
    name: row.name,
    category: row.category as ChatTemplate['category'],
    locale: row.locale as ChatTemplate['locale'],
    body: row.body,
    description: row.description,
    variables: row.variables ?? [],
    isActive: row.is_active,
    usageCount: count(row.usage_count),
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

function chatAdminOver(
  rpcFor: (accessToken: string, userId: string) => Rpc,
  publicBaseUrl: string | undefined,
): ChatAdminStore {
  /**
   * The attachments that ended up on one message, read back from the conversation. Used only when
   * the post answer arrived without object keys, so the sender is never shown a file it cannot be
   * given a URL for. A failed read is not fatal: the answer simply stays as the function sent it.
   */
  async function attachedToMessage(
    accessToken: string,
    userId: string,
    conversationId: string,
    messageId: string,
  ): Promise<StoredAttachment[] | null> {
    try {
      const rows = await rpcFor(accessToken, userId)<AttachmentRow[]>(
        'chat_attachments',
        { p_conversation_id: conversationId },
        true,
      );
      const attached = (rows ?? [])
        .map(fromAttachmentRow)
        .filter((attachment) => attachment.messageId === messageId);
      return attached.length === 0 ? null : attached;
    } catch {
      return null;
    }
  }

  return {
    async team(accessToken, userId) {
      const rows = await rpcFor(accessToken, userId)<TeamMemberRow[]>(
        'chat_team_members',
        {},
        true,
      );
      return chatTeamResponseSchema.parse({
        members: (rows ?? []).map((row) => ({
          userId: row.user_id,
          name: row.full_name,
          email: row.email,
          role: row.role,
          canSupport: row.can_support,
          canModerate: row.can_moderate,
          canUseInternal: row.can_use_internal,
          openCount: count(row.open_count),
          pendingCount: count(row.pending_count),
          resolvedRecentCount: count(row.resolved_recent_count),
        })),
      });
    },

    async templates(accessToken, userId, includeArchived) {
      const rows = await rpcFor(accessToken, userId)<TemplateRow[]>(
        'chat_message_templates',
        { p_include_archived: includeArchived },
        true,
      );
      return chatTemplatesResponseSchema.parse({ templates: (rows ?? []).map(templateOf) });
    },

    async saveTemplate(accessToken, userId, input) {
      const value = await rpcFor(accessToken, userId)<unknown>('save_chat_message_template', {
        p_id: input.id ?? null,
        p_name: input.name,
        p_category: input.category,
        p_locale: input.locale,
        p_body: input.body,
        p_description: input.description ?? null,
        p_is_active: input.isActive ?? true,
      });
      const parsed = chatTemplateSchema.safeParse(value);
      if (!parsed.success) {
        throw toChatError({ code: 'shape', message: 'unexpected template' }, 'save_chat_template');
      }
      return parsed.data;
    },

    async archiveTemplate(accessToken, userId, templateId) {
      await rpcFor(accessToken, userId)<unknown>('archive_chat_message_template', {
        p_id: templateId,
      });
    },

    async renderTemplate(accessToken, userId, input) {
      const value = await rpcFor(accessToken, userId)<unknown>('render_chat_template', {
        p_template_id: input.templateId,
        p_conversation_id: input.conversationId,
      });
      return renderedChatTemplateSchema.parse(value);
    },

    async savedReplies(accessToken, userId) {
      const rows = await rpcFor(accessToken, userId)<SavedReplyRow[]>(
        'my_chat_saved_replies',
        {},
        true,
      );
      return chatSavedRepliesResponseSchema.parse({
        replies: (rows ?? []).map((row) => ({
          id: row.id,
          visibility: row.visibility,
          title: row.title,
          shortcut: row.shortcut,
          body: row.body,
          usageCount: count(row.usage_count),
          isActive: row.is_active,
          createdAt: isoTimestamp(row.created_at),
          updatedAt: isoTimestamp(row.updated_at),
        })),
      });
    },

    async saveSavedReply(accessToken, userId, input) {
      await rpcFor(accessToken, userId)<unknown>('save_chat_saved_reply', {
        p_id: input.id ?? null,
        p_visibility: input.visibility,
        p_title: input.title,
        p_body: input.body,
        p_shortcut: input.shortcut ?? null,
        p_is_active: input.isActive ?? true,
      });
    },

    async deleteSavedReply(accessToken, userId, replyId) {
      await rpcFor(accessToken, userId)<unknown>('delete_chat_saved_reply', { p_id: replyId });
    },

    async tags(accessToken, userId) {
      const rows = await rpcFor(accessToken, userId)<TagRow[]>('chat_tags', {}, true);
      return chatTagsResponseSchema.parse({
        tags: (rows ?? []).map((row) => ({
          id: row.id,
          slug: row.slug,
          label: row.label,
          description: row.description,
          isActive: row.is_active,
          conversationCount: count(row.conversation_count),
        })),
      });
    },

    async saveTag(accessToken, userId, input) {
      await rpcFor(accessToken, userId)<unknown>('save_chat_tag', {
        p_id: input.id ?? null,
        p_slug: input.slug,
        p_label: input.label,
        p_description: input.description ?? null,
        p_is_active: input.isActive ?? true,
      });
    },

    async setConversationTags(accessToken, userId, conversationId, tagIds) {
      await rpcFor(accessToken, userId)<unknown>('set_chat_conversation_tags', {
        p_conversation_id: conversationId,
        p_tag_ids: tagIds,
      });
    },

    async beginAttachment(accessToken, userId, input) {
      const value = await rpcFor(accessToken, userId)<unknown>('begin_chat_attachment', {
        p_conversation_id: input.conversationId,
        p_object_key: input.objectKey,
        p_file_name: input.fileName,
        p_content_type: input.contentType,
        p_byte_size: input.byteSize,
        p_width: input.width ?? null,
        p_height: input.height ?? null,
        p_duration_ms: input.durationMs ?? null,
      });
      return chatAttachmentUploadSchema.parse(value);
    },

    async discardAttachment(accessToken, userId, attachmentId) {
      await rpcFor(accessToken, userId)<unknown>('discard_chat_attachment', {
        p_id: attachmentId,
      });
    },

    async attachmentMedia(accessToken, userId, attachmentId) {
      const rows = await rpcFor(accessToken, userId)<MediaRow[]>(
        'chat_attachment_media',
        { p_attachment_id: attachmentId },
        true,
      );
      const row = rows?.[0];
      if (row === undefined) {
        throw new ChatRefusalError('attachment_not_found');
      }
      return {
        attachmentId: row.attachment_id,
        conversationId: row.conversation_id,
        objectKey: row.object_key,
        contentType: row.content_type,
        fileName: row.file_name,
        byteSize: Number(row.byte_size),
      };
    },

    async submitMessageFeedback(accessToken, userId, messageId, input) {
      const value = await rpcFor(accessToken, userId)<unknown>('submit_chat_message_feedback', {
        p_message_id: messageId,
        p_verdict: input.verdict,
        p_comment: input.comment ?? null,
      });
      return chatMessageFeedbackSchema.parse(value);
    },

    async messageFeedback(accessToken, userId, conversationId) {
      const rows = await rpcFor(accessToken, userId)<FeedbackRow[]>(
        'chat_message_feedback',
        { p_conversation_id: conversationId },
        true,
      );
      return chatMessageFeedbackResponseSchema.parse({
        feedback: (rows ?? []).map((row) => ({
          id: row.id,
          messageId: row.message_id,
          customerName: row.customer_name,
          verdict: row.verdict,
          comment: row.comment,
          createdAt: isoTimestamp(row.created_at),
          updatedAt: isoTimestamp(row.updated_at),
        })),
      });
    },

    async postMessage(accessToken, userId, input) {
      const value = await rpcFor(accessToken, userId)<unknown>('post_chat_message', {
        p_conversation_id: input.conversationId,
        p_client_message_id: input.clientMessageId,
        p_body: input.body ?? null,
        p_attachment_ids: input.attachmentIds ?? null,
        // A file message may quote another message; the database checks the quote belongs here.
        p_reply_to_id: input.replyToId ?? null,
      });
      // The function answers with the object keys; only this process knows the public base.
      const stored = value as {
        message?: { id?: unknown } | undefined;
        attachments?: StoredAttachment[] | undefined;
        [key: string]: unknown;
      };
      const answered = stored.attachments ?? [];

      /*
       * A database that predates the object-key column in this answer would hand back files with
       * no address, which every client renders as a bare name: a picture would vanish the moment
       * the local preview was replaced by the stored message. Reading the rows that were just
       * attached costs one call, only when the answer is incomplete, and makes the sender's screen
       * show exactly what the conversation history will show.
       */
      const complete = answered.every((attachment) => (attachment.objectKey ?? null) !== null);
      const messageId = typeof stored.message?.id === 'string' ? stored.message.id : null;
      const attachments =
        complete || messageId === null || answered.length === 0
          ? answered
          : ((await attachedToMessage(accessToken, userId, input.conversationId, messageId)) ??
            answered);

      return postedChatMessageSchema.parse({
        ...stored,
        attachments: withAttachmentUrlsOf(attachments, publicBaseUrl),
      });
    },

    async replySummary(accessToken, userId, conversationId, messageId) {
      const rows = await rpcFor(accessToken, userId)<ReplySummaryRow[]>(
        'chat_message_summaries',
        { p_conversation_id: conversationId, p_message_ids: [messageId] },
        true,
      );
      const row = rows?.[0];
      if (row === undefined) return null;
      return chatReplySummarySchema.parse({
        id: row.id,
        seq: Number(row.seq),
        senderId: row.sender_id,
        senderRole: row.sender_role,
        senderName: row.sender_name,
        kind: row.kind,
        body: row.deleted ? null : row.body,
        hasAttachment: row.has_attachment,
        deleted: row.deleted,
      });
    },

    async submitCsat(accessToken, userId, conversationId, rating, comment) {
      const value = await rpcFor(accessToken, userId)<unknown>('submit_chat_csat', {
        p_conversation_id: conversationId,
        p_rating: rating,
        p_comment: comment ?? null,
      });
      return chatCsatResponseSchema.parse(value);
    },

    async reportQueue(accessToken, userId, status, page) {
      const rows = await rpcFor(accessToken, userId)<ReportRow[]>(
        'chat_report_queue',
        {
          p_status: status === 'all' ? null : status,
          p_limit: page.limit,
          p_offset: page.offset,
        },
        true,
      );
      const reports = (rows ?? []).map((row) => ({
        id: row.id,
        status: row.status as ChatReportQueueResponse['reports'][number]['status'],
        reason: row.reason,
        details: row.details,
        actionTaken: row.action_taken as ChatReportQueueResponse['reports'][number]['actionTaken'],
        createdAt: isoTimestamp(row.created_at),
        resolvedAt: row.resolved_at === null ? null : isoTimestamp(row.resolved_at),
        messageId: row.message_id,
        messageBody: row.message_body,
        messageSenderName: row.message_sender_name,
        messageCreatedAt: isoTimestamp(row.message_created_at),
        conversationId: row.conversation_id,
        conversationSubject: row.conversation_subject,
        conversationKind: row.conversation_kind,
        reporterId: row.reporter_id,
        reporterName: row.reporter_name,
      }));
      return chatReportQueueResponseSchema.parse({
        reports,
        totalCount: rows?.[0] === undefined ? 0 : count(rows[0].total_count),
      });
    },

    async decideReport(accessToken, userId, input) {
      const value = await rpcFor(accessToken, userId)<{
        id: string;
        status: string;
        actionTaken?: string | null;
        resolvedAt?: string | Date | null;
      }>('decide_chat_report', {
        p_report_id: input.reportId,
        p_status: input.status,
        p_action_taken: input.actionTaken ?? null,
        p_note: input.note ?? null,
      });
      return {
        id: value.id,
        status: value.status,
        actionTaken: value.actionTaken ?? null,
        resolvedAt: value.resolvedAt == null ? null : isoTimestamp(value.resolvedAt),
      };
    },

    async deleteMessage(accessToken, userId, messageId) {
      await rpcFor(accessToken, userId)<unknown>('delete_chat_message', {
        p_message_id: messageId,
      });
    },

    async pinMessage(accessToken, userId, messageId) {
      await rpcFor(accessToken, userId)<unknown>('pin_chat_message', { p_message_id: messageId });
    },

    async unpinMessage(accessToken, userId, messageId) {
      await rpcFor(accessToken, userId)<unknown>('unpin_chat_message', { p_message_id: messageId });
    },

    async pinnedMessages(accessToken, userId, conversationId) {
      const rows = await rpcFor(accessToken, userId)<PinnedRow[]>(
        'chat_pinned_messages',
        { p_conversation_id: conversationId },
        true,
      );
      return chatPinnedMessagesResponseSchema.parse({
        messages: (rows ?? []).map((row) => ({
          id: row.id,
          body: row.body,
          senderName: row.sender_name,
          pinnedAt: isoTimestamp(row.pinned_at),
          pinnedByName: row.pinned_by_name,
          // Only the first file is summarized; the strip shows one line per pin.
          attachment:
            row.attachment_id === null
              ? null
              : {
                  id: row.attachment_id,
                  fileName: row.attachment_name ?? 'Attachment',
                  contentType: row.attachment_type ?? 'application/octet-stream',
                  durationMs: row.attachment_duration_ms ?? null,
                },
        })),
      });
    },

    async myMessageFeedback(accessToken, userId, conversationId) {
      const rows = await rpcFor(accessToken, userId)<MyFeedbackRow[]>(
        'chat_my_message_feedback',
        { p_conversation_id: conversationId },
        true,
      );
      return chatMyFeedbackResponseSchema.parse({
        feedback: (rows ?? []).map((row) => ({
          messageId: row.message_id,
          verdict: row.verdict,
        })),
      });
    },

    async toggleReaction(accessToken, userId, messageId, emoji) {
      const value = await rpcFor(accessToken, userId)<unknown>('toggle_chat_message_reaction', {
        p_message_id: messageId,
        p_emoji: emoji,
      });
      return chatReactionResponseSchema.parse(value);
    },

    async reactionSummary(accessToken, userId, conversationId) {
      const rows = await rpcFor(accessToken, userId)<ReactionRow[]>(
        'chat_message_reaction_summary',
        { p_conversation_id: conversationId },
        true,
      );
      return chatReactionSummaryResponseSchema.parse({
        reactions: (rows ?? []).map((row) => ({
          messageId: row.message_id,
          emoji: row.emoji,
          count: count(row.reaction_count),
          mine: row.mine,
        })),
      });
    },

    async startInternalChat(accessToken, userId, input) {
      const value = await rpcFor(accessToken, userId)<unknown>('start_internal_chat', {
        p_kind: input.kind,
        p_subject: input.subject ?? null,
        p_body: input.body ?? null,
        p_participants: input.participantIds,
        p_department: input.department ?? null,
      });
      return chatConversationDetailSchema.parse(value);
    },

    async internalChannels(accessToken, userId, page) {
      const rows = await rpcFor(accessToken, userId)<ChannelRow[]>(
        'my_internal_channels',
        { p_limit: page.limit, p_offset: page.offset },
        true,
      );
      return chatInternalChannelsResponseSchema.parse({
        channels: (rows ?? []).map((row) => ({
          id: row.id,
          kind: row.kind,
          status: row.status,
          subject: row.subject,
          department: row.department,
          employeeCount: count(row.employee_count),
          lastMessageAt: isoTimestamp(row.last_message_at),
          lastMessagePreview: row.last_message_preview,
          unreadCount: count(row.unread_count),
        })),
        totalCount: rows?.[0] === undefined ? 0 : count(rows[0].total_count),
      });
    },

    async search(accessToken, userId, query) {
      const rows = await rpcFor(accessToken, userId)<SearchRow[]>(
        'search_chat_messages',
        { p_query: query.q, p_limit: query.limit },
        true,
      );
      return chatSearchResponseSchema.parse({
        hits: (rows ?? []).map((row) => ({
          messageId: row.message_id,
          conversationId: row.conversation_id,
          conversationSubject: row.conversation_subject,
          body: row.body,
          senderName: row.sender_name,
          createdAt: isoTimestamp(row.created_at),
        })),
      });
    },

    async analytics(accessToken, userId, query) {
      const value = await rpcFor(accessToken, userId)<unknown>('chat_analytics', {
        p_from: query.from ?? null,
        p_to: query.to ?? null,
      });
      return chatAnalyticsSchema.parse(value);
    },

    async automationRules(accessToken, userId) {
      const rows = await rpcFor(accessToken, userId)<RuleRow[]>('chat_automation_rules', {}, true);
      return chatAutomationRulesResponseSchema.parse({
        rules: (rows ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description,
          trigger: row.trigger,
          conditions: row.conditions ?? {},
          actions: row.actions ?? [],
          position: count(row.position),
          stopProcessing: row.stop_processing,
          cooldownSeconds: count(row.cooldown_seconds),
          isActive: row.is_active,
          runCount: count(row.run_count),
          lastRunAt: row.last_run_at === null ? null : isoTimestamp(row.last_run_at),
          createdAt: isoTimestamp(row.created_at),
          updatedAt: isoTimestamp(row.updated_at),
        })),
      });
    },

    async saveAutomationRule(accessToken, userId, input) {
      await rpcFor(accessToken, userId)<unknown>('save_chat_automation_rule', {
        p_id: input.id ?? null,
        p_name: input.name,
        p_trigger: input.trigger,
        p_conditions: input.conditions,
        p_actions: input.actions,
        p_description: input.description ?? null,
        p_position: input.position ?? 100,
        p_stop_processing: input.stopProcessing ?? false,
        p_cooldown_seconds: input.cooldownSeconds ?? 0,
        p_is_active: input.isActive ?? true,
      });
    },

    async setAutomationRuleActive(accessToken, userId, ruleId, isActive) {
      await rpcFor(accessToken, userId)<unknown>('set_chat_automation_rule_active', {
        p_id: ruleId,
        p_is_active: isActive,
      });
    },

    async deleteAutomationRule(accessToken, userId, ruleId) {
      await rpcFor(accessToken, userId)<unknown>('delete_chat_automation_rule', { p_id: ruleId });
    },

    async automationRuns(accessToken, userId, page) {
      const rows = await rpcFor(accessToken, userId)<RunRow[]>(
        'chat_automation_runs',
        { p_limit: page.limit, p_offset: page.offset },
        true,
      );
      return chatAutomationRunsResponseSchema.parse({
        runs: (rows ?? []).map((row) => ({
          id: row.id,
          ruleId: row.rule_id,
          ruleName: row.rule_name,
          trigger: row.trigger,
          conversationId: row.conversation_id,
          status: row.status,
          actionsTaken: Array.isArray(row.actions_taken) ? row.actions_taken : [],
          error: row.error,
          createdAt: isoTimestamp(row.created_at),
        })),
        totalCount: rows?.[0] === undefined ? 0 : count(rows[0].total_count),
      });
    },

    async previewAutomationRule(accessToken, userId, input) {
      const value = await rpcFor(accessToken, userId)<unknown>('preview_chat_automation_rule', {
        p_rule_id: input.ruleId,
        p_conversation_id: input.conversationId,
      });
      return chatAutomationPreviewSchema.parse(value);
    },
  };
}

export function createPostgresChatAdminStore(
  pool: Pool,
  options: { publicBaseUrl?: string | undefined } = {},
): ChatAdminStore {
  const rpc = postgresChatRpc(pool);
  return chatAdminOver((_accessToken, userId) => rpc(userId), options.publicBaseUrl);
}

export function createSupabaseChatAdminStore(
  clients: SupabaseClients,
  options: { publicBaseUrl?: string | undefined } = {},
): ChatAdminStore {
  const rpc = supabaseChatRpc(clients);
  return chatAdminOver((accessToken) => rpc(accessToken), options.publicBaseUrl);
}
