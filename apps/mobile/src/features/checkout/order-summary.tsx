import type { CheckoutQuote } from '@nilzora/contracts';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { SectionHeader } from '@/components/section-header';
import { DELIVERY_ZONE_LABELS } from '@/features/addresses/address-format';
import { SummaryRow } from '@/features/cart/summary-row';
import { formatMoney, itemCountLabel, spokenMoney } from '@/lib/money';
import { theme } from '@/theme';
import { PolicyNotice } from '@/components/policy-notice';
import { PlaceOrderButton } from './place-order-button';

export interface OrderSummaryProps {
  quote: CheckoutQuote;
  /** The prices are being refreshed: shown for reference, not to be confirmed. */
  updating: boolean;
  /** Refreshing the prices failed, so the ones shown may be out of date. */
  priceError: boolean;
  retryingPrices: boolean;
  onRetryPrices: () => void;
  /** The total the customer can confirm now; null while it cannot be confirmed. */
  confirmableTotalMinor: number | null;
  placing: boolean;
  /** Why "Place order" is unavailable, in words; null when it is available. */
  blockedReason: string | null;
  onPlaceOrder: () => void;
}

/**
 * Subtotal, delivery charge (with its zone) and total, all from the API's checkout quote,
 * then the "Place order" button that shows the exact total it confirms. The API compares
 * that total with the price at the moment of ordering and refuses a different one.
 */
export function OrderSummary({
  quote,
  updating,
  priceError,
  retryingPrices,
  onRetryPrices,
  confirmableTotalMinor,
  placing,
  blockedReason,
  onPlaceOrder,
}: OrderSummaryProps) {
  const zone = quote.deliveryZone === null ? null : DELIVERY_ZONE_LABELS[quote.deliveryZone];
  return (
    <View style={styles.section}>
      <SectionHeader title="Order summary" />
      <Card style={styles.card}>
        {updating ? (
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Updating prices"
            accessibilityLiveRegion="polite"
            style={styles.updating}
          >
            <ActivityIndicator size="small" color={theme.colors.link} />
            <Text style={styles.updatingText}>Updating…</Text>
          </View>
        ) : null}
        <View style={[styles.rows, updating ? styles.rowsUpdating : null]}>
          <SummaryRow
            label={`Subtotal (${itemCountLabel(quote.itemCount)})`}
            value={formatMoney(quote.subtotalMinor)}
            spokenValue={spokenMoney(quote.subtotalMinor)}
          />
          <SummaryRow
            label={zone === null ? 'Delivery' : `Delivery (${zone})`}
            value={
              quote.shippingFeeMinor === null
                ? 'Not available'
                : formatMoney(quote.shippingFeeMinor)
            }
            spokenValue={
              quote.shippingFeeMinor === null
                ? 'not available'
                : spokenMoney(quote.shippingFeeMinor)
            }
          />
          {quote.discountMinor > 0 ? (
            <SummaryRow
              label={
                quote.coupon === null
                  ? 'Coupon'
                  : quote.coupon.kind === 'free_delivery'
                    ? `Free delivery (${quote.coupon.code})`
                    : `Coupon (${quote.coupon.code})`
              }
              value={`−${formatMoney(quote.discountMinor)}`}
              spokenValue={`minus ${spokenMoney(quote.discountMinor)}`}
            />
          ) : null}
          {quote.couponProblem !== null ? (
            <Text accessibilityLiveRegion="polite" style={styles.couponProblem}>
              {quote.couponProblem}
            </Text>
          ) : null}
          {quote.totalMinor !== null ? (
            <SummaryRow
              label="Total"
              value={formatMoney(quote.totalMinor)}
              spokenValue={spokenMoney(quote.totalMinor)}
              total
            />
          ) : null}
        </View>
      </Card>

      {priceError ? (
        <Button
          label="Try again"
          variant="secondary"
          loading={retryingPrices}
          accessibilityHint="Updates the prices for your order"
          onPress={onRetryPrices}
        />
      ) : null}
      <PlaceOrderButton
        totalMinor={confirmableTotalMinor}
        loading={placing}
        disabled={blockedReason !== null}
        onPress={onPlaceOrder}
      />
      <PolicyNotice
        lead="By placing this order you agree to the"
        links={[
          {
            label: 'Terms of service',
            href: '/terms',
            after: ', including paying in cash on delivery, and the ',
          },
          { label: 'Returns and refunds policy', href: '/returns-policy', after: '.' },
        ]}
      />
      {blockedReason ? (
        <Text accessibilityLiveRegion="polite" style={styles.reason}>
          {blockedReason}
        </Text>
      ) : placing ? (
        <Text accessibilityLiveRegion="polite" style={styles.caption}>
          Placing your order. Please wait.
        </Text>
      ) : confirmableTotalMinor !== null ? (
        <Text style={styles.caption}>
          You pay {formatMoney(confirmableTotalMinor)} in cash when your order is delivered.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: theme.spacing[3] },
  card: { padding: theme.spacing[4], gap: theme.spacing[3] },
  rows: { gap: theme.spacing[3] },
  rowsUpdating: { opacity: 0.55 },
  couponProblem: {
    color: theme.colors.warning,
    fontSize: 13,
    lineHeight: 18,
  },
  updating: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  updatingText: { color: theme.colors.mutedForeground, fontSize: 13 },
  reason: {
    color: theme.colors.mutedForeground,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  caption: {
    color: theme.colors.mutedForeground,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});
