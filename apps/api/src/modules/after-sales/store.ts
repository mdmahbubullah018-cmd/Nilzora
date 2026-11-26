import {
  myRefundSchema,
  refundDetailSchema,
  refundSummarySchema,
  returnDetailSchema,
  returnSummarySchema,
  type AdminRefundListQuery,
  type AdminReturnListQuery,
  type MyRefund,
  type RefundDetail,
  type RefundSummary,
  type RefundRequest,
  type ReturnDetail,
  type ReturnRequest,
  type ReturnStatus,
  type ReturnSummary,
} from '@nilzora/contracts';
import { functionCallSql } from '../db-rpc';
import type { Pool } from 'pg';
import { z } from 'zod';
import { withUser } from '../../db/user-context';
import type { SupabaseClients } from '../../supabase/clients';
import {
  StoreUnavailableError,
  isoTimestamp,
  isoTimestamps,
  toStoreError,
  type DatabaseFailure,
} from '../commerce/errors';
import { toAdminStoreError } from '../admin/errors';

/**
 * The generated client typings enumerate every RPC by name, but both after-sales
 * adapters are generic over the function name by design, so the callable is widened
 * once here instead of asserting at every call site.
 */
type RpcCall = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: DatabaseFailure | null }>;

/*
 * Returns and refunds
 * -------------------
 * Every call runs one permission-checking database function as the signed-in user, so this
 * module never decides eligibility, quantities, balances or stock: it maps rows to the
 * contract and lets a refusal become a stable error code. Customer calls read their own
 * rows only (the functions filter on auth.uid()); staff calls are authorised twice — by the
 * route's permission and again inside the database function.
 */

/** One database function call, as the caller. */
type Rpc = <T>(name: string, args: Record<string, unknown>) => Promise<T>;

export interface AfterSalesStore {
  requestReturn(accessToken: string, userId: string, input: ReturnRequest): Promise<string>;
  cancelMyReturn(accessToken: string, userId: string, returnId: string): Promise<void>;
  myReturns(accessToken: string, userId: string): Promise<ReturnSummary[]>;
  myReturn(accessToken: string, userId: string, returnId: string): Promise<ReturnDetail | null>;
  myRefunds(accessToken: string, userId: string, orderNumber: string): Promise<MyRefund[]>;
  listReturns(
    accessToken: string,
    userId: string,
    query: AdminReturnListQuery,
    page: { limit: number; offset: number },
  ): Promise<{ returns: ReturnSummary[]; total: number }>;
  getReturn(accessToken: string, userId: string, returnId: string): Promise<ReturnDetail | null>;
  decideReturn(
    accessToken: string,
    userId: string,
    returnId: string,
    status: Exclude<ReturnStatus, 'requested'>,
    note?: string,
  ): Promise<void>;
  restockReturn(
    accessToken: string,
    userId: string,
    returnId: string,
    note?: string,
  ): Promise<number>;
  listRefunds(
    accessToken: string,
    userId: string,
    query: AdminRefundListQuery,
    page: { limit: number; offset: number },
  ): Promise<{ refunds: RefundSummary[]; total: number }>;
  getRefund(accessToken: string, userId: string, refundId: string): Promise<RefundDetail | null>;
  requestRefund(accessToken: string, userId: string, input: RefundRequest): Promise<string>;
  decideRefund(
    accessToken: string,
    userId: string,
    refundId: string,
    approve: boolean,
    note?: string,
  ): Promise<void>;
  completeRefund(
    accessToken: string,
    userId: string,
    refundId: string,
    reference: string,
    note?: string,
  ): Promise<void>;
  cancelRefund(accessToken: string, userId: string, refundId: string, note: string): Promise<void>;
}

interface ReturnRow {
  id: string;
  order_number: string;
  customer_name?: string | null;
  status: string;
  item_count: number | string;
  refundable_minor: number | string;
  reason: string;
  requested_at: string | Date;
  decided_at: string | Date | null;
  total_count?: number | string;
}

interface RefundRow {
  id: string;
  order_number: string;
  customer_name?: string | null;
  amount_minor: number | string;
  method: string;
  status: string;
  reason: string;
  requested_at: string | Date;
  completed_at: string | Date | null;
  total_count?: number | string;
}

interface MyRefundRow {
  id: string;
  amount_minor: number | string;
  method: string;
  status: string;
  reason: string;
  reference: string | null;
  requested_at: string | Date;
  completed_at: string | Date | null;
}

const idSchema = z.uuid();

function toIso(value: string | Date): string {
  return isoTimestamp(value);
}

function toIsoOrNull(value: string | Date | null): string | null {
  return value === null ? null : toIso(value);
}

