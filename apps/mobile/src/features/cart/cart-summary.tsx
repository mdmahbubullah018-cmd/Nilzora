import type { CartQuote } from '@nilzora/contracts';
import { Banknote, Truck } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { formatMoney, itemCountLabel, spokenMoney } from '@/lib/money';
import { theme } from '@/theme';
import { SummaryRow } from './summary-row';

export interface CartSummaryProps {
  quote: CartQuote;
  /** The quote describes an older cart and is being refreshed. */
  updating: boolean;
  /** Units in the lines the customer selected; these are what will be ordered. */
  selectedUnits: number;
  /** The server's line totals for those selected lines, added up. */
  selectedSubtotalMinor: number;
  /** Why checkout is unavailable, in words; null when it is available. */
  blockedReason: string | null;
  onCheckout: () => void;
}

/**
 * The selected lines' subtotal (a sum of the server's own line totals), the way on to checkout,
 * and why it may be closed. Deselected lines stay in the cart and are simply not in this figure.
 */
export function CartSummary({
  quote,
  updating,
  selectedUnits,
  selectedSubtotalMinor,
  blockedReason,
  onCheckout,
}: CartSummaryProps) {
  const totalLines = quote.lines.length;
  return (
    <Card style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>
        Order summary
      </Text>
      {updating ? (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Updating prices"
          accessibilityLiveRegion="polite"
          style={styles.updating}
        >
          <ActivityIndicator size="small" color={theme.colors.link} />
          <Text style={styles.updatingText}>Updating prices…</Text>
        </View>
      ) : null}
      <View style={updating ? styles.stale : null}>
        <SummaryRow
          label={`Subtotal (${itemCountLabel(selectedUnits)})`}
          value={formatMoney(selectedSubtotalMinor)}
          spokenValue={spokenMoney(selectedSubtotalMinor)}
        />
        {selectedUnits === 0 && totalLines > 0 ? (
          <Text style={styles.noneSelected}>
            Nothing selected yet — choose the items you want to order.
          </Text>
        ) : null}
      </View>
      <View style={styles.note}>
        <Truck size={16} color={theme.colors.mutedForeground} accessible={false} />
        <Text style={styles.noteText}>Delivery charge is calculated at checkout</Text>
      </View>

      <Button label="Checkout" disabled={blockedReason !== null} onPress={onCheckout} />
      {blockedReason && !updating ? (
        <Text accessibilityLiveRegion="polite" style={styles.reason}>
          {blockedReason}
        </Text>
      ) : null}

      <View style={[styles.note, styles.cod]}>
        <Banknote size={16} color={theme.colors.link} accessible={false} />
        <Text style={styles.noteText}>Cash on delivery — pay when your parcel arrives</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: theme.spacing[4], gap: theme.spacing[4] },
  title: { color: theme.colors.foreground, fontSize: 18, fontWeight: theme.fontWeights.semibold },
  updating: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  updatingText: { color: theme.colors.mutedForeground, fontSize: 13 },
  stale: { opacity: 0.55 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing[2] },
  noteText: { flex: 1, color: theme.colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  reason: { color: theme.notice.danger.foreground, fontSize: 14, lineHeight: 20 },
  noneSelected: { color: theme.colors.mutedForeground, fontSize: 13, lineHeight: 18, marginTop: 2 },
  cod: {
    paddingTop: theme.spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
});
