import {
  CHAT_DOCUMENT_MAX_BYTES,
  chatMediaKindOf,
  chatMediaMaxBytes,
  sanitizeChatFileName,
  type ChatMediaKind,
} from '@nilzora/contracts';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { sendError } from '../../http/send-error';
import { StoreUnavailableError } from '../commerce/errors';
import { IMAGE_CACHE_CONTROL, type MediaStorage } from '../media/object-store';
import { ImageRejectedError, processProductImage } from '../media/pipeline';

/*
 * What a chat message may carry
 * -----------------------------
 * One pipeline, three kinds. A picture is decoded, turned upright, stripped of its metadata,
 * resized and re-encoded as WebP, so the bytes in Cloudflare R2 are always something this
 * server produced. A document or a voice recording is stored exactly as sent, because
 * re-encoding a PDF or a recording would corrupt it; those are accepted only if the signature
 * in their first bytes matches an allowlisted type, and their names are cleaned before storage
 * (an uploaded name reaches a download's Content-Disposition, so it is treated as untrusted).
 *
 * Nothing here decides who may upload: the route authenticates the caller and the database
 * function checks conversation membership and reply rights. This module only answers what the
 * bytes are, whether they are the type they claim, and where they may live.
 */

/** What a document or recording starts with, by the type we accept it as. */
const SIGNATURES: Readonly<Record<string, (body: Buffer) => boolean>> = {
  'application/pdf': (body) => body.subarray(0, 5).toString('latin1') === '%PDF-',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': isZipContainer,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': isZipContainer,
  'audio/webm': (body) => hasAt(body, 'matroska', 0, 64) || hasEbmlHeader(body),
  'audio/ogg': (body) => body.subarray(0, 4).toString('latin1') === 'OggS',
  'audio/mp4': (body) => hasAt(body, 'ftyp', 4, 8),
  'audio/mpeg': (body) => isMp3(body),
  'audio/wav': (body) => hasAt(body, 'WAVE', 8, 12) && hasAt(body, 'RIFF', 0, 4),
};

/** A DOCX or XLSX is a ZIP archive: "PK" plus a local-file or empty-archive header. */
function isZipContainer(body: Buffer): boolean {
  if (body.length < 4) return false;
  const first = body[0];
  const second = body[1];
  return first === 0x50 && second === 0x4b && (body[2] === 0x03 || body[2] === 0x05);
}

function hasAt(body: Buffer, text: string, from: number, to: number): boolean {
  const limit = Math.min(body.length, to);
  return body.subarray(from, limit).includes(text, 0, 'latin1');
}

/** WebM/Matroska files begin with the EBML magic 0x1A45DFA3. */
function hasEbmlHeader(body: Buffer): boolean {
  return (
    body.length >= 4 && body[0] === 0x1a && body[1] === 0x45 && body[2] === 0xdf && body[3] === 0xa3
  );
}

function isMp3(body: Buffer): boolean {
  if (hasAt(body, 'ID3', 0, 3)) return true;
  return body.length >= 2 && body[0] === 0xff && (body[1] ?? 0) >= 0xe0;
}

/**
 * Text is the one type with no signature of its own. It is accepted when the bytes decode as
 * UTF-8, carry no NUL, and do not begin with a known binary container — otherwise a PDF or a
 * spreadsheet could be labelled `text/plain` to slip past the allowlist and be shown as text.
 */
function isPlainText(body: Buffer): boolean {
  if (body.includes(0)) return false;
  const head = body.subarray(0, 8).toString('latin1');
  const binaryPrefixes = ['%PDF-', 'PK\u0003', 'PK\u0005', 'RIFF', 'OggS', '\u001aEß£'];
  if (binaryPrefixes.some((prefix) => head.startsWith(prefix))) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(body);
    return true;
  } catch {
    return false;
  }
}

