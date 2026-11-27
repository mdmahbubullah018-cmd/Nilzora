import {
  analyticsOverviewQuerySchema,
  auditLogQuerySchema,
  DELIVERY_ZONES,
  deliveryChargeRequestSchema,
  orderGeographyQuerySchema,
  salesOverviewQuerySchema,
  salesTargetRequestSchema,
  saveStoreSettingsRequestSchema,
  type AnalyticsOverviewResponse,
  type AuditLogResponse,
  type DashboardResponse,
  type DeliveryChargeListResponse,
  type DeliveryChargeResponse,
  type OrderGeographyResponse,
  type SalesOverviewResponse,
  type SalesTargetResponse,
  type StoreSettingsResponse,
} from '@nilzora/contracts';
import { Router } from 'express';
import { z } from 'zod';
import {
  currentIdentity,
  requireAnyPermission,
  requirePermission,
} from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { noStore } from '../commerce/http';
import { sendAdminFailure } from './errors';
import type { AdminRouteDependencies } from './routes';
import { pageInfo, pageOf } from './shared';

const auditSchemas = { query: auditLogQuerySchema };
const salesSchemas = { query: salesOverviewQuerySchema };
const overviewSchemas = { query: analyticsOverviewQuerySchema };
const geographySchemas = { query: orderGeographyQuerySchema };
const salesTargetSchemas = { body: salesTargetRequestSchema };
const storeSettingsSchemas = { body: saveStoreSettingsRequestSchema };
const chargeSchemas = {
  params: z.object({ zone: z.enum(DELIVERY_ZONES) }),
  body: deliveryChargeRequestSchema,
};

/** The dashboard's sales card covers this many days. */
const DASHBOARD_SALES_DAYS = 7;

/**
 * GET /admin/audit-log, GET /admin/analytics/sales, GET /admin/analytics/overview,
 * GET /admin/dashboard, GET/PUT /admin/settings/delivery-charges and
 * PUT /admin/settings/sales-target.
 */
