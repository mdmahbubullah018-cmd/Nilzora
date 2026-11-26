import {
  wishlistAddRequestSchema,
  wishlistMergeRequestSchema,
  wishlistResponseSchema,
  type WishlistResponse,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { currentIdentity } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { sendAdminFailure } from '../admin/errors';
import { noStore } from '../commerce/http';
import type { WishlistStore } from './store';

const addSchemas = { body: wishlistAddRequestSchema };

/** The refusals a wishlist call can meet, in the shop's own words. */
const WISHLIST_ANSWERS = {
  not_found: [404, 'not_found', 'This product is no longer available to save.'],
  missing_permission: [403, 'forbidden', 'Your account cannot change this wishlist.'],
} as const;
const itemSchemas = { params: z.object({ productId: uuidSchema }) };
const mergeSchemas = { body: wishlistMergeRequestSchema };

export interface WishlistRouteDependencies extends AuthDependencies {
  wishlist: WishlistStore;
}

/**
 * The signed-in customer's wishlist. Every answer is the whole list as the database now
 * holds it, so a client never has to guess whether a change landed; adding something that
 * is already saved, or removing something that is not, succeeds without duplicating or
 * failing. Nothing here is cacheable.
 */
export function wishlistRoutes(deps: WishlistRouteDependencies): Router {
  const { wishlist } = deps;
  const requireUser = authenticate(deps);
  const router = Router();

  function answer(res: Parameters<typeof sendAdminFailure>[0], body: WishlistResponse): void {
    res.json(wishlistResponseSchema.parse(body));
  }

  router.get('/me/wishlist', noStore, requireUser, async (_req, res) => {
    const identity = currentIdentity(res);
    try {
      answer(res, await wishlist.myWishlist(identity.accessToken, identity.userId));
    } catch (error) {
      sendAdminFailure(res, error, WISHLIST_ANSWERS);
    }
  });

  router.post('/me/wishlist', noStore, requireUser, validate(addSchemas), async (_req, res) => {
    const identity = currentIdentity(res);
    const { body } = requestInput<typeof addSchemas>(res);
    try {
      answer(res, await wishlist.add(identity.accessToken, identity.userId, body.productId));
    } catch (error) {
      sendAdminFailure(res, error, WISHLIST_ANSWERS);
    }
  });

  router.delete('/me/wishlist/:productId', noStore, requireUser, validate(itemSchemas), async (_req, res) => {
    const identity = currentIdentity(res);
    const { params } = requestInput<typeof itemSchemas>(res);
    try {
      answer(res, await wishlist.remove(identity.accessToken, identity.userId, params.productId));
    } catch (error) {
      sendAdminFailure(res, error, WISHLIST_ANSWERS);
    }
  });

  // The guest list, folded into the account after sign-in. Safe to call again.
  router.post('/me/wishlist/merge', noStore, requireUser, validate(mergeSchemas), async (_req, res) => {
    const identity = currentIdentity(res);
    const { body } = requestInput<typeof mergeSchemas>(res);
    try {
      answer(res, await wishlist.merge(identity.accessToken, identity.userId, body.slugs));
    } catch (error) {
      sendAdminFailure(res, error, WISHLIST_ANSWERS);
    }
  });

  return router;
}
