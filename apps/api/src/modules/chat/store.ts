import {
  chatConversationDetailSchema,
  chatInternalNoteSchema,
  chatMessagePageSchema,
  chatMessageSchema,
  chatReplySummarySchema,
  chatReportResponseSchema,
  sendChatMessageResponseSchema,
  type ChatConversationDetail,
  type ChatConversationListQuery,
  type ChatQueueQuery,
  type ChatConversationSummary,
  type ChatInternalNote,
  type ChatMessage,
  type ChatMessagePage,
  type ChatPriority,
  type ChatConversationStatus,
  type ChatReportReason,
  type ChatReportResponse,
  type ChatNotesResponse,
  type ChatReplySummary,
  type SendChatMessageResponse,
  type StartChatConversationRequest,
} from '@nilzora/contracts';
import type { Pool } from 'pg';
import { isoTimestamp, StoreUnavailableError } from '../commerce/errors';
import { withUser } from '../../db/user-context';
import type { SupabaseClients } from '../../supabase/clients';
import { bindArguments, functionCallSql, type Rpc } from '../db-rpc';
import type { AttachmentRow, StoredAttachment } from './attachment-media';
import { fromAttachmentRow, withAttachmentUrlsOf } from './attachment-media';
import { pictureFromKey } from '../media/images';
import { toChatError } from './errors';

/*
 * The unified communication store
 * -------------------------------
 * Every method calls a database function that decides authorization from the caller's
 * identity (see 20261113090000_chat_conversations.sql). This module holds no rule of its
 * own: it maps rows to the public contract and turns a refusal into an error the routes
 * can answer. `userId` is always the verified caller from the access token, never a value
 * taken from the request.
 */

export interface SendMessageInput {
  clientMessageId: string;
  body: string;
  /**
   * The message being answered, if any. `null` is allowed because the request schema offers
   * it as the way to say "no reply"; it means the same as leaving it out.
   */
  replyToId?: string | null;
}

export interface ChatStore {
  start(
    accessToken: string,
    userId: string,
    input: StartChatConversationRequest,
  ): Promise<ChatConversationDetail>;
  list(
    accessToken: string,
    userId: string,
    query: ChatConversationListQuery,
  ): Promise<{ conversations: ChatConversationSummary[]; total: number }>;
  /**
   * One page of the operator queue: only the customer and moderation threads this account may
   * open (never its internal team threads), filtered and sorted as asked. The database function
   * `chat_support_queue` decides visibility, with the same rule as `chat_can_read`.
   */
  queue(
    accessToken: string,
    userId: string,
    query: ChatQueueQuery,
  ): Promise<{ conversations: ChatConversationSummary[]; total: number }>;
  unreadCount(accessToken: string, userId: string): Promise<number>;
  detail(
    accessToken: string,
    userId: string,
    conversationId: string,
  ): Promise<ChatConversationDetail>;
  messages(
    accessToken: string,
    userId: string,
    conversationId: string,
    page: { before?: number | undefined; limit: number },
  ): Promise<ChatMessagePage>;
  send(
    accessToken: string,
    userId: string,
    conversationId: string,
    input: SendMessageInput,
  ): Promise<SendChatMessageResponse>;
  markRead(
    accessToken: string,
    userId: string,
    conversationId: string,
    seq: number,
  ): Promise<number>;
  markDelivered(
    accessToken: string,
    userId: string,
    conversationId: string,
    seq: number,
  ): Promise<void>;
  setStatus(
    accessToken: string,
    userId: string,
    conversationId: string,
    status: ChatConversationStatus,
  ): Promise<ChatConversationDetail>;
  assign(
    accessToken: string,
    userId: string,
    conversationId: string,
    assigneeId: string | null,
    note?: string,
  ): Promise<ChatConversationDetail>;
  setPriority(
    accessToken: string,
    userId: string,
    conversationId: string,
    priority: ChatPriority,
  ): Promise<ChatConversationDetail>;
  addNote(
    accessToken: string,
    userId: string,
    conversationId: string,
    body: string,
  ): Promise<ChatInternalNote>;
  notes(
    accessToken: string,
    userId: string,
    conversationId: string,
    page: { before?: number | undefined; limit: number },
  ): Promise<ChatNotesResponse>;
  report(
    accessToken: string,
    userId: string,
    messageId: string,
    reason: ChatReportReason,
    details?: string,
  ): Promise<ChatReportResponse>;
  /** Whether this account may join the conversation's realtime room. */
  canAccess(accessToken: string, userId: string, conversationId: string): Promise<boolean>;
}

