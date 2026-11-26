import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '@/theme';
import { Logo } from './logo';

export interface TabHeaderProps {
  /** A small line under the brand row (Home's promise, for example). */
  subtitle?: string;
  /** A control at the end of the brand row, such as Home's cart. */
  action?: ReactNode;
  /** Content below the brand row, such as Home's search box. */
  children?: ReactNode;
}

/**
 * The top of every tab screen: the brand and an optional subtitle. A screen that needs a
 * control beside the brand passes it as `action` (Home passes the cart, which the bar no
 * longer carries); screens opened above the tabs put the cart in their navigation header
 * instead (see app/_layout.tsx).
 */
export function TabHeader({ subtitle, action, children }: TabHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.brandRow}>
        <View style={styles.brand}>
          <Logo size="sm" />
          {subtitle ? (
            <Text numberOfLines={1} style={styles.subtitle}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {action}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: theme.spacing[4] },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[3],
  },
  brand: { flex: 1, gap: 2 },
  subtitle: { color: theme.colors.mutedForeground, ...theme.text.caption },
});
