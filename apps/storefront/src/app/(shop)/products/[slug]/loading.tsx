import { Skeleton } from '@nilzora/ui';
import { CatalogPage } from '@/components/catalog/catalog-page';

/**
 * Shown straight away while a product is fetched: the same two-column frame as the page (the
 * gallery square beside the name, price, options and button), so nothing jumps when it arrives.
 * The blocks are decorative; one status line tells assistive technology what is loading.
 */
export default function ProductLoading() {
  return (
    <CatalogPage className="lg:pr-16">
      <p role="status" className="sr-only">
        Loading product
      </p>
      <div aria-hidden="true" className="flex items-center gap-2">
        <Skeleton className="h-4 w-14" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-28" />
      </div>
      <div aria-hidden="true" className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        <div className="mx-auto grid w-full max-w-md gap-3 self-start lg:max-w-none">
          <Skeleton className="aspect-square w-full rounded-2xl" />
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="aspect-square w-full rounded-xl" />
            ))}
          </div>
        </div>
        <div className="grid content-start gap-6 self-start">
          <div className="grid gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-4/5" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/5" />
          </div>
          <Skeleton className="h-8 w-40" />
          <div className="grid gap-3">
            <Skeleton className="h-4 w-20" />
            <div className="flex gap-2">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-11 w-16 rounded-full" />
              ))}
            </div>
          </div>
          <Skeleton className="h-12 w-full rounded-full" />
        </div>
      </div>
    </CatalogPage>
  );
}
