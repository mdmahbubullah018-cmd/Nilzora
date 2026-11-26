import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatMoney, spokenMoney } from '@/lib/money';
import { useOnline } from '@/network/connectivity';
import { theme } from '@/theme';

export interface PlaceOrderButtonProps {
  /** The total this button confirms; null while there is none to confirm. */
  totalMinor: number | null;
  /** Shows a spinner and ignores further presses while the order is on its way. */
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}

/**
 * The primary "Place order" action. It looks like the shared primary Button, but it is its
 * own component because it reads differently to the eye and to a screen reader: the visible
 * label shows the amount with the ৳ sign ("Place order · ৳2,260"), while the spoken label
 * says it in words ("Place order, total 2,260 taka"), which screen readers pronounce
 * reliably where they stumble on the currency sign.
 */
export function PlaceOrderButton({
  totalMinor,
  loading,
  disabled,
  onPress,
}: PlaceOrderButtonProps) {
  // An order is only ever placed when the server can confirm it: offline, the button is off
  // and says why, instead of looking pressable and failing.
  const online = useOnline();
  const inactive = disabled || loading || !online;
  const label = totalMinor === null ? 'Place order' : `Place order · ${formatMoney(totalMinor)}`;
  const spoken =
    totalMinor === null ? 'Place order' : `Place order, total ${spokenMoney(totalMinor)}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={
        !online
          ? 'You are offline. Connect to the internet to place your order.'
          : totalMinor === null
            ? undefined
            : 'Paid in cash on delivery'
      }
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor:
            pressed && !inactive ? theme.colors.primaryActionHover : theme.colors.primaryAction,
        },
        (disabled || !online) && !loading ? styles.disabled : null,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="small" color={theme.colors.primaryActionForeground} />
        ) : null}
        <Text style={styles.label}>{online ? label : 'You are offline'}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: theme.touchTarget,
    borderRadius: theme.radii.full,
    borderWidth: 1,
    borderColor: theme.colors.primaryAction,
    paddingHorizontal: theme.spacing[4],
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  label: {
    color: theme.colors.primaryActionForeground,
    fontSize: 16,
    fontWeight: theme.fontWeights.semibold,
  },
  disabled: { opacity: 0.5 },
});
