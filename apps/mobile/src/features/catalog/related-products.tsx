import type { ProductDetail } from '@nilzora/contracts';
import { useRouter } from 'expo-router';
import { CloudOff } from 'lucide-react-native';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { SectionHeader } from '@/components/section-header';
import { describeApiError } from '@/lib/errors';
import { theme } from '@/theme';
import { GRID_GAP, useRowCardWidth, SCREEN_PADDING } from './catalog-layout';
import { ProductRowSkeleton } from './catalog-skeletons';
import { useRelatedProducts } from './catalog-hooks';
import { shopHref } from './catalog-query';
import { ProductCard } from './product-card';

/**
 * "You may also like" under a product's details: the website's suggestions in the app's own
 * product card. The row is the same card the Home rows use, so a tapped suggestion opens the
 * product screen like any other card. Nothing is drawn when there is nothing to suggest.
 */
export function RelatedProducts({ product }: { product: ProductDetail }) {
  const router = useRouter();
  const related = useRelatedProducts(product);
  const cardWidth = useRowCardWidth();

  if (related.status === 'success' && related.items.length === 0) return null;

  return (
    <View style={[styles.section, styles.divider]}>
      <SectionHeader
        title="You may also like"
        actionLabel="See all"
        actionAccessibilityLabel={`See all products in ${product.category.name}`}
        onActionPress={() => router.navigate(shopHref({ category: product.category.slug }))}
      />
      {related.status === 'pending' ? (
        <ProductRowSkeleton label="Loading recommendations" />
      ) : related.status === 'error' ? (
        <Card>
          <EmptyState
            icon={CloudOff}
            title="We could not load recommendations"
            description={describeApiError(related.error).message}
          />
          <View style={styles.retry}>
            <Button
              label="Try again"
              loading={related.isRefetching}
              onPress={() => related.refetch()}
            />
          </View>
        </Card>
      ) : (
        <ScrollView
          testID="related-products-row"
          horizontal
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={cardWidth + GRID_GAP}
          snapToAlignment="start"
          style={styles.bleed}
          contentContainerStyle={styles.bleedContent}
          accessibilityLabel="You may also like"
        >
          {related.items.map((item) => (
            <ProductCard key={item.id} product={item} width={cardWidth} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: theme.layout.sectionHeaderGap },
  /** The suggestions are their own band, not another paragraph of the product's own details. */
  divider: {
    paddingTop: theme.spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  retry: { paddingHorizontal: theme.spacing[5], paddingBottom: theme.spacing[4] },
  bleed: { marginHorizontal: -SCREEN_PADDING, flexGrow: 0 },
  bleedContent: { gap: GRID_GAP, paddingHorizontal: SCREEN_PADDING, paddingVertical: 2 },
});
