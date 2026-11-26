import {
  adminCheckoutListQuerySchema,
  checkoutListResponseSchema,
  checkoutRecoveryLinkResponseSchema,
  checkoutRecoveryMetricsResponseSchema,
  checkoutResponseSchema,
  recordCheckoutAttemptRequestSchema,
  setCheckoutRecoveryStateRequestSchema,
  type CheckoutListResponse,
  type CheckoutRecoveryMetrics,
  type CheckoutResponse,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Router } from 'express';
import { z } from 'zod';
import { sendError } from '../../http/send-error';
import { currentIdentity, requirePermission } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { noStore } from '../commerce/http';
import { sendAdminFailure, type AdminRefusal, type RefusalAnswer } from './errors';
import type { AdminRouteDependencies } from './routes';
import { pageInfo, pageOf } from './shared';

const checkoutParams = z.object({ checkoutId: uuidSchema });
const metricsSchemas = {
  query: z.object({
    from: z.string().trim().max(40).default(''),
    to: z.string().trim().max(40).default(''),
  }),
};

const listSchemas = { query: adminCheckoutListQuerySchema };
const detailSchemas = { params: checkoutParams };
const attemptSchemas = { params: checkoutParams, body: recordCheckoutAttemptRequestSchema };
const stateSchemas = { params: checkoutParams, body: setCheckoutRecoveryStateRequestSchema };

const CHECKOUT_ANSWERS: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  not_found: [404, 'not_found', 'Checkout not found'],
  invalid_input: [400, 'bad_request', 'Check the status, the dates and the search text'],
  missing_permission: [403, 'forbidden', 'Your account cannot read checkouts'],
  recovery_invalid: [400, 'bad_request', 'That action is not possible for this checkout'],
  recovery_link_invalid: [409, 'recovery_link_invalid', 'That recovery link is no longer usable'],
  recovery_not_owner: [403, 'forbidden', 'That recovery link belongs to another customer'],
};

/**
 * Abandoned checkouts.
 *
 * Reading needs `orders.read`; acting on a record needs `checkouts.recover`, which moderators
 * do not hold. Every rule — what counts as abandoned, what a recovery rate means, whether a
 * link is still usable — is decided by the database function, not here. This router only
 * validates the input, passes the caller's own token through, and shapes the answer.
 */
export function adminCheckoutRouter(deps: AdminRouteDependencies): Router {
  const router = Router();
  const { checkouts } = deps.stores;
  const { requireUser } = deps;
  if (!checkouts) return router;

  const canRead = requirePermission('orders.read');
  const canAct = requirePermission('checkouts.recover');

  router.get(
    '/admin/checkouts/metrics',
    noStore,
    requireUser,
    canRead,
    validate(metricsSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof metricsSchemas>(res);
      try {
        const metrics: CheckoutRecoveryMetrics = await checkouts.checkoutMetrics(
          identity.accessToken,
          identity.userId,
          { from: query.from === '' ? null : query.from, to: query.to === '' ? null : query.to },
        );
        res.json(checkoutRecoveryMetricsResponseSchema.parse({ metrics }));
      } catch (error) {
        sendAdminFailure(res, error, CHECKOUT_ANSWERS);
      }
    },
  );

  router.get(
    '/admin/checkouts',
    noStore,
    requireUser,
    canRead,
    validate(listSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof listSchemas>(res);
      try {
        const { checkouts: rows, total } = await checkouts.listCheckouts(
          identity.accessToken,
          identity.userId,
          query,
          pageOf(query),
        );
        const response: CheckoutListResponse = checkoutListResponseSchema.parse({
          checkouts: rows,
          ...pageInfo(query, total),
        });
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, CHECKOUT_ANSWERS);
      }
    },
  );

  router.get(
    '/admin/checkouts/:checkoutId',
    noStore,
    requireUser,
    canRead,
    validate(detailSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof detailSchemas>(res);
      try {
        const checkout = await checkouts.getCheckout(
          identity.accessToken,
          identity.userId,
          params.checkoutId,
        );
        if (checkout === null) {
          sendError(res, 404, 'not_found', 'Checkout not found');
          return;
        }
        const response: CheckoutResponse = checkoutResponseSchema.parse({ checkout });
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, CHECKOUT_ANSWERS);
      }
    },
  );

  router.post(
    '/admin/checkouts/:checkoutId/attempts',
    noStore,
    requireUser,
    canAct,
    validate(attemptSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof attemptSchemas>(res);
      try {
        const checkout = await checkouts.recordCheckoutAttempt(
          identity.accessToken,
          identity.userId,
          params.checkoutId,
          { channel: body.channel, ...(body.note === undefined ? {} : { note: body.note }) },
        );
        const response: CheckoutResponse = checkoutResponseSchema.parse({ checkout });
        res.status(201).json(response);
      } catch (error) {
        sendAdminFailure(res, error, CHECKOUT_ANSWERS);
      }
    },
  );

  router.post(
    '/admin/checkouts/:checkoutId/state',
    noStore,
    requireUser,
    canAct,
    validate(stateSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof stateSchemas>(res);
      try {
        const checkout = await checkouts.setCheckoutRecoveryState(
          identity.accessToken,
          identity.userId,
          params.checkoutId,
          body.state,
        );
        const response: CheckoutResponse = checkoutResponseSchema.parse({ checkout });
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, CHECKOUT_ANSWERS);
      }
    },
  );

  router.post(
    '/admin/checkouts/:checkoutId/link',
    noStore,
    requireUser,
    canAct,
    validate(detailSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof detailSchemas>(res);
      try {
        const link = await checkouts.createCheckoutRecoveryLink(
          identity.accessToken,
          identity.userId,
          params.checkoutId,
        );
        res.status(201).json(checkoutRecoveryLinkResponseSchema.parse(link));
      } catch (error) {
        sendAdminFailure(res, error, CHECKOUT_ANSWERS);
      }
    },
  );

  router.delete(
    '/admin/checkouts/:checkoutId/link',
    noStore,
    requireUser,
    canAct,
    validate(detailSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof detailSchemas>(res);
      try {
        const checkout = await checkouts.revokeCheckoutRecoveryLink(
          identity.accessToken,
          identity.userId,
          params.checkoutId,
        );
        const response: CheckoutResponse = checkoutResponseSchema.parse({ checkout });
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, CHECKOUT_ANSWERS);
      }
    },
  );

  return router;
}
