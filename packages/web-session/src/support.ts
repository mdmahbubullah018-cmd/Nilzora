import type {
  ChatAnalytics,
  ChatAnalyticsQuery,
  ChatAttachmentType,
  ChatAttachmentUpload,
  ChatAutomationPreview,
  ChatAutomationRulesResponse,
  ChatAutomationRunsResponse,
  ChatConversationDetail,
  ChatConversationListResponse,
  ChatConversationResponse,
  ChatConversationStatus,
  ChatCsatResponse,
  ChatMessageFeedback,
  ChatMessageFeedbackResponse,
  ChatMyFeedbackResponse,
  SubmitChatMessageFeedback,
  ChatInternalChannelsResponse,
  ChatInternalNote,
  ChatMessagePage,
  ChatNotesResponse,
  ChatPinnedMessagesResponse,
  ChatPriority,
  ChatQueueQuery,
  ChatReactionResponse,
  ChatReactionSummaryResponse,
  ChatReportDecideResponse,
  ChatReportQueueResponse,
  ChatReportReason,
  ChatReportResponse,
  ChatSavedRepliesResponse,
  ChatSearchResponse,
  ChatSocketTicket,
  ChatTagsResponse,
  ChatTeamResponse,
  ChatTemplate,
  ChatTemplatesResponse,
  ChatUnreadCount,
  DecideChatReport,
  PostedChatMessage,
  PostChatMessage,
  PreviewChatAutomationRule,
  RenderedChatTemplate,
  RenderChatTemplate,
  SaveChatAutomationRule,
  SaveChatSavedReply,
  SaveChatTag,
  SaveChatTemplate,
  SendChatMessageResponse,
  StartChatConversationRequest,
  StartInternalChat,
} from '@nilzora/contracts';
import { ApiError, type DownloadedFile } from '@nilzora/api-client';
import { CSRF_FIELD } from './csrf';
import type { SessionAct } from './actions';
import type { SessionCall, SessionRead } from './session';

/*
 * The support chat gateway
 * ------------------------
 * Both web apps run the same chat: the storefront shows customers their own threads, the
 * admin workspace runs the support queue. Everything a browser can do goes through here, on
 * the server, with the session cookies — so the API sees the caller's own access token and
 * decides authorization from it. The browser only ever names the conversation it is looking at.
 *
 * Reads use `read` (the proxy keeps the access token fresh for these paths). Writes use `act`,
 * which checks the request's origin and the CSRF field before the API is reached. Whatever
 * happens, the browser gets one of this module's fixed messages, never the API's own text.
 */

export type SupportFailure = {
  ok: false;
  /** The HTTP status the web app should answer with. */
  status: number;
  code: string;
  message: string;
};

export type SupportResult<T> = { ok: true; value: T } | SupportFailure;

const UNAVAILABLE = 'Nilzora could not be reached. Try again in a moment.';
const SIGNED_OUT = 'Sign in to use chat.';

/** Codes a person can act on; anything else is answered as a generic refusal. */
const MESSAGES: Readonly<Record<string, string>> = {
  conversation_not_found: 'That conversation is no longer available.',
  conversation_closed: 'This conversation is closed. Reopen it to reply.',
  message_not_found: 'That message is no longer available.',
  assignee_invalid: 'Choose a teammate who can take conversations.',
  rate_limited: 'You are sending messages very quickly. Wait a moment.',
  forbidden: 'This account cannot do that.',
  account_suspended: 'This account is suspended.',
  realtime_unavailable: 'Live updates are unavailable; messages still send.',
  template_not_found: 'That template is no longer available.',
  template_variable_invalid: 'This template names a value Nilzora cannot fill in.',
  saved_reply_not_found: 'That saved reply is no longer available.',
  tag_not_found: 'That tag is no longer available.',
  report_not_found: 'That report is no longer available.',
  automation_rule_not_found: 'That automation rule is no longer available.',
  attachment_not_found: 'That upload is no longer available.',
  attachment_type_unsupported: 'That type of file cannot be attached here.',
  attachment_invalid: 'That file cannot be attached here.',
  rating_not_open: 'This conversation is not ready to be rated.',
  media_unavailable: 'Attachments are not available right now. Send your message without one.',
  unsupported_media_type: 'That type of file cannot be attached here.',
  image_invalid: 'That picture could not be read. Try another one.',
  bad_request: 'Check the form and try again.',
  validation_failed: 'Check the form and try again.',
  attachment_pending_limit: 'Send or remove the files already waiting first.',
};

