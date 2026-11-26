import type { ComponentType } from 'react';
import type { ColorValue } from 'react-native';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '@/theme';
import { Button } from './button';

/**
 * Any outline icon an empty state can show: a Lucide icon, or one of the app's own drawings
 * such as the cart. The props are Lucide's, so both kinds slot in.
 */
export type EmptyStateIcon = ComponentType<{
  size?: number | string;
  strokeWidth?: number | string;
  color?: ColorValue | null;
  accessible?: boolean;
}>;

export interface EmptyStateProps {
  icon: EmptyStateIcon;
  title: string;
  description?: string;
  /** A single next step, such as "Continue shopping". */
  action?: { label: string; onPress: () => void };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.halo}>
        <View style={styles.iconWrap}>
          <Icon size={30} strokeWidth={1.6} color={theme.colors.primary} accessible={false} />
        </View>
      </View>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {action ? (
        <View style={styles.action}>
          <Button label={action.label} onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[10],
  },
  halo: {
    width: 104,
    height: 104,
    marginBottom: theme.spacing[1],
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(2, 132, 199, 0.06)',
  },
  iconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.iconSurface,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  title: {
    color: theme.colors.foreground,
    ...theme.text.heading,
    textAlign: 'center',
  },
  description: {
    color: theme.colors.mutedForeground,
    ...theme.text.body,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 300,
  },
  action: {
    alignSelf: 'stretch',
    marginTop: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
  },
});
