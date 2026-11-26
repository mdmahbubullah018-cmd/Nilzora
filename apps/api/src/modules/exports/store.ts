import {
  EXPORT_FORMATS,
  EXPORT_JOB_STATUSES,
  REPORT_KINDS,
  reportFiltersEchoSchema,
  type ExportFormat,
  type ExportJob,
  type ReportFilters,
  type ReportKind,
} from '@nilzora/contracts';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { withServiceRole, withUser, type TransactionLimits } from '../../db/user-context';

/** Background export rounds may read the whole order history; requests keep the default. */
const EXPORT_TRANSACTION_LIMITS: TransactionLimits = {
  statementTimeoutMs: 120_000,
  idleInTransactionTimeoutMs: 120_000,
};
import type { SupabaseClients } from '../../supabase/clients';
import { toAdminStoreError } from '../admin/errors';
import { conform, isoTimestamp, StoreUnavailableError } from '../commerce/errors';
import { orderDocumentSchema, type OrderDocument, type OrderDocumentKind } from './documents';
import type { ReportRow } from './format';
import type { SummaryValues } from './reports';

/*
 * Reports, order documents and export jobs, always through permission-checking database
 * functions. The caller's own identity is used for every read (so the database decides
 * what they may see); the export worker reads as the job's creator, which rechecks that
 * account's permission when the job runs.
 */

const valueSchema = z.union([z.string(), z.number(), z.null()]);

export const reportPageSchema = z.object({
  rows: z.array(z.record(z.string(), valueSchema)),
  total: z.number().int().min(0),
  summary: z.record(z.string(), valueSchema).nullable().optional(),
  chart: z
    .array(z.object({ label: z.string(), value: z.number() }))
    .nullable()
    .optional(),
});

export interface ReportPage {
  rows: ReportRow[];
  total: number;
  summary: SummaryValues;
  chart: { label: string; value: number }[] | null;
}

function toPage(value: unknown, operation: string): ReportPage {
  const page = conform(reportPageSchema, value, operation);
  return {
    rows: page.rows,
    total: page.total,
    summary: page.summary ?? null,
    chart: page.chart ?? null,
  };
}

export interface ReportStore {
  /** One page of a report as the caller (who must hold the kind's permission). */
  read(
    accessToken: string,
    userId: string,
    kind: ReportKind,
    filters: ReportFilters,
    page: { limit: number; offset: number },
    withSummary: boolean,
  ): Promise<ReportPage>;
  /** The audit row of a direct download (filters only). */
  auditDownload(
    accessToken: string,
    userId: string,
    kind: ReportKind,
    format: ExportFormat,
    rowCount: number,
    filters: ReportFilters,
  ): Promise<void>;
  /** An invoice's or packing slip's data; the database audits the download. */
  orderDocument(
    accessToken: string,
    userId: string,
    orderNumber: string,
    kind: OrderDocumentKind,
  ): Promise<OrderDocument>;
}

const storedJobSchema = z.object({
  id: z.uuid(),
  kind: z.enum(REPORT_KINDS),
  format: z.enum(EXPORT_FORMATS),
  filters: reportFiltersEchoSchema,
  status: z.enum(EXPORT_JOB_STATUSES),
  progress: z.number().int().min(0).max(100),
  rowCount: z.number().int().min(0).nullable(),
  fileName: z.string().nullable(),
  contentType: z.string().nullable(),
  fileBytes: z.number().int().min(0).nullable(),
  error: z.string().nullable(),
  createdAt: z.string().transform(isoTimestamp),
  startedAt: z
    .string()
    .nullable()
    .transform((value) => (value === null ? null : isoTimestamp(value))),
  finishedAt: z
    .string()
    .nullable()
    .transform((value) => (value === null ? null : isoTimestamp(value))),
  expiresAt: z.string().transform(isoTimestamp),
});

export const toJob = (value: unknown, operation: string): ExportJob =>
  conform(storedJobSchema, value, operation);

export interface JobFile {
  file: Buffer;
  fileName: string;
  contentType: string;
  rowCount: number;
  kind: ReportKind;
  format: ExportFormat;
}

/** The caller's own export jobs. */
export interface ExportJobStore {
  create(
    accessToken: string,
    userId: string,
    request: { kind: ReportKind; format: ExportFormat; filters: ReportFilters },
  ): Promise<ExportJob>;
  list(accessToken: string, userId: string): Promise<ExportJob[]>;
  get(accessToken: string, userId: string, id: string): Promise<ExportJob>;
  /** Refused: not_found, missing_permission, export_not_ready, export_expired. */
  download(accessToken: string, userId: string, id: string): Promise<JobFile>;
}

