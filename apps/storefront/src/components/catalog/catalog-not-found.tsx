import { buttonClasses, Card, EmptyState } from '@nilzora/ui';
import { PackageX } from 'lucide-react';
import Link from 'next/link';
import { CatalogPage } from './catalog-page';

/** A missing product or category, shown inside the shop so browsing can continue. */
export function CatalogNotFound({ subject }: { subject: 'product' | 'category' }) {
  return (
    <CatalogPage>
      <Card>
        <EmptyState
          icon={PackageX}
          titleAs="h1"
          title={subject === 'product' ? 'Product not found' : 'Category not found'}
          description={
            subject === 'product'
              ? 'This product is not on sale, or its address has changed.'
              : 'This category does not exist, or its address has changed.'
          }
          className="py-16"
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/products" className={buttonClasses()}>
                Browse all products
              </Link>
              <Link href="/categories" className={buttonClasses({ variant: 'outline' })}>
                See all categories
              </Link>
            </div>
          }
        />
      </Card>
    </CatalogPage>
  );
}
