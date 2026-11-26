import {
  adminPopupListResponseSchema,
  adminPopupResponseSchema,
  popupResponseSchema,
  savePopupSchema,
  setPopupActiveSchema,
  type AdminPopupListResponse,
  type AdminPopupResponse,
  type PopupResponse,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { currentIdentity, requirePermission } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { sendAdminFailure } from '../admin/errors';
import { PUBLIC_CATALOG_CACHE, noStore } from '../commerce/http';
import type { MediaStorage } from '../media/object-store';
import { requireStorage } from '../media/upload';
import {
  createPopupArtworkUploads,
  popupArtworkContentType,
  readPopupArtworkBody,
} from './artwork';
import type { PopupStore } from './store';

const popupParams = z.object({ popupId: uuidSchema });
const publicSchemas = {
  query: z.object({ platform: z.enum(['website', 'app']).default('website') }),
};

const createSchemas = { body: savePopupSchema };
const editSchemas = { params: popupParams, body: savePopupSchema };
const readSchemas = { params: popupParams };
const activeSchemas = { params: popupParams, body: setPopupActiveSchema };

export interface PopupRouteDependencies extends AuthDependencies {
  popups: PopupStore;
  /** Media storage; absent in a build without R2, where artwork uploads answer 503. */
  storage?: MediaStorage | undefined;
}

/**
 * The customer-facing read: one popup or none.
 *
 * The database decides what a customer may see — switched on, and inside its window — so the
 * route takes no identity and the payload carries no management field. Cached for the same
 * short window as the rest of the public catalog: every page asks for it, the answer changes
 * only when an admin saves something, and a popup switched off therefore disappears within a
 * minute everywhere. `delaySeconds` and `frequency` travel with the payload, so a client that
 * holds a copy knows exactly how to behave with it.
 */
export function popupRoutes(deps: PopupRouteDependencies): Router {
  const { popups } = deps;
  const router = Router();

  router.get('/popups', validate(publicSchemas), async (_req, res) => {
    try {
      const { query } = requestInput<typeof publicSchemas>(res);
      const list = await popups.publicPopups(query.platform);
      const response: PopupResponse = popupResponseSchema.parse({
        popup: list[0] ?? null,
        popups: list,
      });
      res.set('Cache-Control', PUBLIC_CATALOG_CACHE).json(response);
    } catch (error) {
      sendAdminFailure(res, error);
    }
  });

  return router;
}

/**
 * Management. Every route requires the same permission the Settings screens do, and the database
 * checks it again inside each function, so a gap here still could not act beyond the account.
 *
 * Artwork is uploaded separately from the copy: the bytes are validated and stored first, and the
 * key is recorded in a second step, so the previous picture is deleted only once the new one is
 * committed. A failure at any point leaves a popup with its old picture rather than a broken one.
 */
export function adminPopupRoutes(deps: PopupRouteDependencies): Router {
  const { popups, storage } = deps;
  const requireUser = authenticate(deps);
  const canManage = requirePermission('settings.manage');
  const guard = [noStore, requireUser, canManage] as const;
  const requireMedia = requireStorage(storage);
  const artwork = createPopupArtworkUploads(storage);
  const router = Router();

  /** Answers with the popup as it now stands, or 404 when it has gone. */
  async function answer(res: Response, popupId: string, status = 200): Promise<void> {
    const identity = currentIdentity(res);
    const popup = await popups.get(identity.accessToken, identity.userId, popupId);
    if (popup === null) {
      res.status(404).json({
        error: { code: 'popup_not_found', message: 'That popup no longer exists' },
      });
      return;
    }
    const body: AdminPopupResponse = adminPopupResponseSchema.parse({ popup });
    res.status(status).json(body);
  }

  router.get('/admin/popups', ...guard, async (_req, res) => {
    const identity = currentIdentity(res);
    try {
      const list = await popups.list(identity.accessToken, identity.userId);
      const response: AdminPopupListResponse = adminPopupListResponseSchema.parse({ popups: list });
      res.json(response);
    } catch (error) {
      sendAdminFailure(res, error);
    }
  });

  router.post('/admin/popups', ...guard, validate(createSchemas), async (_req, res) => {
    const identity = currentIdentity(res);
    const { body } = requestInput<typeof createSchemas>(res);
    try {
      const popupId = await popups.save(identity.accessToken, identity.userId, null, body);
      await answer(res, popupId, 201);
    } catch (error) {
      sendAdminFailure(res, error);
    }
  });

  router.get('/admin/popups/:popupId', ...guard, validate(readSchemas), async (_req, res) => {
    const { params } = requestInput<typeof readSchemas>(res);
    try {
      await answer(res, params.popupId);
    } catch (error) {
      sendAdminFailure(res, error);
    }
  });

  router.put('/admin/popups/:popupId', ...guard, validate(editSchemas), async (_req, res) => {
    const identity = currentIdentity(res);
    const { params, body } = requestInput<typeof editSchemas>(res);
    try {
      await popups.save(identity.accessToken, identity.userId, params.popupId, body);
      await answer(res, params.popupId);
    } catch (error) {
      sendAdminFailure(res, error);
    }
  });

  router.post(
    '/admin/popups/:popupId/image',
    ...guard,
    validate(readSchemas),
    popupArtworkContentType,
    requireMedia,
    readPopupArtworkBody,
    async (req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof readSchemas>(res);
      let stored: Awaited<ReturnType<typeof artwork.store>>;
      try {
        stored = await artwork.store(req.body as unknown, res, params.popupId);
      } catch (error) {
        sendAdminFailure(res, error);
        return;
      }
      if (stored === null) return;
      try {
        const replaced = await popups.setArtwork(
          identity.accessToken,
          identity.userId,
          params.popupId,
          stored,
        );
        await artwork.remove(replaced, res);
      } catch (error) {
        // The row still records the old picture, so what was just written is an orphan.
        await artwork.remove(stored.key, res);
        sendAdminFailure(res, error);
        return;
      }
      try {
        await answer(res, params.popupId);
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.delete(
    '/admin/popups/:popupId/image',
    ...guard,
    validate(readSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof readSchemas>(res);
      try {
        const replaced = await popups.setArtwork(
          identity.accessToken,
          identity.userId,
          params.popupId,
          null,
        );
        await artwork.remove(replaced, res);
        await answer(res, params.popupId);
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.delete('/admin/popups/:popupId', ...guard, validate(readSchemas), async (_req, res) => {
    const identity = currentIdentity(res);
    const { params } = requestInput<typeof readSchemas>(res);
    try {
      const key = await popups.remove(identity.accessToken, identity.userId, params.popupId);
      await artwork.remove(key, res);
      res.status(204).end();
    } catch (error) {
      sendAdminFailure(res, error);
    }
  });

  router.post(
    '/admin/popups/:popupId/active',
    ...guard,
    validate(activeSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof activeSchemas>(res);
      try {
        await popups.setActive(identity.accessToken, identity.userId, params.popupId, body.active);
        res.status(204).end();
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  return router;
}
