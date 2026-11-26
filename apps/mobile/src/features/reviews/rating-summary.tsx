import type { RatingSummary } from '@nilzora/contracts';
import { StyleSheet, Text, View } from 'react-native';
import { AppIcon } from '@/components/icon';
import { theme } from '@/theme';

/*
 * Rating display. Stars are drawn from the number the API sent, never recomputed here.
 * The row is one accessibility element with a spoken label ("4.5 out of 5 stars"), so a
 * screen reader reads a rating once instead of five times.
 */

/** The amber used for stars. It is a decoration, so it is not a text-contrast role. */
const STAR_COLOR = theme.brand.warning;

export interface StarRowProps {
  rating: number;
  /** `sm` inside a review, `md` for the summary. */
  size?: 'sm' | 'md';
}

export function StarRow({ rating, size = 'sm' }: StarRowProps) {
  const rounded = Math.round(rating);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${rating.toFixed(1)} out of 5 stars`}
      style={styles.row}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <AppIcon
          key={star}
          name="star"
          color={star <= rounded ? STAR_COLOR : theme.colors.borderStrong}
          filled={star <= rounded}
          size={size === 'md' ? 'md' : 'sm'}
        />
      ))}
    </View>
  );
}

/** One bar of the distribution: "5 ★" then a filled track and the count. */
function DistributionRow({
  star,
  count,
  share,
}: {
  star: number;
  count: number;
  /** 0…1 of the reviews that carry this rating. */
  share: number;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${String(count)} ${count === 1 ? 'review' : 'reviews'} gave ${String(star)} ${star === 1 ? 'star' : 'stars'}`}
      style={styles.distributionRow}
    >
      <Text aria-hidden style={styles.distributionLabel}>
        {star} ★
      </Text>
      <View aria-hidden style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(share * 100)}%` }]} />
      </View>
      <Text aria-hidden style={styles.distributionCount}>
        {count}
      </Text>
    </View>
  );
}

export interface RatingSummaryProps {
  summary: RatingSummary;
}

/** "4.5 from 12 reviews" plus how the stars are spread. */
export function RatingSummaryView({ summary }: RatingSummaryProps) {
  const total = summary.reviewCount;
  return (
    <View style={styles.summary}>
      <View style={styles.summaryHead}>
        <Text style={styles.average}>{summary.averageRating.toFixed(1)}</Text>
        <View style={styles.summaryText}>
          <StarRow rating={summary.averageRating} size="md" />
          <Text style={styles.summaryCaption}>
            {total} {total === 1 ? 'review' : 'reviews'}
          </Text>
        </View>
      </View>
      <View style={styles.distribution}>
        {[5, 4, 3, 2, 1].map((star) => {
          const count =
            summary.distribution[String(star) as keyof typeof summary.distribution] ?? 0;
          return (
            <DistributionRow
              key={star}
              star={star}
              count={count}
              share={total === 0 ? 0 : count / total}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  summary: { gap: theme.spacing[4] },
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[4] },
  average: {
    color: theme.colors.foreground,
    fontSize: 40,
    lineHeight: 44,
    fontWeight: theme.fontWeights.semibold,
  },
  summaryText: { gap: theme.spacing[1] },
  summaryCaption: { color: theme.colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  distribution: { gap: theme.spacing[1] },
  distributionRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  distributionLabel: {
    width: 28,
    color: theme.colors.mutedForeground,
    fontSize: 12,
    lineHeight: 16,
  },
  track: {
    flex: 1,
    height: 6,
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.surfaceMuted,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: theme.radii.full, backgroundColor: STAR_COLOR },
  distributionCount: {
    minWidth: 24,
    textAlign: 'right',
    color: theme.colors.mutedForeground,
    fontSize: 12,
    lineHeight: 16,
  },
});
