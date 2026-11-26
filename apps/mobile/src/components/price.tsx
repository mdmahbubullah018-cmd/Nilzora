import { StyleSheet, Text, View } from 'react-native';
import { formatMoney, savingPercent, spokenMoney } from '@/lib/money';
import { theme } from '@/theme';

const sizes = {
  sm: { price: 15, former: 12, badge: 11 },
  md: { price: 18, former: 14, badge: 12 },
  lg: { price: 28, former: 16, badge: 13 },
} as const;

export interface PriceProps {
  priceMinor: number;
  /** The former price; shown struck through only when it is higher than `priceMinor`. */
  compareAtPriceMinor?: number | null;
  size?: keyof typeof sizes;
  /** Also show the offer badge ("Save 18%"). */
  showSaving?: boolean;
}

/**
 * A selling price from the API, with the former price struck through when higher. The whole
 * price is one accessible element read as "Price 1,250 taka, was 1,500 taka, save 17 percent".
 */
export function Price({
  priceMinor,
  compareAtPriceMinor = null,
  size = 'md',
  showSaving = false,
}: PriceProps) {
  const saving = savingPercent(priceMinor, compareAtPriceMinor);
  const former = saving !== null && compareAtPriceMinor !== null ? compareAtPriceMinor : null;
  const dimensions = sizes[size];

  const spoken = [
    `Price ${spokenMoney(priceMinor)}`,
    former !== null ? `was ${spokenMoney(former)}` : null,
    saving !== null && showSaving ? `save ${saving} percent` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View accessible accessibilityLabel={spoken} style={styles.row}>
      <Text style={[styles.price, { fontSize: dimensions.price }]}>{formatMoney(priceMinor)}</Text>
      {former !== null ? (
        <Text style={[styles.former, { fontSize: dimensions.former }]}>{formatMoney(former)}</Text>
      ) : null}
      {showSaving && saving !== null ? (
        <View style={styles.badge}>
          <Text style={[styles.badgeText, { fontSize: dimensions.badge }]}>Save {saving}%</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: theme.spacing[2] },
  price: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeights.semibold,
    fontVariant: ['tabular-nums'],
  },
  former: {
    color: theme.colors.mutedForeground,
    textDecorationLine: 'line-through',
    fontVariant: ['tabular-nums'],
  },
  badge: {
    alignSelf: 'center',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.offerBadge,
  },
  badgeText: {
    color: theme.colors.offerBadgeForeground,
    fontWeight: theme.fontWeights.semibold,
  },
});
