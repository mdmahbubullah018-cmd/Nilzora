import {
  PRODUCT_IMAGE_CONTENT_TYPES,
  AVATAR_MAX_BYTES,
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_MIN_SIZE,
} from '@nilzora/contracts';
import express, { type RequestHandler, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { sendError } from '../../http/send-error';
import { StoreUnavailableError } from '../commerce/errors';
import { variantKeys } from './images';
import {
  ImageRejectedError,
  processProductImage,
  type ImageProcessingOptions,
  type ProcessedImage,
} from './pipeline';
import { IMAGE_CACHE_CONTROL, type MediaStorage } from './object-store';

/**
 * The one picture-upload path shared by every entity that owns images (products,
 * categories, brands, banners). A caller supplies the object-key prefix; the base key
 * is always a fresh UUID, so a client filename never reaches storage.
 */

const ALLOWED_TYPES: readonly string[] = PRODUCT_IMAGE_CONTENT_TYPES;

function rejections(minSize: number): Readonly<Record<ImageRejectedError['reason'], string>> {
  return {
    unsupported_format: 'Upload a JPEG, PNG or WebP picture',
    corrupt: 'The image could not be read',
    animated: 'Animated images are not supported',
    too_small: `The image is too small: use at least ${minSize} pixels on the shorter side`,
    too_large: 'The image is too large: use at most 8000 pixels on the longer side',
  };
}

/** Refuses anything that is not a JPEG, PNG or WebP before the body is read. */
export const imageContentType: RequestHandler = (req, res, next) => {
  const type = (req.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!ALLOWED_TYPES.includes(type)) {
    sendError(res, 415, 'unsupported_media_type', 'Upload a JPEG, PNG or WebP image');
    return;
  }
  next();
};

/** Reads a raw picture body, capped at `limit` bytes. */
export function rawImageBody(limit: number): RequestHandler {
  return express.raw({ type: () => true, limit });
}

/** Reads the raw picture body, capped at the shared picture maximum. */
export const readImageBody = rawImageBody(PRODUCT_IMAGE_MAX_BYTES);

/** Reads an avatar body, capped smaller: a profile picture is only ever shown small. */
export const readAvatarBody = rawImageBody(AVATAR_MAX_BYTES);

/** 503 when media storage is not configured on this server. */
export function requireStorage(storage: MediaStorage | undefined): RequestHandler {
  return (_req, res, next) => {
    if (storage) next();
    else sendError(res, 503, 'media_unavailable', 'Image uploads are not available right now');
  };
}

/** A stored picture's key and the size of its full variant (for records that keep dimensions). */
export interface StoredPicture {
  key: string;
  width: number;
  height: number;
  /** Size of the stored full-size file. */
  bytes: number;
}

export interface PictureUploads {
  storePicture: (
    received: unknown,
    res: Response,
    prefix: string,
    options?: ImageProcessingOptions,
  ) => Promise<string | null>;
  /** Like storePicture, but also reports the stored dimensions. */
  storePictureWithSize: (
    received: unknown,
    res: Response,
    prefix: string,
    options?: ImageProcessingOptions,
  ) => Promise<StoredPicture | null>;
  /**
   * Stores the picture at an exact base key the caller already chose (product images key
   * themselves by product and image id), so the put/rollback rules live in one place.
   */
  storePictureAtBaseKey: (
    received: unknown,
    res: Response,
    baseKey: string,
    options?: ImageProcessingOptions,
  ) => Promise<StoredPicture | null>;
  removePicture: (baseKey: string | null, res: Response) => Promise<void>;
}

export function createPictureUploads(
  storage: MediaStorage | undefined,
  logger?: Logger,
): PictureUploads {
  async function removePicture(baseKey: string | null, res: Response): Promise<void> {
    if (baseKey === null || !storage) return;
    try {
      await storage.objects.deleteMany(variantKeys(baseKey));
    } catch (error) {
      (res.req.log ?? logger)?.warn({ err: error, key: baseKey }, 'Picture objects not deleted');
    }
  }

  async function storePictureAtBaseKey(
    received: unknown,
    res: Response,
    baseKey: string,
    options: ImageProcessingOptions = {},
  ): Promise<StoredPicture | null> {
    if (!storage) throw new Error('Upload reached without storage');
    if (!Buffer.isBuffer(received) || received.length === 0) {
      sendError(res, 400, 'bad_request', 'Send the image as the request body');
      return null;
    }
    let processed: ProcessedImage;
    try {
      processed = await processProductImage(received, options);
    } catch (error) {
      if (error instanceof ImageRejectedError) {
        sendError(
          res,
          400,
          'image_invalid',
          rejections(options.minSize ?? PRODUCT_IMAGE_MIN_SIZE)[error.reason],
          {
            reason: error.reason,
          },
        );
        return null;
      }
      throw error;
    }
    const [fullKey, thumbKey] = variantKeys(baseKey);
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
      await removePicture(baseKey, res);
      throw new StoreUnavailableError('picture objects could not be stored', { cause: error });
    }
    return {
      key: baseKey,
      width: processed.full.width,
      height: processed.full.height,
      bytes: processed.full.data.length,
    };
  }

  async function storePictureWithSize(
    received: unknown,
    res: Response,
    prefix: string,
    options?: ImageProcessingOptions,
  ): Promise<StoredPicture | null> {
    return storePictureAtBaseKey(received, res, `${prefix}/${randomUUID()}`, options);
  }

  async function storePicture(
    received: unknown,
    res: Response,
    prefix: string,
    options?: ImageProcessingOptions,
  ): Promise<string | null> {
    const stored = await storePictureWithSize(received, res, prefix, options);
    return stored === null ? null : stored.key;
  }

  return { storePicture, storePictureWithSize, storePictureAtBaseKey, removePicture };
}
