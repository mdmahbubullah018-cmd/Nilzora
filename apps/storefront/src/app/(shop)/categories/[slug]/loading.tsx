import { ListingSkeleton } from '@/components/catalog/catalog-skeletons';

/** Shown straight away while a category and its products are fetched. */
export default function CategoryLoading() {
  return <ListingSkeleton label="Loading category" />;
}
