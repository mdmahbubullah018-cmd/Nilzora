'use client';

import { CatalogError } from '@/components/catalog/catalog-error';

export default function CategoriesError({ retry }: { retry: () => void }) {
  return <CatalogError retry={retry} />;
}
