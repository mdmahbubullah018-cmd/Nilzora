import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/theme';

const variants = {
  primary: {
    background: theme.colors.primaryAction,
    pressed: theme.colors.primaryActionHover,
    foreground: theme.colors.primaryActionForeground,
    pressedForeground: theme.colors.primaryActionForeground,
    border: theme.colors.primaryAction,
  },
  secondary: {
    background: theme.colors.surface,
    pressed: theme.colors.border,
    foreground: theme.colors.foreground,
    pressedForeground: theme.colors.foreground,
    border: theme.colors.inputBorder,
  },
  /** A quiet text action, e.g. "Forgot your password?". */
  link: {
    background: 'transparent',
    pressed: theme.colors.iconSurface,
    foreground: theme.colors.link,
    pressedForeground: theme.colors.primaryActionHover,
    border: 'transparent',
  },
  danger: {
    background: theme.colors.surface,
    pressed: theme.notice.danger.surface,
    foreground: theme.colors.dangerAction,
    pressedForeground: theme.colors.dangerActionHover,
    border: theme.colors.dangerAction,
  },
} as const;

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: keyof typeof variants;
  /** Shows a spinner and blocks further presses until the action finishes. */
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
}

/** Full-width action button with a 48dp minimum touch target. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  accessibilityHint,
}: ButtonProps) {
  const colors = variants[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: pressed && !inactive ? colors.pressed : colors.background,
          borderColor: colors.border,
        },
        disabled && !loading ? styles.disabled : null,
      ]}
    >
      {({ pressed }) => {
        const color = pressed && !inactive ? colors.pressedForeground : colors.foreground;
        return (
          <View style={styles.content}>
            {loading ? <ActivityIndicator size="small" color={color} /> : null}
            <Text style={[styles.label, { color }]}>{label}</Text>
          </View>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: theme.radii.full,
    borderWidth: 1,
    paddingHorizontal: theme.spacing[5],
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  label: { ...theme.text.subheading, letterSpacing: 0.1 },
  disabled: { opacity: 0.5 },
});
