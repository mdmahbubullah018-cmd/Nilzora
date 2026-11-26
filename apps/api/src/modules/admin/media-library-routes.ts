import {
  MEDIA_LIBRARY_PREFIX,
  mediaAssetSchema,
  mediaListQuerySchema,
  mediaUploadQuerySchema,
  updateMediaRequestSchema,
  type MediaAsset,
  type MediaAssetResponse,
  type MediaListResponse,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Router, type Response } from 'express';
import { z } from 'zod';
import {
  currentIdentity,
  requireAnyPermission,
  requirePermission,
} from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { conform } from '../commerce/errors';
import { noStore } from '../commerce/http';
import { publicMediaUrl } from '../media/public-url';
import {
  createPictureUploads,
  imageContentType,
  readImageBody,
  requireStorage as requireStorageFor,
} from '../media/upload';
import { sendAdminFailure, type AdminRefusal, type RefusalAnswer } from './errors';
import type { StoredMediaAsset } from './media-library-store';
import type { AdminRouteDependencies } from './routes';
import { searchTerm } from './shared';

const assetParams = z.object({ id: uuidSchema });

const listSchemas = { query: mediaListQuerySchema };
const uploadSchemas = { query: mediaUploadQuerySchema };
const updateSchemas = { params: assetParams, body: updateMediaRequestSchema };
const deleteSchemas = { params: assetParams };

const MEDIA_ANSWERS: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  not_found: [404, 'not_found', 'Picture not found'],
  invalid_input: [400, 'bad_request', 'Check the description and file name'],
  in_use: [
    409,
    'in_use',
    'This picture is still used by the store profile, SEO, onboarding or a banner',
  ],
};

/** The stored row with its public URLs (the bucket address is known to this API only). */
function toMediaAsset(stored: StoredMediaAsset, publicBaseUrl: string): MediaAsset {
  return conform(
    mediaAssetSchema,
    {
      id: stored.id,
      key: stored.key,
      url: publicMediaUrl(stored.key, publicBaseUrl, 'full'),
      thumbUrl: publicMediaUrl(stored.key, publicBaseUrl, 'thumb'),
      contentType: stored.contentType,
      width: stored.width,
      height: stored.height,
      bytes: stored.bytes,
      alt: stored.alt,
      originalName: stored.originalName,
      uploadedBy: stored.uploadedBy,
      createdAt: stored.createdAt,
    },
    'media_assets',
  );
}

/**
 * GET /admin/media (settings.manage or products.update), POST /admin/media (raw image
 * body), PATCH and DELETE /admin/media/:id (settings.manage).
 *
 * Uploads go through the shared picture pipeline: the bytes decide the format (JPEG, PNG
 * or WebP), at most 5 MB and at least 400 pixels on the shorter side, turned upright and
 * stripped of metadata, stored as WebP full size (1600) and thumbnail (480) under
 * `library/<new id>`. The objects are stored before the row is recorded and removed if
 * recording is refused; on delete the row goes first and the objects after it commits.
 * Every route needs media storage (503 media_unavailable without it).
 */
export function adminMediaLibraryRouter(deps: AdminRouteDependencies): Router {
  const router = Router();
  const configured = deps.stores.mediaLibrary;
  if (!configured) return router;
  const library = configured;
  const { requireUser, limiter, storage, logger } = deps;
  const canRead = requireAnyPermission(['settings.manage', 'products.update']);
  const canManage = requirePermission('settings.manage');
  const requireStorage = requireStorageFor(storage);
  const { storePictureWithSize, removePicture } = createPictureUploads(storage, logger);

  function publicBase(): string {
    if (!storage) throw new Error('Media library route reached without storage');
    return storage.publicBaseUrl;
  }

  router.get(
    '/admin/media',
    noStore,
    requireUser,
    canRead,
    requireStorage,
    validate(listSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof listSchemas>(res);
      const search = query.q === undefined ? undefined : searchTerm(query.q);
      // A search with nothing searchable left matches nothing; the database is not asked.
      const { assets, total } =
        search === null
          ? { assets: [], total: 0 }
          : await library.list(identity.accessToken, identity.userId, search, query);
      const response: MediaListResponse = {
        assets: assets.map((asset) => toMediaAsset(asset, publicBase())),
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      };
      res.json(response);
    },
  );

  router.post(
    '/admin/media',
    noStore,
    limiter,
    requireUser,
    canManage,
    validate(uploadSchemas),
    imageContentType,
    requireStorage,
    // The body is read only now: after authentication, permission and the type check.
    readImageBody,
    async (req, res) => {
      await upload(req.body as unknown, res);
    },
  );

  async function upload(received: unknown, res: Response): Promise<void> {
    const identity = currentIdentity(res);
    const { query } = requestInput<typeof uploadSchemas>(res);
    // The key is `library/<new uuid>`: nothing the client sent is part of it.
    const stored = await storePictureWithSize(received, res, MEDIA_LIBRARY_PREFIX);
    if (stored === null) return;
    const id = stored.key.slice(MEDIA_LIBRARY_PREFIX.length + 1);

    let asset: StoredMediaAsset;
    try {
      asset = await library.record(identity.accessToken, identity.userId, {
        id,
        contentType: 'image/webp',
        width: stored.width,
        height: stored.height,
        bytes: stored.bytes,
        alt: query.alt === undefined || query.alt === '' ? null : query.alt,
        originalName: query.name ?? null,
      });
    } catch (error) {
      await removePicture(stored.key, res);
      sendAdminFailure(res, error, MEDIA_ANSWERS);
      return;
    }
    const response: MediaAssetResponse = { asset: toMediaAsset(asset, publicBase()) };
    res.status(201).json(response);
  }

  router.patch(
    '/admin/media/:id',
    noStore,
    limiter,
    requireUser,
    canManage,
    requireStorage,
    validate(updateSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof updateSchemas>(res);
      try {
        const asset = await library.updateAlt(
          identity.accessToken,
          identity.userId,
          params.id,
          body.alt === '' ? null : body.alt,
        );
        const response: MediaAssetResponse = { asset: toMediaAsset(asset, publicBase()) };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, MEDIA_ANSWERS);
      }
    },
  );

  router.delete(
    '/admin/media/:id',
    noStore,
    limiter,
    requireUser,
    canManage,
    requireStorage,
    validate(deleteSchemas),
    async (req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof deleteSchemas>(res);
      let keys: string[];
      try {
        keys = await library.remove(identity.accessToken, identity.userId, params.id);
      } catch (error) {
        sendAdminFailure(res, error, MEDIA_ANSWERS);
        return;
      }
      // The row is gone for good; a failed object delete leaves orphans, never a broken page.
      try {
        await storage?.objects.deleteMany(keys);
      } catch (error) {
        (req.log ?? logger)?.warn({ err: error, keys }, 'Orphaned library objects not deleted');
      }
      res.status(204).end();
    },
  );

  return router;
}
