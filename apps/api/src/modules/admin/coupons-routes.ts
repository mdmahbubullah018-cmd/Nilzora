import {
  adminCouponListQuerySchema,
  adminCouponListResponseSchema,
  couponActiveRequestSchema,
  couponRedemptionListResponseSchema,
  couponSaveRequestSchema,
  type AdminCouponListResponse,
  type AdminCouponResponse,
  type CouponRedemptionListResponse,
} from '@nilzora/contracts';
import { Router } from 'express';
import { z } from 'zod';
import { currentIdentity, requirePermission } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { noStore } from '../commerce/http';
import { sendAdminFailure, type AdminRefusal, type RefusalAnswer } from './errors';
import type { AdminRouteDependencies } from './routes';
import { pageInfo, pageOf } from './shared';

/**
 * A coupon an order already redeemed keeps its code and discount (the database refuses with
 * NZ442), so the orders it priced keep meaning what they meant.
 */
const COUPON_LOCKED: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  in_use: [
    409,
    'in_use',
    'This coupon was already used in orders, so its code and discount can no longer change',
  ],
};

const listSchemas = { query: adminCouponListQuerySchema };
const idSchemas = { params: z.object({ couponId: z.uuid() }) };
const saveSchemas = { body: couponSaveRequestSchema };
const updateSchemas = { ...idSchemas, body: couponSaveRequestSchema };
const activeSchemas = { ...idSchemas, body: couponActiveRequestSchema };
const redemptionSchemas = {
  params: z.object({ couponId: z.uuid() }),
  query: z.object({
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  }),
};

/**
 * Coupons: every route requires `coupons.update`, because a coupon is a discount the
 * store pays for, and creating one also requires `coupons.create`. The database checks the
 * same permissions again inside each function, so a missing API check could not widen
 * access. Reads are never cached.
 */
export function adminCouponsRouter(deps: AdminRouteDependencies): Router {
  const router = Router();
  const { coupons } = deps.stores;
  const { requireUser, limiter } = deps;
  const canManage = requirePermission('coupons.update');

  router.get(
    '/admin/coupons',
    noStore,
    requireUser,
    canManage,
    validate(listSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof listSchemas>(res);
      try {
        const { coupons: rows, total } = await coupons.list(
          identity.accessToken,
          identity.userId,
          { q: query.q, state: query.state },
          pageOf(query),
        );
        const response: AdminCouponListResponse = { coupons: rows, ...pageInfo(query, total) };
        res.json(adminCouponListResponseSchema.parse(response));
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  // Creating a coupon also needs coupons.create (the database function checks it again).
  router.post(
    '/admin/coupons',
    noStore,
    requireUser,
    requirePermission('coupons.update', 'coupons.create'),
    limiter,
    validate(saveSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof saveSchemas>(res);
      try {
        const couponId = await coupons.save(identity.accessToken, identity.userId, null, body);
        const coupon = await coupons.get(identity.accessToken, identity.userId, couponId);
        if (!coupon) throw new Error('the coupon vanished after it was saved');
        const response: AdminCouponResponse = { coupon };
        res.status(201).json(response);
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.get(
    '/admin/coupons/:couponId',
    noStore,
    requireUser,
    canManage,
    validate(idSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof idSchemas>(res);
      try {
        const coupon = await coupons.get(identity.accessToken, identity.userId, params.couponId);
        if (!coupon) {
          res.status(404).json({ error: { code: 'not_found', message: 'Coupon not found' } });
          return;
        }
        const response: AdminCouponResponse = { coupon };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.put(
    '/admin/coupons/:couponId',
    noStore,
    requireUser,
    canManage,
    limiter,
    validate(updateSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof updateSchemas>(res);
      try {
        const couponId = await coupons.save(
          identity.accessToken,
          identity.userId,
          params.couponId,
          body,
        );
        const coupon = await coupons.get(identity.accessToken, identity.userId, couponId);
        if (!coupon) throw new Error('the coupon vanished after it was saved');
        const response: AdminCouponResponse = { coupon };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, COUPON_LOCKED);
      }
    },
  );

  // Deleting is for coupons and vouchers nobody redeemed; a used one can only be switched off.
  router.delete(
    '/admin/coupons/:couponId',
    noStore,
    requireUser,
    canManage,
    limiter,
    validate(idSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof idSchemas>(res);
      try {
        await coupons.remove(identity.accessToken, identity.userId, params.couponId);
        res.status(204).end();
      } catch (error) {
        sendAdminFailure(res, error, {
          not_found: [404, 'not_found', 'Coupon not found'],
          in_use: [
            409,
            'in_use',
            'This coupon was used in orders, so it cannot be deleted. Switch it off instead.',
          ],
        });
      }
    },
  );

  router.patch(
    '/admin/coupons/:couponId/active',
    noStore,
    requireUser,
    canManage,
    limiter,
    validate(activeSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof activeSchemas>(res);
      try {
        await coupons.setActive(
          identity.accessToken,
          identity.userId,
          params.couponId,
          body.isActive,
        );
        res.status(204).end();
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.get(
    '/admin/coupons/:couponId/redemptions',
    noStore,
    requireUser,
    canManage,
    validate(redemptionSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, query } = requestInput<typeof redemptionSchemas>(res);
      try {
        const { redemptions, total } = await coupons.redemptions(
          identity.accessToken,
          identity.userId,
          params.couponId,
          pageOf(query),
        );
        const response: CouponRedemptionListResponse = {
          redemptions,
          ...pageInfo(query, total),
        };
        res.json(couponRedemptionListResponseSchema.parse(response));
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  // A coupon is never deleted: redemptions reference it and orders keep their discount.
  // Deactivating is the way to stop a code being used.

  return router;
}
