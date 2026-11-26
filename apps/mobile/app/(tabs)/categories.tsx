import type { Category } from '@nilzora/contracts';
import { useRouter } from 'expo-router';
import { SearchX } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CartButton } from '@/components/cart-button';
import { EmptyState } from '@/components/empty-state';
import { ListScreen } from '@/components/list-screen';
import { PressableScale } from '@/components/pressable-scale';
import { QueryStateView, queryViewState } from '@/components/query-state';
import { ScreenHeader } from '@/components/screen-header';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { TAB_BAR_SPACE } from '@/components/tab-bar';
import { icons } from '@/components/icon';
import { useManualRefresh } from '@/query/use-manual-refresh';
import { useCategories } from '@/features/catalog/catalog-hooks';
import { GRID_GAP, useGridCardWidth } from '@/features/catalog/catalog-layout';
import {
  branchProductCount,
  categoryHref,
  departmentsOf,
  productCountLabel,
  subcategoryCount,
} from '@/features/catalog/catalog-query';
import { CategoryCover } from '@/features/catalog/category-cover';
import { SearchField } from '@/features/catalog/search-field';
import { theme } from '@/theme';

/**
 * The Categories tab: the top-level categories the API publishes, two to a row, each saying how
 * many subcategories it has. A category opens its own page, which lists its subcategories.
 *
 * The header is the same shape as the brand directory's — a way back on the left, the title,
 * the cart on the right — with a search field under it that narrows the departments on this
 * device (there is no category-search endpoint, so it never claims more than the loaded list).
 * A department stays in when it or one of its subcategories matches, so searching "kids" still
 * shows the department that holds it.
 */
export default function CategoriesScreen() {
  const router = useRouter();
  const query = useCategories();
  const { onRefresh } = useManualRefresh(query.refetch);
  const width = useGridCardWidth();
  const [search, setSearch] = useState('');
  const view = queryViewState(query, (categories) => categories.length === 0);
  const all = useMemo(() => query.data ?? [], [query.data]);
  const departments = useMemo(() => departmentsOf(all), [all]);

  const needle = search.trim().toLocaleLowerCase();
  const visible = useMemo(() => {
    if (needle === '') return departments;
    return departments.filter(
      (department) =>
        department.name.toLocaleLowerCase().includes(needle) ||
        all.some(
          (category) =>
            category.parentSlug === department.slug &&
            category.name.toLocaleLowerCase().includes(needle),
        ),
    );
  }, [all, departments, needle]);

  const open = (category: Category) => {
    router.navigate(categoryHref(category.slug));
  };

  /** A tab has no navigation bar of its own: pop the history, or fall back to Home. */
  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/');
  }, [router]);

  const header = (
    <View style={styles.header}>
      <ScreenHeader title="Categories" onBack={goBack} right={<CartButton />} />
      {view === 'ready' ? (
        <SearchField
          label="Search categories"
          value={search}
          onChangeText={setSearch}
          onSubmit={() => undefined}
          onClear={() => setSearch('')}
          onVisualSearch={() => {
            router.push('/visual-search');
          }}
        />
      ) : null}
    </View>
  );

  if (view !== 'ready') {
    return (
      <ListScreen<Category>
        // A different key remounts the list when it gains columns: React Native refuses to
        // change numColumns on a live FlatList.
        key="categories-state"
        edges={['top']}
        bottomSpace={TAB_BAR_SPACE}
        header={header}
        data={[]}
        renderItem={() => null}
        onRefresh={onRefresh}
        ListEmptyComponent={
          view === 'loading' ? (
            <CategoryGridSkeleton width={width} />
          ) : view === 'empty' ? (
            <EmptyState
              icon={icons.categories}
              title="Categories are on their way"
              description="The catalog is being set up. Browse the shop meanwhile."
            />
          ) : (
            <QueryStateView
              state="error"
              error={query.error}
              onRetry={() => void query.refetch()}
              retrying={query.isRefetching}
            />
          )
        }
      />
    );
  }

  return (
    <ListScreen<Category>
      key="categories-grid"
      testID="categories-list"
      edges={['top']}
      bottomSpace={TAB_BAR_SPACE}
      header={header}
      data={visible}
      keyExtractor={(category) => category.slug}
      numColumns={2}
      columnWrapperStyle={styles.row}
      ListFooterComponent={<View style={styles.footerGap} />}
      onRefresh={onRefresh}
      ListEmptyComponent={
        <EmptyState
          icon={SearchX}
          title={`No categories match “${search.trim()}”`}
          description="Try a shorter word, or clear the search to see every category."
          action={{ label: 'Show all categories', onPress: () => setSearch('') }}
        />
      }
      renderItem={({ item }) => {
        const count = productCountLabel(branchProductCount(item));
        const subs = subcategoryCount(all, item.slug);
        const subLabel =
          subs > 0 ? `${subs} ${subs === 1 ? 'subcategory' : 'subcategories'}` : null;
        return (
          <PressableScale
            accessibilityLabel={`${item.name}, ${count}${subLabel ? `, ${subLabel}` : ''}`}
            accessibilityHint={
              subs > 0
                ? 'Shows its subcategories and products'
                : 'Shows the products in this category'
            }
            onPress={() => {
              open(item);
            }}
            style={[styles.tile, { width }]}
          >
            <CategoryCover category={item} testID="category-tile-cover" style={styles.cover} />
            <View style={styles.tileText}>
              <Text numberOfLines={2} style={styles.name}>
                {item.name}
              </Text>
              <Text style={styles.count}>{count}</Text>
              {subLabel ? <Text style={styles.sub}>{subLabel}</Text> : null}
            </View>
          </PressableScale>
        );
      }}
      ItemSeparatorComponent={() => <View style={{ height: GRID_GAP }} />}
    />
  );
}

/** Placeholder tiles shaped like the real ones: a cover, then two lines of text. */
function CategoryGridSkeleton({ width }: { width: number }) {
  const height = Math.round((width - theme.spacing[3] * 2) * (3 / 4)) + 74;
  return (
    <SkeletonGroup label="Loading categories">
      <View style={styles.row}>
        <Skeleton width={width} height={height} radius={theme.radii.card} />
        <Skeleton width={width} height={height} radius={theme.radii.card} />
      </View>
      <View style={styles.row}>
        <Skeleton width={width} height={height} radius={theme.radii.card} />
        <Skeleton width={width} height={height} radius={theme.radii.card} />
      </View>
      <View style={styles.row}>
        <Skeleton width={width} height={height} radius={theme.radii.card} />
        <Skeleton width={width} height={height} radius={theme.radii.card} />
      </View>
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  header: { gap: theme.spacing[2] },
  row: { gap: GRID_GAP },
  footerGap: { height: theme.spacing[2] },
  tile: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    gap: theme.spacing[3],
    borderRadius: theme.radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    ...theme.shadow.card,
  },
  cover: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: theme.radii.input,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  tileText: { gap: theme.spacing[1] },
  name: { ...theme.text.subheading, color: theme.colors.foreground },
  count: { ...theme.text.caption, color: theme.colors.mutedForeground },
  sub: { ...theme.text.caption, color: theme.colors.primary },
});
