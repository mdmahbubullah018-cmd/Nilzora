import type { Brand } from '@nilzora/contracts';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { PackageOpen, SearchX } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { EmptyState } from '@/components/empty-state';
import { icons } from '@/components/icon';
import { IconButton } from '@/components/icon-button';
import { PhotoShade } from '@/components/photo-shade';
import { QueryStateView } from '@/components/query-state';
import { Screen, STACK_EDGES } from '@/components/screen';
import { announce } from '@/features/catalog/add-to-cart';
import { BrandMark, brandHref } from '@/features/brands/brand-components';
import { parseBrandSlug, useBrand } from '@/features/brands/brand-hooks';
import { CatalogGrid } from '@/features/catalog/catalog-grid';
import {
  BROWSE_SORTS,
  isProductNotFound,
  type ShopFilters,
} from '@/features/catalog/catalog-query';
import { brandShareTarget, shareBrand } from '@/features/share/product-share';
import { theme } from '@/theme';

/**
 * The brand's own presentation at the top of its page: the banner as the main visual, with the
 * brand's identity inside it — a small logo beside the name on a light, blurred plate at the
 * bottom-left corner, so the words stay readable over a pale picture or a dark one without a
 * panel across the artwork. A brand with no banner (or one that fails to load) keeps the same
 * composition on the navy band, so nothing is ever an empty frame and nothing is drawn twice.
 */
