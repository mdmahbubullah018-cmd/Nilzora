import {
  POPUP_ANIMATED_KEY,
  POPUP_ARTWORK_CONTENT_TYPES,
  POPUP_ARTWORK_MAX_BYTES,
  POPUP_ARTWORK_MAX_SIZE,
  POPUP_ARTWORK_MIN_SIZE,
  POPUP_STILL_KEY,
} from '@nilzora/contracts';
import type { RequestHandler, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import sharp, { type Metadata } from 'sharp';
import { sendError } from '../../http/send-error';
import { StoreUnavailableError } from '../commerce/errors';
import { IMAGE_CACHE_CONTROL, type MediaStorage } from '../media/object-store';
import { ImageRejectedError, processProductImage } from '../media/pipeline';
import { rawImageBody } from '../media/upload';

/*
 * Popup artwork
 * -------------
 * A popup's picture is either *designed* around copy (a still photograph or illustration) or a
 * *complete* piece of artwork an admin uploaded — which is very often an animated GIF.
 *
 * The shared picture pipeline re-encodes everything to WebP and refuses animation outright,
 * because a product photo has no business being an eight-megabyte animation. A popup's artwork
 * is the opposite case, so this module keeps two deliberate paths:
 *
 *   still     JPEG, PNG or WebP that is not animated → the shared pipeline: orientation applied,
 *             metadata stripped, capped at 1600 px, stored as WebP with a thumbnail beside it.
 *   animated  a GIF with more than one frame (or a still file an admin wants untouched) → the
 *             bytes are stored exactly as uploaded under `<prefix>/<random>.<ext>`, because any
 *             re-encode would silently freeze the animation.
 *
 * Both paths read the bytes themselves. A declared Content-Type is checked, but the actual
 * format is decided by what the file contains, so a renamed file cannot slip through and a
 * stored key always tells the truth about what is behind it.
 */

const EXTENSIONS = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif' } as const;
type ArtworkFormat = keyof typeof EXTENSIONS;

const STILL_FORMATS = new Set<ArtworkFormat>(['jpeg', 'png', 'webp']);

/** Refuses anything that is not one of the four accepted popup types, before the body is read. */
export const popupArtworkContentType: RequestHandler = (req, res, next) => {
  const type = (req.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!(POPUP_ARTWORK_CONTENT_TYPES as readonly string[]).includes(type)) {
    sendError(res, 415, 'unsupported_media_type', 'Upload a JPEG, PNG, WebP or GIF picture');
    return;
  }
  next();
};

/** Reads the raw popup body, capped at the shared picture maximum (5 MB). */
export const readPopupArtworkBody: RequestHandler = rawImageBody(POPUP_ARTWORK_MAX_BYTES);

/** What a stored piece of popup artwork is, for the record and for the frame. */
export interface StoredPopupArtwork {
  key: string;
  kind: 'still' | 'animated';
  width: number;
  height: number;
  bytes: number;
  format: ArtworkFormat;
}

/**
 * The format as the file itself declares it. `sharp().metadata()` decodes the header, which is
 * what makes a renamed file (a GIF called `.png`) impossible to smuggle in.
 */
async function readHeader(bytes: Buffer): Promise<{
  format: ArtworkFormat;
  width: number;
  height: number;
  pages: number;
}> {
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, { limitInputPixels: POPUP_ARTWORK_MAX_SIZE ** 2 }).metadata();
  } catch {
    throw new ImageRejectedError('corrupt');
  }
  const format = metadata.format as ArtworkFormat | undefined;
  if (format === undefined || !(format in EXTENSIONS)) {
    throw new ImageRejectedError('unsupported_format');
  }
  const { width, height } = metadata;
  if (!width || !height) throw new ImageRejectedError('corrupt');
  return { format, width, height, pages: metadata.pages ?? 1 };
}

/** The message a rejected upload shows, per refusal reason. */
function refusalMessage(reason: ImageRejectedError['reason']): string {
  switch (reason) {
    case 'unsupported_format':
      return 'Upload a JPEG, PNG, WebP or GIF picture';
    case 'corrupt':
      return 'The picture could not be read';
    case 'too_small':
      return `The picture is too small: use at least ${String(POPUP_ARTWORK_MIN_SIZE)} pixels on the shorter side`;
    case 'too_large':
      return `The picture is too large: use at most ${String(POPUP_ARTWORK_MAX_SIZE)} pixels on the longer side`;
    case 'animated':
      // Not a refusal here: animation is the reason this path exists. Kept for completeness.
      return 'Animated pictures are supported';
  }
}

export interface PopupArtworkUploads {
  /**
   * Validates one uploaded picture and stores it under `popups/<popupId>/…`. Returns what was
   * stored, or null after answering the request with the reason it was refused.
   */
  store: (received: unknown, res: Response, popupId: string) => Promise<StoredPopupArtwork | null>;
  /**
   * Deletes the objects behind one recorded key. A still has two variants beside its base key;
   * an animated file is one object. An unknown shape is left alone (it was never ours).
   */
  remove: (key: string | null, res: Response) => Promise<void>;
}

