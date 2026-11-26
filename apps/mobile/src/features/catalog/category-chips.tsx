import type { Category } from '@nilzora/contracts';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/theme';
import { SCREEN_PADDING } from './catalog-layout';

export interface CategoryChipsProps {
  categories: readonly Pick<Category, 'slug' | 'name'>[];
  /** The slug being filtered by; undefined for "All". */
  selected: string | undefined;
  onSelect: (slug: string | undefined) => void;
}

/** "fashion-wear" as "Fashion wear": a stand-in name for a category the list did not return. */
export function categoryNameFromSlug(slug: string): string {
  const words = slug.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      hitSlop={{ top: 4, bottom: 4 }}
      onPress={onPress}
      android_ripple={{ color: selected ? 'rgba(255, 255, 255, 0.25)' : 'rgba(2, 132, 199, 0.14)' }}
      style={[styles.chip, selected ? styles.chipSelected : null]}
    >
      <Text style={[styles.label, selected ? styles.labelSelected : null]}>{label}</Text>
    </Pressable>
  );
}

/**
 * "All" and one chip per category, as a single-choice group in a sideways scroller that runs
 * to the screen edges. The selected chip is navy with white text, like the web's active pill.
 */
export function CategoryChips({ categories, selected, onSelect }: CategoryChipsProps) {
  // A category from a link that the list does not contain still shows, so the filter is visible.
  const known = selected === undefined || categories.some((entry) => entry.slug === selected);
  const chips = known
    ? categories
    : [...categories, { slug: selected, name: categoryNameFromSlug(selected) }];

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Category" style={styles.bleed}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.chips}
      >
        <Chip
          label="All"
          selected={selected === undefined}
          onPress={() => {
            onSelect(undefined);
          }}
        />
        {chips.map((category) => (
          <Chip
            key={category.slug}
            label={category.name}
            selected={category.slug === selected}
            onPress={() => {
              onSelect(category.slug);
            }}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bleed: { marginHorizontal: -SCREEN_PADDING },
  chips: {
    gap: theme.spacing[2],
    paddingHorizontal: SCREEN_PADDING,
  },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.radii.full,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
  },
  chipSelected: {
    borderColor: theme.colors.navy,
    backgroundColor: theme.colors.navy,
  },
  label: {
    color: theme.colors.foreground,
    fontSize: 14,
    fontWeight: theme.fontWeights.medium,
  },
  labelSelected: { color: theme.colors.softBackground },
});
