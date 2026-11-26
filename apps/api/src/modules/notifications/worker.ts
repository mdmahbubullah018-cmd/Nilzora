import type { Logger } from 'pino';
import { StoreUnavailableError } from '../commerce/errors';
import type { PushOutcome, PushSender } from './fcm';
import { orderStatusNotification, shipmentStatusNotification } from './messages';
import type { ClaimedNotification, NotificationStore } from './store';

/*
 * Sends the order notifications the database queued. It runs inside the API process, but
 * order processing never waits for it: the outbox row was committed with the status
 * change, and everything here happens afterwards, on its own timer. A push that cannot
 * be sent is retried with backoff and finally given up on; it never reaches the customer's
 * order. Logs name notification ids and error codes only - never tokens, keys, emails or
 * message texts.
 */

const DEFAULT_POLL_MS = 5_000;
const MAX_ERROR_BACKOFF_MS = 60_000;
const DEFAULT_BATCH = 20;
/** Longer than a full batch can take at the sender's timeouts, so a live claim is not stolen. */
const DEFAULT_LEASE_SECONDS = 120;
const DEFAULT_CONCURRENCY = 5;
const BASE_RETRY_SECONDS = 30;
const MAX_RETRY_SECONDS = 900;

export interface NotificationProcessorOptions {
  store: NotificationStore;
  sender: PushSender;
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
  batchSize?: number;
  leaseSeconds?: number;
  concurrency?: number;
  /** In [0, 1); replaceable in tests. */
  random?: () => number;
}

export interface TickResult {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
}

type Verdict = keyof Omit<TickResult, 'claimed'>;

/** Exponential backoff for the n-th attempt, with +/-20% jitter so retries do not bunch up. */
export function retryDelaySeconds(attempts: number, random: () => number): number {
  const base = Math.min(MAX_RETRY_SECONDS, BASE_RETRY_SECONDS * 2 ** Math.max(0, attempts - 1));
  return Math.max(1, Math.round(base * (0.8 + 0.4 * random())));
}

/**
 * What is safe to log about a failure: its class, and its message only when it comes from
 * the store, whose messages are fixed text plus a SQLSTATE. Any other message (a network
 * library's, say) could quote a URL or a token.
 */
function errorLabel(error: unknown): { errorName: string; errorMessage?: string } {
  if (error instanceof StoreUnavailableError) {
    return { errorName: error.name, errorMessage: error.message };
  }
  return { errorName: error instanceof Error ? error.name : 'UnknownError' };
}