/** A page's total, repeated by the functions on every row (0 when there are no rows). */
function totalOf(rows: readonly { total_count?: number | string }[]): number {
  return rows.length === 0 ? 0 : Number(rows[0]?.total_count ?? rows.length);
}

export function toReturnSummary(row: ReturnRow): ReturnSummary {
  return returnSummarySchema.parse({
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    itemCount: Number(row.item_count),
    refundableMinor: Number(row.refundable_minor),
    reason: row.reason,
    requestedAt: toIso(row.requested_at),
    decidedAt: toIsoOrNull(row.decided_at),
  });
}

export function toRefundSummary(row: RefundRow) {
  return refundSummarySchema.parse({
    id: row.id,
    orderNumber: row.order_number,
    customerName: row.customer_name ?? null,
    amountMinor: Number(row.amount_minor),
    method: row.method,
    status: row.status,
    reason: row.reason,
    requestedAt: toIso(row.requested_at),
    completedAt: toIsoOrNull(row.completed_at),
  });
}

/**
 * my_return answers the lines but not their count; the summary contract wants it. The count is
 * the sum of the requested quantities, exactly what return_requests.item_count stores.
 */
function withItemCount(detail: unknown): unknown {
  if (typeof detail !== 'object' || detail === null) return detail;
  const value = detail as { itemCount?: unknown; items?: unknown };
  if (typeof value.itemCount === 'number' || !Array.isArray(value.items)) return detail;
  const itemCount = (value.items as { quantity?: unknown }[]).reduce(
    (sum, item) => sum + (typeof item.quantity === 'number' ? item.quantity : 0),
    0,
  );
  return { ...value, itemCount };
}

/** The store both implementations share, over one RPC adapter. */
function afterSalesOver(rawRpcFor: (accessToken: string, userId: string) => Rpc): AfterSalesStore {
  // jsonb answers carry offset timestamps; the contracts want the `Z` form.
  const rpcFor = (accessToken: string, userId: string): Rpc => {
    const rpc = rawRpcFor(accessToken, userId);
    return (async (name: string, args: Record<string, unknown>) =>
      isoTimestamps(await rpc(name, args))) as Rpc;
  };
  return {
    async requestReturn(accessToken, userId, input) {
      const saved = await rpcFor(accessToken, userId)<unknown>('request_return', {
        p_order_number: input.orderNumber,
        p_items: input.items,
        p_reason: input.reason,
        ...(input.description === undefined ? {} : { p_description: input.description }),
      });
      return idSchema.parse(saved);
    },

    async cancelMyReturn(accessToken, userId, returnId) {
      await rpcFor(accessToken, userId)('cancel_my_return', { p_return_id: returnId });
    },

    async myReturns(accessToken, userId) {
      const rows = await rpcFor(accessToken, userId)<ReturnRow[]>('my_returns', {});
      return (rows ?? []).map(toReturnSummary);
    },

    async myReturn(accessToken, userId, returnId) {
      const data = await rpcFor(accessToken, userId)<unknown>('my_return', {
        p_return_id: returnId,
      });
      return data === null ? null : returnDetailSchema.parse(withItemCount(data));
    },

    async myRefunds(accessToken, userId, orderNumber) {
      const rows = await rpcFor(accessToken, userId)<MyRefundRow[]>('my_order_refunds', {
        p_order_number: orderNumber,
      });
      return (rows ?? []).map((row) =>
        myRefundSchema.parse({
          id: row.id,
          amountMinor: Number(row.amount_minor),
          method: row.method,
          status: row.status,
          reason: row.reason,
          reference: row.reference,
          requestedAt: toIso(row.requested_at),
          completedAt: toIsoOrNull(row.completed_at),
        }),
      );
    },

    async listReturns(accessToken, userId, query, page) {
      const rows = await rpcFor(accessToken, userId)<ReturnRow[]>('admin_list_returns', {
        p_status: query.status === 'all' ? null : query.status,
        p_query: query.q === '' ? null : query.q,
        p_limit: page.limit,
        p_offset: page.offset,
      });
      const list = rows ?? [];
      return { returns: list.map(toReturnSummary), total: totalOf(list) };
    },

    async getReturn(accessToken, userId, returnId) {
      const data = await rpcFor(accessToken, userId)<unknown>('admin_get_return', {
        p_return_id: returnId,
      });
      if (data === null) return null;
      // The admin answer names the order inside `order`; the summary fields want it on top.
      const detail = data as { order?: { number?: unknown } };
      return returnDetailSchema.parse(withItemCount({ orderNumber: detail.order?.number, ...detail }));
    },

    async decideReturn(accessToken, userId, returnId, status, note) {
      await rpcFor(accessToken, userId)('admin_decide_return', {
        p_return_id: returnId,
        p_status: status,
        ...(note === undefined || note === '' ? {} : { p_note: note }),
      });
    },

    async restockReturn(accessToken, userId, returnId, note) {
      const units = await rpcFor(accessToken, userId)<unknown>('admin_restock_return', {
        p_return_id: returnId,
        ...(note === undefined || note === '' ? {} : { p_note: note }),
      });
      return Number(units ?? 0);
    },

    async listRefunds(accessToken, userId, query, page) {
      const rows = await rpcFor(accessToken, userId)<RefundRow[]>('admin_list_refunds', {
        p_status: query.status === 'all' ? null : query.status,
        p_query: query.q === '' ? null : query.q,
        p_limit: page.limit,
        p_offset: page.offset,
      });
      const list = rows ?? [];
      // The queue carries summary rows; the detail page loads the full record.
      return { refunds: list.map(toRefundSummary), total: totalOf(list) };
    },

    async getRefund(accessToken, userId, refundId) {
      const data = await rpcFor(accessToken, userId)<unknown>('admin_get_refund', {
        p_refund_id: refundId,
      });
      if (data === null) return null;
      const detail = data as { order?: { number?: unknown } };
      return refundDetailSchema.parse({ orderNumber: detail.order?.number, ...detail });
    },

    async requestRefund(accessToken, userId, input) {
      const saved = await rpcFor(accessToken, userId)<unknown>('admin_request_refund', {
        p_order_number: input.orderNumber,
        p_amount_minor: input.amountMinor,
        p_reason: input.reason,
        p_method: input.method,
        ...(input.returnRequestId === undefined ? {} : { p_return_id: input.returnRequestId }),
      });
      return idSchema.parse(saved);
    },

    async decideRefund(accessToken, userId, refundId, approve, note) {
      await rpcFor(accessToken, userId)('admin_decide_refund', {
        p_refund_id: refundId,
        p_approve: approve,
        ...(note === undefined || note === '' ? {} : { p_note: note }),
      });
    },

    async completeRefund(accessToken, userId, refundId, reference, note) {
      await rpcFor(accessToken, userId)('admin_complete_refund', {
        p_refund_id: refundId,
        p_reference: reference,
        ...(note === undefined || note === '' ? {} : { p_note: note }),
      });
    },

    async cancelRefund(accessToken, userId, refundId, note) {
      await rpcFor(accessToken, userId)('admin_cancel_refund', {
        p_refund_id: refundId,
        p_note: note,
      });
    },
  };
}

