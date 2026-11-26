import type { Brand } from '@nilzora/contracts';
import { useRouter } from 'expo-router';
import { BadgeCheck, SearchX } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { EmptyState } from '@/components/empty-state';
import { ListScreen } from '@/components/list-screen';
import { PressableScale } from '@/components/pressable-scale';
import { QueryStateView, queryViewState } from '@/components/query-state';
import { STACK_EDGES } from '@/components/screen';
import { useManualRefresh } from '@/query/use-manual-refresh';
import { BrandMark, brandHref } from '@/features/brands/brand-components';
import { useBrands } from '@/features/brands/brand-hooks';
import { GRID_GAP, useGridCardWidth } from '@/features/catalog/catalog-layout';
import { shopHref } from '@/features/catalog/catalog-query';
import { SearchField } from '@/features/catalog/search-field';
import { theme } from '@/theme';

/**
 * Every active brand, two to a row, in the order the API returns them. The search box filters
 * the brands already fetched on this device — there is no brand-search endpoint, so it never
 * claims more than the loaded collection.
 */
export default function BrandsScreen() {
  const router = useRouter();
  const query = useBrands();
  const width = useGridCardWidth();
  const { onRefresh } = useManualRefresh(query.refetch);
  const [search, setSearch] = useState('');

  const view = queryViewState(query, (brands) => brands.length === 0);
  const needle = search.trim().toLocaleLowerCase();
  const visible = useMemo(() => {
    const brands = query.data ?? [];
    if (needle === '') return brands;
    return brands.filter((brand) => brand.name.toLocaleLowerCase().includes(needle));
  }, [query.data, needle]);

  let empty;
  if (view === 'loading') {
    empty = <QueryStateView state="loading" />;
  } else if (view === 'error') {
    empty = (
      <QueryStateView
        state="error"
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isRefetching}
      />
    );
  } else if (view === 'empty') {
    empty = (
      <EmptyState
        icon={BadgeCheck}
        title="Brands are on their way"
        description="The brand directory is being prepared. Browse the shop meanwhile."
        action={{
          label: 'Browse products',
          onPress: () => {
            router.navigate(shopHref());
          },
        }}
      />
    );
  } else if (visible.length === 0) {
    empty = (
      <EmptyState
        icon={SearchX}
        title={`No brands match “${search.trim()}”`}
        description="Try a shorter name, or clear the search to see every brand."
        action={{ label: 'Show all brands', onPress: () => setSearch('') }}
      />
    );
  }

  return (
    <ListScreen<Brand>
      testID="brands-list"
      edges={STACK_EDGES}
      listHeader={
        view === 'ready' ? (
          <SearchField
            label="Search brands"
            value={search}
            onChangeText={setSearch}
            onSubmit={() => undefined}
            onClear={() => setSearch('')}
            onVisualSearch={() => {
              router.push('/visual-search');
            }}
          />
        ) : null
      }
      data={view === 'ready' ? visible : []}
      keyExtractor={(brand) => brand.slug}
      numColumns={2}
      columnWrapperStyle={styles.row}
      onRefresh={onRefresh}
      ListEmptyComponent={empty}
      ListFooterComponent={
        view === 'ready' && visible.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Browse every product"
            onPress={() => {
              router.navigate(shopHref());
            }}
            style={styles.footer}
          >
            <Text style={styles.footerText}>Browse every product</Text>
          </Pressable>
        ) : undefined
      }
      renderItem={({ item }) => (
        <PressableScale
          accessibilityLabel={`${item.name}, ${item.productCount} ${
            item.productCount === 1 ? 'product' : 'products'
          }`}
          accessibilityHint="Shows the products from this brand"
          onPress={() => {
            router.push(brandHref(item.slug));
          }}
          style={[styles.tile, { width }]}
        >
          {/* The category card's rhythm — picture area, then the words — with nothing drawn
              around the logo: a brand's mark is artwork, so it is contained, never framed. */}
          <View style={styles.logoPanel}>
            <BrandMark brand={item} band />
          </View>
          <View style={styles.tileText}>
            <Text numberOfLines={2} style={styles.name}>
              {item.name}
            </Text>
            <Text style={styles.count}>
              {item.productCount} {item.productCount === 1 ? 'product' : 'products'}
            </Text>
          </View>
        </PressableScale>
      )}
      ItemSeparatorComponent={() => <View style={styles.gap} />}
    />
  );
}

const styles = StyleSheet.create({
  row: { gap: GRID_GAP },
  gap: { height: GRID_GAP },
  /**
   * One brand in the directory: a proper card like an All Categories tile — its mark inside
   * the card, then the name and the real count beneath it, all within the card's boundary.
   */
  tile: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    gap: theme.spacing[2],
    borderRadius: theme.radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    ...theme.shadow.card,
  },
  /** The logo contained in the card's picture area, with nothing drawn around the mark. */
  logoPanel: {
    width: '100%',
    aspectRatio: 4 / 3,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tileText: { alignItems: 'center', gap: 2 },
  name: {
    color: theme.colors.foreground,
    textAlign: 'center',
    ...theme.text.subheading,
  },
  count: {
    color: theme.colors.mutedForeground,
    textAlign: 'center',
    ...theme.text.caption,
  },
  footer: {
    minHeight: theme.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.spacing[4],
  },
  footerText: { color: theme.colors.link, ...theme.text.bodyStrong },
});
