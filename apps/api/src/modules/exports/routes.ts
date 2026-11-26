import {
  createExportRequestSchema,
  DIRECT_EXPORT_MAX_ROWS,
  orderNumberSchema,
  REPORT_DEFINITIONS,
  REPORT_KINDS,
  REPORT_PREVIEW_ROWS,
  reportExportQuerySchema,
  reportFilterIssues,
  reportPreviewQuerySchema,
  type ExportJobListResponse,
  type ExportJobResponse,
  type ReportFilters,
  type ReportKind,
  type ReportPreviewResponse,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { z } from 'zod';
import { sendError } from '../../http/send-error';
import {
  currentIdentity,
  requireAnyPermission,
  requirePermission,
} from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import type { AdminRouteDependencies } from '../admin/routes';
import { sendAdminFailure, type AdminRefusal, type RefusalAnswer } from '../admin/errors';
import { noStore } from '../commerce/http';
import { documentFileName, renderOrderDocument, type OrderDocumentKind } from './documents';
import { renderReport, REPORT_SPECS, summaryItems } from './reports';
import type { ExportJobStore, ReportStore } from './store';

/** Reports, exports and order documents (see the reports_exports_documents migration). */
export interface ExportStores {
  reports: ReportStore;
  /** Background exports; absent without the direct database connection (503 then). */
  jobs?: ExportJobStore | undefined;
}

const kindParams = z.object({ kind: z.enum(REPORT_KINDS) });
const previewSchemas = { params: kindParams, query: reportPreviewQuerySchema };
const exportSchemas = { params: kindParams, query: reportExportQuerySchema };
const createSchemas = { body: createExportRequestSchema };
const jobSchemas = { params: z.object({ id: uuidSchema }) };
const documentSchemas = { params: z.object({ orderNumber: orderNumberSchema }) };

const JOB_ANSWERS: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  not_found: [404, 'not_found', 'Export not found'],
  invalid_input: [400, 'bad_request', 'Check the report, the format and the filters'],
  export_not_ready: [409, 'export_not_ready', 'The export has not finished yet'],
  export_expired: [410, 'export_expired', 'This export was kept for 7 days and is gone'],
};

const REPORT_ANSWERS: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  invalid_input: [400, 'bad_request', 'Check the date range and the filters'],
};

/** The filters a validated query carried (format and kind are not filters). */
function filtersOf(query: z.output<typeof reportPreviewQuerySchema>): ReportFilters {
  const filters: ReportFilters = { from: query.from, to: query.to };
  if (query.status !== undefined) filters.status = query.status;
  if (query.paymentStatus !== undefined) filters.paymentStatus = query.paymentStatus;
  if (query.categoryId !== undefined) filters.categoryId = query.categoryId;
  if (query.brandId !== undefined) filters.brandId = query.brandId;
  if (query.q !== undefined) filters.q = query.q;
  return filters;
}

/** 400 validation_failed when a filter does not fit the kind; true when it does. */
function filtersFit(
  res: Response,
  kind: ReportKind,
  filters: ReportFilters,
  location: 'query' | 'body',
  prefix = '',
): boolean {
  const issues = reportFilterIssues(kind, filters);
  if (issues.length === 0) return true;
  sendError(res, 400, 'validation_failed', 'The request is invalid', {
    issues: issues.map((issue) => ({
      location,
      path: prefix + issue.path,
      message: issue.message,
    })),
  });
  return false;
}

/** The report kind's permission, checked before the database is asked. */
function kindPermission(read: (req: Request) => unknown): RequestHandler {
  const guards = new Map(
    REPORT_KINDS.map((kind) => [kind, requirePermission(REPORT_DEFINITIONS[kind].permission)]),
  );
  return (req: Request, res: Response, next: NextFunction) => {
    const kind = read(req);
    const guard = typeof kind === 'string' ? guards.get(kind as ReportKind) : undefined;
    if (!guard) {
      next();
      return;
    }
    guard(req, res, next);
  };
}

function sendFile(res: Response, body: Buffer, fileName: string, contentType: string): void {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Length', String(body.length));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).end(body);
}

/**
 * GET /admin/reports/:kind/preview and /export, POST and GET /admin/exports,
 * GET /admin/exports/:id and /download, and the order documents
 * GET /admin/orders/:orderNumber/invoice.pdf and /packing-slip.pdf.
 */