/** PostgreSQL reports a custom SQLSTATE (`NZ4xx`, `23505`, `23514`) as a string code. */
function pgFailure(error: unknown): { code: string; message: string; details: string | null } {
  const fields = error as { code?: unknown; message?: unknown; detail?: unknown } | null;
  return {
    code: typeof fields?.code === 'string' ? fields.code : '',
    message: typeof fields?.message === 'string' ? fields.message : 'database error',
    details: typeof fields?.detail === 'string' ? fields.detail : null,
  };
}

export function createSupabaseAfterSalesStore(clients: SupabaseClients): AfterSalesStore {
  return afterSalesOver((accessToken) => {
    const client = clients.asUser(accessToken);
    const call = client.rpc.bind(client) as unknown as RpcCall;
    return async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      const { data, error } = await call(name, args);
      if (error) throw toAdminStoreError(error, name);
      return data as T;
    };
  });
}

export function createPostgresAfterSalesStore(pool: Pool): AfterSalesStore {
  return afterSalesOver((_accessToken, userId) => {
    return async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      try {
        return await withUser(pool, userId, async (client) => {
          // Named notation keeps the call readable, and an omitted argument takes the
          // function's own default (a null filter there means "everything").
          const entries = Object.entries(args).filter(
            ([, argument]) => argument !== null && argument !== undefined,
          );
          const parameters = entries.map(([, argument]) =>
            typeof argument === 'object' ? JSON.stringify(argument) : argument,
          );
          const named = entries.map(([key], index) => `${key} => $${index + 1}`).join(', ');
          const result = await client.query(await functionCallSql(client, name, named), parameters);
          const row = result.rows[0] as { value: T } | undefined;
          if (row === undefined) throw new StoreUnavailableError(`${name} answered with no row`);
          return row.value;
        });
      } catch (error) {
        if (error instanceof StoreUnavailableError) throw error;
        throw toStoreError(pgFailure(error), name);
      }
    };
  });
}
