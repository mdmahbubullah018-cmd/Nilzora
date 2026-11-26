import {
  adminOrderDetailSchema,
  adminOrderListQuerySchema,
  codCollectionRequestSchema,
  orderArchiveRequestSchema,
  orderNoteRequestSchema,
  ORDER_TRANSITIONS,
  orderNumberSchema,
  orderStatusChangeRequestSchema,
  type AdminOrderDetail,
  type AdminOrderListResponse,
  type AdminOrderResponse,
  type OrderStatus,
  type Permission,
} from '@nilzora/contracts';
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { RequestIdentity } from '../../auth/identity';
import { sendError } from '../../http/send-error';
import {
  currentIdentity,
  requireAnyPermission,
  requirePermission,
} from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { conform, StoreUnavailableError } from '../commerce/errors';
import { noStore } from '../commerce/http';
import { sendAdminFailure, type AdminRefusal, type RefusalAnswer } from './errors';
import type { AdminOrderRecord, OrderSearch } from './orders-store';
import type { AdminRouteDependencies } from './routes';
import { pageInfo, pageOf, searchTerm } from './shared';

const orderParams = z.object({ orderNumber: orderNumberSchema });
const listSchemas = { query: adminOrderListQuerySchema };
const detailSchemas = { params: orderParams };
const statusSchemas = { params: orderParams, body: orderStatusChangeRequestSchema };
const collectionSchemas = { params: orderParams, body: codCollectionRequestSchema };
const internalSchemas = { params: orderParams };
const noteSchemas = { params: orderParams, body: orderNoteRequestSchema };
const archiveSchemas = { params: orderParams, body: orderArchiveRequestSchema };

const ORDER_ANSWERS: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  not_found: [404, 'not_found', 'Order not found'],
  invalid_input: [400, 'bad_request', 'The note is missing or too long'],
};

/** Bangladesh Standard Time (UTC+6, no daylight saving). */
const DHAKA_OFFSET = '+06:00';

/** The instant a Bangladesh calendar day (YYYY-MM-DD) starts. */
function dhakaDayStart(day: string, addDays = 0): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + addDays);
  const shifted = date.toISOString().slice(0, 10);
  return new Date(`${shifted}T00:00:00${DHAKA_OFFSET}`).toISOString();
}

/**
 * Reads an order search: an order number (or its start), a phone number (or part of
 * it), otherwise a recipient's name. Null when nothing searchable remains.
 */
export function toOrderSearch(text: string): OrderSearch | null {
  const compact = text.replace(/[\s-]/g, '');
  if (/^nz\d{1,12}$/i.test(compact)) {
    return { kind: 'order_number', prefix: compact.toUpperCase() };
  }
  if (/^\+?\d{4,15}$/.test(compact)) return { kind: 'phone', digits: compact.replace(/^\+/, '') };
  const term = searchTerm(text);
  return term === null ? null : { kind: 'recipient', term };
}

function permissionFor(status: OrderStatus): Permission {
  return status === 'cancelled' ? 'orders.cancel' : 'orders.update_status';
}

/** What the caller may do with the order now; the database decides again on every change. */
function withActions(order: AdminOrderRecord, identity: RequestIdentity): AdminOrderDetail {
  return conform(
    adminOrderDetailSchema,
    {
      ...order,
      allowedStatuses: ORDER_TRANSITIONS[order.status].filter((status) =>
        identity.permissions.has(permissionFor(status)),
      ),
      canRecordCollection:
        order.status === 'delivered' &&
        order.paymentStatus === 'pending' &&
        identity.permissions.has('payments.collect'),
    },
    'orders',
  );
}

/**
 * GET /admin/orders, GET /admin/orders/:orderNumber, POST /admin/orders/:orderNumber/status
 * and POST /admin/orders/:orderNumber/cod-collection — every customer's orders.
 *
 * Fulfilment steps need orders.update_status and cancellations orders.cancel (both also
 * orders.read); the database checks the same permission, the allowed transition and,
 * when cancelling, returns the stock in the same transaction.
 */
