import type { CatalogSort, ProductSummary } from '@nilzora/contracts';
import { PackageOpen, SearchX } from 'lucide-react-native';
import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View, type ListRenderItem } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import { Button } from '@/components/button';
import { ListScreen } from '@/components/list-screen';
import { Notice } from '@/components/notice';
import { QueryStateView, queryViewState, type EmptyConfig } from '@/components/query-state';
import { describeApiError } from '@/lib/errors';
import { useManualRefresh } from '@/query/use-manual-refresh';
import { theme } from '@/theme';
import { useBrands } from '@/features/brands/brand-hooks';
import {
  useCategories,
  useDepartmentListing,
  useProductFacets,
  useProductFeed,
} from './catalog-hooks';
import { GRID_GAP, useGridCardWidth } from './catalog-layout';
import {
  facetsQuery,
  feedQuery,
  hasActiveFilters,
  productCountLabel,
  type ShopFilters,
} from './catalog-query';
import { ProductGridSkeleton } from './catalog-skeletons';
import { FilterSheet } from './filter-sheet';
import { ListingFilterBar } from './listing-filter-bar';
import { ProductCard } from './product-card';
import { ResultsBar } from './results-bar';

/*
 * The product listing body: the endless two-column grid, its count/sort line, and every
 * state it can be in. Shop and a category page differ only in the header they pass and which
 * filters are fixed, so the fetching, paging and empty/error behaviour live here once.
 */

/** How far from the end of the list (in screens) the next page starts loading. */
const END_REACHED_THRESHOLD = 0.8;

const productKey = (product: ProductSummary) => product.id;

/** "24 products", or "3 results for “rice”" while searching. */
export function resultsSummary(total: number, q: string): string {
  if (q === '') return productCountLabel(total);
  return `${total} ${total === 1 ? 'result' : 'results'} for “${q}”`;
}

export interface CatalogGridProps {
  /** The filters applied to the listing: search text, category, sort and refinements. */
  filters: ShopFilters;
  /** Sorts on offer for these filters (see sortsFor). */
  sorts: readonly CatalogSort[];
  onSortChange: (sort: CatalogSort) => void;
  /**
   * Applies the toolbar's refinements — price, brand, availability — as one updated filter
   * set. Omit on a read-only listing, where the toolbar then offers neither price nor filters.
   */
  onFiltersChange?: (next: ShopFilters) => void;
  /**
   * Clears the search and category filters. Omit on a screen where the category is the
   * page itself, so the empty state never offers to clear it.
   */
  onClearFilters?: () => void;
  /** A category screen fixes its category, so the advanced sheet offers no category choice. */
  showCategoryFilter?: boolean;
  /**
   * A brand's page fixes its brand: the advanced sheet offers no brand choice, and the brand
   * never counts as one of the shopper's own filters (the "nothing here" copy stays honest).
   * The caller keeps it applied through every change it makes.
   */
  fixedBrand?: string;
  /** What to show when nothing is on sale at all, before any filter narrows the list. */
  empty?: EmptyConfig;
  /** Content above the count line: a search field, category chips or a category hero. */
  header?: ReactNode;
  title?: string;
  edges?: readonly Edge[];
  /** Room for the floating tab bar on tab screens. */
  bottomSpace?: number;
  testID?: string;
}

