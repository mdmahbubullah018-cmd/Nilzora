import type { Category, DiscoveryRating, DiscoverySection } from '@nilzora/contracts';
import { Card, EmptyState, PageHeader } from '@nilzora/ui';
import { Search, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/catalog/breadcrumbs';
import { CatalogPage } from '@/components/catalog/catalog-page';
import { CategoryNav, childCategories } from '@/components/catalog/categories';
import { FilteredListing } from '@/components/catalog/filtered-listing';
import { SearchField } from '@/components/layout/search-field';
import { ProductRail } from '@/components/marketing/featured-products';
import {
  getBrands,
  getCategories,
  getDiscovery,
  getProductFacets,
  searchProducts,
} from '@/lib/catalog';
import { NEW_ARRIVALS_HREF } from '@/lib/navigation';
import {
  FILTERED_SEARCH_SORTS,
  hasActiveFilters,
  parseSearchQuery,
  SEARCH_SORTS,
  type ListingFilters,
  type SearchSort,
} from '@/lib/catalog-query';

export async function generateMetadata({ searchParams }: PageProps<'/search'>): Promise<Metadata> {
  const { q } = parseSearchQuery(await searchParams);
  return {
    // React escapes the text; it is only ever shown as text.
    title: q ? `Search results for “${q}”` : 'Search',
    robots: { index: false, follow: true },
  };
}

/**
 * What the page shows before a search: the sections the API could rank with real evidence,
 * one compact rail each, then the category shortcuts. The heading doubles as the page's own
 * prompt, so the customer always knows what to do next.
 */
function Discovery({ sections }: { sections: readonly DiscoverySection[] }) {
  if (sections.length === 0) return null;
  return (
    <div className="grid gap-8">
      <div className="grid gap-1.5">
        <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
          What are you looking for?
        </h2>
        <p className="text-sm text-muted-foreground">
          Type a product name, or start with what shoppers are buying, saving and rating at Nilzora.
        </p>
      </div>
      {sections.map((section) => {
        const ratings = new Map<string, DiscoveryRating>();
        for (const item of section.items) {
          if (item.rating !== null) ratings.set(item.product.id, item.rating);
        }
        return (
          <section
            key={section.key}
            aria-labelledby={`discovery-${section.key}`}
            className="grid gap-4"
          >
            <h2
              id={`discovery-${section.key}`}
              className="font-display text-lg font-semibold tracking-tight text-foreground sm:text-xl"
            >
              {section.title}
            </h2>
            <ProductRail products={section.items.map((item) => item.product)} ratings={ratings} />
            {/* Kept on the left, clear of the desktop chat launcher in the opposite corner. */}
            {section.key === 'new' ? (
              <Link
                href={NEW_ARRIVALS_HREF}
                className="inline-flex min-h-9 items-center justify-self-start text-sm font-semibold text-primary underline-offset-4 hover:underline"
              >
                See all new arrivals
              </Link>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function Suggestions({ categories }: { categories: readonly Category[] }) {
  const departments = categories.filter((category) => category.parentSlug === null);
  if (departments.length === 0) return null;
  return (
    <div className="grid gap-3">
      <h2 className="text-sm font-semibold text-foreground">Or browse a category</h2>
      <CategoryNav categories={departments} />
    </div>
  );
}

export default async function SearchPage({ searchParams }: PageProps<'/search'>) {
  const { q, category, sort, page, filters } = parseSearchQuery(await searchParams);
  const [categories, brands, discovery] = await Promise.all([
    getCategories(),
    getBrands(),
    // Only the blank page shows discovery; a real search never pays for it.
    q ? Promise.resolve(null) : getDiscovery(),
  ]);
  const discoverySections = discovery?.kind === 'ok' ? discovery.value.sections : ([] as const);
  const categoryList = categories.kind === 'ok' ? categories.value : [];
  const inCategory = categoryList.find((entry) => entry.slug === category);
  // Only a category the visitor can see narrows the search; any other one is dropped.
  const filter = categories.kind === 'ok' ? inCategory?.slug : category;
  // A department covers its subcategories, as browsing it does.
  const branch =
    inCategory !== undefined && childCategories(categoryList, inCategory.slug).length > 0;
  // Ranking by relevance needs the plain search: a narrowed one is listed newest first.
  const narrowedBy = (next: ListingFilters) => hasActiveFilters(next) || branch;
  const sorts: readonly SearchSort[] = narrowedBy(filters) ? FILTERED_SEARCH_SORTS : SEARCH_SORTS;
  const shownSort: SearchSort = sorts.includes(sort) ? sort : 'newest';
  const defaultSortFor = (next: ListingFilters): SearchSort =>
    narrowedBy(next) ? 'newest' : 'relevance';

  // Blank text searches nothing: the page asks what to look for instead.
  const [result, facets] = await Promise.all([
    q
      ? searchProducts({
          q,
          category: filter,
          includeSubcategories: branch,
          sort: shownSort,
          page,
          filters,
        })
      : Promise.resolve(null),
    // The sizes and colours that match the same search, so the chips never offer a dead end.
    getProductFacets({ category: filter, includeSubcategories: branch, filters }),
  ]);

  return (
    <CatalogPage>
      <div className="grid gap-5">
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Search' }]} />
        <PageHeader
          title={
            q ? (
              <>
                Results for <q className="wrap-anywhere">{q}</q>
              </>
            ) : (
              'Search the catalog'
            )
          }
          description={inCategory ? `In ${inCategory.name}` : undefined}
        />
        {/* A new search starts with its own text, even after the back button. */}
        <SearchField
          key={q}
          id="search-page"
          variant="page"
          defaultValue={q}
          className="max-w-2xl"
        />
      </div>

      {result === null ? (
        <div className="grid gap-8">
          {discoverySections.length > 0 ? (
            <Discovery sections={discoverySections} />
          ) : (
            // No evidence to rank, or a store still being filled: say what to do instead of
            // showing an empty grid.
            <Card>
              <EmptyState
                icon={Search}
                title="What are you looking for?"
                description="Search by product name or a word from its description, such as “rice” or “cotton”."
                className="py-14"
              />
            </Card>
          )}
          <Suggestions categories={categoryList} />
        </div>
      ) : (
        <FilteredListing
          path="/search"
          result={result}
          page={page}
          sort={shownSort}
          sorts={sorts}
          filters={filters}
          defaultSortFor={defaultSortFor}
          sortAfter={(next) =>
            // A sort the visitor chose is kept while it still applies; the default follows
            // the filters (ranked again once nothing narrows the search).
            shownSort !== defaultSortFor(filters) &&
            (narrowedBy(next) ? FILTERED_SEARCH_SORTS : SEARCH_SORTS).some(
              (option) => option === shownSort,
            )
              ? shownSort
              : defaultSortFor(next)
          }
          q={q}
          searchCategories={
            categoryList.length > 0 ? { options: categoryList, selected: inCategory } : undefined
          }
          brands={brands.kind === 'ok' ? brands.value : undefined}
          facets={facets}
          subject="search results"
          empty={
            <div className="grid gap-8">
              <Card>
                <EmptyState
                  icon={SearchX}
                  title={
                    <>
                      No products match <q className="wrap-anywhere">{q}</q>
                    </>
                  }
                  description="Check the spelling, try a shorter or more general word, or browse a category below."
                  className="py-14"
                />
              </Card>
              <Suggestions categories={categoryList} />
            </div>
          }
        />
      )}
    </CatalogPage>
  );
}
