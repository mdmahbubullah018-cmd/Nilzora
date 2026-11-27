import type { OrderDetail } from '@nilzora/contracts';
import { receiptFileName, receiptMoney, receiptShareText, receiptText } from '@nilzora/contracts';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { Banknote, Receipt as ReceiptIcon } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Share, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Logo } from '@/components/logo';
import { Notice } from '@/components/notice';
import { QueryState } from '@/components/query-state';
import { Screen, STACK_EDGES } from '@/components/screen';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { addressLines, formatBdPhone, PAYMENT_STATUS_DESCRIPTIONS } from '@/features/orders/status';
import { OrderStatusPill, PaymentStatusPill } from '@/features/orders/status-pill';
import { isNotFound, useOrder } from '@/features/orders/use-order';
import { formatDateTime } from '@/lib/dates';
import { formatMoney, itemCountLabel, spokenMoney } from '@/lib/money';
import { useAuthorizedApi, useManualRefresh } from '@/query';
import { theme } from '@/theme';
import { CAN_SAVE_RECEIPT, saveReceiptPdf } from './save-receipt';

/*
 * The order receipt
 * -----------------
 * A paper document, not another order page: one narrow sheet with the Nilzora lockup, the
 * order's own reference and date, what was bought (name, variant, quantity, unit price, line
 * total), the money exactly as the order saved it, and how it is paid. Every figure comes
 * from the order; nothing is recalculated here.
 *
 * The reveal is one restrained motion — the sheet rising while it fades in — and it is
 * skipped entirely when the phone asks for reduced motion, so the receipt is complete the
 * moment it renders either way.
 */

const PAPER = theme.brand.onSolid;

function useReveal(): Animated.Value {
  // Created once, in state, so the value is not read from a ref during render.
  const [value] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (cancelled) return;
        if (reduced) {
          value.setValue(1);
          return;
        }
        Animated.timing(value, {
          toValue: 1,
          duration: 460,
          useNativeDriver: true,
        }).start();
      })
      .catch(() => {
        // A platform that cannot answer must not hide the receipt behind an animation.
        value.setValue(1);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);
  return value;
}

function Divider() {
  return <View style={styles.divider} />;
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <View style={styles.metaValue}>{children}</View>
    </View>
  );
}

function MetaText({ children }: { children: string }) {
  return <Text style={styles.metaText}>{children}</Text>;
}

function TotalRow({
  label,
  children,
  total = false,
}: {
  label: string;
  children: string;
  total?: boolean;
}) {
  return (
    <View style={[styles.totalRow, total ? styles.totalRowFinal : null]}>
      <Text style={total ? styles.totalLabelFinal : styles.totalLabel}>{label}</Text>
      <Text style={total ? styles.totalAmountFinal : styles.totalAmount}>{children}</Text>
    </View>
  );
}

/** What the customer still owes, worded to match the payment status the server returned. */
function paymentNote(order: OrderDetail): string {
  if (order.paymentStatus === 'collected') return 'Paid in cash when this order was delivered.';
  if (order.paymentStatus === 'cancelled') return 'Nothing was charged: this order was cancelled.';
  return `Nothing has been paid yet. Pay ${formatMoney(order.totalMinor)} in cash when your parcel arrives.`;
}

