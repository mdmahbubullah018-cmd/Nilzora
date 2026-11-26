import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { theme } from '@/theme';
import { AppIcon, type IconName } from './icon';

export interface ListItemProps {
  icon: IconName;
  label: string;
  /** What happens when it is opened; read after the label. */
  hint?: string;
  onPress: () => void;
  /** The last row of a card has no divider under it. */
  last?: boolean;
  /** A count, a value or a state pill shown before the chevron. */
  trailing?: ReactNode;
}

/** One tappable row in a settings-style card: icon, label, optional value, chevron. */
export function ListItem({ icon, label, hint, onPress, last = false, trailing }: ListItemProps) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint={hint}
      android_ripple={{ color: theme.colors.border }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        last ? null : styles.divider,
        pressed ? styles.pressed : null,
      ]}
    >
      <AppIcon name={icon} size="md" color={theme.colors.primary} />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {trailing}
      <AppIcon name="chevronRight" size="sm" color={theme.colors.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    minHeight: 56,
    paddingHorizontal: theme.spacing[5],
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  pressed: { backgroundColor: theme.colors.surfaceMuted },
  label: {
    flex: 1,
    color: theme.colors.foreground,
    ...theme.text.subheading,
    fontWeight: theme.fontWeights.medium,
  },
});