/** The parts of a web session this gateway needs. Both apps provide exactly these. */
export interface SupportSession {
  csrfToken(): Promise<string>;
  read<T>(call: SessionCall<T>): Promise<SessionRead<T>>;
  act<T>(formData: FormData, call: SessionCall<T>): Promise<SessionAct<T>>;
}

function failure(status: number, code: string, message: string): SupportFailure {
  return { ok: false, status, code, message };
}

function mapError(error: unknown): SupportFailure {
  if (!(error instanceof ApiError)) return failure(503, 'unavailable', UNAVAILABLE);
  const message = MESSAGES[error.code] ?? UNAVAILABLE;
  if (error.status === 401) return failure(401, 'signed_out', SIGNED_OUT);
  if (error.status >= 500 || error.status === 0) return failure(503, 'unavailable', message);
  if (error.status >= 400) return failure(error.status, error.code, message);
  return failure(503, 'unavailable', message);
}

export interface SupportGateway {
  listConversations(input: {
    scope?: 'all' | 'mine' | 'unassigned' | undefined;
    status?: ChatConversationStatus | undefined;
    search?: string | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
  }): Promise<SupportResult<ChatConversationListResponse>>;
  conversation(conversationId: string): Promise<SupportResult<ChatConversationResponse>>;
  messages(
    conversationId: string,
    query?: { before?: number | undefined; limit?: number | undefined },
  ): Promise<SupportResult<ChatMessagePage>>;
  unreadCount(): Promise<SupportResult<ChatUnreadCount>>;
  startConversation(
    input: StartChatConversationRequest,
  ): Promise<SupportResult<ChatConversationResponse>>;
  sendMessage(
    conversationId: string,
    input: { clientMessageId: string; body: string },
  ): Promise<SupportResult<SendChatMessageResponse>>;
  markRead(conversationId: string, seq: number): Promise<SupportResult<ChatUnreadCount>>;
  reportMessage(
    messageId: string,
    reason: ChatReportReason,
    details?: string,
  ): Promise<SupportResult<ChatReportResponse>>;
  socketTicket(): Promise<SupportResult<ChatSocketTicket>>;

  // Staff operations. The API refuses these to a customer.
  /** The operator inbox: only threads this account may open, filtered and sorted by the API. */
  queue(input: Partial<ChatQueueQuery>): Promise<SupportResult<ChatConversationListResponse>>;
  /** Teammates who can take a conversation or join a team thread, with their workload. */
  team(): Promise<SupportResult<ChatTeamResponse>>;
  setStatus(
    conversationId: string,
    status: ChatConversationStatus,
  ): Promise<SupportResult<ChatConversationResponse>>;
  assign(
    conversationId: string,
    assigneeId: string | null,
    note?: string,
  ): Promise<SupportResult<ChatConversationResponse>>;
  setPriority(
    conversationId: string,
    priority: ChatPriority,
  ): Promise<SupportResult<ChatConversationResponse>>;
  notes(
    conversationId: string,
    query?: { before?: number | undefined; limit?: number | undefined },
  ): Promise<SupportResult<ChatNotesResponse>>;
  addNote(conversationId: string, body: string): Promise<SupportResult<ChatInternalNote>>;

