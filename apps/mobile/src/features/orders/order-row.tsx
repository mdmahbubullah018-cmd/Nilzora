import type { OrderSummary } from '@nilzora/contracts';
import { ChevronRight } from 'lucide-react-native';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDate } from '@/lib/dates';
import { formatMoney, itemCountLabel } from '@/lib/money';
import { theme } from '@/theme';
import { CartLineThumb } from '@/features/cart/cart-line-thumb';
import { orderRowLabel, paymentSummary } from './status';
import { OrderStatusPill } from './status-pill';

export interface OrderRowProps {
  order: OrderSummary;
  onPress: (orderNumber: string) => void;
}

/** How many line pictures a row shows before it stops (the count still says the rest). */
const PREVIEW_LINES = 3;

/**
 * One order in the history. The whole card is one accessible button read as a sentence
 * ("Order NZ100042, Awaiting confirmation, placed 5 January 2026, 3 items, total …"), so a
 * screen-reader user swipes once per order instead of through every fragment. The pictures
 * and names are inside that one element: the order is recognised by what is in the parcel.
 */
export const OrderRow = memo(function OrderRow({ order, onPress }: OrderRowProps) {
  const lines = order.preview.slice(0, PREVIEW_LINES);
  const [first] = lines;
  const summary =
    lines.length === 0
      ? null
      : lines.length === 1 && first !== undefined
        ? `${String(first.quantity)} × ${first.productName}`
        : lines.map((line) => line.productName).join(', ');

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={orderRowLabel(order)}
      accessibilityHint="Opens the order"
      android_ripple={{ color: theme.colors.border }}
      onPress={() => onPress(order.orderNumber)}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <View style={styles.top}>
        <Text style={styles.number}>{order.orderNumber}</Text>
        <OrderStatusPill status={order.status} />
      </View>
      {summary === null ? null : (
        <View style={styles.preview}>
          <View style={styles.thumbs}>
            {lines.map((line, index) => (
              <View key={`${line.productName}-${String(index)}`} style={styles.thumb}>
                <CartLineThumb image={line.image} size={44} />
              </View>
            ))}
          </View>
          <View style={styles.previewText}>
            <Text numberOfLines={2} style={styles.previewName}>
              {summary}
            </Text>
            {first?.variantLabel ? (
              <Text numberOfLines={1} style={styles.muted}>
                {first.variantLabel}
              </Text>
            ) : null}
          </View>
        </View>
      )}
      <Text style={styles.meta}>
        {formatDate(order.placedAt)} · {itemCountLabel(order.itemCount)}
      </Text>
      <View style={styles.divider} />
      <View style={styles.bottom}>
        <Text style={styles.payment}>{paymentSummary(order.paymentStatus)}</Text>
        <View style={styles.total}>
          <Text style={styles.totalText}>{formatMoney(order.totalMinor)}</Text>
          <ChevronRight size={18} color={theme.colors.mutedForeground} accessible={false} />
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    gap: theme.spacing[2],
    padding: theme.spacing[4],
    minHeight: theme.touchTarget,
    borderRadius: theme.radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
  },
  pressed: { backgroundColor: theme.colors.surfaceMuted },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[3],
  },
  number: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: 16,
    fontWeight: theme.fontWeights.semibold,
    fontVariant: ['tabular-nums'],
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    paddingTop: theme.spacing[1],
  },
  thumbs: { flexDirection: 'row', alignItems: 'center' },
  /** Overlapping squares, each ringed in the card's own white. */
  thumb: { marginLeft: -10, borderRadius: theme.radii.md },
  previewText: { flex: 1, minWidth: 0, gap: 1 },
  previewName: {
    color: theme.colors.foreground,
    fontSize: 14,
    fontWeight: theme.fontWeights.medium,
  },
  muted: { color: theme.colors.mutedForeground, fontSize: 12 },
  meta: { color: theme.colors.mutedForeground, fontSize: 14 },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: theme.spacing[1],
    backgroundColor: theme.colors.border,
  },
  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[3],
  },
  payment: { flex: 1, color: theme.colors.body, fontSize: 13 },
  total: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  totalText: {
    color: theme.colors.foreground,
    fontSize: 17,
    fontWeight: theme.fontWeights.semibold,
    fontVariant: ['tabular-nums'],
  },
});
