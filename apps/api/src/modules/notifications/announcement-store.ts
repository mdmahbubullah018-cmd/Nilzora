import { z } from 'zod';
import type { SupabaseClients } from '../../supabase/clients';
import { conform, StoreUnavailableError } from '../commerce/errors';

/*
 * The announcement worker's view of the database, through the service role: the outbox
 * functions claim_announcement_deliveries / finish_announcement_delivery, and the same
 * sender-only reads of device tokens the order notifications use, so a token whose session
 * has ended is never returned and a dead token is invalidated the same way.
 */

export interface ClaimedAnnouncement {
  id: string;
  userId: string;
  productName: string;
  productSlug: string;
  /** Base key in the media bucket; the worker resolves it to a public URL. */
  imageKey: string | null;
  /** Includes this attempt: 1 on the first try. */
  attempts: number;
  /** 'broadcast': staff-written, with its own title and body; 'product': a new product. */
  kind: 'product' | 'broadcast';
  title: string | null;
  body: string | null;
  /** A store path a broadcast was set to open; null for none. */
  linkPath: string | null;
}

export interface DeliverableDevice {
  id: string;
  token: string;
}

export type FinishOutcome = 'sent' | 'retry' | 'failed' | 'skipped';

export interface AnnouncementStore {
  claim(limit: number, leaseSeconds: number): Promise<ClaimedAnnouncement[]>;
  deliverableDevices(userId: string): Promise<DeliverableDevice[]>;
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
    product_name: z.string(),
    product_slug: z.string(),
    image_key: z.string().nullable(),
    attempts: z.number().int(),
    // Absent before 20261201090000: every row was then a product announcement.
    kind: z.enum(['product', 'broadcast']).default('product'),
    title: z.string().nullable().default(null),
    body: z.string().nullable().default(null),
    link_path: z.string().nullable().default(null),
  }),
);
const devicesSchema = z.array(z.object({ id: z.uuid(), token: z.string() }));

/** Only the SQLSTATE is kept: database messages can quote rows, and these rows hold tokens. */
function failure(
  operation: string,
  error: { code?: string },
  status?: number,
): StoreUnavailableError {
  const label =
    error.code || (status !== undefined && status >= 400 ? `http ${status}` : 'network');
  return new StoreUnavailableError(`${operation} failed (${label})`);
}

export function createSupabaseAnnouncementStore(clients: SupabaseClients): AnnouncementStore {
  const { admin } = clients;
  return {
    async claim(limit, leaseSeconds) {
      const { data, error, status } = await admin.rpc('claim_announcement_deliveries', {
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      });
      if (error) throw failure('claim_announcement_deliveries', error, status);
      return conform(claimedSchema, data, 'claim_announcement_deliveries').map((row) => ({
        id: row.id,
        userId: row.user_id,
        productName: row.product_name,
        productSlug: row.product_slug,
        imageKey: row.image_key,
        attempts: row.attempts,
        kind: row.kind,
        title: row.title,
        body: row.body,
        linkPath: row.link_path,
      }));
    },

    async deliverableDevices(userId) {
      const { data, error, status } = await admin.rpc('deliverable_device_tokens', {
        p_user_id: userId,
      });
      if (error) throw failure('deliverable_device_tokens', error, status);
      return conform(devicesSchema, data, 'deliverable_device_tokens');
    },

    async finish(id, outcome, options = {}) {
      const { error, status } = await admin.rpc('finish_announcement_delivery', {
        p_id: id,
        p_outcome: outcome,
        ...(options.retrySeconds === undefined ? {} : { p_retry_seconds: options.retrySeconds }),
        ...(options.errorCode === undefined ? {} : { p_error: options.errorCode }),
      });
      if (error) throw failure('finish_announcement_delivery', error, status);
    },

    async invalidateDevices(ids) {
      if (ids.length === 0) return;
      const { error, status } = await admin.rpc('invalidate_device_tokens', { p_ids: [...ids] });
      if (error) throw failure('invalidate_device_tokens', error, status);
    },
  };
}
