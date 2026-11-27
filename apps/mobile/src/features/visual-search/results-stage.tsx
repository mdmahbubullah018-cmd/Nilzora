import type { ImageSearchResponse, ImageSearchSort } from '@nilzora/contracts';
import { ArrowLeft, Camera, ImageOff, Search, Sparkles, X } from 'lucide-react-native';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ProductCard } from '@/features/catalog/product-card';
import { theme } from '@/theme';

/*
 * Results
 * -------
 * The photograph the customer chose stays on screen while the answers arrive, because it is
 * the only explanation the screen needs: these are the products that look like this. Sorting,
 * paging and the cards themselves are the catalogue's own, so a result is indistinguishable
 * from the same product found by typing its name.
 */

export interface ResultsStageProps {
  status: 'searching' | 'ready' | 'error';
  result: ImageSearchResponse | null;
  error: string | null;
  retryable: boolean;
  /** The picture being searched with (a local file, or the product's own picture). */
  preview: string | null;
  /** True when a product's picture seeded the search ("Find similar"). */
  seeded: boolean;
  /** That product's name, shown in place of the count while the seeded search runs. */
  seedName?: string | undefined;
  sort: ImageSearchSort;
  cardWidth: number;
  onSort: (sort: ImageSearchSort) => void;
  onPage: (page: number) => void;
  onRetake: () => void;
  onClose: () => void;
  onRetry: () => void;
  onBrowse: () => void;
}

export function ResultsStage({
  status,
  result,
  error,
  retryable,
  preview,
  seeded,
  seedName,
  sort,
  cardWidth,
  onSort,
  onPage,
  onRetake,
  onClose,
  onRetry,
  onBrowse,
}: ResultsStageProps) {
  const total = result?.total ?? 0;
  const items = result?.items ?? [];
  const priceAscending = sort === 'price_asc';

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to the camera"
            onPress={onRetake}
            hitSlop={8}
            style={styles.round}
          >
            <ArrowLeft size={22} color={theme.colors.foreground} />
          </Pressable>
          <View style={styles.query}>
            {preview === null ? (
              <View style={[styles.preview, styles.previewEmpty]}>
                <Sparkles size={20} color={theme.colors.primary} />
              </View>
            ) : (
              <Image source={{ uri: preview }} style={styles.preview} />
            )}
            <View style={styles.queryText}>
              <Text style={styles.title} numberOfLines={1}>
                {seeded ? 'Similar products' : 'Visual search'}
              </Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {seeded && seedName !== undefined
                  ? seedName
                  : status === 'searching'
                    ? 'Looking for matches…'
                    : status === 'error'
                      ? 'No answer yet'
                      : total === 0
                        ? 'Nothing matched'
                        : total === 1
                          ? '1 product looks like this'
                          : `${total} products look like this`}
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close image search"
            onPress={onClose}
            hitSlop={8}
            style={styles.round}
          >
            <X size={22} color={theme.colors.mutedForeground} />
          </Pressable>
        </View>

        <View style={styles.sortRow}>
          <Chip
            label="Best match"
            selected={sort === 'best_match'}
            onPress={() => onSort('best_match')}
          />
          <Chip
            label={priceAscending ? 'Price: low to high' : 'Price: high to low'}
            selected={sort !== 'best_match'}
            onPress={() => onSort(priceAscending ? 'price_desc' : 'price_asc')}
          />
          <View style={styles.sortSpacer} />
          {status === 'ready' && total > 0 ? (
            <Text style={styles.count}>
              {total} {total === 1 ? 'item' : 'items'}
            </Text>
          ) : null}
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {status === 'searching' ? <SkeletonGrid cardWidth={cardWidth} /> : null}

        {status === 'error' ? (
          <View style={styles.panel}>
            <View style={styles.panelIcon}>
              <ImageOff size={22} color={theme.colors.primary} />
            </View>
            <Text style={styles.panelTitle}>Could not search</Text>
            <Text style={styles.panelBody}>{error ?? 'Check your connection and try again.'}</Text>
            <View style={styles.panelActions}>
              {retryable ? <Button label="Try again" onPress={onRetry} /> : null}
              <Button label="New photo" variant="secondary" onPress={onRetake} />
            </View>
          </View>
        ) : null}

        {status === 'ready' && items.length === 0 ? (
          <View style={styles.panel}>
            <View style={styles.panelIcon}>
              <Search size={22} color={theme.colors.primary} />
            </View>
            <Text style={styles.panelTitle}>
              {seeded ? 'Nothing similar yet' : 'No products matched'}
            </Text>
            <Text style={styles.panelBody}>
              {seeded
                ? 'No other product in the collection looks like this one yet.'
                : 'Try again with the product filling the frame, a plain background and good light.'}
            </Text>
            <View style={styles.panelActions}>
              <Button label="Browse products" onPress={onBrowse} />
              <Button label="Search with a photo" variant="secondary" onPress={onRetake} />
            </View>
          </View>
        ) : null}

        {status === 'ready' && items.length > 0 ? (
          <View style={styles.grid}>
            {items.map((item) => (
              <ProductCard key={item.product.id} product={item.product} width={cardWidth} />
            ))}
          </View>
        ) : null}

        {result !== null && result.totalPages > 1 ? (
          <View style={styles.pager}>
            <Button
              label="Previous"
              variant="secondary"
              disabled={result.page <= 1}
              onPress={() => onPage(result.page - 1)}
            />
            <Text style={styles.pagerText}>
              {(result.page - 1) * result.pageSize + 1}–
              {Math.min(result.page * result.pageSize, result.total)} of {result.total}
            </Text>
            <Button
              label="Next"
              variant="secondary"
              disabled={result.page >= result.totalPages}
              onPress={() => onPage(result.page + 1)}
            />
          </View>
        ) : null}
      </ScrollView>

      {items.length > 0 ? (
        <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search with another photo"
            onPress={onRetake}
            style={styles.newPhoto}
          >
            <Camera size={18} color={theme.brand.onSolid} accessible={false} />
            <Text style={styles.newPhotoText}>New photo</Text>
          </Pressable>
        </SafeAreaView>
      ) : null}
    </View>
  );
}

