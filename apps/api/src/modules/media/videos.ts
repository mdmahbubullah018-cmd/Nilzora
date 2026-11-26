import {
  PRODUCT_VIDEO_CONTENT_TYPES,
  PRODUCT_VIDEO_EXTENSIONS,
  PRODUCT_VIDEO_MAX_BYTES,
  productVideoUploadQuerySchema,
  reorderProductVideosRequestSchema,
  sniffVideoType,
  type ProductVideo,
  type ProductVideoContentType,
  type ProductVideoListResponse,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import express, { Router, type RequestHandler, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { z } from 'zod';
import { withUser } from '../../db/user-context';
import { sendError } from '../../http/send-error';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { currentIdentity, requirePermission } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import type { SupabaseClients } from '../../supabase/clients';
import {
  sendAdminFailure,
  toAdminStoreError,
  type AdminRefusal,
  type RefusalAnswer,
} from '../admin/errors';
import { sqlNull } from '../admin/shared';
import { noStore } from '../commerce/http';
import { conform, StoreUnavailableError } from '../commerce/errors';
import { IMAGE_CACHE_CONTROL, type MediaStorage } from './object-store';
import { requireStorage } from './upload';

/*
 * Product videos
 * --------------
 * GET and POST /admin/products/:productId/videos, PUT .../videos/order and DELETE
 * /admin/product-videos/:videoId. The same shape and rules as product images (./routes):
 * the caller is authenticated and needs products.read (+ products.update to change), the
 * database functions check the permission and the product's content state again and write
 * the audit log, the object key comes only from server-generated ids, the bytes must be a
 * real MP4 or WebM matching the declared type, the object is stored before the row is
 * registered (and removed if registering fails), and on delete the row goes first.
 */

export const VIDEO_COLUMNS = 'id, storage_key, content_type, bytes, title, position';

export interface VideoRow {
  id: string;
  storage_key: string;
  content_type: ProductVideoContentType;
  bytes: number;
  title: string | null;
  position: number;
}

const videoRowsSchema = z.array(
  z.object({
    id: z.uuid(),
    storage_key: z.string(),
    content_type: z.enum(PRODUCT_VIDEO_CONTENT_TYPES),
    bytes: z.number().int(),
    title: z.string().nullable(),
    position: z.number().int(),
  }),
);

export function toProductVideos(
  rows: readonly VideoRow[],
  publicBaseUrl: string | undefined,
): ProductVideo[] {
  if (publicBaseUrl === undefined) return [];
  return [...rows]
    .sort((a, b) => a.position - b.position)
    .map((row) => ({
      id: row.id,
      url: `${publicBaseUrl}/${row.storage_key}`,
      contentType: row.content_type,
      bytes: row.bytes,
      title: row.title,
      position: row.position,
    }));
}

export interface NewProductVideo {
  productId: string;
  videoId: string;
  contentType: ProductVideoContentType;
  bytes: number;
  title: string | null;
}

export interface ProductVideoStore {
  list(accessToken: string, userId: string, productId: string): Promise<VideoRow[]>;
  productOf(accessToken: string, userId: string, videoId: string): Promise<string | null>;
  add(accessToken: string, userId: string, video: NewProductVideo): Promise<void>;
  reorder(
    accessToken: string,
    userId: string,
    productId: string,
    videoIds: readonly string[],
  ): Promise<void>;
  /** Removes the row and returns its storage key, for deleting the object afterwards. */
  remove(accessToken: string, userId: string, videoId: string): Promise<string>;
}

export function createSupabaseProductVideoStore(clients: SupabaseClients): ProductVideoStore {
  return {
    async list(accessToken, _userId, productId) {
      const { data, error } = await clients
        .asUser(accessToken)
        .from('product_videos')
        .select(VIDEO_COLUMNS)
        .eq('product_id', productId)
        .order('position');
      if (error) throw toAdminStoreError(error, 'product_videos');
      return conform(videoRowsSchema, data, 'product_videos');
    },
    async productOf(accessToken, _userId, videoId) {
      const { data, error } = await clients
        .asUser(accessToken)
        .from('product_videos')
        .select('product_id')
        .eq('id', videoId)
        .maybeSingle();
      if (error) throw toAdminStoreError(error, 'product_videos');
      return (data as { product_id?: string } | null)?.product_id ?? null;
    },
    async add(accessToken, _userId, video) {
      const { error } = await clients.asUser(accessToken).rpc('admin_add_product_video', {
        p_product_id: video.productId,
        p_video_id: video.videoId,
        p_content_type: video.contentType,
        p_bytes: video.bytes,
        p_title: sqlNull(video.title),
      });
      if (error) throw toAdminStoreError(error, 'admin_add_product_video');
    },
    async reorder(accessToken, _userId, productId, videoIds) {
      const { error } = await clients.asUser(accessToken).rpc('admin_reorder_product_videos', {
        p_product_id: productId,
        p_video_ids: [...videoIds],
      });
      if (error) throw toAdminStoreError(error, 'admin_reorder_product_videos');
    },
    async remove(accessToken, _userId, videoId) {
      const { data, error } = await clients
        .asUser(accessToken)
        .rpc('admin_delete_product_video', { p_video_id: videoId });
      if (error) throw toAdminStoreError(error, 'admin_delete_product_video');
      return conform(z.string().min(1), data, 'admin_delete_product_video');
    },
  };
}

function pgFailure(error: unknown): { code: string; message: string; details: string | null } {
  const fields = error as { code?: unknown; message?: unknown; detail?: unknown } | null;
  return {
    code: typeof fields?.code === 'string' ? fields.code : '',
    message: typeof fields?.message === 'string' ? fields.message : 'database request failed',
    details: typeof fields?.detail === 'string' ? fields.detail : null,
  };
}

export function createPostgresProductVideoStore(pool: Pool): ProductVideoStore {
  async function run<T>(userId: string, operation: string, fn: Parameters<typeof withUser<T>>[2]) {
    try {
      return await withUser(pool, userId, fn);
    } catch (error) {
      if (error instanceof StoreUnavailableError) throw error;
      throw toAdminStoreError(pgFailure(error), operation);
    }
  }
  return {
    list: (_token, userId, productId) =>
      run(userId, 'product_videos', async (client) => {
        const result = await client.query(
          `select ${VIDEO_COLUMNS} from public.product_videos where product_id = $1 order by position`,
          [productId],
        );
        return conform(videoRowsSchema, result.rows, 'product_videos');
      }),
    productOf: (_token, userId, videoId) =>
      run(userId, 'product_videos', async (client) => {
        const result = await client.query<{ product_id: string }>(
          'select product_id from public.product_videos where id = $1',
          [videoId],
        );
        return result.rows[0]?.product_id ?? null;
      }),
    add: (_token, userId, video) =>
      run(userId, 'admin_add_product_video', async (client) => {
        await client.query('select public.admin_add_product_video($1, $2, $3, $4, $5)', [
          video.productId,
          video.videoId,
          video.contentType,
          video.bytes,
          video.title,
        ]);
      }),
    reorder: (_token, userId, productId, videoIds) =>
      run(userId, 'admin_reorder_product_videos', async (client) => {
        await client.query('select public.admin_reorder_product_videos($1, $2::uuid[])', [
          productId,
          [...videoIds],
        ]);
      }),
    remove: (_token, userId, videoId) =>
      run(userId, 'admin_delete_product_video', async (client) => {
        const result = await client.query<{ storage_key: string }>(
          'select public.admin_delete_product_video($1) as storage_key',
          [videoId],
        );
        return conform(
          z.string().min(1),
          result.rows[0]?.storage_key,
          'admin_delete_product_video',
        );
      }),
  };
}

export interface VideoRouteDependencies extends AuthDependencies {
  videos: ProductVideoStore;
  storage: MediaStorage | undefined;
  limiter: RequestHandler;
  logger: Logger;
}

const productParams = z.object({ productId: uuidSchema });
const videoParams = z.object({ videoId: uuidSchema });
const listSchemas = { params: productParams };
const uploadSchemas = { params: productParams, query: productVideoUploadQuerySchema };
const reorderSchemas = { params: productParams, body: reorderProductVideosRequestSchema };
const deleteSchemas = { params: videoParams };

const VIDEO_ANSWERS: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  not_found: [404, 'not_found', 'Product or video not found'],
  invalid_input: [400, 'bad_request', 'The request was refused as invalid'],
  content_locked: [
    409,
    'product_content_locked',
    'Unpublish the product before changing its videos',
  ],
  image_limit: [409, 'video_limit_reached', 'A product keeps at most 3 videos'],
};

const ALLOWED: readonly string[] = PRODUCT_VIDEO_CONTENT_TYPES;

const videoContentType: RequestHandler = (req, res, next) => {
  const type = (req.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!ALLOWED.includes(type)) {
    sendError(res, 415, 'unsupported_media_type', 'Upload an MP4 or WebM video');
    return;
  }
  next();
};

const readVideoBody = express.raw({ type: () => true, limit: PRODUCT_VIDEO_MAX_BYTES });

export function productVideoRouter(deps: VideoRouteDependencies): Router {
  const router = Router();
  const { videos, storage, limiter, logger } = deps;
  const requireUser = authenticate(deps);
  const canRead = requirePermission('products.read');
  const canEdit = requirePermission('products.read', 'products.update');
  const storageGate = requireStorage(storage);

  function base(): string {
    if (!storage) throw new Error('Video route reached without storage');
    return storage.publicBaseUrl;
  }

  async function answerList(
    res: Response,
    token: string,
    userId: string,
    productId: string,
    status = 200,
  ) {
    const body: ProductVideoListResponse = {
      videos: toProductVideos(await videos.list(token, userId, productId), base()),
    };
    res.status(status).json(body);
  }

  async function removeObject(key: string, res: Response): Promise<void> {
    try {
      await storage?.objects.deleteMany([key]);
    } catch (error) {
      (res.req.log ?? logger).warn({ err: error, key }, 'Video object not deleted');
    }
  }

  router.get(
    '/admin/products/:productId/videos',
    noStore,
    requireUser,
    canRead,
    storageGate,
    validate(listSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof listSchemas>(res);
      await answerList(res, identity.accessToken, identity.userId, params.productId);
    },
  );

  router.post(
    '/admin/products/:productId/videos',
    noStore,
    limiter,
    requireUser,
    canEdit,
    validate(uploadSchemas),
    videoContentType,
    storageGate,
    // Read only after authentication, permission and the declared-type check.
    readVideoBody,
    async (req, res) => {
      const identity = currentIdentity(res);
      const { params, query } = requestInput<typeof uploadSchemas>(res);
      const received: unknown = req.body;
      if (!Buffer.isBuffer(received) || received.length === 0) {
        sendError(res, 400, 'bad_request', 'Send the video as the request body');
        return;
      }
      const declared = (req.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase();
      const sniffed = sniffVideoType(received);
      if (sniffed === null || sniffed !== declared) {
        sendError(res, 400, 'video_invalid', 'This file is not an MP4 or WebM video');
        return;
      }

      const videoId = randomUUID();
      const key = `products/${params.productId}/videos/${videoId}.${PRODUCT_VIDEO_EXTENSIONS[sniffed]}`;
      try {
        await storage?.objects.put({
          key,
          body: received,
          contentType: sniffed,
          cacheControl: IMAGE_CACHE_CONTROL,
        });
      } catch (error) {
        await removeObject(key, res);
        throw new StoreUnavailableError('video object could not be stored', { cause: error });
      }

      try {
        await videos.add(identity.accessToken, identity.userId, {
          productId: params.productId,
          videoId,
          contentType: sniffed,
          bytes: received.length,
          title: query.title ?? null,
        });
      } catch (error) {
        await removeObject(key, res);
        sendAdminFailure(res, error, VIDEO_ANSWERS);
        return;
      }
      await answerList(res, identity.accessToken, identity.userId, params.productId, 201);
    },
  );

  router.put(
    '/admin/products/:productId/videos/order',
    noStore,
    limiter,
    requireUser,
    canEdit,
    storageGate,
    validate(reorderSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof reorderSchemas>(res);
      try {
        await videos.reorder(
          identity.accessToken,
          identity.userId,
          params.productId,
          body.videoIds,
        );
      } catch (error) {
        sendAdminFailure(res, error, {
          ...VIDEO_ANSWERS,
          invalid_input: [400, 'bad_request', 'List every video of the product exactly once'],
        });
        return;
      }
      await answerList(res, identity.accessToken, identity.userId, params.productId);
    },
  );

  router.delete(
    '/admin/product-videos/:videoId',
    noStore,
    limiter,
    requireUser,
    canEdit,
    storageGate,
    validate(deleteSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof deleteSchemas>(res);
      const productId = await videos.productOf(
        identity.accessToken,
        identity.userId,
        params.videoId,
      );
      if (!productId) {
        sendError(res, 404, 'not_found', 'Video not found');
        return;
      }
      let key: string;
      try {
        key = await videos.remove(identity.accessToken, identity.userId, params.videoId);
      } catch (error) {
        sendAdminFailure(res, error, VIDEO_ANSWERS);
        return;
      }
      // The row is gone for good; a failed object delete leaves an orphan, never a broken page.
      await removeObject(key, res);
      await answerList(res, identity.accessToken, identity.userId, productId);
    },
  );

  return router;
}
