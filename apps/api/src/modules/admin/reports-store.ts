import {
  analyticsOverviewSchema,
  auditEntrySchema,
  DELIVERY_ZONES,
  deliveryChargeSchema,
  LOW_STOCK_THRESHOLD,
  orderGeographySchema,
  salesOverviewSchema,
  salesTargetResponseSchema,
  storeSettingsSchema,
  type AnalyticsOverview,
  type AuditEntry,
  type DashboardResponse,
  type DeliveryCharge,
  type DeliveryZone,
  type OrderGeography,
  type OrderGeographyQuery,
  type SalesOverview,
  type SalesTargetResponse,
  type SaveStoreSettingsRequest,
  type StoreSettings,
} from '@nilzora/contracts';
import { z } from 'zod';
import type { Pool } from 'pg';
import { withUser } from '../../db/user-context';
import type { SupabaseClients } from '../../supabase/clients';
import { conform, isoTimestamp, isoTimestamps, StoreUnavailableError } from '../commerce/errors';
import { toAdminStoreError } from './errors';
import { sqlNull, untypedRpc, type Page } from './shared';

export interface AuditFilters {
  actionPrefix?: string | undefined;
  actorId?: string | undefined;
  /** First and last Bangladesh day (YYYY-MM-DD, inclusive); either may be left open. */
  from?: string | undefined;
  to?: string | undefined;
  /** Plain-text search over the action, the actor's name and email, and the target id. */
  q?: string | undefined;
}

/** Products listed on the dashboard's low-stock card. */
const LOW_STOCK_LIST = 10;

/** A validated analytics range of Bangladesh calendar days (see analyticsOverviewQuerySchema). */
export interface AnalyticsRange {
  /** First day, YYYY-MM-DD. */
  from: string;
  /** Last day, YYYY-MM-DD (inclusive). */
  to: string;
  /** Also compute the previous period of the same length. */
  compare: boolean;
}

/**
 * The geography read's arguments, as the route validated them. `metric` is echoed back in
 * the payload so the page's legend and the data can never describe different things.
 */
export type OrderGeographyRequest = OrderGeographyQuery;

export type SalesTarget = SalesTargetResponse['target'];

const salesTargetSchema = salesTargetResponseSchema.shape.target;
/** What admin_set_sales_target returns: the timestamp still carries its database offset. */
const storedSalesTargetSchema = z.object({
  targetMinor: z.number().nullable(),
  updatedAt: z.string().nullable(),
});

/** The geography read's answer in the contract's shape, with ISO (UTC) timestamps. */
function toOrderGeography(value: unknown, operation: string): OrderGeography {
  return conform(orderGeographySchema, isoTimestamps(value), operation);
}

/** The database's answer in the contract's shape, with an ISO (UTC) timestamp. */
function toSalesTarget(value: unknown, operation: string): SalesTarget {
  const stored = conform(storedSalesTargetSchema, value, operation);
  return conform(
    salesTargetSchema,
    {
      targetMinor: stored.targetMinor,
      updatedAt: stored.updatedAt === null ? null : isoTimestamp(stored.updatedAt),
    },
    operation,
  );
}

/**
 * Reports and settings, as the signed-in caller: the audit log and sales figures come
 * from database functions that check the caller's permission; counts are plain reads
 * under Row Level Security.
 */
export interface AdminReportStore {
  auditLog(
    accessToken: string,
    userId: string,
    filters: AuditFilters,
    page: Page,
  ): Promise<{ entries: AuditEntry[]; total: number }>;
  salesOverview(accessToken: string, userId: string, days: number): Promise<SalesOverview>;
  /**
   * The dashboard and analytics aggregate over a range (finance.read). Top customers are
   * filled only when the caller also holds customers.read; the database decides.
   */
  analyticsOverview(
    accessToken: string,
    userId: string,
    range: AnalyticsRange,
  ): Promise<AnalyticsOverview>;
  /**
   * Order demand by division and district over a range of Dhaka days, from each order's
   * own delivery snapshot — one aggregate that the analytics page draws everything from.
   */
  orderGeography(
    accessToken: string,
    userId: string,
    query: OrderGeographyRequest,
  ): Promise<OrderGeography>;
  /** The store settings: return window, cart inactivity, insight thresholds, sales target. */
  storeSettings(accessToken: string, userId: string): Promise<StoreSettings>;
  /** Saves the two settings, and any threshold given, together (settings.manage). */
  saveStoreSettings(
    accessToken: string,
    userId: string,
    input: SaveStoreSettingsRequest,
  ): Promise<StoreSettings>;
  /** Sets the monthly sales target, or clears it with null (settings.manage). */
  setSalesTarget(
    accessToken: string,
    userId: string,
    targetMinor: number | null,
  ): Promise<SalesTarget>;
  /** One entry per delivery zone, set or not. */
  deliveryCharges(accessToken: string, userId: string): Promise<DeliveryCharge[]>;
  setDeliveryCharge(
    accessToken: string,
    userId: string,
    zone: DeliveryZone,
    amountMinor: number,
  ): Promise<DeliveryCharge>;
  orderCounts(
    accessToken: string,
    userId: string,
  ): Promise<NonNullable<DashboardResponse['orders']>>;
  lowStock(accessToken: string, userId: string): Promise<NonNullable<DashboardResponse['stock']>>;
  /** Pending reviews assigned to the caller, unassigned, and in total (as visible to them). */
  reviewCounts(
    accessToken: string,
    userId: string,
    callerId: string,
  ): Promise<{ assignedToMe: number; unassigned: number; pending: number }>;
}