export function adminReportsRouter(deps: AdminRouteDependencies): Router {
  const router = Router();
  const { reports } = deps.stores;
  const { requireUser, limiter } = deps;
  const canManageSettings = requirePermission('settings.manage');

  router.get(
    '/admin/audit-log',
    noStore,
    requireUser,
    requirePermission('audit_logs.read'),
    validate(auditSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof auditSchemas>(res);
      const { entries, total } = await reports.auditLog(
        identity.accessToken,
        identity.userId,
        {
          actionPrefix: query.action,
          actorId: query.actorId,
          from: query.from,
          to: query.to,
          q: query.q,
        },
        pageOf(query),
      );
      const response: AuditLogResponse = { entries, ...pageInfo(query, total) };
      res.json(response);
    },
  );

  router.get(
    '/admin/analytics/sales',
    noStore,
    requireUser,
    requirePermission('finance.read'),
    validate(salesSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof salesSchemas>(res);
      const response: SalesOverviewResponse = {
        overview: await reports.salesOverview(identity.accessToken, identity.userId, query.days),
      };
      res.json(response);
    },
  );

  /**
   * The dashboard and analytics aggregate. A read like the other reports: the global
   * per-IP limit applies, the admin change budget does not.
   */
  router.get(
    '/admin/analytics/overview',
    noStore,
    requireUser,
    requirePermission('finance.read'),
    validate(overviewSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof overviewSchemas>(res);
      try {
        const response: AnalyticsOverviewResponse = {
          overview: await reports.analyticsOverview(identity.accessToken, identity.userId, {
            from: query.from,
            to: query.to,
            compare: query.compare,
          }),
        };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, {
          invalid_input: [400, 'bad_request', 'Choose a range of 1 to 366 days'],
        });
      }
    },
  );

  /**
   * Where the range's orders came from, by division and district: one aggregate read that
   * the map, the KPI cards and every chart share. Revenue needs finance.read, like every
   * other sales figure, and the database checks the permission again.
   */
  router.get(
    '/admin/analytics/orders/geography',
    noStore,
    requireUser,
    requirePermission('finance.read'),
    validate(geographySchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof geographySchemas>(res);
      try {
        const response: OrderGeographyResponse = {
          geography: await reports.orderGeography(identity.accessToken, identity.userId, query),
        };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, {
          invalid_input: [
            400,
            'bad_request',
            'Choose a range of 1 to 366 days and a known division and district',
          ],
        });
      }
    },
  );

  /** Each card is read only when the caller holds its permission; the others are null. */
  router.get(
    '/admin/dashboard',
    noStore,
    requireUser,
    requireAnyPermission(['admin_workspace.access', 'moderator_workspace.access']),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { accessToken, permissions } = identity;
      const [orders, stock, reviews, sales] = await Promise.all([
        permissions.has('orders.read') ? reports.orderCounts(accessToken, identity.userId) : null,
        permissions.has('products.read') ? reports.lowStock(accessToken, identity.userId) : null,
        permissions.has('content.approve') || permissions.has('moderation.assign')
          ? reports.reviewCounts(accessToken, identity.userId, identity.userId)
          : null,
        permissions.has('finance.read')
          ? reports.salesOverview(accessToken, identity.userId, DASHBOARD_SALES_DAYS)
          : null,
      ]);
      const assigns = permissions.has('moderation.assign');
      const response: DashboardResponse = {
        orders,
        stock,
        moderation: reviews && {
          assignedToMe: reviews.assignedToMe,
          unassigned: assigns ? reviews.unassigned : null,
          pending: assigns ? reviews.pending : null,
        },
        sales: sales && {
          days: sales.days,
          orderCount: sales.orderCount,
          salesMinor: sales.salesMinor,
          awaitingCollectionMinor: sales.awaitingCollectionMinor,
        },
      };
      res.json(response);
    },
  );

  router.get(
    '/admin/settings/delivery-charges',
    noStore,
    requireUser,
    canManageSettings,
    async (_req, res) => {
      const identity = currentIdentity(res);
      const response: DeliveryChargeListResponse = {
        charges: await reports.deliveryCharges(identity.accessToken, identity.userId),
      };
      res.json(response);
    },
  );

  router.put(
    '/admin/settings/delivery-charges/:zone',
    noStore,
    limiter,
    requireUser,
    canManageSettings,
    validate(chargeSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof chargeSchemas>(res);
      try {
        const response: DeliveryChargeResponse = {
          charge: await reports.setDeliveryCharge(
            identity.accessToken,
            identity.userId,
            params.zone,
            body.amountMinor,
          ),
        };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, {
          invalid_input: [400, 'bad_request', 'The charge must be from 0 to 100,000 taka'],
        });
      }
    },
  );

  router.get(
    '/admin/settings/store',
    noStore,
    requireUser,
    canManageSettings,
    async (_req, res) => {
      const identity = currentIdentity(res);
      const response: StoreSettingsResponse = {
        settings: await reports.storeSettings(identity.accessToken, identity.userId),
      };
      res.json(response);
    },
  );

  router.put(
    '/admin/settings/store',
    noStore,
    limiter,
    requireUser,
    canManageSettings,
    validate(storeSettingsSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof storeSettingsSchemas>(res);
      try {
        const response: StoreSettingsResponse = {
          settings: await reports.saveStoreSettings(identity.accessToken, identity.userId, body),
        };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, {
          invalid_input: [
            400,
            'bad_request',
            'Check the settings and thresholds: nothing was saved',
          ],
        });
      }
    },
  );

  router.put(
    '/admin/settings/sales-target',
    noStore,
    limiter,
    requireUser,
    canManageSettings,
    validate(salesTargetSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof salesTargetSchemas>(res);
      try {
        const response: SalesTargetResponse = {
          target: await reports.setSalesTarget(
            identity.accessToken,
            identity.userId,
            body.targetMinor,
          ),
        };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, {
          invalid_input: [400, 'bad_request', 'The target must be from 0 to 1,000,000,000 taka'],
        });
      }
    },
  );

  return router;
}
