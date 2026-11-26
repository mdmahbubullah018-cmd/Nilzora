import {
  adminCouponListResponseSchema,
  adminCouponResponseSchema,
  couponRedemptionListResponseSchema,
  couponTargetingInputSchema,
  type AdminCoupon,
  type AdminCouponListQuery,
  type CouponRedemption,
  type CouponSaveRequest,
} from '@nilzora/contracts';
import type { Pool } from 'pg';
import { withUser } from '../../db/user-context';
import type { SupabaseClients } from '../../supabase/clients';
import { conform, isoTimestamp, StoreUnavailableError } from '../commerce/errors';
import { toAdminStoreError } from './errors';
import { sqlNull, type Page } from './shared';

/**
 * Coupons as the admin sees them. Every call runs as the signed-in account, and the
 * database functions check `coupons.update` again, so a missing API check could still
 * not read or change a coupon.
 */
export interface AdminCouponStore {
  list(
    accessToken: string,
    userId: string,
    filters: Pick<AdminCouponListQuery, 'q' | 'state'>,
    page: Page,
  ): Promise<{ coupons: AdminCoupon[]; total: number }>;
  get(accessToken: string, userId: string, couponId: string): Promise<AdminCoupon | null>;
  /** Creates (couponId null) or updates a coupon; returns its id. */
  save(
    accessToken: string,
    userId: string,
    couponId: string | null,
    input: CouponSaveRequest,
  ): Promise<string>;
  setActive(
    accessToken: string,
    userId: string,
    couponId: string,
    isActive: boolean,
  ): Promise<void>;
  /** Deletes a coupon nobody redeemed (NZ442 once an order used it). */
  remove(accessToken: string, userId: string, couponId: string): Promise<void>;
  redemptions(
    accessToken: string,
    userId: string,
    couponId: string,
    page: Page,
  ): Promise<{ redemptions: CouponRedemption[]; total: number }>;
}

/** The arguments every database function takes, in one shape. */
/**
 * The database writes timestamps as `2026-11-08T09:30:00.123+00:00`; the contract wants the
 * `Z` form, so every coupon timestamp is normalised before the answer is checked.
 */
function isoCoupon(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const coupon: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const key of ['startsAt', 'endsAt', 'createdAt', 'updatedAt']) {
    const value = coupon[key];
    if (typeof value === 'string') coupon[key] = isoTimestamp(value);
  }
  return coupon;
}

/** The redemption history, with `redeemedAt` in the `Z` form the contract wants. */
function isoRedemptionList(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const list = raw as { redemptions?: unknown };
  if (!Array.isArray(list.redemptions)) return raw;
  return {
    ...list,
    redemptions: list.redemptions.map((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null) return entry;
      const redemption = { ...(entry as Record<string, unknown>) };
      if (typeof redemption.redeemedAt === 'string') {
        redemption.redeemedAt = isoTimestamp(redemption.redeemedAt);
      }
      return redemption;
    }),
  };
}

function isoCouponList(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const list = raw as { coupons?: unknown };
  return Array.isArray(list.coupons) ? { ...list, coupons: list.coupons.map(isoCoupon) } : raw;
}

/** The targeting call's arguments; a coupon that is not a voucher keeps no title or cap. */
function targetingArgs(couponId: string, input: NonNullable<CouponSaveRequest['targeting']>) {
  const t = couponTargetingInputSchema.parse(input);
  return {
    p_coupon_id: couponId,
    p_is_voucher: t.isVoucher,
    p_title: sqlNull(t.isVoucher ? t.title : null),
    p_scope: t.scope,
    p_category_ids: t.scope === 'categories' ? t.categoryIds : [],
    p_product_ids: t.scope === 'products' ? t.productIds : [],
    p_audience: t.audience,
    p_collect_limit: sqlNull(t.isVoucher ? t.collectLimit : null),
    // The recipient list only means something for a targeted coupon; the database clears it otherwise.
    p_customer_ids: t.audience === 'selected_customers' ? t.customerIds : [],
  };
}

function listArgs(filters: Pick<AdminCouponListQuery, 'q' | 'state'>, { limit, offset }: Page) {
  return {
    p_search: sqlNull(filters.q === undefined || filters.q === '' ? null : filters.q),
    p_state: filters.state ?? 'all',
    p_page: Math.floor(offset / limit) + 1,
    p_page_size: limit,
  };
}

