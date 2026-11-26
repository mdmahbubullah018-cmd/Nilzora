import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { theme } from '@/theme';

export function Card({
  children,
  style,
  flat = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Keeps the surface and its hairline edge but drops the shadow, for rows in a list. */
  flat?: boolean;
}) {
  return <View style={[styles.card, flat ? styles.flat : null, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    overflow: 'hidden',
    ...theme.shadow.card,
  },
  flat: { elevation: 0, shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 } },
});
