import {
  IMAGE_SEARCH_MAX_UPLOAD_BYTES,
  IMAGE_SEARCH_MIN_UPLOAD_BYTES,
  imageSearchClickRequestSchema,
  imageSearchQuerySchema,
  imageSearchResponseSchema,
  imageSearchSimilarRequestSchema,
  scanResolveRequestSchema,
  scanResolveResponseSchema,
} from '@nilzora/contracts';
import Busboy from 'busboy';

import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { Logger } from 'pino';
import { sendError } from '../../http/send-error';
import type { RequestHandler as Handler } from 'express';
import { noStore } from '../commerce/http';
import type { CatalogStore } from '../catalog/store';
import { IMAGE_REJECTION_MESSAGE, ImageInputError } from './image-input';
import {
  ImageSearchDisabledError,
  ImageSearchNoIndexError,
  ImageSearchUnavailableError,
  type ImageSearchService,
} from './service';

/*
 * Customer-facing visual search
 * -----------------------------
 * Three routes, all public (searching a product catalogue has never needed an account) and
 * all mounted behind the deployment's general rate limit:
 *
 *   POST /search/image         the search itself. multipart/form-data with a `file` part, or
 *                              a raw image body with an image/* content type.
 *   POST /search/image/similar the same search, seeded with a picture the store already
 *                              holds ("Find similar" on a product page). No upload, no model
 *                              call: the stored vector is used.
 *   POST /search/image/click   which result was opened, recorded against the search id.
 *   POST /scan/resolve         a decoded QR code or barcode, resolved to a product or to a
 *                              search phrase. Shared by the camera's Scan mode.
 *
 * The uploaded photograph is never written anywhere: it is read into memory, prepared by
 * sharp and handed to the model. Only its SHA-256 reaches the log.
 */

export interface ImageSearchRouteDependencies {
  service: ImageSearchService;
  catalog: CatalogStore;
  /** Per-address limit for the search route (the brief's 20 requests a minute). */
  limiter: RequestHandler;
  logger: Pick<Logger, 'warn' | 'error'>;
}

/** Reads one image from a multipart body, capped. */
function readMultipartImage(req: Request, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    let busboy: Busboy.Busboy;
    try {
      busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: limit, fields: 6, parts: 8 } });
    } catch {
      fail(new ImageUploadError('unsupported_format'));
      return;
    }

    let received: Buffer | null = null;
    let tooLarge = false;

    busboy.on('file', (_field, stream) => {
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size <= limit) chunks.push(chunk);
      });
      stream.on('limit', () => {
        tooLarge = true;
      });
      stream.on('end', () => {
        if (!tooLarge && received === null) received = Buffer.concat(chunks);
      });
      stream.on('error', () => fail(new ImageUploadError('corrupt')));
    });
    busboy.on('error', () => fail(new ImageUploadError('corrupt')));
    busboy.on('close', () => {
      if (settled) return;
      if (tooLarge) {
        fail(new ImageUploadError('too_large'));
        return;
      }
      if (received === null) {
        fail(new ImageUploadError('empty'));
        return;
      }
      settled = true;
      resolve(received);
    });
    req.pipe(busboy);
  });
}

/** Reads a raw image body (an app talking to the API directly, without form encoding). */
function readRawImage(req: Request, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        if (!settled) {
          settled = true;
          reject(new ImageUploadError('too_large'));
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const body = Buffer.concat(chunks);
      if (body.length < IMAGE_SEARCH_MIN_UPLOAD_BYTES) reject(new ImageUploadError('empty'));
      else resolve(body);
    });
    req.on('error', () => reject(new ImageUploadError('corrupt')));
  });
}

/** A refusal about the uploaded bytes, mapped to a 400 with a fixed message. */
class ImageUploadError extends Error {
  override readonly name = 'ImageUploadError';
  readonly reason: keyof typeof IMAGE_REJECTION_MESSAGE;

  constructor(reason: keyof typeof IMAGE_REJECTION_MESSAGE) {
    super(IMAGE_REJECTION_MESSAGE[reason]);
    this.reason = reason;
  }
}

const IMAGE_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

