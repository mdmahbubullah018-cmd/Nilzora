import {
  cartQuoteRequestSchema,
  checkoutQuoteRequestSchema,
  type CartQuoteResponse,
  type CheckoutQuoteResponse,
} from '@nilzora/contracts';
import { Router } from 'express';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { currentIdentity } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { noStore, sendCommerceFailure } from '../commerce/http';
import type { CartStore } from './store';

const cartQuoteSchemas = { body: cartQuoteRequestSchema };
const checkoutQuoteSchemas = { body: checkoutQuoteRequestSchema };

/**
 * POST /cart/quote (anyone) and POST /checkout/quote (signed in, with one of the
 * caller's addresses). Clients send product ids and quantities only; every price,
 * delivery charge and total in the answer comes from the database.
 */
export function cartRouter(deps: AuthDependencies & { cart: CartStore }): Router {
  const router = Router();

  router.post('/cart/quote', noStore, validate(cartQuoteSchemas), async (_req, res) => {
    const { body } = requestInput<typeof cartQuoteSchemas>(res);
    try {
      const response: CartQuoteResponse = { quote: await deps.cart.quote(body.items) };
      res.json(response);
    } catch (error) {
      sendCommerceFailure(res, error);
    }
  });

  router.post(
    '/checkout/quote',
    noStore,
    authenticate(deps),
    validate(checkoutQuoteSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof checkoutQuoteSchemas>(res);
      try {
        const quote = await deps.cart.quoteForCustomer(
          identity.accessToken,
          identity.userId,
          body.items,
          body.addressId,
          body.couponCode,
        );
        const response: CheckoutQuoteResponse = { quote };
        res.json(response);
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  return router;
}