export function adminOrdersRouter(deps: AdminRouteDependencies): Router {
  const router = Router();
  const { orders } = deps.stores;
  const { requireUser, limiter } = deps;

  async function sendOrder(res: Response, identity: RequestIdentity, orderNumber: string) {
    const order = await orders.getOrder(identity.accessToken, identity.userId, orderNumber);
    if (!order) {
      throw new StoreUnavailableError('The order changed, but it could not be read back');
    }
    const response: AdminOrderResponse = { order: withActions(order, identity) };
    res.json(response);
  }

  router.get(
    '/admin/orders',
    noStore,
    requireUser,
    requirePermission('orders.read'),
    validate(listSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof listSchemas>(res);
      const search = query.q === undefined ? undefined : toOrderSearch(query.q);
      const { orders: found, total } =
        search === null
          ? { orders: [], total: 0 }
          : await orders.listOrders(
              identity.accessToken,
              identity.userId,
              {
                status: query.status,
                paymentStatus: query.paymentStatus,
                search,
                placedFrom: query.from === undefined ? undefined : dhakaDayStart(query.from),
                placedBefore: query.to === undefined ? undefined : dhakaDayStart(query.to, 1),
                customerId: query.customerId,
                archived: query.view === 'archived',
                deliveryZone: query.deliveryZone,
                sort: query.sort,
              },
              pageOf(query),
            );
      const response: AdminOrderListResponse = { orders: found, ...pageInfo(query, total) };
      res.json(response);
    },
  );

  router.get(
    '/admin/orders/:orderNumber',
    noStore,
    requireUser,
    requirePermission('orders.read'),
    validate(detailSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof detailSchemas>(res);
      const order = await orders.getOrder(
        identity.accessToken,
        identity.userId,
        params.orderNumber,
      );
      if (!order) {
        sendError(res, 404, 'not_found', 'Order not found');
        return;
      }
      const response: AdminOrderResponse = { order: withActions(order, identity) };
      res.json(response);
    },
  );

  router.post(
    '/admin/orders/:orderNumber/status',
    noStore,
    limiter,
    requireUser,
    requirePermission('orders.read'),
    requireAnyPermission(['orders.update_status', 'orders.cancel']),
    validate(statusSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof statusSchemas>(res);
      if (!identity.permissions.has(permissionFor(body.status))) {
        sendError(res, 403, 'forbidden', 'You do not have permission to do this');
        return;
      }
      try {
        await orders.updateStatus(
          identity.accessToken,
          identity.userId,
          params.orderNumber,
          body.status,
          body.note,
        );
      } catch (error) {
        sendAdminFailure(res, error, ORDER_ANSWERS);
        return;
      }
      await sendOrder(res, identity, params.orderNumber);
    },
  );

  router.post(
    '/admin/orders/:orderNumber/cod-collection',
    noStore,
    limiter,
    requireUser,
    requirePermission('orders.read', 'payments.collect'),
    validate(collectionSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof collectionSchemas>(res);
      const order = await orders.getOrder(
        identity.accessToken,
        identity.userId,
        params.orderNumber,
      );
      if (!order) {
        sendError(res, 404, 'not_found', 'Order not found');
        return;
      }
      // An order's total never changes after it is placed, so this check cannot go stale.
      if (body.amountMinor !== order.totalMinor) {
        sendError(
          res,
          409,
          'collection_amount_mismatch',
          'The amount collected differs from the order total',
          { totalMinor: order.totalMinor },
        );
        return;
      }
      try {
        await orders.recordCollection(identity.accessToken, identity.userId, params.orderNumber);
      } catch (error) {
        sendAdminFailure(res, error, ORDER_ANSWERS);
        return;
      }
      await sendOrder(res, identity, params.orderNumber);
    },
  );

  // Staff-only notes and the archive state. Never shown to the customer.
  router.get(
    '/admin/orders/:orderNumber/internal',
    noStore,
    requireUser,
    requirePermission('orders.read'),
    validate(internalSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof internalSchemas>(res);
      const internal = await orders.internal(
        identity.accessToken,
        identity.userId,
        params.orderNumber,
      );
      if (!internal) {
        sendError(res, 404, 'not_found', 'Order not found');
        return;
      }
      res.json(internal);
    },
  );

  router.post(
    '/admin/orders/:orderNumber/notes',
    noStore,
    limiter,
    requireUser,
    requirePermission('orders.read', 'orders.update_status'),
    validate(noteSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof noteSchemas>(res);
      try {
        await orders.addNote(identity.accessToken, identity.userId, params.orderNumber, body.body);
      } catch (error) {
        sendAdminFailure(res, error, ORDER_ANSWERS);
        return;
      }
      res
        .status(201)
        .json(await orders.internal(identity.accessToken, identity.userId, params.orderNumber));
    },
  );

  // Archiving takes a cancelled, unpaid test order out of the queues; nothing is deleted.
  router.post(
    '/admin/orders/:orderNumber/archive',
    noStore,
    limiter,
    requireUser,
    requirePermission('orders.read', 'orders.cancel'),
    validate(archiveSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof archiveSchemas>(res);
      try {
        await orders.setArchived(
          identity.accessToken,
          identity.userId,
          params.orderNumber,
          body.archive,
          body.reason ?? null,
        );
      } catch (error) {
        sendAdminFailure(res, error, {
          ...ORDER_ANSWERS,
          in_use: [
            409,
            'in_use',
            'Only a cancelled order whose cash was never collected, with no return or refund, can be archived',
          ],
        });
        return;
      }
      res.json(await orders.internal(identity.accessToken, identity.userId, params.orderNumber));
    },
  );

  return router;
}
