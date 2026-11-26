import {
  customerInsightSchema,
  type CustomerInsight,
  type CustomerInsightQuery,
} from '@nilzora/contracts';
import type { Pool } from 'pg';
import type { SupabaseClients } from '../../supabase/clients';
import { isoTimestamp } from '../commerce/errors';
import { postgresRpc, supabaseRpc, type Rpc } from '../db-rpc';

/*
 * Customer insight
 * ----------------
 * Spending is derived on every read from the customer's orders and the refunds that were
 * actually completed, so nothing can drift: a refund lowers the figure the moment it is
 * recorded, and a cancelled order never counts. The rules themselves live in the SQL
 * function, which is also where the privacy line is drawn — it reads no attribute beyond
 * the name and email a staff member may already see.
 */

export interface InsightStore {
  customers(
    accessToken: string,
    userId: string,
    query: CustomerInsightQuery,
    page: { limit: number; offset: number },
  ): Promise<{ customers: CustomerInsight[]; total: number }>;
}

interface InsightRow {
  id: string;
  full_name: string | null;
  email: string | null;
  orders_count: number | string;
  completed_orders: number | string;
  eligible_spend_minor: number | string;
  average_order_minor: number | string;
  first_order_at: string | Date | null;
  last_order_at: string | Date | null;
  segments: string[] | null;
  total_count?: number | string;
}

function toIso(value: string | Date | null): string | null {
  if (value === null) return null;
  return isoTimestamp(value);
}

function insightOver(rpcFor: (accessToken: string | null, userId: string | null) => Rpc): InsightStore {
  return {
    async customers(accessToken, userId, query, page) {
      const rows = await rpcFor(accessToken, userId)<InsightRow[]>(
        'admin_customer_insights',
        {
          p_segment: query.segment === 'all' ? null : query.segment,
          p_query: query.q === '' ? null : query.q,
          p_limit: page.limit,
          p_offset: page.offset,
        },
        true,
      );
      const list = rows ?? [];
      return {
        customers: list.map((row) =>
          customerInsightSchema.parse({
            id: row.id,
            fullName: row.full_name,
            email: row.email,
            ordersCount: Number(row.orders_count),
            completedOrders: Number(row.completed_orders),
            spendMinor: Number(row.eligible_spend_minor),
            averageOrderMinor: Number(row.average_order_minor),
            firstOrderAt: toIso(row.first_order_at),
            lastOrderAt: toIso(row.last_order_at),
            segments: row.segments ?? [],
          }),
        ),
        total: Number(list[0]?.total_count ?? 0),
      };
    },
  };
}

export function createSupabaseInsightStore(clients: SupabaseClients): InsightStore {
  const client = supabaseRpc(clients);
  return insightOver((accessToken) => client(accessToken));
}

export function createPostgresInsightStore(pool: Pool): InsightStore {
  const client = postgresRpc(pool);
  return insightOver((_accessToken, userId) => client(userId));
}
