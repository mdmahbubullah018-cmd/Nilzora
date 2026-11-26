import type { Logger } from 'pino';
import { publicMediaUrl } from '../media/public-url';
import { StoreUnavailableError } from '../commerce/errors';
import type { PushOutcome, PushSender } from './fcm';
import { broadcastAnnouncement, productAnnouncement } from './messages';
import { retryDelaySeconds } from './worker';
import type { AnnouncementStore, ClaimedAnnouncement } from './announcement-store';

/*
 * Sends the product announcements the database queued.
 *
 * Publishing a product writes the announcement and one delivery row per opted-in customer in
 * the same transaction, so a publication never waits for this and a failed push never undoes
 * it. The same guarantees as the order worker apply: bounded attempts with exponential
 * backoff, a lease so two workers cannot take one row, no duplicate for the same event, and
 * logs that name ids and error codes only.
 *
 * It polls the database, not a queue: there is no Redis in this path at all. The interval is
 * deliberately slower than the order worker's, because an announcement has no deadline and a
 * quiet poll costs one indexed query.
 */

const DEFAULT_POLL_MS = 30_000;
const MAX_ERROR_BACKOFF_MS = 300_000;
const DEFAULT_BATCH = 20;
const DEFAULT_LEASE_SECONDS = 120;
const DEFAULT_CONCURRENCY = 3;

export interface AnnouncementProcessorOptions {
  store: AnnouncementStore;
  sender: PushSender;
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
  /** Public base URL of the media bucket; without it the notification is text only. */
  mediaBaseUrl?: string | undefined;
  batchSize?: number;
  leaseSeconds?: number;
  concurrency?: number;
  /** In [0, 1); replaceable in tests. */
  random?: () => number;
}

export interface AnnouncementTickResult {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
}

type Verdict = keyof Omit<AnnouncementTickResult, 'claimed'>;

function errorLabel(error: unknown): { errorName: string; errorMessage?: string } {
  if (error instanceof StoreUnavailableError) {
    return { errorName: error.name, errorMessage: error.message };
  }
  return { errorName: error instanceof Error ? error.name : 'UnknownError' };
}

