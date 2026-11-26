import {
  BULK_ORDER_LIMIT,
  bulkCourierCheckRequestSchema,
  bulkCourierCheckResponseSchema,
  bulkOrderStatusRequestSchema,
  bulkOrderStatusResponseSchema,
  bulkOrderSummariesRequestSchema,
  bulkOrderSummariesResponseSchema,
  bulkShipmentBookingRequestSchema,
  bulkShipmentBookingResponseSchema,
  type BulkCourierCheckResult,
  type BulkOrderStatusResult,
  type BulkShipmentBookingResult,
  type Permission,
} from '@nilzora/contracts';
import { Router, type RequestHandler } from 'express';
import type { Logger } from 'pino';
import { sendError } from '../../http/send-error';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import {
  currentIdentity,
  requireAnyPermission,
  requirePermission,
} from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { StoreUnavailableError } from '../commerce/errors';
import { noStore } from '../commerce/http';
import { CourierRefusalError } from '../couriers/errors';
import type { CourierService } from '../couriers/service';
import {
  AdminRefusalError,
  refusalAnswerOf,
  type AdminRefusal,
  type RefusalAnswer,
} from './errors';
import type { AdminOrderStore } from './orders-store';

/*
 * Bulk order actions (POST /admin/orders/bulk/*). Every selected order is handled on its own
 * and in turn, through exactly the path its single-order action uses (so the database
 * applies the same permission and transition rules), and every order gets its own result:
 * one refusal never stops the others, and nothing is skipped silently. Booking parcels
 * needs its own explicit, confirmed request with one booking key per order, so a retried
 * request never books twice and an uncertain booking is never sent again.
 *
 * Mounted before the single-order routes, whose `/admin/orders/:orderNumber/...` paths
 * would otherwise take `bulk` for an order number.
 */

export interface BulkOrderDependencies extends AuthDependencies {
  orders: AdminOrderStore;
  /** Courier checks and bookings; absent, those two routes answer 503. */
  couriers?: CourierService | undefined;
  /** The shared per-IP limit for admin changes. */
  limiter: RequestHandler;
  logger?: Pick<Logger, 'warn'> | undefined;
}

type BulkError = { code: string; message: string };

const ORDER_ANSWERS: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  not_found: [404, 'not_found', 'Order not found'],
  invalid_input: [400, 'bad_request', 'The note is missing or too long'],
};

const statusSchemas = { body: bulkOrderStatusRequestSchema };
const summariesSchemas = { body: bulkOrderSummariesRequestSchema };
const checkSchemas = { body: bulkCourierCheckRequestSchema };
const bookingSchemas = { body: bulkShipmentBookingRequestSchema };

const UNAVAILABLE: BulkError = {
  code: 'service_unavailable',
  message: 'The store is temporarily unavailable. Try again.',
};

