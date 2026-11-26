import {
  addressInputSchema,
  type AddressListResponse,
  type AddressResponse,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Router } from 'express';
import { z } from 'zod';
import { sendError } from '../../http/send-error';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { currentIdentity } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { noStore, sendCommerceFailure } from '../commerce/http';
import type { AddressStore } from './store';

const createSchemas = { body: addressInputSchema };
const addressIdParams = z.object({ id: uuidSchema });
const updateSchemas = { params: addressIdParams, body: addressInputSchema };
const deleteSchemas = { params: addressIdParams };

/**
 * GET/POST /me/addresses and PUT/DELETE /me/addresses/:id — the caller's own
 * delivery addresses. The owner always comes from the verified token; the database
 * enforces the same rule, and another account's address answers 404 like a missing one.
 */
export function addressesRouter(deps: AuthDependencies & { addresses: AddressStore }): Router {
  const router = Router();
  const requireUser = authenticate(deps);
  const notFound = 'Address not found';

  router.get('/me/addresses', noStore, requireUser, async (_req, res) => {
    const identity = currentIdentity(res);
    const response: AddressListResponse = {
      addresses: await deps.addresses.list(identity.accessToken, identity.userId),
    };
    res.json(response);
  });

  router.post('/me/addresses', noStore, requireUser, validate(createSchemas), async (_req, res) => {
    const identity = currentIdentity(res);
    const { body } = requestInput<typeof createSchemas>(res);
    try {
      const address = await deps.addresses.create(identity.accessToken, identity.userId, body);
      const response: AddressResponse = { address };
      res.status(201).json(response);
    } catch (error) {
      sendCommerceFailure(res, error);
    }
  });

  router.put(
    '/me/addresses/:id',
    noStore,
    requireUser,
    validate(updateSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof updateSchemas>(res);
      const address = await deps.addresses.update(
        identity.accessToken,
        identity.userId,
        params.id,
        body,
      );
      if (!address) {
        sendError(res, 404, 'not_found', notFound);
        return;
      }
      const response: AddressResponse = { address };
      res.json(response);
    },
  );

  router.delete(
    '/me/addresses/:id',
    noStore,
    requireUser,
    validate(deleteSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof deleteSchemas>(res);
      if (!(await deps.addresses.remove(identity.accessToken, identity.userId, params.id))) {
        sendError(res, 404, 'not_found', notFound);
        return;
      }
      res.status(204).end();
    },
  );

  return router;
}