/** True when the bytes are plausibly the type they claim to be. */
export function contentMatchesType(body: Buffer, contentType: string): boolean {
  if (contentType === 'text/plain' || contentType === 'text/csv') return isPlainText(body);
  if (contentType === 'image/jpeg') return body[0] === 0xff && body[1] === 0xd8;
  if (contentType === 'image/png') return body.subarray(0, 8).equals(PNG_MAGIC);
  if (contentType === 'image/webp') {
    return hasAt(body, 'RIFF', 0, 4) && hasAt(body, 'WEBP', 8, 12);
  }
  return SIGNATURES[contentType]?.(body) ?? false;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The longest a value may be, from the limits module, so the reader cannot be oversized. */
export const CHAT_UPLOAD_MAX_BYTES = CHAT_DOCUMENT_MAX_BYTES;

export interface StoredChatAttachment {
  objectKey: string;
  contentType: string;
  byteSize: number;
  fileName: string;
  width: number | null;
  height: number | null;
}

export interface ChatAttachmentUploads {
  /** Stores one upload under `chat/<conversationId>/`, or answers the refusal and returns null. */
  store(
    received: unknown,
    res: Response,
    conversationId: string,
    request: { contentType: string; fileName: string },
  ): Promise<StoredChatAttachment | null>;
  /** Removes the two variants (or the single object) of a key this module produced. */
  remove(objectKey: string | null, res: Response): Promise<void>;
  /** The key names written for one base key: two for a picture, one for anything else. */
  keysFor(baseKey: string, contentType: string): string[];
}

export function createChatAttachmentUploads(
  storage: MediaStorage | undefined,
  logger?: Logger,
): ChatAttachmentUploads {
  function keysFor(baseKey: string, contentType: string): string[] {
    // A picture is stored as `<key>/full.webp` and `<key>/thumb.webp` by the shared pipeline;
    // every other file keeps the single key the pipeline was given.
    return chatMediaKindOf(contentType) === 'image'
      ? [`${baseKey}/full.webp`, `${baseKey}/thumb.webp`]
      : [`${baseKey}/${randomUUID()}`];
  }

  async function remove(objectKey: string | null, res: Response): Promise<void> {
    if (objectKey === null || !storage) return;
    const keys =
      objectKey.includes('/full.webp') || objectKey.includes('/thumb.webp')
        ? [
            objectKey.replace(/\/thumb\.webp$/, '/full.webp'),
            objectKey.replace(/\/full\.webp$/, '/thumb.webp'),
          ]
        : [objectKey];
    try {
      await storage.objects.deleteMany([...new Set(keys)]);
    } catch (error) {
      (res.req.log ?? logger)?.warn({ err: error, key: objectKey }, 'Chat attachment not deleted');
    }
  }

  async function store(
    received: unknown,
    res: Response,
    conversationId: string,
    request: { contentType: string; fileName: string },
  ): Promise<StoredChatAttachment | null> {
    if (!storage) throw new Error('Upload reached without storage');
    const kind = chatMediaKindOf(request.contentType);
    if (kind === null) {
      sendError(res, 415, 'unsupported_media_type', 'This file type cannot be attached.');
      return null;
    }
    if (!Buffer.isBuffer(received) || received.length === 0) {
      sendError(res, 400, 'bad_request', 'Send the file as the request body');
      return null;
    }
    if (received.length > chatMediaMaxBytes(kind)) {
      sendError(res, 413, 'payload_too_large', 'That file is too large to attach.');
      return null;
    }
    if (!contentMatchesType(received, request.contentType)) {
      sendError(res, 400, 'image_invalid', 'That file does not match its type.', {
        reason: 'signature_mismatch',
      });
      return null;
    }

    const fileName = sanitizeChatFileName(request.fileName, request.contentType);
    const baseKey = `chat/${conversationId}/${randomUUID()}`;

    if (kind === 'image') {
      let processed;
      try {
        processed = await processProductImage(received, { minSize: CHAT_IMAGE_MIN_SIZE });
      } catch (error) {
        if (error instanceof ImageRejectedError) {
          sendError(res, 400, 'image_invalid', REJECTIONS[error.reason], { reason: error.reason });
          return null;
        }
        throw error;
      }
      const fullKey = `${baseKey}/full.webp`;
      const thumbKey = `${baseKey}/thumb.webp`;
      try {
        await Promise.all([
          storage.objects.put({
            key: fullKey,
            body: processed.full.data,
            contentType: 'image/webp',
            cacheControl: IMAGE_CACHE_CONTROL,
          }),
          storage.objects.put({
            key: thumbKey,
            body: processed.thumb.data,
            contentType: 'image/webp',
            cacheControl: IMAGE_CACHE_CONTROL,
          }),
        ]);
      } catch (error) {
        await remove(fullKey, res);
        throw new StoreUnavailableError('chat attachment could not be stored', { cause: error });
      }
      return {
        objectKey: `${baseKey}/full.webp`,
        contentType: 'image/webp',
        byteSize: processed.full.data.length,
        fileName,
        width: processed.full.width,
        height: processed.full.height,
      };
    }

    const objectKey = `${baseKey}/${randomUUID()}`;
    try {
      await storage.objects.put({
        key: objectKey,
        body: received,
        contentType: request.contentType,
        // A private document may be replaced by the same key never; it never changes, so cache.
        cacheControl: IMAGE_CACHE_CONTROL,
      });
    } catch (error) {
      throw new StoreUnavailableError('chat attachment could not be stored', { cause: error });
    }
    return {
      objectKey,
      contentType: request.contentType,
      byteSize: received.length,
      fileName,
      width: null,
      height: null,
    };
  }

  return { store, remove, keysFor };
}

/**
 * A chat picture is often a screenshot or a crop, so the product-photo minimum (400 px) does not
 * apply: only a picture too tiny to be seen is refused. The largest side, the formats and the
 * refusal of animated pictures are the shared pipeline's and stay as they are.
 */
export const CHAT_IMAGE_MIN_SIZE = 16;

const REJECTIONS: Readonly<Record<ImageRejectedError['reason'], string>> = {
  unsupported_format: 'Attach a JPEG, PNG or WebP picture.',
  corrupt: 'This picture could not be read. Choose another.',
  animated: 'Animated pictures are not supported. Choose a still picture.',
  too_small: `This picture is too small. Use one at least ${CHAT_IMAGE_MIN_SIZE} pixels on its shorter side.`,
  too_large: 'This picture is too large. Use one at most 8000 pixels on its longer side.',
};

/** The body ceiling for one upload, by the type the request claims. */
export function chatUploadLimit(contentType: string): number {
  const kind: ChatMediaKind | null = chatMediaKindOf(contentType);
  return kind === null ? CHAT_DOCUMENT_MAX_BYTES : chatMediaMaxBytes(kind);
}
