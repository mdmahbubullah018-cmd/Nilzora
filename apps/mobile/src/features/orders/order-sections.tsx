import type { OrderDetail, OrderItem } from '@nilzora/contracts';
import { Banknote, Truck } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/card';
import { CartLineThumb } from '@/features/cart/cart-line-thumb';
import { formatDate, formatDateTime } from '@/lib/dates';
import { formatMoney, itemCountLabel, spokenMoney } from '@/lib/money';
import { theme } from '@/theme';
import {
  addressLines,
  DELIVERY_ZONE_LABELS,
  formatBdPhone,
  isProductSlug,
  ORDER_EVENT_LABELS,
  PAYMENT_STATUS_DESCRIPTIONS,
  timelineEvents,
} from './status';
import { OrderStatusPill, PaymentStatusPill } from './status-pill';

/** A white card with a title, the shape every section of the order page shares. */
export function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card style={styles.card}>
      <Text accessibilityRole="header" style={styles.cardTitle}>
        {title}
      </Text>
      {children}
    </Card>
  );
}

/** The order number, its status and when it was placed. */
export function OrderHeader({ order }: { order: OrderDetail }) {
  return (
    <Card style={styles.card}>
      <View style={styles.headerTop}>
        <Text accessibilityRole="header" style={styles.number}>
          {order.orderNumber}
        </Text>
        <OrderStatusPill status={order.status} />
      </View>
      <Text style={styles.muted}>Placed on {formatDate(order.placedAt)}</Text>
    </Card>
  );
}

/** What to tell the customer about a cancelled order: when, that nothing is due, and why. */
export function cancelledSummary(order: OrderDetail): string {
  const when = order.cancelledAt ? `Cancelled on ${formatDate(order.cancelledAt)}. ` : '';
  const reason = order.cancelReason ? ` Reason: ${order.cancelReason}` : '';
  return `${when}Nothing is due for it.${reason}`;
}

/**
 * The status history, oldest first, with the latest step highlighted. `note` is a quiet
 * line under it (e.g. that courier tracking will appear once the parcel is booked).
 */
export function OrderTimeline({ order, note }: { order: OrderDetail; note?: string | null }) {
  const events = timelineEvents(order);
  return (
    <SectionCard title="Order progress">
      <View>
        {events.map((event, index) => {
          const last = index === events.length - 1;
          const label = ORDER_EVENT_LABELS[event.status];
          const when = formatDateTime(event.at);
          return (
            <View
              // The history only grows, so an event's position is a stable key.
              key={index}
              accessible
              accessibilityLabel={`${label}, ${when}`}
              style={styles.event}
            >
              <View style={styles.rail}>
                <View style={[styles.dot, last ? styles.dotLatest : null]} />
                {last ? null : <View style={styles.line} />}
              </View>
              <View style={[styles.eventText, last ? null : styles.eventSpacing]}>
                <Text style={[styles.eventLabel, last ? styles.eventLabelLatest : null]}>
                  {label}
                </Text>
                <Text style={styles.eventTime}>{when}</Text>
              </View>
            </View>
          );
        })}
      </View>
      {note ? (
        <View style={styles.timelineNote}>
          <Truck size={16} color={theme.colors.mutedForeground} accessible={false} />
          <Text style={[styles.muted, styles.timelineNoteText]}>{note}</Text>
        </View>
      ) : null}
    </SectionCard>
  );
}

