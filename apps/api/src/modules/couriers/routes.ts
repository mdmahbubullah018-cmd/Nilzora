import {
  adminShipmentListQuerySchema,
  bookExchangeShipmentRequestSchema,
  bookReturnPickupRequestSchema,
  bookShipmentRequestSchema,
  bookShipmentResponseSchema,
  cancelShipmentRequestSchema,
  codPositionListQuerySchema,
  codPositionListResponseSchema,
  courierBaseUrlRequestSchema,
  courierCheckResponseSchema,
  courierCredentialRequestSchema,
  courierLiveVerificationRequestSchema,
  courierOperationsRequestSchema,
  courierCompareRequestSchema,
  courierCompareResponseSchema,
  courierConfigResponseSchema,
  courierLocationMappingRequestSchema,
  courierOverviewResponseSchema,
  courierProviderIdSchema,
  courierProviderRequestSchema,
  courierRateCardRequestSchema,
  courierRateCardSchema,
  courierSettingsRequestSchema,
  courierSettlementListQuerySchema,
  courierSettlementListResponseSchema,
  courierSettlementSchema,
  customerShipmentsResponseSchema,
  orderCourierContextSchema,
  orderNumberSchema,
  recordCodAdjustmentRequestSchema,
  recordCodCollectedRequestSchema,
  recordCourierSettlementRequestSchema,
  recordPortalBookingRequestSchema,
  recordShipmentStatusRequestSchema,
  recordShipmentStatusResponseSchema,
  refreshShipmentResponseSchema,
  resolveShipmentBookingRequestSchema,
  setCodStateRequestSchema,
  shipmentDetailResponseSchema,
  shipmentHistoryResponseSchema,
  shipmentListResponseSchema,
  shipmentSchema,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Router, type RequestHandler, type Response } from 'express';
import { z, type ZodType } from 'zod';
import { sendError } from '../../http/send-error';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import {
  currentIdentity,
  requireAnyPermission,
  requirePermission,
} from '../../middleware/authorize';
import { requestInput, validate, type RequestSchemas } from '../../middleware/validate';
import { sendAdminFailure, type AdminRefusal, type RefusalAnswer } from '../admin/errors';
import { emptyBodySchema, pageInfo, pageOf } from '../admin/shared';
import { noStore } from '../commerce/http';
import { CourierRefusalError } from './errors';
import type { CourierService } from './service';
import type { CourierCaller } from './store';

/*
 * Courier routes for staff (/admin/couriers, /admin/orders/:n/courier, /admin/shipments,
 * /admin/returns/:id/…) and the customer's own shipments (/orders/:n/shipments).
 *
 * Each staff route requires, in the API, the permissions its database functions check
 * again for the caller (calls run as the caller, never with the service key, except the
 * booking payload handed to the courier adapter). A route that answers with data read
 * back after a change also requires the permission that read needs, so a change never
 * succeeds only to be answered 403. Responses are never cached, changes share the admin
 * rate limit, and every answer is checked against its contract. Audit rows are written by
 * the database functions themselves.
 */

export interface CourierRouteDependencies extends AuthDependencies {
  service: CourierService;
  /** The shared per-IP limit for admin changes. */
  limiter: RequestHandler;
}

const COURIER_ANSWERS: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  not_found: [404, 'not_found', 'Not found'],
  invalid_input: [400, 'bad_request', 'The courier request was refused as invalid'],
  return_not_eligible: [
    409,
    'return_not_eligible',
    'A pickup or an exchange can be booked only for an approved return',
  ],
};

const providerParams = z.object({ provider: courierProviderIdSchema });
const rateCardParams = z.object({ rateCardId: uuidSchema });
const mappingParams = z.object({ mappingId: uuidSchema });
const credentialParams = z.object({
  provider: courierProviderIdSchema,
  field: z.string().regex(/^[a-z][a-z_]{1,40}$/),
});
const orderParams = z.object({ orderNumber: orderNumberSchema });
const shipmentParams = z.object({ shipmentId: uuidSchema });
const returnParams = z.object({ returnId: uuidSchema });
const includeMockQuery = z.object({
  includeMock: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

/** Bangladesh Standard Time (UTC+6, no daylight saving): a calendar day's first instant. */
function dhakaDayStart(day: string, addDays = 0): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + addDays);
  return new Date(`${date.toISOString().slice(0, 10)}T00:00:00+06:00`).toISOString();
}