function SkeletonGrid({ cardWidth }: { cardWidth: number }) {
  return (
    <View style={styles.grid} accessibilityRole="progressbar" accessibilityLabel="Searching">
      {[0, 1, 2, 3].map((index) => (
        <View key={index} style={{ width: cardWidth }}>
          <View style={[styles.skeletonImage, { width: cardWidth, height: cardWidth }]} />
          <View style={[styles.skeletonLine, { width: cardWidth * 0.6 }]} />
          <View style={[styles.skeletonLine, { width: cardWidth * 0.4 }]} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surfaceMuted },
  headerSafe: { backgroundColor: theme.colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  round: {
    width: theme.touchTarget,
    height: theme.touchTarget,
    borderRadius: theme.touchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  query: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  preview: {
    width: 44,
    height: 44,
    borderRadius: theme.radii.input,
    backgroundColor: theme.colors.iconSurface,
  },
  previewEmpty: { alignItems: 'center', justifyContent: 'center' },
  queryText: { flex: 1 },
  title: { color: theme.colors.foreground, fontSize: 16, fontWeight: theme.fontWeights.semibold },
  subtitle: { color: theme.colors.mutedForeground, fontSize: 12 },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[3],
  },
  sortSpacer: { flex: 1 },
  count: { color: theme.colors.mutedForeground, fontSize: 12 },
  body: { padding: theme.spacing[4], paddingBottom: theme.spacing[8], gap: theme.spacing[4] },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: theme.spacing[4],
  },
  panel: { alignItems: 'center', gap: theme.spacing[3], paddingVertical: theme.spacing[8] },
  panelIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.iconSurface,
  },
  panelTitle: {
    color: theme.colors.foreground,
    fontSize: 18,
    fontWeight: theme.fontWeights.semibold,
  },
  panelBody: {
    color: theme.colors.mutedForeground,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 300,
  },
  panelActions: {
    flexDirection: 'row',
    gap: theme.spacing[2],
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
    paddingTop: theme.spacing[2],
  },
  pagerText: { color: theme.colors.mutedForeground, fontSize: 12 },
  bottomBar: {
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  newPhoto: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    minHeight: 48,
    margin: theme.spacing[3],
    borderRadius: theme.radii.full,
    backgroundColor: theme.brand.primary,
  },
  newPhotoText: {
    color: theme.brand.onSolid,
    fontSize: 15,
    fontWeight: theme.fontWeights.semibold,
  },
  skeletonImage: { borderRadius: theme.radii.card, backgroundColor: theme.colors.surfaceMuted },
  skeletonLine: {
    height: 10,
    marginTop: theme.spacing[2],
    borderRadius: 5,
    backgroundColor: theme.colors.surfaceMuted,
  },
});
