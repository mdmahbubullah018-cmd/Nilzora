import {
  adminCampaignListQuerySchema,
  adminCampaignListResponseSchema,
  adminCampaignProductsQuerySchema,
  adminCampaignResponseSchema,
  campaignHistoryQuerySchema,
  campaignHistoryResponseSchema,
  campaignConflictListResponseSchema,
  campaignPreviewRequestSchema,
  campaignPreviewResponseSchema,
  campaignSaveRequestSchema,
  campaignStatusRequestSchema,
  categoryCampaignListResponseSchema,
  type AdminCampaignListResponse,
  type AdminCampaignResponse,
  type CampaignHistoryResponse,
  type CampaignConflictListResponse,
  type CampaignPreviewResponse,
  type CampaignStatus,
  type CategoryCampaignListResponse,
  type Permission,
} from '@nilzora/contracts';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { currentIdentity, requirePermission } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { noStore } from '../commerce/http';
import { sendAdminFailure } from './errors';
import type { AdminRouteDependencies } from './routes';
import { pageInfo, pageOf } from './shared';

const listSchemas = { query: adminCampaignListQuerySchema };
const idSchemas = { params: z.object({ campaignId: z.uuid() }) };
const saveSchemas = { body: campaignSaveRequestSchema };
const updateSchemas = { ...idSchemas, body: campaignSaveRequestSchema };
const statusSchemas = { ...idSchemas, body: campaignStatusRequestSchema };
const previewSchemas = { body: campaignPreviewRequestSchema };
const productsSchemas = { ...idSchemas, query: adminCampaignProductsQuerySchema };
const historySchemas = { ...idSchemas, query: campaignHistoryQuerySchema };
const categorySchemas = {
  query: z.object({ categoryId: z.uuid().optional() }),
};

/**
 * Which permission each transition needs. The same table lives in the database
 * function, so an API check can narrow but never widen what an account may do.
 */
const STATUS_PERMISSION: Readonly<Record<CampaignStatus, Permission>> = {
  draft: 'discounts.edit',
  scheduled: 'discounts.schedule',
  active: 'discounts.activate',
  paused: 'discounts.pause',
  ended: 'discounts.end',
  archived: 'discounts.archive',
};

/**
 * Discount campaigns: the one place promotional pricing is created and driven.
 *
 * Reads need `discounts.view`; writing a campaign needs `discounts.create` (or
 * `discounts.edit` when one exists), and each status change needs the permission that
 * transition implies. The database re-checks all of it, so a missing API check could
 * not widen access. Nothing here is cached: a campaign's effect depends on the clock.
 */
