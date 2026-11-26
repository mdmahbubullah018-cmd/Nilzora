import { buttonClasses, Card, EmptyState, PageHeader } from '@nilzora/ui';
import { LayoutGrid } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/catalog/breadcrumbs';
import { CatalogPage } from '@/components/catalog/catalog-page';
import { CatalogUnavailable } from '@/components/catalog/catalog-states';
import { CategoryDepartments } from '@/components/catalog/categories';
import { getCategories } from '@/lib/catalog';

export const metadata: Metadata = {
  title: 'Categories',
  description: 'Browse Nilzora by category and pay in cash on delivery.',
};

export default async function CategoriesPage() {
  const categories = await getCategories();

  return (
    <CatalogPage>
      <div className="grid gap-4">
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Categories' }]} />
        <PageHeader
          title="Shop by category"
          description="Pick a category to see what is on sale."
          actions={
            <Link href="/products" className={buttonClasses({ variant: 'outline' })}>
              Browse all products
            </Link>
          }
        />
      </div>

      {categories.kind !== 'ok' ? (
        <CatalogUnavailable kind={categories.kind} retryHref="/categories" subject="categories" />
      ) : categories.value.length === 0 ? (
        <Card>
          <EmptyState
            icon={LayoutGrid}
            title="No categories yet"
            description="The catalog is still being arranged. Please check back soon."
            className="py-14"
          />
        </Card>
      ) : (
        <CategoryDepartments categories={categories.value} />
      )}
    </CatalogPage>
  );
}
