import { CATALOG_SORTS, type Brand, type CatalogSort } from '@nilzora/contracts';
import type { Href } from 'expo-router';
import { useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SectionHeader } from '@/components/section-header';
import { theme } from '@/theme';
import { GRID_GAP, SCREEN_PADDING } from '@/features/catalog/catalog-layout';
import { shopHref, categoryHref } from '@/features/catalog/catalog-query';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2)
  ).toUpperCase();
}

/** A brand's logo, or its initials when it has none (or the logo fails to load). */
export function BrandMark({
  brand,
  size = 56,
  bare = false,
  band = false,
}: {
  brand: Pick<Brand, 'name' | 'logo'>;
  size?: number;
  /** No tile behind the logo: for a logo that already sits on a card of its own. */
  bare?: boolean;
  /** A wide band instead of a square: the logo is centred and contained across the whole area
   * it is given, so a wide wordmark and a square emblem carry the same weight. */
  band?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <View
      style={[
        band ? styles.markBand : bare ? styles.markBare : styles.mark,
        band
          ? null
          : { width: size, height: size, borderRadius: bare ? 0 : size * 0.3 },
      ]}
      accessible={false}
    >
      {brand.logo && !failed ? (
        <Image
          testID="brand-logo"
          source={{ uri: brand.logo.thumbUrl }}
          style={band ? styles.markImageBand : bare ? styles.markImageBare : styles.markImage}
          resizeMode="contain"
          onError={() => {
            setFailed(true);
          }}
        />
      ) : (
        <Text style={[styles.markText, { fontSize: size * 0.34 }]}>{initials(brand.name)}</Text>
      )}
    </View>
  );
}

export function brandHref(slug: string): Href {
  return { pathname: '/brand/[slug]', params: { slug } };
}

/** How much of the next brand shows at the right edge: a fifth of that card, so the row reads as
 * continuing instead of ending in a hard cut. */
export const BRAND_PEEK_SHARE = 0.2;

/**
 * The brand row's card width. Two whole cards, both gaps and a fifth of the third fill the row
 * that is in view — the same ratio the website's rail keeps. The row bleeds to the right edge and
 * starts one screen padding in, so that inset is what the two cards share.
 */
function useBrandCardWidth(): number {
  const { width } = useWindowDimensions();
  return Math.floor((width - SCREEN_PADDING - GRID_GAP * 2) / (2 + BRAND_PEEK_SHARE));
}

/**
 * "Shop by brand" on Home: the website's brand row, sized for a phone, in the category cards'
 * visual language. The brand's own logo is contained in a compact square that leaves the card
 * its air, the name follows under it, and the real product count sits under the name in small,
 * quiet type — centred, with nothing drawn around the artwork. The logo is never cropped or
 * stretched, and a brand without one shows its initials in the same space, so no slot is ever
 * blank. The brand's banner is deliberately not used here. Two whole brands are in view plus
 * about a fifth of the third, and every visible brand is eligible.
 */
