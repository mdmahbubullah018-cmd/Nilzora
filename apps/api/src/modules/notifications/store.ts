import { z } from 'zod';
import type { SupabaseClients } from '../../supabase/clients';
import { conform, StoreUnavailableError } from '../commerce/errors';

/*
 * The notification worker's view of the database, through the service role: the outbox
 * functions claim_notifications / finish_notification, the sender-only
 * deliverable_device_tokens (the one way tokens are read, so a token whose session has
 * ended is never returned) and invalidate_device_tokens.
 */

export interface ClaimedNotification {
  id: string;
  userId: string;
  orderNumber: string;
  /**
   * order_status: an order moved (`toStatus` is set). shipment: a courier shipment of the
   * order moved (`shipmentStatus` is set; 20261223091000_courier_foundation.sql).
   */
  kind: 'order_status' | 'shipment';
  toStatus: string | null;
  shipmentStatus: string | null;
  /** Includes this attempt: 1 on the first try. */
  attempts: number;
}

export interface DeliverableDevice {
  id: string;
  token: string;
}

export type FinishOutcome = 'sent' | 'retry' | 'failed' | 'skipped';

export interface NotificationStore {
  claim(limit: number, leaseSeconds: number): Promise<ClaimedNotification[]>;
  deliverableDevices(userId: string): Promise<DeliverableDevice[]>;
  /**
   * Whether the account still wants this kind of news. The outbox carries order status
   * changes, so the question is the account's `order_updates` switch; an account that never
   * opened Settings has no row and is answered "yes", exactly as before the table existed.
   */
  notificationAllowed(userId: string): Promise<boolean>;
  finish(
    id: string,
    outcome: FinishOutcome,
    options?: { retrySeconds?: number; errorCode?: string },
  ): Promise<void>;
  invalidateDevices(ids: readonly string[]): Promise<void>;
}

const claimedSchema = z.array(
  z.object({
    id: z.uuid(),
    user_id: z.uuid(),
    order_number: z.string(),
    to_status: z.string().nullable(),
    attempts: z.number().int(),
    kind: z.enum(['order_status', 'shipment']),
    shipment_status: z.string().nullable(),
  }),
);
const devicesSchema = z.array(z.object({ id: z.uuid(), token: z.string() }));

/**
 * Only the SQLSTATE is kept: database messages can quote rows, and these rows hold tokens.
 * A refusal without one (a rejected API key answers 401 with no code) is labelled by its
 * HTTP status; only a failure with no response at all is a network failure.
 */
function failure(
  operation: string,
  error: { code?: string },
  status?: number,
): StoreUnavailableError {
  const label =
    error.code || (status !== undefined && status >= 400 ? `http ${status}` : 'network');
  return new StoreUnavailableError(`${operation} failed (${label})`);
}

export function createSupabaseNotificationStore(clients: SupabaseClients): NotificationStore {
  const { admin } = clients;
  return {
    async claim(limit, leaseSeconds) {
      const { data, error, status } = await admin.rpc('claim_notifications', {
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      });
      if (error) throw failure('claim_notifications', error, status);
      return conform(claimedSchema, data, 'claim_notifications').map((row) => ({
        id: row.id,
        userId: row.user_id,
        orderNumber: row.order_number,
        kind: row.kind,
        toStatus: row.to_status,
        shipmentStatus: row.shipment_status,
        attempts: row.attempts,
      }));
    },

    async deliverableDevices(userId) {
      const { data, error, status } = await admin.rpc('deliverable_device_tokens', {
        p_user_id: userId,
      });
      if (error) throw failure('deliverable_device_tokens', error, status);
      return conform(devicesSchema, data, 'deliverable_device_tokens');
    },

    async notificationAllowed(userId) {
      // One boolean question, answered by a security-definer function: the table itself stays
      // closed to the service key, so the sender can never read another account's choices.
      // The function answers "yes" for an account with no row, and raises rather than
      // answering when it fails - a thrown error is retried, never treated as consent.
      const { data, error, status } = await admin.rpc('notification_allowed', {
        p_user_id: userId,
      });
      if (error) throw failure('notification_allowed', error, status);
      return conform(z.boolean(), data, 'notification_allowed');
    },

    async finish(id, outcome, options = {}) {
      const { error, status } = await admin.rpc('finish_notification', {
        p_id: id,
        p_outcome: outcome,
        ...(options.retrySeconds === undefined ? {} : { p_retry_seconds: options.retrySeconds }),
        ...(options.errorCode === undefined ? {} : { p_error: options.errorCode }),
      });
      if (error) throw failure('finish_notification', error, status);
    },

    async invalidateDevices(ids) {
      if (ids.length === 0) return;
      const { error, status } = await admin.rpc('invalidate_device_tokens', { p_ids: [...ids] });
      if (error) throw failure('invalidate_device_tokens', error, status);
    },
  };
}
