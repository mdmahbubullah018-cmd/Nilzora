import type { CatalogSort, ProductFacets } from '@nilzora/contracts';
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  Palette,
  Ruler,
  SlidersHorizontal,
} from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { AppIcon } from '@/components/icon';
import { TextField } from '@/components/text-field';
import { theme } from '@/theme';
import {
  facetChoiceLabel,
  MAX_FILTER_TAKA,
  normalisePriceRange,
  parseTaka,
  priceRangeLabel,
  SORT_LABELS,
  type ShopFilters,
} from './catalog-query';

/*
 * The listing's filter toolbar: compact rounded chips on one horizontal row — the advanced
 * filter sheet, the sort, the price range, and the sizes and colours the store really offers —
 * that scroll sideways on a narrow phone rather than shrinking into unreadable controls. Every
 * chip states what is applied and is tinted while it narrows the list.
 *
 * Sort, price, size and colour open small native bottom sheets, so a choice is one tap away and
 * the back button closes it. Size and colour are the store's own variant values, offered only
 * when the API reports them, so a chip is never a control that cannot change the results.
 */

/** No size or colour to choose, for a listing whose variants are not known. */
const NO_FACETS: ProductFacets = { sizes: [], colors: [] };

export interface ListingFilterBarProps {
  filters: ShopFilters;
  /** The sorts the API accepts for this listing, in the storefront's order. */
  sorts: readonly CatalogSort[];
  /** The sizes and colours this listing's products actually have. */
  facets?: ProductFacets;
  onSortChange: (sort: CatalogSort) => void;
  /** Applies price, size, colour (and anything else the bar changes) in one update. */
  onFiltersChange: (next: ShopFilters) => void;
  /** Opens the advanced filter sheet; the chip is absent when the screen has none. */
  onOpenFilters?: (() => void) | undefined;
  /** How many advanced filters are on (category, brand, availability). */
  filterCount?: number;
  /** The bar's test id, so a screen can scope its queries. */
  testID?: string;
}

/** One chip: icon, label and, when it matters, a chevron. */
function FilterChip({
  label,
  icon,
  active = false,
  badge,
  onPress,
  accessibilityHint,
}: {
  label: string;
  icon: ReactNode;
  active?: boolean;
  badge?: number;
  onPress: () => void;
  accessibilityHint?: string;
}): ReactNode {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge === undefined ? label : `${label}, ${String(badge)} active`}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      android_ripple={{ color: 'rgba(2, 132, 199, 0.14)', borderless: false }}
      // The chip is deliberately smaller than a 44pt control; the touch area is not.
      hitSlop={{ top: 5, bottom: 5 }}
      style={({ pressed }) => [
        styles.chip,
        active ? styles.chipActive : null,
        pressed ? styles.chipPressed : null,
      ]}
    >
      {icon}
      <Text numberOfLines={1} style={[styles.chipLabel, active ? styles.chipLabelActive : null]}>
        {label}
      </Text>
      {badge === undefined ? null : <Text style={styles.badge}>{badge}</Text>}
    </Pressable>
  );
}

