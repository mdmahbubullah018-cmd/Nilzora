import { createHash } from 'node:crypto';
import type { ShipmentStatus } from '@nilzora/contracts';
import type { Logger } from 'pino';
import { AdminRefusalError } from '../admin/errors';
import { StoreUnavailableError } from '../commerce/errors';
import { isMockConsignment } from './mock-provider';
import type { CourierRuntime } from './runtime';
import type { CourierRegistry } from './registry';
import { pollKey } from './service';
import type { CourierStore } from './store';
import type { CourierProvider, HeaderReader } from './types';

/*
 * Courier events from outside a staff request: webhooks (verified, stored once, then
 * applied) and the tracking worker (polling, plus retries of webhooks that failed to
 * apply). Everything here runs with the service role, and does exactly one thing to the
 * database: record shipment events. An order's status, its cash collection and its
 * refunds are never touched by a courier event.
 *
 * Logs carry ids, provider names and error class names only: never a payload, a header,
 * a recipient's details or a secret.
 */

/** Statuses a booking sets itself; a courier event can never set them. */
const BOOKING_STATUSES: readonly ShipmentStatus[] = [
  'draft',
  'quoted',
  'booking_pending',
  'booking_failed',
  'booked',
];

const SYNC_BATCH = 20;
const SYNC_LEASE_SECONDS = 120;
const WEBHOOK_RETRY_BATCH = 20;
/** The database accepts 30 s to 7 days between syncs. */
const MAX_SYNC_DELAY_SECONDS = 604_800;
const BASE_SYNC_BACKOFF_SECONDS = 300;

export interface WebhookAnswer {
  status: number;
  body: Record<string, unknown>;
}

export interface CourierProcessorOptions {
  store: CourierStore;
  registry: CourierRegistry;
  /** The operating settings, read from the database on every webhook and tick. */
  runtime: Pick<CourierRuntime, 'current' | 'adapterContext'>;
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
  now?: () => number;
}

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

/** Retry delay after `attempts` failed syncs: 5 min doubling, at most 7 days. */
export function syncBackoffSeconds(attempts: number, intervalSeconds: number): number {
  const backoff = BASE_SYNC_BACKOFF_SECONDS * 2 ** Math.min(Math.max(0, attempts), 12);
  return Math.min(MAX_SYNC_DELAY_SECONDS, Math.max(intervalSeconds, backoff));
}

interface IncomingEvent {
  dedupeKey: string;
  consignmentId: string | null;
  merchantRef: string | null;
  providerStatus: string;
  occurredAt: string | null;
}

