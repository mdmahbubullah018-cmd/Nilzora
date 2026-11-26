import type { Availability } from '@nilzora/contracts';
import { StyleSheet, Text, View } from 'react-native';
import { theme, type NoticeTone } from '@/theme';

/** Shoppers see a stock band from the API, never an exact stock level (storefront wording). */
const AVAILABILITY: Record<Availability, { tone: NoticeTone; label: string }> = {
  in_stock: { tone: 'success', label: 'In stock' },
  low_stock: { tone: 'warning', label: 'Only a few left' },
  out_of_stock: { tone: 'danger', label: 'Out of stock' },
};

export function availabilityLabel(availability: Availability): string {
  return AVAILABILITY[availability].label;
}

/** A small pill: coloured dot and a text label, so colour is never the only signal. */
export function AvailabilityBadge({ availability }: { availability: Availability }) {
  const { tone, label } = AVAILABILITY[availability];
  const colors = theme.notice[tone];
  return (
    <View
      accessible
      accessibilityLabel={`Availability: ${label}`}
      style={[styles.badge, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={[styles.dot, { backgroundColor: colors.icon }]} />
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
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
