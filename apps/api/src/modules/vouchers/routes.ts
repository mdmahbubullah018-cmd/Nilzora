import {
  voucherListResponseSchema,
  voucherResponseSchema,
  voucherSchema,
  type Voucher,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Router, type RequestHandler, type Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { sendError } from '../../http/send-error';
import {
  authenticate,
  optionalAuthenticate,
  type AuthDependencies,
} from '../../middleware/authenticate';
import { currentIdentity } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import type { SupabaseClients } from '../../supabase/clients';
import { AdminRefusalError } from '../admin/errors';
import { CommerceRefusalError, conform, isoTimestamps } from '../commerce/errors';
import { noStore } from '../commerce/http';
import { postgresRpc, supabaseRpc, type Rpc } from '../db-rpc';

/*
 * Vouchers for customers
 * ----------------------
 * GET  /vouchers                     the Voucher Center (signed in or not)
 * GET  /vouchers/for-product/:slug    the vouchers that apply to one product (its page)
 * GET  /me/vouchers                  the caller's collected vouchers (My Vouchers)
 * POST /vouchers/:voucherId/collect  collect one (idempotent)
 *
 * Every rule (window, audience, collection cap, one collection per customer, the 4-day
 * hiding after expiry) lives in the database functions; the API only carries the call as
 * the verified caller and checks the answer's shape. Redeeming is the checkout's coupon
 * step: a collected voucher is applied by its code, like a typed coupon, so one order can
 * never carry both.
 */

export interface VoucherStore {
  center(accessToken: string | null, userId: string | null): Promise<Voucher[]>;
  mine(accessToken: string, userId: string): Promise<Voucher[]>;
  /** The vouchers that apply to one product: its own, its category's and the store-wide ones. */
  forProduct(accessToken: string | null, userId: string | null, slug: string): Promise<Voucher[]>;
  collect(accessToken: string, userId: string, voucherId: string): Promise<Voucher>;
}

function storeOver(
  rpcFor: (accessToken: string | null, userId: string | null) => Rpc,
): VoucherStore {
  const list = (value: unknown, operation: string) =>
    conform(z.array(voucherSchema), isoTimestamps(value ?? []), operation);
  return {
    async center(accessToken, userId) {
      return list(await rpcFor(accessToken, userId)('voucher_center', {}), 'voucher_center');
    },
    async mine(accessToken, userId) {
      return list(await rpcFor(accessToken, userId)('my_vouchers', {}), 'my_vouchers');
    },
    async forProduct(accessToken, userId, slug) {
      return list(
        await rpcFor(accessToken, userId)('product_vouchers', { p_slug: slug }),
        'product_vouchers',
      );
    },
    async collect(accessToken, userId, voucherId) {
      const value = await rpcFor(accessToken, userId)('collect_voucher', {
        p_coupon_id: voucherId,
      });
      return conform(voucherSchema, isoTimestamps(value), 'collect_voucher');
    },
  };
}

export function createPostgresVoucherStore(pool: Pool): VoucherStore {
  const rpc = postgresRpc(pool);
  return storeOver((_token, userId) => rpc(userId));
}

export function createSupabaseVoucherStore(clients: SupabaseClients): VoucherStore {
  const rpc = supabaseRpc(clients);
  return storeOver((token) => rpc(token));
}

export interface VoucherRouteDependencies extends AuthDependencies {
  vouchers: VoucherStore;
  /** The per-client limit shared with other customer writes. */
  limiter: RequestHandler;
}

const collectSchemas = { params: z.object({ voucherId: uuidSchema }) };
const productSchemas = { params: z.object({ slug: z.string().trim().min(1).max(160) }) };

/** A voucher refusal (NZ459) or "not found" from either database path. */
function sendVoucherRefusal(res: Response, error: unknown): boolean {
  const refused =
    (error instanceof CommerceRefusalError && error.refusal === 'voucher_unavailable') ||
    (error instanceof AdminRefusalError && (error.refusal as string) !== 'missing_permission');
  if (!refused) return false;
  sendError(
    res,
    409,
    'voucher_unavailable',
    'This voucher cannot be collected on your account right now. Check its dates and conditions.',
  );
  return true;
}

export function voucherRoutes(deps: VoucherRouteDependencies): Router {
  const router = Router();
  const { vouchers, limiter } = deps;

  router.get('/vouchers', noStore, optionalAuthenticate(deps), async (_req, res) => {
    const identity = res.locals.identity;
    const list = await vouchers.center(identity?.accessToken ?? null, identity?.userId ?? null);
    res.json(voucherListResponseSchema.parse({ vouchers: list }));
  });

  router.get(
    '/vouchers/for-product/:slug',
    noStore,
    optionalAuthenticate(deps),
    validate(productSchemas),
    async (_req, res) => {
      const identity = res.locals.identity;
      const { params } = requestInput<typeof productSchemas>(res);
      const list = await vouchers.forProduct(
        identity?.accessToken ?? null,
        identity?.userId ?? null,
        params.slug,
      );
      // Only what a customer can still act on: a used, expired or fully collected voucher is noise here.
      const open = list.filter((v) => ['available', 'collected', 'upcoming'].includes(v.state));
      res.json(voucherListResponseSchema.parse({ vouchers: open }));
    },
  );

  router.get('/me/vouchers', noStore, authenticate(deps), async (_req, res) => {
    const identity = currentIdentity(res);
    const list = await vouchers.mine(identity.accessToken, identity.userId);
    res.json(voucherListResponseSchema.parse({ vouchers: list }));
  });

  router.post(
    '/vouchers/:voucherId/collect',
    noStore,
    limiter,
    authenticate(deps),
    validate(collectSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof collectSchemas>(res);
      try {
        const voucher = await vouchers.collect(
          identity.accessToken,
          identity.userId,
          params.voucherId,
        );
        res.status(201).json(voucherResponseSchema.parse({ voucher }));
      } catch (error) {
        if (!sendVoucherRefusal(res, error)) throw error;
      }
    },
  );

  return router;
}
