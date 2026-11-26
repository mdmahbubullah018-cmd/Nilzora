import type { OrderDetail } from '@nilzora/contracts';
import { receiptFileName, receiptMoney } from '@nilzora/contracts';
import { useRouter } from 'expo-router';
import { CheckCircle2, Info, Package, PackageCheck, Truck } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Notice } from '@/components/notice';
import { QueryState } from '@/components/query-state';
import { Screen, STACK_EDGES } from '@/components/screen';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { isOrderNumber, singleParam } from '@/features/orders/status';
import { isNotFound, useOrder } from '@/features/orders/use-order';
import { CAN_SAVE_RECEIPT, saveReceiptPdf } from '@/features/receipt/save-receipt';
import { formatMoney } from '@/lib/money';
import { useAuthorizedApi } from '@/query';
import { theme } from '@/theme';

/*
 * The app's "order placed" moment.
 *
 * Cash on delivery is the only method, so the wording never calls an order paid: it asks for
 * cash on delivery and shows the amount still due. Every figure is the order the API returned
 * from `place_cod_order` — nothing is recomputed here — and pulling to refresh re-reads the
 * same order, so a change on the server (a cancellation, say) shows up immediately.
 */

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
          duration: 420,
          useNativeDriver: true,
        }).start();
      })
      .catch(() => {
        // A platform that cannot answer must not leave the confirmation invisible.
        value.setValue(1);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);
  return value;
}

function SuccessSkeleton() {
  return (
    <SkeletonGroup>
      <Skeleton height={120} radius={18} />
      <Skeleton height={220} radius={18} />
      <Skeleton height={52} radius={14} />
      <Skeleton height={52} radius={14} />
    </SkeletonGroup>
  );
}

/**
 * The screen itself: it owns the query and the receipt actions, and the announcement of the
 * result fires here — unconditionally, once — rather than inside the success branch.
 */
export function OrderSuccessScreen({ orderNumber }: { orderNumber: string }) {
  const router = useRouter();
  const query = useOrder(orderNumber);
  const run = useAuthorizedApi();
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (query.data === undefined) return;
    void AccessibilityInfo.announceForAccessibility(
      `Order ${query.data.order.orderNumber} placed successfully.`,
    );
  }, [query.data]);

  async function saveReceipt(order: OrderDetail) {
    setSaving(true);
    try {
      if (!CAN_SAVE_RECEIPT) {
        // Off Android there is no folder picker: open the receipt screen instead.
        router.push({
          pathname: '/receipt/[orderNumber]',
          params: { orderNumber: order.orderNumber },
        });
        return;
      }
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

  if (query.isError && isNotFound(query.error)) {
    return (
      <Card>
        <EmptyState
          icon={Package}
          title="Order not found"
          description="We could not find this order in your account. It may have been removed."
        />
        <View style={styles.actions}>
          <Button label="View your orders" onPress={() => router.replace('/orders')} />
        </View>
      </Card>
    );
  }

  return (
    <Screen title="Order placed" edges={STACK_EDGES} testID="order-success-scroll">
      <QueryState query={query} skeleton={<SuccessSkeleton />}>
        {(data) => (
          <PlacedOrder
            order={data.order}
            note={note}
            saving={saving}
            onSave={() => void saveReceipt(data.order)}
            onOpenOrder={() => {
              router.replace({ pathname: '/order/[orderNumber]', params: { orderNumber } });
            }}
            onContinue={() => router.replace('/')}
          />
        )}
      </QueryState>
    </Screen>
  );
}

interface PlacedOrderProps {
  order: OrderDetail;
  note: string | null;
  saving: boolean;
  onSave: () => void;
  onOpenOrder: () => void;
  onContinue: () => void;
}

function PlacedOrder({ order, note, saving, onSave, onOpenOrder, onContinue }: PlacedOrderProps) {
  const reveal = useReveal();
  const money = receiptMoney(order);
  const dueNote =
    money.dueMinor === 0
      ? 'Nothing is left to pay on this order.'
      : `Keep ${formatMoney(money.dueMinor)} ready in cash when it arrives.`;

  return (
    <>
      <Animated.View
        style={{
          opacity: reveal,
          transform: [
            { translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
          ],
        }}
      >
        <Card style={styles.hero}>
          <View style={styles.tick}>
            <CheckCircle2 size={34} color={theme.brand.success} accessible={false} />
          </View>
          <Text style={styles.heroTitle} accessibilityRole="header">
            Your order has been placed successfully!
          </Text>
          <Text style={styles.heroBody}>
            Thank you. We have received your order and will confirm it shortly.
          </Text>
          <View style={styles.numberChip}>
            <Text style={styles.numberLabel}>Order number</Text>
            <Text style={styles.numberValue} selectable>
              {order.orderNumber}
            </Text>
          </View>
        </Card>
      </Animated.View>

      {note ? <Notice tone="success">{note}</Notice> : null}

      <Card style={styles.panel}>
        <View style={styles.step}>
          <Truck size={16} color={theme.colors.primary} accessible={false} />
          <Text style={styles.stepText}>{dueNote} Payment method: Cash on Delivery.</Text>
        </View>
        <View style={styles.step}>
          <PackageCheck size={16} color={theme.colors.primary} accessible={false} />
          <Text style={styles.stepText}>
            We confirm your order, then pack it. Follow each step under My Orders.
          </Text>
        </View>
        {/* The same promise the order screen keeps: a cancellation is possible until it is confirmed. */}
        <View style={styles.step}>
          <Info size={16} color={theme.colors.primary} accessible={false} />
          <Text style={styles.stepText}>
            Changed your mind? You can cancel while the order is awaiting confirmation, from its
            details under My Orders.
          </Text>
        </View>
      </Card>

      <View style={styles.actions}>
        <Button
          label="View order details"
          onPress={onOpenOrder}
          accessibilityHint="Opens the full details and status history of this order."
        />
        <Button
          label="Save order details"
          variant="secondary"
          loading={saving}
          onPress={onSave}
          accessibilityHint="Choose a folder and save this order's receipt as a PDF."
        />
        <Button label="Continue shopping" variant="link" onPress={onContinue} />
      </View>
    </>
  );
}

/** The route hands route parameters in raw, so this narrows them before the screen runs. */
export function orderNumberFromParams(raw: string | string[] | undefined): string | null {
  const candidate = singleParam(raw);
  return isOrderNumber(candidate) ? candidate : null;
}

const styles = StyleSheet.create({
  hero: {
    gap: theme.spacing[3],
    alignItems: 'center',
    backgroundColor: theme.notice.success.surface,
    borderColor: theme.notice.success.border,
    paddingVertical: theme.spacing[6],
  },
  tick: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCFCE7',
  },
  heroTitle: {
    color: theme.colors.foreground,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: theme.fontWeights.semibold,
    textAlign: 'center',
  },
  heroBody: {
    color: theme.colors.mutedForeground,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  panel: { gap: theme.spacing[3] },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing[2] },
  stepText: { flex: 1, color: theme.colors.mutedForeground, fontSize: 13, lineHeight: 19 },
  numberChip: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: 2,
    marginTop: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.radii.md,
    backgroundColor: 'rgba(2, 132, 199, 0.08)',
  },
  numberLabel: {
    color: theme.colors.mutedForeground,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontWeight: theme.fontWeights.semibold,
  },
  numberValue: {
    color: theme.colors.foreground,
    fontSize: 17,
    fontWeight: theme.fontWeights.semibold,
  },
  actions: { gap: theme.spacing[2] },
});