export interface ClaimedJob {
  id: string;
  kind: ReportKind;
  format: ExportFormat;
  filters: ReportFilters;
  createdBy: string;
}

/** What the export worker needs: the queue (as the service) and reads as the creator. */
export interface ExportWorkerBackend {
  claim(): Promise<ClaimedJob | null>;
  readAs(
    userId: string,
    kind: ReportKind,
    filters: ReportFilters,
    page: { limit: number; offset: number },
    withSummary: boolean,
  ): Promise<ReportPage>;
  progress(id: string, percent: number): Promise<void>;
  finish(
    id: string,
    file: { body: Buffer; fileName: string; contentType: string; rowCount: number },
  ): Promise<void>;
  fail(id: string, message: string): Promise<void>;
  /** Expires finished jobs older than 7 days; answers how many. */
  expire(): Promise<number>;
}

const jobFileSchema = z.object({
  file: z.instanceof(Buffer),
  file_name: z.string(),
  content_type: z.string(),
  row_count: z.number().int().min(0),
  kind: z.enum(REPORT_KINDS),
  format: z.enum(EXPORT_FORMATS),
});

const claimSchema = z.object({
  id: z.uuid(),
  kind: z.enum(REPORT_KINDS),
  format: z.enum(EXPORT_FORMATS),
  filters: reportFiltersEchoSchema,
  created_by: z.uuid(),
});

/** PostgreSQL exposes custom SQLSTATEs (`NZ4xx`) as a string `code`. */
function pgFailure(error: unknown): { code: string; message: string; details: string | null } {
  const fields = error as { code?: unknown; message?: unknown; detail?: unknown } | null;
  return {
    code: typeof fields?.code === 'string' ? fields.code : '',
    message: typeof fields?.message === 'string' ? fields.message : 'database request failed',
    details: typeof fields?.detail === 'string' ? fields.detail : null,
  };
}

function failure(error: unknown, operation: string): Error {
  if (error instanceof StoreUnavailableError) return error;
  return toAdminStoreError(pgFailure(error), operation);
}

async function readReport(
  pool: Pool,
  userId: string,
  kind: ReportKind,
  filters: ReportFilters,
  { limit, offset }: { limit: number; offset: number },
  withSummary: boolean,
): Promise<ReportPage> {
  try {
    return await withUser(pool, userId, async (client) => {
      const result = await client.query<{ value: unknown }>(
        'select public.admin_report($1, $2::jsonb, $3, $4, $5) as value',
        [kind, JSON.stringify(filters), limit, offset, withSummary],
      );
      return toPage(result.rows[0]?.value, 'admin_report');
    });
  } catch (error) {
    throw failure(error, 'admin_report');
  }
}

export function createPostgresReportStore(pool: Pool): ReportStore {
  return {
    read: (_accessToken, userId, kind, filters, page, withSummary) =>
      readReport(pool, userId, kind, filters, page, withSummary),

    async auditDownload(_accessToken, userId, kind, format, rowCount, filters) {
      try {
        await withUser(pool, userId, async (client) => {
          await client.query('select public.admin_audit_export($1, $2, $3, $4::jsonb)', [
            kind,
            format,
            rowCount,
            JSON.stringify(filters),
          ]);
        });
      } catch (error) {
        throw failure(error, 'admin_audit_export');
      }
    },

    async orderDocument(_accessToken, userId, orderNumber, kind) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{ value: unknown }>(
            'select public.admin_order_document($1, $2) as value',
            [orderNumber, kind],
          );
          return conform(orderDocumentSchema, result.rows[0]?.value, 'admin_order_document');
        });
      } catch (error) {
        throw failure(error, 'admin_order_document');
      }
    },
  };
}

