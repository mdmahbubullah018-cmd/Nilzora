import { RefreshCw, WifiOff } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { retryConnection, useOnline } from '@/network/connectivity';
import { theme } from '@/theme';
import { TAB_BAR_SPACE } from './tab-bar';

/*
 * The quiet "you're offline" pill. It appears only after a request really failed to reach the
 * server, says that what is on screen is saved information, and offers one retry. It sits above
 * the tab bar, takes no space in any screen's layout, and is gone the moment the server answers.
 * It does not animate (nothing to switch off for reduced motion) and is announced politely.
 */
export function OfflineBanner() {
  const online = useOnline();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  if (online) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: insets.bottom + TAB_BAR_SPACE + theme.spacing[2] }]}
    >
      <View style={styles.pill} accessibilityLiveRegion="polite" testID="offline-banner">
        <WifiOff size={15} color={theme.colors.foreground} accessible={false} />
        <Text style={styles.text} numberOfLines={2}>
          You are offline. Showing saved information.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Check the connection again"
          disabled={busy}
          hitSlop={8}
          onPress={() => {
            setBusy(true);
            void retryConnection().finally(() => {
              setBusy(false);
            });
          }}
          style={({ pressed }) => [styles.retry, pressed ? styles.pressed : null]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={theme.colors.primary} />
          ) : (
            <RefreshCw size={16} color={theme.colors.primary} accessible={false} />
          )}
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 16 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    maxWidth: 420,
    paddingVertical: 6,
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[1],
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(2, 132, 199, 0.35)',
    backgroundColor: '#E0F2FE',
  },
  text: { flexShrink: 1, color: theme.colors.foreground, fontSize: 13, lineHeight: 18 },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 36,
    paddingHorizontal: theme.spacing[2],
    borderRadius: 999,
  },
  pressed: { opacity: 0.6 },
  retryText: { color: theme.colors.primary, fontSize: 13, fontWeight: '600' },
});
