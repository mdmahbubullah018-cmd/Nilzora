import type { Logger } from 'pino';
import type { EmailBranding, RenderedEmail } from '../../email/design';
import { EmailUnavailableError, type EmailSender } from '../../auth/sender';
import { retryDelaySeconds } from '../notifications/worker';
import { OutboxMissingError, type ClaimedEmail, type OrderEmailStore } from './store';
import {
  orderConfirmationEmail,
  outForDeliveryEmail,
  refundUpdateEmail,
  returnUpdateEmail,
  type RefundFacts,
} from './templates';

/*
 * Sends the customer order emails the database queued (email_outbox). It runs beside the API
 * and nothing waits for it: the outbox row was committed with the order event, and a mail
 * server that is down only delays the email, never the order.
 *
 * Each claimed row is checked against the database as it is now before anything is sent:
 *   - the address must belong to an active account and be verified;
 *   - an order confirmation is not sent for an order that was cancelled meanwhile;
 *   - "out for delivery" is only sent while the courier still says so (a parcel already
 *     delivered gets no stale email);
 *   - a return or refund update is not sent once that request was cancelled.
 * Such rows are closed as `skipped` with a short reason. Logs carry ids and codes only —
 * never an address, a name or a message.
 */

const DEFAULT_BATCH = 10;
const DEFAULT_LEASE_SECONDS = 120;
/** After this many attempts a failing email is given up on (`failed`). */
export const MAX_EMAIL_ATTEMPTS = 6;
const MAX_ERROR_BACKOFF_MS = 120_000;
/** How long to wait before looking again when the outbox does not exist in this database. */
const MISSING_OUTBOX_RECHECK_MS = 10 * 60_000;

export interface OrderEmailProcessorOptions {
  store: OrderEmailStore;
  sender: EmailSender;
  branding: () => EmailBranding;
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
  batchSize?: number;
  leaseSeconds?: number;
  random?: () => number;
}

export interface EmailTickResult {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
}

type Verdict = keyof Omit<EmailTickResult, 'claimed'>;

type Prepared = { email: RenderedEmail } | { skip: string };

