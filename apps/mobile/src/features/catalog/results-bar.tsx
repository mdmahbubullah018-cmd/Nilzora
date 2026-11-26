import type { CatalogSort } from '@nilzora/contracts';
import { ArrowUpDown, Check, ChevronDown, ChevronUp } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/theme';
import { SORT_LABELS } from './catalog-query';

export interface ResultsBarProps<T extends CatalogSort = CatalogSort> {
  /** What was found, e.g. "24 products"; announced politely when it changes. */
  summary: string | null;
  /**
   * The sorts on offer. Omit them (with `selected` and `onSelect`) where the sort is chosen in
   * the filter toolbar, so the bar is only the count.
   */
  options?: readonly T[];
  selected?: T;
  onSelect?: (sort: T) => void;
}

/**
 * The result count and the sort control. The control is a button that opens a short
 * single-choice list right below it (no modal, so focus and the back button behave), and it
 * closes when a choice is made. Sorts are the storefront's, with its labels. The sort type is
 * generic so a screen can offer only the sorts its own endpoint accepts.
 */
export function ResultsBar<T extends CatalogSort = CatalogSort>({
  summary,
  options,
  selected,
  onSelect,
}: ResultsBarProps<T>) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronUp : ChevronDown;
  // Without sorts the bar is only the count, which is announced politely when it changes.
  if (options === undefined || selected === undefined || onSelect === undefined) {
    return (
      <View style={styles.container}>
        <View style={styles.row}>
          <Text accessibilityLiveRegion="polite" style={styles.summary}>
            {summary ?? ''}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text accessibilityLiveRegion="polite" style={styles.summary}>
          {summary ?? ''}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Sort by, ${SORT_LABELS[selected]}`}
          accessibilityState={{ expanded: open }}
          onPress={() => {
            setOpen((value) => !value);
          }}
          android_ripple={{ color: 'rgba(2, 132, 199, 0.14)' }}
          style={styles.trigger}
        >
          <ArrowUpDown size={16} color={theme.colors.link} accessible={false} />
          <Text style={styles.triggerText}>{SORT_LABELS[selected]}</Text>
          <Chevron size={16} color={theme.colors.link} accessible={false} />
        </Pressable>
      </View>

      {open ? (
        <View accessibilityRole="radiogroup" accessibilityLabel="Sort by" style={styles.panel}>
          {options.map((option) => {
            const checked = option === selected;
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityLabel={SORT_LABELS[option]}
                accessibilityState={{ checked }}
                onPress={() => {
                  setOpen(false);
                  onSelect(option);
                }}
                android_ripple={{ color: 'rgba(2, 132, 199, 0.14)' }}
                style={styles.option}
              >
                <Text style={[styles.optionText, checked ? styles.optionTextChecked : null]}>
                  {SORT_LABELS[option]}
                </Text>
                {checked ? <Check size={18} color={theme.colors.link} accessible={false} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: theme.spacing[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[3],
    minHeight: theme.touchTarget,
  },
  summary: {
    flex: 1,
    color: theme.colors.mutedForeground,
    fontSize: 14,
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.radii.full,
    overflow: 'hidden',
  },
  triggerText: {
    color: theme.colors.link,
    fontSize: 14,
    fontWeight: theme.fontWeights.semibold,
  },
  panel: {
    borderRadius: theme.radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.spacing[4],
  },
  optionText: { color: theme.colors.foreground, fontSize: 15 },
  optionTextChecked: { fontWeight: theme.fontWeights.semibold, color: theme.colors.link },
});
