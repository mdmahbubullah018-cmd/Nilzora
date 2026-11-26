import type { ShoppingZone } from '@nilzora/contracts';
import { X } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/theme';

/*
 * The collection a Shop listing is narrowed to.
 *
 * A collection is not a filter on a page of its own: it is a context the shopper arrived with
 * (from a Home tile or a shared link), so it is shown above the category chips with one way
 * out. Removing it keeps the search, category and sort exactly as they were.
 */

export function ZoneChip({
  zone,
  onRemove,
}: {
  zone: Pick<ShoppingZone, 'name'>;
  onRemove: () => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.pill}>
        <Text numberOfLines={1} style={styles.text}>
          Collection: {zone.name}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Stop browsing the ${zone.name} collection`}
          accessibilityHint="Keeps your search and filters"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          onPress={onRemove}
          style={styles.remove}
        >
          <X size={16} color={theme.colors.primaryActionForeground} accessible={false} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  pill: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    minHeight: 36,
    paddingLeft: theme.spacing[4],
    paddingRight: theme.spacing[2],
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.primaryAction,
  },
  text: {
    ...theme.text.caption,
    flexShrink: 1,
    color: theme.colors.primaryActionForeground,
    fontWeight: theme.fontWeights.semibold,
  },
  remove: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.full,
  },
});
