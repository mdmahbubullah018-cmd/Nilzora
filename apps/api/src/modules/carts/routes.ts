import {
  cartResponseSchema,
  cartSetItemRequestSchema,
  checkoutConvertedRequestSchema,
  checkoutStartRequestSchema,
  guestCartSetItemRequestSchema,
  mergeGuestCartRequestSchema,
  type CartResponse,
  type CheckoutSessionResponse,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Router } from 'express';
import { z } from 'zod';
import { currentIdentity } from '../../middleware/authorize';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { requestInput, validate } from '../../middleware/validate';
import { noStore, sendCommerceFailure } from '../commerce/http';
import type { SavedCartStore } from './store';

const guestSchemas = { body: mergeGuestCartRequestSchema };
const guestItemSchemas = { body: guestCartSetItemRequestSchema };
const itemSchemas = { body: cartSetItemRequestSchema };
const checkoutSchemas = { body: checkoutStartRequestSchema };
const sessionSchemas = { params: z.object({ sessionId: uuidSchema }) };
const convertedSchemas = { params: sessionSchemas.params, body: checkoutConvertedRequestSchema };
const recoveryTokenSchemas = {
  params: z.object({ token: z.string().trim().regex(/^[0-9a-f]{64}$/i, 'A recovery token is 64 hex characters') }),
};

export interface CartRouteDependencies extends AuthDependencies {
  carts: SavedCartStore;
}

/**
 * Persisted carts for the storefront and the app. The cookie or device store only holds
 * the guest handle; prices, stock and totals stay with the quote and order functions, and
 * a checkout is converted only after an order really exists. Nothing here is cacheable.
 */
export function cartRoutes(deps: CartRouteDependencies): Router {
  const { carts } = deps;
  const requireUser = authenticate(deps);
  const router = Router();

  /*
   * A recovery link. The token is the capability and is the only thing in the URL, so the
   * preview answers with a count, a value and an expiry — never a name, a phone or a product.
   * Restoring needs a session and is refused unless the caller owns that checkout.
   */
  router.get('/checkout/recovery/:token', noStore, validate(recoveryTokenSchemas), async (_req, res) => {
    const { params } = requestInput<typeof recoveryTokenSchemas>(res);
    try {
      const preview = await carts.previewRecovery(params.token);
      res.json(preview);
    } catch (error) {
      sendCommerceFailure(res, error);
    }
  });

  router.post(
    '/checkout/recovery/:token/restore',
    noStore,
    requireUser,
    validate(recoveryTokenSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof recoveryTokenSchemas>(res);
      try {
        const result = await carts.restoreRecovery(identity.accessToken, identity.userId, params.token);
        res.json(result);
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  router.get('/me/cart', noStore, requireUser, async (_req, res) => {
    const identity = currentIdentity(res);
    try {
      const cart = await carts.myCart(identity.accessToken, identity.userId);
      const response: CartResponse = cartResponseSchema.parse(cart);
      res.json(response);
    } catch (error) {
      sendCommerceFailure(res, error);
    }
  });

  router.put('/me/cart/items', noStore, requireUser, validate(itemSchemas), async (_req, res) => {
    const identity = currentIdentity(res);
    const { body } = requestInput<typeof itemSchemas>(res);
    try {
      const cart = await carts.setItem(identity.accessToken, identity.userId, {
        productId: body.productId,
        variantId: body.variantId,
        quantity: body.quantity,
      });
      res.json(cartResponseSchema.parse(cart));
    } catch (error) {
      sendCommerceFailure(res, error);
    }
  });

  router.post(
    '/me/cart/merge',
    noStore,
    requireUser,
    validate(guestSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof guestSchemas>(res);
      try {
        const cart = await carts.mergeGuestCart(identity.accessToken, identity.userId, body.token);
        res.json(cartResponseSchema.parse(cart));
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  /**
   * Creates the guest cart for a handle the browser or device chose, or returns it if it
   * already exists. The handle is the whole permission, so it is never echoed in a log.
   */
  router.post('/guest/cart', noStore, validate(guestSchemas), async (_req, res) => {
    const { body } = requestInput<typeof guestSchemas>(res);
    try {
      const cart = await carts.startGuestCart(body.token);
      res.json(cartResponseSchema.parse(cart));
    } catch (error) {
      sendCommerceFailure(res, error);
    }
  });

  /** The guest line write. Quantity 0 removes the line, so this covers add/update/remove. */
  router.put('/guest/cart/items', noStore, validate(guestItemSchemas), async (_req, res) => {
    const { body } = requestInput<typeof guestItemSchemas>(res);
    try {
      const cart = await carts.setGuestItem(body.token, {
        productId: body.productId,
        variantId: body.variantId,
        quantity: body.quantity,
      });
      res.json(cartResponseSchema.parse(cart));
    } catch (error) {
      sendCommerceFailure(res, error);
    }
  });

  /** Forgets a guest cart's lines. Unknown or consumed handles answer 204 all the same. */
  router.post('/guest/cart/clear', noStore, validate(guestSchemas), async (_req, res) => {
    const { body } = requestInput<typeof guestSchemas>(res);
    try {
      await carts.clearGuestCart(body.token);
      res.status(204).end();
    } catch (error) {
      sendCommerceFailure(res, error);
    }
  });

  router.post('/me/cart/clear', noStore, requireUser, async (_req, res) => {
    const identity = currentIdentity(res);
    try {
      const cart = await carts.clearCart(identity.accessToken, identity.userId);
      res.json(cartResponseSchema.parse(cart));
    } catch (error) {
      sendCommerceFailure(res, error);
    }
  });

  router.post(
    '/checkout/sessions',
    noStore,
    requireUser,
    validate(checkoutSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof checkoutSchemas>(res);
      try {
        const checkout = await carts.startCheckout(identity.accessToken, identity.userId, {
          ...(body.addressId === null || body.addressId === undefined
            ? {}
            : { addressId: body.addressId }),
          ...(body.couponCode === undefined ? {} : { couponCode: body.couponCode }),
        });
        const response: CheckoutSessionResponse = checkout;
        res.status(201).json(response);
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  router.post(
    '/checkout/sessions/:sessionId/activity',
    noStore,
    requireUser,
    validate(sessionSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof sessionSchemas>(res);
      try {
        await carts.checkoutActivity(identity.accessToken, identity.userId, params.sessionId);
        res.status(204).end();
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  /** Called by the checkout screen only after placeOrder answered with an order. */
  router.post(
    '/checkout/sessions/:sessionId/converted',
    noStore,
    requireUser,
    validate(convertedSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof convertedSchemas>(res);
      try {
        await carts.checkoutConverted(identity.accessToken, identity.userId, body.orderNumber);
        res.status(204).end();
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  return router;
}
