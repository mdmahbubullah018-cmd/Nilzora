import type { Category } from '@nilzora/contracts';
import { StyleSheet, Text, View } from 'react-native';
import { PressableScale } from '@/components/pressable-scale';
import { theme } from '@/theme';
import { branchProductCount, productCountLabel } from './catalog-query';
import { CategoryCover } from './category-cover';

/*
 * A category's subcategories, as compact named cards in two columns. The name is the point: it
 * is set in full-strength type beside a small cover (the cover falls back to the category's
 * icon), so a subcategory is recognisable by its words and never by its picture alone. The
 * cards are smaller than the main category tiles on purpose: they are a way to narrow down, not
 * a second shop window. Everything comes from the published categories the API returns.
 */

const GAP = theme.spacing[2];

export function SubcategoryGrid({
  parentName,
  items,
  onSelect,
}: {
  parentName: string;
  items: readonly Category[];
  onSelect: (category: Category) => void;
}) {
  if (items.length === 0) return null;
  return (
    <View accessibilityRole="list" style={styles.block}>
      <Text accessibilityRole="header" style={styles.heading}>
        Shop {parentName} by type
      </Text>
      <View style={styles.grid}>
        {items.map((child) => {
          const count = productCountLabel(branchProductCount(child));
          return (
            <View key={child.slug} style={styles.cell}>
              <PressableScale
                accessibilityLabel={`${child.name}, ${count}`}
                accessibilityHint="Opens this subcategory"
                onPress={() => {
                  onSelect(child);
                }}
                style={styles.card}
              >
                <CategoryCover
                  category={child}
                  iconSize={theme.icon.size.md}
                  testID="subcategory-cover"
                  style={styles.cover}
                />
                <View style={styles.text}>
                  <Text numberOfLines={2} style={styles.name}>
                    {child.name}
                  </Text>
                  <Text numberOfLines={1} style={styles.count}>
                    {count}
                  </Text>
                </View>
              </PressableScale>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: theme.spacing[2] },
  heading: { color: theme.colors.foreground, ...theme.text.bodyStrong },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  // Two columns: each cell takes just under half the row, the gap making up the rest.
  cell: { flexGrow: 1, flexBasis: '45%' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    minHeight: 52,
    paddingVertical: 6,
    paddingHorizontal: 6,
    paddingRight: theme.spacing[3],
    borderRadius: theme.radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  cover: { width: 38, height: 38, borderRadius: theme.radii.md },
  text: { flex: 1, minWidth: 0, gap: 1 },
  name: {
    color: theme.colors.foreground,
    fontSize: 13.5,
    lineHeight: 17,
    fontWeight: theme.fontWeights.semibold,
  },
  count: { color: theme.colors.mutedForeground, fontSize: 11, lineHeight: 14 },
});