export function createOrderEmailProcessor(options: OrderEmailProcessorOptions) {
  const { store, sender, logger, branding } = options;
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  const leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const random = options.random ?? Math.random;

  async function prepare(row: ClaimedEmail, name: string | null): Promise<Prepared> {
    const order = await store.order(row.userId, row.orderNumber);
    // Read as the customer: no order means it is not theirs (or no longer exists).
    if (!order) return { skip: 'order_not_found' };
    const recipient = { name };
    const brand = branding();

    switch (row.kind) {
      case 'order_confirmation': {
        if (order.status === 'cancelled') return { skip: 'order_cancelled' };
        return { email: orderConfirmationEmail(order, recipient, brand) };
      }
      case 'out_for_delivery': {
        if (!row.shipmentId) return { skip: 'invalid_row' };
        if (order.status === 'cancelled') return { skip: 'order_cancelled' };
        const shipment = await store.shipment(row.shipmentId, row.orderId);
        if (!shipment) return { skip: 'shipment_not_found' };
        if (shipment.status !== 'out_for_delivery') return { skip: 'stale_event' };
        return { email: outForDeliveryEmail(order, shipment, recipient, brand) };
      }
      case 'return_update': {
        if (!row.returnRequestId || !row.eventStatus) return { skip: 'invalid_row' };
        const ret = await store.returnRequest(row.returnRequestId, row.orderId);
        if (!ret) return { skip: 'return_not_found' };
        // Tell what happened at this event; but once cancelled, earlier steps are moot.
        if (ret.status === 'cancelled' && row.eventStatus !== 'cancelled') {
          return { skip: 'stale_event' };
        }
        const status = row.eventStatus as typeof ret.status;
        if (
          !['requested', 'approved', 'rejected', 'received', 'completed', 'cancelled'].includes(
            status,
          )
        ) {
          return { skip: 'unsupported_status' };
        }
        return { email: returnUpdateEmail(order, { ...ret, status }, recipient, brand) };
      }
      case 'refund_update': {
        if (!row.refundId || !row.eventStatus) return { skip: 'invalid_row' };
        const refund = await store.refund(row.refundId, row.orderId);
        if (!refund) return { skip: 'refund_not_found' };
        const status = row.eventStatus as RefundFacts['status'];
        if (!['approved', 'completed', 'rejected'].includes(status)) {
          return { skip: 'unsupported_status' };
        }
        // An approval that was cancelled or rejected before we sent it is not announced.
        if (
          status === 'approved' &&
          (refund.status === 'cancelled' || refund.status === 'rejected')
        ) {
          return { skip: 'stale_event' };
        }
        // "Paid" is only ever said when the refund row really is completed.
        if (status === 'completed' && refund.status !== 'completed') return { skip: 'stale_event' };
        return { email: refundUpdateEmail(order, { ...refund, status }, recipient, brand) };
      }
      default:
        return { skip: 'unsupported_kind' };
    }
  }

  async function deliver(row: ClaimedEmail): Promise<Verdict> {
    const recipient = await store.recipient(row.userId);
    if (!recipient) {
      await store.finish(row.id, 'skipped', { errorCode: 'no_address' });
      return 'skipped';
    }
    if (!recipient.active) {
      await store.finish(row.id, 'skipped', { errorCode: 'account_inactive' });
      return 'skipped';
    }
    if (!recipient.verified) {
      await store.finish(row.id, 'skipped', { errorCode: 'email_unverified' });
      return 'skipped';
    }

    const prepared = await prepare(row, recipient.name);
    if ('skip' in prepared) {
      await store.finish(row.id, 'skipped', { errorCode: prepared.skip });
      return 'skipped';
    }

    try {
      await sender.send({ to: recipient.email, ...prepared.email });
    } catch (error) {
      const code = error instanceof EmailUnavailableError ? 'smtp_not_accepted' : 'send_error';
      const diagnostic = error instanceof EmailUnavailableError ? error.diagnostic : {};
      // A permanent refusal (5xx other than auth) will not get better by retrying.
      const permanent =
        diagnostic.responseCode !== undefined &&
        diagnostic.responseCode >= 500 &&
        diagnostic.responseCode !== 535 &&
        diagnostic.responseCode !== 530;
      logger.warn(
        { emailId: row.id, kind: row.kind, attempt: row.attempts, ...diagnostic },
        'Order email was not accepted by the mail server',
      );
      if (permanent || row.attempts >= MAX_EMAIL_ATTEMPTS) {
        await store.finish(row.id, 'failed', {
          errorCode: permanent ? 'smtp_rejected' : 'attempts_exhausted',
        });
        return 'failed';
      }
      await store.finish(row.id, 'retry', {
        retrySeconds: retryDelaySeconds(row.attempts, random),
        errorCode: code,
      });
      return 'retried';
    }

    await store.finish(row.id, 'sent');
    return 'sent';
  }

  async function process(row: ClaimedEmail): Promise<Verdict> {
    try {
      return await deliver(row);
    } catch (error) {
      logger.warn(
        {
          emailId: row.id,
          kind: row.kind,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
        'Order email attempt failed',
      );
      try {
        if (row.attempts >= MAX_EMAIL_ATTEMPTS) {
          await store.finish(row.id, 'failed', { errorCode: 'attempts_exhausted' });
          return 'failed';
        }
        await store.finish(row.id, 'retry', {
          retrySeconds: retryDelaySeconds(row.attempts, random),
          errorCode: 'worker_error',
        });
      } catch {
        // The database is unreachable: the lease expires and the row is taken again.
      }
      return 'retried';
    }
  }

  return {
    batchSize,
    /** Claims what is due and sends it one at a time. Throws only when claiming fails. */
    async runOnce(): Promise<EmailTickResult> {
      const claimed = await store.claim(batchSize, leaseSeconds);
      const result: EmailTickResult = {
        claimed: claimed.length,
        sent: 0,
        retried: 0,
        failed: 0,
        skipped: 0,
      };
      for (const row of claimed) result[await process(row)] += 1;
      return result;
    },
  };
}

export interface OrderEmailWorker {
  stop(): Promise<void>;
}

export function startOrderEmailWorker(
  options: OrderEmailProcessorOptions & { pollIntervalMs: number },
): OrderEmailWorker {
  const { logger } = options;
  const processor = createOrderEmailProcessor(options);
  const random = options.random ?? Math.random;
  let stopped = false;
  let wake: (() => void) | undefined;
  let timer: NodeJS.Timeout | undefined;
  let reportedMissing = false;

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
      let delay = options.pollIntervalMs;
      try {
        const result = await processor.runOnce();
        failures = 0;
        reportedMissing = false;
        if (result.claimed > 0) logger.info(result, 'Order emails processed');
        if (result.claimed >= processor.batchSize) delay = 0;
      } catch (error) {
        if (error instanceof OutboxMissingError) {
          // A database without the migration (for example a hosted project it was not yet
          // applied to). Not an error worth a log line every few seconds.
          if (!reportedMissing) {
            logger.warn(
              'Order emails are off: this database has no email outbox yet (migration 20261227090000)',
            );
            reportedMissing = true;
          }
          delay = MISSING_OUTBOX_RECHECK_MS;
        } else {
          failures += 1;
          const backoff = Math.min(MAX_ERROR_BACKOFF_MS, options.pollIntervalMs * 2 ** failures);
          delay = Math.round(backoff * (0.8 + 0.4 * random()));
          logger.warn(
            { errorName: error instanceof Error ? error.name : 'UnknownError', retryInMs: delay },
            'Order email worker could not poll',
          );
        }
      }
      if (!stopped && delay > 0) await sleep(delay);
    }
  }

  const running = loop().catch((error: unknown) => {
    logger.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'Order email worker stopped unexpectedly',
    );
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
