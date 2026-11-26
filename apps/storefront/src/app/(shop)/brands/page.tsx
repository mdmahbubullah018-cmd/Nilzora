import { buttonClasses, Card, EmptyState, PageHeader } from '@nilzora/ui';
import { BadgeCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/catalog/breadcrumbs';
import { CatalogPage } from '@/components/catalog/catalog-page';
import { CatalogUnavailable } from '@/components/catalog/catalog-states';
import { BrandGrid } from '@/components/merchandising';
import { getBrands } from '@/lib/catalog';

export const metadata: Metadata = {
  title: 'Brands',
  description: 'Shop by brand at Nilzora and pay in cash on delivery.',
};

export default async function BrandsPage() {
  const brands = await getBrands();
  return (
    <CatalogPage>
      <div className="grid gap-4">
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Brands' }]} />
        <PageHeader
          title="Shop by brand"
          description="The labels and makers in the Nilzora catalog, from A to Z."
        />
      </div>
      {brands.kind !== 'ok' ? (
        <CatalogUnavailable kind={brands.kind} retryHref="/brands" subject="brands" />
      ) : brands.value.length === 0 ? (
        <Card className="border-dashed shadow-none">
          <EmptyState
            icon={BadgeCheck}
            title="Brands are on their way"
            description="The brand directory is being prepared. In the meantime, browse the full catalog."
            className="py-16"
            action={
              <Link href="/products" className={buttonClasses({ variant: 'outline' })}>
                Browse all products
              </Link>
            }
          />
        </Card>
      ) : (
        <BrandGrid brands={brands.value} />
      )}
    </CatalogPage>
  );
}
