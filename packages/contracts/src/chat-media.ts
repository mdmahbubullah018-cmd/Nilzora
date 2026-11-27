import { z } from 'zod';

/*
 * Chat media
 * ----------
 * What a chat message may carry, and how much of it. Three kinds, each with its own limits:
 *
 *   image    — a picture. The server decodes it, turns it upright, strips metadata, resizes it
 *              and re-encodes it as WebP, so what reaches storage is never the bytes a browser
 *              sent. Only the formats the pipeline can decode and re-encode are accepted.
 *   document — a business file (PDF, plain text, CSV, Word, Excel). Never parsed, rendered or
 *              executed on the server: it is checked by signature and stored as-is.
 *   audio    — a voice message. Also stored as-is, with its duration recorded.
 *
 * The allowlists are closed on purpose. A type that is not here is refused by the API and, for
 * non-image kinds, by the database as well, so an executable or an archive cannot be smuggled in
 * by inventing a Content-Type. Size limits are per kind because a 20 MB spreadsheet is ordinary
 * while a 20 MB picture is not.
 */

export const CHAT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const CHAT_DOCUMENT_TYPES = [
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;
export const CHAT_AUDIO_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
] as const;

export const CHAT_MEDIA_KINDS = ['image', 'document', 'audio'] as const;
export type ChatMediaKind = (typeof CHAT_MEDIA_KINDS)[number];

/** Every Content-Type a message may carry. The database holds the same list. */
export const CHAT_ATTACHMENT_TYPES = [
  ...CHAT_IMAGE_TYPES,
  ...CHAT_DOCUMENT_TYPES,
  ...CHAT_AUDIO_TYPES,
] as const;
export type ChatAttachmentType = (typeof CHAT_ATTACHMENT_TYPES)[number];
export const chatAttachmentTypeSchema = z.enum(CHAT_ATTACHMENT_TYPES);

/** A picture: the processed WebP is a fraction of this, so 10 MB of input is generous. */
export const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** A document is stored as sent, so the ceiling is higher — and still enforced everywhere. */
export const CHAT_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;
/** A voice message: five minutes of a compressed codec fits comfortably. */
export const CHAT_AUDIO_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_AUDIO_MAX_DURATION_MS = 5 * 60 * 1000;

/** The largest a single upload may be, whichever kind it turns out to be. */
export const CHAT_ATTACHMENT_MAX_BYTES = CHAT_DOCUMENT_MAX_BYTES;
export const CHAT_ATTACHMENT_MAX_PER_MESSAGE = 5;

const KIND_BY_TYPE: ReadonlyMap<string, ChatMediaKind> = new Map([
  ...CHAT_IMAGE_TYPES.map((type) => [type, 'image'] as const),
  ...CHAT_DOCUMENT_TYPES.map((type) => [type, 'document'] as const),
  ...CHAT_AUDIO_TYPES.map((type) => [type, 'audio'] as const),
]);

/** The kind a Content-Type belongs to, or null when it is not on the allowlist. */
export function chatMediaKindOf(contentType: string): ChatMediaKind | null {
  return KIND_BY_TYPE.get(contentType.split(';')[0]?.trim().toLowerCase() ?? '') ?? null;
}

export function chatMediaMaxBytes(kind: ChatMediaKind): number {
  if (kind === 'image') return CHAT_IMAGE_MAX_BYTES;
  if (kind === 'audio') return CHAT_AUDIO_MAX_BYTES;
  return CHAT_DOCUMENT_MAX_BYTES;
}

/** For a message a person reads: "10 MB", never a byte count. */
export function chatMediaMaxLabel(kind: ChatMediaKind): string {
  return `${Math.round(chatMediaMaxBytes(kind) / (1024 * 1024))} MB`;
}

/** The extension the browser should see for a stored file, from the allowlist only. */
const EXTENSION_BY_TYPE: ReadonlyMap<string, string> = new Map([
  // A picture is always re-encoded as WebP before storage, so that is the name it gets.
  ['image/jpeg', '.webp'],
  ['image/png', '.webp'],
  ['image/webp', '.webp'],
  ['application/pdf', '.pdf'],
  ['text/plain', '.txt'],
  ['text/csv', '.csv'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['audio/webm', '.webm'],
  ['audio/ogg', '.ogg'],
  ['audio/mp4', '.m4a'],
  ['audio/mpeg', '.mp3'],
  ['audio/wav', '.wav'],
]);

/**
 * A display name that is safe everywhere it is used: no path separators, no control characters,
 * no leading dots (a `.htaccess`-style name), at most 120 characters, and an extension that
 * matches the type the server actually stored. The stored object key never contains this value —
 * it is a label only — but it still ends up in a download's `Content-Disposition`, so it is
 * cleaned here rather than at each call site.
 */
export function sanitizeChatFileName(name: string, contentType: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    // eslint-disable-next-line no-control-regex -- deliberately matching control characters
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\s]+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  const extension = EXTENSION_BY_TYPE.get(contentType.split(';')[0]?.trim().toLowerCase() ?? '');
  const withoutExtension =
    extension === undefined ? cleaned : cleaned.replace(/\.[A-Za-z0-9]{1,8}$/, '');
  const stem = withoutExtension.slice(0, 100).trim() || 'file';
  return `${stem}${extension ?? ''}`.slice(0, 120);
}

/** The message attached to a refusal, per kind. */
export function chatMediaRejection(kind: ChatMediaKind, contentType: string): string {
  if (kind === 'image') return 'Attach a JPEG, PNG or WebP picture.';
  if (kind === 'audio') return 'Attach a voice recording.';
  return `Attach a PDF, TXT, CSV, DOCX or XLSX file (not ${contentType || 'that type'}).`;
}
