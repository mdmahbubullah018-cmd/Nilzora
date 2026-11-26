import type { OrderDetail } from '@nilzora/contracts';
import { useRouter } from 'expo-router';
import { PackageSearch } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Notice } from '@/components/notice';
import { QueryState } from '@/components/query-state';
import { Screen, STACK_EDGES } from '@/components/screen';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { useManualRefresh } from '@/query';
import { theme } from '@/theme';
import { CancelOrderDialog, CancelOrderSection, useCancelOrder } from './cancel-order';
import { OrderReviewsCard } from './order-reviews';
import {
  AddressCard,
  cancelledSummary,
  NoteCard,
  OrderHeader,
  OrderItems,
  OrderTimeline,
  PaymentCard,
  SectionCard,
} from './order-sections';
import { awaitsCourier, deliveryShipments, mayHaveShipments, returnPickups } from './shipment-view';
import { ShipmentTrackingCard, TRACKING_PENDING_NOTE } from './shipment-tracking';
import { isNotFound, useOrder } from './use-order';
import { useOrderShipments } from './use-order-shipments';

export const PLACED_TITLE = 'Order placed';
export const PLACED_MESSAGE =
  'Thank you. Pay in cash on delivery. We will confirm your order soon, and you can follow it here.';
export const CANCELLED_MESSAGE = 'Your order has been cancelled.';

/** Shown for a missing order, someone else's order and a malformed order number alike. */
export function OrderNotFound() {
  const router = useRouter();
  return (
    <Card>
      <EmptyState
        icon={PackageSearch}
        title="Order not found"
        description="We could not find this order in your account. It may have been removed."
      />
      <View style={styles.action}>
        <Button label="View your orders" onPress={() => router.replace('/orders')} />
      </View>
    </Card>
  );
}

/** The not-found state as a whole screen, for a route parameter that is not an order number. */
export function OrderNotFoundScreen() {
  return (
    <Screen edges={STACK_EDGES}>
      <OrderNotFound />
    </Screen>
  );
}

function DetailSkeleton() {
  return (
    <SkeletonGroup label="Loading your order" style={styles.skeleton}>
      <Skeleton height={84} radius={theme.radii.lg} />
      <Skeleton height={140} radius={theme.radii.lg} />
      <Skeleton height={200} radius={theme.radii.lg} />
    </SkeletonGroup>
  );
}

type Message = { tone: 'success' | 'warning'; text: string };

export interface OrderDetailScreenProps {
  /** A well-formed order number (the route validates it). */
  orderNumber: string;
  /** True when checkout just placed this order: shows the "Order placed" banner. */
  placed?: boolean;
}

/**
 * One order: status, progress, items and totals, payment, delivery address and the
 * customer's note, with "Cancel order" only while the server says the order can still be
 * cancelled. Render it inside <SignedInGate>. Everything shown (including whether
 * cancelling is allowed) is what the API returned.
 */