function BrandHero({ brand, share }: { brand: Brand; share: ReactNode }) {
  const [bannerFailed, setBannerFailed] = useState(false);
  const banner = brand.banner;
  const showBanner = banner !== null && !bannerFailed;

  return (
    <View style={styles.heroBanner}>
      {showBanner ? (
        <Image
          testID="brand-banner"
          source={{ uri: banner.url }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          accessible={false}
          onError={() => {
            setBannerFailed(true);
          }}
        />
      ) : (
        <View style={styles.heroFallback}>
          <View pointerEvents="none" style={styles.glow} />
        </View>
      )}
      {/* Only the foot of the picture is deepened, so the count sits on darker pixels. */}
      <PhotoShade height={92} strength="text" />

      {/* The banner carries the artwork and the real product count on a small glass chip; the
          brand's identity (mark and name) belongs to the heading below it, not on the picture. */}
      <View style={styles.heroOverlayRow}>
        <View style={styles.countChip}>
          <Text style={styles.countChipText}>
            {brand.productCount} {brand.productCount === 1 ? 'product' : 'products'}
          </Text>
        </View>
      </View>

      {share}
    </View>
  );
}

/** A brand page's filters start with nothing chosen except the brand itself. */
function emptyFilters(brand: string | undefined): ShopFilters {
  return {
    q: '',
    category: undefined,
    zone: undefined,
    sort: BROWSE_SORTS[0],
    brand,
    minTaka: undefined,
    maxTaka: undefined,
    inStock: false,
  };
}

/** One brand: its banner with the mark and name inside it, then its products, filterable. */
export default function BrandScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = parseBrandSlug(params.slug);
  const lookup = useBrand(slug);
  const brand = lookup.data?.brand ?? null;
  const [refinements, setRefinements] = useState<ShopFilters>(() => emptyFilters(undefined));
  const [sharing, setSharing] = useState(false);

  /**
   * The listing's filters, always with this brand pinned: whatever the toolbar or the sheet
   * changes, the page can never widen to another brand's products.
   */
  const filters = useMemo<ShopFilters>(
    () => ({ ...refinements, brand: slug ?? undefined }),
    [refinements, slug],
  );

  const applyFilters = useCallback(
    (next: ShopFilters) => {
      setRefinements({ ...next, brand: slug ?? undefined });
    },
    [slug],
  );

  const clearFilters = useCallback(() => {
    setRefinements(emptyFilters(slug ?? undefined));
  }, [slug]);

  // A former address moves to the brand's current one: show a spinner, not a "not found".
  const redirectTo = lookup.data?.redirectTo ?? null;
  const redirecting = redirectTo !== null;
  useEffect(() => {
    if (redirectTo) router.replace(brandHref(redirectTo));
  }, [redirectTo, router]);

  /**
   * The brand's public page, when this build knows the storefront's address; nothing is shared
   * when it does not, so the control is simply absent. The sheet is the phone's own.
   */
  const shareable =
    brand === null
      ? null
      : brandShareTarget({
          slug: brand.slug,
          name: brand.name,
          description: brand.description,
          imageUrl: brand.banner?.url ?? brand.logo?.url ?? null,
        });
  const shareNow = () => {
    if (brand === null || sharing) return;
    setSharing(true);
    void shareBrand({
      slug: brand.slug,
      name: brand.name,
      description: brand.description,
      imageUrl: brand.banner?.url ?? brand.logo?.url ?? null,
    })
      .then((outcome) => {
        if (outcome === 'failed') announce(`${brand.name} could not be shared.`);
        if (outcome === 'unavailable') announce('Sharing is unavailable in this build.');
      })
      .finally(() => setSharing(false));
  };
  const shareAction =
    shareable === null ? null : (
      <View style={styles.heroShare}>
        <IconButton
          tone="onMedia"
          compact
          icon={icons.share}
          label={`Share ${brand?.name ?? 'this brand'}`}
          hint="Opens your phone's share sheet with a link to this brand"
          disabled={sharing}
          onPress={shareNow}
        />
      </View>
    );

  // Unknown brand, refused slug, or a 404 for a brand that is gone.
  const notFound =
    slug === null ||
    (lookup.data !== undefined && brand === null && !redirecting) ||
    (lookup.isError && isProductNotFound(lookup.error));

  if (redirecting) {
    return (
      <Screen edges={STACK_EDGES}>
        <QueryStateView state="loading" />
      </Screen>
    );
  }
  if (notFound) {
    return (
      <Screen edges={STACK_EDGES}>
        <EmptyState
          icon={SearchX}
          title="Brand not found"
          description="This brand is not in the store right now."
          action={{
            label: 'See all brands',
            onPress: () => {
              router.replace('/brands');
            },
          }}
        />
      </Screen>
    );
  }
  if (lookup.isError) {
    return (
      <Screen edges={STACK_EDGES}>
        <QueryStateView
          state="error"
          error={lookup.error}
          onRetry={() => void lookup.refetch()}
          retrying={lookup.isRefetching}
        />
      </Screen>
    );
  }
  if (!brand) {
    return (
      <Screen edges={STACK_EDGES}>
        <QueryStateView state="loading" />
      </Screen>
    );
  }

  return (
    <>
      {/* The bar names the brand and keeps the way back, like every other stack screen. */}
      <Stack.Screen options={{ title: brand.name }} />
      {/*
        The same listing body Shop and a category use: its toolbar carries the sort, the price,
        the sizes and colours the brand's products really have, and the sheet its category and
        availability. The brand stays applied through every change (see `filters` above), so a
        filter can never show another brand's product.
      */}
      <CatalogGrid
        testID="brand-products"
        edges={STACK_EDGES}
        filters={filters}
        sorts={BROWSE_SORTS}
        fixedBrand={brand.slug}
        onSortChange={(sort) => {
          applyFilters({ ...filters, sort });
        }}
        onFiltersChange={applyFilters}
        onClearFilters={clearFilters}
        empty={{
          icon: PackageOpen,
          title: `No ${brand.name} products yet`,
          description: 'Products from this brand are on their way.',
        }}
        header={
          <View style={styles.headerBlock}>
            <BrandHero brand={brand} share={shareAction} />
            {/* The heading below the banner, in the Shop by Category rhythm: a quiet eyebrow,
                the brand as the title, and its mark beside the name with nothing drawn around
                it. */}
            <View style={styles.heading}>
              <Text style={styles.eyebrow}>Shop by Brand</Text>
              <View style={styles.headingRow}>
                <View style={styles.headingMark}>
                  <BrandMark brand={brand} band />
                </View>
                <Text accessibilityRole="header" numberOfLines={2} style={styles.name}>
                  {brand.name}
                </Text>
              </View>
            </View>
            {brand.description ? (
              // The count is on the banner and the name is the heading; this line carries only
              // what else the brand says about itself.
              <Text style={styles.description}>{brand.description}</Text>
            ) : null}
          </View>
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  headerBlock: { gap: theme.spacing[3], marginBottom: theme.spacing[2] },
  heading: { gap: 2 },
  eyebrow: {
    color: theme.colors.mutedForeground,
    fontSize: 11,
    fontWeight: theme.fontWeights.semibold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  headingMark: { width: 28, height: 28 },
  /** The banner's own chip: a small glass plate that keeps a white count readable on any picture. */
  heroOverlayRow: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[3],
    alignItems: 'flex-start',
  },
  /** The banner is the surface: rounded, clipped, navy underneath while the picture loads. */
  heroBanner: {
    width: '100%',
    aspectRatio: 12 / 5,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    borderRadius: theme.radii.hero,
    backgroundColor: theme.brand.navy,
  },
  /** No banner: the same composition on the brand's navy band, never an empty frame. */
  heroFallback: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: theme.brand.navy,
  },
  glow: {
    position: 'absolute',
    width: 220,
    height: 220,
    top: -120,
    right: -70,
    borderRadius: 110,
    backgroundColor: 'rgba(56, 189, 248, 0.16)',
  },
  /** The banner's own chip: a small glass plate that keeps a white count readable on any picture. */
  countChip: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 5,
    borderRadius: theme.radii.full,
    backgroundColor: 'rgba(15, 23, 42, 0.38)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.28)',
  },
  countChipText: {
    color: theme.brand.onSolid,
    fontSize: 12,
    fontWeight: theme.fontWeights.semibold,
  },
  /*
   * The plate behind the logo and the name: a light translucent fill with a hairline of white,
   * just wide enough for the two of them, so the group reads on any artwork without a panel
   * across the picture. React Native has no backdrop blur, so the translucency is the material.
   */
  identityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    maxWidth: '100%',
    paddingVertical: 4,
    paddingLeft: 4,
    paddingRight: theme.spacing[3],
    borderRadius: theme.radii.full,
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  /** The logo keeps its own space: a small round well, contained, never distorted. */
  identityLogo: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: theme.radii.full,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    padding: 3,
  },
  /** The share control sits on the banner's top-right corner, over the artwork. */
  heroShare: { position: 'absolute', top: theme.spacing[1], right: theme.spacing[1] },
  name: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: theme.fontWeights.semibold,
    letterSpacing: -0.4,
  },
  description: {
    color: theme.colors.mutedForeground,
    ...theme.text.body,
    lineHeight: 20,
  },
});