export function createPopupArtworkUploads(
  storage: MediaStorage | undefined,
  logger?: Logger,
): PopupArtworkUploads {
  async function remove(key: string | null, res: Response): Promise<void> {
    if (key === null || !storage) return;
    // A still was written as two variants beside its base key; an animated file is one object.
    // Anything that matches neither shape was never stored by this module, so it is left alone.
    const targets = POPUP_STILL_KEY.test(key)
      ? [`${key}/full.webp`, `${key}/thumb.webp`]
      : POPUP_ANIMATED_KEY.test(key)
        ? [key]
        : [];
    if (targets.length === 0) return;
    try {
      await storage.objects.deleteMany(targets);
    } catch (error) {
      (res.req.log ?? logger)?.warn({ err: error, key }, 'Popup artwork not deleted');
    }
  }

  return {
    async store(received, res, popupId) {
      if (!storage) throw new Error('Upload reached without storage');
      if (!Buffer.isBuffer(received) || received.length === 0) {
        sendError(res, 400, 'bad_request', 'Send the picture as the request body');
        return null;
      }
      if (received.length > POPUP_ARTWORK_MAX_BYTES) {
        sendError(res, 400, 'image_invalid', refusalMessage('too_large'), {
          reason: 'too_large',
        });
        return null;
      }

      let header: Awaited<ReturnType<typeof readHeader>>;
      try {
        header = await readHeader(received);
      } catch (error) {
        if (error instanceof ImageRejectedError) {
          sendError(res, 400, 'image_invalid', refusalMessage(error.reason), {
            reason: error.reason,
          });
          return null;
        }
        throw error;
      }

      if (Math.min(header.width, header.height) < POPUP_ARTWORK_MIN_SIZE) {
        sendError(res, 400, 'image_invalid', refusalMessage('too_small'), { reason: 'too_small' });
        return null;
      }
      if (Math.max(header.width, header.height) > POPUP_ARTWORK_MAX_SIZE) {
        sendError(res, 400, 'image_invalid', refusalMessage('too_large'), { reason: 'too_large' });
        return null;
      }

      // An animated GIF is kept as it is. Every still goes through the shared pipeline, which
      // also guarantees the stored file really is WebP and carries no metadata.
      if (header.format === 'gif' || header.pages > 1) {
        if (header.format !== 'gif') {
          // Only a GIF may be animated in this store; anything else claiming frames is refused.
          sendError(res, 400, 'image_invalid', refusalMessage('unsupported_format'), {
            reason: 'unsupported_format',
          });
          return null;
        }
        const key = `popups/${popupId}/${randomUUID()}.${EXTENSIONS.gif}`;
        try {
          await storage.objects.put({
            key,
            body: received,
            contentType: 'image/gif',
            cacheControl: IMAGE_CACHE_CONTROL,
          });
        } catch (error) {
          logger?.warn({ err: error, popupId }, 'Popup artwork could not be stored');
          throw new StoreUnavailableError('the popup artwork could not be stored');
        }
        return {
          key,
          kind: 'animated',
          width: header.width,
          height: header.height,
          bytes: received.length,
          format: 'gif',
        };
      }

      if (STILL_FORMATS.has(header.format) === false) {
        sendError(res, 400, 'image_invalid', refusalMessage('unsupported_format'), {
          reason: 'unsupported_format',
        });
        return null;
      }

      const baseKey = `popups/${popupId}/${randomUUID()}`;
      try {
        const processed = await processProductImage(received, {
          minSize: POPUP_ARTWORK_MIN_SIZE,
          fullMax: 1600,
        });
        await Promise.all([
          storage.objects.put({
            key: `${baseKey}/full.webp`,
            body: processed.full.data,
            contentType: 'image/webp',
            cacheControl: IMAGE_CACHE_CONTROL,
          }),
          storage.objects.put({
            key: `${baseKey}/thumb.webp`,
            body: processed.thumb.data,
            contentType: 'image/webp',
            cacheControl: IMAGE_CACHE_CONTROL,
          }),
        ]);
        return {
          key: baseKey,
          kind: 'still',
          width: processed.full.width,
          height: processed.full.height,
          bytes: processed.full.data.length,
          format: 'webp',
        };
      } catch (error) {
        if (error instanceof ImageRejectedError) {
          sendError(res, 400, 'image_invalid', refusalMessage(error.reason), {
            reason: error.reason,
          });
          return null;
        }
        logger?.warn({ err: error, popupId }, 'Popup artwork could not be stored');
        await remove(baseKey, res);
        throw error instanceof StoreUnavailableError
          ? error
          : new StoreUnavailableError('the popup artwork could not be stored');
      }
    },

    remove,
  };
}