export function createSupabaseReportStore(clients: SupabaseClients): ReportStore {
  return {
    async read(accessToken, _userId, kind, filters, { limit, offset }, withSummary) {
      const { data, error } = await clients.asUser(accessToken).rpc('admin_report', {
        p_kind: kind,
        p_filters: filters,
        p_limit: limit,
        p_offset: offset,
        p_with_summary: withSummary,
      });
      if (error) throw toAdminStoreError(error, 'admin_report');
      return toPage(data, 'admin_report');
    },

    async auditDownload(accessToken, _userId, kind, format, rowCount, filters) {
      const { error } = await clients.asUser(accessToken).rpc('admin_audit_export', {
        p_kind: kind,
        p_format: format,
        p_row_count: rowCount,
        p_filters: filters,
      });
      if (error) throw toAdminStoreError(error, 'admin_audit_export');
    },

    async orderDocument(accessToken, _userId, orderNumber, kind) {
      const { data, error } = await clients
        .asUser(accessToken)
        .rpc('admin_order_document', { p_order_number: orderNumber, p_kind: kind });
      if (error) throw toAdminStoreError(error, 'admin_order_document');
      return conform(orderDocumentSchema, data, 'admin_order_document');
    },
  };
}

/** Export jobs need the direct connection: the worker reads as each job's creator. */
export function createPostgresExportJobStore(pool: Pool): ExportJobStore {
  async function one(userId: string, operation: string, sql: string, values: unknown[]) {
    try {
      return await withUser(pool, userId, async (client) => {
        const result = await client.query<{ value: unknown }>(sql, values);
        return result.rows[0]?.value;
      });
    } catch (error) {
      throw failure(error, operation);
    }
  }

  return {
    async create(_accessToken, userId, { kind, format, filters }) {
      const value = await one(
        userId,
        'admin_create_export_job',
        'select public.admin_create_export_job($1, $2, $3::jsonb) as value',
        [kind, format, JSON.stringify(filters)],
      );
      return toJob(value, 'admin_create_export_job');
    },

    async list(_accessToken, userId) {
      const value = await one(
        userId,
        'admin_list_export_jobs',
        'select public.admin_list_export_jobs(50) as value',
        [],
      );
      return conform(z.array(z.unknown()), value, 'admin_list_export_jobs').map((job) =>
        toJob(job, 'admin_list_export_jobs'),
      );
    },

    async get(_accessToken, userId, id) {
      const value = await one(
        userId,
        'admin_get_export_job',
        'select public.admin_get_export_job($1::uuid) as value',
        [id],
      );
      return toJob(value, 'admin_get_export_job');
    },

    async download(_accessToken, userId, id) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<Record<string, unknown>>(
            'select * from public.admin_download_export_job($1::uuid)',
            [id],
          );
          const row = conform(jobFileSchema, result.rows[0], 'admin_download_export_job');
          return {
            file: row.file,
            fileName: row.file_name,
            contentType: row.content_type,
            rowCount: row.row_count,
            kind: row.kind,
            format: row.format,
          };
        });
      } catch (error) {
        throw failure(error, 'admin_download_export_job');
      }
    },
  };
}

export function createPostgresExportWorkerBackend(pool: Pool): ExportWorkerBackend {
  async function service<T>(operation: string, run: (client: PoolClient) => Promise<T>) {
    try {
      // A whole-store export is the one legitimately long query; it runs in the background.
      return await withServiceRole(pool, run, EXPORT_TRANSACTION_LIMITS);
    } catch (error) {
      throw failure(error, operation);
    }
  }

  return {
    async claim() {
      const row = await service('export_claim_job', async (client) => {
        const result = await client.query<Record<string, unknown>>(
          'select * from public.export_claim_job()',
        );
        return result.rows[0];
      });
      if (row === undefined) return null;
      const claimed = conform(claimSchema, row, 'export_claim_job');
      return {
        id: claimed.id,
        kind: claimed.kind,
        format: claimed.format,
        filters: claimed.filters,
        createdBy: claimed.created_by,
      };
    },

    readAs: (userId, kind, filters, page, withSummary) =>
      readReport(pool, userId, kind, filters, page, withSummary),

    async progress(id, percent) {
      await service('export_job_progress', async (client) => {
        await client.query('select public.export_job_progress($1::uuid, $2)', [id, percent]);
      });
    },

    async finish(id, file) {
      await service('export_finish_job', async (client) => {
        await client.query('select public.export_finish_job($1::uuid, $2, $3, $4, $5)', [
          id,
          file.body,
          file.fileName,
          file.contentType,
          file.rowCount,
        ]);
      });
    },

    async fail(id, message) {
      await service('export_fail_job', async (client) => {
        await client.query('select public.export_fail_job($1::uuid, $2)', [id, message]);
      });
    },

    async expire() {
      return service('export_expire_jobs', async (client) => {
        const result = await client.query<{ count: number }>(
          'select public.export_expire_jobs() as count',
        );
        return Number(result.rows[0]?.count ?? 0);
      });
    },
  };
}
