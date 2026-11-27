import {
  returnListResponseSchema,
  returnRequestSchema,
  returnResponseSchema,
  type MyRefundsResponse,
  type ReturnListResponse,
  type ReturnResponse,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Router } from 'express';
import { z } from 'zod';
import { sendError } from '../../http/send-error';
import { currentIdentity } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { noStore, sendCommerceFailure } from '../commerce/http';
import type { AfterSalesStore } from './store';

const returnParams = z.object({ returnId: uuidSchema });
const orderParams = z.object({ orderNumber: z.string().trim().min(3).max(30) });

const returnSchemas = { body: returnRequestSchema };
const detailSchemas = { params: returnParams };
const orderSchemas = { params: orderParams };

export interface AfterSalesRouteDependencies extends AuthDependencies {
  afterSales: AfterSalesStore;
}

/**
 * The customer's own after-sales: asking to return items of a delivered order, following
 * that request, and seeing the refunds recorded on an order. Every route needs a signed-in
 * account, and the database functions filter on the caller's own rows.
 */
export function afterSalesRoutes(deps: AfterSalesRouteDependencies): Router {
  const { afterSales } = deps;
  const requireUser = authenticate(deps);
  const router = Router();

  router.get('/returns', noStore, requireUser, async (_req, res) => {
    const identity = currentIdentity(res);
    try {
      const returns = await afterSales.myReturns(identity.accessToken, identity.userId);
      // One unpaged list: pageSize must still be a positive number, so an empty list
      // answers 1 rather than failing the contract on the way out.
      const response: ReturnListResponse = returnListResponseSchema.parse({
        returns,
        page: 1,
        pageSize: Math.max(returns.length, 1),
        total: returns.length,
        totalPages: returns.length === 0 ? 0 : 1,
      });
      res.json(response);
    } catch (error) {
      sendCommerceFailure(res, error);
    }
  });

  router.post('/returns', noStore, requireUser, validate(returnSchemas), async (_req, res) => {
    const identity = currentIdentity(res);
    const { body } = requestInput<typeof returnSchemas>(res);
    try {
      const returnId = await afterSales.requestReturn(identity.accessToken, identity.userId, body);
      const request = await afterSales.myReturn(identity.accessToken, identity.userId, returnId);
      if (request === null) {
        sendError(res, 404, 'not_found', 'Return not found');
        return;
      }
      const response: ReturnResponse = returnResponseSchema.parse({ return: request });
      res.status(201).json(response);
    } catch (error) {
      sendCommerceFailure(res, error);
    }
  });

  router.get(
    '/returns/:returnId',
    noStore,
    requireUser,
    validate(detailSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof detailSchemas>(res);
      try {
        const request = await afterSales.myReturn(
          identity.accessToken,
          identity.userId,
          params.returnId,
        );
        if (request === null) {
          sendError(res, 404, 'not_found', 'Return not found');
          return;
        }
        const response: ReturnResponse = returnResponseSchema.parse({ return: request });
        res.json(response);
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  router.post(
    '/returns/:returnId/cancel',
    noStore,
    requireUser,
    validate(detailSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof detailSchemas>(res);
      try {
        await afterSales.cancelMyReturn(identity.accessToken, identity.userId, params.returnId);
        res.status(204).end();
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  router.get(
    '/orders/:orderNumber/refunds',
    noStore,
    requireUser,
    validate(orderSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof orderSchemas>(res);
      try {
        const refunds = await afterSales.myRefunds(
          identity.accessToken,
          identity.userId,
          params.orderNumber,
        );
        const response: MyRefundsResponse = { refunds };
        res.json(response);
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  return router;
}