function saveArgs(couponId: string | null, input: CouponSaveRequest) {
  return {
    p_coupon_id: sqlNull(couponId),
    p_code: input.code,
    p_kind: input.kind,
    p_value: input.value,
    p_min_order_minor: input.minOrderMinor ?? 0,
    p_max_discount_minor: sqlNull(input.maxDiscountMinor ?? null),
    p_starts_at: sqlNull(input.startsAt ?? null),
    p_ends_at: sqlNull(input.endsAt ?? null),
    p_total_limit: sqlNull(input.totalLimit ?? null),
    p_per_customer_limit: input.perCustomerLimit ?? 1,
    p_is_active: input.isActive ?? true,
    p_description: sqlNull(input.description ?? null),
  };
}

export function createSupabaseAdminCouponStore(clients: SupabaseClients): AdminCouponStore {
  function asUser(accessToken: string) {
    return clients.asUser(accessToken);
  }

  return {
    async list(accessToken, _userId, filters, page) {
      const { data, error } = await asUser(accessToken).rpc(
        'admin_list_coupons',
        listArgs(filters, page),
      );
      if (error) throw toAdminStoreError(error, 'admin_list_coupons');
      const parsed = conform(
        adminCouponListResponseSchema,
        isoCouponList(data),
        'admin_list_coupons',
      );
      return { coupons: parsed.coupons, total: parsed.total };
    },

    async get(accessToken, _userId, couponId) {
      const { data, error } = await asUser(accessToken).rpc('admin_get_coupon', {
        p_coupon_id: couponId,
      });
      if (error) {
        if (error.code === 'NZ404') return null;
        throw toAdminStoreError(error, 'admin_get_coupon');
      }
      const targeting = await asUser(accessToken).rpc('admin_coupon_targeting', {
        p_coupon_id: couponId,
      });
      if (targeting.error) throw toAdminStoreError(targeting.error, 'admin_coupon_targeting');
      return conform(
        adminCouponResponseSchema,
        { coupon: { ...(isoCoupon(data) as object), targeting: targeting.data } },
        'admin_get_coupon',
      ).coupon;
    },

    async save(accessToken, _userId, couponId, input) {
      const { data, error } = await asUser(accessToken).rpc(
        'admin_save_coupon',
        saveArgs(couponId, input),
      );
      if (error) throw toAdminStoreError(error, 'admin_save_coupon');
      if (typeof data !== 'string') {
        throw new StoreUnavailableError('admin_save_coupon returned no coupon id');
      }
      if (input.targeting) {
        const saved = await asUser(accessToken).rpc(
          'admin_save_coupon_targeting',
          targetingArgs(data, input.targeting),
        );
        if (saved.error) throw toAdminStoreError(saved.error, 'admin_save_coupon_targeting');
      }
      return data;
    },

    async remove(accessToken, _userId, couponId) {
      const { error } = await asUser(accessToken).rpc('admin_delete_coupon', {
        p_coupon_id: couponId,
      });
      if (error) throw toAdminStoreError(error, 'admin_delete_coupon');
    },

    async setActive(accessToken, _userId, couponId, isActive) {
      const { error } = await asUser(accessToken).rpc('admin_set_coupon_active', {
        p_coupon_id: couponId,
        p_is_active: isActive,
      });
      if (error) throw toAdminStoreError(error, 'admin_set_coupon_active');
    },

    async redemptions(accessToken, _userId, couponId, page) {
      const { data, error } = await asUser(accessToken).rpc('admin_coupon_redemptions', {
        p_coupon_id: couponId,
        p_page: Math.floor(page.offset / page.limit) + 1,
        p_page_size: page.limit,
      });
      if (error) throw toAdminStoreError(error, 'admin_coupon_redemptions');
      const parsed = conform(
        couponRedemptionListResponseSchema,
        isoRedemptionList(data),
        'admin_coupon_redemptions',
      );
      return { redemptions: parsed.redemptions, total: parsed.total };
    },
  };
}

/** PostgreSQL exposes custom SQLSTATEs (`NZ450`) as a string `code`. */
function pgFailure(error: unknown): { code: string; message: string; details: string | null } {
  const fields = error as { code?: unknown; message?: unknown; detail?: unknown } | null;
  return {
    code: typeof fields?.code === 'string' ? fields.code : '',
    message: typeof fields?.message === 'string' ? fields.message : 'database request failed',
    details: typeof fields?.detail === 'string' ? fields.detail : null,
  };
}

