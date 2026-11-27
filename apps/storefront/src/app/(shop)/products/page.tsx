import { buttonClasses, Card, EmptyState, PageHeader } from '@nilzora/ui';
import { PackageOpen } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/catalog/breadcrumbs';
import { CatalogPage } from '@/components/catalog/catalog-page';
import { CategoryNav } from '@/components/catalog/categories';
import { FilteredListing } from '@/components/catalog/filtered-listing';
import {
  findShoppingZone,
  getBrands,
  getCategories,
  getProductFacets,
  listProducts,
} from '@/lib/catalog';
import { BROWSE_SORTS, parseBrowseQuery } from '@/lib/catalog-query';

/**
 * The title and description follow the collection when the address names one, so a shared
 * link to "Men's" reads as Men's rather than as the whole catalogue.
 */
export async function generateMetadata({
  searchParams,
}: PageProps<'/products'>): Promise<Metadata> {
  const { zone } = parseBrowseQuery(await searchParams);
  if (zone === undefined) {
    return {
      title: 'All products',
      description: 'Browse everything on sale at Nilzora and pay in cash on delivery.',
      alternates: { canonical: '/products' },
    };
  }
  const found = await findShoppingZone(zone);
  // An unknown or hidden collection is a 404; say nothing about it.
  if (found === null) return { title: 'Collection not found', robots: { index: false } };
  return {
    title: found.name,
    description:
      found.description ??
      `Shop the ${found.name} collection at Nilzora, with cash on delivery across Bangladesh.`,
    alternates: { canonical: `/products?zone=${found.slug}` },
    openGraph: { title: found.name, images: found.banner ? [found.banner.url] : undefined },
  };
}

export default async function ProductsPage({ searchParams }: PageProps<'/products'>) {
  const { sort, page, filters, zone } = parseBrowseQuery(await searchParams);
  // A collection that does not exist (or is hidden) is not a listing to browse.
  const collection = zone === undefined ? null : await findShoppingZone(zone);
  if (zone !== undefined && collection === null) notFound();

  const [categories, brands, result, facets] = await Promise.all([
    getCategories(),
    getBrands(),
    listProducts({ sort, page, filters, zone: collection?.slug }),
    getProductFacets({ zone: collection?.slug, filters }),
  ]);
  const categoryList = categories.kind === 'ok' ? categories.value : [];
  const departments = categoryList.filter((category) => category.parentSlug === null);

  return (
    <CatalogPage>
      <div className="grid gap-4">
        <Breadcrumbs
          items={
            collection
              ? [
                  { label: 'Home', href: '/' },
                  { label: 'All products', href: '/products' },
                  { label: collection.name },
                ]
              : [{ label: 'Home', href: '/' }, { label: 'All products' }]
          }
        />
        <PageHeader
          title={collection ? collection.name : 'All products'}
          description={
            collection
              ? (collection.description ??
                `Everything in the ${collection.name} collection, with cash on delivery across Bangladesh.`)
              : 'Everything on sale at Nilzora. Prices are in taka, and you pay in cash on delivery.'
          }
        />
        {departments.length > 0 ? (
          // Phones and tablets: departments as quick links (the sidebar lists them on desktop).
          <div className="lg:hidden">
            <CategoryNav categories={departments} current="all" />
          </div>
        ) : null}
      </div>

      <FilteredListing
        path="/products"
        result={result}
        page={page}
        sort={sort}
        sorts={BROWSE_SORTS}
        filters={filters}
        defaultSortFor={() => 'featured'}
        categoryLinks={{ categories: categoryList, current: 'all' }}
        brands={brands.kind === 'ok' ? brands.value : undefined}
        zone={collection ? { slug: collection.slug, name: collection.name } : undefined}
        facets={facets}
        subject={collection ? collection.name : 'products'}
        empty={
          collection ? (
            <Card>
              <EmptyState
                icon={PackageOpen}
                title={`Nothing in ${collection.name} yet`}
                description="This collection is being filled. Everything else in the store is still here."
                className="py-14"
                action={
                  <Link href="/products" className={buttonClasses({ variant: 'outline' })}>
                    Browse all products
                  </Link>
                }
              />
            </Card>
          ) : (
            <Card>
              <EmptyState
                icon={PackageOpen}
                title="No products yet"
                description="New products are on their way. Please check back soon."
                className="py-14"
                action={
                  <Link href="/" className={buttonClasses({ variant: 'outline' })}>
                    Back to the home page
                  </Link>
                }
              />
            </Card>
          )
        }
      />
    </CatalogPage>
  );
}
