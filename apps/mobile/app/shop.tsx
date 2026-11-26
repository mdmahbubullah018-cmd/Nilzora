import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Keyboard, StyleSheet, View, type TextInputInstance } from 'react-native';
import { STACK_EDGES } from '@/components/screen';
import { CatalogGrid } from '@/features/catalog/catalog-grid';
import { useCategories, useShoppingZones } from '@/features/catalog/catalog-hooks';
import { CategoryChipsSkeleton } from '@/features/catalog/catalog-skeletons';
import { CategoryChips } from '@/features/catalog/category-chips';
import { ZoneChip } from '@/features/catalog/zone-chip';
import { RecentSearches } from '@/features/catalog/recent-searches-list';
import { SearchField } from '@/features/catalog/search-field';
import { useRecentSearches } from '@/features/catalog/use-recent-searches';
import { useShopFilters } from '@/features/catalog/use-shop-filters';
import { theme } from '@/theme';

/**
 * The Shop screen: the search field and the category chips above the shared grid, whose
 * toolbar carries the sort, the price range and the advanced filters. Everything those set is
 * an address parameter, so the listing, the back button and a deep link all agree.
 */
export default function ShopScreen() {
  const router = useRouter();
  const controls = useShopFilters();
  const { filters } = controls;
  const inputRef = useRef<TextInputInstance>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const categories = useCategories();
  const recents = useRecentSearches();
  const rememberSearch = recents.remember;
  // Read for the chip's name: the listing itself is filtered by the API, not here.
  const zones = useShoppingZones();
  const zone =
    filters.zone === undefined
      ? undefined
      : zones.data?.find((entry) => entry.slug === filters.zone);

  // Only committed searches are remembered, never each keystroke.
  useEffect(() => {
    if (filters.q !== '') rememberSearch(filters.q);
  }, [filters.q, rememberSearch]);

  const chips =
    categories.status === 'pending' ? (
      <CategoryChipsSkeleton />
    ) : categories.isError && filters.category === undefined ? null : (
      <CategoryChips
        categories={categories.data ?? []}
        selected={filters.category}
        onSelect={controls.setCategory}
      />
    );

  // While the field is focused and empty, the device-local history takes the chips' place.
  const showRecents = searchFocused && controls.draft.trim() === '' && recents.queries.length > 0;

  return (
    <CatalogGrid
      testID="shop-list"
      edges={STACK_EDGES}
      filters={filters}
      sorts={controls.sorts}
      onSortChange={controls.setSort}
      onFiltersChange={controls.setFilters}
      onClearFilters={controls.clearAll}
      header={
        <View style={styles.controls}>
          {zone ? (
            <ZoneChip
              zone={zone}
              onRemove={() => {
                controls.setZone(undefined);
              }}
            />
          ) : null}
          <View style={styles.searchRow}>
            <View style={styles.searchField}>
              <SearchField
                ref={inputRef}
                value={controls.draft}
                onChangeText={controls.setDraft}
                onSubmit={controls.submitSearch}
                onClear={controls.clearSearch}
                onVisualSearch={() => {
                  Keyboard.dismiss();
                  router.push('/visual-search');
                }}
                onFocus={() => {
                  setSearchFocused(true);
                }}
                onBlur={() => {
                  setSearchFocused(false);
                }}
              />
            </View>
          </View>
          {showRecents ? (
            <RecentSearches
              queries={recents.queries}
              onSelect={(query) => {
                controls.search(query);
                Keyboard.dismiss();
                setSearchFocused(false);
              }}
              onClear={recents.clear}
            />
          ) : (
            chips
          )}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  controls: { gap: theme.spacing[3] },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  searchField: { flex: 1 },
});
