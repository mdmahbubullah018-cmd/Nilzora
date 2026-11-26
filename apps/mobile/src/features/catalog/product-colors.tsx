import type { ProductSummary } from '@nilzora/contracts';
import { memo } from 'react';
import { PixelRatio, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/theme';

/*
 * The colours a product is sold in, inside its card.
 *
 * A preview only: the card's own press target already covers the whole surface, and these
 * discs sit inside a view that is hidden from the accessibility tree, so they can never take a
 * tap or a focus. Choosing a colour happens on the product page.
 */

/** The most discs a card shows before the rest are counted. */
const MAX_SWATCHES = 4;
/**
 * 15dp, snapped to a whole number of device pixels so the circle's edge lands on pixel
 * boundaries instead of being antialiased into a blur — that is what makes a small disc look
 * sharp rather than fuzzy on a high-density screen.
 */
const DOT = PixelRatio.roundToNearestPixel(15);

export const ProductColors = memo(function ProductColors({
  colors,
}: {
  colors: ProductSummary['colors'];
}) {
  if (colors === undefined || colors.length < 2) return null;
  const shown = colors.slice(0, MAX_SWATCHES);
  const rest = colors.length - shown.length;
  return (
    <View style={styles.row}>
      {shown.map((color) => (
        <View
          key={color.valueSlug}
          style={[styles.dot, { backgroundColor: color.swatchHex }]}
        />
      ))}
      {rest > 0 ? <Text style={styles.more}>+{rest}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    // One opaque 1dp edge: enough to keep white and the palest shades visible on a white
    // card, and hard-edged because it carries no opacity.
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
  },
  more: {
    color: theme.colors.mutedForeground,
    fontSize: 11,
    fontWeight: theme.fontWeights.semibold,
  },
});
