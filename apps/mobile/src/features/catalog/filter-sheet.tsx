import type { Brand, Category, ColorFacet, ProductFacets, SizeFacet } from '@nilzora/contracts';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { AppIcon } from '@/components/icon';
import { Skeleton } from '@/components/skeleton';
import { TextField } from '@/components/text-field';
import { theme } from '@/theme';
import { MAX_FILTER_TAKA, normalisePriceRange, parseTaka } from '@/features/catalog/catalog-query';

export interface CatalogFilterDraft {
  category: string | undefined;
  brand: string | undefined;
  inStock: boolean;
  /**
   * Only present when the screen offers those groups: a listing whose toolbar already has
   * size, colour and price chips leaves the keys out, so applying this sheet never clears them.
   */
  sizes?: readonly string[];
  colors?: readonly string[];
  minTaka?: number | undefined;
  maxTaka?: number | undefined;
}

export interface FilterSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The categories the API returned; only these can be filtered by. */
  categories: readonly Pick<Category, 'slug' | 'name' | 'productCount' | 'totalProductCount'>[];
  /** True while the category list is still loading. */
  categoriesLoading?: boolean;
  /** A category screen fixes its category: there is nothing to choose. */
  showCategory?: boolean;
  /** A brand's own page fixes its brand: there is nothing to choose there either. */
  showBrand?: boolean;
  selectedCategory: string | undefined;
  /** Brands the API returned, with their counts (an empty brand is not offered). */
  brands: readonly Pick<Brand, 'slug' | 'name' | 'productCount'>[];
  brandsLoading?: boolean;
  selectedBrand: string | undefined;
  inStock: boolean;
  /**
   * The sizes and colours these results really have. When given, the sheet offers them; when
   * absent (a listing whose toolbar owns those chips) the groups are not drawn at all.
   */
  facets?: ProductFacets;
  /** The applied price range in whole taka. Given only where the sheet owns the price. */
  price?: { minTaka?: number | undefined; maxTaka?: number | undefined };
  onApply: (draft: CatalogFilterDraft) => void;
  /** Clears the category, the brand and availability. */
  onReset: () => void;
}

/**
 * The advanced filter sheet: the options the catalog API really supports beyond the toolbar —
 * a category, a brand and availability. Sort and price live in the toolbar beside it, so this
 * sheet never repeats them, and nothing here is a control that cannot change the results.
 */
export function FilterSheet({
  visible,
  onClose,
  categories,
  categoriesLoading = false,
  showCategory = true,
  showBrand = true,
  selectedCategory,
  brands,
  brandsLoading = false,
  selectedBrand,
  inStock,
  facets,
  price,
  onApply,
  onReset,
}: FilterSheetProps) {
  const [category, setCategory] = useState<string | undefined>(selectedCategory);
  const [brand, setBrand] = useState<string | undefined>(selectedBrand);
  const [stockOnly, setStockOnly] = useState(inStock);
  const [sizes, setSizes] = useState<readonly string[]>([]);
  const [colors, setColors] = useState<readonly string[]>([]);
  const [minDraft, setMinDraft] = useState('');
  const [maxDraft, setMaxDraft] = useState('');

  // Each opening starts from what is applied now, never from an abandoned draft.
  function resetDraft() {
    setCategory(selectedCategory);
    setBrand(selectedBrand);
    setStockOnly(inStock);
    setSizes([]);
    setColors([]);
    setMinDraft(price?.minTaka === undefined ? '' : String(price.minTaka));
    setMaxDraft(price?.maxTaka === undefined ? '' : String(price.maxTaka));
  }

  /** A chosen value stays selectable even when the current results no longer offer it. */
  function toggled(choice: readonly string[], slug: string): string[] {
    return choice.includes(slug) ? choice.filter((entry) => entry !== slug) : [...choice, slug];
  }

  function apply() {
    const range = normalisePriceRange(parseTaka(minDraft), parseTaka(maxDraft));
    onApply({
      category,
      brand,
      inStock: stockOnly,
      ...(facets === undefined ? {} : { sizes, colors }),
      ...(price === undefined ? {} : { minTaka: range.minTaka, maxTaka: range.maxTaka }),
    });
  }

  // A brand with nothing on sale is not offered; the chosen one always is, so it can be cleared.
  const brandOptions = brands.filter(
    (entry) => entry.slug === selectedBrand || entry.productCount > 0,
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      onOpen={resetDraft}
      title="Filters"
      testID="filter-sheet"
      footer={
        <>
          <View style={styles.footerButton}>
            <Button
              label="Reset"
              variant="secondary"
              onPress={() => {
                onReset();
                onClose();
              }}
            />
          </View>
          <View style={styles.footerButton}>
            <Button
              label="Show results"
              onPress={() => {
                apply();
                onClose();
              }}
            />
          </View>
        </>
      }
    >
      {showCategory ? (
        <View style={styles.group}>
          <Text accessibilityRole="header" style={styles.groupTitle}>
            Category
          </Text>
          {categoriesLoading ? (
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="Loading categories"
            >
              <Skeleton width="70%" height={20} />
              <Skeleton width="55%" height={20} />
            </View>
          ) : (
            <View accessibilityRole="radiogroup" accessibilityLabel="Category">
              <FilterRow
                label="All categories"
                checked={category === undefined}
                onPress={() => {
                  setCategory(undefined);
                }}
              />
              {categories.map((entry) => (
                <FilterRow
                  key={entry.slug}
                  label={entry.name}
                  checked={category === entry.slug}
                  onPress={() => {
                    setCategory(entry.slug);
                  }}
                />
              ))}
            </View>
          )}
        </View>
      ) : null}

      {!showBrand ? null : brandsLoading ? (
        <View style={styles.group}>
          <Text accessibilityRole="header" style={styles.groupTitle}>
            Brand
          </Text>
          <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading brands">
            <Skeleton width="60%" height={20} />
          </View>
        </View>
      ) : brandOptions.length === 0 ? null : (
        <View style={styles.group}>
          <Text accessibilityRole="header" style={styles.groupTitle}>
            Brand
          </Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="Brand">
            <FilterRow
              label="All brands"
              checked={brand === undefined}
              onPress={() => {
                setBrand(undefined);
              }}
            />
            {brandOptions.map((entry) => (
              <FilterRow
                key={entry.slug}
                label={entry.name}
                checked={brand === entry.slug}
                onPress={() => {
                  setBrand(entry.slug);
                }}
              />
            ))}
          </View>
        </View>
      )}

      <View style={styles.group}>
        <Text accessibilityRole="header" style={styles.groupTitle}>
          Availability
        </Text>
        <FilterRow
          label="In stock only"
          checked={stockOnly}
          role="checkbox"
          onPress={() => {
            setStockOnly((value) => !value);
          }}
        />
      </View>

      {facets === undefined || facets.sizes.length === 0 ? null : (
        <View style={styles.group}>
          <Text accessibilityRole="header" style={styles.groupTitle}>
            Size
          </Text>
          <View accessibilityRole="group" accessibilityLabel="Size">
            {facets.sizes.map((option) => (
              <ValueRow
                key={option.slug}
                option={option}
                checked={sizes.includes(option.slug)}
                onPress={() => {
                  setSizes((choice) => toggled(choice, option.slug));
                }}
              />
            ))}
          </View>
        </View>
      )}

      {facets === undefined || facets.colors.length === 0 ? null : (
        <View style={styles.group}>
          <Text accessibilityRole="header" style={styles.groupTitle}>
            Colour
          </Text>
          <View accessibilityRole="group" accessibilityLabel="Colour">
            {facets.colors.map((option) => (
              <ValueRow
                key={option.slug}
                option={option}
                swatchHex={option.swatchHex}
                checked={colors.includes(option.slug)}
                onPress={() => {
                  setColors((choice) => toggled(choice, option.slug));
                }}
              />
            ))}
          </View>
        </View>
      )}

      {price === undefined ? null : (
        <View style={styles.group}>
          <Text accessibilityRole="header" style={styles.groupTitle}>
            Price
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
        </View>
      )}
    </BottomSheet>
  );
}

