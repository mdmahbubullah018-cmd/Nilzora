import type { ProductVariant } from '@nilzora/contracts';
import { Check } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/theme';
import {
  isValueAvailable,
  isValueOffered,
  requirementName,
  type VariantOptionGroup,
} from './variant-selection';

export interface VariantPickerProps {
  variants: readonly ProductVariant[];
  groups: readonly VariantOptionGroup[];
  selected: Record<string, string | undefined>;
  onSelect: (attributeSlug: string, valueSlug: string) => void;
  /**
   * The customer tried to continue without choosing: every attribute still unanswered is
   * outlined and says "Select a size". Off by default (the product screen has its own note).
   */
  showRequired?: boolean;
}

/**
 * One row of choices per attribute. A colour is drawn as a swatch with its name for screen
 * readers; a size as a chip. A value that is sold out next to the current choices stays
 * visible and dimmed but cannot be picked, while one that is simply not sold with the
 * current choice stays pressable: picking it re-scopes the other choices.
 */
export function VariantPicker({
  variants,
  groups,
  selected,
  onSelect,
  showRequired = false,
}: VariantPickerProps) {
  return (
    <View style={styles.wrap}>
      {groups.map((group) => {
        const chosen = group.values.find((value) => value.slug === selected[group.slug]);
        const missing = showRequired && chosen === undefined;
        return (
          <View key={group.slug} style={[styles.group, missing ? styles.groupMissing : null]}>
            <Text style={styles.label}>
              {group.name}
              {chosen ? <Text style={styles.chosen}> · {chosen.value}</Text> : null}
            </Text>
            {missing ? (
              <Text accessibilityRole="alert" style={styles.required}>
                Select a {requirementName(group)}
              </Text>
            ) : null}
            <View style={styles.values}>
              {group.values.map((value) => {
                const isSelected = selected[group.slug] === value.slug;
                const available = isValueAvailable(
                  variants,
                  groups,
                  selected,
                  group.slug,
                  value.slug,
                );
                // Sold out next to the current choices, or not sold with them at all.
                const offered =
                  available || isValueOffered(variants, groups, selected, group.slug, value.slug);
                const note = available ? null : offered ? 'Sold out' : 'not with this choice';
                const swatch = group.kind === 'color' ? value.swatchHex : null;
                const blocked = offered && !available && !isSelected;
                const press = () => {
                  if (blocked) return;
                  onSelect(group.slug, value.slug);
                };
                if (swatch) {
                  return (
                    <Pressable
                      key={value.slug}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected, disabled: blocked }}
                      accessibilityLabel={`${value.value}${note === null ? '' : `, ${note}`}`}
                      onPress={press}
                      // A compact swatch is smaller than a touch target on purpose; the extra
                      // slop keeps the whole 44dp around it pressable.
                      hitSlop={5}
                      style={({ pressed }) => [
                        styles.swatch,
                        isSelected ? styles.swatchSelected : null,
                        blocked ? styles.swatchUnavailable : null,
                        pressed ? styles.valuePressed : null,
                        { backgroundColor: swatch },
                      ]}
                    >
                      {isSelected ? <Check size={15} color="#ffffff" strokeWidth={3} /> : null}
                    </Pressable>
                  );
                }
                return (
                  <Pressable
                    key={value.slug}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected, disabled: blocked }}
                    accessibilityLabel={note === null ? value.value : `${value.value}, ${note}`}
                    onPress={press}
                    style={({ pressed }) => [
                      styles.value,
                      isSelected ? styles.valueSelected : null,
                      !available && !isSelected ? styles.valueUnavailable : null,
                      pressed ? styles.valuePressed : null,
                    ]}
                  >
                    {isSelected ? (
                      <Check size={14} color={theme.brand.onSolid} strokeWidth={2.4} />
                    ) : null}
                    <Text
                      style={[
                        styles.valueText,
                        isSelected ? styles.valueTextSelected : null,
                        !available && !isSelected ? styles.valueTextUnavailable : null,
                      ]}
                    >
                      {value.value}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: theme.spacing[2] },
  group: { gap: theme.spacing[1] + 2 },
  groupMissing: {
    padding: theme.spacing[2],
    margin: -theme.spacing[2],
    borderRadius: theme.radii.lg,
    borderWidth: 1.5,
    borderColor: theme.colors.fieldError,
  },
  required: {
    color: theme.colors.fieldError,
    fontSize: 13,
    fontWeight: theme.fontWeights.semibold,
  },
  label: {
    color: theme.colors.foreground,
    fontSize: 14,
    fontWeight: theme.fontWeights.semibold,
  },
  chosen: { color: theme.colors.mutedForeground, fontWeight: theme.fontWeights.regular },
  values: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[1] + 2 },
  value: {
    minHeight: theme.touchTarget - 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1] + 2,
    paddingHorizontal: theme.spacing[3] + 2,
    borderRadius: theme.radii.full,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.surface,
  },
  valuePressed: { opacity: 0.85 },
  valueSelected: {
    borderColor: theme.brand.navy,
    backgroundColor: theme.brand.navy,
  },
  valueUnavailable: { opacity: 0.45 },
  // A neat 34dp disc: small enough that four or five colours sit on one line, with the chosen
  // one marked by a navy ring rather than a bigger circle.
  swatch: {
    width: 34,
    height: 34,
    borderRadius: theme.radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.18)',
  },
  swatchSelected: {
    borderColor: theme.brand.navy,
    borderWidth: 2,
  },
  swatchUnavailable: { opacity: 0.3, borderStyle: 'dashed' },
  valueText: {
    color: theme.colors.foreground,
    fontSize: 14,
    fontWeight: theme.fontWeights.medium,
  },
  valueTextSelected: { color: theme.brand.onSolid },
  valueTextUnavailable: { color: theme.colors.mutedForeground },
});