function callerOf(res: Response): CourierCaller {
  const identity = currentIdentity(res);
  return { accessToken: identity.accessToken, userId: identity.userId };
}

function fail(res: Response, error: unknown): void {
  if (error instanceof CourierRefusalError) {
    sendError(res, error.status, error.code, error.message);
    return;
  }
  sendAdminFailure(res, error, COURIER_ANSWERS);
}

/** Validates the answer against its contract and sends it. */
function answer<T>(res: Response, schema: ZodType<T>, value: unknown, status = 200): void {
  res.status(status).json(schema.parse(value));
}

export function courierRouter(deps: CourierRouteDependencies): Router {
  const router = Router();
  const { service, limiter } = deps;
  const requireUser = authenticate(deps);

  const readConfig = requireAnyPermission(['couriers.read', 'shipments.read']);
  const configure = requirePermission('couriers.configure');
  const pricing = requirePermission('couriers.pricing.manage');
  const readShipments = requirePermission('shipments.read');
  const create = requirePermission('shipments.create');
  const createOrReturns = requireAnyPermission(['shipments.create', 'shipments.returns.manage']);
  const readOrReturns = requireAnyPermission(['shipments.read', 'shipments.returns.manage']);
  const returns = requirePermission('shipments.returns.manage');
  const cancel = requirePermission('shipments.cancel');
  const track = requirePermission('shipments.track');
  const codRead = requirePermission('couriers.cod.read');
  const codReconcile = requirePermission('couriers.cod.reconcile');

  /** A route: no-store, (limited when it changes something), signed in, permitted, valid. */
  function route<S extends RequestSchemas>(
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    guards: readonly RequestHandler[],
    schemas: S,
    handler: (res: Response, input: ReturnType<typeof requestInput<S>>) => Promise<void>,
  ): void {
    const limited = method === 'get' ? [] : [limiter];
    router[method](
      path,
      noStore,
      ...limited,
      requireUser,
      ...guards,
      validate(schemas),
      async (_req, res) => {
        try {
          await handler(res, requestInput<S>(res));
        } catch (error) {
          fail(res, error);
        }
      },
    );
  }

  // ---- Configuration -------------------------------------------------------------------

  route('get', '/admin/couriers/config', [readConfig], {}, async (res) => {
    answer(res, courierConfigResponseSchema, await service.config(callerOf(res)));
  });

  route(
    'put',
    '/admin/couriers/settings',
    [readConfig, configure],
    { body: courierSettingsRequestSchema },
    async (res, { body }) => {
      answer(res, courierConfigResponseSchema, await service.saveSettings(callerOf(res), body));
    },
  );

  route(
    'put',
    '/admin/couriers/providers/:provider',
    [readConfig, configure],
    { params: providerParams, body: courierProviderRequestSchema },
    async (res, { params, body }) => {
      answer(
        res,
        courierConfigResponseSchema,
        await service.saveProvider(callerOf(res), params.provider, body),
      );
    },
  );

  // Operating switches, credentials, base URLs and live verification: the owner's
  // (couriers.configure). Each answers with the configuration as it now stands.
  route(
    'put',
    '/admin/couriers/operations',
    [readConfig, configure],
    { body: courierOperationsRequestSchema },
    async (res, { body }) => {
      answer(res, courierConfigResponseSchema, await service.saveOperations(callerOf(res), body));
    },
  );

  // Write-only: the value is stored encrypted and never logged, echoed or read back.
  route(
    'put',
    '/admin/couriers/providers/:provider/credentials/:field',
    [readConfig, configure],
    { params: credentialParams, body: courierCredentialRequestSchema },
    async (res, { params, body }) => {
      answer(
        res,
        courierConfigResponseSchema,
        await service.setCredential(callerOf(res), params.provider, params.field, body.value),
      );
    },
  );

  route(
    'delete',
    '/admin/couriers/providers/:provider/credentials/:field',
    [readConfig, configure],
    { params: credentialParams },
    async (res, { params }) => {
      answer(
        res,
        courierConfigResponseSchema,
        await service.clearCredential(callerOf(res), params.provider, params.field),
      );
    },
  );

  route(
    'put',
    '/admin/couriers/providers/:provider/base-url',
    [readConfig, configure],
    { params: providerParams, body: courierBaseUrlRequestSchema },
    async (res, { params, body }) => {
      answer(
        res,
        courierConfigResponseSchema,
        await service.saveBaseUrl(callerOf(res), params.provider, body.apiBaseUrl),
      );
    },
  );

  route(
    'put',
    '/admin/couriers/providers/:provider/live-verification',
    [readConfig, configure],
    { params: providerParams, body: courierLiveVerificationRequestSchema },
    async (res, { params, body }) => {
      answer(
        res,
        courierConfigResponseSchema,
        await service.setLiveVerification(callerOf(res), params.provider, body),
      );
    },
  );

  route(
    'delete',
    '/admin/couriers/location-mappings/:mappingId',
    [createOrReturns],
    { params: mappingParams },
    async (res, { params }) => {
      await service.deleteLocationMapping(callerOf(res), params.mappingId);
      res.status(204).end();
    },
  );

  route(
    'post',
    '/admin/couriers/providers/:provider/check',
    [configure],
    { params: providerParams, body: emptyBodySchema },
    async (res, { params }) => {
      answer(
        res,
        courierCheckResponseSchema,
        await service.checkConnection(callerOf(res), params.provider),
      );
    },
  );

  route(
    'post',
    '/admin/couriers/rate-cards',
    [pricing],
    { body: courierRateCardRequestSchema },
    async (res, { body }) => {
      answer(res, courierRateCardSchema, await service.createRateCard(callerOf(res), body), 201);
    },
  );

  route(
    'put',
    '/admin/couriers/rate-cards/:rateCardId',
    [pricing],
    { params: rateCardParams, body: courierRateCardRequestSchema },
    async (res, { params, body }) => {
      answer(
        res,
        courierRateCardSchema,
        await service.updateRateCard(callerOf(res), params.rateCardId, body),
      );
    },
  );

  route(
    'delete',
    '/admin/couriers/rate-cards/:rateCardId',
    [pricing],
    { params: rateCardParams },
    async (res, { params }) => {
      await service.deleteRateCard(callerOf(res), params.rateCardId);
      res.status(204).end();
    },
  );

  route(
    'post',
    '/admin/couriers/location-mappings',
    [createOrReturns],
    { body: courierLocationMappingRequestSchema },
    async (res, { body }) => {
      await service.saveLocationMapping(callerOf(res), body);
      res.status(204).end();
    },
  );

  route(
    'get',
    '/admin/couriers/overview',
    [readConfig],
    { query: includeMockQuery },
    async (res, { query }) => {
      answer(
        res,
        courierOverviewResponseSchema,
        await service.overview(callerOf(res), query.includeMock),
      );
    },
  );

  // ---- One order: context, comparison, booking -------------------------------------------

  route(
    'get',
    '/admin/orders/:orderNumber/courier',
    [readShipments],
    { params: orderParams },
    async (res, { params }) => {
      answer(
        res,
        orderCourierContextSchema,
        await service.orderContext(callerOf(res), params.orderNumber),
      );
    },
  );

  route(
    'post',
    '/admin/orders/:orderNumber/courier/quotes',
    [readShipments, create],
    { params: orderParams, body: courierCompareRequestSchema },
    async (res, { params, body }) => {
      answer(
        res,
        courierCompareResponseSchema,
        await service.compare(callerOf(res), params.orderNumber, body.weightGrams),
      );
    },
  );

  route(
    'post',
    '/admin/orders/:orderNumber/shipments',
    [create],
    { params: orderParams, body: bookShipmentRequestSchema },
    async (res, { params, body }) => {
      answer(
        res,
        bookShipmentResponseSchema,
        await service.bookShipment(callerOf(res), params.orderNumber, body),
      );
    },
  );

  // A parcel booked in the courier's own portal, recorded by staff: the order's delivery
  // needs shipments.create, a return pickup (returnId) shipments.returns.manage, exactly as
  // admin_record_portal_booking checks again. It never calls a courier, so it works in
  // every courier mode.
  route(
    'post',
    '/admin/orders/:orderNumber/shipments/portal',
    [createOrReturns],
    { params: orderParams, body: recordPortalBookingRequestSchema },
    async (res, { params, body }) => {
      const needed = body.returnId === undefined ? 'shipments.create' : 'shipments.returns.manage';
      if (!currentIdentity(res).permissions.has(needed)) {
        sendError(res, 403, 'forbidden', 'You do not have permission to do this');
        return;
      }
      answer(
        res,
        shipmentSchema,
        // 200 for the first record and for a repeat of the same booking key alike.
        await service.recordPortalBooking(callerOf(res), params.orderNumber, body),
      );
    },
  );

  route(
    'get',
    '/admin/orders/:orderNumber/shipments',
    [readShipments],
    { params: orderParams },
    async (res, { params }) => {
      const shipments = await service.store.orderShipments(callerOf(res), params.orderNumber);
      answer(res, shipmentHistoryResponseSchema, { shipments });
    },
  );

  // ---- Shipments -------------------------------------------------------------------------

  route(
    'get',
    '/admin/shipments',
    [readShipments],
    { query: adminShipmentListQuerySchema },
    async (res, { query }) => {
      const { shipments, total } = await service.store.listShipments(
        callerOf(res),
        {
          status: query.status === 'all' ? null : query.status,
          provider: query.provider === 'all' ? null : query.provider,
          kind: query.kind === 'all' ? null : query.kind,
          query: query.q === '' ? null : query.q,
          from: query.from === undefined ? null : dhakaDayStart(query.from),
          to: query.to === undefined ? null : dhakaDayStart(query.to, 1),
          includeMock: query.includeMock,
        },
        pageOf(query),
      );
      answer(res, shipmentListResponseSchema, { shipments, ...pageInfo(query, total) });
    },
  );

  route(
    'get',
    '/admin/shipments/:shipmentId',
    [readShipments],
    { params: shipmentParams },
    async (res, { params }) => {
      answer(
        res,
        shipmentDetailResponseSchema,
        await service.store.getShipment(callerOf(res), params.shipmentId),
      );
    },
  );

  route(
    'post',
    '/admin/shipments/:shipmentId/resolve',
    [createOrReturns],
    { params: shipmentParams, body: resolveShipmentBookingRequestSchema },
    async (res, { params, body }) => {
      answer(
        res,
        shipmentSchema,
        await service.resolveBooking(callerOf(res), params.shipmentId, body),
      );
    },
  );

  route(
    'post',
    '/admin/shipments/:shipmentId/cancel',
    [readShipments, cancel],
    { params: shipmentParams, body: cancelShipmentRequestSchema },
    async (res, { params, body }) => {
      answer(res, shipmentSchema, await service.cancel(callerOf(res), params.shipmentId, body));
    },
  );

  route(
    'post',
    '/admin/shipments/:shipmentId/refresh',
    [readShipments, track],
    { params: shipmentParams, body: emptyBodySchema },
    async (res, { params }) => {
      answer(
        res,
        refreshShipmentResponseSchema,
        await service.refresh(callerOf(res), params.shipmentId),
      );
    },
  );

  route(
    'post',
    '/admin/shipments/:shipmentId/events',
    [readShipments, track],
    { params: shipmentParams, body: recordShipmentStatusRequestSchema },
    async (res, { params, body }) => {
      answer(
        res,
        recordShipmentStatusResponseSchema,
        await service.recordStatus(callerOf(res), params.shipmentId, body),
      );
    },
  );

  // ---- Returns ---------------------------------------------------------------------------

  route(
    'get',
    '/admin/returns/:returnId/shipments',
    [readOrReturns],
    { params: returnParams },
    async (res, { params }) => {
      const shipments = await service.store.returnShipments(callerOf(res), params.returnId);
      answer(res, shipmentHistoryResponseSchema, { shipments });
    },
  );

  route(
    'post',
    '/admin/returns/:returnId/pickup',
    [returns],
    { params: returnParams, body: bookReturnPickupRequestSchema },
    async (res, { params, body }) => {
      answer(
        res,
        bookShipmentResponseSchema,
        await service.bookReturnPickup(callerOf(res), params.returnId, body),
      );
    },
  );

  route(
    'post',
    '/admin/returns/:returnId/exchange',
    [returns],
    { params: returnParams, body: bookExchangeShipmentRequestSchema },
    async (res, { params, body }) => {
      answer(
        res,
        bookShipmentResponseSchema,
        await service.bookExchange(callerOf(res), params.returnId, body),
      );
    },
  );

  // ---- Cash on delivery ------------------------------------------------------------------

  route(
    'get',
    '/admin/couriers/cod',
    [codRead],
    { query: codPositionListQuerySchema },
    async (res, { query }) => {
      const result = await service.store.codPositions(
        callerOf(res),
        {
          provider: query.provider === 'all' ? null : query.provider,
          status: query.status === 'all' ? null : query.status,
          includeMock: query.includeMock,
        },
        pageOf(query),
      );
      answer(res, codPositionListResponseSchema, {
        positions: result.positions,
        totals: result.totals,
        ...pageInfo(query, result.total),
      });
    },
  );

  /** A COD change answers with the shipment's detail as it now stands. */
  async function detailAfter(res: Response, shipmentId: string, change: () => Promise<void>) {
    await change();
    answer(
      res,
      shipmentDetailResponseSchema,
      await service.store.getShipment(callerOf(res), shipmentId),
    );
  }

  route(
    'post',
    '/admin/shipments/:shipmentId/cod/collected',
    [readShipments, codReconcile],
    { params: shipmentParams, body: recordCodCollectedRequestSchema },
    async (res, { params, body }) => {
      await detailAfter(res, params.shipmentId, () =>
        service.store.recordCodCollected(callerOf(res), params.shipmentId, body),
      );
    },
  );

  route(
    'post',
    '/admin/shipments/:shipmentId/cod/adjustments',
    [readShipments, codReconcile],
    { params: shipmentParams, body: recordCodAdjustmentRequestSchema },
    async (res, { params, body }) => {
      await detailAfter(res, params.shipmentId, () =>
        service.store.recordCodAdjustment(callerOf(res), params.shipmentId, body),
      );
    },
  );

  route(
    'put',
    '/admin/shipments/:shipmentId/cod/state',
    [readShipments, codReconcile],
    { params: shipmentParams, body: setCodStateRequestSchema },
    async (res, { params, body }) => {
      await detailAfter(res, params.shipmentId, () =>
        service.store.setCodState(callerOf(res), params.shipmentId, body),
      );
    },
  );

  route(
    'get',
    '/admin/couriers/settlements',
    [codRead],
    { query: courierSettlementListQuerySchema },
    async (res, { query }) => {
      const { settlements, total } = await service.store.listSettlements(
        callerOf(res),
        {
          provider: query.provider === 'all' ? null : query.provider,
          includeMock: query.includeMock,
        },
        pageOf(query),
      );
      answer(res, courierSettlementListResponseSchema, { settlements, ...pageInfo(query, total) });
    },
  );

  route(
    'post',
    '/admin/couriers/settlements',
    [codRead, codReconcile],
    { body: recordCourierSettlementRequestSchema },
    async (res, { body }) => {
      answer(
        res,
        courierSettlementSchema,
        await service.recordSettlement(callerOf(res), body),
        201,
      );
    },
  );

  // ---- Customers -------------------------------------------------------------------------

  // Any signed-in account; my_order_shipments answers only for the caller's own order
  // (another customer's order is "not found").
  route(
    'get',
    '/orders/:orderNumber/shipments',
    [],
    { params: orderParams },
    async (res, { params }) => {
      const shipments = await service.store.myOrderShipments(callerOf(res), params.orderNumber);
      answer(res, customerShipmentsResponseSchema, { shipments });
    },
  );

  return router;
}
