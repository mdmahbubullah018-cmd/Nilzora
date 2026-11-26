import type { CustomerShipment } from '@nilzora/contracts';
import * as Clipboard from 'expo-clipboard';
import { Check, Copy, PackageCheck, Truck, Undo2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/button';
import { formatDate, formatDateTime } from '@/lib/dates';
import { theme } from '@/theme';
import { SectionCard } from './order-sections';
import {
  SHIPMENT_KIND_LABELS,
  shipmentStatusLabel,
  shipmentTone,
  trackingSteps,
  trackingUrl,
} from './shipment-view';
import { StatusPill } from './status-pill';

/*
 * Courier tracking for the customer: who has the parcel, where it has got to, the tracking
 * code and the courier's own tracking page. Only the customer contract's fields are read, so
 * no cost, settlement, note or raw courier data can appear here.
 */

/** Updates shown before the rest fold away behind "Show earlier updates". */
const VISIBLE_STEPS = 4;

export const TRACKING_PENDING_NOTE =
  'Courier tracking appears here once your parcel is with the courier.';

function CopyCode({ code }: { code: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state !== 'copied') return;
    const timer = setTimeout(() => setState('idle'), 2500);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await Clipboard.setStringAsync(code);
      setState('copied');
      AccessibilityInfo.announceForAccessibility('Tracking code copied.');
    } catch {
      setState('failed');
    }
  }

  const copied = state === 'copied';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Copy tracking code ${code}`}
      accessibilityHint={state === 'failed' ? 'Copying did not work. Try again.' : undefined}
      android_ripple={{ color: theme.colors.border, borderless: false }}
      onPress={() => void copy()}
      style={({ pressed }) => [styles.copy, pressed ? styles.copyPressed : null]}
    >
      {copied ? (
        <Check size={16} color={theme.colors.link} accessible={false} />
      ) : (
        <Copy size={16} color={theme.colors.link} accessible={false} />
      )}
      <Text style={styles.copyLabel}>
        {copied ? 'Copied' : state === 'failed' ? 'Try again' : 'Copy'}
      </Text>
    </Pressable>
  );
}

function Timeline({ shipment }: { shipment: CustomerShipment }) {
  const [expanded, setExpanded] = useState(false);
  const steps = trackingSteps(shipment);
  if (steps.length === 0) return null;
  const shown = expanded ? steps : steps.slice(0, VISIBLE_STEPS);
  const hidden = steps.length - shown.length;
  return (
    <View style={styles.timeline}>
      <Text style={styles.overline}>Courier updates</Text>
      <View>
        {shown.map((step, index) => {
          const latest = index === 0;
          const last = index === shown.length - 1;
          const label = shipmentStatusLabel(shipment.kind, step.status);
          const when = formatDateTime(step.at);
          return (
            <View
              // The list is sorted once per render and never reordered in place.
              key={index}
              accessible
              accessibilityLabel={`${label}, ${when}`}
              style={styles.event}
            >
              <View style={styles.rail}>
                <View style={[styles.dot, latest ? styles.dotLatest : null]} />
                {last ? null : <View style={styles.line} />}
              </View>
              <View style={[styles.eventText, last ? null : styles.eventSpacing]}>
                <Text style={[styles.eventLabel, latest ? styles.eventLabelLatest : null]}>
                  {label}
                </Text>
                <Text style={styles.eventTime}>{when}</Text>
              </View>
            </View>
          );
        })}
      </View>
      {hidden > 0 ? (
        <Button
          variant="link"
          label={`Show ${String(hidden)} earlier ${hidden === 1 ? 'update' : 'updates'}`}
          onPress={() => setExpanded(true)}
        />
      ) : null}
    </View>
  );
}

function ShipmentBlock({
  shipment,
  onOpenReturn,
}: {
  shipment: CustomerShipment;
  onOpenReturn?: (returnId: string) => void;
}) {
  const label = shipmentStatusLabel(shipment.kind, shipment.status);
  const url = trackingUrl(shipment.trackingUrl);
  const Icon = shipment.kind === 'return_pickup' ? Undo2 : Truck;
  const returnId = shipment.returnRequestId;
  return (
    <View style={styles.block}>
      <View style={styles.head}>
        <View
          accessible
          accessibilityLabel={`${SHIPMENT_KIND_LABELS[shipment.kind]} with ${shipment.providerName}`}
          style={styles.courier}
        >
          <View style={styles.iconTile}>
            <Icon size={20} color={theme.colors.primary} accessible={false} />
          </View>
          <View style={styles.courierText}>
            <Text style={styles.courierName}>{shipment.providerName}</Text>
            <Text style={styles.muted}>{SHIPMENT_KIND_LABELS[shipment.kind]}</Text>
          </View>
        </View>
        <View style={styles.pills}>
          {shipment.isTest ? (
            <StatusPill tone="neutral" label="Test shipment" accessibilityLabel="Test shipment" />
          ) : null}
          <StatusPill
            tone={shipmentTone(shipment.status)}
            label={label}
            accessibilityLabel={`Courier status: ${label}`}
          />
        </View>
      </View>

      {shipment.trackingCode === null ? null : (
        <View style={styles.codeBox}>
          <View style={styles.codeText}>
            <Text style={styles.codeLabel}>Tracking code</Text>
            <Text selectable style={styles.code}>
              {shipment.trackingCode}
            </Text>
          </View>
          <CopyCode code={shipment.trackingCode} />
        </View>
      )}

      {shipment.deliveredAt === null ? null : (
        <View style={styles.delivered}>
          <PackageCheck size={16} color={theme.notice.success.icon} accessible={false} />
          <Text style={styles.deliveredText}>
            {shipment.kind === 'return_pickup' ? 'Received by Nilzora on ' : 'Delivered on '}
            {formatDate(shipment.deliveredAt)}
          </Text>
        </View>
      )}

      <Timeline shipment={shipment} />

      {url === null ? null : (
        <Button
          variant="secondary"
          label={`Track on ${shipment.providerName}`}
          accessibilityHint="Opens the courier's tracking page outside Nilzora"
          onPress={() => {
            // A device that cannot open it keeps the code above to read and copy.
            void Linking.openURL(url).catch(() => undefined);
          }}
        />
      )}
      {onOpenReturn !== undefined && returnId !== null ? (
        <Button variant="link" label="View the return" onPress={() => onOpenReturn(returnId)} />
      ) : null}
    </View>
  );
}

export interface ShipmentTrackingCardProps {
  title: string;
  /** Shipments to show, newest first. An empty list renders nothing. */
  shipments: readonly CustomerShipment[];
  /** Adds "View the return" to a return pickup (on the order screen). */
  onOpenReturn?: (returnId: string) => void;
}

export function ShipmentTrackingCard({
  title,
  shipments,
  onOpenReturn,
}: ShipmentTrackingCardProps) {
  if (shipments.length === 0) return null;
  return (
    <SectionCard title={title}>
      {shipments.map((shipment, index) => (
        <View key={shipment.id} style={index > 0 ? styles.separated : null}>
          <ShipmentBlock shipment={shipment} onOpenReturn={onOpenReturn} />
        </View>
      ))}
      <Text style={styles.footnote}>
        Updates come from the courier and can take a little while to appear.
      </Text>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  block: { gap: theme.spacing[3] },
  separated: {
    marginTop: theme.spacing[2],
    paddingTop: theme.spacing[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  head: { gap: theme.spacing[2] },
  courier: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: theme.radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.iconSurface,
    borderWidth: 1,
    borderColor: theme.colors.accentBorder,
  },
  courierText: { flex: 1, gap: 2 },
  courierName: {
    color: theme.colors.foreground,
    fontSize: 15,
    fontWeight: theme.fontWeights.semibold,
  },
  muted: { color: theme.colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[2] },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[3],
    paddingLeft: theme.spacing[4],
    paddingRight: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.surfaceMuted,
  },
  codeText: { flex: 1, gap: 2, paddingVertical: theme.spacing[2] },
  codeLabel: { color: theme.colors.mutedForeground, fontSize: 12 },
  code: {
    color: theme.colors.foreground,
    fontSize: 15,
    fontWeight: theme.fontWeights.semibold,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.3,
  },
  copy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: theme.touchTarget,
    minWidth: theme.touchTarget,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.radii.md,
    justifyContent: 'center',
  },
  copyPressed: { backgroundColor: theme.colors.border },
  copyLabel: { color: theme.colors.link, fontSize: 14, fontWeight: theme.fontWeights.semibold },
  delivered: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  deliveredText: { color: theme.colors.body, fontSize: 14 },
  timeline: { gap: theme.spacing[2] },
  overline: {
    color: theme.colors.mutedForeground,
    fontSize: 11,
    fontWeight: theme.fontWeights.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
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
  eventSpacing: { paddingBottom: theme.spacing[3] },
  eventLabel: { color: theme.colors.body, fontSize: 15 },
  eventLabelLatest: { color: theme.colors.foreground, fontWeight: theme.fontWeights.semibold },
  eventTime: { color: theme.colors.mutedForeground, fontSize: 13 },
  footnote: { color: theme.colors.mutedForeground, fontSize: 12, lineHeight: 16 },
});
