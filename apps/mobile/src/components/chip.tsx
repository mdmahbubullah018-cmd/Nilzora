import { Pressable, StyleSheet, Text } from 'react-native';
import { theme } from '@/theme';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  disabled?: boolean;
  /** Chips that carry a price or count read better a little wider. */
  grow?: boolean;
}

/**
 * A selectable pill used for sizes and filters. Selection is conveyed by colour *and* by an
 * accessibility state, so it is not colour-only.
 */
export function Chip({
  label,
  selected = false,
  onPress,
  disabled = false,
  grow = false,
}: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        grow ? styles.grow : null,
        selected ? styles.selected : null,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      {({ pressed }) => (
        <Text
          numberOfLines={1}
          style={[
            styles.label,
            selected ? styles.selectedLabel : null,
            pressed && !disabled ? styles.pressedLabel : null,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.radii.full,
    borderWidth: 1,
    borderColor: theme.colors.inputBorder,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flexGrow: 1 },
  selected: {
    borderColor: theme.colors.primaryAction,
    backgroundColor: theme.colors.primaryAction,
  },
  pressed: { transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.45 },
  label: {
    ...theme.text.body,
    fontWeight: theme.fontWeights.medium,
    color: theme.colors.foreground,
  },
  selectedLabel: {
    color: theme.colors.primaryActionForeground,
    fontWeight: theme.fontWeights.semibold,
  },
  pressedLabel: { opacity: 0.9 },
});