export function OrderDetailScreen({ orderNumber, placed = false }: OrderDetailScreenProps) {
  const router = useRouter();
  const query = useOrder(orderNumber);
  // Tracking is asked for once the order is known and could have been booked with a courier.
  const askShipments = query.data !== undefined && mayHaveShipments(query.data.order.status);
  const shipments = useOrderShipments(orderNumber, askShipments);
  const refetchShipments = shipments.refetch;
  const refetchOrder = query.refetch;
  // Pull-to-refresh reloads the order and, when it is being tracked, its shipments.
  const refetchAll = useCallback(
    () => Promise.all([refetchOrder(), askShipments ? refetchShipments() : undefined]),
    [askShipments, refetchOrder, refetchShipments],
  );
  const { onRefresh } = useManualRefresh(refetchAll);
  const { cancel, pending } = useCancelOrder(orderNumber);
  const [message, setMessage] = useState<Message | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; error: string | null }>({
    open: false,
    error: null,
  });

  const loaded = query.data !== undefined;
  useEffect(() => {
    // The banner appears with the order; say it aloud once for screen-reader users.
    if (placed && loaded) AccessibilityInfo.announceForAccessibility(PLACED_TITLE);
  }, [placed, loaded]);

  async function confirmCancel(reason: string) {
    setDialog({ open: true, error: null });
    const outcome = await cancel(reason);
    if (outcome.kind === 'retry') {
      setDialog({ open: true, error: outcome.message });
      return;
    }
    setDialog({ open: false, error: null });
    if (outcome.kind === 'cancelled') {
      setMessage({ tone: 'success', text: CANCELLED_MESSAGE });
      AccessibilityInfo.announceForAccessibility(CANCELLED_MESSAGE);
    } else {
      setMessage({ tone: 'warning', text: outcome.message });
    }
  }

  function renderOrder(order: OrderDetail) {
    // Tracking is extra: while it loads, or if it fails, the order shows without it.
    const list = askShipments ? shipments.data?.shipments : undefined;
    const delivery = list === undefined ? [] : deliveryShipments(list);
    const pickups = list === undefined ? [] : returnPickups(list);
    const trackingNote =
      list !== undefined && delivery.length === 0 && awaitsCourier(order.status)
        ? TRACKING_PENDING_NOTE
        : null;
    return (
      <>
        {placed && order.status !== 'cancelled' ? (
          <Notice tone="success" title={PLACED_TITLE}>
            {PLACED_MESSAGE}
          </Notice>
        ) : null}
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <OrderHeader order={order} />
        <View>
          <Button
            label="View receipt"
            variant="secondary"
            accessibilityHint="Opens the receipt for this order"
            onPress={() => {
              router.push({
                pathname: '/receipt/[orderNumber]',
                params: { orderNumber: order.orderNumber },
              });
            }}
          />
        </View>
        {order.status === 'cancelled' ? (
          <Notice tone="info" title="This order is cancelled">
            {cancelledSummary(order)}
          </Notice>
        ) : null}
        <OrderTimeline order={order} note={trackingNote} />
        <ShipmentTrackingCard title="Delivery tracking" shipments={delivery} />
        <ShipmentTrackingCard
          title="Return pickup"
          shipments={pickups}
          onOpenReturn={(returnId) => {
            router.push({ pathname: '/returns/[returnId]', params: { returnId } });
          }}
        />
        <OrderItems
          order={order}
          onOpenProduct={(slug) => router.push({ pathname: '/product/[slug]', params: { slug } })}
        />
        <OrderReviewsCard order={order} />
        <PaymentCard order={order} />
        <AddressCard order={order} />
        {order.customerNote ? <NoteCard note={order.customerNote} /> : null}
        {order.canCancel ? (
          <CancelOrderSection onPress={() => setDialog({ open: true, error: null })} />
        ) : null}
        {order.status === 'delivered' ? (
          <SectionCard title="Send something back">
            <Text style={styles.returnHint}>
              If something is wrong with this order, ask to send it back. Nilzora reviews the
              request before anything is returned, and any refund is paid back by hand under Cash on
              Delivery.
            </Text>
            <Button
              label="Request a return"
              variant="secondary"
              onPress={() => {
                router.push({ pathname: '/returns/new', params: { order: order.orderNumber } });
              }}
            />
          </SectionCard>
        ) : null}
      </>
    );
  }

  const notFound = query.isError && isNotFound(query.error);
  return (
    <Screen edges={STACK_EDGES} onRefresh={onRefresh} testID="order-scroll">
      {notFound ? (
        <OrderNotFound />
      ) : (
        <QueryState query={query} skeleton={<DetailSkeleton />}>
          {(data) => renderOrder(data.order)}
        </QueryState>
      )}
      {dialog.open ? (
        <CancelOrderDialog
          orderNumber={orderNumber}
          pending={pending}
          error={dialog.error}
          onConfirm={(reason) => void confirmCancel(reason)}
          onDismiss={() => setDialog({ open: false, error: null })}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  action: {
    paddingHorizontal: theme.spacing[5],
    paddingBottom: theme.spacing[6],
  },
  skeleton: { gap: theme.spacing[4] },
  returnHint: { color: theme.colors.mutedForeground, fontSize: theme.text.body.fontSize },
});
