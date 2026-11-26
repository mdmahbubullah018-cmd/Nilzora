import {
  Card,
  Skeleton,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@nilzora/ui';
import { DataTable } from './data-table';
import { AutoText } from '@/components/i18n/translate';

/*
 * Page skeletons
 * --------------
 * A loading screen is a promise about the shape of what is coming. Each family of admin
 * pages therefore has its own placeholder, drawn from the same tokens as the page it
 * stands in for: the real heading and action row, the same filter panel, the same table
 * columns, the same card grid, the same inbox columns. Nothing here is one generic block
 * reused everywhere, and nothing moves when the data lands.
 *
 * Every skeleton is a single polite status for assistive technology; the decorative
 * blocks inside are hidden from it. Motion comes from the shared Skeleton, which already
 * stops for prefers-reduced-motion.
 */

/** The heading every page opens with: eyebrow, title, description and actions. */
export function PageHeadingSkeleton({
  actions = 2,
  titleClass = 'w-56',
  description = true,
}: {
  actions?: number;
  titleClass?: string;
  description?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="grid min-w-0 gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className={cn('h-8', titleClass)} />
        {description ? <Skeleton className="h-4 w-full max-w-xl" /> : null}
      </div>
      {actions > 0 ? (
        <div className="flex shrink-0 items-center gap-2">
          {Array.from({ length: actions }, (_, index) => (
            <Skeleton key={index} className="h-10 w-28 rounded-xl" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A filter panel: the search field, a few selects and the apply pair. */
export function FilterPanelSkeleton({ fields = 2 }: { fields?: number }) {
  return (
    <div className="nz-panel flex flex-wrap items-end gap-3 rounded-2xl border p-3 sm:p-4">
      <div className="grid min-w-56 flex-1 gap-1.5 sm:max-w-sm">
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="h-10 rounded-xl" />
      </div>
      {Array.from({ length: fields }, (_, index) => (
        <div key={index} className="grid min-w-40 gap-1.5">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="h-10 rounded-xl" />
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Skeleton className="h-10 w-24 rounded-xl" />
        <Skeleton className="h-10 w-16 rounded-xl" />
      </div>
    </div>
  );
}

export interface TableSkeletonProps {
  /** Names the busy table for assistive technology, e.g. "Loading orders". */
  caption: string;
  columns: number;
  rows?: number;
  /** Draws the page's filter panel above the table, as list pages have one. */
  withFilters?: boolean;
  /** Per-column placeholder widths; the first column always gets the avatar and title. */
  widths?: readonly string[];
}

const DEFAULT_WIDTHS = ['w-40', 'w-24', 'w-20', 'w-24', 'w-16', 'w-20', 'w-16', 'w-12'];

/** A list card with placeholder rows, matching an operational table. */
export function TableSkeleton({
  caption,
  columns,
  rows = 8,
  withFilters = false,
  widths = DEFAULT_WIDTHS,
}: TableSkeletonProps) {
  const widthFor = (column: number) => widths[column] ?? 'w-20';
  return (
    <div aria-busy="true" className="grid gap-6">
      <span className="sr-only" role="status">
        {caption}
      </span>
      {withFilters ? <FilterPanelSkeleton /> : null}
      <div className="nz-panel-strong overflow-hidden rounded-2xl border">
        <DataTable caption={caption} dense>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {Array.from({ length: columns }, (_, column) => (
                <TableHead key={column}>
                  <Skeleton className={cn('h-2.5', column === 0 ? 'w-24' : 'w-16')} />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: rows }, (_, row) => (
              <TableRow key={row} className="hover:bg-transparent">
                {Array.from({ length: columns }, (_, column) => (
                  <TableCell key={column}>
                    {column === 0 ? (
                      <span className="flex items-center gap-3">
                        <Skeleton className="size-8 shrink-0 rounded-lg" />
                        <span className="grid gap-1.5">
                          <Skeleton className="h-3.5 w-28" />
                          <Skeleton className="h-2.5 w-16" />
                        </span>
                      </span>
                    ) : column === columns - 1 ? (
                      <Skeleton className="h-6 w-16 rounded-full" />
                    ) : (
                      <Skeleton className={cn('h-3.5', widthFor(column))} />
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </DataTable>
        {/* The paging line under every operational table. */}
        <div className="flex items-center justify-between gap-3 border-t border-hairline px-4 py-3">
          <Skeleton className="h-3.5 w-48" />
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-8 w-24 rounded-xl" />
            <Skeleton className="hidden size-8 rounded-xl sm:block" />
            <Skeleton className="hidden size-8 rounded-xl sm:block" />
            <Skeleton className="h-8 w-20 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A list page with its heading, tabs and filters: the shape of Orders, Products,
 * Customers, Reviews, Staff and their neighbours.
 */
export function ListPageSkeleton({
  label,
  columns = 6,
  rows = 8,
  tabs = 4,
  withFilters = true,
  widths,
}: {
  label: string;
  columns?: number;
  rows?: number;
  tabs?: number;
  withFilters?: boolean;
  widths?: readonly string[];
}) {
  return (
    <div aria-busy="true" className="grid gap-6">
      <span className="sr-only" role="status">
        {label}
      </span>
      <PageHeadingSkeleton actions={2} />
      {tabs > 0 ? (
        <div className="nz-strip w-max max-w-full">
          {Array.from({ length: tabs }, (_, index) => (
            <div key={index} className="nz-strip-item">
              <Skeleton className="h-3 w-16" />
              {index === 0 ? <Skeleton className="h-4 w-6 rounded-full" /> : null}
            </div>
          ))}
        </div>
      ) : null}
      <TableSkeleton
        caption={label}
        columns={columns}
        rows={rows}
        withFilters={withFilters}
        widths={widths}
      />
    </div>
  );
}

/**
 * A detail page: its heading and tab strip, then a wide column of cards beside a side
 * column. The whole page's content (heading included) sits inside the page's Suspense
 * boundary, so the placeholder draws the heading too and nothing moves when data lands.
 */
export function DetailSkeleton({
  label,
  tabs = 3,
  sideCards = 2,
  bodyCards = 2,
}: {
  label: string;
  tabs?: number;
  sideCards?: number;
  bodyCards?: number;
}) {
  const panel = (height: string, key: string, lines = 4) => (
    <Card key={key} className="nz-panel-strong grid gap-3 rounded-2xl p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <Skeleton className={cn('w-full rounded-xl', height)} />
      {Array.from({ length: lines }, (_, line) => (
        <Skeleton key={line} className="h-3.5 w-full max-w-md" />
      ))}
    </Card>
  );
  return (
    <div aria-busy="true" className="grid gap-6">
      <span className="sr-only" role="status">
        {label}
      </span>
      <PageHeadingSkeleton titleClass="w-72" />
      {tabs > 0 ? (
        <div className="nz-strip w-max max-w-full">
          {Array.from({ length: tabs }, (_, index) => (
            <div key={index} className="nz-strip-item">
              <Skeleton className="h-6 w-6 rounded-lg" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid content-start gap-6">
          {Array.from({ length: bodyCards }, (_, index) => panel('h-40', `a${String(index)}`, 5))}
        </div>
        <div className="grid content-start gap-6">
          {Array.from({ length: sideCards }, (_, index) =>
            panel('h-24', `b${String(index)}`, 3),
          )}
        </div>
      </div>
    </div>
  );
}

/** The dashboard: KPI tiles, a revenue chart beside a split, then the work queues. */
export function DashboardSkeleton({ label = 'Loading the dashboard' }: { label?: string }) {
  return (
    <div aria-busy="true" className="grid gap-6">
      <span className="sr-only" role="status">
        {label}
      </span>
      <PageHeadingSkeleton actions={1} description={false} />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <Card key={index} className="grid gap-3 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="size-9 rounded-xl" />
            </div>
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-28" />
          </Card>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="grid gap-4 p-4 sm:p-5 xl:col-span-2">
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56 max-w-full" />
            </div>
            <Skeleton className="h-8 w-40 rounded-xl" />
          </div>
          <Skeleton className="h-64 rounded-xl" />
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-14 rounded-xl" />
            ))}
          </div>
        </Card>
        <Card className="grid content-start gap-4 p-4 sm:p-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mx-auto size-40 rounded-full" />
          <div className="grid gap-2">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex items-center gap-2">
                <Skeleton className="size-2.5 rounded-full" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-10" />
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="grid gap-3 p-4 sm:p-5 xl:col-span-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-52 rounded-xl" />
        </Card>
        <Card className="grid content-start gap-4 p-4 sm:p-5">
          <Skeleton className="h-4 w-28" />
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex items-center gap-3">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="grid flex-1 gap-1.5">
                <Skeleton className="h-3.5 w-3/5" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, index) => (
          <Card key={index} className="grid gap-4 p-4 sm:p-5">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-44 rounded-xl" />
          </Card>
        ))}
      </div>
    </div>
  );
}

/** Analytics: the range switch, six figures, two charts and the breakdown table. */
export function AnalyticsSkeleton({ label = 'Loading analytics' }: { label?: string }) {
  return (
    <div aria-busy="true" className="grid gap-6">
      <span className="sr-only" role="status">
        {label}
      </span>
      <PageHeadingSkeleton actions={2} />
      <div className="nz-strip w-max max-w-full">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="nz-strip-item">
            <Skeleton className="h-3 w-14" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <Card key={index} className="grid gap-3 p-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-3 w-24" />
          </Card>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="grid gap-4 p-4 sm:p-5 xl:col-span-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-72 rounded-xl" />
        </Card>
        <Card className="grid content-start gap-4 p-4 sm:p-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </Card>
      </div>
      <TableSkeleton caption={label} columns={6} rows={6} widths={['w-32', 'w-20', 'w-16', 'w-20', 'w-16', 'w-14']} />
    </div>
  );
}

/** A settings screen: the section list beside the form it opens. */
export function SettingsSkeleton({ label = 'Loading settings' }: { label?: string }) {
  return (
    <div aria-busy="true" className="grid gap-6">
      <span className="sr-only" role="status">
        {label}
      </span>
      <PageHeadingSkeleton actions={1} />
      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <Card className="grid content-start gap-1 p-2">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5">
              <Skeleton className="size-4 rounded" />
              <Skeleton className="h-3.5 w-28" />
            </div>
          ))}
        </Card>
        <div className="grid content-start gap-6">
          {Array.from({ length: 3 }, (_, index) => (
            <Card key={index} className="nz-panel-strong grid gap-4 rounded-2xl p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="grid gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-64 max-w-full" />
                </div>
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {Array.from({ length: 4 }, (_, field) => (
                  <div key={field} className="grid gap-2">
                    <Skeleton className="h-2.5 w-24" />
                    <Skeleton className="h-10 rounded-xl" />
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

/** An editor page: two form columns, a media well and a save bar. */
export function EditorSkeleton({
  label,
  sections = 4,
}: {
  label: string;
  sections?: number;
}) {
  return (
    <div aria-busy="true" className="grid gap-6">
      <span className="sr-only" role="status">
        {label}
      </span>
      <PageHeadingSkeleton titleClass="w-64" actions={2} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid content-start gap-6">
          {Array.from({ length: sections }, (_, index) => (
            <Card key={index} className="nz-panel-strong grid gap-4 rounded-2xl p-5 sm:p-6">
              <Skeleton className="h-4 w-36" />
              <div className="grid gap-4 sm:grid-cols-2">
                {Array.from({ length: index === 0 ? 2 : 4 }, (_, field) => (
                  <div key={field} className="grid gap-2">
                    <Skeleton className="h-2.5 w-20" />
                    <Skeleton className={index === 0 && field === 0 ? 'h-28 rounded-xl' : 'h-10 rounded-xl'} />
                  </div>
                ))}
              </div>
              {index === 0 ? <Skeleton className="h-10 w-40 rounded-xl" /> : null}
            </Card>
          ))}
        </div>
        <div className="grid content-start gap-6">
          <Card className="nz-panel-strong grid gap-3 rounded-2xl p-5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-10 rounded-xl" />
          </Card>
          <Card className="nz-panel-strong grid gap-3 rounded-2xl p-5">
            <Skeleton className="h-4 w-24" />
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="flex items-center justify-between gap-3">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-6 w-12 rounded-full" />
              </div>
            ))}
          </Card>
        </div>
      </div>
      <Card className="nz-panel-strong flex items-center justify-between gap-3 rounded-2xl p-3">
        <Skeleton className="h-3.5 w-40" />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-24 rounded-xl" />
          <Skeleton className="h-10 w-32 rounded-xl" />
        </div>
      </Card>
    </div>
  );
}

/** The communication inbox: the queue, the thread and the details column. */
export function InboxSkeleton({ label = 'Loading conversations' }: { label?: string }) {
  return (
    <div aria-busy="true" className="grid gap-4">
      <span className="sr-only" role="status">
        {label}
      </span>
      <div className="nz-strip w-max max-w-full">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="nz-strip-item">
            <Skeleton className="h-6 w-6 rounded-lg" />
            <Skeleton className="h-3 w-14" />
          </div>
        ))}
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(17rem,21rem)_minmax(0,1fr)_minmax(15rem,19rem)]">
        <Card className="nz-panel-strong grid content-start gap-3 rounded-2xl p-3">
          <Skeleton className="h-9 rounded-xl" />
          <div className="grid grid-cols-3 gap-1">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-7 rounded-lg" />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Skeleton className="h-8 rounded-lg" />
            <Skeleton className="h-8 rounded-lg" />
            <Skeleton className="col-span-2 h-8 rounded-lg" />
          </div>
          <Skeleton className="h-3 w-28" />
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex gap-3 border-t border-hairline pt-3 first:border-t-0 first:pt-0">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="grid flex-1 gap-1.5">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
            </div>
          ))}
        </Card>
        <Card className="nz-panel-strong flex min-h-96 flex-col rounded-2xl p-3">
          <div className="flex items-center gap-2.5 border-b border-hairline pb-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="grid flex-1 gap-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56 max-w-full" />
            </div>
            <Skeleton className="h-8 w-20 rounded-xl" />
          </div>
          <div className="grid flex-1 content-end gap-3 py-4">
            <Skeleton className="h-3 w-24 self-center rounded-full" />
            <Skeleton className="h-16 w-3/5 rounded-2xl" />
            <Skeleton className="ml-auto h-20 w-2/3 rounded-2xl" />
            <Skeleton className="h-12 w-1/2 rounded-2xl" />
          </div>
          <div className="grid gap-2 border-t border-hairline pt-3">
            <div className="flex gap-2">
              <Skeleton className="h-7 w-24 rounded-lg" />
              <Skeleton className="h-7 w-32 rounded-lg" />
            </div>
            <Skeleton className="h-20 rounded-2xl" />
          </div>
        </Card>
        <Card className="nz-panel-strong hidden content-start gap-3 rounded-2xl p-4 xl:grid">
          <Skeleton className="h-3 w-20" />
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="grid flex-1 gap-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="grid gap-1.5 border-t border-hairline pt-3">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-3.5 w-full" />
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

/** The media library: album chips, then tiles of pictures. */
export function MediaLibrarySkeleton({ label = 'Loading media' }: { label?: string }) {
  return (
    <div aria-busy="true" className="grid gap-6">
      <span className="sr-only" role="status">
        {label}
      </span>
      <PageHeadingSkeleton actions={2} />
      <FilterPanelSkeleton fields={1} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
        {Array.from({ length: 12 }, (_, index) => (
          <div key={index} className="nz-panel-strong overflow-hidden rounded-2xl border">
            <Skeleton className="aspect-4/3 w-full rounded-none" />
            <div className="grid gap-1.5 p-3">
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A catalogue grid: category, brand or banner cards. */
export function CardGridSkeleton({
  label,
  cards = 8,
  columns = 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4',
  tall = true,
}: {
  label: string;
  cards?: number;
  columns?: string;
  tall?: boolean;
}) {
  return (
    <div aria-busy="true" className="grid gap-6">
      <span className="sr-only" role="status">
        {label}
      </span>
      <PageHeadingSkeleton actions={2} />
      <div className={cn('grid gap-4', columns)}>
        {Array.from({ length: cards }, (_, index) => (
          <Card key={index} className="nz-panel-strong overflow-hidden rounded-2xl">
            <Skeleton className={cn('w-full rounded-none', tall ? 'aspect-16/10' : 'h-24')} />
            <div className="grid gap-2 p-4">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3 w-full" />
              <div className="flex items-center justify-between gap-2 pt-1">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-8 w-20 rounded-xl" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/** The profile page: the picture well beside the account form. */
export function ProfileSkeleton({ label = 'Loading your profile' }: { label?: string }) {
  return (
    <div aria-busy="true" className="grid gap-6">
      <span className="sr-only" role="status">
        {label}
      </span>
      <PageHeadingSkeleton actions={0} />
      <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <Card className="nz-panel-strong grid justify-items-center gap-3 rounded-2xl p-6 text-center">
          <Skeleton className="size-28 rounded-full" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-10 w-40 rounded-xl" />
        </Card>
        <Card className="nz-panel-strong grid gap-5 rounded-2xl p-5 sm:p-6">
          <Skeleton className="h-4 w-36" />
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="grid gap-2">
                <Skeleton className="h-2.5 w-20" />
                <Skeleton className="h-10 rounded-xl" />
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Skeleton className="h-10 w-24 rounded-xl" />
            <Skeleton className="h-10 w-32 rounded-xl" />
          </div>
        </Card>
      </div>
    </div>
  );
}

/** The operations screens: a section switch, a status board and a table of work. */
export function OperationsSkeleton({ label = 'Loading operations' }: { label?: string }) {
  return (
    <div aria-busy="true" className="grid gap-6">
      <span className="sr-only" role="status">
        {label}
      </span>
      <PageHeadingSkeleton actions={1} />
      <div className="nz-strip w-max max-w-full">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="nz-strip-item">
            <Skeleton className="h-6 w-6 rounded-lg" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index} className="grid gap-3 p-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="size-8 rounded-lg" />
            </div>
            <Skeleton className="h-7 w-16" />
          </Card>
        ))}
      </div>
      <TableSkeleton caption={label} columns={6} rows={7} withFilters widths={['w-32', 'w-24', 'w-20', 'w-24', 'w-16', 'w-20']} />
    </div>
  );
}

/** A route's own frame while the workspace is still resolving: an honest, page-agnostic shape. */
export function NeutralPageSkeleton({ label = 'Loading the page' }: { label?: string }) {
  return (
    <div aria-busy="true" className="grid gap-6">
      <span className="sr-only" role="status">
        <AutoText value={label} />
      </span>
      <PageHeadingSkeleton actions={2} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="nz-panel-strong grid gap-3 rounded-2xl p-5">
          <Skeleton className="h-3 w-24" />
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex items-center gap-3 border-t border-hairline pt-3 first:border-t-0 first:pt-0">
              <Skeleton className="size-8 shrink-0 rounded-lg" />
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </Card>
        <Card className="nz-panel-strong grid content-start gap-3 rounded-2xl p-5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </Card>
      </div>
    </div>
  );
}

/** What a route's loading screen draws, chosen to match the page that is coming. */
export type PageSkeletonVariant =
  | 'dashboard'
  | 'analytics'
  | 'list'
  | 'detail'
  | 'editor'
  | 'settings'
  | 'inbox'
  | 'media'
  | 'grid'
  | 'profile'
  | 'operations'
  | 'form'
  | 'neutral';

/** The single entry point a loading.tsx uses. */
export function PageSkeleton({
  variant,
  label,
}: {
  variant: PageSkeletonVariant;
  label: string;
}) {
  switch (variant) {
    case 'dashboard':
      return <DashboardSkeleton label={label} />;
    case 'analytics':
      return <AnalyticsSkeleton label={label} />;
    case 'detail':
      return <DetailSkeleton label={label} />;
    case 'editor':
      return <EditorSkeleton label={label} />;
    case 'settings':
      return <SettingsSkeleton label={label} />;
    case 'inbox':
      return <InboxSkeleton label={label} />;
    case 'media':
      return <MediaLibrarySkeleton label={label} />;
    case 'grid':
      return <CardGridSkeleton label={label} />;
    case 'profile':
      return <ProfileSkeleton label={label} />;
    case 'operations':
      return <OperationsSkeleton label={label} />;
    case 'form':
      return <EditorSkeleton label={label} sections={3} />;
    case 'neutral':
      return <NeutralPageSkeleton label={label} />;
    default:
      return <ListPageSkeleton label={label} />;
  }
}

/** A short, centred "loading the page" block for a section that is still streaming. */
export function SectionSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div aria-busy="true" className="grid gap-3">
      <span className="sr-only" role="status">
        <AutoText value={label} />
      </span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-14 rounded-xl" />
      ))}
    </div>
  );
}
