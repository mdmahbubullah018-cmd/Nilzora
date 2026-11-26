import {
  homepageResponseSchema,
  navigationResponseSchema,
  saveSeoRequestSchema,
  saveStoreProfileRequestSchema,
  seoKindSchema,
  seoMetadataResponseSchema,
  seoOverviewQuerySchema,
  seoOverviewResponseSchema,
  SITE_PAGE_SLUGS,
  sitePageResponseSchema,
  sitemapResponseSchema,
  storeProfileResponseSchema,
  type PublicStoreProfile,
  type SeoMetadata,
  type SeoOverviewResponse,
  type SitemapResponse,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Router } from 'express';
import { z } from 'zod';
import { currentIdentity, requirePermission } from '../../middleware/authorize';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { requestInput, validate } from '../../middleware/validate';
import { sendError } from '../../http/send-error';
import { noStore, PUBLIC_CATALOG_CACHE, sendCommerceFailure } from '../commerce/http';
import type { SiteStore } from './store';

const seoParams = z.object({ kind: seoKindSchema, slug: z.string().trim().min(1).max(120) });
const productParams = z.object({ productId: uuidSchema });
const categoryParams = z.object({ categoryId: uuidSchema });

const pageReadSchemas = { params: z.object({ slug: z.enum(SITE_PAGE_SLUGS) }) };
const seoReadSchemas = { params: seoParams };
const productSeoSchemas = { params: productParams, body: saveSeoRequestSchema };
const categorySeoSchemas = { params: categoryParams, body: saveSeoRequestSchema };
const profileSchemas = { body: saveStoreProfileRequestSchema };
const overviewSchemas = { query: seoOverviewQuerySchema };

export interface SiteRouteDependencies extends AuthDependencies {
  site: SiteStore;
}

/**
 * The public face of the store: the resolved SEO metadata for one page, the sitemap's
 * content, and the store profile. None of these reads requires a session, and each is
 * answered by a function that only ever returns content a visitor may see.
 */
export function publicSiteRoutes(deps: SiteRouteDependencies): Router {
  const { site } = deps;
  const router = Router();

  router.get('/store/profile', async (_req, res) => {
    try {
      const profile: PublicStoreProfile = await site.publicProfile();
      res.set('Cache-Control', PUBLIC_CATALOG_CACHE);
      res.json(storeProfileResponseSchema.parse({ profile }));
    } catch (error) {
      sendCommerceFailure(res, error);
    }
  });

  /** A published static page; unwritten, unpublished and unknown pages are all a plain 404. */
  router.get('/store/pages/:slug', validate(pageReadSchemas), async (_req, res) => {
    const { params } = requestInput<typeof pageReadSchemas>(res);
    try {
      const page = await site.publicPage(params.slug);
      if (page === null) {
        sendError(res, 404, 'not_found', 'Page not found');
        return;
      }
      res.set('Cache-Control', PUBLIC_CATALOG_CACHE);
      res.json(sitePageResponseSchema.parse({ page }));
    } catch (error) {
      sendCommerceFailure(res, error);
    }
  });

  /** The active navigation links and the published pages (empty lists when none are set up). */
  router.get('/store/navigation', async (_req, res) => {
    try {
      const navigation = await site.publicNavigation();
      res.set('Cache-Control', PUBLIC_CATALOG_CACHE);
      res.json(navigationResponseSchema.parse({ navigation }));
    } catch (error) {
      sendCommerceFailure(res, error);
    }
  });

  /** The enabled homepage sections in order; an empty list means "use the built-in homepage". */
  router.get('/store/homepage', async (_req, res) => {
    try {
      const sections = await site.publicHomepage();
      res.set('Cache-Control', PUBLIC_CATALOG_CACHE);
      res.json(homepageResponseSchema.parse({ homepage: { sections } }));
    } catch (error) {
      sendCommerceFailure(res, error);
    }
  });

  router.get('/seo/sitemap', async (_req, res) => {
    try {
      const entries = await site.sitemap();
      const response: SitemapResponse = sitemapResponseSchema.parse({ entries });
      res.set('Cache-Control', PUBLIC_CATALOG_CACHE);
      res.json(response);
    } catch (error) {
      sendCommerceFailure(res, error);
    }
  });

  /** The metadata for one product or category page; 404 when a visitor may not see it. */
  router.get('/seo/:kind/:slug', validate(seoReadSchemas), async (_req, res) => {
    const { params } = requestInput<typeof seoReadSchemas>(res);
    try {
      const seo: SeoMetadata | null = await site.publicSeo(params.kind, params.slug);
      if (seo === null) {
        res.status(404).json({ error: { code: 'not_found', message: 'Page not found' } });
        return;
      }
      res.set('Cache-Control', PUBLIC_CATALOG_CACHE);
      res.json(seoMetadataResponseSchema.parse({ seo }));
    } catch (error) {
      sendCommerceFailure(res, error);
    }
  });

  return router;
}

/**
 * SEO and store-profile management. Reading needs products.read; changing needs
 * products.update; the store profile needs settings.manage. Every database function checks
 * the same permission again, so a gap here still could not act beyond the account.
 */
export function adminSiteRoutes(deps: SiteRouteDependencies): Router {
  const { site } = deps;
  const requireUser = authenticate(deps);
  const router = Router();

  router.get(
    '/admin/seo',
    noStore,
    requireUser,
    requirePermission('products.read'),
    validate(overviewSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof overviewSchemas>(res);
      try {
        const entries = await site.overview(identity.accessToken, identity.userId, query);
        const response: SeoOverviewResponse = seoOverviewResponseSchema.parse({ entries });
        res.json(response);
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  router.put(
    '/admin/seo/products/:productId',
    noStore,
    requireUser,
    requirePermission('products.read', 'products.update'),
    validate(productSeoSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof productSeoSchemas>(res);
      try {
        await site.saveProductSeo(identity.accessToken, identity.userId, params.productId, body);
        res.status(204).end();
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  router.put(
    '/admin/seo/categories/:categoryId',
    noStore,
    requireUser,
    requirePermission('products.read', 'products.update'),
    validate(categorySeoSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof categorySeoSchemas>(res);
      try {
        await site.saveCategorySeo(identity.accessToken, identity.userId, params.categoryId, body);
        res.status(204).end();
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  router.get(
    '/admin/store-profile',
    noStore,
    requireUser,
    requirePermission('settings.manage'),
    async (_req, res) => {
      const identity = currentIdentity(res);
      try {
        const profile = await site.adminProfile(identity.accessToken, identity.userId);
        res.json(storeProfileResponseSchema.parse({ profile }));
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  router.put(
    '/admin/store-profile',
    noStore,
    requireUser,
    requirePermission('settings.manage'),
    validate(profileSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof profileSchemas>(res);
      try {
        const profile = await site.saveProfile(identity.accessToken, identity.userId, body);
        res.json(storeProfileResponseSchema.parse({ profile }));
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  return router;
}
