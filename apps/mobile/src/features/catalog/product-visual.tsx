import {
  CookingPot,
  Footprints,
  Headphones,
  Package,
  Shirt,
  ShoppingBag,
  ShoppingBasket,
  Sparkles,
  Watch,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react-native';
import { createElement, useState, type ReactNode } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { theme } from '@/theme';

/*
 * Every product shows this calm, branded tile: the icon of its category on a soft surface. When
 * the API sends a photo it is laid over the tile; the tile stays underneath, so the layout is
 * identical while the photo loads, when it fails to load, and for a product without one. The
 * tile is a fixed aspect ratio, so a photo never moves the layouts around it. It is decorative:
 * the product name is always shown as text nearby.
 */

/** The storefront's icons for the seeded categories; any other category gets the parcel. */
const CATEGORY_ICONS: ReadonlyMap<string, LucideIcon> = new Map([
  ['home-kitchen', CookingPot],
  ['fashion', Shirt],
  ['electronics', Headphones],
  ['beauty-care', Sparkles],
  ['groceries', ShoppingBasket],
]);

/** Categories not in the table get an icon from the words in their slug. */
const KEYWORD_ICONS: readonly (readonly [RegExp, LucideIcon])[] = [
  [/shoe|footwear|sneaker|sandal|boot/, Footprints],
  [/watch/, Watch],
  [/bag|accessor|belt|wallet/, ShoppingBag],
  [/beauty|skin|cosmetic|serum|care|makeup|fragrance/, Sparkles],
  [/fashion|cloth|wear|shirt|dress|panjabi|kameez|burqa|apparel/, Shirt],
  [/kitchen|home/, CookingPot],
  [/electron|phone|gadget|audio/, Headphones],
  [/grocer|food/, ShoppingBasket],
];

export function categoryIcon(categorySlug: string | null | undefined): LucideIcon {
  if (!categorySlug) return Package;
  return (
    CATEGORY_ICONS.get(categorySlug) ??
    KEYWORD_ICONS.find(([pattern]) => pattern.test(categorySlug))?.[1] ??
    Package
  );
}

/** The icon of a category. (createElement: the icon comes from a fixed table, so this is a plain lookup.) */
export function CategoryIcon({
  categorySlug,
  ...props
}: LucideProps & { categorySlug?: string | null }) {
  return createElement(categoryIcon(categorySlug), props);
}

const SIZES = {
  /** A product in a grid or row. */
  card: { disc: 64, icon: 30, radius: theme.radii.md },
  /** A category tile. */
  tile: { disc: 44, icon: 22, radius: theme.radii.md },
  /** The product screen. */
  hero: { disc: 112, icon: 52, radius: theme.radii.xl },
} as const;

export interface ProductVisualProps {
  categorySlug?: string | null;
  size?: keyof typeof SIZES;
  /** The product photo to lay over the tile (a URL from the API); null or a failed load shows the tile. */
  imageUri?: string | null;
  /** How the photo fills the tile: 'cover' crops to fill (cards), 'contain' shows all of it (product screen). */
  imageFit?: 'cover' | 'contain';
  /** Fades the tile (a product that cannot be bought right now). */
  dimmed?: boolean;
  /** Overlays, e.g. the offer badge. */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

type PhotoState = { uri: string; status: 'loaded' | 'failed' };

export function ProductVisual({
  categorySlug,
  size = 'card',
  imageUri = null,
  imageFit = 'cover',
  dimmed = false,
  children,
  style,
}: ProductVisualProps) {
  const { disc, icon, radius } = SIZES[size];
  // Remembered with the URL it belongs to, so a different photo starts over as "loading".
  const [photo, setPhoto] = useState<PhotoState | null>(null);
  const status = photo?.uri === imageUri ? photo.status : null;
  const showPhoto = imageUri !== null && status !== 'failed';

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.tile, { borderRadius: radius }, style]}
    >
      {status === 'loaded' ? null : (
        <View
          style={[
            styles.disc,
            { width: disc, height: disc, borderRadius: disc / 2 },
            dimmed ? styles.dimmed : null,
          ]}
        >
          <CategoryIcon
            categorySlug={categorySlug}
            size={icon}
            strokeWidth={1.6}
            color={theme.colors.primary}
            accessible={false}
          />
        </View>
      )}
      {showPhoto ? (
        <Image
          key={imageUri}
          testID="product-photo"
          source={{ uri: imageUri }}
          resizeMode={imageFit}
          accessible={false}
          onLoad={() => {
            setPhoto({ uri: imageUri, status: 'loaded' });
          }}
          onError={() => {
            setPhoto({ uri: imageUri, status: 'failed' });
          }}
          style={[styles.photo, dimmed ? styles.dimmed : null]}
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceMuted,
    overflow: 'hidden',
  },
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  photo: StyleSheet.absoluteFill,
  dimmed: { opacity: 0.55 },
});
