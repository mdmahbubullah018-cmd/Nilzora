import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { AppIcon } from '@/components/icon';
import { theme } from '@/theme';
import { ProductReviews } from './product-reviews';
import { useProductReviews } from './review-hooks';
import { StarRow } from './rating-summary';

/*
 * The reviews entry point on the product screen: one compact row under the price. The
 * reviews themselves live in a bottom sheet, so the product stays short. The row and the
 * sheet read the same cached query; the sheet's summary is still the API's own tally.
 */

const RIPPLE = { color: 'rgba(2, 132, 199, 0.14)' } as const;

export interface ProductReviewsSheetProps {
  productId: string;
  slug: string;
  style?: StyleProp<ViewStyle>;
}

export function ProductReviewsSheet({ productId, slug, style }: ProductReviewsSheetProps) {
  const [open, setOpen] = useState(false);
  const feed = useProductReviews(slug);
  const summary = feed.summary;
  const loading = feed.query.data === undefined;
  const rating = summary !== undefined && summary.reviewCount > 0 ? summary : null;
  const count = rating?.reviewCount ?? 0;
  const caption = loading
    ? 'Reviews'
    : rating === null
      ? 'No reviews yet'
      : `${String(count)} ${count === 1 ? 'review' : 'reviews'}`;
  const label =
    rating === null
      ? 'Reviews'
      : `Reviews, ${rating.averageRating.toFixed(1)} out of 5 from ${String(count)} ${count === 1 ? 'review' : 'reviews'}`;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Opens every review of this product"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          setOpen(true);
        }}
        android_ripple={RIPPLE}
        style={({ pressed }) => [styles.trigger, style, pressed ? styles.triggerPressed : null]}
      >
        <View style={styles.summaryRow}>
          {rating !== null ? (
            <StarRow rating={rating.averageRating} />
          ) : (
            <AppIcon name="star" size="sm" color={theme.colors.mutedForeground} />
          )}
          {rating !== null ? (
            <Text style={styles.rating}>{rating.averageRating.toFixed(1)}</Text>
          ) : null}
          <Text style={styles.caption}>{caption}</Text>
        </View>
        <View style={styles.action}>
          <Text style={styles.actionText}>See reviews</Text>
          <AppIcon name="chevronRight" size="sm" color={theme.colors.mutedForeground} />
        </View>
      </Pressable>

      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Reviews"
        testID="reviews-sheet"
      >
        <ProductReviews productId={productId} slug={slug} />
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: theme.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
  },
  triggerPressed: { opacity: 0.72 },
  summaryRow: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing[2],
  },
  rating: {
    color: theme.colors.foreground,
    fontSize: 15,
    fontWeight: theme.fontWeights.semibold,
  },
  caption: { color: theme.colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  actionText: {
    color: theme.colors.link,
    fontSize: 13,
    fontWeight: theme.fontWeights.semibold,
  },
});
