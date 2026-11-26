import type { Brand, CatalogSort, Category, ProductFacets, ProductListResponse } from '@nilzora/contracts';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import { hasActiveFilters, listingHref, type ListingFilters } from '@/lib/catalog-query';
import type { CatalogRead } from '@/lib/catalog';
import { ActiveFilters, clearFiltersHref, filterChips, type ChipSource } from './active-filters';
import { CatalogUnavailable, NoFilteredResults } from './catalog-states';
import { FilterSheet } from './filter-sheet';
import { CategoryFilterLinks, ListingFiltersForm } from './listing-filters';
import { ListingToolbar } from './listing-toolbar';
import { ListingWithFilters, ProductListing } from './product-listing';

/*
 * One listing with everything around it: the filter panel (sidebar from the large breakpoint,
 * a sheet below it), the sort, the active filters as chips, the grid and pagination. All
 * product listings use it, so they look and behave the same; each page only says what it lists.
 */

export interface FilteredListingProps {
  /** The listing's own address. */
  path: Route;
  /** The API's answer for this page of the listing. */
  result: CatalogRead<ProductListResponse>;
  page: number;
  sort: CatalogSort;
  sorts: readonly CatalogSort[];
  filters: ListingFilters;
  /** The listing's default sort for a set of filters (search ranks only unfiltered results). */
  defaultSortFor: (filters: ListingFilters) => CatalogSort;
  /** The sort to use once the filters change, when the current one no longer applies. */
  sortAfter?: (filters: ListingFilters) => CatalogSort;
  /** Search only: the text, and its category filter. */
  q?: string;
  searchCategories?: { options: readonly Category[]; selected: Category | undefined };
  /** The collection being browsed, with its name, so the listing can show and drop it. */
  zone?: { slug: string; name: string } | undefined;
  /**
   * What the listing actually lists, for the size and colour options: the category branch a
   * category page shows, or the brand it belongs to. Read apart from `filters` because these
   * are the page itself, not a filter on it.
   */
  facets: ProductFacets;
  /** Browsing only: the category tree as links, with the one on screen marked. */
  categoryLinks?: { categories: readonly Category[]; current: string };
  /** Brands for the brand filter; left out on a brand's own page. */
  brands?: readonly Brand[];
  /** What could not be loaded, for the outage notice. */
  subject: string;
  /** Shown when the listing is empty without any filter. */
  empty: ReactNode;
}

export function FilteredListing({
  path,
  result,
  page,
  sort,
  sorts,
  filters,
  defaultSortFor,
  sortAfter,
  q,
  searchCategories,
  categoryLinks,
  brands,
  zone,
  facets,
  subject,
  empty,
}: FilteredListingProps) {
  const category = searchCategories?.selected;
  const defaultSort = defaultSortFor(filters);
  const chipSource: ChipSource = {
    path,
    filters,
    sort,
    defaultSortFor,
    sortAfter,
    q,
    category: category ? { slug: category.slug, name: category.name } : undefined,
    zone,
    brandName: brands?.find((brand) => brand.slug === filters.brand)?.name,
    facetLabels: {
      sizes: Object.fromEntries(facets.sizes.map((entry) => [entry.slug, entry.value])),
      colors: Object.fromEntries(facets.colors.map((entry) => [entry.slug, entry.value])),
    },
  };
  const activeCount = filterChips(chipSource).length;
  const hrefFor = (target: number) =>
    listingHref(
      path,
      { q, category: category?.slug, zone: zone?.slug, sort, page: target, filters },
      defaultSort,
    );

  const panel = (idPrefix: string) => (
    <div className="grid gap-8">
      {categoryLinks ? (
        <CategoryFilterLinks
          categories={categoryLinks.categories}
          current={categoryLinks.current}
          filters={filters}
          sort={sort}
        />
      ) : null}
      <ListingFiltersForm
        action={path}
        filters={filters}
        sort={sort}
        defaultSort={defaultSort}
        q={q}
        zone={zone?.slug}
        brands={brands}
        searchCategories={
          searchCategories
            ? { options: searchCategories.options, selected: category?.slug }
            : undefined
        }
        idPrefix={idPrefix}
      />
    </div>
  );

  return (
    <ListingWithFilters sidebar={panel('filters-sidebar')}>
      {result.kind === 'ok' ? (
        <ProductListing
          listing={result.value}
          hrefFor={hrefFor}
          columns="sidebar"
          filterButton={
            <FilterSheet activeCount={activeCount}>{panel('filters-sheet')}</FilterSheet>
          }
          activeFilters={activeCount > 0 ? <ActiveFilters source={chipSource} /> : undefined}
          controls={
            <ListingToolbar
              path={path}
              sorts={sorts}
              sort={sort}
              defaultSort={defaultSort}
              q={q}
              category={category?.slug}
              zone={zone?.slug}
              filters={filters}
              facets={facets}
            />
          }
          empty={
            hasActiveFilters(filters) || category ? (
              <NoFilteredResults clearHref={clearFiltersHref(chipSource)} />
            ) : (
              empty
            )
          }
        />
      ) : (
        <CatalogUnavailable kind={result.kind} retryHref={hrefFor(page)} subject={subject} />
      )}
    </ListingWithFilters>
  );
}
