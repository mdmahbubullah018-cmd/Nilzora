import {
  bannerInputSchema,
  bannerListQuerySchema,
  brandInputSchema,
  brandProductsQuerySchema,
  brandSlugSchema,
  reorderBannersRequestSchema,
  setProductBrandRequestSchema,
  type AdminBannerListResponse,
  type AdminBannerResponse,
  type AdminBrandListResponse,
  type AdminBrandResponse,
  type BannerListResponse,
  type BrandListResponse,
  type BrandLookupResponse,
  type BrandProductsResponse,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Router, type RequestHandler, type Response } from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
import { sendError } from '../../http/send-error';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { currentIdentity, requirePermission } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { sendAdminFailure, type AdminRefusal, type RefusalAnswer } from '../admin/errors';
import { noStore, PUBLIC_CATALOG_CACHE } from '../commerce/http';
import { type MediaStorage } from '../media/routes';
import type { MediaKeyReferences } from '../media/references';
import {
  createPictureUploads,
  imageContentType,
  readImageBody,
  requireStorage as requireStorageFor,
} from '../media/upload';
import type { MerchandisingStore } from './store';

export interface MerchandisingRouteDependencies extends AuthDependencies {
  store: MerchandisingStore;
  /** Undefined when R2 is not configured: image uploads then answer 503 media_unavailable. */
  storage: MediaStorage | undefined;
  /** Asked before a brand picture's files are deleted, so a shared one is never removed. */
  references: MediaKeyReferences;
  limiter: RequestHandler;
  logger: Logger;
}

const brandParams = z.object({ brandId: uuidSchema });
const bannerParams = z.object({ bannerId: uuidSchema });
const productParams = z.object({ productId: uuidSchema });

const brandLookupSchemas = { params: z.object({ slug: brandSlugSchema }) };
const brandProductsSchemas = {
  params: z.object({ slug: brandSlugSchema }),
  query: brandProductsQuerySchema,
};
const bannerListSchemas = { query: bannerListQuerySchema };
const createBrandSchemas = { body: brandInputSchema };
const updateBrandSchemas = { params: brandParams, body: brandInputSchema };
const brandImageSchemas = { params: brandParams };
const productBrandSchemas = { params: productParams, body: setProductBrandRequestSchema };
const createBannerSchemas = { body: bannerInputSchema };
const updateBannerSchemas = { params: bannerParams, body: bannerInputSchema };
const bannerOnlySchemas = { params: bannerParams };
const bannerOrderSchemas = { body: reorderBannersRequestSchema };
/** `?variant=mobile` stores the small-screen picture; without it the main picture is set. */
const bannerImageSchemas = {
  params: bannerParams,
  query: z.object({ variant: z.enum(['main', 'mobile']).default('main') }),
};
const bannerMobileOnlySchemas = {
  params: bannerParams,
  query: z.object({ variant: z.literal('mobile') }),
};

const BRAND_ANSWERS: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  not_found: [404, 'not_found', 'Brand not found'],
  slug_taken: [409, 'slug_taken', 'Another brand already uses or recently used this address'],
  name_taken: [409, 'name_taken', 'Another brand already uses this name'],
};
const BANNER_ANSWERS: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  not_found: [404, 'not_found', 'Banner not found'],
  invalid_input: [400, 'bad_request', 'Check the placement, category and schedule'],
};

/**
 * Public: GET /catalog/brands, /catalog/brands/:slug, /catalog/brands/:slug/products and
 * /catalog/banners. Admin: brands (products.read to view, products.publish to change) and
 * banners (settings.manage), including logo and image uploads to media storage.
 */
