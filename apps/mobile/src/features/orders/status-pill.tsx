import type { OrderStatus, PaymentStatus } from '@nilzora/contracts';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '@/theme';
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONES,
  type StatusTone,
} from './status';

/** Colours of a pill: the notice tones, plus a quiet grey for finished or cancelled things. */
function pillColors(tone: StatusTone) {
  if (tone === 'neutral') {
    return {
      surface: theme.colors.surfaceMuted,
      border: theme.colors.borderStrong,
      foreground: theme.colors.body,
      dot: theme.colors.mutedForeground,
    };
  }
  const colors = theme.notice[tone];
  return {
    surface: colors.surface,
    border: colors.border,
    foreground: colors.foreground,
    dot: colors.icon,
  };
}

export interface StatusPillProps {
  tone: StatusTone;
  label: string;
  /** Spoken name; defaults to the visible label. */
  accessibilityLabel?: string;
}

/** A small pill with a coloured dot and a text label, so colour is never the only signal. */
export function StatusPill({ tone, label, accessibilityLabel }: StatusPillProps) {
  const colors = pillColors(tone);
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? label}
      style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={[styles.dot, { backgroundColor: colors.dot }]} />
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
    </View>
  );
}

export function OrderStatusPill({ status }: { status: OrderStatus }) {
  return (
    <StatusPill
      tone={ORDER_STATUS_TONES[status]}
      label={ORDER_STATUS_LABELS[status]}
      accessibilityLabel={`Order status: ${ORDER_STATUS_LABELS[status]}`}
    />
  );
}

export function PaymentStatusPill({ status }: { status: PaymentStatus }) {
  return (
    <StatusPill
      tone={PAYMENT_STATUS_TONES[status]}
      label={PAYMENT_STATUS_LABELS[status]}
      accessibilityLabel={`Payment status: ${PAYMENT_STATUS_LABELS[status]}`}
    />
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radii.full,
    borderWidth: 1,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 12, fontWeight: theme.fontWeights.semibold },
});
