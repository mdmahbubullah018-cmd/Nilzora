import { z } from 'zod';
import { adminSearchSchema } from './admin-common';
import { INVENTORY_REASONS, MODERATION_TASK_STATUSES, PRODUCT_STATUSES } from './admin-catalog';
import { PROFILE_STATUSES, type Permission } from './auth';
import { ORDER_STATUSES, PAYMENT_STATUSES } from './orders';

/*
 * Reports and exports
 * -------------------
 * Each report kind reads its rows from one permission-checking database function, over a
 * range of Bangladesh calendar days (at most 366) and the filters that kind supports. A
 * preview answers with the first 50 rows, the total and a short summary; an export
 * answers with the whole file (CSV, Excel or PDF) when it holds at most 5,000 rows, and
 * larger exports run as background jobs whose files are kept for 7 days.
 *
 * Personal data is kept to what each report needs: no report has a phone number or a
 * street address, the orders report names only the district and delivery zone, and the
 * audit-log report never includes the details of an entry.
 *
 * Values in `rows` are raw: money in integer poisha, percentages as fractions (0.25 =
 * 25%), dates as YYYY-MM-DD and date-times as ISO 8601 instants.
 */

export const REPORT_KINDS = [
  'sales',
  'orders',
  'products',
  'inventory',
  'customers',
  'coupons',
  'cod_collections',
  'moderation',
  'audit_logs',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_COLUMN_TYPES = [
  'text',
  'count',
  'money',
  'date',
  'datetime',
  'percent',
] as const;
export type ReportColumnType = (typeof REPORT_COLUMN_TYPES)[number];

export const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Rows a preview shows. */
export const REPORT_PREVIEW_ROWS = 50;
/** Rows an export may hold to be downloaded directly; larger exports run as jobs. */
export const DIRECT_EXPORT_MAX_ROWS = 5_000;
/** The longest range one report may cover (a leap year). */
export const REPORT_MAX_DAYS = 366;
/** How long a finished export file is kept. */
export const EXPORT_JOB_TTL_DAYS = 7;

export interface ReportColumn {
  /** Key of the value in each row. */
  key: string;
  header: string;
  type: ReportColumnType;
}

/** Which optional filters a kind accepts; `status` lists its allowed values. */
export interface ReportFilterSupport {
  status?: readonly string[];
  paymentStatus?: boolean;
  categoryId?: boolean;
  brandId?: boolean;
  q?: boolean;
}

export interface ReportDefinition {
  kind: ReportKind;
  title: string;
  /** The permission the database function requires. */
  permission: Permission;
  columns: readonly ReportColumn[];
  filters: ReportFilterSupport;
  /** What `status` means for this kind, for filter labels. */
  statusLabel?: string;
}

const column = (key: string, header: string, type: ReportColumnType): ReportColumn => ({
  key,
  header,
  type,
});

export const REPORT_DEFINITIONS: Readonly<Record<ReportKind, ReportDefinition>> = {
  sales: {
    kind: 'sales',
    title: 'Sales by day',
    permission: 'finance.read',
    columns: [
      column('day', 'Day', 'date'),
      column('orders', 'Orders', 'count'),
      column('cancelled', 'Cancelled', 'count'),
      column('revenue', 'Revenue', 'money'),
      column('averageOrder', 'Average order', 'money'),
      column('collected', 'Cash collected', 'money'),
    ],
    filters: {},
  },
  orders: {
    kind: 'orders',
    title: 'Orders',
    permission: 'orders.read',
    columns: [
      column('orderNumber', 'Order', 'text'),
      column('placedAt', 'Placed', 'datetime'),
      column('status', 'Status', 'text'),
      column('paymentStatus', 'Payment', 'text'),
      column('customer', 'Customer', 'text'),
      column('district', 'District', 'text'),
      column('zone', 'Delivery zone', 'text'),
      column('items', 'Items', 'count'),
      column('subtotal', 'Subtotal', 'money'),
      column('discount', 'Discount', 'money'),
      column('delivery', 'Delivery', 'money'),
      column('total', 'Total', 'money'),
    ],
    filters: { status: ORDER_STATUSES, paymentStatus: true, q: true },
    statusLabel: 'Order status',
  },
  products: {
    kind: 'products',
    title: 'Products',
    permission: 'products.read',
    columns: [
      column('name', 'Product', 'text'),
      column('sku', 'SKU', 'text'),
      column('category', 'Category', 'text'),
      column('brand', 'Brand', 'text'),
      column('status', 'Status', 'text'),
      column('price', 'Price', 'money'),
      column('stock', 'Stock', 'count'),
      column('unitsSold', 'Units sold', 'count'),
      column('revenue', 'Revenue', 'money'),
    ],
    filters: { status: PRODUCT_STATUSES, categoryId: true, brandId: true, q: true },
    statusLabel: 'Product status',
  },
  inventory: {
    kind: 'inventory',
    title: 'Stock movements',
    permission: 'products.read',
    columns: [
      column('at', 'Time', 'datetime'),
      column('product', 'Product', 'text'),
      column('sku', 'SKU', 'text'),
      column('change', 'Change', 'count'),
      column('stockAfter', 'Stock after', 'count'),
      column('reason', 'Reason', 'text'),
      column('orderNumber', 'Order', 'text'),
      column('note', 'Note', 'text'),
      column('actor', 'By', 'text'),
    ],
    filters: { status: INVENTORY_REASONS, categoryId: true, q: true },
    statusLabel: 'Reason',
  },
  customers: {
    kind: 'customers',
    title: 'New customers',
    permission: 'customers.read',
    columns: [
      column('name', 'Name', 'text'),
      column('email', 'Email', 'text'),
      column('joinedAt', 'Joined', 'date'),
      column('orders', 'Orders', 'count'),
      column('spent', 'Total spent', 'money'),
      column('status', 'Status', 'text'),
    ],
    filters: { status: PROFILE_STATUSES, q: true },
    statusLabel: 'Account status',
  },
  coupons: {
    kind: 'coupons',
    title: 'Coupon usage',
    permission: 'coupons.update',
    columns: [
      column('code', 'Code', 'text'),
      column('type', 'Type', 'text'),
      column('percentOff', 'Percent off', 'percent'),
      column('amountOff', 'Amount off', 'money'),
      column('active', 'Active', 'text'),
      column('redemptions', 'Redemptions', 'count'),
      column('discountGiven', 'Discount given', 'money'),
      column('orderRevenue', 'Order revenue', 'money'),
    ],
    filters: { status: ['active', 'inactive'], q: true },
    statusLabel: 'Coupon state',
  },
  cod_collections: {
    kind: 'cod_collections',
    title: 'Cash on delivery collections',
    permission: 'finance.read',
    columns: [
      column('orderNumber', 'Order', 'text'),
      column('collectedAt', 'Collected', 'datetime'),
      column('collectedBy', 'Recorded by', 'text'),
      column('customer', 'Customer', 'text'),
      column('district', 'District', 'text'),
      column('total', 'Amount', 'money'),
    ],
    filters: { q: true },
  },
  moderation: {
    kind: 'moderation',
    title: 'Content reviews',
    permission: 'moderation.assign',
    columns: [
      column('product', 'Product', 'text'),
      column('sku', 'SKU', 'text'),
      column('status', 'Status', 'text'),
      column('submittedBy', 'Submitted by', 'text'),
      column('assignedTo', 'Reviewer', 'text'),
      column('submittedAt', 'Submitted', 'datetime'),
      column('decidedAt', 'Decided', 'datetime'),
    ],
    filters: { status: MODERATION_TASK_STATUSES, q: true },
    statusLabel: 'Review status',
  },
  audit_logs: {
    kind: 'audit_logs',
    title: 'Audit log',
    permission: 'audit_logs.read',
    columns: [
      column('at', 'Time', 'datetime'),
      column('action', 'Action', 'text'),
      column('actor', 'By', 'text'),
      column('targetType', 'Target', 'text'),
      column('targetId', 'Target id', 'text'),
    ],
    filters: { q: true },
  },
};

const isoDay = z.iso.date();

function daysBetween(from: string, to: string): number {
  return (
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  );
}

/** The filter fields every report query may carry (each kind accepts its own subset). */
export const reportFiltersShape = {
  from: isoDay,
  to: isoDay,
  status: z
    .string()
    .regex(/^[a-z_]{1,30}$/, { error: 'Not a known status' })
    .optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  categoryId: z.uuid().optional(),
  brandId: z.uuid().optional(),
  q: adminSearchSchema.optional(),
};

function rangeIsValid(filters: { from: string; to: string }): boolean {
  return filters.from <= filters.to;
}

function rangeIsShortEnough(filters: { from: string; to: string }): boolean {
  const days = daysBetween(filters.from, filters.to);
  return Number.isNaN(days) || days <= REPORT_MAX_DAYS;
}

export const reportFiltersSchema = z
  .strictObject(reportFiltersShape)
  .refine(rangeIsValid, { error: 'The range must not end before it starts', path: ['to'] })
  .refine(rangeIsShortEnough, {
    error: `Choose at most ${String(REPORT_MAX_DAYS)} days`,
    path: ['from'],
  });

/** GET /admin/reports/:kind/preview?from=&to=&… */
export const reportPreviewQuerySchema = z
  .object(reportFiltersShape)
  .refine(rangeIsValid, { error: 'The range must not end before it starts', path: ['to'] })
  .refine(rangeIsShortEnough, {
    error: `Choose at most ${String(REPORT_MAX_DAYS)} days`,
    path: ['from'],
  });

/** GET /admin/reports/:kind/export?format=csv&from=&to=&… */
export const reportExportQuerySchema = z
  .object({ ...reportFiltersShape, format: z.enum(EXPORT_FORMATS) })
  .refine(rangeIsValid, { error: 'The range must not end before it starts', path: ['to'] })
  .refine(rangeIsShortEnough, {
    error: `Choose at most ${String(REPORT_MAX_DAYS)} days`,
    path: ['from'],
  });

export type ReportFilters = z.output<typeof reportFiltersSchema>;

/**
 * The filters a kind does not accept, or a status it does not know, as validation issues
 * (empty when the filters fit the kind).
 */
export function reportFilterIssues(
  kind: ReportKind,
  filters: Partial<ReportFilters>,
): { path: string; message: string }[] {
  const support = REPORT_DEFINITIONS[kind].filters;
  const issues: { path: string; message: string }[] = [];
  if (filters.status !== undefined) {
    if (!support.status)
      issues.push({ path: 'status', message: 'This report has no status filter' });
    else if (!support.status.includes(filters.status)) {
      issues.push({ path: 'status', message: `Use one of: ${support.status.join(', ')}` });
    }
  }
  for (const key of ['paymentStatus', 'categoryId', 'brandId', 'q'] as const) {
    if (filters[key] !== undefined && !support[key]) {
      issues.push({ path: key, message: `This report has no ${key} filter` });
    }
  }
  return issues;
}

/** The filters as stored with a job and echoed back: only the ones given. */
export const reportFiltersEchoSchema = z.object({
  from: isoDay,
  to: isoDay,
  status: z.string().optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  categoryId: z.uuid().optional(),
  brandId: z.uuid().optional(),
  q: z.string().optional(),
});

const reportValueSchema = z.union([z.string(), z.number(), z.null()]);

export const reportColumnSchema = z.object({
  key: z.string(),
  header: z.string(),
  type: z.enum(REPORT_COLUMN_TYPES),
});

export const reportPreviewSchema = z.object({
  kind: z.enum(REPORT_KINDS),
  title: z.string(),
  filters: reportFiltersEchoSchema,
  columns: z.array(reportColumnSchema),
  /** The first rows (at most 50), keyed by column key. */
  rows: z.array(z.record(z.string(), reportValueSchema)),
  totalRows: z.number().int().min(0),
  summary: z.array(
    z.object({ label: z.string(), value: reportValueSchema, type: z.enum(REPORT_COLUMN_TYPES) }),
  ),
  chart: z
    .object({
      type: z.enum(['line', 'bar']),
      label: z.string(),
      valueType: z.enum(REPORT_COLUMN_TYPES),
      points: z.array(z.object({ label: z.string(), value: z.number() })),
    })
    .optional(),
});

export const reportPreviewResponseSchema = z.object({ report: reportPreviewSchema });

export const EXPORT_JOB_STATUSES = ['queued', 'running', 'done', 'failed', 'expired'] as const;
export type ExportJobStatus = (typeof EXPORT_JOB_STATUSES)[number];

/** POST /admin/exports — a background export, for any size. */
export const createExportRequestSchema = z.strictObject({
  kind: z.enum(REPORT_KINDS),
  format: z.enum(EXPORT_FORMATS),
  filters: reportFiltersSchema,
});

export const exportJobSchema = z.object({
  id: z.uuid(),
  kind: z.enum(REPORT_KINDS),
  format: z.enum(EXPORT_FORMATS),
  filters: reportFiltersEchoSchema,
  status: z.enum(EXPORT_JOB_STATUSES),
  /** 0 to 100. */
  progress: z.number().int().min(0).max(100),
  rowCount: z.number().int().min(0).nullable(),
  fileName: z.string().nullable(),
  contentType: z.string().nullable(),
  /** Size of the finished file in bytes. */
  fileBytes: z.number().int().min(0).nullable(),
  /** Why the job failed, in words safe to show. */
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  /** After this the file is gone (410 on download). */
  expiresAt: z.iso.datetime(),
});

export const exportJobResponseSchema = z.object({ job: exportJobSchema });
export const exportJobListResponseSchema = z.object({ jobs: z.array(exportJobSchema) });

export type ReportPreviewQuery = z.input<typeof reportPreviewQuerySchema>;
export type ReportExportQuery = z.input<typeof reportExportQuerySchema>;
export type ReportPreview = z.infer<typeof reportPreviewSchema>;
export type ReportPreviewResponse = z.infer<typeof reportPreviewResponseSchema>;
export type CreateExportRequest = z.input<typeof createExportRequestSchema>;
export type ExportJob = z.infer<typeof exportJobSchema>;
export type ExportJobResponse = z.infer<typeof exportJobResponseSchema>;
export type ExportJobListResponse = z.infer<typeof exportJobListResponseSchema>;
