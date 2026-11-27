import { Skeleton, Table, TableBody, TableCaption, TableCell, TableRow, cn } from '@nilzora/ui';
import { ArrowDown, ArrowUp, ArrowUpDown, type LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { AutoText } from '@/components/i18n/translate';

/*
 * Table pieces for operational lists, built on the @nilzora/ui Table. Compose them:
 *
 *   <DataTable caption="Orders">
 *     <TableHeader><TableRow>
 *       <SortableHead column="placed" sort={sort} hrefFor={hrefFor}>Placed</SortableHead>
 *       <TableHead>Status</TableHead>
 *     </TableRow></TableHeader>
 *     {rows.length ? <TableBody>…</TableBody> : <DataTableEmpty colSpan={2} title="No orders" />}
 *   </DataTable>
 *
 * Sorting and paging are links (GET parameters), so they work without JavaScript and
 * every view has its own address.
 */

export type SortDirection = 'asc' | 'desc';

export interface SortState<C extends string> {
  column: C;
  direction: SortDirection;
}

/**
 * Reads a sort parameter: `name` sorts ascending, `-name` descending. Unknown columns
 * fall back, so a hand-edited URL never reaches the API as an invalid sort.
 */
export function parseSort<C extends string>(
  value: string | string[] | undefined,
  columns: readonly C[],
  fallback: SortState<C>,
): SortState<C> {
  if (typeof value !== 'string') return fallback;
  const direction: SortDirection = value.startsWith('-') ? 'desc' : 'asc';
  const name = value.replace(/^-/, '');
  const column = columns.find((candidate) => candidate === name);
  return column ? { column, direction } : fallback;
}

/** The sort parameter for a sort state: `name` or `-name`. */
export function sortParam<C extends string>(sort: SortState<C>): string {
  return sort.direction === 'desc' ? `-${sort.column}` : sort.column;
}

export interface DataTableProps {
  /** Names the table for assistive technology; visible only with `showCaption`. */
  caption: string;
  showCaption?: boolean;
  /** Tighter rows for dense operational lists. */
  dense?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * A semantic table that scrolls sideways on narrow screens instead of squashing columns.
 *
 * A `DataTableEmpty` child is drawn BELOW the table, outside the scrolling wrapper: inside a
 * wide, horizontally scrolling table its centred message would sit mostly off-screen on a
 * phone or tablet. Outside, it is as wide as the panel at every width.
 */
export function DataTable({
  caption,
  showCaption = false,
  dense = false,
  className,
  children,
}: DataTableProps) {
  const parts = Children.toArray(children);
  const empty = parts.find(
    (part): part is ReactElement<DataTableEmptyProps> =>
      isValidElement(part) && part.type === DataTableEmpty,
  );
  const table = (
    <Table
      className={cn(
        '[&_td]:whitespace-nowrap [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-info-soft/35',
        // The head is a quiet label bar rather than a heavier row: it stays legible in both
        // themes and never competes with the data underneath it.
        '[&_thead]:bg-surface-muted/55 [&_thead_th]:text-[11px] [&_thead_th]:font-semibold [&_thead_th]:tracking-[0.06em] [&_thead_th]:text-muted-foreground [&_thead_th]:uppercase',
        dense && '[&_td]:py-2 [&_th]:h-9',
        className,
      )}
    >
      <TableCaption className={showCaption ? undefined : 'sr-only'}>
        <AutoText value={caption} />
      </TableCaption>
      {empty ? parts.filter((part) => part !== empty) : children}
    </Table>
  );
  if (!empty) return table;
  return (
    <>
      {table}
      <EmptyBlock {...empty.props} />
    </>
  );
}

export interface SortableHeadProps<C extends string> {
  column: C;
  /** The list's current sort. */
  sort: SortState<C>;
  /** The list's address for another sort (keep the filters; start again from page 1). */
  hrefFor: (sort: SortState<C>) => Route;
  /** The direction a first click sorts by, e.g. `desc` for dates and amounts. */
  firstDirection?: SortDirection;
  align?: 'left' | 'right';
  className?: string;
  children: ReactNode;
}

/** A column heading that sorts by its column; the current sort is exposed as aria-sort. */
export function SortableHead<C extends string>({
  column,
  sort,
  hrefFor,
  firstDirection = 'asc',
  align = 'left',
  className,
  children,
}: SortableHeadProps<C>) {
  const active = sort.column === column;
  const next: SortDirection = active ? (sort.direction === 'asc' ? 'desc' : 'asc') : firstDirection;
  const Icon = active ? (sort.direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <th
      scope="col"
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cn(
        'h-10 px-4 align-middle text-xs font-semibold tracking-wide text-muted-foreground uppercase',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
    >
      <Link
        href={hrefFor({ column, direction: next })}
        className={cn(
          'inline-flex items-center gap-1 rounded-sm uppercase transition-colors hover:text-foreground',
          align === 'right' && 'flex-row-reverse',
          active && 'text-foreground',
        )}
      >
        {children}
        <Icon aria-hidden="true" className={cn('size-3.5', !active && 'opacity-50')} />
        <span className="sr-only">{`, sort ${next === 'asc' ? 'ascending' : 'descending'}`}</span>
      </Link>
    </th>
  );
}

export interface DataTableEmptyProps {
  /** The number of columns, so the message spans the table. */
  colSpan: number;
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
}

function EmptyContent({
  title,
  description,
  icon: Icon,
  action,
}: Omit<DataTableEmptyProps, 'colSpan'>) {
  return (
    <div className="mx-auto grid max-w-sm justify-items-center gap-2">
      {Icon ? (
        <span className="nz-float mb-1 grid size-14 place-items-center rounded-full bg-info-soft text-info-ink shadow-glass ring-8 ring-info-soft">
          <Icon aria-hidden="true" className="size-6" strokeWidth={1.6} />
        </span>
      ) : null}
      <p className="text-sm font-semibold text-foreground">
        <AutoText value={title} />
      </p>
      {description ? (
        <p className="text-sm text-muted-foreground">
          <AutoText value={description} />
        </p>
      ) : null}
      {action ? (
        <div className="mt-1">
          <AutoText value={action} />
        </div>
      ) : null}
    </div>
  );
}

/** The empty state as a plain block under a table (see DataTable). */
function EmptyBlock({ colSpan: _colSpan, ...content }: DataTableEmptyProps) {
  return (
    <div className="border-t border-border px-6 py-12 text-center">
      <EmptyContent {...content} />
    </div>
  );
}

/**
 * The body of a table with no rows: why it is empty and, if useful, what to do. Inside a
 * `DataTable` it is drawn under the table instead (so it is never clipped by sideways
 * scrolling); used on its own it is a single full-width table row.
 */
export function DataTableEmpty({ colSpan, ...content }: DataTableEmptyProps) {
  return (
    <TableBody>
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={colSpan} className="px-6 py-12 text-center whitespace-normal">
          <EmptyContent {...content} />
        </TableCell>
      </TableRow>
    </TableBody>
  );
}

/** Placeholder rows while a table loads (for loading.tsx files and Suspense fallbacks). */
export function DataTableLoading({ columns, rows = 5 }: { columns: number; rows?: number }) {
  return (
    <TableBody aria-busy="true">
      {Array.from({ length: rows }, (_, row) => (
        <TableRow key={row} className="hover:bg-transparent">
          {Array.from({ length: columns }, (_, column) => (
            <TableCell key={column}>
              <Skeleton className={cn('h-4', column === 0 ? 'w-24' : 'w-full max-w-32')} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );
}
