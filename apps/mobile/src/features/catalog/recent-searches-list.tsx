import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppIcon } from '@/components/icon';
import { theme } from '@/theme';

export interface RecentSearchesProps {
  queries: readonly string[];
  onSelect: (query: string) => void;
  onClear: () => void;
}

/**
 * "Recent searches" under the search field, shown while it is focused and empty. Each term
 * runs that search again; clearing forgets the whole list on this device. It is device-local
 * history, not a server suggestion list.
 */
export function RecentSearches({ queries, onSelect, onClear }: RecentSearchesProps) {
  if (queries.length === 0) return null;

  return (
    <View style={styles.container} testID="recent-searches">
      <View style={styles.headerRow}>
        <Text style={styles.title}>Recent searches</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear recent searches"
          accessibilityHint="Removes every saved search from this device"
          hitSlop={6}
          onPress={onClear}
          style={({ pressed }) => [styles.clearButton, pressed ? styles.pressed : null]}
        >
          <Text style={styles.clearText}>Clear</Text>
        </Pressable>
      </View>
      {queries.map((query) => (
        <Pressable
          key={query}
          accessibilityRole="button"
          accessibilityLabel={`Search for ${query}`}
          accessibilityHint="Runs this search again"
          android_ripple={{ color: theme.colors.surfaceMuted }}
          onPress={() => {
            onSelect(query);
          }}
          style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
        >
          <AppIcon name="history" size="md" color={theme.colors.mutedForeground} />
          <Text numberOfLines={1} style={styles.query}>
            {query}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: theme.spacing[1] },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[3],
    minHeight: theme.touchTarget,
  },
  title: { color: theme.colors.mutedForeground, ...theme.text.caption, textTransform: 'uppercase' },
  clearButton: {
    minHeight: theme.touchTarget,
    justifyContent: 'center',
    paddingLeft: theme.spacing[3],
  },
  clearText: { color: theme.colors.link, ...theme.text.bodyStrong },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    minHeight: theme.touchTarget,
    borderRadius: theme.radii.md,
    paddingHorizontal: theme.spacing[1],
  },
  pressed: { opacity: 0.6 },
  query: { flex: 1, color: theme.colors.foreground, ...theme.text.body },
});