/**
 * The columns `my_chat_conversations` (and the operator queue, `chat_support_queue`) return, as
 * both drivers hand them over.
 */
interface ConversationRow {
  id: string;
  kind: string;
  status: string;
  priority: string;
  subject: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  order_id: string | null;
  order_number: string | null;
  product_id: string | null;
  product_name: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  last_message_at: string | Date;
  last_message_preview: string | null;
  last_message_sender_id: string | null;
  message_count: number | string;
  unread_count: number | string;
  latest_seq: number | string | null;
  created_at: string | Date;
  updated_at: string | Date;
  total_count: number | string;
}

interface MessageRow {
  id: string;
  seq: number | string;
  sender_id: string | null;
  sender_role: string;
  sender_name: string | null;
  kind: string;
  body: string | null;
  reply_to_id: string | null;
  metadata: Record<string, unknown> | null;
  edited_at: string | Date | null;
  created_at: string | Date;
  duplicate?: boolean;
  unread_count?: number | string;
}

interface NoteRow {
  id: string;
  seq: number | string;
  author_id: string | null;
  author_name: string | null;
  body: string;
  created_at: string | Date;
}

function toIso(value: string | Date): string {
  return isoTimestamp(value);
}

/**
 * A column that is null, or that the function did not return at all (`send_chat_message` has no
 * `edited_at`), is "no time". Only a null used to count, and an absent column became the text
 * "undefined", which the inbox showed as "edited" on every message just sent.
 */
function toIsoOrNull(value: string | Date | null | undefined): string | null {
  return value === null || value === undefined ? null : isoTimestamp(value);
}

function toNumber(value: number | string | null): number {
  return value === null ? 0 : Number(value);
}

