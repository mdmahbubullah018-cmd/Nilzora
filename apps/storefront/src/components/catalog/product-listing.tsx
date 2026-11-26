import type { ProductListResponse } from '@nilzora/contracts';
import { buttonClasses, Card, EmptyState } from '@nilzora/ui';
import { ListEnd } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { productCountLabel } from './categories';
import { Pagination } from './pagination';
import { ProductGrid, type ProductCardProps, type ProductGridColumns } from './product-card';

const counts = new Intl.NumberFormat('en-IN');

/** "Showing 25–48 of 57 products", or "57 products" when everything fits on one page. */
export function listingSummary({ page, pageSize, total, totalPages }: ProductListResponse): string {
  if (totalPages <= 1) return productCountLabel(total);
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return `Showing ${counts.format(start)}–${counts.format(end)} of ${productCountLabel(total)}`;
}

export interface ProductListingProps {
  listing: ProductListResponse;
  /** Address of another page of this listing, keeping its sort and filters. */
  hrefFor: (page: number) => Route;
  /** Shown instead of the grid when nothing matches. */
  empty: ReactNode;
  /** Sort controls, shown beside the result count. */
  controls?: ReactNode;
  /** The phone and tablet "Filters" button, shown before the sort. */
  filterButton?: ReactNode;
  /** The active filters as removable chips; their presence keeps the toolbar on an empty page. */
  activeFilters?: ReactNode;
  headingLevel?: ProductCardProps['headingLevel'];
  /** `sidebar` when the listing shares the row with the filter panel. */
  columns?: ProductGridColumns;
}

/** A page of products with its count, controls, active filters and pagination. */
export function ProductListing({
  listing,
  hrefFor,
  empty,
  controls,
  filterButton,
  activeFilters,
  headingLevel = 'h2',
  columns = 'wide',
}: ProductListingProps) {
  const toolbar =
    listing.total > 0 || activeFilters ? (
      <div className="grid gap-3">
        <div className="grid gap-2.5 rounded-2xl border border-border/80 bg-surface px-3 py-2.5 shadow-xs sm:flex sm:items-center sm:justify-between sm:gap-3 sm:px-4">
          <p
            className="text-sm font-medium text-foreground tabular-nums"
            role="status"
            aria-live="polite"
          >
            {listingSummary(listing)}
          </p>
          {/* One compact row at every width. A phone scrolls it sideways rather than squeezing
              the chips; from `sm` the whole row fits. The chips' panels are portalled, so the
              row's own scrolling can never clip them. */}
          <div className="-mx-0.5 flex min-w-0 items-center gap-1.5 overflow-x-auto px-0.5 py-1 scrollbar-none sm:flex-wrap sm:overflow-visible">
            <div className="flex shrink-0 items-center gap-1.5">
              {filterButton}
              {listing.total > 0 ? controls : null}
            </div>
          </div>
        </div>
        {activeFilters}
      </div>
    ) : null;

  if (listing.total === 0) {
    return (
      <div className="grid gap-6">
        {toolbar}
        {empty}
      </div>
    );
  }

  // A page number past the end (an old link): offer the last page instead.
  if (listing.items.length === 0) {
    return (
      <div className="grid gap-6">
        {toolbar}
        <Card>
          <EmptyState
            icon={ListEnd}
            title="This page is past the end of the list"
            description={`There ${listing.total === 1 ? 'is' : 'are'} ${productCountLabel(listing.total)} in this listing.`}
            className="py-14"
            action={
              <Link
                href={hrefFor(Math.max(listing.totalPages, 1))}
                className={buttonClasses({ variant: 'outline' })}
              >
                Go to the last page
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      {toolbar}
      <ProductGrid products={listing.items} headingLevel={headingLevel} columns={columns} />
      <Pagination page={listing.page} totalPages={listing.totalPages} hrefFor={hrefFor} />
    </div>
  );
}

/**
 * A listing beside its filter panel: the panel is a sticky sidebar from the large breakpoint,
 * and a sheet behind the toolbar's "Filters" button below it.
 */
export function ListingWithFilters({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start xl:gap-10">
      <aside
        aria-label="Filters"
        className="hidden rounded-2xl border border-border/80 bg-surface p-5 shadow-xs lg:sticky lg:top-28 lg:grid lg:max-h-[calc(100dvh-8rem)] lg:gap-8 lg:overflow-y-auto"
      >
        {sidebar}
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
