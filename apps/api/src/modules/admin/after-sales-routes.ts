import {
  adminRefundListQuerySchema,
  adminReturnListQuerySchema,
  refundCancelRequestSchema,
  refundCompletionRequestSchema,
  refundDecisionRequestSchema,
  refundListResponseSchema,
  refundRequestSchema,
  refundResponseSchema,
  returnDecisionRequestSchema,
  returnListResponseSchema,
  returnResponseSchema,
  type RefundListResponse,
  type RefundResponse,
  type ReturnListResponse,
  type ReturnResponse,
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

const returnParams = z.object({ returnId: uuidSchema });
const refundParams = z.object({ refundId: uuidSchema });

const listReturnSchemas = { query: adminReturnListQuerySchema };
const returnDetailSchemas = { params: returnParams };
const returnDecisionSchemas = { params: returnParams, body: returnDecisionRequestSchema };
const restockSchemas = {
  params: returnParams,
  body: z.strictObject({ note: z.string().trim().max(300).optional() }),
};
const listRefundSchemas = { query: adminRefundListQuerySchema };
const refundDetailSchemas = { params: refundParams };
const refundCreateSchemas = { body: refundRequestSchema };
const refundDecisionSchemas = { params: refundParams, body: refundDecisionRequestSchema };
const refundCompletionSchemas = { params: refundParams, body: refundCompletionRequestSchema };
const refundCancelSchemas = { params: refundParams, body: refundCancelRequestSchema };

const RETURN_ANSWERS: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  not_found: [404, 'not_found', 'Return not found'],
  invalid_input: [400, 'bad_request', 'Check the note and the chosen quantity'],
  return_not_eligible: [409, 'return_not_eligible', 'That return cannot be decided now'],
  return_closed: [409, 'return_closed', 'This return has already moved on'],
  missing_permission: [403, 'forbidden', 'Your account cannot decide returns'],
  stock_below_zero: [409, 'stock_below_zero', 'Stock cannot go below zero'],
};

const REFUND_ANSWERS: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  not_found: [404, 'not_found', 'Refund not found'],
  invalid_input: [400, 'bad_request', 'Check the amount, the reason and the reference'],
  refund_exceeds_balance: [
    409,
    'refund_exceeds_balance',
    'The amount is more than this order can still refund',
  ],
  refund_not_decidable: [409, 'refund_not_decidable', 'This refund is no longer waiting for a decision'],
  refund_not_completable: [
    409,
    'refund_not_completable',
    'Approve the refund before recording the payout',
  ],
  missing_permission: [403, 'forbidden', 'Your account cannot manage refunds'],
};

/**
 * Returns and refunds for staff. Reading needs orders.read; a decision needs
 * orders.update_status; restocking needs inventory.adjust; refunds need refunds.request and
 * refunds.approve. Every database function checks the same permission again for the caller,
 * so a missing check here still could not act beyond the account's authority.
 */
