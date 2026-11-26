import { ListingSkeleton } from '@/components/catalog/catalog-skeletons';

/** Shown straight away while the product listing is fetched, shaped like the listing itself. */
export default function ProductsLoading() {
  return <ListingSkeleton label="Loading products" />;
}