function ItemRow({
  item,
  onOpenProduct,
}: {
  item: OrderItem;
  onOpenProduct: (slug: string) => void;
}) {
  const linked = isProductSlug(item.productSlug);
  const summary = `${item.productName}, quantity ${item.quantity}, ${spokenMoney(item.unitPriceMinor)} each, line total ${spokenMoney(item.lineTotalMinor)}`;
  const content = (
    <>
      {/* The line's own picture, kept with the order, so a product that was later
          re-photographed or removed still shows what was bought. */}
      <CartLineThumb image={item.image} size={56} />
      <View style={styles.itemText}>
        <Text style={[styles.itemName, linked ? styles.itemLink : null]}>{item.productName}</Text>
        {item.variantLabel ? <Text style={styles.muted}>{item.variantLabel}</Text> : null}
        <Text style={styles.muted}>
          Qty {item.quantity} · {formatMoney(item.unitPriceMinor)} each
        </Text>
        {item.campaignDiscountMinor > 0 && item.regularPriceMinor !== null ? (
          <Text style={styles.promotion}>
            {item.campaignTitle ?? 'Promotion'} · was {formatMoney(item.regularPriceMinor)}
          </Text>
        ) : null}
        <Text style={styles.sku}>SKU {item.sku}</Text>
      </View>
      <Text style={styles.lineTotal}>{formatMoney(item.lineTotalMinor)}</Text>
    </>
  );
  if (!linked) {
    return (
      <View accessible accessibilityLabel={summary} style={styles.item}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={summary}
      accessibilityHint="Opens the product"
      android_ripple={{ color: theme.colors.border }}
      onPress={() => onOpenProduct(item.productSlug)}
      style={({ pressed }) => [styles.item, pressed ? styles.itemPressed : null]}
    >
      {content}
    </Pressable>
  );
}

function TotalRow({ label, value, spoken, total = false }: TotalRowProps) {
  return (
    <View accessible accessibilityLabel={`${label}: ${spoken}`} style={styles.totalRow}>
      <Text style={total ? styles.totalLabelStrong : styles.totalLabel}>{label}</Text>
      <Text style={total ? styles.totalValueStrong : styles.totalValue}>{value}</Text>
    </View>
  );
}

interface TotalRowProps {
  label: string;
  value: string;
  spoken: string;
  total?: boolean;
}

/** The items as they were when the order was placed, then the totals the server calculated. */
export function OrderItems({
  order,
  onOpenProduct,
}: {
  order: OrderDetail;
  onOpenProduct: (slug: string) => void;
}) {
  return (
    <SectionCard title={`Items (${itemCountLabel(order.itemCount)})`}>
      <View style={styles.items}>
        {order.items.map((item) => (
          <ItemRow key={item.orderItemId} item={item} onOpenProduct={onOpenProduct} />
        ))}
      </View>
      <View style={styles.totals}>
        <TotalRow
          label="Subtotal"
          value={formatMoney(order.subtotalMinor)}
          spoken={spokenMoney(order.subtotalMinor)}
        />
        <TotalRow
          label={`Delivery (${DELIVERY_ZONE_LABELS[order.deliveryZone]})`}
          value={formatMoney(order.shippingFeeMinor)}
          spoken={spokenMoney(order.shippingFeeMinor)}
        />
        {order.discountMinor > 0 ? (
          <TotalRow
            label="Discount"
            value={formatMoney(-order.discountMinor)}
            spoken={spokenMoney(-order.discountMinor)}
          />
        ) : null}
        <TotalRow
          total
          label="Total"
          value={formatMoney(order.totalMinor)}
          spoken={spokenMoney(order.totalMinor)}
        />
      </View>
    </SectionCard>
  );
}

/** Cash on delivery and whether the cash has been collected yet. */
export function PaymentCard({ order }: { order: OrderDetail }) {
  return (
    <SectionCard title="Payment">
      <View style={styles.paymentRow}>
        <View style={styles.paymentMethod}>
          <Banknote size={18} color={theme.colors.primary} accessible={false} />
          <Text style={styles.paymentName}>Cash on delivery</Text>
        </View>
        <PaymentStatusPill status={order.paymentStatus} />
      </View>
      <Text style={styles.muted}>{PAYMENT_STATUS_DESCRIPTIONS[order.paymentStatus]}</Text>
    </SectionCard>
  );
}

/** Where the parcel goes: the copy kept on the order, not the saved address it came from. */
export function AddressCard({ order }: { order: OrderDetail }) {
  const address = order.shippingAddress;
  const lines = addressLines(address);
  const phone = formatBdPhone(address.phone);
  return (
    <SectionCard title="Delivery address">
      <View
        accessible
        accessibilityLabel={`${address.recipientName}, ${lines.join(', ')}, phone ${phone}`}
        style={styles.address}
      >
        <Text style={styles.recipient}>{address.recipientName}</Text>
        {lines.map((line, index) => (
          // Lines can repeat each other's text; their order never changes.
          <Text key={index} style={styles.addressLine}>
            {line}
          </Text>
        ))}
        <Text style={styles.addressLine}>{phone}</Text>
      </View>
    </SectionCard>
  );
}

export function NoteCard({ note }: { note: string }) {
  return (
    <SectionCard title="Your note">
      <Text style={styles.note}>{note}</Text>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  card: { padding: theme.spacing[5], gap: theme.spacing[3] },
  cardTitle: {
    color: theme.colors.foreground,
    fontSize: 17,
    fontWeight: theme.fontWeights.semibold,
  },
  muted: { color: theme.colors.mutedForeground, fontSize: 14, lineHeight: 20 },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[3],
  },
  number: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: 22,
    fontWeight: theme.fontWeights.semibold,
    fontVariant: ['tabular-nums'],
  },
  event: { flexDirection: 'row', gap: theme.spacing[3] },
  rail: { width: 14, alignItems: 'center' },
  dot: {
    marginTop: 5,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.borderStrong,
  },
  dotLatest: {
    backgroundColor: theme.colors.primaryAction,
    borderWidth: 3,
    borderColor: theme.colors.infoSurface,
    width: 16,
    height: 16,
    borderRadius: 8,
    marginTop: 2,
  },
  line: { flex: 1, width: 1, marginVertical: 2, backgroundColor: theme.colors.border },
  eventText: { flex: 1, gap: 2 },
  eventSpacing: { paddingBottom: theme.spacing[4] },
  eventLabel: { color: theme.colors.body, fontSize: 15 },
  eventLabelLatest: { color: theme.colors.foreground, fontWeight: theme.fontWeights.semibold },
  eventTime: { color: theme.colors.mutedForeground, fontSize: 13 },
  timelineNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing[2],
    paddingTop: theme.spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  timelineNoteText: { flex: 1 },
  items: { gap: theme.spacing[1] },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing[3],
    minHeight: theme.touchTarget,
    paddingVertical: theme.spacing[2],
    borderRadius: theme.radii.md,
  },
  itemPressed: { backgroundColor: theme.colors.surfaceMuted },
  itemText: { flex: 1, gap: 2 },
  promotion: {
    color: theme.colors.link,
    fontSize: 12,
    fontWeight: theme.fontWeights.semibold,
  },
  itemName: {
    color: theme.colors.foreground,
    fontSize: 15,
    fontWeight: theme.fontWeights.semibold,
  },
  itemLink: { color: theme.colors.link },
  sku: { color: theme.colors.mutedForeground, fontSize: 12 },
  lineTotal: {
    color: theme.colors.foreground,
    fontSize: 15,
    fontWeight: theme.fontWeights.semibold,
    fontVariant: ['tabular-nums'],
  },
  totals: {
    gap: theme.spacing[2],
    paddingTop: theme.spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing[3] },
  totalLabel: { flex: 1, color: theme.colors.body, fontSize: 15 },
  totalValue: { color: theme.colors.foreground, fontSize: 15, fontVariant: ['tabular-nums'] },
  totalLabelStrong: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: 17,
    fontWeight: theme.fontWeights.semibold,
  },
  totalValueStrong: {
    color: theme.colors.foreground,
    fontSize: 17,
    fontWeight: theme.fontWeights.semibold,
    fontVariant: ['tabular-nums'],
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: theme.spacing[2],
  },
  paymentMethod: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  paymentName: {
    color: theme.colors.foreground,
    fontSize: 15,
    fontWeight: theme.fontWeights.medium,
  },
  address: { gap: 2 },
  recipient: {
    color: theme.colors.foreground,
    fontSize: 15,
    fontWeight: theme.fontWeights.semibold,
  },
  addressLine: { color: theme.colors.body, fontSize: 15, lineHeight: 22 },
  note: { color: theme.colors.body, fontSize: 15, lineHeight: 22 },
});
