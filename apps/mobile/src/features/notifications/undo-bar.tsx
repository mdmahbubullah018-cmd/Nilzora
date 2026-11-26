import { useContext } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { theme } from '@/theme';

/**
 * A short message with one action, sitting above the bottom edge: "Notification deleted · Undo".
 * It is a live region, so a screen reader announces it; the action keeps a full touch target.
 */
export function UndoBar({
  message,
  actionLabel,
  onAction,
  tone = 'neutral',
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
  tone?: 'neutral' | 'error';
}) {
  // Read without throwing: there is always a provider in the app, and none in an isolated render.
  const insets = useContext(SafeAreaInsetsContext);
  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: (insets?.bottom ?? 0) + theme.spacing[4] }]}
    >
      <View
        accessibilityLiveRegion="polite"
        style={[styles.bar, tone === 'error' && styles.barError]}
        testID="undo-bar"
      >
        <Text style={styles.message} numberOfLines={2}>
          {message}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          hitSlop={8}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 16 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    minHeight: 52,
    width: '100%',
    maxWidth: 520,
    paddingLeft: theme.spacing[4],
    paddingRight: theme.spacing[2],
    borderRadius: 14,
    backgroundColor: theme.colors.foreground,
    ...theme.shadow.card,
  },
  barError: { backgroundColor: theme.colors.fieldError },
  message: { flex: 1, color: theme.colors.surface, fontSize: 14, lineHeight: 19 },
  action: {
    minHeight: 44,
    minWidth: 64,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  pressed: { opacity: 0.7 },
  actionText: { color: theme.colors.surface, fontSize: 14, fontWeight: '700', letterSpacing: 0.3 },
});