export function createNotificationProcessor(options: NotificationProcessorOptions) {
  const { store, sender, logger } = options;
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  const leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const random = options.random ?? Math.random;

  async function deliver(notification: ClaimedNotification): Promise<Verdict> {
    // What the customer chose in Settings: an account that switched order updates off is not
    // told about them, and the row is closed rather than retried. An account that never opened
    // Settings has no row and is answered "yes", so nothing changes for anyone else.
    if (!(await store.notificationAllowed(notification.userId))) {
      await store.finish(notification.id, 'skipped', { errorCode: 'preference_off' });
      return 'skipped';
    }

    const message =
      notification.kind === 'shipment'
        ? shipmentStatusNotification(notification.orderNumber, notification.shipmentStatus ?? '')
        : orderStatusNotification(notification.orderNumber, notification.toStatus ?? '');
    if (!message) {
      await store.finish(notification.id, 'failed', { errorCode: 'unsupported_status' });
      return 'failed';
    }

    // The only way tokens are read: a token whose session ended is never returned.
    const devices = await store.deliverableDevices(notification.userId);
    if (devices.length === 0) {
      // Nowhere to send it (signed out everywhere, or never allowed notifications). Not an
      // error, and not worth retrying: the order itself is unaffected.
      await store.finish(notification.id, 'skipped', { errorCode: 'no_device' });
      return 'skipped';
    }

    let delivered = false;
    const dead: string[] = [];
    const retries: Extract<PushOutcome, { kind: 'retry' }>[] = [];
    const failures: Extract<PushOutcome, { kind: 'failed' }>[] = [];
    const uncertain: Extract<PushOutcome, { kind: 'uncertain' }>[] = [];

    for (const device of devices) {
      let outcome: PushOutcome;
      try {
        // The row id goes along as the notification's own identity, unchanged on every
        // attempt, so Android replaces a repeat of this message instead of adding a second one.
        outcome = await sender.send({ token: device.token, ...message, tag: notification.id });
      } catch {
        outcome = { kind: 'retry', code: 'send_error' };
      }
      if (outcome.kind === 'sent') delivered = true;
      else if (outcome.kind === 'invalid_token') dead.push(device.id);
      else if (outcome.kind === 'retry') retries.push(outcome);
      else if (outcome.kind === 'uncertain') uncertain.push(outcome);
      else failures.push(outcome);
    }

    if (dead.length > 0) {
      try {
        await store.invalidateDevices(dead);
      } catch (error) {
        // The next push finds the token dead again; this one is still reported.
        logger.warn(
          { notificationId: notification.id, ...errorLabel(error) },
          'Could not mark dead device tokens',
        );
      }
    }

    // One device reached is a delivered notification; retrying would repeat it there.
    if (delivered) {
      await store.finish(notification.id, 'sent');
      return 'sent';
    }
    // FCM may already have accepted this message and only the answer was lost. It has no
    // idempotent send, so a retry could show the same notification twice on a device that
    // did receive it. The doubt is recorded and the row closed: never retried, and never
    // counted as delivered.
    if (uncertain.length > 0) {
      const code = uncertain[0]?.code ?? 'fcm_network_uncertain';
      logger.warn(
        { notificationId: notification.id, errorCode: code },
        'Notification delivery outcome is uncertain; not retried',
      );
      await store.finish(notification.id, 'failed', { errorCode: 'delivery_uncertain' });
      return 'failed';
    }
    if (retries.length > 0) {
      const asked = Math.max(0, ...retries.map((r) => r.retryAfterSeconds ?? 0));
      const retrySeconds = Math.max(asked, retryDelaySeconds(notification.attempts, random));
      await store.finish(notification.id, 'retry', {
        retrySeconds,
        errorCode: retries[0]?.code ?? 'retry',
      });
      return 'retried';
    }
    if (failures.length > 0) {
      await store.finish(notification.id, 'failed', { errorCode: failures[0]?.code ?? 'failed' });
      return 'failed';
    }
    // Every token was dead and has just been marked: no device is left.
    await store.finish(notification.id, 'skipped', { errorCode: 'no_device' });
    return 'skipped';
  }

  async function process(notification: ClaimedNotification): Promise<Verdict> {
    try {
      return await deliver(notification);
    } catch (error) {
      logger.warn(
        { notificationId: notification.id, ...errorLabel(error) },
        'Notification attempt failed',
      );
      try {
        await store.finish(notification.id, 'retry', {
          retrySeconds: retryDelaySeconds(notification.attempts, random),
          errorCode: 'worker_error',
        });
      } catch {
        // The database is unreachable: the claim's lease will expire and the row is taken again.
      }
      return 'retried';
    }
  }

  return {
    batchSize,
    /** Claims what is due and sends it. Throws only when claiming fails. */
    async runOnce(): Promise<TickResult> {
      const claimed = await store.claim(batchSize, leaseSeconds);
      const result: TickResult = {
        claimed: claimed.length,
        sent: 0,
        retried: 0,
        failed: 0,
        skipped: 0,
      };
      for (let i = 0; i < claimed.length; i += concurrency) {
        const verdicts = await Promise.all(claimed.slice(i, i + concurrency).map(process));
        for (const verdict of verdicts) result[verdict] += 1;
      }
      return result;
    },
  };
}

export interface NotificationWorkerOptions extends NotificationProcessorOptions {
  pollIntervalMs?: number;
}

export interface NotificationWorker {
  /** Stops polling and waits for the batch in progress to finish. */
  stop(): Promise<void>;
}

export function startNotificationWorker(options: NotificationWorkerOptions): NotificationWorker {
  const { logger } = options;
  const processor = createNotificationProcessor(options);
  const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  const random = options.random ?? Math.random;

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
        if (result.claimed > 0) logger.info(result, 'Notifications processed');
        // A full batch means more may be waiting: go again at once.
        if (result.claimed >= processor.batchSize) delay = 0;
      } catch (error) {
        failures += 1;
        const backoff = Math.min(MAX_ERROR_BACKOFF_MS, pollMs * 2 ** failures);
        delay = Math.round(backoff * (0.8 + 0.4 * random()));
        logger.warn(
          { ...errorLabel(error), retryInMs: delay },
          'Notification worker could not poll',
        );
      }
      if (!stopped && delay > 0) await sleep(delay);
    }
  }

  const running = loop().catch((error: unknown) => {
    // loop() handles its own failures; this is a last resort so nothing escapes the process.
    logger.error(errorLabel(error), 'Notification worker stopped unexpectedly');
  });

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      wake?.();
      await running;
    },
  };
}