/** The listing plus its count and states. Give it a `header` for the controls above the grid. */
export function CatalogGrid({
  filters,
  sorts,
  onSortChange,
  onFiltersChange,
  onClearFilters,
  showCategoryFilter = true,
  fixedBrand,
  empty,
  header,
  title,
  edges,
  bottomSpace,
  testID,
}: CatalogGridProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Cached reads the Home screen already made: the advanced sheet's two lists.
  const categories = useCategories();
  const brands = useBrands();
  // The listing the API is really asked for: a department also lists its subcategories, and
  // nothing is requested until the category list says whether the chosen category is one.
  const listing = useDepartmentListing(filters, sorts);
  const {
    query: feed,
    items,
    total,
  } = useProductFeed(feedQuery(listing.filters), {
    enabled: listing.ready,
  });
  const { onRefresh } = useManualRefresh(feed.refetch);
  // The sizes and colours the same filters offer, so the toolbar never shows a dead control.
  const facets = useProductFacets(facetsQuery(listing.filters));
  const cardWidth = useGridCardWidth();
  // Typing re-renders the screen on every key; a stable renderItem keeps the cards still.
  const renderItem = useCallback<ListRenderItem<ProductSummary>>(
    ({ item }) => <ProductCard product={item} width={cardWidth} />,
    [cardWidth],
  );

  const view = queryViewState(feed, () => items.length === 0);
  // A fixed brand is the page, not a filter the shopper chose: it never makes the list "filtered".
  const filtered = hasActiveFilters(
    fixedBrand === undefined ? filters : { ...filters, brand: undefined },
  );
  const refreshFailed = feed.isRefetchError && !feed.isFetchNextPageError;

  const loadMore = () => {
    // A failed page waits for "Try again" instead of retrying in a loop while it is in view.
    if (!feed.hasNextPage || feed.isFetching || feed.isFetchNextPageError) return;
    void feed.fetchNextPage();
  };

  let emptyView;
  if (view === 'loading') {
    emptyView = <QueryStateView state="loading" skeleton={<ProductGridSkeleton />} />;
  } else if (view === 'error') {
    emptyView = (
      <QueryStateView
        state="error"
        error={feed.error}
        onRetry={() => void feed.refetch()}
        retrying={feed.isRefetching}
      />
    );
  } else if (view === 'empty') {
    emptyView = (
      <QueryStateView
        state="empty"
        empty={
          filtered
            ? {
                icon: SearchX,
                title:
                  filters.q !== '' ? `No products match “${filters.q}”` : 'No products here yet',
                description:
                  filters.q !== ''
                    ? 'Check the spelling, try a shorter or more general word, or clear your filters.'
                    : 'Nothing here matches these filters. Try a wider price range or fewer options.',
                action:
                  onClearFilters === undefined ? undefined : (
                    <Button label="Clear filters" onPress={onClearFilters} />
                  ),
              }
            : (empty ?? {
                icon: PackageOpen,
                title: 'Products are on their way',
                description: 'New products are being added. Please check back soon.',
              })
        }
      />
    );
  }

  const footer = feed.isFetchNextPageError ? (
    <View style={styles.footer}>
      <Notice tone="warning" title="Could not load more products">
        {describeApiError(feed.error).message}
      </Notice>
      <Button label="Try again" variant="secondary" onPress={() => void feed.fetchNextPage()} />
    </View>
  ) : feed.isFetchingNextPage ? (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading more products"
      style={styles.footer}
    >
      <ActivityIndicator color={theme.colors.link} />
    </View>
  ) : null;

  // The advanced filters actually on: the category (when the screen offers it), the brand and
  // availability. Price has its own chip, and a collection has its own chip above the grid.
  const advancedCount =
    (showCategoryFilter && filters.category !== undefined ? 1 : 0) +
    (fixedBrand !== undefined || filters.brand === undefined ? 0 : 1) +
    (filters.inStock === true ? 1 : 0);

  const listHeader = (
    <View style={styles.header}>
      {header}
      {onFiltersChange === undefined ? null : (
        <ListingFilterBar
          // The listing's effective filters, so the chips state what the grid really shows
          // (a department's search is listed newest first, never by best match).
          filters={listing.filters}
          sorts={listing.sorts}
          facets={facets}
          onSortChange={onSortChange}
          onFiltersChange={onFiltersChange}
          filterCount={advancedCount}
          onOpenFilters={() => {
            setAdvancedOpen(true);
          }}
        />
      )}
      {view === 'loading' || view === 'ready' ? (
        <ResultsBar
          summary={view === 'ready' && total !== null ? resultsSummary(total, filters.q) : null}
        />
      ) : null}
      {refreshFailed ? (
        <Notice tone="warning" title="Could not refresh">
          Showing what was loaded earlier. {describeApiError(feed.error).message}
        </Notice>
      ) : null}
      {onFiltersChange === undefined ? null : (
        <FilterSheet
          visible={advancedOpen}
          onClose={() => {
            setAdvancedOpen(false);
          }}
          categories={categories.data ?? []}
          categoriesLoading={categories.isPending}
          showCategory={showCategoryFilter}
          showBrand={fixedBrand === undefined}
          selectedCategory={filters.category}
          brands={brands.data ?? []}
          brandsLoading={brands.isPending}
          selectedBrand={filters.brand}
          inStock={filters.inStock === true}
          onApply={(draft) => {
            onFiltersChange({ ...filters, ...draft });
          }}
          onReset={() => {
            onFiltersChange({
              ...filters,
              category: showCategoryFilter ? undefined : filters.category,
              brand: undefined,
              inStock: false,
            });
          }}
        />
      )}
    </View>
  );

  return (
    <ListScreen
      testID={testID}
      edges={edges}
      bottomSpace={bottomSpace}
      title={title}
      listHeader={listHeader}
      data={items}
      keyExtractor={productKey}
      renderItem={renderItem}
      numColumns={2}
      columnWrapperStyle={styles.columns}
      ListEmptyComponent={emptyView}
      ListFooterComponent={footer ?? undefined}
      onEndReached={loadMore}
      onEndReachedThreshold={END_REACHED_THRESHOLD}
      onRefresh={onRefresh}
    />
  );
}

const styles = StyleSheet.create({
  header: { gap: theme.spacing[3] },
  columns: { gap: GRID_GAP },
  footer: { gap: theme.spacing[3], paddingVertical: theme.spacing[4], alignItems: 'stretch' },
});
