import {
  reorderMenuRequestSchema,
  saveHomepageRequestSchema,
  saveMenuItemRequestSchema,
  saveSitePageRequestSchema,
  SITE_PAGE_SLUGS,
  type AdminHomepageResponse,
  type AdminSitePageListResponse,
  type AdminSitePageResponse,
  type MenuItemListResponse,
  type MenuItemResponse,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Router } from 'express';
import { z } from 'zod';
import { currentIdentity, requirePermission } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { noStore } from '../commerce/http';
import { sendAdminFailure, type AdminRefusal, type RefusalAnswer } from './errors';
import type { AdminRouteDependencies } from './routes';

const slugParams = z.object({ slug: z.enum(SITE_PAGE_SLUGS) });
const idParams = z.object({ id: uuidSchema });

const pageSchemas = { params: slugParams, body: saveSitePageRequestSchema };
const createItemSchemas = { body: saveMenuItemRequestSchema };
const updateItemSchemas = { params: idParams, body: saveMenuItemRequestSchema };
const deleteItemSchemas = { params: idParams };
const reorderSchemas = { body: reorderMenuRequestSchema };
const homepageSchemas = { body: saveHomepageRequestSchema };

const PAGE_ANSWERS: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  not_found: [404, 'not_found', 'Page not found'],
  invalid_input: [400, 'bad_request', 'Check the title and the text of the page'],
};
const MENU_ANSWERS: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  not_found: [404, 'not_found', 'Link not found'],
  invalid_input: [
    400,
    'bad_request',
    'Check the menu, the label and the link (a menu holds at most 12 links)',
  ],
};
const HOMEPAGE_ANSWERS: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  invalid_input: [400, 'bad_request', 'List every homepage section once, with valid settings'],
};

/**
 * GET/PUT /admin/site-pages, GET/POST/PUT/DELETE /admin/navigation (with PUT
 * /admin/navigation/order) and GET/PUT /admin/homepage: the pages, links and homepage
 * sections the storefront shows. All of it needs settings.manage, which the database
 * function behind each route checks again for the caller, and every change is audited.
 */
export function adminContentRouter(deps: AdminRouteDependencies): Router {
  const router = Router();
  const content = deps.stores.content;
  if (!content) return router;
  const { requireUser, limiter } = deps;
  const canManage = requirePermission('settings.manage');

  router.get('/admin/site-pages', noStore, requireUser, canManage, async (_req, res) => {
    const identity = currentIdentity(res);
    const response: AdminSitePageListResponse = {
      pages: await content.listPages(identity.accessToken, identity.userId),
    };
    res.json(response);
  });

  router.put(
    '/admin/site-pages/:slug',
    noStore,
    limiter,
    requireUser,
    canManage,
    validate(pageSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof pageSchemas>(res);
      try {
        const response: AdminSitePageResponse = {
          page: await content.savePage(identity.accessToken, identity.userId, params.slug, body),
        };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, PAGE_ANSWERS);
      }
    },
  );

  router.get('/admin/navigation', noStore, requireUser, canManage, async (_req, res) => {
    const identity = currentIdentity(res);
    const response: MenuItemListResponse = {
      items: await content.listMenuItems(identity.accessToken, identity.userId),
    };
    res.json(response);
  });

  // Registered before /:id, which would otherwise take "order" for an id.
  router.put(
    '/admin/navigation/order',
    noStore,
    limiter,
    requireUser,
    canManage,
    validate(reorderSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof reorderSchemas>(res);
      try {
        const response: MenuItemListResponse = {
          items: await content.reorderMenu(
            identity.accessToken,
            identity.userId,
            body.menu,
            body.ids,
          ),
        };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, MENU_ANSWERS);
      }
    },
  );

  router.post(
    '/admin/navigation',
    noStore,
    limiter,
    requireUser,
    canManage,
    validate(createItemSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof createItemSchemas>(res);
      try {
        const response: MenuItemResponse = {
          item: await content.saveMenuItem(identity.accessToken, identity.userId, null, body),
        };
        res.status(201).json(response);
      } catch (error) {
        sendAdminFailure(res, error, MENU_ANSWERS);
      }
    },
  );

  router.put(
    '/admin/navigation/:id',
    noStore,
    limiter,
    requireUser,
    canManage,
    validate(updateItemSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof updateItemSchemas>(res);
      try {
        const response: MenuItemResponse = {
          item: await content.saveMenuItem(identity.accessToken, identity.userId, params.id, body),
        };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, MENU_ANSWERS);
      }
    },
  );

  router.delete(
    '/admin/navigation/:id',
    noStore,
    limiter,
    requireUser,
    canManage,
    validate(deleteItemSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof deleteItemSchemas>(res);
      try {
        await content.deleteMenuItem(identity.accessToken, identity.userId, params.id);
        res.status(204).end();
      } catch (error) {
        sendAdminFailure(res, error, MENU_ANSWERS);
      }
    },
  );

  router.get('/admin/homepage', noStore, requireUser, canManage, async (_req, res) => {
    const identity = currentIdentity(res);
    const response: AdminHomepageResponse = {
      sections: await content.listHomepage(identity.accessToken, identity.userId),
    };
    res.json(response);
  });

  router.put(
    '/admin/homepage',
    noStore,
    limiter,
    requireUser,
    canManage,
    validate(homepageSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof homepageSchemas>(res);
      try {
        const response: AdminHomepageResponse = {
          sections: await content.saveHomepage(
            identity.accessToken,
            identity.userId,
            body.sections,
          ),
        };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, HOMEPAGE_ANSWERS);
      }
    },
  );

  return router;
}
