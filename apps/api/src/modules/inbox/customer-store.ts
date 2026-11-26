import {
  customerNotificationSchema,
  type CustomerNotification,
  type CustomerNotificationQuery,
} from '@nilzora/contracts';
import type { Pool } from 'pg';
import type { SupabaseClients } from '../../supabase/clients';
import { isoTimestamp } from '../commerce/errors';
import { postgresRpc, supabaseRpc, type Rpc } from '../db-rpc';

/*
 * A customer's own notification history
 * -------------------------------------
 * The database writes the rows (triggers on the order, return and refund events) and the
 * database decides which rows are readable: every function answers `auth.uid()` and refuses
 * without one, so no part of this store accepts a customer id from a caller. This module is
 * the thin mapping between those functions and the shared contract.
 */

export interface CustomerNotificationStore {
  list(
    accessToken: string,
    userId: string,
    query: CustomerNotificationQuery,
    page: { limit: number; offset: number },
  ): Promise<{ notifications: CustomerNotification[]; total: number }>;
  unreadCount(accessToken: string, userId: string): Promise<number>;
  markRead(accessToken: string, userId: string, notificationId: string): Promise<void>;
  markAllRead(accessToken: string, userId: string): Promise<number>;
  /** Deletes the caller's own entries with these ids; others' ids are not counted. */
  remove(accessToken: string, userId: string, ids: readonly string[]): Promise<number>;
  /** Deletes every entry of the caller's created at or before `before`. */
  clear(accessToken: string, userId: string, before: string): Promise<number>;
}

interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  entity_type: string;
  entity_id: string;
  action_path: string | null;
  read_at: string | Date | null;
  created_at: string | Date;
  total_count?: number | string;
}

function over(rpcFor: (accessToken: string | null, userId: string | null) => Rpc): CustomerNotificationStore {
  return {
    async list(accessToken, userId, query, page) {
      const rows = await rpcFor(accessToken, userId)<NotificationRow[]>(
        'my_customer_notifications',
        { p_kind: query.kind ?? null, p_limit: page.limit, p_offset: page.offset },
        true,
      );
      const list = rows ?? [];
      return {
        notifications: list.map((row) =>
          customerNotificationSchema.parse({
            id: row.id,
            kind: row.kind,
            title: row.title,
            body: row.body,
            entityType: row.entity_type,
            entityId: row.entity_id,
            actionPath: row.action_path,
            readAt: row.read_at === null ? null : isoTimestamp(row.read_at),
            createdAt: isoTimestamp(row.created_at),
          }),
        ),
        total: Number(list[0]?.total_count ?? 0),
      };
    },

    async unreadCount(accessToken, userId) {
      const count = await rpcFor(accessToken, userId)<unknown>('customer_unread_notification_count', {});
      return Number(count ?? 0);
    },

    async markRead(accessToken, userId, notificationId) {
      await rpcFor(accessToken, userId)('mark_customer_notification_read', { p_id: notificationId });
    },

    async remove(accessToken, userId, ids) {
      const count = await rpcFor(accessToken, userId)<unknown>('delete_my_customer_notifications', {
        p_ids: [...ids],
      });
      return Number(count ?? 0);
    },

    async clear(accessToken, userId, before) {
      const count = await rpcFor(accessToken, userId)<unknown>('clear_my_customer_notifications', {
        p_before: before,
      });
      return Number(count ?? 0);
    },

    async markAllRead(accessToken, userId) {
      const count = await rpcFor(accessToken, userId)<unknown>('mark_all_customer_notifications_read', {});
      return Number(count ?? 0);
    },
  };
}

export function createSupabaseCustomerNotificationStore(
  clients: SupabaseClients,
): CustomerNotificationStore {
  const client = supabaseRpc(clients);
  return over((accessToken) => client(accessToken));
}

export function createPostgresCustomerNotificationStore(pool: Pool): CustomerNotificationStore {
  const client = postgresRpc(pool);
  return over((_accessToken, userId) => client(userId));
}
