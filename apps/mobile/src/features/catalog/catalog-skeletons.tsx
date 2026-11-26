import { StyleSheet, View } from 'react-native';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { theme } from '@/theme';
import { GRID_GAP, useGridCardWidth, useRowCardWidth } from './catalog-layout';

/*
 * Placeholders shaped like what is loading, so the screen does not jump when data arrives.
 * Each is ONE accessible "Loading …" element (see SkeletonGroup).
 */

const CARD_PAD = 8;

function CardSkeleton({ width }: { width: number }) {
  return (
    <View style={[styles.card, { width }]}>
      <Skeleton
        width={width - CARD_PAD * 2}
        height={width - CARD_PAD * 2}
        radius={theme.radii.md}
      />
      <View style={styles.cardText}>
        <Skeleton width="45%" height={11} />
        <Skeleton width="90%" height={14} />
        <Skeleton width="60%" height={14} />
        <Skeleton width="40%" height={16} />
      </View>
    </View>
  );
}

/** The Shop grid while its first page loads. */
export function ProductGridSkeleton({ label = 'Loading products' }: { label?: string }) {
  const width = useGridCardWidth();
  return (
    <SkeletonGroup label={label}>
      {[0, 1, 2].map((row) => (
        <View key={row} style={styles.gridRow}>
          <CardSkeleton width={width} />
          <CardSkeleton width={width} />
        </View>
      ))}
    </SkeletonGroup>
  );
}

/** A Home row while it loads. */
export function ProductRowSkeleton({ label }: { label: string }) {
  const cardWidth = useRowCardWidth();
  return (
    <SkeletonGroup label={label}>
      <View style={styles.row}>
        <CardSkeleton width={cardWidth} />
        <CardSkeleton width={cardWidth} />
        <CardSkeleton width={cardWidth} />
      </View>
    </SkeletonGroup>
  );
}

/** Home's banner area while its placement loads, shaped like the carousel it becomes. */
export function HeroBannerSkeleton() {
  return (
    <SkeletonGroup label="Loading promotions">
      <Skeleton height={168} radius={24} />
    </SkeletonGroup>
  );
}

export function CategoryRowSkeleton() {
  return (
    <SkeletonGroup label="Loading categories">
      <View style={styles.row}>
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} width={112} height={116} radius={theme.radii.lg} />
        ))}
      </View>
    </SkeletonGroup>
  );
}

export function CategoryChipsSkeleton() {
  return (
    <SkeletonGroup label="Loading categories">
      <View style={styles.row}>
        {[48, 88, 76, 96, 72].map((width, index) => (
          <Skeleton key={index} width={width} height={40} radius={theme.radii.full} />
        ))}
      </View>
    </SkeletonGroup>
  );
}

/** The product screen while the product loads. */
export function ProductDetailSkeleton() {
  return (
    <SkeletonGroup label="Loading product" style={styles.detail}>
      <Skeleton height={280} radius={theme.radii.xl} />
      <View style={styles.detailText}>
        <Skeleton width="30%" height={14} />
        <Skeleton width="85%" height={26} />
        <Skeleton width="50%" height={26} />
        <Skeleton width="35%" height={32} />
        <Skeleton width="28%" height={24} radius={theme.radii.full} />
      </View>
      <Skeleton height={88} radius={theme.radii.lg} />
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: CARD_PAD,
    gap: theme.spacing[3],
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  cardText: { gap: theme.spacing[2], paddingHorizontal: theme.spacing[1] },
  gridRow: { flexDirection: 'row', gap: GRID_GAP },
  row: { flexDirection: 'row', gap: GRID_GAP },
  detail: { gap: theme.spacing[5] },
  detailText: { gap: theme.spacing[3] },
});
