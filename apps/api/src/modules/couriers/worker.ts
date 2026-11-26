import type { Logger } from 'pino';
import { StoreUnavailableError } from '../commerce/errors';
import type { CourierProcessor } from './processor';
import type { CourierRuntime } from './runtime';

/*
 * The courier worker runs inside the API process on its own timer, like the notification
 * worker. It is always started; every round reads the operating settings from the database
 * (cached briefly), so switching couriers on or off in the admin takes effect without a
 * restart:
 *
 *  - mode off: nothing happens;
 *  - any other mode: courier webhooks that failed to apply are retried;
 *  - tracking sync on (and mode not off): due shipments are polled at the saved interval.
 *
 * It never blocks a request and stops cleanly on shutdown.
 */

const DEFAULT_POLL_MS = 30_000;
const MAX_ERROR_BACKOFF_MS = 300_000;

export interface CourierWorkerOptions {
  processor: Pick<CourierProcessor, 'syncDue' | 'retryWebhooks'>;
  runtime: Pick<CourierRuntime, 'current'>;
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
  pollIntervalMs?: number;
}

export interface CourierWorker {
  /** One round (exported for tests). */
  runOnce(): Promise<void>;
  start(): void;
  /** Stops polling and waits for the round in progress. */
  stop(): Promise<void>;
}

function errorLabel(error: unknown): { errorName: string; errorMessage?: string } {
  if (error instanceof StoreUnavailableError)
    return { errorName: error.name, errorMessage: error.message };
  return { errorName: error instanceof Error ? error.name : 'UnknownError' };
}

export function createCourierWorker(options: CourierWorkerOptions): CourierWorker {
  const { processor, runtime, logger } = options;
  const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  let stopped = false;
  let running: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;
  let wake: (() => void) | undefined;

  async function runOnce(): Promise<void> {
    const rt = await runtime.current();
    if (rt.mode === 'off') return;
    const retries = await processor.retryWebhooks();
    if (retries.claimed > 0) logger.info(retries, 'Courier webhooks retried');
    if (rt.trackingSyncEnabled) {
      const sync = await processor.syncDue();
      if (sync.claimed > 0) logger.info(sync, 'Courier tracking synced');
    }
  }

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
        await runOnce();
        failures = 0;
      } catch (error) {
        failures += 1;
        delay = Math.min(MAX_ERROR_BACKOFF_MS, pollMs * 2 ** failures);
        logger.warn({ ...errorLabel(error), retryInMs: delay }, 'Courier worker could not run');
      }
      if (!stopped) await sleep(delay);
    }
  }

  return {
    runOnce,
    start() {
      if (running) return;
      running = loop().catch((error: unknown) => {
        logger.error(errorLabel(error), 'Courier worker stopped unexpectedly');
      });
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      wake?.();
      await running;
    },
  };
}
