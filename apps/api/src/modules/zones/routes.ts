import {
  adminSaveShoppingZoneRequestSchema,
  adminShoppingZoneActiveRequestSchema,
  adminShoppingZoneBannerQuerySchema,
  adminShoppingZoneCategoriesRequestSchema,
  adminShoppingZoneListQuerySchema,
  adminShoppingZoneProductsRequestSchema,
  adminZoneAssignmentRequestSchema,
  shoppingZonesResponseSchema,
  type ShoppingZonesResponse,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Router, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import type { Logger } from 'pino';
import { sendError } from '../../http/send-error';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { currentIdentity, requirePermission } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { sendAdminFailure, type AdminRefusal, type RefusalAnswer } from '../admin/errors';
import { noStore, PUBLIC_CATALOG_CACHE } from '../commerce/http';
import type { MediaKeyReferences } from '../media/references';
import {
  createPictureUploads,
  imageContentType,
  readImageBody,
  requireStorage,
} from '../media/upload';
import type { MediaStorage } from '../media/object-store';
import { ZoneRefusalError, type ZoneStore } from './store';

/*
 * Shopping zones
 * --------------
 * GET /catalog/shopping-zones is the public read: active zones only, in display order, with
 * banners as finished URLs. Everything under /admin is the workspace's, and every admin
 * route requires `zones.manage` — the database checks it again.
 *
 * A zone has two pictures that never touch each other: the site's (`/banner`, written under
 * `zone-banners/`) and the app's (`/mobile-banner`, written under `zone-mobile-banners/`).
 * Both are uploaded the same way every other picture is: raw bytes to a zone-specific address,
 * the media service re-encodes them into the two WebP variants, and the stored key is recorded
 * by the zone function. Nothing the client sends becomes part of a key.
 */

const zoneParams = z.object({ zoneId: uuidSchema });
const zoneListSchemas = { query: adminShoppingZoneListQuerySchema };
const zoneCreateSchemas = { body: adminSaveShoppingZoneRequestSchema };
const zoneSaveSchemas = { params: zoneParams, body: adminSaveShoppingZoneRequestSchema };
const zoneActiveSchemas = { params: zoneParams, body: adminShoppingZoneActiveRequestSchema };
const zoneProductsSchemas = { params: zoneParams, body: adminShoppingZoneProductsRequestSchema };
const zoneCategoriesSchemas = {
  params: zoneParams,
  body: adminShoppingZoneCategoriesRequestSchema,
};
const zoneBannerSchemas = { params: zoneParams, query: adminShoppingZoneBannerQuerySchema };
/** The reverse direction: assignment from a product's or a category's own page. */
const productZoneSchemas = { params: z.object({ productId: uuidSchema }) };
const productZoneSaveSchemas = {
  params: z.object({ productId: uuidSchema }),
  body: adminZoneAssignmentRequestSchema,
};
const categoryZoneSchemas = { params: z.object({ categoryId: uuidSchema }) };
const categoryZoneSaveSchemas = {
  params: z.object({ categoryId: uuidSchema }),
  body: adminZoneAssignmentRequestSchema,
};

const ZONE_ANSWERS: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  not_found: [404, 'not_found', 'That shopping zone no longer exists'],
  invalid_input: [
    400,
    'bad_request',
    'Check the zone: the address must be unused lower-case words, and the picture must be a supported image',
  ],
};

/** What a refusal means for the caller, in the words the workspace shows. */
function sendZoneFailure(res: Parameters<typeof sendAdminFailure>[0], error: unknown): void {
  if (error instanceof ZoneRefusalError) {
    if (error.refusal === 'zone_slug_taken') {
      sendError(res, 409, 'slug_taken', 'Another shopping zone already uses that address');
      return;
    }
    sendError(
      res,
      409,
      'zone_in_use',
      'This zone still holds products or categories. Remove them before deleting it.',
    );
    return;
  }
  sendAdminFailure(res, error, ZONE_ANSWERS);
}

