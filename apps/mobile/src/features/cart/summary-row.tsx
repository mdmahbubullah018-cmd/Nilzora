import { StyleSheet, Text, View } from 'react-native';
import { theme } from '@/theme';

export interface SummaryRowProps {
  label: string;
  /** What is shown at the end of the row, e.g. "৳1,250". */
  value: string;
  /** What a screen reader says instead of `value` (money read as "1,250 taka"). */
  spokenValue?: string;
  /** The final amount: set apart and larger. */
  total?: boolean;
}

/** One label / amount line of an order summary, read as a single "label: amount". */
export function SummaryRow({ label, value, spokenValue, total = false }: SummaryRowProps) {
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${spokenValue ?? value}`}
      style={[styles.row, total ? styles.total : null]}
    >
      <Text style={total ? styles.totalLabel : styles.label}>{label}</Text>
      <Text style={total ? styles.totalValue : styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: theme.spacing[4],
  },
  total: {
    marginTop: theme.spacing[1],
    paddingTop: theme.spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.borderStrong,
  },
  label: { flexShrink: 1, color: theme.colors.mutedForeground, fontSize: 14 },
  value: {
    color: theme.colors.foreground,
    fontSize: 14,
    fontWeight: theme.fontWeights.medium,
    fontVariant: ['tabular-nums'],
  },
  totalLabel: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: 16,
    fontWeight: theme.fontWeights.semibold,
  },
  totalValue: {
    color: theme.colors.foreground,
    fontSize: 20,
    fontWeight: theme.fontWeights.semibold,
    fontVariant: ['tabular-nums'],
  },
});
