import { buttonClasses, cn } from '@nilzora/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { formatCount } from '@/lib/format';
import { AutoText } from '@/components/i18n/translate';

/**
 * Page numbers to show around the current page: the first and last pages, the current
 * one and its neighbours. `null` marks a gap; a gap of a single page shows that page.
 */
export function pageWindow(current: number, total: number): (number | null)[] {
  const wanted = new Set(
    [1, current - 1, current, current + 1, total].filter((page) => page >= 1 && page <= total),
  );
  const pages: (number | null)[] = [];
  let previous = 0;
  for (const page of [...wanted].sort((a, b) => a - b)) {
    if (page - previous === 2) pages.push(previous + 1);
    else if (page - previous > 2) pages.push(null);
    pages.push(page);
    previous = page;
  }
  return pages;
}

/** "Showing 26–50 of 230 orders", from an admin listing's paging fields. */
export function rangeSummary(
  page: number,
  pageSize: number,
  total: number,
  noun = 'results',
): string {
  if (total === 0) return `No ${noun}`;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  if (first > total) return `${formatCount(total)} ${noun}`;
  return `Showing ${formatCount(first)}–${formatCount(last)} of ${formatCount(total)} ${noun}`;
}

const step = buttonClasses({ variant: 'outline', size: 'sm' });
const number =
  'inline-flex size-11 items-center justify-center rounded-xl text-sm font-medium tabular-nums text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground sm:size-9';

export interface PaginationProps {
  /** The current page (from the API response, not the URL). */
  page: number;
  totalPages: number;
  /** The list's address for another page, keeping its filters. */
  hrefFor: (page: number) => Route;
  /** With pageSize, shows "Showing 26–50 of 230 orders". */
  total?: number;
  pageSize?: number;
  /** The plural noun for the summary, e.g. "orders". */
  noun?: string;
  className?: string;
}

/**
 * The summary line plus previous/next and numbered page links (links, so paging works
 * without JavaScript). Nothing links past the last page; a single page shows only the
 * summary.
 */
export function Pagination({
  page,
  totalPages,
  hrefFor,
  total,
  pageSize,
  noun,
  className,
}: PaginationProps) {
  const summary =
    total !== undefined && pageSize !== undefined
      ? rangeSummary(page, pageSize, total, noun)
      : undefined;
  const paged = totalPages > 1 && page >= 1 && page <= totalPages;
  if (!paged && !summary) return null;

  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      {summary ? <p className="text-sm text-muted-foreground tabular-nums"><AutoText value={summary} /></p> : <span />}
      {paged ? (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-2">
          {page > 1 ? (
            <Link href={hrefFor(page - 1)} rel="prev" className={step}>
              <ChevronLeft aria-hidden="true" /><AutoText>Previous</AutoText></Link>
          ) : (
            <span aria-hidden="true" className={cn(step, 'pointer-events-none opacity-40')}>
              <ChevronLeft /><AutoText>Previous</AutoText></span>
          )}

          <ol className="hidden items-center gap-1 md:flex">
            {pageWindow(page, totalPages).map((entry, index) =>
              entry === null ? (
                <li
                  key={`gap-${String(index)}`}
                  aria-hidden="true"
                  className="px-1 text-muted-foreground"
                >
                  …
                </li>
              ) : (
                <li key={entry}>
                  <Link
                    href={hrefFor(entry)}
                    aria-label={`Page ${String(entry)}`}
                    aria-current={entry === page ? 'page' : undefined}
                    className={cn(
                      number,
                      entry === page
                        ? 'bg-info-soft font-semibold text-info-ink shadow-glass-xs ring-1 ring-info-line hover:bg-info-soft hover:text-info-ink'
                        : 'text-foreground',
                    )}
                  >
                    {entry}
                  </Link>
                </li>
              ),
            )}
          </ol>
          <p className="text-sm text-muted-foreground tabular-nums md:hidden">
            Page {page} of {totalPages}
          </p>

          {page < totalPages ? (
            <Link href={hrefFor(page + 1)} rel="next" className={step}>
              Next
              <ChevronRight aria-hidden="true" />
            </Link>
          ) : (
            <span aria-hidden="true" className={cn(step, 'pointer-events-none opacity-40')}>
              Next
              <ChevronRight />
            </span>
          )}
        </nav>
      ) : null}
    </div>
  );
}
