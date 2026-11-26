import type { CustomerShipment, ReturnDetail } from '@nilzora/contracts';
import { Undo2 } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/button';
import { Notice } from '@/components/notice';
import { QueryStateView } from '@/components/query-state';
import { Screen } from '@/components/screen';
import { ShipmentTrackingCard } from '@/features/orders/shipment-tracking';
import { returnPickups } from '@/features/orders/shipment-view';
import { useOrderShipments } from '@/features/orders/use-order-shipments';
import { describeApiError } from '@/lib/errors';
import { formatMoney } from '@/lib/money';
import { useManualRefresh } from '@/query';
import { theme } from '@/theme';
import { returnStatusLabel } from './returns-list';
import { useReturn, useReturnActions } from './use-returns';

const REFUND_LABELS: Record<string, string> = {
  requested: 'Waiting for approval',
  approved: 'Approved — the money has not been handed back yet',
  completed: 'Paid back',
  rejected: 'Not approved',
  cancelled: 'Cancelled',
};

function Row({ label, children }: { label: string; children: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{children}</Text>
    </View>
  );
}

/** A courier collects the items only after Nilzora approves the return. */
function mayHavePickup(request: ReturnDetail): boolean {
  return (
    request.status === 'approved' || request.status === 'received' || request.status === 'completed'
  );
}

function ReturnBody({
  request,
  pickups,
}: {
  request: ReturnDetail;
  /** This return's courier pickups; empty while unknown or when there is none. */
  pickups: readonly CustomerShipment[];
}) {
  const { cancel, cancelling } = useReturnActions();
  const [failure, setFailure] = useState<string | null>(null);

  return (
    <View style={styles.stack}>
      {failure === null ? null : (
        <Notice tone="danger" title="Could not cancel this return">
          {failure}
        </Notice>
      )}
      <View style={styles.card}>
        <Text style={styles.heading}>Return for order {request.orderNumber}</Text>
        <Row label="Where it is">{returnStatusLabel(request.status)}</Row>
        <Row label="Asked on">{new Date(request.requestedAt).toLocaleDateString()}</Row>
        <Row label="Reason you gave">{request.reason}</Row>
        {request.description === null ? null : (
          <Row label="In your words">{request.description}</Row>
        )}
        {request.decisionNote === null ? null : (
          <Row label="Note from Nilzora">{request.decisionNote}</Row>
        )}
        <Row label="Refundable for these items">{formatMoney(request.refundableMinor)}</Row>
      </View>

      <ShipmentTrackingCard title="Return pickup" shipments={pickups} />

      <View style={styles.card}>
        <Text style={styles.heading}>Items</Text>
        {request.items.map((item) => (
          <Text key={item.orderItemId} style={styles.value}>
            {`${item.productName}${item.variantLabel === null ? '' : ` · ${item.variantLabel}`} — ${String(item.quantity)}${item.orderedQuantity === undefined ? '' : ` of ${String(item.orderedQuantity)}`} · SKU ${item.sku}`}
          </Text>
        ))}
      </View>

      {request.refunds === undefined || request.refunds.length === 0 ? null : (
        <View style={styles.card}>
          <Text style={styles.heading}>Refunds</Text>
          <Text style={styles.meta}>
            Nilzora pays Cash on Delivery refunds back by hand. A refund counts as paid only once
            its reference is recorded.
          </Text>
          {request.refunds.map((refund) => (
            <View key={refund.id} style={styles.refund}>
              <Text style={styles.value}>{formatMoney(refund.amountMinor)}</Text>
              <Text style={styles.meta}>
                {REFUND_LABELS[refund.status] ?? refund.status} ·{' '}
                {refund.method === 'cod_manual' ? 'cash paid back by hand' : refund.method}
              </Text>
              <Text style={styles.meta}>
                {refund.completedAt === null
                  ? `Asked on ${new Date(refund.requestedAt).toLocaleDateString()}`
                  : `Paid on ${new Date(refund.completedAt).toLocaleDateString()}`}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.heading}>What has happened</Text>
        {request.history.map((entry) => (
          <Text key={`${entry.at}-${entry.toStatus}`} style={styles.value}>
            {`${entry.actorKind === 'customer' ? 'You' : 'Nilzora'} — ${returnStatusLabel(entry.toStatus).toLowerCase()} · ${new Date(entry.at).toLocaleDateString()}`}
          </Text>
        ))}
      </View>

      {request.status === 'requested' ? (
        <Button
          label="Cancel this return"
          variant="danger"
          loading={cancelling}
          onPress={() => {
            setFailure(null);
            void cancel(request.id).catch((error: unknown) => {
              setFailure(describeApiError(error).message);
            });
          }}
        />
      ) : null}

      <View style={styles.footnote}>
        <Undo2 size={16} color={theme.colors.mutedForeground} />
        <Text style={styles.meta}>
          Nothing is refunded automatically. Nilzora contacts you before any money is handed back.
        </Text>
      </View>
    </View>
  );
}

/** One return request: what was sent back, its history, and any refund recorded against it. */
export function ReturnDetailScreen({ returnId }: { returnId: string }) {
  const query = useReturn(returnId);
  const request = query.data?.return;
  const askPickups = request !== undefined && mayHavePickup(request);
  // The pickup is read from the return's order; only this return's pickups are shown.
  const shipments = useOrderShipments(request?.orderNumber ?? '', askPickups);
  const refetchReturn = query.refetch;
  const refetchShipments = shipments.refetch;
  const refetchAll = useCallback(
    () => Promise.all([refetchReturn(), askPickups ? refetchShipments() : undefined]),
    [askPickups, refetchReturn, refetchShipments],
  );
  const { onRefresh } = useManualRefresh(refetchAll);
  const pickups =
    askPickups && shipments.data !== undefined
      ? returnPickups(shipments.data.shipments, request.id)
      : [];

  return (
    <Screen title="Return details" onRefresh={onRefresh}>
      {query.data === undefined && query.status === 'error' ? (
        <QueryStateView
          state="error"
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isRefetching}
        />
      ) : query.data === undefined ? (
        <QueryStateView state="loading" />
      ) : (
        <ReturnBody request={query.data.return} pickups={pickups} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: theme.spacing[3] },
  card: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radii.lg,
    padding: theme.spacing[4],
    gap: theme.spacing[2],
  },
  heading: {
    color: theme.colors.foreground,
    fontSize: theme.text.subheading.fontSize,
    fontWeight: theme.fontWeights.semibold,
  },
  row: { gap: theme.spacing[1] },
  label: { color: theme.colors.mutedForeground, fontSize: theme.text.body.fontSize },
  value: { color: theme.colors.foreground, fontSize: theme.text.body.fontSize },
  meta: { color: theme.colors.mutedForeground, fontSize: theme.text.body.fontSize },
  refund: { gap: theme.spacing[1], paddingTop: theme.spacing[2] },
  footnote: { flexDirection: 'row', gap: theme.spacing[2], alignItems: 'center' },
});