/** One size or colour value: several can be on at once, so it reads as a checkbox. */
function ValueRow({
  option,
  swatchHex = null,
  checked,
  onPress,
}: {
  option: SizeFacet | ColorFacet;
  swatchHex?: string | null;
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={option.value}
      accessibilityState={{ checked }}
      onPress={onPress}
      android_ripple={{ color: theme.colors.surfaceMuted }}
      style={({ pressed }) => [styles.valueRow, pressed ? styles.rowPressed : null]}
    >
      {swatchHex === null ? null : <View style={[styles.swatch, { backgroundColor: swatchHex }]} />}
      <Text style={[styles.rowLabel, checked ? styles.rowLabelChecked : null]}>{option.value}</Text>
      <Text style={styles.valueCount}>{option.productCount}</Text>
      {checked ? (
        <AppIcon name="check" size="md" color={theme.colors.primaryAction} />
      ) : (
        <View style={styles.emptyCheck} />
      )}
    </Pressable>
  );
}

function FilterRow({
  label,
  checked,
  role = 'radio',
  onPress,
}: {
  label: string;
  checked: boolean;
  /** Availability is one toggle, so it reads as a checkbox rather than a radio. */
  role?: 'radio' | 'checkbox';
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onPress}
      android_ripple={{ color: theme.colors.surfaceMuted }}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <Text style={[styles.rowLabel, checked ? styles.rowLabelChecked : null]}>{label}</Text>
      {checked ? (
        <AppIcon name="check" size="md" color={theme.colors.primaryAction} />
      ) : (
        <View style={styles.emptyCheck} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { gap: theme.spacing[2] },
  groupTitle: {
    color: theme.colors.foreground,
    ...theme.text.caption,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[3],
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.radii.md,
  },
  rowPressed: { backgroundColor: theme.colors.surfaceMuted },
  rowLabel: { flex: 1, color: theme.colors.foreground, ...theme.text.body },
  rowLabelChecked: { fontWeight: theme.fontWeights.semibold, color: theme.colors.primaryAction },
  emptyCheck: { width: theme.icon.size.md, height: theme.icon.size.md },
  /** A size or colour value: the same row, with its count on the right. */
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.radii.md,
  },
  valueCount: { color: theme.colors.mutedForeground, ...theme.text.caption },
  swatch: {
    width: 20,
    height: 20,
    borderRadius: theme.radii.full,
    borderWidth: 1,
    borderColor: theme.colors.inputBorder,
  },
  priceRow: { flexDirection: 'row', gap: theme.spacing[3] },
  priceField: { flex: 1 },
  footerButton: { flex: 1 },
});
