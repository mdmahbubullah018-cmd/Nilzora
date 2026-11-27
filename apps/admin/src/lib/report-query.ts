import {
  PAYMENT_STATUSES,
  REPORT_DEFINITIONS,
  REPORT_KINDS,
  type Permission,
  type ReportKind,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { parseReportRange, type ReportRange } from './date-range';

/*
 * The Reports page's address
 * --------------------------
 * `?kind=orders&range=30d&status=delivered&q=…` (and `from`/`to` for a custom range).
 * Everything a visitor can type is checked here and anything unusable is dropped, so a
 * hand-edited link never reaches the API with a filter the report does not accept; the
 * API validates again.
 */

type Params = Record<string, string | string[] | undefined>;

export interface ReportFilterValues {
  status?: string;
  paymentStatus?: (typeof PAYMENT_STATUSES)[number];
  categoryId?: string;
  brandId?: string;
  q?: string;
}

export interface ReportPageQuery {
  kind: ReportKind;
  range: ReportRange;
  filters: ReportFilterValues;
  /** A direct download was refused for size; the page points at the background export. */
  tooLarge: boolean;
}

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** The report kinds an account may open (each kind's own permission). */
export function readableReportKinds(permissions: readonly Permission[]): ReportKind[] {
  return REPORT_KINDS.filter((kind) => permissions.includes(REPORT_DEFINITIONS[kind].permission));
}

/** Whether any report is open to the account (shown navigation and the page's own gate). */
export function canOpenReports(permissions: readonly Permission[]): boolean {
  return readableReportKinds(permissions).length > 0;
}

/** The permissions that open at least one report (for the navigation item). */
export const REPORT_PERMISSIONS: readonly Permission[] = [
  ...new Set(REPORT_KINDS.map((kind) => REPORT_DEFINITIONS[kind].permission)),
];

/**
 * The page's kind, range and filters from its search parameters. An unknown or
 * not-permitted kind falls back to the first the account may open.
 */
export function parseReportPage(
  params: Params,
  allowed: readonly ReportKind[],
  now: Date = new Date(),
): ReportPageQuery | null {
  const first = allowed[0];
  if (first === undefined) return null;
  const requested = single(params.kind);
  const kind = allowed.find((candidate) => candidate === requested) ?? first;
  const support = REPORT_DEFINITIONS[kind].filters;

  const filters: ReportFilterValues = {};
  const status = single(params.status);
  if (support.status && status !== undefined && support.status.includes(status)) {
    filters.status = status;
  }
  const payment = PAYMENT_STATUSES.find((candidate) => candidate === single(params.paymentStatus));
  if (support.paymentStatus && payment !== undefined) filters.paymentStatus = payment;
  for (const key of ['categoryId', 'brandId'] as const) {
    const value = single(params[key]);
    if (support[key] && value !== undefined && uuidSchema.safeParse(value).success) {
      filters[key] = value;
    }
  }
  const q = single(params.q)?.trim();
  if (support.q && q !== undefined && q.length >= 1 && q.length <= 100) filters.q = q;

  return {
    kind,
    range: parseReportRange(params, now),
    filters,
    tooLarge: single(params.tooLarge) === '1',
  };
}

/** The API query for a page query: the range plus the filters that are set. */
export function reportQueryOf(
  query: ReportPageQuery,
): { from: string; to: string } & ReportFilterValues {
  return { from: query.range.from, to: query.range.to, ...query.filters };
}

/** The same as plain strings, for download links and form fields. */
export function reportParamsOf(query: ReportPageQuery): Record<string, string> {
  const out: Record<string, string> = { from: query.range.from, to: query.range.to };
  for (const [key, value] of Object.entries(query.filters)) {
    if (typeof value === 'string' && value !== '') out[key] = value;
  }
  return out;
}

/** "in_review" → "In review": raw status text from the API, made readable. */
export function readableStatus(value: string): string {
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