/** One list row as the contract's summary; shared by the customer list and the operator queue. */
function summaryOf(row: ConversationRow): ChatConversationSummary {
  return {
    id: row.id,
    kind: row.kind as ChatConversationSummary['kind'],
    status: row.status as ChatConversationSummary['status'],
    priority: row.priority as ChatConversationSummary['priority'],
    subject: row.subject,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    orderId: row.order_id,
    orderNumber: row.order_number,
    productId: row.product_id,
    productName: row.product_name,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name,
    lastMessageAt: toIso(row.last_message_at),
    lastMessagePreview: row.last_message_preview,
    lastMessageSenderId: row.last_message_sender_id,
    messageCount: toNumber(row.message_count),
    unreadCount: toNumber(row.unread_count),
    latestSeq: row.latest_seq === null ? null : toNumber(row.latest_seq),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function messageOf(row: MessageRow, replyTo: ChatReplySummary | null = null): ChatMessage {
  return chatMessageSchema.parse({
    id: row.id,
    seq: toNumber(row.seq),
    senderId: row.sender_id,
    senderRole: row.sender_role,
    senderName: row.sender_name,
    kind: row.kind,
    body: row.body,
    replyToId: row.reply_to_id,
    replyTo,
    metadata: row.metadata ?? {},
    editedAt: toIsoOrNull(row.edited_at),
    createdAt: toIso(row.created_at),
  });
}

/** One row of `chat_message_summaries(p_conversation_id, p_message_ids)`. */
interface ReplySummaryRow {
  id: string;
  seq: number | string;
  sender_id: string | null;
  sender_role: ChatMessage['senderRole'];
  sender_name: string | null;
  kind: ChatMessage['kind'];
  body: string | null;
  has_attachment: boolean;
  deleted: boolean;
  created_at: string;
}

function replySummaryOf(row: ReplySummaryRow): ChatReplySummary {
  return chatReplySummarySchema.parse({
    id: row.id,
    seq: toNumber(row.seq),
    senderId: row.sender_id,
    senderRole: row.sender_role,
    senderName: row.sender_name,
    kind: row.kind,
    body: row.deleted ? null : row.body,
    hasAttachment: row.has_attachment,
    deleted: row.deleted,
  });
}

function noteOf(row: NoteRow): ChatInternalNote {
  return chatInternalNoteSchema.parse({
    id: row.id,
    seq: toNumber(row.seq),
    authorId: row.author_id,
    authorName: row.author_name,
    body: row.body,
    createdAt: toIso(row.created_at),
  });
}

/**
 * The conversation payload carries base media keys, because only the API knows the public
 * media origin. This turns them into the two URLs the panel shows, and drops the keys so the
 * contract (and every client) only ever deals in URLs. A missing key stays null: a product
 * without a picture is a normal state, not an error.
 */
function withPictures(value: unknown, publicBaseUrl: string | undefined): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const payload = value as {
    product?: Record<string, unknown> | null;
    order?: (Record<string, unknown> & { items?: unknown }) | null;
  };
  const result = { ...payload };

  if (payload.product && typeof payload.product === 'object') {
    const { imageKey, imageAlt, ...product } = payload.product;
    result.product = {
      ...product,
      image: pictureFromKey(
        typeof imageKey === 'string' ? imageKey : null,
        publicBaseUrl,
        typeof imageAlt === 'string' ? imageAlt : null,
      ),
    };
  }

  if (payload.order && typeof payload.order === 'object' && Array.isArray(payload.order.items)) {
    const items = payload.order.items as unknown[];
    result.order = {
      ...payload.order,
      items: items.map((entry) => {
        if (typeof entry !== 'object' || entry === null) return entry;
        const { imageKey, imageAlt, ...item } = entry as Record<string, unknown>;
        return {
          ...item,
          image: pictureFromKey(
            typeof imageKey === 'string' ? imageKey : null,
            publicBaseUrl,
            typeof imageAlt === 'string' ? imageAlt : null,
          ),
        };
      }),
    };
  }

  return result;
}

/**
 * A `jsonb` function's answer, checked against the public contract before it is served.
 * A shape the API does not recognise is an outage (503), never a half-rendered thread.
 */
function detailOf(value: unknown, publicBaseUrl: string | undefined): ChatConversationDetail {
  const parsed = chatConversationDetailSchema.safeParse(withPictures(value, publicBaseUrl));
  if (!parsed.success) {
    throw toChatError({ code: 'shape', message: 'unexpected chat payload' }, 'chat_conversation');
  }
  return parsed.data;
}

function chatOver(
  rpcFor: (accessToken: string, userId: string) => Rpc,
  publicBaseUrl: string | undefined,
): ChatStore {
  /**
   * The attachments of one conversation, grouped by the message that carries them. `chat_attachments`
   * answers only attached rows, so a pending upload never appears in a thread.
   */
  async function attachmentsOfPage(
    accessToken: string,
    userId: string,
    conversationId: string,
  ): Promise<Map<string, StoredAttachment[]>> {
    const rows = await rpcFor(accessToken, userId)<AttachmentRow[]>(
      'chat_attachments',
      { p_conversation_id: conversationId },
      true,
    );
    const grouped = new Map<string, StoredAttachment[]>();
    for (const row of rows ?? []) {
      const attachment = fromAttachmentRow(row);
      const messageId = attachment.messageId;
      if (messageId === null || messageId === undefined) continue;
      const list = grouped.get(messageId) ?? [];
      list.push(attachment);
      grouped.set(messageId, list);
    }
    return grouped;
  }

  /**
   * The quoted messages of one page, keyed by message id. A quote may name a message far older
   * than the page, so the page alone cannot supply it; this asks for exactly the ids the page
   * points at that the page does not already contain. One call for the whole page.
   */
  async function repliesOfPage(
    accessToken: string,
    userId: string,
    conversationId: string,
    wanted: readonly string[],
  ): Promise<Map<string, ChatReplySummary>> {
    const resolved = new Map<string, ChatReplySummary>();
    const unique = [...new Set(wanted)];
    if (unique.length === 0) return resolved;
    const rows = await rpcFor(accessToken, userId)<ReplySummaryRow[]>(
      'chat_message_summaries',
      { p_conversation_id: conversationId, p_message_ids: unique.slice(0, 100) },
      true,
    );
    for (const row of rows ?? []) resolved.set(row.id, replySummaryOf(row));
    return resolved;
  }

  return {
    async start(accessToken, userId, input) {
      const rows = await rpcFor(accessToken, userId)<unknown>('start_chat_conversation', {
        p_kind: input.kind,
        p_order_number: input.orderNumber ?? null,
        p_product_id: input.productId ?? null,
        p_subject: input.subject ?? null,
        p_body: input.body ?? null,
        p_participants: input.participants ?? null,
      });
      return detailOf(rows, publicBaseUrl);
    },

    async list(accessToken, userId, query) {
      const rows = await rpcFor(accessToken, userId)<ConversationRow[]>(
        'my_chat_conversations',
        {
          p_scope: query.scope,
          p_status: query.status ?? null,
          p_search: query.search ?? null,
          p_limit: query.pageSize,
          p_offset: (query.page - 1) * query.pageSize,
        },
        true,
      );
      const list = rows ?? [];
      return {
        conversations: list.map(summaryOf),
        total: list.length === 0 ? 0 : toNumber(list[0]?.total_count ?? 0),
      };
    },

    async queue(accessToken, userId, query) {
      const rows = await rpcFor(accessToken, userId)<ConversationRow[]>(
        'chat_support_queue',
        {
          p_scope: query.scope,
          p_status: query.status ?? null,
          p_priority: query.priority ?? null,
          p_search: query.search ?? null,
          p_sort: query.sort,
          p_limit: query.pageSize,
          p_offset: (query.page - 1) * query.pageSize,
        },
        true,
      );
      const list = rows ?? [];
      return {
        conversations: list.map(summaryOf),
        total: list.length === 0 ? 0 : toNumber(list[0]?.total_count ?? 0),
      };
    },

    async unreadCount(accessToken, userId) {
      const count = await rpcFor(accessToken, userId)<unknown>('my_unread_chat_count', {});
      return Number(count ?? 0);
    },

    async detail(accessToken, userId, conversationId) {
      return detailOf(
        await rpcFor(accessToken, userId)<unknown>('chat_conversation', {
          p_conversation_id: conversationId,
        }),
        publicBaseUrl,
      );
    },

    async messages(accessToken, userId, conversationId, page) {
      const rows = await rpcFor(accessToken, userId)<MessageRow[]>(
        'chat_messages',
        {
          p_conversation_id: conversationId,
          p_before_seq: page.before ?? null,
          p_limit: page.limit,
        },
        true,
      );
      // One extra call for the whole page, not one per message: the attachments arrive with the
      // object keys the API alone can turn into public URLs.
      const attachments = await attachmentsOfPage(accessToken, userId, conversationId);
      const stored = rows ?? [];
      const onPage = new Set(stored.map((row) => row.id));
      // A quote the page itself contains costs nothing; only the rest is looked up.
      const replies = await repliesOfPage(
        accessToken,
        userId,
        conversationId,
        stored.flatMap((row) =>
          row.reply_to_id !== null && row.reply_to_id !== '' && !onPage.has(row.reply_to_id)
            ? [row.reply_to_id]
            : [],
        ),
      );
      // The function answers newest first; a screen appends, so serve oldest first.
      const messages = stored
        .map((row) => ({
          ...messageOf(
            row,
            row.reply_to_id === null ? null : (replies.get(row.reply_to_id) ?? null),
          ),
          attachments: withAttachmentUrlsOf(attachments.get(row.id) ?? [], publicBaseUrl),
        }))
        .reverse();
      const oldest = messages[0]?.seq ?? null;
      return chatMessagePageSchema.parse({
        messages,
        nextCursor: messages.length < page.limit || oldest === null ? null : oldest,
      });
    },

    async send(accessToken, userId, conversationId, input) {
      const rows = await rpcFor(accessToken, userId)<MessageRow[]>(
        'send_chat_message',
        {
          p_conversation_id: conversationId,
          p_client_message_id: input.clientMessageId,
          p_body: input.body,
          p_reply_to_id: input.replyToId ?? null,
        },
        true,
      );
      const row = rows?.[0];
      if (row === undefined) {
        throw toChatError({ code: 'shape', message: 'no stored message' }, 'send_chat_message');
      }
      // A reply is answered with its quote, so the sender sees it rendered before any reload.
      const replies =
        row.reply_to_id === null
          ? new Map<string, ChatReplySummary>()
          : await repliesOfPage(accessToken, userId, conversationId, [row.reply_to_id]);
      return sendChatMessageResponseSchema.parse({
        message: messageOf(
          row,
          row.reply_to_id === null ? null : (replies.get(row.reply_to_id) ?? null),
        ),
        duplicate: row.duplicate === true,
        unread: toNumber(row.unread_count ?? 0),
      });
    },

    async markRead(accessToken, userId, conversationId, seq) {
      const count = await rpcFor(accessToken, userId)<unknown>('mark_chat_read', {
        p_conversation_id: conversationId,
        p_seq: seq,
      });
      return Number(count ?? 0);
    },

    async markDelivered(accessToken, userId, conversationId, seq) {
      await rpcFor(accessToken, userId)('mark_chat_delivered', {
        p_conversation_id: conversationId,
        p_seq: seq,
      });
    },

    async setStatus(accessToken, userId, conversationId, status) {
      return detailOf(
        await rpcFor(accessToken, userId)<unknown>('set_chat_conversation_status', {
          p_conversation_id: conversationId,
          p_status: status,
        }),
        publicBaseUrl,
      );
    },

    async assign(accessToken, userId, conversationId, assigneeId, note) {
      return detailOf(
        await rpcFor(accessToken, userId)<unknown>('assign_chat_conversation', {
          p_conversation_id: conversationId,
          p_assignee_id: assigneeId,
          p_note: note ?? null,
        }),
        publicBaseUrl,
      );
    },

    async setPriority(accessToken, userId, conversationId, priority) {
      return detailOf(
        await rpcFor(accessToken, userId)<unknown>('set_chat_conversation_priority', {
          p_conversation_id: conversationId,
          p_priority: priority,
        }),
        publicBaseUrl,
      );
    },

    async addNote(accessToken, userId, conversationId, body) {
      const rows = await rpcFor(accessToken, userId)<NoteRow[]>(
        'add_chat_internal_note',
        { p_conversation_id: conversationId, p_body: body },
        true,
      );
      const row = rows?.[0];
      if (row === undefined) {
        throw toChatError({ code: 'shape', message: 'no stored note' }, 'add_chat_internal_note');
      }
      return noteOf(row);
    },

    async notes(accessToken, userId, conversationId, page) {
      const rows = await rpcFor(accessToken, userId)<NoteRow[]>(
        'chat_internal_notes',
        {
          p_conversation_id: conversationId,
          p_before_seq: page.before ?? null,
          p_limit: page.limit,
        },
        true,
      );
      const notes = (rows ?? []).map(noteOf).reverse();
      const oldest = notes[0]?.seq ?? null;
      return {
        notes,
        nextCursor: notes.length < page.limit || oldest === null ? null : oldest,
      };
    },

    async report(accessToken, userId, messageId, reason, details) {
      const value = await rpcFor(accessToken, userId)<unknown>('report_chat_message', {
        p_message_id: messageId,
        p_reason: reason,
        p_details: details ?? null,
      });
      return chatReportResponseSchema.parse(value);
    },

    async canAccess(accessToken, userId, conversationId) {
      const allowed = await rpcFor(accessToken, userId)<unknown>('chat_can_access', {
        p_conversation_id: conversationId,
      });
      return allowed === true;
    },
  };
}

/*
 * The two ways every chat call reaches the database. Unlike the commerce helpers, a
 * refusal here is a chat refusal: these adapters translate the NZ* SQLSTATEs into the
 * errors the chat routes answer, and everything else into StoreUnavailableError (503).
 */
export function postgresChatRpc(pool: Pool): (userId: string) => Rpc {
  return (userId) =>
    async <T>(name: string, args: Record<string, unknown>, rows = false): Promise<T> => {
      try {
        return await withUser(pool, userId, async (client) => {
          /*
           * An undefined argument is left out, so the function's own default applies. A null one
           * is sent as SQL NULL, exactly as PostgREST sends it on the Supabase path: several
           * functions need it (a new template, saved reply, tag or rule passes `p_id => null`,
           * which has no default, and `chat_report_queue` reads a null status as "every
           * status"). Dropping it called a signature that does not exist (42883) or silently
           * applied the default instead.
           */
          const entries = Object.entries(args).filter(([, argument]) => argument !== undefined);
          const parameters = await bindArguments(client, name, entries);
          const named = entries.map(([key], index) => `${key} => $${index + 1}`).join(', ');
          const sql = rows
            ? `select * from public.${name}(${named})`
            : await functionCallSql(client, name, named);
          const result = await client.query(sql, parameters);
          if (rows) return result.rows as T;
          const row = result.rows[0] as { value: T } | undefined;
          if (row === undefined) {
            throw new StoreUnavailableError(`${name} answered with no row`);
          }
          return row.value;
        });
      } catch (error) {
        if (error instanceof StoreUnavailableError) throw error;
        throw toChatError(
          {
            code:
              typeof (error as { code?: unknown }).code === 'string'
                ? (error as { code: string }).code
                : '',
            message: 'chat call failed',
            details:
              typeof (error as { detail?: unknown }).detail === 'string'
                ? (error as { detail: string }).detail
                : null,
          },
          name,
        );
      }
    };
}

export function supabaseChatRpc(clients: SupabaseClients): (accessToken: string) => Rpc {
  return (accessToken) => {
    const client = clients.asUser(accessToken);
    const call = client.rpc.bind(client) as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{
      data: unknown;
      error: { code?: string; message?: string; details?: string | null } | null;
    }>;
    return async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      const { data, error } = await call(name, args);
      if (error) {
        throw toChatError(
          {
            code: typeof error.code === 'string' ? error.code : '',
            message: typeof error.message === 'string' ? error.message : 'chat call failed',
            details: error.details ?? null,
          },
          name,
        );
      }
      return data as T;
    };
  };
}

/*
 * The direct connection carries the caller's identity as a transaction-local role and
 * claim set, so `auth.uid()` inside the functions resolves to the verified account. The
 * PostgREST path carries it in the caller's JWT. Both therefore reach the same functions
 * and see the same refusals.
 */
export function createPostgresChatStore(
  pool: Pool,
  options: { publicBaseUrl?: string | undefined } = {},
): ChatStore {
  const rpc = postgresChatRpc(pool);
  return chatOver((_accessToken, userId) => rpc(userId), options.publicBaseUrl);
}

export function createSupabaseChatStore(
  clients: SupabaseClients,
  options: { publicBaseUrl?: string | undefined } = {},
): ChatStore {
  const rpc = supabaseChatRpc(clients);
  return chatOver((accessToken) => rpc(accessToken), options.publicBaseUrl);
}
