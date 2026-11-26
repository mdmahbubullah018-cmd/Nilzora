import {
  cancelOrderRequestSchema,
  orderListQuerySchema,
  orderNumberSchema,
  placeOrderRequestSchema,
  type OrderListResponse,
  type OrderResponse,
  type PlaceOrderResponse,
} from '@nilzora/contracts';
import { Router } from 'express';
import { z } from 'zod';
import { sendError } from '../../http/send-error';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { currentIdentity } from '../../middleware/authorize';
import { createRateLimiter, type RateLimitOptions } from '../../middleware/rate-limit';
import { requestInput, validate } from '../../middleware/validate';
import { noStore, sendCommerceFailure } from '../commerce/http';
import { receiptLogo, receiptPictures } from './receipt-assets';
import { receiptEtag, renderReceiptPdf } from './receipt-pdf';
import type { OrderStore } from './store';

const placeSchemas = { body: placeOrderRequestSchema };
const listSchemas = { query: orderListQuerySchema };
const orderParams = z.object({ orderNumber: orderNumberSchema });
const detailSchemas = { params: orderParams };
const cancelSchemas = { params: orderParams, body: cancelOrderRequestSchema };
/** The path is the order's, and the file's own name carries it: `.pdf` is not part of the number. */
const receiptParams = z.object({ orderNumber: orderNumberSchema });
const receiptSchemas = { params: receiptParams };

/**
 * POST /orders, GET /orders, GET /orders/:orderNumber and POST /orders/:orderNumber/cancel
 * — the caller's own Cash-on-Delivery orders.
 *
 * Placing sends what to buy, where to deliver and the total the customer reviewed;
 * the database prices the cart and moves stock in one transaction. Placing and
 * cancelling share a stricter per-IP limit. Another customer's order answers 404,
 * never 403, so order numbers cannot be probed.
 */
export function ordersRouter(
  deps: AuthDependencies & {
    orders: OrderStore;
    rateLimit: RateLimitOptions;
    /** The public media origin; product pictures in a receipt are only ever fetched from it. */
    mediaBaseUrl?: string | undefined;
  },
): Router {
  const router = Router();
  const requireUser = authenticate(deps);
  const orderLimiter = createRateLimiter(deps.rateLimit);

  router.post(
    '/orders',
    noStore,
    orderLimiter,
    requireUser,
    validate(placeSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof placeSchemas>(res);
      try {
        const placed = await deps.orders.place(identity.accessToken, identity.userId, body);
        const response: PlaceOrderResponse = placed;
        // 201 for a new order; 200 when the same checkout attempt is replayed.
        res.status(placed.created ? 201 : 200).json(response);
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  router.get('/orders', noStore, requireUser, validate(listSchemas), async (_req, res) => {
    const identity = currentIdentity(res);
    const { query } = requestInput<typeof listSchemas>(res);
    const { orders, total } = await deps.orders.list(identity.accessToken, identity.userId, {
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    const response: OrderListResponse = {
      orders,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
    res.json(response);
  });

  router.get(
    '/orders/:orderNumber',
    noStore,
    requireUser,
    validate(detailSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof detailSchemas>(res);
      const order = await deps.orders.get(
        identity.accessToken,
        identity.userId,
        params.orderNumber,
      );
      if (!order) {
        sendError(res, 404, 'not_found', 'Order not found');
        return;
      }
      const response: OrderResponse = { order };
      res.json(response);
    },
  );

  /**
   * The customer's own receipt as a PDF. Authorization is the same read as the order page:
   * another customer's order is a 404, never a document. `storeName` comes from the store
   * profile when it can be read, so the file says what the store calls itself.
   */
  router.get(
    '/orders/:orderNumber/receipt.pdf',
    noStore,
    requireUser,
    validate(receiptSchemas),
    async (req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof receiptSchemas>(res);
      try {
        const order = await deps.orders.get(
          identity.accessToken,
          identity.userId,
          params.orderNumber,
        );
        if (!order) {
          sendError(res, 404, 'not_found', 'Order not found');
          return;
        }
        const etag = receiptEtag(order);
        if (req.headers['if-none-match'] === etag) {
          res.status(304).end();
          return;
        }
        // The official logo and each line's picture; either may be missing, never fatal.
        const [logo, pictures] = await Promise.all([
          receiptLogo(),
          receiptPictures(order, deps.mediaBaseUrl),
        ]);
        const pdf = renderReceiptPdf({ order, logo, pictures });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="Nilzora-Receipt-${order.orderNumber}.pdf"`,
        );
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', 'private, no-cache');
        res.send(pdf);
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  router.post(
    '/orders/:orderNumber/cancel',
    noStore,
    orderLimiter,
    requireUser,
    validate(cancelSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof cancelSchemas>(res);
      try {
        const order = await deps.orders.cancel(
          identity.accessToken,
          identity.userId,
          params.orderNumber,
          body.reason,
        );
        const response: OrderResponse = { order };
        res.json(response);
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  return router;
}
