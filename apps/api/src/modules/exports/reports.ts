import {
  REPORT_DEFINITIONS,
  type ExportFormat,
  type ReportColumnType,
  type ReportFilters,
  type ReportKind,
} from '@nilzora/contracts';
import { writeCsv } from './csv';
import { displayValue, type ReportRow } from './format';
import { renderReportPdf, weightsFor } from './pdf';
import { writeXlsx } from './xlsx';

/*
 * What each report shows beyond its rows (the columns live in the contracts): the summary
 * figures and the chart, taken from the database function's `summary` and `chart`.
 */

export interface SummarySpec {
  key: string;
  label: string;
  type: ReportColumnType;
}

export interface ReportSpec {
  summary: readonly SummarySpec[];
  chart?: { type: 'line' | 'bar'; label: string; valueType: ReportColumnType };
}

const figure = (key: string, label: string, type: ReportColumnType): SummarySpec => ({
  key,
  label,
  type,
});

export const REPORT_SPECS: Readonly<Record<ReportKind, ReportSpec>> = {
  sales: {
    summary: [
      figure('revenue', 'Revenue', 'money'),
      figure('orders', 'Orders', 'count'),
      figure('averageOrder', 'Average order', 'money'),
      figure('collected', 'Cash collected', 'money'),
      figure('cancelled', 'Cancelled', 'count'),
    ],
    chart: { type: 'line', label: 'Revenue by day', valueType: 'money' },
  },
  orders: {
    summary: [
      figure('orders', 'Orders', 'count'),
      figure('revenue', 'Revenue', 'money'),
      figure('averageOrder', 'Average order', 'money'),
      figure('cancelled', 'Cancelled', 'count'),
    ],
    chart: { type: 'bar', label: 'Orders by status', valueType: 'count' },
  },
  products: {
    summary: [
      figure('products', 'Products', 'count'),
      figure('unitsSold', 'Units sold', 'count'),
      figure('revenue', 'Revenue', 'money'),
    ],
    chart: { type: 'bar', label: 'Top products by revenue', valueType: 'money' },
  },
  inventory: {
    summary: [
      figure('movements', 'Movements', 'count'),
      figure('unitsIn', 'Units added', 'count'),
      figure('unitsOut', 'Units removed', 'count'),
    ],
  },
  customers: {
    summary: [
      figure('customers', 'New customers', 'count'),
      figure('withOrders', 'With orders', 'count'),
      figure('spent', 'Total spent', 'money'),
    ],
    chart: { type: 'line', label: 'Sign-ups by day', valueType: 'count' },
  },
  coupons: {
    summary: [
      figure('coupons', 'Coupons', 'count'),
      figure('redemptions', 'Redemptions', 'count'),
      figure('discountGiven', 'Discount given', 'money'),
    ],
    chart: { type: 'bar', label: 'Redemptions by coupon', valueType: 'count' },
  },
  cod_collections: {
    summary: [
      figure('collections', 'Collections', 'count'),
      figure('collected', 'Cash collected', 'money'),
      figure('awaitingOrders', 'Awaiting cash (orders)', 'count'),
      figure('awaitingAmount', 'Awaiting cash', 'money'),
    ],
    chart: { type: 'line', label: 'Cash collected by day', valueType: 'money' },
  },
  moderation: {
    summary: [
      figure('submitted', 'Submitted', 'count'),
      figure('pending', 'Pending', 'count'),
      figure('approved', 'Approved', 'count'),
      figure('rejected', 'Rejected or sent back', 'count'),
    ],
    chart: { type: 'bar', label: 'Reviews by status', valueType: 'count' },
  },
  audit_logs: { summary: [figure('entries', 'Entries', 'count')] },
};

export type SummaryValues = Readonly<Record<string, string | number | null>> | null;

/** The summary as label/value/type items, in the spec's order. */
export function summaryItems(kind: ReportKind, values: SummaryValues) {
  return REPORT_SPECS[kind].summary.map((spec) => ({
    label: spec.label,
    value: values?.[spec.key] ?? null,
    type: spec.type,
  }));
}

/** "2026-10-01 – 2026-10-31 · Status: pending · Search: “lamp”" */
export function filtersText(kind: ReportKind, filters: ReportFilters): string {
  const definition = REPORT_DEFINITIONS[kind];
  const parts = [`${filters.from} – ${filters.to}`];
  if (filters.status)
    parts.push(`${definition.statusLabel ?? 'Status'}: ${filters.status.replace(/_/g, ' ')}`);
  if (filters.paymentStatus) parts.push(`Payment: ${filters.paymentStatus}`);
  if (filters.categoryId) parts.push('One category');
  if (filters.brandId) parts.push('One brand');
  if (filters.q) parts.push(`Search: “${filters.q}”`);
  return parts.join('  ·  ');
}

const CONTENT_TYPES: Readonly<Record<ExportFormat, string>> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/** "nilzora-cod-collections-2026-10-01-to-2026-10-31.csv": only [a-z0-9.-]. */
export function exportFileName(kind: ReportKind, format: ExportFormat, filters: ReportFilters) {
  const safe = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `nilzora-${safe(kind)}-${safe(filters.from)}-to-${safe(filters.to)}.${format}`;
}

export interface RenderedFile {
  body: Buffer;
  fileName: string;
  contentType: string;
}

/** A report's rows as a downloadable file. */
export function renderReport(
  format: ExportFormat,
  kind: ReportKind,
  filters: ReportFilters,
  rows: readonly ReportRow[],
  summary: SummaryValues,
  generatedAt: Date,
): RenderedFile {
  const definition = REPORT_DEFINITIONS[kind];
  const fileName = exportFileName(kind, format, filters);
  const contentType = CONTENT_TYPES[format];
  if (format === 'csv') {
    return { body: writeCsv({ columns: definition.columns, rows }), fileName, contentType };
  }
  if (format === 'xlsx') {
    return {
      body: writeXlsx({ columns: definition.columns, rows }, definition.title, generatedAt),
      fileName,
      contentType,
    };
  }
  const cells = rows.map((row) =>
    definition.columns.map((column) => displayValue(column.type, row[column.key])),
  );
  const headers = definition.columns.map((column) => column.header);
  const weights = weightsFor(headers, cells);
  return {
    body: renderReportPdf({
      title: definition.title,
      subtitle: filtersText(kind, filters),
      kpis: summaryItems(kind, summary).map((item) => ({
        label: item.label,
        value: displayValue(item.type, item.value),
      })),
      columns: definition.columns.map((column, index) => ({
        header: column.header,
        weight: weights[index] ?? 60,
        align:
          column.type === 'text' || column.type === 'date' || column.type === 'datetime'
            ? 'left'
            : 'right',
      })),
      rows: cells,
      generatedAt,
    }),
    fileName,
    contentType,
  };
}