async function readUploadedImage(req: Request): Promise<Buffer> {
  const type = (req.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (type === 'multipart/form-data') {
    return readMultipartImage(req, IMAGE_SEARCH_MAX_UPLOAD_BYTES);
  }
  if (IMAGE_CONTENT_TYPES.has(type) || type === 'application/octet-stream') {
    return readRawImage(req, IMAGE_SEARCH_MAX_UPLOAD_BYTES);
  }
  throw new ImageUploadError('unsupported_format');
}

export function imageSearchRoutes(deps: ImageSearchRouteDependencies): Router {
  const router = Router();
  const { service, catalog, logger } = deps;

  /** Every refusal this feature can raise, answered in one place. */
  function answerFailure(res: Response, error: unknown): void {
    if (error instanceof ImageUploadError) {
      sendError(res, 400, 'image_invalid', error.message, { reason: error.reason });
      return;
    }
    if (error instanceof ImageInputError) {
      const status = error.reason === 'too_large' ? 413 : 400;
      sendError(res, status, error.reason === 'too_large' ? 'payload_too_large' : 'image_invalid', error.message, {
        reason: error.reason,
      });
      return;
    }
    if (error instanceof ImageSearchDisabledError) {
      sendError(res, 503, 'image_search_disabled', 'Image search is not available right now');
      return;
    }
    if (error instanceof ImageSearchNoIndexError) {
      sendError(
        res,
        503,
        'image_search_unavailable',
        'Image search is still being prepared. Try again shortly.',
      );
      return;
    }
    if (error instanceof ImageSearchUnavailableError) {
      sendError(res, 503, 'image_search_unavailable', 'Image search is not available right now');
      return;
    }
    logger.error(
      { err: { name: error instanceof Error ? error.name : 'UnknownError' } },
      'image search failed',
    );
    sendError(res, 503, 'service_unavailable', 'Image search could not answer. Try again.');
  }


  router.post('/search/image', deps.limiter, noStore, async (req, res) => {
    try {
      // Sort and paging come from the query string on both content types, so a multipart
      // body carries only the picture.
      const query = imageSearchQuerySchema.parse(req.query);
      const image = await readUploadedImage(req);
      const answer = await service.search({ image, ...query });
      res.json(imageSearchResponseSchema.parse(answer));
    } catch (error) {
      answerFailure(res, error);
    }
  });

  router.post('/search/image/similar', deps.limiter, noStore, async (req, res) => {
    try {
      const query = imageSearchQuerySchema.parse(req.query);
      const body = imageSearchSimilarRequestSchema.safeParse(req.body);
      if (!body.success) {
        sendError(res, 400, 'validation_failed', 'The request is invalid', {
          issues: body.error.issues.slice(0, 20).map((issue) => ({
            location: 'body',
            path: issue.path.map(String).join('.'),
            message: issue.message,
          })),
        });
        return;
      }
      const answer = await service.searchSimilar({
        productId: body.data.productId,
        imageId: body.data.imageId ?? null,
        ...query,
      });
      res.json(imageSearchResponseSchema.parse(answer));
    } catch (error) {
      answerFailure(res, error);
    }
  });

  router.post('/search/image/click', noStore, async (req, res) => {
    const body = imageSearchClickRequestSchema.safeParse(req.body);
    if (!body.success) {
      sendError(res, 400, 'validation_failed', 'The request is invalid');
      return;
    }
    try {
      const recorded = await service.recordClick(body.data.searchId, body.data.productId);
      res.json({ recorded });
    } catch (error) {
      // Feedback is never allowed to surface as an error to a shopper.
      logger.warn(
        { err: { name: error instanceof Error ? error.name : 'UnknownError' } },
        'image search click was not recorded',
      );
      res.json({ recorded: false });
    }
  });

  router.post('/scan/resolve', noStore, async (req, res) => {
    const body = scanResolveRequestSchema.safeParse(req.body);
    if (!body.success) {
      sendError(res, 400, 'validation_failed', 'The request is invalid');
      return;
    }
    try {
      const product = await catalog.findProductByCode(body.data.value);
      const answer = scanResolveResponseSchema.parse(
        product === null
          ? { kind: 'search', product: null, query: body.data.value, value: body.data.value }
          : { kind: 'product', product, query: null, value: body.data.value },
      );
      res.json(answer);
    } catch (error) {
      logger.error(
        { err: { name: error instanceof Error ? error.name : 'UnknownError' } },
        'scan resolve failed',
      );
      sendError(res, 503, 'service_unavailable', 'That code could not be checked. Try again.');
    }
  });

  return router;
}

/** Mounted only when a database connection and a provider exist. */
export type ImageSearchRoutes = typeof imageSearchRoutes;

/** The limiter handler used by the routes above (kept here so the wiring stays in one place). */
export const imageSearchRateLimitHandler: Handler = (_req, res) => {
  sendError(res, 429, 'rate_limited', 'Too many image searches. Wait a moment and try again.');
};
