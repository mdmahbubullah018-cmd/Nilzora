import {
  notificationPreferenceSchema,
  type NotificationPreferences,
  type NotificationPreferencesPatch,
} from '@nilzora/contracts';
import type { Pool } from 'pg';
import type { SupabaseClients } from '../../supabase/clients';
import { isoTimestamp } from '../commerce/errors';
import { postgresRpc, supabaseRpc, type Rpc } from '../db-rpc';

/*
 * An account's notification choices.
 *
 * Both functions answer `auth.uid()`, so no part of this store accepts a customer id from a
 * caller; the patch is a partial set of booleans, and a field left out keeps whatever the
 * account had.
 */

export interface NotificationPreferenceStore {
  read(accessToken: string, userId: string): Promise<NotificationPreferences>;
  save(
    accessToken: string,
    userId: string,
    patch: NotificationPreferencesPatch,
  ): Promise<NotificationPreferences>;
}

interface Row {
  order_updates: boolean;
  payment_updates: boolean;
  return_updates: boolean;
  refund_updates: boolean;
  promotions: boolean;
  in_app: boolean;
  updated_at: string | Date | null;
}

function toPreferences(row: Row): NotificationPreferences {
  return notificationPreferenceSchema.parse({
    orderUpdates: row.order_updates,
    paymentUpdates: row.payment_updates,
    returnUpdates: row.return_updates,
    refundUpdates: row.refund_updates,
    promotions: row.promotions,
    inApp: row.in_app,
    updatedAt: row.updated_at === null ? null : isoTimestamp(row.updated_at),
  });
}

function over(
  rpcFor: (accessToken: string | null, userId: string | null) => Rpc,
): NotificationPreferenceStore {
  return {
    async read(accessToken, userId) {
      const answer = await rpcFor(accessToken, userId)<Row | Row[]>(
        'my_notification_preferences',
        {},
      );
      // The function returns a set, so PostgREST answers an array of exactly one row.
      const row = Array.isArray(answer) ? answer[0] : answer;
      if (row === undefined) throw new Error('my_notification_preferences answered with no row');
      return toPreferences(row);
    },
    async save(accessToken, userId, patch) {
      const answer = await rpcFor(accessToken, userId)<Row | Row[]>(
        'save_my_notification_preferences',
        {
          p_preferences: patch,
        },
        true,
      );
      const row = Array.isArray(answer) ? answer[0] : answer;
      if (row === undefined)
        throw new Error('save_my_notification_preferences answered with no row');
      return toPreferences(row);
    },
  };
}

export function createSupabaseNotificationPreferenceStore(
  clients: SupabaseClients,
): NotificationPreferenceStore {
  const client = supabaseRpc(clients);
  return over((accessToken) => client(accessToken));
}

export function createPostgresNotificationPreferenceStore(pool: Pool): NotificationPreferenceStore {
  const client = postgresRpc(pool);
  return over((_accessToken, userId) => client(userId));
}