export function createCourierProcessor(options: CourierProcessorOptions) {
  const { store, registry, runtime, logger } = options;
  const now = options.now ?? Date.now;

  /** The adapter that accepts webhooks for this courier in the effective mode, or none (404). */
  async function webhookProvider(providerId: string): Promise<CourierProvider | undefined> {
    const { mode } = await runtime.current();
    if (mode !== 'mock' && mode !== 'live') return undefined;
    const provider = registry.provider(providerId, mode);
    if (!provider || provider.capabilities().webhook !== 'available') return undefined;
    return provider;
  }

  /**
   * Applies one stored webhook event: finds its shipment and records the status. Answers
   * how the stored row should be finished.
   */
  async function apply(
    provider: CourierProvider,
    event: IncomingEvent,
  ): Promise<{ status: 'processed' | 'ignored'; shipmentId: string | null }> {
    const status = provider.mapStatus(event.providerStatus);
    if (BOOKING_STATUSES.includes(status)) return { status: 'ignored', shipmentId: null };
    /*
     * Mock and real shipments never cross. A mock event may reach only a consignment in the
     * mock's own format, and never a shipment by its (predictable) merchant reference. A
     * real courier's event never reaches a consignment in the mock's format, and uses the
     * merchant reference only when it names no consignment. The API refuses the mock's
     * format for every real consignment id staff enter (portal bookings, resolutions), and
     * the mock is the only adapter that creates it, so the two never meet. (The database
     * lookup itself has no is_mock filter.)
     */
    const mockFormat = event.consignmentId !== null && isMockConsignment(event.consignmentId);
    const consignmentId = provider.isMock
      ? mockFormat
        ? event.consignmentId
        : null
      : mockFormat
        ? null
        : event.consignmentId;
    const merchantRef = provider.isMock || event.consignmentId !== null ? null : event.merchantRef;
    if (consignmentId === null && merchantRef === null)
      return { status: 'ignored', shipmentId: null };
    const shipmentId = await store.findShipment(provider.id, consignmentId, merchantRef);
    if (shipmentId === null) return { status: 'ignored', shipmentId: null };
    try {
      await store.serviceRecordEvent(shipmentId, {
        status,
        providerStatus: event.providerStatus.slice(0, 80),
        occurredAt: event.occurredAt,
        dedupeKey: `webhook:${event.dedupeKey}`.slice(0, 200),
        source: 'webhook',
      });
    } catch (error) {
      // A refusal (unknown shipment, a bad time, a key of another shipment) will never apply.
      if (error instanceof AdminRefusalError) return { status: 'ignored', shipmentId };
      throw error;
    }
    return { status: 'processed', shipmentId };
  }

  async function finish(
    id: string,
    provider: CourierProvider,
    event: IncomingEvent,
  ): Promise<'processed' | 'ignored' | 'failed'> {
    try {
      const outcome = await apply(provider, event);
      await store.finishWebhook(id, outcome.status, null, outcome.shipmentId);
      return outcome.status;
    } catch (error) {
      logger.warn(
        { webhookId: id, provider: provider.id, errorName: errorName(error) },
        'Courier webhook could not be applied; it will be retried',
      );
      try {
        await store.finishWebhook(
          id,
          'failed',
          error instanceof StoreUnavailableError ? error.message : 'processing failed',
          null,
        );
      } catch {
        // The row stays pending; nothing more can be done now.
      }
      return 'failed';
    }
  }

  return {
    webhookProvider,

    /**
     * One incoming webhook, raw. Unknown couriers (or couriers without verified webhooks in
     * this mode) are a 404 that reveals nothing; a bad signature is a 401. A verified event
     * is stored once (a repeat answers 200 without a second event) and then applied; the
     * answer is 200 once it is stored, even when applying fails (the worker retries it).
     */
    async handleWebhook(
      providerId: string,
      header: HeaderReader,
      rawBody: Buffer,
    ): Promise<WebhookAnswer> {
      const provider = await webhookProvider(providerId);
      if (!provider)
        return { status: 404, body: { error: { code: 'not_found', message: 'Route not found' } } };

      const verification = provider.verifyWebhook(header, rawBody, now());
      if (!verification.ok) {
        try {
          // Evidence of the attempt only: a hash of the body, nothing from it.
          await store.storeWebhook({
            provider: provider.id,
            dedupeKey: `${provider.id}:rejected:${sha256(rawBody)}`,
            eventType: null,
            consignmentId: null,
            merchantRef: null,
            signatureOk: false,
            payload: {},
          });
        } catch (error) {
          logger.warn(
            { provider: provider.id, errorName: errorName(error) },
            'Rejected webhook not stored',
          );
        }
        logger.warn(
          { provider: provider.id, reason: verification.reason },
          'Courier webhook signature refused',
        );
        return {
          status: 401,
          body: { error: { code: 'unauthenticated', message: 'Invalid webhook signature' } },
        };
      }

      const parsed = provider.parseWebhook(rawBody);
      const dedupeKey = parsed?.eventId
        ? `${provider.id}:event:${parsed.eventId}`
        : `${provider.id}:body:${sha256(rawBody)}`;
      const stored = await store.storeWebhook({
        provider: provider.id,
        dedupeKey,
        eventType: parsed?.eventType ?? null,
        consignmentId: parsed?.consignmentId ?? null,
        merchantRef: parsed?.merchantRef ?? null,
        signatureOk: true,
        payload: parsed?.payload ?? {},
      });
      if (stored.duplicate) return { status: 200, body: { received: true, duplicate: true } };
      if (!parsed) {
        await store.finishWebhook(stored.id, 'ignored', null, null).catch(() => undefined);
        return { status: 200, body: { received: true } };
      }
      await finish(stored.id, provider, {
        dedupeKey,
        consignmentId: parsed.consignmentId,
        merchantRef: parsed.merchantRef,
        providerStatus: parsed.providerStatus,
        occurredAt: parsed.occurredAt,
      });
      return { status: 200, body: { received: true } };
    },

    /** Failed webhook events whose retry time has come. */
    async retryWebhooks(): Promise<{ claimed: number; processed: number; failed: number }> {
      const rows = await store.claimWebhookRetries(WEBHOOK_RETRY_BATCH);
      let processed = 0;
      let failed = 0;
      for (const row of rows) {
        const provider = await webhookProvider(row.provider);
        const providerStatus = typeof row.payload.status === 'string' ? row.payload.status : null;
        if (!provider || providerStatus === null) {
          await store.finishWebhook(row.id, 'ignored', null, null);
          continue;
        }
        const eventId = typeof row.payload.eventId === 'string' ? row.payload.eventId : null;
        const occurredAt =
          typeof row.payload.occurredAt === 'string' ? row.payload.occurredAt : null;
        const verdict = await finish(row.id, provider, {
          dedupeKey: eventId ? `${provider.id}:event:${eventId}` : `${provider.id}:retry:${row.id}`,
          consignmentId: row.consignmentId,
          merchantRef: row.merchantRef,
          providerStatus,
          occurredAt,
        });
        if (verdict === 'failed') failed += 1;
        else processed += 1;
      }
      return { claimed: rows.length, processed, failed };
    },

    /** Shipments due for a tracking sync: poll the courier and record what it says. */
    async syncDue(): Promise<{ claimed: number; synced: number; failed: number }> {
      const rt = await runtime.current();
      // Nothing is claimed while sync is off: claiming would push every due shipment back.
      if (!rt.trackingSyncEnabled) return { claimed: 0, synced: 0, failed: 0 };
      const claims = await store.claimSync(SYNC_BATCH, SYNC_LEASE_SECONDS);
      const interval = rt.trackingSyncIntervalSeconds;
      let synced = 0;
      let failed = 0;
      for (const claim of claims) {
        // Routed by the shipment's own flag: mock shipments only by the mock (in mock mode),
        // real ones only by their real adapter (in live mode).
        const provider = registry.forShipment(claim.provider, claim.isMock, rt.mode);
        if (
          !provider ||
          provider.capabilities().track !== 'available' ||
          claim.consignmentId === null
        ) {
          await store.finishSync(
            claim.id,
            false,
            'Tracking is not available for this courier in this mode; record statuses by hand',
            MAX_SYNC_DELAY_SECONDS,
          );
          failed += 1;
          continue;
        }
        try {
          const tracked = await provider.track(
            {
              consignmentId: claim.consignmentId,
              trackingCode: claim.trackingCode,
              merchantRef: claim.merchantRef,
            },
            provider.isMock ? undefined : await runtime.adapterContext(provider.id),
          );
          if (tracked.kind !== 'ok') {
            await store.finishSync(
              claim.id,
              false,
              tracked.message.slice(0, 280),
              syncBackoffSeconds(claim.syncAttempts, interval),
            );
            failed += 1;
            continue;
          }
          for (const event of tracked.value) {
            if (event.status === 'unknown' || BOOKING_STATUSES.includes(event.status)) continue;
            await store.serviceRecordEvent(claim.id, {
              status: event.status,
              providerStatus: event.providerStatus,
              occurredAt: event.occurredAt,
              dedupeKey: pollKey(
                claim.provider,
                claim.consignmentId,
                event.providerStatus,
                event.occurredAt,
              ),
              source: 'poll',
            });
          }
          await store.finishSync(claim.id, true, null, interval);
          synced += 1;
        } catch (error) {
          logger.warn(
            { shipmentId: claim.id, errorName: errorName(error) },
            'Tracking sync failed',
          );
          await store
            .finishSync(
              claim.id,
              false,
              'sync failed',
              syncBackoffSeconds(claim.syncAttempts, interval),
            )
            .catch(() => undefined);
          failed += 1;
        }
      }
      return { claimed: claims.length, synced, failed };
    },
  };
}

export type CourierProcessor = ReturnType<typeof createCourierProcessor>;