export function BrandRow({
  brands,
  onSelect,
  onSeeAll,
}: {
  brands: readonly Brand[];
  onSelect: (slug: string) => void;
  onSeeAll: () => void;
}) {
  // Two whole logos plus a fifth of the third; bare marks, so the peek can be this wide.
  const cardWidth = useBrandCardWidth();
  const shown = [...brands]
    .sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name))
    .slice(0, 10);
  if (shown.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHeader
        title="Shop by brand"
        actionLabel="All brands"
        actionAccessibilityLabel="See all brands"
        onActionPress={onSeeAll}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={cardWidth + GRID_GAP}
        snapToAlignment="start"
        style={styles.bleed}
        contentContainerStyle={styles.bleedContent}
        accessibilityLabel="Brands"
      >
        {shown.map((item) => {
          const count =
            item.productCount === 1 ? '1 product' : `${String(item.productCount)} products`;
          return (
            <Pressable
              key={item.slug}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${count}`}
              accessibilityHint="Shows the products from this brand"
              onPress={() => {
                onSelect(item.slug);
              }}
              android_ripple={{ color: 'rgba(2, 132, 199, 0.12)', borderless: true }}
              style={({ pressed }) => [
                styles.brandCard,
                { width: cardWidth },
                pressed ? styles.pressed : null,
              ]}
            >
              {/* The logo keeps its own space inside the card, smaller than before so the card
                  stays compact and the words under it have room. */}
              <View style={styles.brandLogoPanel}>
                <BrandMark brand={item} band />
              </View>
              <Text numberOfLines={1} style={styles.brandName}>
                {item.name}
              </Text>
              <Text numberOfLines={1} style={styles.brandCount}>
                {count}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Store sections that are app screens of their own, so their names are never brand slugs. */
const SECTION_TARGETS: Readonly<Record<string, Href>> = {
  categories: '/categories',
  brands: '/brands',
  cart: '/cart',
  checkout: '/cart',
  wishlist: '/wishlist',
  orders: '/orders',
  account: '/account',
  contact: '/store',
  store: '/store',
};

/** Where a store path (a banner's or a campaign slide's link) leads in the app. */
export function bannerTarget(href: string | null): Href {
  if (!href) return shopHref();
  const [path = '', query = ''] = href.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  const sort = params.get('sort');
  const shopFilters = {
    ...(params.get('q') ? { q: params.get('q') ?? '' } : {}),
    ...(params.get('category') ? { category: params.get('category') ?? '' } : {}),
    ...(sort !== null && (CATALOG_SORTS as readonly string[]).includes(sort)
      ? { sort: sort as CatalogSort }
      : {}),
  };
  const [section, slug] = parts;
  if (section === undefined) return '/';
  if (section === 'categories' && slug) return categoryHref(slug);
  if (section === 'products' && slug) {
    return { pathname: '/product/[slug]', params: { slug } };
  }
  if (section === 'products' || section === 'shop' || section === 'search') {
    return shopHref(shopFilters);
  }
  if (section === 'account' && slug === 'orders') return '/orders';
  if (section === 'account' && slug === 'returns') return '/returns';
  if (section === 'account' && slug === 'addresses') return '/addresses';
  const sectionTarget = SECTION_TARGETS[section];
  if (sectionTarget !== undefined) return sectionTarget;
  if (parts.length === 1) return brandHref(section);
  return shopHref();
}

const styles = StyleSheet.create({
  mark: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  markImage: { width: '82%', height: '82%' },
  // Without a tile the logo keeps its own proportions inside the same square of space.
  markBare: { alignItems: 'center', justifyContent: 'center' },
  markImageBare: { width: '100%', height: '100%' },
  // A wide band: the logo is contained in the whole area it is given (the caller sizes it),
  // so a square logo and a wide wordmark both fill the panel they sit in.
  markBand: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  markImageBand: { width: '100%', height: '100%' },
  markText: { color: theme.colors.primary, fontWeight: theme.fontWeights.semibold },
  section: { gap: theme.spacing[2] },
  bleed: { marginHorizontal: -SCREEN_PADDING, flexGrow: 0 },
  bleedContent: { gap: GRID_GAP, paddingHorizontal: SCREEN_PADDING, paddingVertical: 2 },
  /** One brand in the Home row: a bare mark, its name, then its count — no card or panel. */
  brandCard: {
    alignItems: 'center',
    gap: 2,
    paddingVertical: 2,
  },
  /*
   * The logo's own space: a square that is smaller than the card, so the mark reads as a logo
   * rather than a picture. It carries no background, border or shadow of its own.
   */
  brandLogoPanel: {
    width: '82%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    maxWidth: '100%',
    textAlign: 'center',
    color: theme.colors.foreground,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: theme.fontWeights.medium,
  },
  brandCount: {
    maxWidth: '100%',
    textAlign: 'center',
    color: theme.colors.mutedForeground,
    fontSize: 11,
    lineHeight: 15,
  },
  pressed: { opacity: 0.7 },
});