function ReceiptPaper({ order }: { order: OrderDetail }) {
  const address = order.shippingAddress;
  const reveal = useReveal();
  const money = receiptMoney(order);
  return (
    <Animated.View
      style={[
        styles.paper,
        {
          opacity: reveal,
          transform: [
            { translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
          ],
        },
      ]}
    >
      <View style={styles.paperHeader}>
        <Logo size="sm" />
        <Text style={styles.receiptWord}>RECEIPT</Text>
      </View>
      <View>
        <Text accessibilityRole="header" style={styles.orderNumber}>
          Order {order.orderNumber}
        </Text>
        <Text style={styles.placedAt}>Placed {formatDateTime(order.placedAt)}</Text>
      </View>

      <Divider />

      <View style={styles.meta}>
        <MetaRow label="Order status">
          <OrderStatusPill status={order.status} />
        </MetaRow>
        <MetaRow label="Payment">
          <View style={styles.paymentLine}>
            <Banknote size={14} color={theme.colors.mutedForeground} accessible={false} />
            <Text style={styles.metaText}>Cash on Delivery</Text>
          </View>
        </MetaRow>
        <MetaRow label="Payment status">
          <PaymentStatusPill status={order.paymentStatus} />
        </MetaRow>
        <MetaRow label="Deliver to">
          <MetaText>{address.recipientName}</MetaText>
          <MetaText>{formatBdPhone(address.phone)}</MetaText>
        </MetaRow>
        <MetaRow label="Address">
          <MetaText>{addressLines(address).join(', ')}</MetaText>
        </MetaRow>
      </View>

      <Divider />

      <View style={styles.items}>
        {order.items.map((item) => (
          <View
            key={item.orderItemId}
            accessible
            accessibilityLabel={`${item.productName}, quantity ${item.quantity}, ${spokenMoney(item.unitPriceMinor)} each, line total ${spokenMoney(item.lineTotalMinor)}`}
            style={styles.item}
          >
            <View style={styles.itemText}>
              <Text style={styles.itemName}>{item.productName}</Text>
              {item.variantLabel ? (
                <Text style={styles.itemVariant}>{item.variantLabel}</Text>
              ) : null}
              <Text style={styles.itemMeta}>
                {item.quantity} × {formatMoney(item.unitPriceMinor)} · SKU {item.sku}
              </Text>
            </View>
            <Text style={styles.itemAmount}>{formatMoney(item.lineTotalMinor)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.totals}>
        <TotalRow label="Subtotal">{formatMoney(order.subtotalMinor)}</TotalRow>
        <TotalRow label="Delivery">
          {order.shippingFeeMinor === 0 ? 'Free' : formatMoney(order.shippingFeeMinor)}
        </TotalRow>
        {order.discountMinor > 0 ? (
          <TotalRow label="Discount">{formatMoney(-order.discountMinor)}</TotalRow>
        ) : null}
        <TotalRow label="Total" total>
          {formatMoney(order.totalMinor)}
        </TotalRow>
        {/* Paid and due come from the order's own payment state, never from a guess. */}
        {money.paidMinor > 0 ? (
          <TotalRow label="Paid">{formatMoney(money.paidMinor)}</TotalRow>
        ) : null}
        <TotalRow label="Due">
          {money.dueMinor === 0 ? 'Nothing' : formatMoney(money.dueMinor)}
        </TotalRow>
      </View>

      <View style={styles.paperFooter}>
        <Text style={styles.footerNote}>{paymentNote(order)}</Text>
        <Text style={styles.footerMeta}>
          {itemCountLabel(order.itemCount)} · Thank you for shopping with Nilzora.
        </Text>
      </View>
    </Animated.View>
  );
}

function ReceiptSkeleton() {
  return (
    <SkeletonGroup label="Loading your receipt" style={styles.skeleton}>
      <Skeleton height={340} radius={20} />
      <Skeleton height={56} radius={theme.radii.lg} />
    </SkeletonGroup>
  );
}

export interface ReceiptScreenProps {
  /** A well-formed order number (the route validates it). */
  orderNumber: string;
}

/**
 * One receipt. Render it inside <SignedInGate>: it reads the order with the signed-in
 * customer's own access token, so another customer's receipt answers "not found".
 */
export function ReceiptScreen({ orderNumber }: ReceiptScreenProps) {
  const router = useRouter();
  const query = useOrder(orderNumber);
  const run = useAuthorizedApi();
  const { onRefresh } = useManualRefresh(query.refetch);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function shareReceipt(order: OrderDetail) {
    // The shared text never carries the customer's name, phone number or address.
    try {
      await Share.share({ message: receiptShareText(order) });
      setNote('Receipt shared.');
    } catch {
      setNote('The receipt could not be shared.');
    }
  }

  async function copyReceipt(order: OrderDetail) {
    try {
      // Text only: no document is created, and no file picker opens.
      await Clipboard.setStringAsync(receiptText(order));
      setNote('Receipt copied.');
      void AccessibilityInfo.announceForAccessibility('Receipt copied.');
    } catch {
      setNote('The receipt could not be copied. You can save the PDF instead.');
    }
  }

  async function saveReceipt(order: OrderDetail) {
    setSaving(true);
    try {
      const file = await run((api, token) => api.orderReceiptPdf(token, order.orderNumber));
      const result = await saveReceiptPdf(file.bytes, receiptFileName(order.orderNumber));
      if (result === 'saved') setNote('Receipt saved.');
      else if (result === 'cancelled') setNote(null);
      else setNote('The receipt could not be saved on this device.');
    } catch {
      setNote('The receipt could not be downloaded. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  function renderReceipt(order: OrderDetail) {
    return (
      <>
        {note ? <Notice tone="success">{note}</Notice> : null}
        <ReceiptPaper order={order} />
        {/* A two-column grid: every action is the same size, two fit on one line even on a
            narrow phone, and "Continue shopping" keeps the link treatment below them. */}
        <View style={styles.actions}>
          {CAN_SAVE_RECEIPT ? (
            <View style={styles.actionCell}>
              <Button
                label="Save PDF"
                variant="secondary"
                loading={saving}
                accessibilityHint="Choose a folder and save this receipt as a PDF."
                onPress={() => void saveReceipt(order)}
              />
            </View>
          ) : null}
          <View style={styles.actionCell}>
            <Button
              label="Copy receipt"
              variant="secondary"
              accessibilityHint="Copies the receipt as plain text. Nothing is saved to your files."
              onPress={() => void copyReceipt(order)}
            />
          </View>
          <View style={styles.actionCell}>
            <Button
              label="Share receipt"
              variant="secondary"
              onPress={() => void shareReceipt(order)}
            />
          </View>
          <View style={styles.actionCell}>
            <Button
              label="Order details"
              variant="secondary"
              onPress={() => {
                router.push({ pathname: '/order/[orderNumber]', params: { orderNumber } });
              }}
            />
          </View>
        </View>
        <Button label="Continue shopping" variant="link" onPress={() => router.replace('/')} />
        <Text style={styles.reassurance}>
          {PAYMENT_STATUS_DESCRIPTIONS[order.paymentStatus]} You can open this receipt again from
          your orders at any time.
        </Text>
      </>
    );
  }

  if (query.isError && isNotFound(query.error)) {
    return (
      <Card>
        <EmptyState
          icon={ReceiptIcon}
          title="Receipt not found"
          description="We could not find this order in your account. It may have been removed."
        />
        <View style={styles.actions}>
          <Button label="View your orders" onPress={() => router.replace('/orders')} />
        </View>
      </Card>
    );
  }

  return (
    <Screen title="Receipt" edges={STACK_EDGES} onRefresh={onRefresh} testID="receipt-scroll">
      <QueryState query={query} skeleton={<ReceiptSkeleton />}>
        {(data) => renderReceipt(data.order)}
      </QueryState>
    </Screen>
  );
}

const styles = StyleSheet.create({
  skeleton: { gap: theme.spacing[4] },
  paper: {
    backgroundColor: PAPER,
    borderRadius: 20,
    paddingHorizontal: theme.spacing[5],
    paddingVertical: theme.spacing[5],
    gap: theme.spacing[3],
    ...theme.shadow.card,
  },
  paperHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  receiptWord: {
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: theme.fontWeights.semibold,
    color: theme.colors.mutedForeground,
  },
  orderNumber: {
    fontSize: 20,
    fontWeight: theme.fontWeights.semibold,
    color: theme.colors.foreground,
    letterSpacing: -0.3,
  },
  placedAt: { fontSize: 13, color: theme.colors.mutedForeground },
  divider: { borderTopWidth: 1, borderStyle: 'dashed', borderColor: theme.brand.muted },
  meta: { gap: theme.spacing[2] },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing[3] },
  metaLabel: {
    width: 92,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: theme.colors.mutedForeground,
    paddingTop: 2,
  },
  metaValue: { flex: 1, alignItems: 'flex-start', gap: 2 },
  metaText: { fontSize: 14, color: theme.colors.foreground, lineHeight: 20 },
  paymentLine: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  items: { gap: theme.spacing[3] },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing[3] },
  itemText: { flex: 1, gap: 2 },
  itemName: {
    fontSize: 14,
    fontWeight: theme.fontWeights.semibold,
    color: theme.colors.foreground,
  },
  itemVariant: { fontSize: 12, color: theme.colors.mutedForeground },
  itemMeta: { fontSize: 12, color: theme.colors.mutedForeground },
  itemAmount: { fontSize: 14, color: theme.colors.foreground, fontVariant: ['tabular-nums'] },
  totals: { gap: theme.spacing[2] },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: theme.spacing[3],
  },
  totalRowFinal: {
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.brand.muted,
    paddingTop: theme.spacing[3],
  },
  totalLabel: { fontSize: 14, color: theme.colors.mutedForeground },
  totalLabelFinal: {
    fontSize: 15,
    fontWeight: theme.fontWeights.semibold,
    color: theme.colors.foreground,
  },
  totalAmount: { fontSize: 14, color: theme.colors.foreground, fontVariant: ['tabular-nums'] },
  totalAmountFinal: {
    fontSize: 20,
    fontWeight: theme.fontWeights.semibold,
    color: theme.colors.foreground,
    fontVariant: ['tabular-nums'],
  },
  paperFooter: {
    gap: theme.spacing[1],
    backgroundColor: theme.brand.soft,
    marginHorizontal: -theme.spacing[5],
    marginBottom: -theme.spacing[5],
    marginTop: theme.spacing[1],
    paddingHorizontal: theme.spacing[5],
    paddingVertical: theme.spacing[4],
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  footerNote: {
    fontSize: 13,
    fontWeight: theme.fontWeights.medium,
    color: theme.colors.foreground,
  },
  footerMeta: { fontSize: 12, color: theme.colors.mutedForeground },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[2],
    marginTop: theme.spacing[3],
  },
  // Half the row each, so two buttons sit side by side on the narrowest phone and the labels
  // keep one line.
  actionCell: { flexGrow: 1, flexBasis: '45%' },
  reassurance: {
    fontSize: 12,
    color: theme.colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 18,
  },
});