export function ListingFilterBar({
  filters,
  sorts,
  facets = NO_FACETS,
  onSortChange,
  onFiltersChange,
  onOpenFilters,
  filterCount = 0,
  testID = 'listing-filter-bar',
}: ListingFilterBarProps) {
  const [sortOpen, setSortOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [minDraft, setMinDraft] = useState('');
  const [maxDraft, setMaxDraft] = useState('');
  const [sizeOpen, setSizeOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [sizeDraft, setSizeDraft] = useState<readonly string[]>([]);
  const [colorDraft, setColorDraft] = useState<readonly string[]>([]);

  const price = priceRangeLabel(filters);
  const defaultSort = sorts[0] ?? 'featured';
  const sortActive = filters.sort !== defaultSort;
  const sizeLabel = facetChoiceLabel(filters.sizes, facets.sizes);
  const colorLabel = facetChoiceLabel(filters.colors, facets.colors);
  // A chip stays while its filter is on, so a value the current result no longer offers can
  // still be seen and removed. Nothing else draws a chip for a list with no options.
  const showSize = facets.sizes.length > 0 || sizeLabel !== null;
  const showColor = facets.colors.length > 0 || colorLabel !== null;
  const chosenSwatch =
    facets.colors.find((option) => (filters.colors ?? []).includes(option.slug))?.swatchHex ?? null;

  /** The sheet's fields start from what is applied now, never an abandoned draft. */
  function openPrice() {
    setMinDraft(filters.minTaka === undefined ? '' : String(filters.minTaka));
    setMaxDraft(filters.maxTaka === undefined ? '' : String(filters.maxTaka));
    setPriceOpen(true);
  }

  function applyPrice() {
    const range = normalisePriceRange(parseTaka(minDraft), parseTaka(maxDraft));
    setPriceOpen(false);
    onFiltersChange({ ...filters, minTaka: range.minTaka, maxTaka: range.maxTaka });
  }

  function openSizes() {
    setSizeDraft(filters.sizes ?? []);
    setSizeOpen(true);
  }

  function openColors() {
    setColorDraft(filters.colors ?? []);
    setColorOpen(true);
  }

  /** Keeps a chosen value even when the current result no longer offers it, so it can be undone. */
  function toggled(choice: readonly string[], slug: string): string[] {
    return choice.includes(slug)
      ? choice.filter((entry) => entry !== slug)
      : [...choice, slug];
  }

  return (
    <View style={styles.bar} testID={testID}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        accessibilityLabel="Sort and filter products"
      >
        {onOpenFilters === undefined ? null : (
          <FilterChip
            label="Filters"
            icon={<SlidersHorizontal size={16} color={theme.colors.primary} accessible={false} />}
            active={filterCount > 0}
            badge={filterCount > 0 ? filterCount : undefined}
            accessibilityHint="Opens the category, brand and availability filters"
            onPress={onOpenFilters}
          />
        )}
        <FilterChip
          label={sortActive ? `Sort: ${SORT_LABELS[filters.sort]}` : 'Sort'}
          icon={<ArrowUpDown size={16} color={theme.colors.primary} accessible={false} />}
          active={sortActive}
          accessibilityHint="Chooses the order of the products"
          onPress={() => {
            setSortOpen(true);
          }}
        />
        {showSize ? (
          <FilterChip
            label={sizeLabel === null ? 'Size' : `Size: ${sizeLabel}`}
            icon={<Ruler size={16} color={theme.colors.primary} accessible={false} />}
            active={sizeLabel !== null}
            accessibilityHint="Chooses the sizes to show"
            onPress={openSizes}
          />
        ) : null}
        {showColor ? (
          <FilterChip
            label={colorLabel === null ? 'Colour' : `Colour: ${colorLabel}`}
            icon={
              chosenSwatch === null ? (
                <Palette size={16} color={theme.colors.primary} accessible={false} />
              ) : (
                <View style={[styles.chipSwatch, { backgroundColor: chosenSwatch }]} />
              )
            }
            active={colorLabel !== null}
            accessibilityHint="Chooses the colours to show"
            onPress={openColors}
          />
        ) : null}
        <FilterChip
          label={price ?? 'Price'}
          icon={
            <Text style={[styles.currency, price === null ? null : styles.currencyActive]}>৳</Text>
          }
          active={price !== null}
          accessibilityHint="Chooses the lowest and highest price"
          onPress={openPrice}
        />
        {price === null ? null : (
          <FilterChip
            label="Clear price"
            icon={<ChevronDown size={16} color={theme.colors.mutedForeground} accessible={false} />}
            onPress={() => {
              onFiltersChange({ ...filters, minTaka: undefined, maxTaka: undefined });
            }}
          />
        )}
      </ScrollView>

      <BottomSheet
        visible={sortOpen}
        onClose={() => {
          setSortOpen(false);
        }}
        title="Sort by"
        testID="sort-sheet"
      >
        <View accessibilityRole="radiogroup" accessibilityLabel="Sort by">
          {sorts.map((option) => {
            const checked = option === filters.sort;
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityLabel={SORT_LABELS[option]}
                accessibilityState={{ checked }}
                onPress={() => {
                  setSortOpen(false);
                  onSortChange(option);
                }}
                android_ripple={{ color: theme.colors.surfaceMuted }}
                style={styles.choice}
              >
                <Text style={[styles.choiceLabel, checked ? styles.choiceLabelChecked : null]}>
                  {SORT_LABELS[option]}
                </Text>
                {checked ? (
                  <Check size={18} color={theme.colors.primaryAction} accessible={false} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>

      <BottomSheet
        visible={priceOpen}
        onClose={() => {
          setPriceOpen(false);
        }}
        title="Price"
        testID="price-sheet"
        footer={
          <>
            <View style={styles.footerButton}>
              <Button
                label="Clear"
                variant="secondary"
                onPress={() => {
                  setPriceOpen(false);
                  onFiltersChange({ ...filters, minTaka: undefined, maxTaka: undefined });
                }}
              />
            </View>
            <View style={styles.footerButton}>
              <Button label="Apply" onPress={applyPrice} />
            </View>
          </>
        }
      >
        <Text style={styles.priceHelp}>
          Prices in taka, for the selling price shown on each product. Leave a box empty for an
          open range.
        </Text>
        <View style={styles.priceRow}>
          <View style={styles.priceField}>
            <TextField
              label="Lowest price"
              value={minDraft}
              onChangeText={setMinDraft}
              keyboardType="number-pad"
              inputMode="numeric"
              placeholder="Min"
              maxLength={10}
              hint={`0 to ${String(MAX_FILTER_TAKA)}`}
            />
          </View>
          <View style={styles.priceField}>
            <TextField
              label="Highest price"
              value={maxDraft}
              onChangeText={setMaxDraft}
              keyboardType="number-pad"
              inputMode="numeric"
              placeholder="Max"
              maxLength={10}
              hint={`0 to ${String(MAX_FILTER_TAKA)}`}
            />
          </View>
        </View>
      </BottomSheet>

      <BottomSheet
        visible={sizeOpen}
        onClose={() => {
          setSizeOpen(false);
        }}
        title="Size"
        testID="size-sheet"
        footer={
          <>
            <View style={styles.footerButton}>
              <Button
                label="Clear"
                variant="secondary"
                onPress={() => {
                  setSizeOpen(false);
                  onFiltersChange({ ...filters, sizes: undefined });
                }}
              />
            </View>
            <View style={styles.footerButton}>
              <Button
                label="Show results"
                onPress={() => {
                  setSizeOpen(false);
                  onFiltersChange({
                    ...filters,
                    sizes: sizeDraft.length === 0 ? undefined : sizeDraft,
                  });
                }}
              />
            </View>
          </>
        }
      >
        <View accessibilityRole="group" accessibilityLabel="Size">
          {facets.sizes.map((option) => (
            <ChoiceRow
              key={option.slug}
              label={option.value}
              count={option.productCount}
              checked={sizeDraft.includes(option.slug)}
              onPress={() => {
                setSizeDraft((choice) => toggled(choice, option.slug));
              }}
            />
          ))}
        </View>
      </BottomSheet>

      <BottomSheet
        visible={colorOpen}
        onClose={() => {
          setColorOpen(false);
        }}
        title="Colour"
        testID="colour-sheet"
        footer={
          <>
            <View style={styles.footerButton}>
              <Button
                label="Clear"
                variant="secondary"
                onPress={() => {
                  setColorOpen(false);
                  onFiltersChange({ ...filters, colors: undefined });
                }}
              />
            </View>
            <View style={styles.footerButton}>
              <Button
                label="Show results"
                onPress={() => {
                  setColorOpen(false);
                  onFiltersChange({
                    ...filters,
                    colors: colorDraft.length === 0 ? undefined : colorDraft,
                  });
                }}
              />
            </View>
          </>
        }
      >
        <View accessibilityRole="group" accessibilityLabel="Colour">
          {facets.colors.map((option) => (
            <ChoiceRow
              key={option.slug}
              label={option.value}
              count={option.productCount}
              swatchHex={option.swatchHex}
              checked={colorDraft.includes(option.slug)}
              onPress={() => {
                setColorDraft((choice) => toggled(choice, option.slug));
              }}
            />
          ))}
        </View>
      </BottomSheet>
    </View>
  );
}

/** One value in the size or colour sheet: several can be on at once, so it reads as a checkbox. */
function ChoiceRow({
  label,
  count,
  swatchHex = null,
  checked,
  onPress,
}: {
  label: string;
  /** How many products the value would leave; 0 is still offered so it can be chosen back. */
  count: number;
  /** The colour Admin configured for the value, when there is one. */
  swatchHex?: string | null;
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onPress}
      android_ripple={{ color: theme.colors.surfaceMuted }}
      style={({ pressed }) => [styles.option, pressed ? styles.optionPressed : null]}
    >
      {swatchHex === null ? null : (
        <View style={[styles.swatch, { backgroundColor: swatchHex }]} />
      )}
      <Text style={[styles.optionValue, checked ? styles.optionValueChecked : null]}>{label}</Text>
      <Text style={styles.optionCount}>{count}</Text>
      {checked ? (
        <AppIcon name="check" size="md" color={theme.colors.primaryAction} />
      ) : (
        <View style={styles.emptyCheck} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { gap: theme.spacing[2] },
  // Bleeds to the screen edge so the last chip is not cut by the page padding, then pads the
  // first one back into line with the grid.
  row: {
    gap: theme.spacing[2],
    paddingHorizontal: 1,
    paddingVertical: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 34,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.radii.full,
    borderWidth: 1,
    borderColor: theme.colors.inputBorder,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
  },
  chipActive: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.iconSurface,
  },
  chipPressed: { opacity: 0.75 },
  chipLabel: {
    color: theme.colors.foreground,
    fontSize: 13,
    fontWeight: theme.fontWeights.medium,
  },
  chipLabelActive: { color: theme.colors.link, fontWeight: theme.fontWeights.semibold },
  /** The colour a chip is filtered by, as a small disc in place of the palette icon. */
  chipSwatch: {
    width: 14,
    height: 14,
    borderRadius: theme.radii.full,
    borderWidth: 1,
    borderColor: theme.colors.inputBorder,
  },
  badge: {
    minWidth: 18,
    overflow: 'hidden',
    borderRadius: theme.radii.full,
    paddingHorizontal: 5,
    textAlign: 'center',
    backgroundColor: theme.colors.primaryAction,
    color: theme.colors.primaryActionForeground,
    fontSize: 11,
    lineHeight: 18,
    fontWeight: theme.fontWeights.semibold,
  },
  currency: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: theme.fontWeights.semibold,
  },
  currencyActive: { color: theme.colors.link },

  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[3],
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.radii.md,
  },
  choiceLabel: { flex: 1, color: theme.colors.foreground, ...theme.text.body },
  choiceLabelChecked: {
    color: theme.colors.primaryAction,
    fontWeight: theme.fontWeights.semibold,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.radii.md,
  },
  optionPressed: { backgroundColor: theme.colors.surfaceMuted },
  optionValue: { flex: 1, color: theme.colors.foreground, ...theme.text.body },
  optionValueChecked: {
    color: theme.colors.primaryAction,
    fontWeight: theme.fontWeights.semibold,
  },
  optionCount: { color: theme.colors.mutedForeground, ...theme.text.caption },
  swatch: {
    width: 20,
    height: 20,
    borderRadius: theme.radii.full,
    borderWidth: 1,
    borderColor: theme.colors.inputBorder,
  },
  emptyCheck: { width: theme.icon.size.md, height: theme.icon.size.md },
  footerButton: { flex: 1 },
  priceHelp: { color: theme.colors.mutedForeground, ...theme.text.body, lineHeight: 21 },
  priceRow: { flexDirection: 'row', gap: theme.spacing[3] },
  priceField: { flex: 1 },
});
