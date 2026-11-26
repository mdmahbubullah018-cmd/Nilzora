import { MAX_LINE_QUANTITY } from '@nilzora/contracts';
import { Minus, Plus, type LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/theme';

export interface QuantityStepperProps {
  value: number;
  /** Called only with a quantity between `min` and `max`. */
  onChange: (next: number) => void;
  min?: number;
  /** The most allowed right now (stock or the per-order limit). Defaults to the line limit. */
  max?: number;
  /** Product name, so a list of steppers is not a list of identical "Decrease quantity" buttons. */
  productName?: string;
  disabled?: boolean;
  /**
   * A smaller control for a dense row such as the cart: 36dp buttons with a 16dp glyph and a
   * shorter value. The touch target stays comfortable thanks to the hit slop, and the
   * accessibility labels, limits and announcements are identical.
   */
  compact?: boolean;
}

function StepButton({
  icon: Icon,
  label,
  hint,
  disabled,
  compact,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  disabled: boolean;
  compact: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={compact ? 6 : 4}
      onPress={onPress}
      style={({ pressed }) => [
        compact ? styles.buttonCompact : styles.button,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <Icon
        size={compact ? 16 : 20}
        color={theme.colors.foreground}
        strokeWidth={compact ? 2.25 : undefined}
        accessible={false}
      />
    </Pressable>
  );
}

/**
 * Minus / value / plus control with 48dp targets (36dp in the compact form). The value is
 * announced as "Quantity, 2" and changes are announced politely; a button at its limit is
 * disabled and says why.
 */
export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = MAX_LINE_QUANTITY,
  productName,
  disabled = false,
  compact = false,
}: QuantityStepperProps) {
  const forProduct = productName ? ` of ${productName}` : '';
  const canDecrease = !disabled && value > min;
  const canIncrease = !disabled && value < max;
  // Above the maximum (stock dropped) a step down lands back inside the limit.
  const stepDown = Math.max(Math.min(value - 1, max), min);

  return (
    <View style={compact ? styles.containerCompact : styles.container}>
      <StepButton
        icon={Minus}
        label={`Decrease quantity${forProduct}`}
        hint={canDecrease ? `Sets the quantity to ${stepDown}` : `The minimum is ${min}`}
        disabled={!canDecrease}
        compact={compact}
        onPress={() => onChange(stepDown)}
      />
      <Text
        accessible
        accessibilityLabel={`Quantity, ${value}`}
        accessibilityLiveRegion="polite"
        style={compact ? styles.valueCompact : styles.value}
      >
        {value}
      </Text>
      <StepButton
        icon={Plus}
        label={`Increase quantity${forProduct}`}
        hint={
          canIncrease ? `Sets the quantity to ${value + 1}` : `The most you can order is ${max}`
        }
        disabled={!canIncrease}
        compact={compact}
        onPress={() => onChange(value + 1)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: theme.colors.inputBorder,
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.surface,
  },
  button: {
    width: theme.touchTarget,
    height: theme.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.full,
  },
  /** The cart's smaller control: a shorter box that still leaves a comfortable target. */
  containerCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: theme.colors.inputBorder,
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.surface,
  },
  buttonCompact: {
    width: 36,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.full,
  },
  pressed: { backgroundColor: theme.colors.surfaceMuted },
  disabled: { opacity: 0.4 },
  value: {
    minWidth: 40,
    textAlign: 'center',
    color: theme.colors.foreground,
    fontSize: 16,
    fontWeight: theme.fontWeights.semibold,
    fontVariant: ['tabular-nums'],
  },
  valueCompact: {
    minWidth: 28,
    textAlign: 'center',
    color: theme.colors.foreground,
    fontSize: 15,
    fontWeight: theme.fontWeights.semibold,
    fontVariant: ['tabular-nums'],
  },
});