  // ---------------------------------------------------------------- Phase 2
  //
  // The admin workspace runs all of these; the storefront uses the attachment, rating,
  // pin, reaction and search calls for its own threads. Every one of them is refused by the
  // API when the caller lacks the permission, so the gateway never decides.

  listTemplates(input?: {
    includeArchived?: boolean | undefined;
  }): Promise<SupportResult<ChatTemplatesResponse>>;
  saveTemplate(body: SaveChatTemplate): Promise<SupportResult<ChatTemplate>>;
  archiveTemplate(templateId: string): Promise<SupportResult<void>>;
  renderTemplate(body: RenderChatTemplate): Promise<SupportResult<RenderedChatTemplate>>;
  savedReplies(): Promise<SupportResult<ChatSavedRepliesResponse>>;
  saveSavedReply(body: SaveChatSavedReply): Promise<SupportResult<void>>;
  deleteSavedReply(replyId: string): Promise<SupportResult<void>>;
  tags(): Promise<SupportResult<ChatTagsResponse>>;
  saveTag(body: SaveChatTag): Promise<SupportResult<void>>;
  setConversationTags(conversationId: string, tagIds: string[]): Promise<SupportResult<void>>;
  uploadAttachment(input: {
    conversationId: string;
    fileName: string;
    contentType: ChatAttachmentType;
    body: Uint8Array;
    /** The recording's length in milliseconds; omitted for a picture or a document. */
    durationMs?: number | undefined;
  }): Promise<SupportResult<ChatAttachmentUpload>>;
  discardAttachment(attachmentId: string): Promise<SupportResult<void>>;
  postMessage(body: PostChatMessage): Promise<SupportResult<PostedChatMessage>>;
  /** The private bytes of one attachment, read with the caller's own session. */
  media(attachmentId: string, variant?: 'full' | 'thumb'): Promise<SupportResult<DownloadedFile>>;
  submitRating(
    conversationId: string,
    body: { rating: number; comment?: string | undefined },
  ): Promise<SupportResult<ChatCsatResponse>>;
  /** A customer's verdict on one support reply; separate from the conversation-level rating. */
  submitMessageFeedback(
    messageId: string,
    body: SubmitChatMessageFeedback,
  ): Promise<SupportResult<ChatMessageFeedback>>;
  /** The thread's verdicts, for an account that may support it. */
  messageFeedback(conversationId: string): Promise<SupportResult<ChatMessageFeedbackResponse>>;
  /** The signed-in customer's own verdicts on this thread's replies. */
  myMessageFeedback(conversationId: string): Promise<SupportResult<ChatMyFeedbackResponse>>;
  reports(query?: {
    status?: 'open' | 'reviewing' | 'dismissed' | 'actioned' | 'all' | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  }): Promise<SupportResult<ChatReportQueueResponse>>;
  decideReport(body: DecideChatReport): Promise<SupportResult<ChatReportDecideResponse>>;
  deleteMessage(messageId: string): Promise<SupportResult<void>>;
  pinMessage(conversationId: string, messageId: string): Promise<SupportResult<void>>;
  unpinMessage(conversationId: string, messageId: string): Promise<SupportResult<void>>;
  pinnedMessages(conversationId: string): Promise<SupportResult<ChatPinnedMessagesResponse>>;
  toggleReaction(
    conversationId: string,
    messageId: string,
    emoji: string,
  ): Promise<SupportResult<ChatReactionResponse>>;
  reactionSummary(conversationId: string): Promise<SupportResult<ChatReactionSummaryResponse>>;
  startInternalChat(body: StartInternalChat): Promise<SupportResult<ChatConversationDetail>>;
  internalChannels(query?: {
    limit?: number | undefined;
    offset?: number | undefined;
  }): Promise<SupportResult<ChatInternalChannelsResponse>>;
  search(query: {
    q: string;
    limit?: number | undefined;
  }): Promise<SupportResult<ChatSearchResponse>>;
  analytics(query?: ChatAnalyticsQuery): Promise<SupportResult<ChatAnalytics>>;
  automationRules(): Promise<SupportResult<ChatAutomationRulesResponse>>;
  saveAutomationRule(body: SaveChatAutomationRule): Promise<SupportResult<void>>;
  setAutomationRuleActive(ruleId: string, isActive: boolean): Promise<SupportResult<void>>;
  deleteAutomationRule(ruleId: string): Promise<SupportResult<void>>;
  automationRuns(query?: {
    limit?: number | undefined;
    offset?: number | undefined;
  }): Promise<SupportResult<ChatAutomationRunsResponse>>;
  previewAutomationRule(
    body: PreviewChatAutomationRule,
  ): Promise<SupportResult<ChatAutomationPreview>>;
}

