import type { Logger } from 'pino';
import { AdminRefusalError } from '../admin/errors';
import { StoreUnavailableError } from '../commerce/errors';
import type { ReportRow } from './format';
import { renderReport, type SummaryValues } from './reports';
import type { ExportWorkerBackend } from './store';

/*
 * Runs queued export jobs inside the API process, one at a time, on its own timer.
 * Each job is read page by page AS ITS CREATOR, so the database rechecks that account's
 * permission when the job runs: a creator who lost the permission (or was suspended)
 * gets a failed job, never a file. Failure messages are fixed, safe words; logs carry the
 * job id and an error class only, never row data or filters.
 */

export const EXPORT_PAGE_SIZE = 1_000;
/** The most rows one export job may hold. */
export const EXPORT_MAX_ROWS = 100_000;
/** A PDF stays readable (and small) up to this many rows. */
export const PDF_MAX_ROWS = 20_000;
/** The largest file a job may store. */
export const EXPORT_MAX_BYTES = 25 * 1024 * 1024;

const DEFAULT_POLL_MS = 5_000;
const MAX_ERROR_BACKOFF_MS = 60_000;

export const EXPORT_FAILURES = {
  permission: 'The account that created this export can no longer run this report.',
  filters: 'The filters of this export are no longer valid.',
  tooManyRows: `This export has more than ${EXPORT_MAX_ROWS.toLocaleString('en-US')} rows; narrow the filters.`,
  pdfRows: `A PDF holds at most ${PDF_MAX_ROWS.toLocaleString('en-US')} rows; choose CSV or Excel, or narrow the filters.`,
  tooLarge: 'The file would be larger than 25 MB; narrow the filters.',
  failed: 'The export could not be completed. Try again later.',
} as const;

export interface ExportProcessorOptions {
  backend: ExportWorkerBackend;
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
  pageSize?: number;
  maxRows?: number;
  now?: () => Date;
}

export type ExportTick = 'idle' | 'done' | 'failed';

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

export function createExportProcessor(options: ExportProcessorOptions) {
  const { backend, logger } = options;
  const pageSize = options.pageSize ?? EXPORT_PAGE_SIZE;
  const maxRows = options.maxRows ?? EXPORT_MAX_ROWS;
  const now = options.now ?? (() => new Date());

  return {
    /** Expires old files, then runs the oldest queued job (if any) to the end. */
    async runOnce(): Promise<ExportTick> {
      await backend.expire();
      const job = await backend.claim();
      if (!job) return 'idle';

      const fail = async (message: string) => {
        await backend.fail(job.id, message);
        return 'failed' as const;
      };

      try {
        const rows: ReportRow[] = [];
        let summary: SummaryValues = null;
        let total = 0;
        for (let offset = 0; ; offset += pageSize) {
          const page = await backend.readAs(
            job.createdBy,
            job.kind,
            job.filters,
            { limit: pageSize, offset },
            offset === 0 && job.format === 'pdf',
          );
          if (offset === 0) {
            total = page.total;
            summary = page.summary;
            if (total > maxRows) return await fail(EXPORT_FAILURES.tooManyRows);
            if (job.format === 'pdf' && total > PDF_MAX_ROWS)
              return await fail(EXPORT_FAILURES.pdfRows);
          }
          rows.push(...page.rows);
          if (page.rows.length < pageSize || rows.length >= total) break;
          await backend.progress(job.id, Math.floor((rows.length / Math.max(total, 1)) * 90));
        }

        const file = renderReport(job.format, job.kind, job.filters, rows, summary, now());
        if (file.body.length > EXPORT_MAX_BYTES) return await fail(EXPORT_FAILURES.tooLarge);
        await backend.finish(job.id, { ...file, rowCount: rows.length });
        logger.info({ exportJobId: job.id, rowCount: rows.length }, 'Export job finished');
        return 'done';
      } catch (error) {
        if (error instanceof AdminRefusalError && error.refusal === 'missing_permission') {
          return await fail(EXPORT_FAILURES.permission);
        }
        if (error instanceof AdminRefusalError && error.refusal === 'invalid_input') {
          return await fail(EXPORT_FAILURES.filters);
        }
        logger.warn({ exportJobId: job.id, errorName: errorName(error) }, 'Export job failed');
        return await fail(EXPORT_FAILURES.failed);
      }
    },
  };
}

export interface ExportWorker {
  /** Stops polling and waits for the job in progress to finish. */
  stop(): Promise<void>;
}

export function startExportWorker(
  options: ExportProcessorOptions & { pollIntervalMs?: number },
): ExportWorker {
  const { logger } = options;
  const processor = createExportProcessor(options);
  const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  let stopped = false;
  let wake: (() => void) | undefined;
  let timer: NodeJS.Timeout | undefined;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      wake = resolve;
      timer = setTimeout(resolve, ms);
      timer.unref();
    });

  async function loop(): Promise<void> {
    let failures = 0;
    while (!stopped) {
      let delay = pollMs;
      try {
        const tick = await processor.runOnce();
        failures = 0;
        // A job just ran: another may be waiting.
        if (tick !== 'idle') delay = 0;
      } catch (error) {
        failures += 1;
        delay = Math.min(MAX_ERROR_BACKOFF_MS, pollMs * 2 ** failures);
        logger.warn(
          {
            errorName: errorName(error),
            ...(error instanceof StoreUnavailableError ? { errorMessage: error.message } : {}),
            retryInMs: delay,
          },
          'Export worker could not poll',
        );
      }
      if (!stopped && delay > 0) await sleep(delay);
    }
  }

  const running = loop().catch((error: unknown) => {
    logger.error({ errorName: errorName(error) }, 'Export worker stopped unexpectedly');
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
