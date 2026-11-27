import {
  staffNotificationSchema,
  type StaffNotification,
  type StaffNotificationQuery,
} from '@nilzora/contracts';
import type { Pool } from 'pg';
import type { SupabaseClients } from '../../supabase/clients';
import { isoTimestamp } from '../commerce/errors';
import { postgresRpc, supabaseRpc, type Rpc } from '../db-rpc';

/*
 * The staff notification inbox
 * ----------------------------
 * Notifications are written by database triggers on the real business events (a new order,
 * a return, a refund stage, low stock, a moderation submission), each with a dedupe key so a
 * retried trigger cannot duplicate one. This module only reads them and marks them read; the
 * visibility rule lives in the SQL, so a staff member can never see another's private rows.
 */

export interface InboxStore {
  list(
    accessToken: string,
    userId: string,
    query: StaffNotificationQuery,
    page: { limit: number; offset: number },
  ): Promise<{ notifications: StaffNotification[]; total: number }>;
  unreadCount(accessToken: string, userId: string): Promise<number>;
  markRead(accessToken: string, userId: string, notificationId: string): Promise<void>;
  markAllRead(accessToken: string, userId: string): Promise<number>;
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

function toIso(value: string | Date): string {
  return isoTimestamp(value);
}

function inboxOver(rpcFor: (accessToken: string | null, userId: string | null) => Rpc): InboxStore {
  return {
    async list(accessToken, userId, _query, page) {
      const rows = await rpcFor(accessToken, userId)<NotificationRow[]>(
        'my_staff_notifications',
        { p_limit: page.limit, p_offset: page.offset },
        true,
      );
      const list = rows ?? [];
      return {
        notifications: list.map((row) =>
          staffNotificationSchema.parse({
            id: row.id,
            kind: row.kind,
            title: row.title,
            body: row.body,
            entityType: row.entity_type,
            entityId: row.entity_id,
            actionPath: row.action_path,
            readAt: row.read_at === null ? null : toIso(row.read_at),
            createdAt: toIso(row.created_at),
          }),
        ),
        total: Number(list[0]?.total_count ?? 0),
      };
    },

    async unreadCount(accessToken, userId) {
      const count = await rpcFor(accessToken, userId)<unknown>('my_unread_notification_count', {});
      return Number(count ?? 0);
    },

    async markRead(accessToken, userId, notificationId) {
      await rpcFor(accessToken, userId)('mark_staff_notification_read', { p_id: notificationId });
    },

    async markAllRead(accessToken, userId) {
      const count = await rpcFor(accessToken, userId)<unknown>(
        'mark_all_staff_notifications_read',
        {},
      );
      return Number(count ?? 0);
    },
  };
}

export function createSupabaseInboxStore(clients: SupabaseClients): InboxStore {
  const client = supabaseRpc(clients);
  return inboxOver((accessToken) => client(accessToken));
}

export function createPostgresInboxStore(pool: Pool): InboxStore {
  const client = postgresRpc(pool);
  return inboxOver((_accessToken, userId) => client(userId));
}
