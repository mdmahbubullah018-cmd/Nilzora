import { cn, Skeleton } from '@nilzora/ui';
import { CatalogPage } from './catalog-page';

/*
 * Loading placeholders shaped like what replaces them — the same grid, the same square
 * pictures, the same sidebar — so nothing jumps when the content arrives. They are
 * decorative; one status line tells assistive technology what is loading.
 */

/** Announced once while the page loads; the skeleton blocks themselves are decorative. */
function LoadingStatus({ label }: { label: string }) {
  return (
    <p role="status" className="sr-only">
      {label}
    </p>
  );
}

/** A product card's outline: square picture, label, two-line name, price and button. */
function CardSkeleton() {
  return (
    <div className="grid gap-3">
      <Skeleton className="aspect-square w-full rounded-2xl" />
      <div className="grid gap-2 px-0.5">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-5 w-2/5" />
      </div>
      <Skeleton className="h-10 w-full rounded-full" />
    </div>
  );
}

export function ProductGridSkeleton({
  count = 8,
  columns = 'wide',
}: {
  count?: number;
  columns?: 'wide' | 'sidebar';
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3',
        columns === 'wide' ? 'lg:grid-cols-4 lg:gap-x-6' : 'xl:grid-cols-4 xl:gap-x-6',
      )}
    >
      {Array.from({ length: count }, (_, index) => (
        <CardSkeleton key={index} />
      ))}
    </div>
  );
}

function FilterPanelSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="hidden gap-6 rounded-2xl border border-border/80 bg-surface p-5 lg:grid"
    >
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="grid gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
      <Skeleton className="h-10 w-full rounded-full" />
    </div>
  );
}

/** A listing page while it loads: header, filter sidebar, toolbar and a product grid. */
export function ListingSkeleton({ label = 'Loading products' }: { label?: string }) {
  return (
    <CatalogPage>
      <LoadingStatus label={label} />
      <div aria-hidden="true" className="grid gap-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)] xl:gap-10">
        <FilterPanelSkeleton />
        <div className="grid min-w-0 content-start gap-6">
          <div aria-hidden="true" className="flex items-center justify-between gap-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-10 w-48 rounded-full" />
          </div>
          <ProductGridSkeleton columns="sidebar" />
        </div>
      </div>
    </CatalogPage>
  );
}