export function bulkOrdersRouter(deps: BulkOrderDependencies): Router {
  const router = Router();
  const { orders, couriers, limiter, logger } = deps;
  const requireUser = authenticate(deps);

  /** One order's refusal in the API's stable vocabulary; never a database message. */
  function errorOf(error: unknown, operation: string): BulkError {
    if (error instanceof CourierRefusalError) return { code: error.code, message: error.message };
    const answer = refusalAnswerOf(error, ORDER_ANSWERS);
    if (answer) return { code: answer[1], message: answer[2] };
    logger?.warn(
      {
        operation,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        ...(error instanceof StoreUnavailableError ? { errorMessage: error.message } : {}),
      },
      'A bulk order item failed unexpectedly',
    );
    return UNAVAILABLE;
  }

  function permissionFor(status: string): Permission {
    return status === 'cancelled' ? 'orders.cancel' : 'orders.update_status';
  }

  router.post(
    '/admin/orders/bulk/status',
    noStore,
    limiter,
    requireUser,
    requirePermission('orders.read'),
    requireAnyPermission(['orders.update_status', 'orders.cancel']),
    validate(statusSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof statusSchemas>(res);
      if (!identity.permissions.has(permissionFor(body.status))) {
        sendError(res, 403, 'forbidden', 'You do not have permission to do this');
        return;
      }
      const results: BulkOrderStatusResult[] = [];
      for (const orderNumber of body.orderNumbers) {
        try {
          await orders.updateStatus(
            identity.accessToken,
            identity.userId,
            orderNumber,
            body.status,
            body.note,
          );
          results.push({ orderNumber, ok: true, status: body.status, error: null });
        } catch (error) {
          results.push({
            orderNumber,
            ok: false,
            status: null,
            error: errorOf(error, 'admin_update_order_status'),
          });
        }
      }
      const succeeded = results.filter((result) => result.ok).length;
      res.json(
        bulkOrderStatusResponseSchema.parse({
          results,
          succeeded,
          failed: results.length - succeeded,
        }),
      );
    },
  );

  router.post(
    '/admin/orders/bulk/summaries',
    noStore,
    limiter,
    requireUser,
    requirePermission('orders.read'),
    validate(summariesSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof summariesSchemas>(res);
      const { orders: found } = await orders.listOrders(
        identity.accessToken,
        identity.userId,
        { orderNumbers: body.orderNumbers, includeArchived: true },
        { limit: BULK_ORDER_LIMIT, offset: 0 },
      );
      // In the order they were selected; what the caller cannot see is named, not hidden.
      const byNumber = new Map(found.map((order) => [order.orderNumber, order]));
      res.json(
        bulkOrderSummariesResponseSchema.parse({
          orders: body.orderNumbers.flatMap((n) => {
            const order = byNumber.get(n);
            return order ? [order] : [];
          }),
          missing: body.orderNumbers.filter((n) => !byNumber.has(n)),
        }),
      );
    },
  );

  router.post(
    '/admin/orders/bulk/courier-check',
    noStore,
    limiter,
    requireUser,
    requirePermission('orders.read', 'shipments.read'),
    validate(checkSchemas),
    async (_req, res) => {
      if (!couriers) {
        sendError(res, 503, 'courier_unavailable', 'Couriers are not set up on this server');
        return;
      }
      const identity = currentIdentity(res);
      const caller = { accessToken: identity.accessToken, userId: identity.userId };
      const { body } = requestInput<typeof checkSchemas>(res);
      const [rt, config] = await Promise.all([
        couriers.runtime.current(),
        couriers.store.config(caller),
      ]);
      const results: BulkCourierCheckResult[] = [];
      for (const orderNumber of body.orderNumbers) {
        try {
          const context = await couriers.store.orderContext(caller, orderNumber);
          const active = context.shipments.find(
            (s) =>
              s.kind === 'forward' &&
              !['cancelled', 'booking_failed', 'returned'].includes(s.status),
          );
          const off = rt.mode === 'off';
          results.push({
            orderNumber,
            bookable: context.bookable && !off,
            // With couriers off nothing is bookable, but each order still gets its real
            // reason (delivered, already has a parcel, ...); only an order that would
            // otherwise be bookable is reported as 'unavailable'.
            blocker: context.notBookableReason ?? (off ? 'unavailable' : null),
            orderStatus: context.order.status,
            codDueMinor: context.order.codDueMinor,
            district: context.order.district,
            deliveryZone: context.order.deliveryZone,
            shipmentStatus: active?.status ?? null,
          });
        } catch (error) {
          const refusal = error instanceof AdminRefusalError ? error.refusal : null;
          if (refusal === null) errorOf(error, 'admin_order_courier_context');
          results.push({
            orderNumber,
            bookable: false,
            blocker:
              refusal === 'not_found'
                ? 'not_found'
                : refusal === 'missing_permission'
                  ? 'forbidden'
                  : 'unavailable',
            orderStatus: null,
            codDueMinor: null,
            district: null,
            deliveryZone: null,
            shipmentStatus: null,
          });
        }
      }
      res.json(
        bulkCourierCheckResponseSchema.parse({
          results,
          bookable: results.filter((result) => result.bookable).length,
          defaultParcelWeightGrams: config.settings.defaultParcelWeightGrams,
        }),
      );
    },
  );

  router.post(
    '/admin/orders/bulk/shipments',
    noStore,
    limiter,
    requireUser,
    requirePermission('shipments.create', 'shipments.read'),
    validate(bookingSchemas),
    async (_req, res) => {
      if (!couriers) {
        sendError(res, 503, 'courier_unavailable', 'Couriers are not set up on this server');
        return;
      }
      const identity = currentIdentity(res);
      const caller = { accessToken: identity.accessToken, userId: identity.userId };
      const { body } = requestInput<typeof bookingSchemas>(res);
      const weightGrams =
        body.weightGrams ?? (await couriers.store.config(caller)).settings.defaultParcelWeightGrams;
      const results: BulkShipmentBookingResult[] = [];
      for (const item of body.items) {
        try {
          // The single-order booking, unchanged: one courier call per booking key at most,
          // an uncertain booking never sent again.
          const booked = await couriers.bookShipment(caller, item.orderNumber, {
            bookingKey: item.bookingKey,
            provider: body.provider,
            weightGrams,
          });
          const ok = booked.outcome === 'booked' || booked.outcome === 'in_progress';
          results.push({
            orderNumber: item.orderNumber,
            ok,
            outcome: booked.outcome,
            shipmentId: booked.shipment.id,
            duplicate: booked.duplicate,
            error:
              // Fixed text only: the courier's own error text is never passed through here.
              booked.outcome === 'failed'
                ? {
                    code: 'shipment_not_bookable',
                    message:
                      'The courier refused this booking and nothing was created; check the order, then book it again',
                  }
                : booked.outcome === 'uncertain'
                  ? {
                      code: 'shipment_booking_unresolved',
                      message:
                        'No clear answer from the courier: check its portal, then resolve the booking',
                    }
                  : null,
          });
        } catch (error) {
          results.push({
            orderNumber: item.orderNumber,
            ok: false,
            outcome: null,
            shipmentId: null,
            duplicate: false,
            error: errorOf(error, 'book_shipment'),
          });
        }
      }
      const uncertain = results.filter((r) => r.outcome === 'uncertain').length;
      res.json(
        bulkShipmentBookingResponseSchema.parse({
          results,
          booked: results.filter((r) => r.outcome === 'booked').length,
          uncertain,
          failed: results.filter((r) => !r.ok && r.outcome !== 'uncertain').length,
        }),
      );
    },
  );

  return router;
}