export function createPostgresAdminCouponStore(pool: Pool): AdminCouponStore {
  function failure(error: unknown, operation: string): Error {
    if (error instanceof StoreUnavailableError) return error;
    return toAdminStoreError(pgFailure(error), operation);
  }

  /** Runs `sql` as the caller and returns the single jsonb column it produced. */
  async function callJson(
    userId: string,
    operation: string,
    sql: string,
    parameters: unknown[],
  ): Promise<unknown> {
    try {
      return await withUser(pool, userId, async (client) => {
        const result = await client.query<{ payload: unknown }>(sql, parameters);
        return result.rows[0]?.payload;
      });
    } catch (error) {
      throw failure(error, operation);
    }
  }

  return {
    async list(_accessToken, userId, filters, page) {
      const args = listArgs(filters, page);
      const payload = await callJson(
        userId,
        'admin_list_coupons',
        'select public.admin_list_coupons($1::text, $2::text, $3::int, $4::int) as payload',
        [args.p_search, args.p_state, args.p_page, args.p_page_size],
      );
      const parsed = conform(
        adminCouponListResponseSchema,
        isoCouponList(payload),
        'admin_list_coupons',
      );
      return { coupons: parsed.coupons, total: parsed.total };
    },

    async get(_accessToken, userId, couponId) {
      try {
        const payload = await withUser(pool, userId, async (client) => {
          const result = await client.query<{ payload: unknown; targeting: unknown }>(
            'select public.admin_get_coupon($1::uuid) as payload, public.admin_coupon_targeting($1::uuid) as targeting',
            [couponId],
          );
          return result.rows[0];
        });
        return conform(
          adminCouponResponseSchema,
          { coupon: { ...(isoCoupon(payload?.payload) as object), targeting: payload?.targeting } },
          'admin_get_coupon',
        ).coupon;
      } catch (error) {
        if (pgFailure(error).code === 'NZ404') return null;
        throw failure(error, 'admin_get_coupon');
      }
    },

    async save(_accessToken, userId, couponId, input) {
      const args = saveArgs(couponId, input);
      try {
        const id = await withUser(pool, userId, async (client) => {
          const result = await client.query<{ id: string }>(
            `select public.admin_save_coupon(
               $1::uuid, $2::text, $3::text, $4::bigint, $5::bigint, $6::bigint,
               $7::timestamptz, $8::timestamptz, $9::int, $10::int, $11::boolean, $12::text
             ) as id`,
            [
              args.p_coupon_id,
              args.p_code,
              args.p_kind,
              args.p_value,
              args.p_min_order_minor,
              args.p_max_discount_minor,
              args.p_starts_at,
              args.p_ends_at,
              args.p_total_limit,
              args.p_per_customer_limit,
              args.p_is_active,
              args.p_description,
            ],
          );
          const savedId = result.rows[0]?.id;
          if (savedId && input.targeting) {
            const t = targetingArgs(savedId, input.targeting);
            await client.query(
              'select public.admin_save_coupon_targeting($1::uuid, $2::boolean, $3::text, $4::text, $5::uuid[], $6::uuid[], $7::text, $8::int, $9::uuid[])',
              [
                t.p_coupon_id,
                t.p_is_voucher,
                t.p_title,
                t.p_scope,
                t.p_category_ids,
                t.p_product_ids,
                t.p_audience,
                t.p_collect_limit,
                t.p_customer_ids,
              ],
            );
          }
          return savedId;
        });
        if (typeof id !== 'string') {
          throw new StoreUnavailableError('admin_save_coupon returned no coupon id');
        }
        return id;
      } catch (error) {
        throw failure(error, 'admin_save_coupon');
      }
    },

    async remove(_accessToken, userId, couponId) {
      try {
        await withUser(pool, userId, async (client) => {
          await client.query('select public.admin_delete_coupon($1::uuid)', [couponId]);
        });
      } catch (error) {
        throw failure(error, 'admin_delete_coupon');
      }
    },

    async setActive(_accessToken, userId, couponId, isActive) {
      try {
        await withUser(pool, userId, async (client) => {
          await client.query('select public.admin_set_coupon_active($1::uuid, $2::boolean)', [
            couponId,
            isActive,
          ]);
        });
      } catch (error) {
        throw failure(error, 'admin_set_coupon_active');
      }
    },

    async redemptions(_accessToken, userId, couponId, page) {
      const payload = await callJson(
        userId,
        'admin_coupon_redemptions',
        'select public.admin_coupon_redemptions($1::uuid, $2::int, $3::int) as payload',
        [couponId, Math.floor(page.offset / page.limit) + 1, page.limit],
      );
      const parsed = conform(
        couponRedemptionListResponseSchema,
        isoRedemptionList(payload),
        'admin_coupon_redemptions',
      );
      return { redemptions: parsed.redemptions, total: parsed.total };
    },
  };
}
