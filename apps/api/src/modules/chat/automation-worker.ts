import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { withServiceRole } from '../../db/user-context';
import { StoreUnavailableError } from '../commerce/errors';

/*
 * The automation job worker
 * -------------------------
 * A rule can ask for something to happen later — a reminder in an hour, a nudge in a day.
 * Those requests are rows in `chat_automation_jobs`; this process is what eventually acts
 * on them.
 *
 * Why a separate object rather than a route: nothing a customer or an agent does should wait
 * for it, and nothing they can trigger should be able to drain another tenant's queue. The
 * worker runs on the API's own timer, calls one function that is granted to `service_role`
 * only, and never touches a request's identity.
 *
 * The safety properties come from the database, not from here:
 *
 *   * `run_due_chat_automation_jobs` selects due jobs `for update skip locked`, so two
 *     workers — or two runs that overlap in one process — can never claim the same row.
 *   * It increments `attempts`, moves the job back to `pending` with a growing delay on
 *     failure, and marks it `failed` after the third attempt, so a job that always throws
 *     cannot loop for ever.
 *   * It records the error on the row, in 500 characters, and never the customer's text.
 *
 * This module adds the process-level guarantees: only one tick in flight at a time, a
 * bounded batch, a swallowed-and-logged failure per tick, and a `stop()` that waits for the
 * in-flight tick before returning.
 */

export interface AutomationJobOutcome {
  ran: number;
  failed: number;
}

/** Claims and runs due jobs. Abstracted so the worker can be tested without a database. */
export interface AutomationJobRunner {
  runDue(limit: number): Promise<AutomationJobOutcome>;
}

export interface AutomationWorkerOptions {
  runner: AutomationJobRunner;
  logger: Logger;
  /** How often to look for work. */
  intervalMs: number;
  /** Jobs claimed per tick; bounded so one tick cannot monopolise the connection. */
  batchSize: number;
}

export interface AutomationWorker {
  /** Starts the timer. Calling it twice is a no-op rather than a second timer. */
  start(): void;
  /** Stops the timer and waits for an in-flight tick to finish. */
  stop(): Promise<void>;
  /** Runs one tick now. Answers how many jobs it handled; exposed for tests and manual runs. */
  tick(): Promise<AutomationJobOutcome>;
  /** Whether a tick is currently running. */
  isRunning(): boolean;
}

const EMPTY: AutomationJobOutcome = { ran: 0, failed: 0 };

export function createAutomationWorker(options: AutomationWorkerOptions): AutomationWorker {
  const { runner, logger, intervalMs, batchSize } = options;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<AutomationJobOutcome> | undefined;
  let stopped = true;

  async function tick(): Promise<AutomationJobOutcome> {
    // A timer that fires while the previous tick is still working is dropped rather than
    // queued: the next tick will find the same due jobs.
    if (inFlight) return EMPTY;

    inFlight = (async () => {
      try {
        const outcome = await runner.runDue(batchSize);
        if (outcome.ran > 0 || outcome.failed > 0) {
          logger.info(
            { ran: outcome.ran, failed: outcome.failed },
            'Chat automation jobs processed',
          );
        }
        return outcome;
      } catch (error) {
        // A database outage is not a crash: the jobs stay pending and the next tick retries.
        logger.warn({ err: error }, 'Chat automation worker tick failed');
        return EMPTY;
      } finally {
        inFlight = undefined;
      }
    })();

    return inFlight;
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      // The worker must never be the reason the process stays alive during shutdown.
      timer.unref();
      // Run once promptly: a restart should not wait a whole interval to catch up.
      void tick();
      logger.info({ intervalMs, batchSize }, 'Chat automation worker started');
    },

    async stop() {
      if (stopped) {
        await inFlight;
        return;
      }
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      await inFlight;
      logger.info('Chat automation worker stopped');
    },

    tick,

    isRunning() {
      return inFlight !== undefined;
    },
  };
}

/**
 * The production runner: one `service_role` call per tick. The function does the claiming,
 * the retry bookkeeping and the isolation of a failing job, so this stays a thin adapter.
 */
export function createPostgresAutomationJobRunner(pool: Pool): AutomationJobRunner {
  return {
    async runDue(limit) {
      return withServiceRole(pool, async (client) => {
        const result = await client.query<{ value: AutomationJobOutcome }>(
          'select public.run_due_chat_automation_jobs($1) as value',
          [limit],
        );
        const row = result.rows[0];
        if (row === undefined) {
          throw new StoreUnavailableError('run_due_chat_automation_jobs answered with no row');
        }
        const value = row.value;
        return {
          ran: Number(value.ran ?? 0),
          failed: Number(value.failed ?? 0),
        };
      });
    },
  };
}