export function adminExportsRouter(deps: AdminRouteDependencies): Router {
  const router = Router();
  const stores = deps.stores.exports;
  if (!stores) return router;
  const { reports, jobs } = stores;
  const { requireUser, limiter } = deps;
  const now = deps.now ?? (() => new Date());
  const canReadOrders = requirePermission('orders.read');
  const inWorkspace = requireAnyPermission([
    'admin_workspace.access',
    'moderator_workspace.access',
  ]);

  router.get(
    '/admin/reports/:kind/preview',
    noStore,
    requireUser,
    kindPermission((req) => req.params.kind),
    validate(previewSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, query } = requestInput<typeof previewSchemas>(res);
      const filters = filtersOf(query);
      if (!filtersFit(res, params.kind, filters, 'query')) return;
      try {
        const page = await reports.read(
          identity.accessToken,
          identity.userId,
          params.kind,
          filters,
          { limit: REPORT_PREVIEW_ROWS, offset: 0 },
          true,
        );
        const definition = REPORT_DEFINITIONS[params.kind];
        const chart = REPORT_SPECS[params.kind].chart;
        const response: ReportPreviewResponse = {
          report: {
            kind: params.kind,
            title: definition.title,
            filters,
            columns: [...definition.columns],
            rows: page.rows,
            totalRows: page.total,
            summary: summaryItems(params.kind, page.summary),
            ...(chart && page.chart ? { chart: { ...chart, points: page.chart } } : {}),
          },
        };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, REPORT_ANSWERS);
      }
    },
  );

  router.get(
    '/admin/reports/:kind/export',
    noStore,
    requireUser,
    kindPermission((req) => req.params.kind),
    validate(exportSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, query } = requestInput<typeof exportSchemas>(res);
      const filters = filtersOf(query);
      if (!filtersFit(res, params.kind, filters, 'query')) return;
      try {
        const page = await reports.read(
          identity.accessToken,
          identity.userId,
          params.kind,
          filters,
          { limit: DIRECT_EXPORT_MAX_ROWS, offset: 0 },
          query.format === 'pdf',
        );
        if (page.total > DIRECT_EXPORT_MAX_ROWS) {
          sendError(
            res,
            409,
            'export_too_large',
            `This export has ${String(page.total)} rows; downloads hold at most ${String(DIRECT_EXPORT_MAX_ROWS)}. Create an export job (POST /api/v1/admin/exports) to receive the file when it is ready.`,
            { totalRows: page.total, maxRows: DIRECT_EXPORT_MAX_ROWS },
          );
          return;
        }
        const file = renderReport(
          query.format,
          params.kind,
          filters,
          page.rows,
          page.summary,
          now(),
        );
        await reports.auditDownload(
          identity.accessToken,
          identity.userId,
          params.kind,
          query.format,
          page.rows.length,
          filters,
        );
        sendFile(res, file.body, file.fileName, file.contentType);
      } catch (error) {
        sendAdminFailure(res, error, REPORT_ANSWERS);
      }
    },
  );

  const requireJobs: RequestHandler = (_req, res, next) => {
    if (jobs) next();
    else
      sendError(res, 503, 'exports_unavailable', 'Background exports are not available right now');
  };
  /** The job store; requireJobs has already answered 503 when there is none. */
  const jobStore = (): ExportJobStore => {
    if (!jobs) throw new Error('Export route reached without a job store');
    return jobs;
  };

  router.post(
    '/admin/exports',
    noStore,
    limiter,
    requireUser,
    validate(createSchemas),
    kindPermission((req) => (req.body as { kind?: unknown } | undefined)?.kind),
    requireJobs,
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof createSchemas>(res);
      if (!filtersFit(res, body.kind, body.filters, 'body', 'filters.')) return;
      try {
        const job = await jobStore().create(identity.accessToken, identity.userId, body);
        const response: ExportJobResponse = { job };
        res.status(202).json(response);
      } catch (error) {
        sendAdminFailure(res, error, JOB_ANSWERS);
      }
    },
  );

  router.get(
    '/admin/exports',
    noStore,
    requireUser,
    inWorkspace,
    requireJobs,
    async (_req, res) => {
      const identity = currentIdentity(res);
      const response: ExportJobListResponse = {
        jobs: await jobStore().list(identity.accessToken, identity.userId),
      };
      res.json(response);
    },
  );

  router.get(
    '/admin/exports/:id',
    noStore,
    requireUser,
    inWorkspace,
    requireJobs,
    validate(jobSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof jobSchemas>(res);
      try {
        const response: ExportJobResponse = {
          job: await jobStore().get(identity.accessToken, identity.userId, params.id),
        };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, JOB_ANSWERS);
      }
    },
  );

  router.get(
    '/admin/exports/:id/download',
    noStore,
    requireUser,
    inWorkspace,
    requireJobs,
    validate(jobSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof jobSchemas>(res);
      try {
        const file = await jobStore().download(identity.accessToken, identity.userId, params.id);
        sendFile(res, file.file, file.fileName, file.contentType);
      } catch (error) {
        sendAdminFailure(res, error, JOB_ANSWERS);
      }
    },
  );

  const document = (kind: OrderDocumentKind) => async (_req: Request, res: Response) => {
    const identity = currentIdentity(res);
    const { params } = requestInput<typeof documentSchemas>(res);
    try {
      const data = await reports.orderDocument(
        identity.accessToken,
        identity.userId,
        params.orderNumber,
        kind,
      );
      const body = renderOrderDocument(data, kind, now());
      sendFile(res, body, documentFileName(kind, data.order.orderNumber), 'application/pdf');
    } catch (error) {
      sendAdminFailure(res, error, { not_found: [404, 'not_found', 'Order not found'] });
    }
  };

  router.get(
    '/admin/orders/:orderNumber/invoice.pdf',
    noStore,
    requireUser,
    canReadOrders,
    validate(documentSchemas),
    document('invoice'),
  );
  router.get(
    '/admin/orders/:orderNumber/packing-slip.pdf',
    noStore,
    requireUser,
    canReadOrders,
    validate(documentSchemas),
    document('packing_slip'),
  );

  return router;
}
