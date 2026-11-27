import {
  PAYMENT_STATUSES,
  REPORT_DEFINITIONS,
  type ExportJob,
  type ReportColumnType,
  type ReportKind,
  type ReportPreview,
} from '@nilzora/contracts';
import { CartIcon, cn, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nilzora/ui';
import {
  Boxes,
  ChartLine,
  Download,
  FileText,
  HandCoins,
  History,
  Package,
  ScrollText,
  ShieldCheck,
  TicketPercent,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import Form from 'next/form';
import { AreaChart, BarChart } from '@/components/admin-kit/charts/cartesian';
import { Chip } from '@/components/admin-kit/chip';
import { DataTable, DataTableEmpty } from '@/components/admin-kit/data-table';
import { reportDownloadHref } from '@/lib/report-download';
import { withQuery } from '@/components/admin-kit/href';
import { MetricTile } from '@/components/admin-kit/metric-tile';
import { SectionCard } from '@/components/admin-kit/section-card';
import { SearchFilter, SelectFilter } from '@/components/admin-kit/filter-bar';
import type { StatusTone } from '@/components/admin-kit/status-tones';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { RangeFilter } from '@/components/range/range-filter';
import {
  formatCount,
  formatDateTime,
  formatDay,
  formatMoney,
  formatPercent,
  plural,
} from '@/lib/format';
import { rangeParams } from '@/lib/date-range';
import {
  readableStatus,
  reportParamsOf,
  type ReportFilterValues,
  type ReportPageQuery,
} from '@/lib/report-query';
import { CreateExportForm } from './create-export-form';
import { AutoText } from '@/components/i18n/translate';

export const REPORTS_PATH = '/admin/reports' as const;

/** Direct downloads stream up to this many rows (the API's own limit). */
export const DIRECT_EXPORT_MAX_ROWS = 5_000;

const KIND_ICONS: Record<ReportKind, LucideIcon> = {
  sales: ChartLine,
  orders: CartIcon,
  products: Package,
  inventory: Boxes,
  customers: Users,
  coupons: TicketPercent,
  cod_collections: HandCoins,
  moderation: ShieldCheck,
  audit_logs: ScrollText,
};

/** A cell as text: money in taka, counts with grouping, dates in Dhaka time. */
export function formatCell(type: ReportColumnType, value: string | number | null): string {
  if (value === null || value === undefined || value === '') return '—';
  const number = typeof value === 'number' ? value : Number(value);
  switch (type) {
    case 'money':
      return Number.isFinite(number) ? formatMoney(Math.round(number)) : String(value);
    case 'count':
      return Number.isFinite(number) ? formatCount(number) : String(value);
    case 'percent':
      return Number.isFinite(number) ? formatPercent(number) : String(value);
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? formatDay(value)
        : formatDateTime(String(value));
    case 'datetime':
      return formatDateTime(String(value));
    case 'text':
      return typeof value === 'string' ? readableText(value) : String(value);
  }
}

/** Status-like single words ("delivered", "in_review") read well; anything else is shown as is. */
function readableText(value: string): string {
  return /^[a-z]+(_[a-z]+)*$/.test(value) ? readableStatus(value) : value;
}

const NUMERIC: readonly ReportColumnType[] = ['count', 'money', 'percent'];

// ---------------------------------------------------------------------------
// Report picker and filters
// ---------------------------------------------------------------------------

export function KindNav({
  kinds,
  current,
  query,
}: {
  kinds: readonly ReportKind[];
  current: ReportKind;
  query: ReportPageQuery;
}) {
  return (
    <nav aria-label="Reports" className="nz-panel rounded-2xl border p-2">
      <ul className="grid gap-0.5 sm:grid-cols-3 lg:grid-cols-1">
        {kinds.map((kind) => {
          const Icon = KIND_ICONS[kind];
          const active = kind === current;
          return (
            <li key={kind}>
              <Link
                href={withQuery(REPORTS_PATH, { kind, ...rangeParams(query.range) })}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
                  active
                    ? 'bg-info-soft text-foreground ring-1 ring-info-line'
                    : 'text-body hover:bg-surface-muted hover:text-foreground',
                )}
              >
                <Icon aria-hidden="true" className="size-[1.15rem] shrink-0" strokeWidth={1.75} />
                <span className="truncate">
                  <AutoText value={REPORT_DEFINITIONS[kind].title} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export interface FilterOptions {
  categories?: readonly { id: string; name: string }[];
  brands?: readonly { id: string; name: string }[];
}

export function ReportFilters({
  query,
  options,
}: {
  query: ReportPageQuery;
  options: FilterOptions;
}) {
  const definition = REPORT_DEFINITIONS[query.kind];
  const support = definition.filters;
  const { filters } = query;
  const hasFilters = Object.keys(filters).length > 0;
  const hidden = { kind: query.kind, ...rangeParams(query.range) };
  return (
    <div className="grid gap-4">
      <RangeFilter
        path={REPORTS_PATH}
        range={query.range}
        keep={{ kind: query.kind, ...stringFilters(filters) }}
      />
      {support.status ||
      support.paymentStatus ||
      support.categoryId ||
      support.brandId ||
      support.q ? (
        <Form
          action={REPORTS_PATH}
          className="flex flex-wrap items-end gap-3"
          aria-label="Report filters"
        >
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {support.status ? (
            <SelectFilter
              name="status"
              label={definition.statusLabel ?? 'Status'}
              defaultValue={filters.status}
              options={support.status.map((value) => ({ value, label: readableStatus(value) }))}
            />
          ) : null}
          {support.paymentStatus ? (
            <SelectFilter
              name="paymentStatus"
              label="Payment"
              defaultValue={filters.paymentStatus}
              options={PAYMENT_STATUSES.map((value) => ({ value, label: readableStatus(value) }))}
            />
          ) : null}
          {support.categoryId && options.categories ? (
            <SelectFilter
              name="categoryId"
              label="Category"
              defaultValue={filters.categoryId}
              options={options.categories.map((c) => ({ value: c.id, label: c.name }))}
            />
          ) : null}
          {support.brandId && options.brands ? (
            <SelectFilter
              name="brandId"
              label="Brand"
              defaultValue={filters.brandId}
              options={options.brands.map((b) => ({ value: b.id, label: b.name }))}
            />
          ) : null}
          {support.q ? (
            <SearchFilter
              label="Search"
              defaultValue={filters.q}
              placeholder="Name, code or reference"
            />
          ) : null}
          <button
            type="submit"
            className="inline-flex h-10 items-center rounded-xl bg-primary-action px-4 text-sm font-semibold text-primary-action-foreground"
          >
            <AutoText>Apply filters</AutoText>
          </button>
          {hasFilters ? (
            <Link
              href={withQuery(REPORTS_PATH, hidden)}
              className="inline-flex h-10 items-center text-sm font-medium text-link underline-offset-4 hover:underline"
            >
              <AutoText>Clear filters</AutoText>
            </Link>
          ) : null}
        </Form>
      ) : null}
    </div>
  );
}

function stringFilters(filters: ReportFilterValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters))
    if (typeof value === 'string') out[key] = value;
  return out;
}

// ---------------------------------------------------------------------------
// The report itself
// ---------------------------------------------------------------------------

export function ReportSummary({ report, kind }: { report: ReportPreview; kind: ReportKind }) {
  const Icon = KIND_ICONS[kind];
  const tiles = [
    {
      label: 'Rows',
      value: formatCount(report.totalRows),
      hint:
        report.totalRows > report.rows.length
          ? `showing the first ${formatCount(report.rows.length)}`
          : undefined,
    },
    ...report.summary.map((item) => ({
      label: item.label,
      value: formatCell(item.type, item.value),
      hint: undefined,
    })),
  ];
  return (
    <section
      aria-label="Summary"
      className="nz-stagger grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
    >
      {tiles.map((tile) => (
        <MetricTile
          key={tile.label}
          label={tile.label}
          value={tile.value}
          hint={tile.hint}
          icon={Icon}
        />
      ))}
    </section>
  );
}

export function ReportChart({ report }: { report: ReportPreview }) {
  const chart = report.chart;
  if (!chart || chart.points.length < 2) return null;
  const format = (value: number) => formatCell(chart.valueType, value);
  const common = {
    data: chart.points,
    title: chart.label,
    columns: ['Day', chart.label] as const,
    formatValue: format,
    integerAxis: chart.valueType === 'count',
  };
  return (
    <SectionCard title={chart.label} icon={ChartLine} description="Over the chosen period">
      {chart.type === 'line' ? <AreaChart {...common} /> : <BarChart {...common} />}
    </SectionCard>
  );
}

export function ReportTable({ report }: { report: ReportPreview }) {
  const { columns, rows } = report;
  return (
    <SectionCard
      title={report.title}
      icon={FileText}
      description={
        report.totalRows > rows.length
          ? `The first ${formatCount(rows.length)} of ${plural(report.totalRows, 'row')}. Download the report for all of them.`
          : plural(report.totalRows, 'row')
      }
      flush
      className="nz-panel-strong"
    >
      <div className="nz-scroll max-h-[34rem] overflow-auto">
        <DataTable caption={report.title} dense className="nz-sticky-head">
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  className={cn(NUMERIC.includes(column.type) && 'text-right')}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          {rows.length === 0 ? (
            <DataTableEmpty
              colSpan={columns.length}
              icon={FileText}
              title="No rows for these filters"
              description="Widen the date range or clear a filter."
            />
          ) : (
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={index}>
                  {columns.map((column) => (
                    <TableCell
                      key={column.key}
                      className={cn(NUMERIC.includes(column.type) && 'text-right tabular-nums')}
                    >
                      {formatCell(column.type, row[column.key] ?? null)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          )}
        </DataTable>
      </div>
    </SectionCard>
  );
}

/** Direct downloads for reports that fit, a background export for the ones that do not. */
export function DownloadSection({
  report,
  query,
  csrf,
}: {
  report: ReportPreview;
  query: ReportPageQuery;
  csrf: CsrfInput;
}) {
  const filters = reportParamsOf(query);
  const direct = report.totalRows <= DIRECT_EXPORT_MAX_ROWS;
  return (
    <SectionCard
      title="Download this report"
      icon={Download}
      description={
        direct
          ? 'Exactly the rows and filters shown above. Every download is recorded in the audit log.'
          : `This report has ${formatCount(report.totalRows)} rows, too many to download at once. Queue a background export; it is ready under “Your exports” below.`
      }
    >
      <div className="grid gap-4">
        {query.tooLarge && direct ? (
          <p className="text-sm text-warning-ink">
            <AutoText>That download was too large; queue a background export instead.</AutoText>
          </p>
        ) : null}
        {direct ? (
          <div className="flex flex-wrap gap-2">
            {(['csv', 'xlsx', 'pdf'] as const).map((format) => (
              <a
                key={format}
                href={reportDownloadHref(query.kind, format, filters)}
                download
                className="nz-btn inline-flex h-10 items-center gap-2 rounded-xl border border-border-strong bg-surface px-4 text-sm font-semibold text-foreground transition-colors hover:bg-surface-muted"
              >
                <Download aria-hidden="true" className="size-4" />
                {format === 'xlsx' ? 'Excel' : format.toUpperCase()}
              </a>
            ))}
          </div>
        ) : (
          <CreateExportForm kind={query.kind} query={filters} csrf={csrf} />
        )}
        {direct ? (
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer font-medium text-link">
              Prefer a file prepared in the background?
            </summary>
            <div className="pt-3">
              <CreateExportForm
                kind={query.kind}
                query={filters}
                csrf={csrf}
                formats={['csv', 'xlsx', 'pdf']}
              />
            </div>
          </details>
        ) : null}
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Background exports
// ---------------------------------------------------------------------------

const JOB_TONE: Record<ExportJob['status'], { label: string; tone: StatusTone }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  running: { label: 'Running', tone: 'primary' },
  done: { label: 'Ready', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  expired: { label: 'Expired', tone: 'neutral' },
};

function fileSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ExportJobsSection({ jobs, now }: { jobs: readonly ExportJob[]; now: Date }) {
  const active = jobs.some((job) => job.status === 'queued' || job.status === 'running');
  return (
    <SectionCard
      title="Your exports"
      icon={History}
      description="Background exports you started. Files are kept for 7 days and only you can download them."
      actions={
        <Link
          href={REPORTS_PATH}
          scroll={false}
          className="text-sm font-medium text-link underline-offset-4 hover:underline"
        >
          {active ? 'Refresh progress' : 'Refresh'}
        </Link>
      }
      flush
    >
      {jobs.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">
          <AutoText>
            No background exports yet. Reports too large to download at once are prepared here.
          </AutoText>
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {jobs.map((job) => {
            const status = JOB_TONE[job.status];
            return (
              <li
                key={job.id}
                className="grid gap-2 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6"
              >
                <div className="grid min-w-0 gap-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                    {REPORT_DEFINITIONS[job.kind].title}
                    <Chip tone={status.tone} dot>
                      {status.label}
                    </Chip>
                    <span className="text-xs font-normal text-muted-foreground uppercase">
                      {job.format}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {job.filters.from} to {job.filters.to} · started{' '}
                    {formatRelative(job.createdAt, now)}
                    {job.rowCount !== null ? ` · ${plural(job.rowCount, 'row')}` : ''}
                    {job.status === 'done' ? ` · ${fileSize(job.fileBytes)}` : ''}
                  </p>
                  {job.status === 'running' || job.status === 'queued' ? (
                    <div
                      role="progressbar"
                      aria-label="Export progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={job.progress}
                      className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-chart-track"
                    >
                      <div
                        className="h-full rounded-full bg-chart-1"
                        style={{ width: `${String(job.progress)}%` }}
                      />
                    </div>
                  ) : null}
                  {job.status === 'failed' && job.error ? (
                    <p className="text-xs text-danger-ink">
                      <AutoText value={job.error} />
                    </p>
                  ) : null}
                </div>
                {job.status === 'done' ? (
                  <a
                    href={`/api/exports/${job.id}`}
                    download
                    className="inline-flex h-9 items-center gap-2 rounded-xl border border-border-strong bg-surface px-3 text-sm font-semibold text-foreground hover:bg-surface-muted"
                  >
                    <Download aria-hidden="true" className="size-4" />
                    <AutoText>Download</AutoText>
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

function formatRelative(iso: string, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${String(hours)} h ago`;
  return formatDateTime(iso);
}