export interface ZoneRouteDependencies extends AuthDependencies {
  zones: ZoneStore;
  /** Undefined when R2 is not configured: banner uploads then answer 503. */
  storage: MediaStorage | undefined;
  /**
   * Answers whether a picture is still used by a record before its files are deleted. Asked
   * with the server's own connection, so a table the admin cannot read still counts.
   */
  references?: MediaKeyReferences;
  /** Shared per-IP limit for every admin change. */
  limiter: RequestHandler;
  logger: Logger;
}

export function zoneRoutes(deps: ZoneRouteDependencies): Router {
  const router = Router();
  const requireUser = authenticate(deps);
  const canManage = requirePermission('zones.manage');
  const storageGate = requireStorage(deps.storage);
  const pictures = createPictureUploads(deps.storage, deps.logger);

  /**
   * Deletes a zone picture's files only once no record keeps its key. A picture still in use, or
   * one whose references could not be checked, stays in storage: an unused file is cheaper than
   * a broken image, and the reason is logged for whoever cleans up later.
   */
  const discardPicture = async (baseKey: string | null, res: Response): Promise<void> => {
    if (baseKey === null) return;
    if (deps.references === undefined) {
      deps.logger.warn({ key: baseKey }, 'Picture kept: no reference check is configured');
      return;
    }
    const inUse = await deps.references.inUse(baseKey);
    if (inUse === null) {
      deps.logger.warn({ key: baseKey }, 'Picture kept: its references could not be checked');
      return;
    }
    if (inUse) {
      deps.logger.info({ key: baseKey }, 'Picture kept: a record still uses it');
      return;
    }
    await pictures.removePicture(baseKey, res);
  };

  /**
   * A UUID is case-insensitive, but the stored key is not: the folder is part of the key, and
   * the database compares it with `p_zone_id::text`, which is always lower case. Normalising
   * here means an upper-case URL still works instead of failing after the picture is written.
   */
  const folderId = (zoneId: string): string => zoneId.toLowerCase();

  router.get('/catalog/shopping-zones', async (_req, res) => {
    const body: ShoppingZonesResponse = shoppingZonesResponseSchema.parse(await deps.zones.list());
    res.set('Cache-Control', PUBLIC_CATALOG_CACHE).json(body);
  });

  /*
   * The reverse direction, for the product and category forms. The zone editor writes the
   * same junction rows from the zone's side; these write them from the record's side, so an
   * admin can assign zones without leaving the page they are on. Same permission, same tables.
   */
  router.get(
    '/admin/products/:productId/zones',
    noStore,
    requireUser,
    canManage,
    validate(productZoneSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof productZoneSchemas>(res);
      try {
        res.json(
          await deps.zones.productZones(identity.accessToken, identity.userId, params.productId),
        );
      } catch (error) {
        sendZoneFailure(res, error);
      }
    },
  );

  router.put(
    '/admin/products/:productId/zones',
    noStore,
    deps.limiter,
    requireUser,
    canManage,
    validate(productZoneSaveSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof productZoneSaveSchemas>(res);
      try {
        const kept = await deps.zones.setProductZones(
          identity.accessToken,
          identity.userId,
          params.productId,
          body.zoneIds,
        );
        res.json({ kept });
      } catch (error) {
        sendZoneFailure(res, error);
      }
    },
  );

  router.get(
    '/admin/categories/:categoryId/zones',
    noStore,
    requireUser,
    canManage,
    validate(categoryZoneSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof categoryZoneSchemas>(res);
      try {
        res.json(
          await deps.zones.categoryZones(identity.accessToken, identity.userId, params.categoryId),
        );
      } catch (error) {
        sendZoneFailure(res, error);
      }
    },
  );

  router.put(
    '/admin/categories/:categoryId/zones',
    noStore,
    deps.limiter,
    requireUser,
    canManage,
    validate(categoryZoneSaveSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof categoryZoneSaveSchemas>(res);
      try {
        const kept = await deps.zones.setCategoryZones(
          identity.accessToken,
          identity.userId,
          params.categoryId,
          body.zoneIds,
        );
        res.json({ kept });
      } catch (error) {
        sendZoneFailure(res, error);
      }
    },
  );

  router.get(
    '/admin/shopping-zones',
    noStore,
    requireUser,
    canManage,
    validate(zoneListSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof zoneListSchemas>(res);
      try {
        res.json(
          await deps.zones.adminList(identity.accessToken, identity.userId, {
            ...query,
            q: query.q ?? undefined,
          }),
        );
      } catch (error) {
        sendZoneFailure(res, error);
      }
    },
  );

  router.post(
    '/admin/shopping-zones',
    noStore,
    deps.limiter,
    requireUser,
    canManage,
    validate(zoneCreateSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof zoneCreateSchemas>(res);
      try {
        const zoneId = await deps.zones.save(identity.accessToken, identity.userId, null, body);
        res.status(201).json({
          zone: await deps.zones.adminZone(identity.accessToken, identity.userId, zoneId),
        });
      } catch (error) {
        sendZoneFailure(res, error);
      }
    },
  );

  router.get(
    '/admin/shopping-zones/:zoneId',
    noStore,
    requireUser,
    canManage,
    validate({ params: zoneParams }),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<{ params: typeof zoneParams }>(res);
      try {
        res.json({
          zone: await deps.zones.adminZone(identity.accessToken, identity.userId, params.zoneId),
        });
      } catch (error) {
        sendZoneFailure(res, error);
      }
    },
  );

  router.put(
    '/admin/shopping-zones/:zoneId',
    noStore,
    deps.limiter,
    requireUser,
    canManage,
    validate(zoneSaveSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof zoneSaveSchemas>(res);
      try {
        await deps.zones.save(identity.accessToken, identity.userId, params.zoneId, body);
        res.json({
          zone: await deps.zones.adminZone(identity.accessToken, identity.userId, params.zoneId),
        });
      } catch (error) {
        sendZoneFailure(res, error);
      }
    },
  );

  router.put(
    '/admin/shopping-zones/:zoneId/active',
    noStore,
    deps.limiter,
    requireUser,
    canManage,
    validate(zoneActiveSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof zoneActiveSchemas>(res);
      try {
        await deps.zones.setActive(
          identity.accessToken,
          identity.userId,
          params.zoneId,
          body.isActive,
        );
        res.json({
          zone: await deps.zones.adminZone(identity.accessToken, identity.userId, params.zoneId),
        });
      } catch (error) {
        sendZoneFailure(res, error);
      }
    },
  );

  router.put(
    '/admin/shopping-zones/:zoneId/products',
    noStore,
    deps.limiter,
    requireUser,
    canManage,
    validate(zoneProductsSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof zoneProductsSchemas>(res);
      try {
        const kept = await deps.zones.setProducts(
          identity.accessToken,
          identity.userId,
          params.zoneId,
          body.productIds,
        );
        res.json({ kept });
      } catch (error) {
        sendZoneFailure(res, error);
      }
    },
  );

  router.put(
    '/admin/shopping-zones/:zoneId/categories',
    noStore,
    deps.limiter,
    requireUser,
    canManage,
    validate(zoneCategoriesSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof zoneCategoriesSchemas>(res);
      try {
        const kept = await deps.zones.setCategories(
          identity.accessToken,
          identity.userId,
          params.zoneId,
          body.categoryIds,
        );
        res.json({ kept });
      } catch (error) {
        sendZoneFailure(res, error);
      }
    },
  );

  router.post(
    '/admin/shopping-zones/:zoneId/banner',
    noStore,
    deps.limiter,
    requireUser,
    canManage,
    validate(zoneBannerSchemas),
    imageContentType,
    storageGate,
    readImageBody,
    async (req, res) => {
      const identity = currentIdentity(res);
      const { params, query } = requestInput<typeof zoneBannerSchemas>(res);
      // The key is `zone-banners/<zone>`: nothing the client sent is part of it, and the
      // stored form gets a fresh picture id from the media service.
      const key = await pictures.storePicture(
        req.body as unknown,
        res,
        `zone-banners/${folderId(params.zoneId)}`,
      );
      if (key === null) return;
      try {
        const old = await deps.zones.setBanner(
          identity.accessToken,
          identity.userId,
          params.zoneId,
          key,
          query.alt === undefined || query.alt === '' ? null : query.alt,
        );
        await discardPicture(old, res);
      } catch (error) {
        await pictures.removePicture(key, res);
        sendZoneFailure(res, error);
        return;
      }
      try {
        res.json({
          zone: await deps.zones.adminZone(identity.accessToken, identity.userId, params.zoneId),
        });
      } catch (error) {
        sendZoneFailure(res, error);
      }
    },
  );

  router.delete(
    '/admin/shopping-zones/:zoneId/banner',
    noStore,
    deps.limiter,
    requireUser,
    canManage,
    validate({ params: zoneParams }),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<{ params: typeof zoneParams }>(res);
      try {
        const old = await deps.zones.setBanner(
          identity.accessToken,
          identity.userId,
          params.zoneId,
          null,
          null,
        );
        await discardPicture(old, res);
        res.json({
          zone: await deps.zones.adminZone(identity.accessToken, identity.userId, params.zoneId),
        });
      } catch (error) {
        sendZoneFailure(res, error);
      }
    },
  );

  /*
   * The app's own artwork. It goes to its own folder, so the site's picture can never be
   * replaced by mistake, and uploading here never reads or writes `banner_key`.
   */
  router.post(
    '/admin/shopping-zones/:zoneId/mobile-banner',
    noStore,
    deps.limiter,
    requireUser,
    canManage,
    validate({ params: zoneParams }),
    imageContentType,
    storageGate,
    readImageBody,
    async (req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<{ params: typeof zoneParams }>(res);
      const key = await pictures.storePicture(
        req.body as unknown,
        res,
        `zone-mobile-banners/${folderId(params.zoneId)}`,
      );
      if (key === null) return;
      try {
        const old = await deps.zones.setMobileBanner(
          identity.accessToken,
          identity.userId,
          params.zoneId,
          key,
        );
        await discardPicture(old, res);
      } catch (error) {
        await pictures.removePicture(key, res);
        sendZoneFailure(res, error);
        return;
      }
      try {
        res.json({
          zone: await deps.zones.adminZone(identity.accessToken, identity.userId, params.zoneId),
        });
      } catch (error) {
        sendZoneFailure(res, error);
      }
    },
  );

  router.delete(
    '/admin/shopping-zones/:zoneId/mobile-banner',
    noStore,
    deps.limiter,
    requireUser,
    canManage,
    validate({ params: zoneParams }),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<{ params: typeof zoneParams }>(res);
      try {
        const old = await deps.zones.setMobileBanner(
          identity.accessToken,
          identity.userId,
          params.zoneId,
          null,
        );
        await discardPicture(old, res);
        res.json({
          zone: await deps.zones.adminZone(identity.accessToken, identity.userId, params.zoneId),
        });
      } catch (error) {
        sendZoneFailure(res, error);
      }
    },
  );

  router.delete(
    '/admin/shopping-zones/:zoneId',
    noStore,
    deps.limiter,
    requireUser,
    canManage,
    validate({ params: zoneParams }),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<{ params: typeof zoneParams }>(res);
      try {
        const keys = await deps.zones.delete(identity.accessToken, identity.userId, params.zoneId);
        // The zone is gone, so its pictures are candidates: each is deleted only if nothing
        // else kept the key.
        await discardPicture(keys.bannerKey, res);
        await discardPicture(keys.mobileBannerKey, res);
        res.status(204).end();
      } catch (error) {
        sendZoneFailure(res, error);
      }
    },
  );

  return router;
}