export function adminAfterSalesRouter(deps: AdminRouteDependencies): Router {
  const router = Router();
  const { afterSales } = deps.stores;
  const { requireUser, limiter } = deps;
  if (!afterSales) return router;

  const canRead = requirePermission('orders.read');
  const canDecide = requirePermission('orders.read', 'orders.update_status');
  const canRestock = requirePermission('orders.read', 'inventory.adjust');
  const canRequest = requirePermission('orders.read', 'refunds.request');
  const canApprove = requirePermission('orders.read', 'refunds.approve');

  router.get(
    '/admin/returns',
    noStore,
    requireUser,
    canRead,
    validate(listReturnSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof listReturnSchemas>(res);
      try {
        const { returns, total } = await afterSales.listReturns(
          identity.accessToken,
          identity.userId,
          query,
          pageOf(query),
        );
        const response: ReturnListResponse = returnListResponseSchema.parse({
          returns,
          ...pageInfo(query, total),
        });
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, RETURN_ANSWERS);
      }
    },
  );

  router.get(
    '/admin/returns/:returnId',
    noStore,
    requireUser,
    canRead,
    validate(returnDetailSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof returnDetailSchemas>(res);
      try {
        const request = await afterSales.getReturn(
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
        sendAdminFailure(res, error, RETURN_ANSWERS);
      }
    },
  );

  /** Every decision answers with the return as it now stands. */
  const answer = async (
    accessToken: string,
    userId: string,
    returnId: string,
    res: Parameters<typeof sendAdminFailure>[0],
  ) => {
    const request = await afterSales.getReturn(accessToken, userId, returnId);
    if (request === null) {
      sendError(res, 404, 'not_found', 'Return not found');
      return;
    }
    const response: ReturnResponse = returnResponseSchema.parse({ return: request });
    res.json(response);
  };

  router.post(
    '/admin/returns/:returnId/status',
    noStore,
    limiter,
    requireUser,
    canDecide,
    validate(returnDecisionSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof returnDecisionSchemas>(res);
      try {
        await afterSales.decideReturn(
          identity.accessToken,
          identity.userId,
          params.returnId,
          body.status,
          body.note,
        );
        await answer(identity.accessToken, identity.userId, params.returnId, res);
      } catch (error) {
        sendAdminFailure(res, error, RETURN_ANSWERS);
      }
    },
  );

  router.post(
    '/admin/returns/:returnId/restock',
    noStore,
    limiter,
    requireUser,
    canRestock,
    validate(restockSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof restockSchemas>(res);
      try {
        await afterSales.restockReturn(
          identity.accessToken,
          identity.userId,
          params.returnId,
          body.note,
        );
        await answer(identity.accessToken, identity.userId, params.returnId, res);
      } catch (error) {
        sendAdminFailure(res, error, RETURN_ANSWERS);
      }
    },
  );

  router.get(
    '/admin/refunds',
    noStore,
    requireUser,
    canRead,
    validate(listRefundSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof listRefundSchemas>(res);
      try {
        const { refunds, total } = await afterSales.listRefunds(
          identity.accessToken,
          identity.userId,
          query,
          pageOf(query),
        );
        const response: RefundListResponse = refundListResponseSchema.parse({
          refunds,
          ...pageInfo(query, total),
        });
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, REFUND_ANSWERS);
      }
    },
  );

  router.get(
    '/admin/refunds/:refundId',
    noStore,
    requireUser,
    canRead,
    validate(refundDetailSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof refundDetailSchemas>(res);
      try {
        const refund = await afterSales.getRefund(
          identity.accessToken,
          identity.userId,
          params.refundId,
        );
        if (refund === null) {
          sendError(res, 404, 'not_found', 'Refund not found');
          return;
        }
        const response: RefundResponse = refundResponseSchema.parse({ refund });
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, REFUND_ANSWERS);
      }
    },
  );

  router.post(
    '/admin/refunds',
    noStore,
    limiter,
    requireUser,
    canRequest,
    validate(refundCreateSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof refundCreateSchemas>(res);
      try {
        const refundId = await afterSales.requestRefund(
          identity.accessToken,
          identity.userId,
          body,
        );
        const refund = await afterSales.getRefund(
          identity.accessToken,
          identity.userId,
          refundId,
        );
        if (refund === null) {
          sendError(res, 404, 'not_found', 'Refund not found');
          return;
        }
        const response: RefundResponse = refundResponseSchema.parse({ refund });
        res.status(201).json(response);
      } catch (error) {
        sendAdminFailure(res, error, REFUND_ANSWERS);
      }
    },
  );

  /** Every refund change answers with the refund as it now stands. */
  const answerRefund = async (
    accessToken: string,
    userId: string,
    refundId: string,
    res: Parameters<typeof sendAdminFailure>[0],
  ) => {
    const refund = await afterSales.getRefund(accessToken, userId, refundId);
    if (refund === null) {
      sendError(res, 404, 'not_found', 'Refund not found');
      return;
    }
    const response: RefundResponse = refundResponseSchema.parse({ refund });
    res.json(response);
  };

  router.post(
    '/admin/refunds/:refundId/decision',
    noStore,
    limiter,
    requireUser,
    canApprove,
    validate(refundDecisionSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof refundDecisionSchemas>(res);
      try {
        await afterSales.decideRefund(
          identity.accessToken,
          identity.userId,
          params.refundId,
          body.approve,
          body.note,
        );
        await answerRefund(identity.accessToken, identity.userId, params.refundId, res);
      } catch (error) {
        sendAdminFailure(res, error, REFUND_ANSWERS);
      }
    },
  );

  router.post(
    '/admin/refunds/:refundId/completion',
    noStore,
    limiter,
    requireUser,
    canApprove,
    validate(refundCompletionSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof refundCompletionSchemas>(res);
      try {
        await afterSales.completeRefund(
          identity.accessToken,
          identity.userId,
          params.refundId,
          body.reference,
          body.note,
        );
        await answerRefund(identity.accessToken, identity.userId, params.refundId, res);
      } catch (error) {
        sendAdminFailure(res, error, REFUND_ANSWERS);
      }
    },
  );

  router.post(
    '/admin/refunds/:refundId/cancel',
    noStore,
    limiter,
    requireUser,
    canApprove,
    validate(refundCancelSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof refundCancelSchemas>(res);
      try {
        await afterSales.cancelRefund(
          identity.accessToken,
          identity.userId,
          params.refundId,
          body.note,
        );
        await answerRefund(identity.accessToken, identity.userId, params.refundId, res);
      } catch (error) {
        sendAdminFailure(res, error, REFUND_ANSWERS);
      }
    },
  );

  return router;
}