const entriesSchema = z.array(auditEntrySchema);

/** The settings document from the database, with its timestamp in the contract's form. */
function toStoreSettings(value: unknown, operation: string): StoreSettings {
  const row = (value ?? {}) as Record<string, unknown>;
  return conform(
    storeSettingsSchema,
    { ...row, updatedAt: isoTimestamp(row.updatedAt as string | Date) },
    operation,
  );
}

export function createSupabaseAdminReportStore(clients: SupabaseClients): AdminReportStore {
  async function auditPage(
    accessToken: string,
    filters: AuditFilters,
    { limit, offset }: Page,
  ): Promise<AuditRow[]> {
    const { data, error } = await untypedRpc(clients.asUser(accessToken))(
      'admin_audit_log_search',
      {
        p_action_prefix: sqlNull(filters.actionPrefix),
        p_actor: sqlNull(filters.actorId),
        p_from: sqlNull(filters.from),
        p_to: sqlNull(filters.to),
        p_q: sqlNull(filters.q),
        p_limit: limit,
        p_offset: offset,
      },
    );
    if (error) throw toAdminStoreError(error, 'admin_audit_log_search');
    return (data ?? []) as AuditRow[];
  }

  async function deliveryCharges(accessToken: string) {
    const { data, error } = await clients
      .asUser(accessToken)
      .from('delivery_charges')
      .select('zone, amount_minor, updated_at');
    if (error) throw toAdminStoreError(error, 'delivery_charges');
    return DELIVERY_ZONES.map((zone) => {
      const row = data.find((candidate) => candidate.zone === zone);
      return conform(
        deliveryChargeSchema,
        {
          zone,
          amountMinor: row?.amount_minor ?? null,
          updatedAt: row ? isoTimestamp(row.updated_at) : null,
        },
        'delivery_charges',
      );
    });
  }

  async function count(
    accessToken: string,
    table: 'orders' | 'moderation_tasks',
    filters: Record<string, string | null>,
  ): Promise<number> {
    let query = clients
      .asUser(accessToken)
      .from(table)
      .select('id', { count: 'exact', head: true });
    for (const [column, value] of Object.entries(filters)) {
      query = value === null ? query.is(column, null) : query.eq(column, value);
    }
    const { error, count: total } = await query;
    if (error) throw toAdminStoreError(error, table);
    return total ?? 0;
  }

  return {
    async auditLog(accessToken, _userId, filters, page) {
      const rows = await auditPage(accessToken, filters, page);
      const counted =
        rows.length > 0 || page.offset === 0
          ? rows
          : await auditPage(accessToken, filters, { limit: 1, offset: 0 });
      const entries = rows.map((row) => ({
        id: Number(row.id),
        actor:
          row.actor_id === null
            ? null
            : { id: row.actor_id, name: row.actor_name ?? null, email: row.actor_email ?? null },
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id ?? null,
        details: row.details,
        createdAt: isoTimestamp(row.created_at),
      }));
      return {
        entries: conform(entriesSchema, entries, 'admin_audit_log'),
        total: Number(counted[0]?.total_count ?? 0),
      };
    },

    async storeSettings(accessToken) {
      const { data, error } = await untypedRpc(clients.asUser(accessToken))('admin_store_settings');
      if (error) throw toAdminStoreError(error, 'admin_store_settings');
      return toStoreSettings(data, 'admin_store_settings');
    },

    async saveStoreSettings(accessToken, _userId, input) {
      const { data, error } = await untypedRpc(clients.asUser(accessToken))(
        'admin_save_store_settings',
        {
          p_return_window_days: input.returnWindowDays,
          p_cart_inactivity_minutes: input.cartInactivityMinutes,
          p_repeat_order_threshold: sqlNull(input.repeatOrderThreshold),
          p_high_spend_threshold_minor: sqlNull(input.highSpendThresholdMinor),
          p_inactive_days: sqlNull(input.inactiveDays),
          p_cod_enabled: sqlNull(input.codEnabled),
        },
      );
      if (error) throw toAdminStoreError(error, 'admin_save_store_settings');
      return toStoreSettings(data, 'admin_save_store_settings');
    },

    async salesOverview(accessToken, _userId, days) {
      const { data, error } = await clients
        .asUser(accessToken)
        .rpc('admin_sales_overview', { p_days: days });
      if (error) throw toAdminStoreError(error, 'admin_sales_overview');
      return conform(salesOverviewSchema, data, 'admin_sales_overview');
    },

    async analyticsOverview(accessToken, _userId, range) {
      const { data, error } = await clients.asUser(accessToken).rpc('admin_analytics_overview', {
        p_from: range.from,
        p_to: range.to,
        p_compare: range.compare,
      });
      if (error) throw toAdminStoreError(error, 'admin_analytics_overview');
      return conform(analyticsOverviewSchema, data, 'admin_analytics_overview');
    },

    async orderGeography(accessToken, _userId, query) {
      const { data, error } = await clients.asUser(accessToken).rpc('admin_order_geography', {
        p_from: query.from,
        p_to: query.to,
        p_division: sqlNull(query.division),
        p_district: sqlNull(query.district),
        p_status: sqlNull(query.status),
        p_metric: query.metric,
      });
      if (error) throw toAdminStoreError(error, 'admin_order_geography');
      return toOrderGeography(data, 'admin_order_geography');
    },

    async setSalesTarget(accessToken, _userId, targetMinor) {
      const { data, error } = await clients
        .asUser(accessToken)
        .rpc('admin_set_sales_target', { p_target_minor: sqlNull(targetMinor) });
      if (error) throw toAdminStoreError(error, 'admin_set_sales_target');
      return toSalesTarget(data, 'admin_set_sales_target');
    },

    deliveryCharges,

    async setDeliveryCharge(accessToken, _userId, zone, amountMinor) {
      const { error } = await clients
        .asUser(accessToken)
        .rpc('admin_set_delivery_charge', { p_zone: zone, p_amount_minor: amountMinor });
      if (error) throw toAdminStoreError(error, 'admin_set_delivery_charge');
      const charges = await deliveryCharges(accessToken);
      return (
        charges.find((charge) => charge.zone === zone) ?? { zone, amountMinor, updatedAt: null }
      );
    },

    async orderCounts(accessToken) {
      const [pending, confirmed, processing, shipped, awaitingCollection] = await Promise.all([
        count(accessToken, 'orders', { status: 'pending' }),
        count(accessToken, 'orders', { status: 'confirmed' }),
        count(accessToken, 'orders', { status: 'processing' }),
        count(accessToken, 'orders', { status: 'shipped' }),
        count(accessToken, 'orders', { status: 'delivered', payment_status: 'pending' }),
      ]);
      return { pending, confirmed, processing, shipped, awaitingCollection };
    },

    async lowStock(accessToken) {
      const {
        data,
        error,
        count: total,
      } = await clients
        .asUser(accessToken)
        .from('products')
        .select('id, name, sku, stock_quantity', { count: 'exact' })
        .eq('status', 'active')
        .lte('stock_quantity', LOW_STOCK_THRESHOLD)
        .order('stock_quantity')
        .order('name')
        .limit(LOW_STOCK_LIST);
      if (error) throw toAdminStoreError(error, 'products');
      return {
        lowStockCount: total ?? data.length,
        products: data.map((row) => ({
          id: row.id,
          name: row.name,
          sku: row.sku,
          stockQuantity: row.stock_quantity,
        })),
      };
    },

    async reviewCounts(accessToken, _userId, callerId) {
      const [assignedToMe, unassigned, pending] = await Promise.all([
        count(accessToken, 'moderation_tasks', { status: 'pending', assigned_to: callerId }),
        count(accessToken, 'moderation_tasks', { status: 'pending', assigned_to: null }),
        count(accessToken, 'moderation_tasks', { status: 'pending' }),
      ]);
      return { assignedToMe, unassigned, pending };
    },
  };
}