export function createAnnouncementProcessor(options: AnnouncementProcessorOptions) {
  const { store, sender, logger } = options;
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  const leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const random = options.random ?? Math.random;
  const mediaBaseUrl = options.mediaBaseUrl;

  async function deliver(delivery: ClaimedAnnouncement): Promise<Verdict> {
    const message =
      delivery.kind === 'broadcast'
        ? broadcastAnnouncement(
            delivery.title,
            delivery.body,
            delivery.productSlug,
            delivery.linkPath,
          )
        : productAnnouncement(delivery.productName, delivery.productSlug, {
            title: delivery.title,
            body: delivery.body,
          });
    if (message === null) {
      await store.finish(delivery.id, 'failed', { errorCode: 'unsupported_product' });
      return 'failed';
    }
    // A missing picture is normal: the notification is then text only. The product's own
    // image is never substituted with another product's.
    const imageUrl =
      mediaBaseUrl === undefined ? null : publicMediaUrl(delivery.imageKey, mediaBaseUrl, 'thumb');

    const devices = await store.deliverableDevices(delivery.userId);
    if (devices.length === 0) {
      // Signed out everywhere since opting in: nothing to send, and nothing to retry.
      await store.finish(delivery.id, 'skipped', { errorCode: 'no_device' });
      return 'skipped';
    }

    let delivered = false;
    const dead: string[] = [];
    const retries: Extract<PushOutcome, { kind: 'retry' }>[] = [];
    const uncertain: Extract<PushOutcome, { kind: 'uncertain' }>[] = [];

    for (const device of devices) {
      let outcome: PushOutcome;
      try {
        outcome = await sender.send({
          token: device.token,
          title: message.title,
          body: message.body,
          ...(imageUrl === null ? {} : { imageUrl }),
          data: message.data,
          // The delivery row is the announcement's own identity: unchanged by a retry, so
          // Android replaces a repeat instead of showing it twice.
          tag: delivery.id,
        });
      } catch {
        outcome = { kind: 'retry', code: 'send_error' };
      }
      if (outcome.kind === 'sent') delivered = true;
      else if (outcome.kind === 'invalid_token') dead.push(device.id);
      else if (outcome.kind === 'retry') retries.push(outcome);
      else if (outcome.kind === 'uncertain') uncertain.push(outcome);
    }

    if (dead.length > 0) {
      try {
        await store.invalidateDevices(dead);
      } catch (error) {
        logger.warn(
          { deliveryId: delivery.id, ...errorLabel(error) },
          'Could not mark dead device tokens',
        );
      }
    }

    // One device reached is a delivered announcement; retrying would repeat it there.
    if (delivered) {
      await store.finish(delivery.id, 'sent');
      return 'sent';
    }
    // Accepted or not, the send left the process and FCM cannot be asked to deduplicate it:
    // the row is closed with the doubt recorded rather than retried.
    if (uncertain.length > 0) {
      const code = uncertain[0]?.code ?? 'fcm_network_uncertain';
      logger.warn(
        { deliveryId: delivery.id, errorCode: code },
        'Announcement delivery outcome is uncertain; not retried',
      );
      await store.finish(delivery.id, 'failed', { errorCode: 'delivery_uncertain' });
      return 'failed';
    }
    if (retries.length > 0) {
      const asked = Math.max(0, ...retries.map((r) => r.retryAfterSeconds ?? 0));
      const retrySeconds = Math.max(asked, retryDelaySeconds(delivery.attempts, random));
      await store.finish(delivery.id, 'retry', {
        retrySeconds,
        errorCode: retries[0]?.code ?? 'retry',
      });
      return 'retried';
    }

    await store.finish(delivery.id, 'failed', { errorCode: 'rejected' });
    return 'failed';
  }

  async function runOnce(): Promise<AnnouncementTickResult> {
    const claimed = await store.claim(batchSize, leaseSeconds);
    const result: AnnouncementTickResult = {
      claimed: claimed.length,
      sent: 0,
      retried: 0,
      failed: 0,
      skipped: 0,
    };
    let cursor = 0;

    async function worker(): Promise<void> {
      while (cursor < claimed.length) {
        const item = claimed[cursor];
        cursor += 1;
        if (item === undefined) return;
        try {
          result[await deliver(item)] += 1;
        } catch (error) {
          // The row stays leased: the next tick picks it up after the lease expires.
          logger.error(
            { deliveryId: item.id, ...errorLabel(error) },
            'Product announcement could not be processed',
          );
          result.failed += 1;
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, claimed.length) }, worker));
    return result;
  }

  return { runOnce, batchSize };
}

export interface AnnouncementWorkerOptions extends AnnouncementProcessorOptions {
  pollIntervalMs?: number;
}

export interface AnnouncementWorker {
  /** Stops polling and waits for the batch in progress to finish. */
  stop(): Promise<void>;
}

export function startAnnouncementWorker(options: AnnouncementWorkerOptions): AnnouncementWorker {
  const { logger } = options;
  const processor = createAnnouncementProcessor(options);
  const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;

  let stopped = false;
  let wake: (() => void) | undefined;
  let timer: NodeJS.Timeout | undefined;

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      wake = resolve;
      timer = setTimeout(resolve, ms);
      timer.unref();
    });
  }

  async function loop(): Promise<void> {
    let failures = 0;
    while (!stopped) {
      let delay = pollMs;
      try {
        const result = await processor.runOnce();
        failures = 0;
        if (result.claimed > 0) logger.info(result, 'Product announcements processed');
        // A full batch means more may be waiting: go again at once.
        if (result.claimed >= processor.batchSize) delay = 0;
      } catch (error) {
        failures += 1;
        delay = Math.min(MAX_ERROR_BACKOFF_MS, pollMs * 2 ** failures);
        logger.warn({ ...errorLabel(error), retryInMs: delay }, 'Product announcement poll failed');
      }
      if (stopped) break;
      await sleep(delay);
    }
  }

  const done = loop();

  return {
    async stop() {
      stopped = true;
      wake?.();
      if (timer !== undefined) clearTimeout(timer);
      await done;
    },
  };
}
