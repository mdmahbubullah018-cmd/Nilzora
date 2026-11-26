import type { Logger } from 'pino';
import type { DomainEventStore, OutboxEvent, OutboxStats } from './store';

/*
 * The outbox worker
 * -----------------
 * Reads committed domain events (public.domain_events) and hands each to every consumer, with
 * at-least-once delivery:
 *
 *   claim     a batch is leased with FOR UPDATE SKIP LOCKED, so several API instances can run
 *             this loop at once without taking the same event, and a worker that dies only
 *             delays its batch until the lease ends;
 *   deliver   each consumer runs once per event: the consumers that already succeeded (recorded
 *             in processed_events) are skipped on a retry, so a failure in one consumer never
 *             repeats another's side effect;
 *   complete  the event is marked published only when every consumer has succeeded;
 *   retry     otherwise it is retried with exponential backoff, and dead-lettered (kept, never
 *             deleted, visible in the stats) after MAX_ATTEMPTS.
 *
 * Exactly-once is NOT claimed: a consumer can run twice if the process stops between its side
 * effect and the record of it. Consumers are therefore written to tolerate a repeat (clients
 * ignore a `seq` they have already seen; a future SMS or courier consumer must use the event id
 * as its own idempotency key).
 */

export interface DomainEventConsumer {
  /** Stable name; it is the idempotency key in processed_events. */
  readonly name: string;
  handle(event: OutboxEvent): Promise<void>;
}

export interface DomainEventWorker {
  /** One pass over the due events; resolves to how many were completed. */
  runOnce(): Promise<number>;
  start(): void;
  stop(): Promise<void>;
  stats(): Promise<OutboxStats>;
}

export interface DomainEventWorkerOptions {
  store: DomainEventStore;
  consumers: readonly DomainEventConsumer[];
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
  intervalMs?: number;
  batchSize?: number;
  leaseSeconds?: number;
  maxAttempts?: number;
  /** Published events older than this are pruned (once an hour). */
  retentionDays?: number;
}

export const OUTBOX_DEFAULTS = {
  intervalMs: 1_000,
  batchSize: 50,
  leaseSeconds: 30,
  maxAttempts: 8,
  retentionDays: 30,
} as const;

/** Starting alert thresholds for the outbox (see the operations report). */
export const OUTBOX_THRESHOLDS = { pendingWarning: 500, oldestPendingWarningSeconds: 60 } as const;

export function createDomainEventWorker({
  store,
  consumers,
  logger,
  intervalMs = OUTBOX_DEFAULTS.intervalMs,
  batchSize = OUTBOX_DEFAULTS.batchSize,
  leaseSeconds = OUTBOX_DEFAULTS.leaseSeconds,
  maxAttempts = OUTBOX_DEFAULTS.maxAttempts,
  retentionDays = OUTBOX_DEFAULTS.retentionDays,
}: DomainEventWorkerOptions): DomainEventWorker {
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<number> | null = null;
  let stopped = false;
  let lastHousekeeping = 0;

  async function deliver(event: OutboxEvent): Promise<void> {
    const done = new Set(event.attempts > 1 ? await store.processedConsumers(event.id) : []);
    const failures: string[] = [];
    for (const consumer of consumers) {
      if (done.has(consumer.name)) continue;
      try {
        await consumer.handle(event);
        await store.recordProcessed(consumer.name, event.id);
      } catch (error) {
        failures.push(`${consumer.name}: ${error instanceof Error ? error.message : 'failed'}`);
      }
    }
    if (failures.length === 0) {
      await store.complete(event.id);
      return;
    }
    const dead = await store.fail(event.id, failures.join('; '), maxAttempts);
    // Type, seq and consumer only: never the payload.
    logger[dead ? 'error' : 'warn'](
      {
        eventType: event.type,
        seq: event.seq,
        attempts: event.attempts,
        consumers: failures.map((f) => f.split(':')[0]),
      },
      dead ? 'Domain event dead-lettered' : 'Domain event delivery failed; it will be retried',
    );
  }

  async function housekeeping(): Promise<void> {
    if (Date.now() - lastHousekeeping < 3_600_000) return;
    lastHousekeeping = Date.now();
    const pruned = await store.prune(retentionDays).catch(() => 0);
    const stats = await store.stats().catch(() => null);
    if (!stats) return;
    const backlog =
      stats.pending > OUTBOX_THRESHOLDS.pendingWarning ||
      (stats.oldestPendingSeconds ?? 0) > OUTBOX_THRESHOLDS.oldestPendingWarningSeconds;
    logger[backlog || stats.deadLettered > 0 ? 'warn' : 'info'](
      { ...stats, pruned },
      'Domain event outbox',
    );
  }

  async function runOnce(): Promise<number> {
    const batch = await store.claim(batchSize, leaseSeconds);
    let completed = 0;
    for (const event of batch) {
      if (stopped) break;
      try {
        await deliver(event);
        completed += 1;
      } catch (error) {
        // The bookkeeping itself failed (database unreachable): the lease ends and it is retried.
        logger.warn(
          {
            eventType: event.type,
            seq: event.seq,
            errorName: error instanceof Error ? error.name : 'Error',
          },
          'Domain event bookkeeping failed',
        );
      }
    }
    await housekeeping();
    return completed;
  }

  /** A database without the outbox migration: wait quietly instead of failing every second. */
  let notInstalled = false;

  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(
      () => {
        running = runOnce()
          .then((count) => {
            if (notInstalled) logger.info('Domain event outbox found; the worker is running');
            notInstalled = false;
            return count;
          })
          .catch((error: unknown) => {
            const code = (error as { cause?: { code?: unknown }; code?: unknown } | null)?.code;
            if (code === '42883' || code === '42P01') {
              if (!notInstalled) {
                logger.info(
                  'Domain event outbox is not installed in this database (migration 20261231103000); the worker checks again every 5 minutes',
                );
              }
              notInstalled = true;
              return 0;
            }
            logger.warn(
              { errorName: error instanceof Error ? error.name : 'Error' },
              'Domain event worker round failed',
            );
            return 0;
          })
          .finally(() => {
            running = null;
            schedule();
          });
      },
      notInstalled ? 300_000 : intervalMs,
    );
    timer.unref();
  }

  return {
    runOnce,
    stats: () => store.stats(),
    start() {
      stopped = false;
      schedule();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      // Let the current round finish its event, so no lease is left half-done.
      await running?.catch(() => undefined);
    },
  };
}
