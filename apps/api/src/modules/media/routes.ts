import {
  productImageUploadQuerySchema,
  reorderProductImagesRequestSchema,
  updateProductImageRequestSchema,
  type ProductImageListResponse,
  type ProductImageUploadResponse,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Router, type RequestHandler, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { z } from 'zod';
import { sendError } from '../../http/send-error';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { currentIdentity, requirePermission } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { sendAdminFailure, type AdminRefusal, type RefusalAnswer } from '../admin/errors';
import { noStore } from '../commerce/http';
import { StoreUnavailableError } from '../commerce/errors';
import { toProductImage, toProductImages, type ImageRow } from './images';
import { IMAGE_CACHE_CONTROL, type MediaStorage } from './object-store';
import type { ProductImageStore } from './store';
import { createPictureUploads, imageContentType, readImageBody, requireStorage } from './upload';

// Declared beside the object store; re-exported here because this is where they are used.
export { IMAGE_CACHE_CONTROL, type MediaStorage };

export interface MediaRouteDependencies extends AuthDependencies {
  images: ProductImageStore;
  /** Undefined when R2 is not configured: every media route then answers 503 media_unavailable. */
  storage: MediaStorage | undefined;
  /** Shared per-IP limit for every admin and moderator change. */
  limiter: RequestHandler;
  logger: Logger;
}

const productParams = z.object({ productId: uuidSchema });
const imageParams = z.object({ imageId: uuidSchema });

const uploadSchemas = { params: productParams, query: productImageUploadQuerySchema };
const updateSchemas = { params: imageParams, body: updateProductImageRequestSchema };
const reorderSchemas = { params: productParams, body: reorderProductImagesRequestSchema };
const deleteSchemas = { params: imageParams };

const IMAGE_ANSWERS: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  not_found: [404, 'not_found', 'Product or image not found'],
  invalid_input: [400, 'bad_request', 'The request was refused as invalid'],
  content_locked: [
    409,
    'product_content_locked',
    'Unpublish the product before changing its images',
  ],
};

/**
 * POST /admin/products/:productId/images (raw image body), PUT
 * /admin/products/:productId/images/order, PATCH and DELETE /admin/product-images/:imageId.
 *
 * Each route authenticates the caller, requires products.read and products.update, and
 * calls the database as the caller, whose functions check the permission and the product
 * content rules again. Objects are stored before the row is registered and removed
 * if registering fails; on delete the row goes first and the objects after it commits.
 *
 * The body checks, the object writes and the rollback all come from ./upload, the same
 * helpers the category, brand, banner, media-library, avatar, review and chat uploads use.
 */
export function mediaRouter(deps: MediaRouteDependencies): Router {
  const router = Router();
  const { images, storage, limiter, logger } = deps;
  const requireUser = authenticate(deps);
  const canEdit = requirePermission('products.read', 'products.update');
  const storageGate = requireStorage(storage);
  const pictures = createPictureUploads(storage, logger);

  function requiredStorage(): MediaStorage {
    if (!storage) throw new Error('Media route reached without storage');
    return storage;
  }

  function body(rows: readonly ImageRow[], base: string): ProductImageListResponse {
    return { images: toProductImages(rows, base) };
  }

  router.post(
    '/admin/products/:productId/images',
    noStore,
    limiter,
    requireUser,
    canEdit,
    validate(uploadSchemas),
    imageContentType,
    storageGate,
    // The body is read only now: after authentication, permission and the type check.
    readImageBody,
    async (req, res) => {
      await upload(req.body as unknown, res);
    },
  );

  async function upload(received: unknown, res: Response): Promise<void> {
    const media = requiredStorage();
    const identity = currentIdentity(res);
    const { params, query } = requestInput<typeof uploadSchemas>(res);

    // Keys come from server-generated ids only; nothing the client sent is part of them.
    const imageId = randomUUID();
    const baseKey = `products/${params.productId}/${imageId}`;
    // null means the body was not a usable picture, and the rejection is already answered.
    const stored = await pictures.storePictureAtBaseKey(received, res, baseKey);
    if (stored === null) return;

    try {
      await images.add(identity.accessToken, identity.userId, {
        productId: params.productId,
        imageId,
        width: stored.width,
        height: stored.height,
        bytes: stored.bytes,
        alt: query.alt === undefined || query.alt === '' ? null : query.alt,
      });
    } catch (error) {
      await pictures.removePicture(baseKey, res);
      sendAdminFailure(res, error, IMAGE_ANSWERS);
      return;
    }

    const rows = await images.list(identity.accessToken, identity.userId, params.productId);
    const created = rows.find((row) => row.id === imageId);
    const image = created ? toProductImage(created, media.publicBaseUrl) : null;
    if (!image) {
      throw new StoreUnavailableError(
        'admin_add_product_image committed, but the image could not be read back',
      );
    }
    const response: ProductImageUploadResponse = {
      image,
      ...body(rows, media.publicBaseUrl),
    };
    res.status(201).json(response);
  }

  router.put(
    '/admin/products/:productId/images/order',
    noStore,
    limiter,
    requireUser,
    canEdit,
    storageGate,
    validate(reorderSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body: input } = requestInput<typeof reorderSchemas>(res);
      try {
        await images.reorder(
          identity.accessToken,
          identity.userId,
          params.productId,
          input.imageIds,
        );
      } catch (error) {
        sendAdminFailure(res, error, {
          ...IMAGE_ANSWERS,
          invalid_input: [400, 'bad_request', 'List every image of the product exactly once'],
        });
        return;
      }
      res.json(
        body(
          await images.list(identity.accessToken, identity.userId, params.productId),
          requiredStorage().publicBaseUrl,
        ),
      );
    },
  );

  router.patch(
    '/admin/product-images/:imageId',
    noStore,
    limiter,
    requireUser,
    canEdit,
    storageGate,
    validate(updateSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body: input } = requestInput<typeof updateSchemas>(res);
      const productId = await images.productOf(
        identity.accessToken,
        identity.userId,
        params.imageId,
      );
      if (!productId) {
        sendError(res, 404, 'not_found', 'Image not found');
        return;
      }
      try {
        await images.updateAlt(
          identity.accessToken,
          identity.userId,
          params.imageId,
          input.alt === '' ? null : input.alt,
        );
      } catch (error) {
        sendAdminFailure(res, error, IMAGE_ANSWERS);
        return;
      }
      res.json(
        body(
          await images.list(identity.accessToken, identity.userId, productId),
          requiredStorage().publicBaseUrl,
        ),
      );
    },
  );

  router.delete(
    '/admin/product-images/:imageId',
    noStore,
    limiter,
    requireUser,
    canEdit,
    storageGate,
    validate(deleteSchemas),
    async (req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof deleteSchemas>(res);
      const productId = await images.productOf(
        identity.accessToken,
        identity.userId,
        params.imageId,
      );
      if (!productId) {
        sendError(res, 404, 'not_found', 'Image not found');
        return;
      }
      let key: string;
      try {
        key = await images.remove(identity.accessToken, identity.userId, params.imageId);
      } catch (error) {
        sendAdminFailure(res, error, IMAGE_ANSWERS);
        return;
      }
      // The row is gone for good; a failed object delete leaves orphans, never a broken page.
      await pictures.removePicture(key, res);
      res.json(
        body(
          await images.list(identity.accessToken, identity.userId, productId),
          requiredStorage().publicBaseUrl,
        ),
      );
    },
  );

  return router;
}