export function createSupportGateway(session: SupportSession): SupportGateway {
  async function read<T>(call: SessionCall<T>): Promise<SupportResult<T>> {
    try {
      const outcome = await session.read(call);
      if (outcome.kind === 'ok') return { ok: true, value: outcome.value };
      if (outcome.kind === 'signed_out') return failure(401, 'signed_out', SIGNED_OUT);
      return failure(503, 'unavailable', UNAVAILABLE);
    } catch (error) {
      return mapError(error);
    }
  }

  /**
   * Runs a write through `act`. The CSRF value is read server-side from the cookie the proxy
   * issues for these paths, so a request from another site — which never reaches this code
   * with a matching cookie — is refused before the API is called.
   */
  async function act<T>(call: SessionCall<T>): Promise<SupportResult<T>> {
    const formData = new FormData();
    formData.set(CSRF_FIELD, await session.csrfToken());
    try {
      const outcome = await session.act(formData, call);
      if (outcome.kind === 'ok') return { ok: true, value: outcome.value };
      if (outcome.kind === 'untrusted') {
        return failure(403, 'untrusted', 'Reload the page and try again.');
      }
      if (outcome.kind === 'signed_out') return failure(401, 'signed_out', SIGNED_OUT);
      return failure(503, 'unavailable', UNAVAILABLE);
    } catch (error) {
      return mapError(error);
    }
  }

  return {
    listConversations: (input) => read((api, token) => api.listChatConversations(token, input)),
    conversation: (conversationId) =>
      read((api, token) => api.getChatConversation(token, conversationId)),
    messages: (conversationId, query) =>
      read((api, token) => api.listChatMessages(token, conversationId, query)),
    unreadCount: () => read((api, token) => api.getChatUnreadCount(token)),
    startConversation: (input) => act((api, token) => api.startChatConversation(token, input)),
    sendMessage: (conversationId, input) =>
      act((api, token) => api.sendChatMessage(token, conversationId, input)),
    markRead: (conversationId, seq) =>
      act((api, token) => api.markChatRead(token, conversationId, seq)),
    reportMessage: (messageId, reason, details) =>
      act((api, token) => api.reportChatMessage(token, messageId, { reason, details })),
    socketTicket: () => read((api, token) => api.createChatSocketTicket(token)),

    queue: (input) => read((api, token) => api.listChatQueue(token, input)),
    team: () => read((api, token) => api.listChatTeam(token)),
    setStatus: (conversationId, status) =>
      act((api, token) => api.setChatStatus(token, conversationId, status)),
    assign: (conversationId, assigneeId, note) =>
      act((api, token) => api.assignChatConversation(token, conversationId, { assigneeId, note })),
    setPriority: (conversationId, priority) =>
      act((api, token) => api.setChatPriority(token, conversationId, priority)),
    notes: (conversationId, query) =>
      read((api, token) => api.listChatNotes(token, conversationId, query)),
    addNote: (conversationId, body) =>
      act((api, token) => api.addChatNote(token, conversationId, body)),

    listTemplates: (input) => read((api, token) => api.listChatTemplates(token, input ?? {})),
    saveTemplate: (body) => act((api, token) => api.saveChatTemplate(token, body)),
    archiveTemplate: (templateId) =>
      act((api, token) => api.archiveChatTemplate(token, templateId)),
    renderTemplate: (body) => act((api, token) => api.renderChatTemplate(token, body)),
    savedReplies: () => read((api, token) => api.listChatSavedReplies(token)),
    saveSavedReply: (body) => act((api, token) => api.saveChatSavedReply(token, body)),
    deleteSavedReply: (replyId) => act((api, token) => api.deleteChatSavedReply(token, replyId)),
    tags: () => read((api, token) => api.listChatTags(token)),
    saveTag: (body) => act((api, token) => api.saveChatTag(token, body)),
    setConversationTags: (conversationId, tagIds) =>
      act((api, token) => api.setChatConversationTags(token, conversationId, tagIds)),
    uploadAttachment: (input) =>
      act((api, token) =>
        api.uploadChatAttachment(
          token,
          input.conversationId,
          input.fileName,
          input.body,
          input.contentType,
          input.durationMs,
        ),
      ),
    discardAttachment: (attachmentId) =>
      act((api, token) => api.discardChatAttachment(token, attachmentId)),
    postMessage: (body) => act((api, token) => api.postChatMessage(token, body)),
    media: (attachmentId, variant) =>
      read((api, token) => api.chatAttachmentMedia(token, attachmentId, variant)),
    submitRating: (conversationId, body) =>
      act((api, token) => api.submitChatCsat(token, conversationId, body)),
    submitMessageFeedback: (messageId, body) =>
      act((api, token) => api.submitChatMessageFeedback(token, messageId, body)),
    messageFeedback: (conversationId) =>
      read((api, token) => api.listChatMessageFeedback(token, conversationId)),
    myMessageFeedback: (conversationId) =>
      read((api, token) => api.listMyChatFeedback(token, conversationId)),
    reports: (query) => read((api, token) => api.listChatReports(token, query ?? {})),
    decideReport: (body) => act((api, token) => api.decideChatReport(token, body)),
    deleteMessage: (messageId) => act((api, token) => api.deleteChatMessage(token, messageId)),
    pinMessage: (conversationId, messageId) =>
      act((api, token) => api.pinChatMessage(token, conversationId, messageId)),
    unpinMessage: (conversationId, messageId) =>
      act((api, token) => api.unpinChatMessage(token, conversationId, messageId)),
    pinnedMessages: (conversationId) =>
      read((api, token) => api.listChatPinnedMessages(token, conversationId)),
    toggleReaction: (conversationId, messageId, emoji) =>
      act((api, token) => api.toggleChatMessageReaction(token, conversationId, messageId, emoji)),
    reactionSummary: (conversationId) =>
      read((api, token) => api.listChatReactionSummary(token, conversationId)),
    startInternalChat: (body) => act((api, token) => api.startInternalChat(token, body)),
    internalChannels: (query) => read((api, token) => api.listInternalChannels(token, query ?? {})),
    search: (query) => read((api, token) => api.searchChatMessages(token, query)),
    analytics: (query) => read((api, token) => api.getChatAnalytics(token, query ?? {})),
    automationRules: () => read((api, token) => api.listChatAutomationRules(token)),
    saveAutomationRule: (body) => act((api, token) => api.saveChatAutomationRule(token, body)),
    setAutomationRuleActive: (ruleId, isActive) =>
      act((api, token) => api.setChatAutomationRuleActive(token, ruleId, isActive)),
    deleteAutomationRule: (ruleId) =>
      act((api, token) => api.deleteChatAutomationRule(token, ruleId)),
    automationRuns: (query) => read((api, token) => api.listChatAutomationRuns(token, query ?? {})),
    previewAutomationRule: (body) =>
      act((api, token) => api.previewChatAutomationRule(token, body)),
  };
}
