import { buttonClasses, cn } from '@nilzora/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

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

const step = buttonClasses({ variant: 'outline', size: 'sm' });
const number =
  'inline-flex size-9 items-center justify-center rounded-md text-sm font-medium tabular-nums transition-colors hover:bg-surface-muted';

export interface PaginationProps {
  /** The current page, between 1 and totalPages. */
  page: number;
  totalPages: number;
  hrefFor: (page: number) => Route;
}

/** Previous/next and numbered page links. Nothing links past the last page. */
export function Pagination({ page, totalPages, hrefFor }: PaginationProps) {
  if (totalPages <= 1 || page < 1 || page > totalPages) return null;
  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-3 sm:justify-center"
    >
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} rel="prev" className={step}>
          <ChevronLeft aria-hidden="true" />
          Previous
        </Link>
      ) : (
        <span aria-hidden="true" className={cn(step, 'pointer-events-none opacity-40')}>
          <ChevronLeft />
          Previous
        </span>
      )}

      <ol className="hidden items-center gap-1 sm:flex">
        {pageWindow(page, totalPages).map((entry, index) =>
          entry === null ? (
            <li key={`gap-${index}`} aria-hidden="true" className="px-1 text-muted-foreground">
              …
            </li>
          ) : (
            <li key={entry}>
              <Link
                href={hrefFor(entry)}
                aria-label={`Page ${entry}`}
                aria-current={entry === page ? 'page' : undefined}
                className={cn(
                  number,
                  entry === page
                    ? 'bg-brand-navy text-brand-soft hover:bg-brand-navy'
                    : 'text-foreground',
                )}
              >
                {entry}
              </Link>
            </li>
          ),
        )}
      </ol>
      <p className="text-sm text-muted-foreground tabular-nums sm:hidden">
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
  );
}