export function adminDiscountsRouter(deps: AdminRouteDependencies): Router {
  const router = Router();
  const { discounts } = deps.stores;
  const { requireUser, limiter } = deps;
  const canView = requirePermission('discounts.view');
  const canCreate = requirePermission('discounts.create');
  const canEdit = requirePermission('discounts.edit');

  /** The guard for the transition named in the validated body. */
  const statusGuard =
    (status: CampaignStatus): RequestHandler =>
    (req, res, next) =>
      requirePermission(STATUS_PERMISSION[status])(req, res, next);

  router.get(
    '/admin/discounts/campaigns',
    noStore,
    requireUser,
    canView,
    validate(listSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof listSchemas>(res);
      try {
        const { campaigns, total } = await discounts.list(
          identity.accessToken,
          identity.userId,
          { q: query.q, state: query.state, scope: query.scope },
          pageOf(query),
        );
        const response: AdminCampaignListResponse = {
          campaigns,
          ...pageInfo(query, total),
        };
        res.json(adminCampaignListResponseSchema.parse(response));
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.post(
    '/admin/discounts/campaigns',
    noStore,
    requireUser,
    canCreate,
    limiter,
    validate(saveSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof saveSchemas>(res);
      try {
        const campaign = await discounts.save(
          identity.accessToken,
          identity.userId,
          null,
          body,
        );
        const response: AdminCampaignResponse = { campaign };
        res.status(201).json(adminCampaignResponseSchema.parse(response));
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  /**
   * The preview for a configuration that is not saved yet. A POST because it carries a
   * whole targeting plan; it changes nothing.
   */
  router.post(
    '/admin/discounts/preview',
    noStore,
    requireUser,
    canView,
    limiter,
    validate(previewSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof previewSchemas>(res);
      try {
        const preview = await discounts.preview(identity.accessToken, identity.userId, body);
        const response: CampaignPreviewResponse = preview;
        res.json(campaignPreviewResponseSchema.parse(response));
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  /** The live campaigns reaching each category, for the category management screen. */
  router.get(
    '/admin/discounts/category-campaigns',
    noStore,
    requireUser,
    canView,
    validate(categorySchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof categorySchemas>(res);
      try {
        const campaigns = await discounts.categoryCampaigns(
          identity.accessToken,
          identity.userId,
          query.categoryId === undefined ? null : [query.categoryId],
        );
        const response: CategoryCampaignListResponse = { campaigns };
        res.json(categoryCampaignListResponseSchema.parse(response));
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.get(
    '/admin/discounts/campaigns/:campaignId',
    noStore,
    requireUser,
    canView,
    validate(idSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof idSchemas>(res);
      try {
        const campaign = await discounts.get(identity.accessToken, identity.userId, params.campaignId);
        if (!campaign) {
          res.status(404).json({ error: { code: 'campaign_not_found', message: 'Campaign not found' } });
          return;
        }
        const response: AdminCampaignResponse = { campaign };
        res.json(adminCampaignResponseSchema.parse(response));
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.put(
    '/admin/discounts/campaigns/:campaignId',
    noStore,
    requireUser,
    canEdit,
    limiter,
    validate(updateSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof updateSchemas>(res);
      try {
        const campaign = await discounts.save(
          identity.accessToken,
          identity.userId,
          params.campaignId,
          body,
        );
        const response: AdminCampaignResponse = { campaign };
        res.json(adminCampaignResponseSchema.parse(response));
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.patch(
    '/admin/discounts/campaigns/:campaignId/status',
    noStore,
    requireUser,
    validate(statusSchemas),
    (req, res, next) => {
      const { body } = requestInput<typeof statusSchemas>(res);
      statusGuard(body.status)(req, res, next);
    },
    limiter,
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof statusSchemas>(res);
      try {
        const campaign = await discounts.setStatus(
          identity.accessToken,
          identity.userId,
          params.campaignId,
          body.status,
          body.expectedVersion,
        );
        const response: AdminCampaignResponse = { campaign };
        res.json(adminCampaignResponseSchema.parse(response));
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.post(
    '/admin/discounts/campaigns/:campaignId/duplicate',
    noStore,
    requireUser,
    canCreate,
    limiter,
    validate(idSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof idSchemas>(res);
      try {
        const campaign = await discounts.duplicate(
          identity.accessToken,
          identity.userId,
          params.campaignId,
        );
        const response: AdminCampaignResponse = { campaign };
        res.status(201).json(adminCampaignResponseSchema.parse(response));
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.get(
    '/admin/discounts/campaigns/:campaignId/products',
    noStore,
    requireUser,
    canView,
    validate(productsSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, query } = requestInput<typeof productsSchemas>(res);
      try {
        const preview = await discounts.products(
          identity.accessToken,
          identity.userId,
          params.campaignId,
          pageOf(query),
        );
        const response: CampaignPreviewResponse = preview;
        res.json(campaignPreviewResponseSchema.parse(response));
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.get(
    '/admin/discounts/campaigns/:campaignId/conflicts',
    noStore,
    requireUser,
    canView,
    validate(idSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof idSchemas>(res);
      try {
        const conflicts = await discounts.conflicts(
          identity.accessToken,
          identity.userId,
          params.campaignId,
        );
        const response: CampaignConflictListResponse = { conflicts };
        res.json(campaignConflictListResponseSchema.parse(response));
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.get(
    '/admin/discounts/campaigns/:campaignId/history',
    noStore,
    requireUser,
    canView,
    validate(historySchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, query } = requestInput<typeof historySchemas>(res);
      try {
        const { entries, total } = await discounts.history(
          identity.accessToken,
          identity.userId,
          params.campaignId,
          query,
        );
        const response: CampaignHistoryResponse = { entries, total };
        res.json(campaignHistoryResponseSchema.parse(response));
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  // A campaign is never deleted: orders reference the campaign that priced them, and the
  // audit trail must survive. Archiving is the way to retire one.

  return router;
}
