import type { ChatAttachment } from '@nilzora/contracts';

/*
 * How a chat upload is addressed
 * ------------------------------
 * The database stores an object key and nothing else, and that key stays on the server. A client
 * receives the API's own media path (`/chat/attachments/<id>/media`), which authorizes the caller
 * against the conversation before any bytes are read — see `public.chat_attachment_media` and the
 * `GET /chat/attachments/:id/media` route. Customer photos, recordings and documents are private:
 * no permanent bucket address is produced for them, and the object key is never serialized.
 *
 * Each app resolves the path against its own authenticated proxy (storefront and admin) or its
 * API address with the account's bearer token (Android).
 */

/**
 * One attachment as the API carries it between the database and a client. A jsonb answer (the
 * posted message) already uses these names; a `returns table` answer is mapped into them by
 * `fromAttachmentRow`.
 */
export interface StoredAttachment {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationMs?: number | null | undefined;
  objectKey?: string | null | undefined;
  messageId?: string | null | undefined;
}

/** One row of `chat_attachments(p_conversation_id)`, exactly as PostgreSQL names the columns. */
export interface AttachmentRow {
  id: string;
  message_id: string | null;
  file_name: string;
  content_type: string;
  byte_size: number | string;
  width: number | null;
  height: number | null;
  duration_ms?: number | null | undefined;
  object_key: string;
}

/** A table row in the names the rest of the API uses. */
export function fromAttachmentRow(row: AttachmentRow): StoredAttachment {
  return {
    id: row.id,
    messageId: row.message_id,
    fileName: row.file_name,
    contentType: row.content_type,
    byteSize: Number(row.byte_size),
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms ?? null,
    objectKey: row.object_key,
  };
}

/**
 * The attachment as a client sees it: the metadata plus the API's private media paths.
 *
 * A picture answers with both its full and its thumbnail path; a document or a recording
 * answers with the single object it was stored as (`thumbnailUrl` stays null). Nothing here
 * uses the bucket's public address, and no object key leaves the server: chat media is served
 * by `GET /chat/attachments/<id>/media`, which authorizes the caller for the conversation
 * first. Each app resolves the path against its own authenticated proxy.
 */
export function withAttachmentUrls(
  attachment: StoredAttachment,
  _publicBaseUrl?: string,
): ChatAttachment {
  const isPicture = attachment.contentType.startsWith('image/');

  return {
    id: attachment.id,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    byteSize: attachment.byteSize,
    width: attachment.width,
    height: attachment.height,
    durationMs: attachment.durationMs ?? null,
    url: `/chat/attachments/${attachment.id}/media`,
    thumbnailUrl: isPicture ? `/chat/attachments/${attachment.id}/media?variant=thumb` : null,
  };
}

/** The same, for a list. */
export function withAttachmentUrlsOf(
  attachments: readonly StoredAttachment[],
  publicBaseUrl?: string,
): ChatAttachment[] {
  return attachments.map((attachment) => withAttachmentUrls(attachment, publicBaseUrl));
}