export function merchandisingRouter(deps: MerchandisingRouteDependencies): Router {
  const router = Router();
  const { store, storage, limiter, logger, references } = deps;
  const requireUser = authenticate(deps);
  const canReadBrands = requirePermission('products.read');
  const canEditBrands = requirePermission('products.read', 'products.publish');
  const canManageBanners = requirePermission('settings.manage');
  const requireStorage = requireStorageFor(storage);
  const { storePicture, removePicture } = createPictureUploads(storage, logger);

  /**
   * Deletes a brand picture's files only once no record keeps its key. A picture still in
   * use, or one whose references could not be checked, stays in storage: an unused file is
   * cheaper than a broken image, and the reason is logged for whoever cleans up later.
   */
  const discardPicture = async (baseKey: string | null, res: Response): Promise<void> => {
    if (baseKey === null) return;
    const inUse = await references.inUse(baseKey);
    if (inUse === null) {
      logger.warn({ key: baseKey }, 'Picture kept: its references could not be checked');
      return;
    }
    if (inUse) {
      logger.info({ key: baseKey }, 'Picture kept: a record still uses it');
      return;
    }
    await removePicture(baseKey, res);
  };

  // ---------------------------------------------------------------- public

  router.get('/catalog/brands', async (_req, res) => {
    const body: BrandListResponse = { brands: await store.listBrands() };
    res.set('Cache-Control', PUBLIC_CATALOG_CACHE).json(body);
  });

  router.get('/catalog/brands/:slug', validate(brandLookupSchemas), async (_req, res) => {
    const { params } = requestInput<typeof brandLookupSchemas>(res);
    const body: BrandLookupResponse = await store.lookupBrand(params.slug);
    if (!body.brand && !body.redirectTo) {
      sendError(res, 404, 'not_found', 'Brand not found');
      return;
    }
    res.set('Cache-Control', PUBLIC_CATALOG_CACHE).json(body);
  });

  router.get(
    '/catalog/brands/:slug/products',
    validate(brandProductsSchemas),
    async (_req, res) => {
      const { params, query } = requestInput<typeof brandProductsSchemas>(res);
      const offset = (query.page - 1) * query.pageSize;
      const { items, total } = await store.brandProducts(
        params.slug,
        query.sort ?? 'featured',
        query.pageSize,
        offset,
      );
      const body: BrandProductsResponse = {
        items,
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      };
      res.set('Cache-Control', PUBLIC_CATALOG_CACHE).json(body);
    },
  );

  router.get('/catalog/banners', validate(bannerListSchemas), async (_req, res) => {
    const { query } = requestInput<typeof bannerListSchemas>(res);
    const body: BannerListResponse = {
      banners: await store.listBanners(query.placement, query.category),
    };
    res.set('Cache-Control', PUBLIC_CATALOG_CACHE).json(body);
  });

  // ---------------------------------------------------------------- admin: brands

  router.get('/admin/brands', noStore, requireUser, canReadBrands, async (_req, res) => {
    const identity = currentIdentity(res);
    const body: AdminBrandListResponse = {
      brands: await store.adminListBrands(identity.accessToken, identity.userId),
    };
    res.json(body);
  });

  async function answerBrand(res: Response, accessToken: string, brandId: string, status = 200) {
    const { userId } = currentIdentity(res);
    const brand = await store.adminGetBrand(accessToken, userId, brandId);
    if (!brand) {
      sendError(res, 404, 'not_found', 'Brand not found');
      return;
    }
    const body: AdminBrandResponse = { brand };
    res.status(status).json(body);
  }

  router.post(
    '/admin/brands',
    noStore,
    limiter,
    requireUser,
    canEditBrands,
    validate(createBrandSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof createBrandSchemas>(res);
      try {
        const id = await store.saveBrand(identity.accessToken, identity.userId, null, body);
        await answerBrand(res, identity.accessToken, id, 201);
      } catch (error) {
        sendAdminFailure(res, error, BRAND_ANSWERS);
      }
    },
  );

  router.put(
    '/admin/brands/:brandId',
    noStore,
    limiter,
    requireUser,
    canEditBrands,
    validate(updateBrandSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof updateBrandSchemas>(res);
      try {
        await store.saveBrand(identity.accessToken, identity.userId, params.brandId, body);
        await answerBrand(res, identity.accessToken, params.brandId);
      } catch (error) {
        sendAdminFailure(res, error, BRAND_ANSWERS);
      }
    },
  );

  /** Only a brand no product belongs to; its logo and banner files go after the delete commits. */
  router.delete(
    '/admin/brands/:brandId',
    noStore,
    limiter,
    requireUser,
    canEditBrands,
    validate(brandImageSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof brandImageSchemas>(res);
      let media: { logoKey: string | null; bannerKey: string | null };
      try {
        media = await store.deleteBrand(identity.accessToken, identity.userId, params.brandId);
      } catch (error) {
        sendAdminFailure(res, error, {
          ...BRAND_ANSWERS,
          in_use: [
            409,
            'brand_in_use',
            'Move this brand’s products to another brand (or none) first',
          ],
        });
        return;
      }
      await discardPicture(media.logoKey, res);
      await discardPicture(media.bannerKey, res);
      res.status(204).end();
    },
  );

  router.post(
    '/admin/brands/:brandId/logo',
    noStore,
    limiter,
    requireUser,
    canEditBrands,
    validate(brandImageSchemas),
    imageContentType,
    requireStorage,
    readImageBody,
    async (req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof brandImageSchemas>(res);
      // storePicture adds a fresh picture id: the object is immutable-cached, so a
      // replacement must never reuse the address of the one it replaced.
      const key = await storePicture(req.body as unknown, res, `brands/${params.brandId}`);
      if (key === null) return;
      try {
        const old = await store.setBrandLogo(
          identity.accessToken,
          identity.userId,
          params.brandId,
          key,
        );
        await discardPicture(old, res);
      } catch (error) {
        await discardPicture(key, res);
        sendAdminFailure(res, error, BRAND_ANSWERS);
        return;
      }
      await answerBrand(res, identity.accessToken, params.brandId);
    },
  );

  router.delete(
    '/admin/brands/:brandId/logo',
    noStore,
    limiter,
    requireUser,
    canEditBrands,
    validate(brandImageSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof brandImageSchemas>(res);
      try {
        const old = await store.setBrandLogo(
          identity.accessToken,
          identity.userId,
          params.brandId,
          null,
        );
        await discardPicture(old, res);
        await answerBrand(res, identity.accessToken, params.brandId);
      } catch (error) {
        sendAdminFailure(res, error, BRAND_ANSWERS);
      }
    },
  );

  /** Replaces a brand's card banner, deleting the picture it supersedes. */
  router.post(
    '/admin/brands/:brandId/banner',
    noStore,
    limiter,
    requireUser,
    canEditBrands,
    validate(brandImageSchemas),
    imageContentType,
    requireStorage,
    readImageBody,
    async (req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof brandImageSchemas>(res);
      const key = await storePicture(req.body as unknown, res, `brands/${params.brandId}`);
      if (key === null) return;
      try {
        const old = await store.setBrandBanner(
          identity.accessToken,
          identity.userId,
          params.brandId,
          key,
        );
        await discardPicture(old, res);
      } catch (error) {
        await discardPicture(key, res);
        sendAdminFailure(res, error, BRAND_ANSWERS);
        return;
      }
      await answerBrand(res, identity.accessToken, params.brandId);
    },
  );

  router.delete(
    '/admin/brands/:brandId/banner',
    noStore,
    limiter,
    requireUser,
    canEditBrands,
    validate(brandImageSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof brandImageSchemas>(res);
      try {
        const old = await store.setBrandBanner(
          identity.accessToken,
          identity.userId,
          params.brandId,
          null,
        );
        await discardPicture(old, res);
        await answerBrand(res, identity.accessToken, params.brandId);
      } catch (error) {
        sendAdminFailure(res, error, BRAND_ANSWERS);
      }
    },
  );

  router.get(
    '/admin/products/:productId/brand',
    noStore,
    requireUser,
    canReadBrands,
    validate({ params: productParams }),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<{ params: typeof productParams }>(res);
      const brandId = await store.productBrand(
        identity.accessToken,
        identity.userId,
        params.productId,
      );
      if (brandId === undefined) {
        sendError(res, 404, 'not_found', 'Product not found');
        return;
      }
      res.json({ brandId });
    },
  );

  router.put(
    '/admin/products/:productId/brand',
    noStore,
    limiter,
    requireUser,
    canEditBrands,
    validate(productBrandSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof productBrandSchemas>(res);
      try {
        await store.setProductBrand(
          identity.accessToken,
          identity.userId,
          params.productId,
          body.brandId,
        );
        res.status(204).end();
      } catch (error) {
        sendAdminFailure(res, error, {
          not_found: [404, 'not_found', 'Product or brand not found'],
        });
      }
    },
  );

  // ---------------------------------------------------------------- admin: banners

  router.get('/admin/banners', noStore, requireUser, canManageBanners, async (_req, res) => {
    const identity = currentIdentity(res);
    const body: AdminBannerListResponse = {
      banners: await store.adminListBanners(identity.accessToken, identity.userId),
    };
    res.json(body);
  });

  async function answerBanner(res: Response, accessToken: string, bannerId: string, status = 200) {
    const { userId } = currentIdentity(res);
    const banner = await store.adminGetBanner(accessToken, userId, bannerId);
    if (!banner) {
      sendError(res, 404, 'not_found', 'Banner not found');
      return;
    }
    const body: AdminBannerResponse = { banner };
    res.status(status).json(body);
  }

  router.post(
    '/admin/banners',
    noStore,
    limiter,
    requireUser,
    canManageBanners,
    validate(createBannerSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof createBannerSchemas>(res);
      try {
        const id = await store.saveBanner(identity.accessToken, identity.userId, null, body);
        await answerBanner(res, identity.accessToken, id, 201);
      } catch (error) {
        sendAdminFailure(res, error, BANNER_ANSWERS);
      }
    },
  );

  // Registered before /:bannerId, which would otherwise take "order" for an id.
  router.put(
    '/admin/banners/order',
    noStore,
    limiter,
    requireUser,
    canManageBanners,
    validate(bannerOrderSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof bannerOrderSchemas>(res);
      try {
        await store.reorderBanners(
          identity.accessToken,
          identity.userId,
          body.placement,
          body.categoryId,
          body.ids,
        );
        const response: AdminBannerListResponse = {
          banners: await store.adminListBanners(identity.accessToken, identity.userId),
        };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, {
          ...BANNER_ANSWERS,
          invalid_input: [400, 'bad_request', 'List every banner of the placement exactly once'],
        });
      }
    },
  );

  router.put(
    '/admin/banners/:bannerId',
    noStore,
    limiter,
    requireUser,
    canManageBanners,
    validate(updateBannerSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof updateBannerSchemas>(res);
      try {
        await store.saveBanner(identity.accessToken, identity.userId, params.bannerId, body);
        await answerBanner(res, identity.accessToken, params.bannerId);
      } catch (error) {
        sendAdminFailure(res, error, BANNER_ANSWERS);
      }
    },
  );

  router.post(
    '/admin/banners/:bannerId/image',
    noStore,
    limiter,
    requireUser,
    canManageBanners,
    validate(bannerImageSchemas),
    imageContentType,
    requireStorage,
    readImageBody,
    async (req, res) => {
      const identity = currentIdentity(res);
      const { params, query } = requestInput<typeof bannerImageSchemas>(res);
      // A fresh picture id, for the same reason as a brand logo.
      const key = await storePicture(req.body as unknown, res, `banners/${params.bannerId}`);
      if (key === null) return;
      try {
        const old =
          query.variant === 'mobile'
            ? await store.setBannerMobileImage(
                identity.accessToken,
                identity.userId,
                params.bannerId,
                key,
              )
            : await store.setBannerImage(
                identity.accessToken,
                identity.userId,
                params.bannerId,
                key,
              );
        await removePicture(old, res);
      } catch (error) {
        await removePicture(key, res);
        sendAdminFailure(res, error, BANNER_ANSWERS);
        return;
      }
      await answerBanner(res, identity.accessToken, params.bannerId);
    },
  );

  /** Removes the small-screen picture; the main picture stays. */
  router.delete(
    '/admin/banners/:bannerId/image',
    noStore,
    limiter,
    requireUser,
    canManageBanners,
    validate(bannerMobileOnlySchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof bannerMobileOnlySchemas>(res);
      try {
        const old = await store.setBannerMobileImage(
          identity.accessToken,
          identity.userId,
          params.bannerId,
          null,
        );
        await removePicture(old, res);
        await answerBanner(res, identity.accessToken, params.bannerId);
      } catch (error) {
        sendAdminFailure(res, error, BANNER_ANSWERS);
      }
    },
  );

  router.delete(
    '/admin/banners/:bannerId',
    noStore,
    limiter,
    requireUser,
    canManageBanners,
    validate(bannerOnlySchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof bannerOnlySchemas>(res);
      try {
        const keys = await store.deleteBanner(
          identity.accessToken,
          identity.userId,
          params.bannerId,
        );
        for (const key of keys) await removePicture(key, res);
        res.status(204).end();
      } catch (error) {
        sendAdminFailure(res, error, BANNER_ANSWERS);
      }
    },
  );

  return router;
}
