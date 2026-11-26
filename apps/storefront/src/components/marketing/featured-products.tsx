import type { DiscoveryRating, ProductSummary } from '@nilzora/contracts';
import { ProductCard } from '@/components/catalog/product-card';

/**
 * A row of products: a snap-scrolling rail on phones and tablets, a five-column grid from `lg`.
 * The products are passed in; this never pads the row with anything that did not load.
 */
export function ProductRail({
  products,
  ratings,
}: {
  products: readonly ProductSummary[];
  /** Approved-review evidence by product id, when the caller has it (discovery). */
  ratings?: ReadonlyMap<string, DiscoveryRating>;
}) {
  if (products.length === 0) return null;
  return (
    <ul
      role="list"
      className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 scrollbar-none sm:-mx-6 sm:scroll-px-6 sm:gap-4 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-5 lg:gap-6 lg:overflow-visible lg:px-0 lg:pb-0"
    >
      {products.map((product) => (
        <li
          key={product.id}
          className="w-[44%] min-w-38 shrink-0 snap-start sm:w-[30%] lg:w-auto lg:min-w-0"
        >
          <ProductCard product={product} rating={ratings?.get(product.id) ?? null} />
        </li>
      ))}
    </ul>
  );
}