/** PostgreSQL exposes custom SQLSTATEs (`NZ4xx`, `23505`, `23514`) as a string `code`. */
function pgFailure(error: unknown): { code: string; message: string; details: string | null } {
  const fields = error as { code?: unknown; message?: unknown; detail?: unknown } | null;
  return {
    code: typeof fields?.code === 'string' ? fields.code : '',
    message: typeof fields?.message === 'string' ? fields.message : 'database request failed',
    details: typeof fields?.detail === 'string' ? fields.detail : null,
  };
}

interface AuditRow {
  id: number | string;
  actor_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  details: unknown;
  created_at: string | Date;
  total_count: number | string;
}

/**
 * Reports and settings over a direct PostgreSQL connection, always as the signed-in
 * caller: the audit log and sales functions re-check the caller's permission, and the
 * counts are plain aggregate reads under the same RLS policies PostgREST applied.
 */
export function createPostgresAdminReportStore(pool: Pool): AdminReportStore {
  function failure(error: unknown, operation: string): Error {
    if (error instanceof StoreUnavailableError) return error;
    return toAdminStoreError(pgFailure(error), operation);
  }

  async function auditPage(
    userId: string,
    filters: AuditFilters,
    { limit, offset }: Page,
  ): Promise<AuditRow[]> {
    return withUser(pool, userId, async (client) => {
      const result = await client.query<AuditRow>(
        'select * from public.admin_audit_log_search($1, $2::uuid, $3::date, $4::date, $5, $6, $7)',
        [
          filters.actionPrefix ?? null,
          filters.actorId ?? null,
          filters.from ?? null,
          filters.to ?? null,
          filters.q ?? null,
          limit,
          offset,
        ],
      );
      return result.rows;
    });
  }

  async function charges(userId: string): Promise<DeliveryCharge[]> {
    return withUser(pool, userId, async (client) => {
      const result = await client.query<{
        zone: string;
        amount_minor: number | string;
        updated_at: string | Date;
      }>('select zone, amount_minor, updated_at from public.delivery_charges');
      return DELIVERY_ZONES.map((zone) => {
        const row = result.rows.find((candidate) => candidate.zone === zone);
        return conform(
          deliveryChargeSchema,
          {
            zone,
            amountMinor: row ? Number(row.amount_minor) : null,
            updatedAt: row ? isoTimestamp(row.updated_at) : null,
          },
          'delivery_charges',
        );
      });
    });
  }

  return {
    async auditLog(_accessToken, userId, filters, page) {
      try {
        const rows = await auditPage(userId, filters, page);
        const counted =
          rows.length > 0 || page.offset === 0
            ? rows
            : await auditPage(userId, filters, { limit: 1, offset: 0 });
        const entries = rows.map((row) => ({
          id: Number(row.id),
          actor:
            row.actor_id === null
              ? null
              : { id: row.actor_id, name: row.actor_name ?? null, email: row.actor_email ?? null },
          action: row.action,
          targetType: row.target_type,
          targetId: row.target_id ?? null,
          details: row.details,
          createdAt: isoTimestamp(row.created_at),
        }));
        return {
          entries: conform(entriesSchema, entries, 'admin_audit_log'),
          total: Number(counted[0]?.total_count ?? 0),
        };
      } catch (error) {
        throw failure(error, 'admin_audit_log');
      }
    },

    async storeSettings(_accessToken, userId) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{ value: unknown }>(
            'select public.admin_store_settings() as value',
          );
          return toStoreSettings(result.rows[0]?.value, 'admin_store_settings');
        });
      } catch (error) {
        throw failure(error, 'admin_store_settings');
      }
    },

    async saveStoreSettings(_accessToken, userId, input) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{ value: unknown }>(
            `select public.admin_save_store_settings(
               $1::integer, $2::integer, $3::integer, $4::bigint, $5::integer, $6::boolean) as value`,
            [
              input.returnWindowDays,
              input.cartInactivityMinutes,
              input.repeatOrderThreshold ?? null,
              input.highSpendThresholdMinor ?? null,
              input.inactiveDays ?? null,
              // Null leaves the switch as it is; the function reads it before deciding.
              input.codEnabled ?? null,
            ],
          );
          return toStoreSettings(result.rows[0]?.value, 'admin_save_store_settings');
        });
      } catch (error) {
        throw failure(error, 'admin_save_store_settings');
      }
    },

    async salesOverview(_accessToken, userId, days) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{ overview: unknown }>(
            'select public.admin_sales_overview($1) as overview',
            [days],
          );
          return conform(salesOverviewSchema, result.rows[0]?.overview, 'admin_sales_overview');
        });
      } catch (error) {
        throw failure(error, 'admin_sales_overview');
      }
    },

    async analyticsOverview(_accessToken, userId, range) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{ overview: unknown }>(
            'select public.admin_analytics_overview($1::date, $2::date, $3::boolean) as overview',
            [range.from, range.to, range.compare],
          );
          return conform(
            analyticsOverviewSchema,
            result.rows[0]?.overview,
            'admin_analytics_overview',
          );
        });
      } catch (error) {
        throw failure(error, 'admin_analytics_overview');
      }
    },

    async orderGeography(_accessToken, userId, query) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{ geography: unknown }>(
            `select public.admin_order_geography($1::date, $2::date, $3::text, $4::text, $5::text, $6::text) as geography`,
            [
              query.from,
              query.to,
              query.division ?? null,
              query.district ?? null,
              query.status ?? null,
              query.metric,
            ],
          );
          return toOrderGeography(result.rows[0]?.geography, 'admin_order_geography');
        });
      } catch (error) {
        throw failure(error, 'admin_order_geography');
      }
    },

    async setSalesTarget(_accessToken, userId, targetMinor) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{ target: unknown }>(
            'select public.admin_set_sales_target($1::bigint) as target',
            [targetMinor],
          );
          return toSalesTarget(result.rows[0]?.target, 'admin_set_sales_target');
        });
      } catch (error) {
        throw failure(error, 'admin_set_sales_target');
      }
    },

    deliveryCharges(_accessToken, userId) {
      return charges(userId).catch((error: unknown) => {
        throw failure(error, 'delivery_charges');
      });
    },

    async setDeliveryCharge(_accessToken, userId, zone, amountMinor) {
      try {
        await withUser(pool, userId, async (client) => {
          await client.query(
            'select public.admin_set_delivery_charge($1::public.delivery_zone, $2::bigint)',
            [zone, amountMinor],
          );
        });
      } catch (error) {
        throw failure(error, 'admin_set_delivery_charge');
      }
      const all = await charges(userId);
      return all.find((charge) => charge.zone === zone) ?? { zone, amountMinor, updatedAt: null };
    },

    async orderCounts(_accessToken, userId) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{
            pending: string;
            confirmed: string;
            processing: string;
            shipped: string;
            awaiting: string;
          }>(
            `select
               count(*) filter (where status = 'pending') as pending,
               count(*) filter (where status = 'confirmed') as confirmed,
               count(*) filter (where status = 'processing') as processing,
               count(*) filter (where status = 'shipped') as shipped,
               count(*) filter (where status = 'delivered' and payment_status = 'pending') as awaiting
             from public.orders`,
          );
          const row = result.rows[0];
          return {
            pending: Number(row?.pending ?? 0),
            confirmed: Number(row?.confirmed ?? 0),
            processing: Number(row?.processing ?? 0),
            shipped: Number(row?.shipped ?? 0),
            awaitingCollection: Number(row?.awaiting ?? 0),
          };
        });
      } catch (error) {
        throw failure(error, 'orders');
      }
    },

    async lowStock(_accessToken, userId) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{
            id: string;
            name: string;
            sku: string;
            stock_quantity: number;
            total: string;
          }>(
            `select id, name, sku, stock_quantity, count(*) over () as total
               from public.products
              where status = 'active' and stock_quantity <= $1
              order by stock_quantity, name
              limit $2`,
            [LOW_STOCK_THRESHOLD, LOW_STOCK_LIST],
          );
          return {
            lowStockCount: Number(result.rows[0]?.total ?? 0),
            products: result.rows.map((row) => ({
              id: row.id,
              name: row.name,
              sku: row.sku,
              stockQuantity: row.stock_quantity,
            })),
          };
        });
      } catch (error) {
        throw failure(error, 'products');
      }
    },

    async reviewCounts(_accessToken, userId, callerId) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{
            assigned: string;
            unassigned: string;
            pending: string;
          }>(
            `select
               count(*) filter (where status = 'pending' and assigned_to = $1) as assigned,
               count(*) filter (where status = 'pending' and assigned_to is null) as unassigned,
               count(*) filter (where status = 'pending') as pending
             from public.moderation_tasks`,
            [callerId],
          );
          const row = result.rows[0];
          return {
            assignedToMe: Number(row?.assigned ?? 0),
            unassigned: Number(row?.unassigned ?? 0),
            pending: Number(row?.pending ?? 0),
          };
        });
      } catch (error) {
        throw failure(error, 'moderation_tasks');
      }
    },
  };
}
