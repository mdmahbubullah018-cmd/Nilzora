import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, SearchX } from 'lucide-react-native';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import { CartButton } from '@/components/cart-button';
import { EmptyState } from '@/components/empty-state';
import { icons } from '@/components/icon';
import { IconButton } from '@/components/icon-button';
import { PhotoShade } from '@/components/photo-shade';
import { Screen, ScreenFrame, HEADERLESS_STACK_EDGES } from '@/components/screen';
import { ScreenHeader } from '@/components/screen-header';
import { Skeleton } from '@/components/skeleton';
import { CategoryCampaignBar } from '@/features/campaigns/category-campaign-bar';
import { useCampaigns } from '@/features/campaigns/campaign-hooks';
import { announce } from '@/features/catalog/add-to-cart';
import { CatalogGrid } from '@/features/catalog/catalog-grid';
import { useCategories } from '@/features/catalog/catalog-hooks';
import {
  BROWSE_SORTS,
  branchProductCount,
  categoryHref,
  firstParam,
  parseCategorySlug,
  productCountLabel,
  type ShopFilters,
} from '@/features/catalog/catalog-query';
import { PromoCarousel } from '@/features/catalog/promo-carousel';
import { SubcategoryGrid } from '@/features/catalog/subcategory-grid';
import { bannerTarget } from '@/features/brands/brand-components';
import { useBanners } from '@/features/brands/brand-hooks';
import { categoryShareTarget, shareCategory } from '@/features/share/product-share';
import { theme } from '@/theme';

/** The screen's own bar sits above the list and pads nothing: the frame owns the safe area. */
const NO_EDGES: readonly Edge[] = [];

/**
 * One category's products. The category is a fixed filter — the screen deliberately has no
 * "clear filters" action, because the category *is* the page. Its name, description and
 * count come from the real category list, and a category banner is shown when the API has
 * one for this slug.
 */
export default function CategoryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  // An unusable slug is refused before any product request is made.
  const slug = parseCategorySlug(firstParam(params.slug)) ?? null;
  const categories = useCategories();
  // The category is the page itself; everything else the toolbar offers (sort, price, brand,
  // availability) is local to this screen, since it is not a linkable listing of its own.
  const [filters, setFilters] = useState<ShopFilters>(() => ({
    q: '',
    category: slug ?? undefined,
    zone: undefined,
    sort: BROWSE_SORTS[0],
    inStock: false,
  }));
  const [sharing, setSharing] = useState(false);
  const banners = useBanners('category', slug ?? undefined);
  // The live campaigns that reach this category (the website's category strip reads the same
  // feed). A failed or empty feed simply shows no bar: a promotion is never guessed at.
  const campaigns = useCampaigns(slug ?? undefined);

  const category = slug === null ? undefined : categories.data?.find((item) => item.slug === slug);
  const notFound = slug === null || (categories.data !== undefined && category === undefined);

  /**
   * This screen draws its own header (the route is registered with `headerShown: false`),
   * because the native bar hides its back button whenever the page is the first route - a
   * deep link or a notification - and a way back must always exist. With history it pops;
   * without, it replaces with the Categories list, so there is never a loop or a dead end.
   */
  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/categories');
  };

  if (notFound) {
    return (
      <Screen
        edges={HEADERLESS_STACK_EDGES}
        topGap={theme.spacing[2]}
        header={<ScreenHeader title="Category" onBack={goBack} right={<CartButton />} />}
      >
        <EmptyState
          icon={SearchX}
          title="Category not found"
          description="This category is not in the shop right now. Browse the products instead."
          action={{
            label: 'Browse the shop',
            onPress: () => {
              router.replace('/categories');
            },
          }}
        />
      </Screen>
    );
  }

  const promoBanners = banners.data ?? [];
  // The parent and the subcategories come from the same published list as this category,
  // so a hidden parent or child never leaks into the page.
  const published = categories.data ?? [];
  const parent =
    category && category.parentSlug !== null
      ? published.find((item) => item.slug === category.parentSlug)
      : undefined;
  const children = published.filter((item) => item.parentSlug === slug);
  const campaign = slug === null ? undefined : campaigns.data?.[0];
  // The admin's wide banner leads when there is one; otherwise the square cover is cropped to the
  // band, as before.
  const bannerUri = category?.banner?.url ?? category?.image?.url ?? null;
  /**
   * The category's public page, when this build knows the storefront's address. Nothing is shared
   * without one, so the control is absent rather than pointing at a guessed address.
   */
  const shareable =
    category === undefined
      ? null
      : categoryShareTarget({
          slug: category.slug,
          name: category.name,
          description: category.description,
          imageUrl: category.image?.url ?? null,
        });
  const shareNow = () => {
    if (category === undefined || sharing) return;
    setSharing(true);
    void shareCategory({
      slug: category.slug,
      name: category.name,
      description: category.description,
      imageUrl: category.image?.url ?? null,
    })
      .then((outcome) => {
        if (outcome === 'failed') announce(`${category.name} could not be shared.`);
        if (outcome === 'unavailable') announce('Sharing is unavailable in this build.');
      })
      .finally(() => setSharing(false));
  };
  const shareAction =
    shareable === null ? null : (
      <View style={styles.bannerShare}>
        <IconButton
          tone="onMedia"
          compact
          icon={icons.share}
          label={`Share ${category?.name ?? 'this category'}`}
          hint="Opens your phone's share sheet with a link to this category"
          disabled={sharing}
          onPress={shareNow}
        />
      </View>
    );
  const hero = (
    <View style={styles.header}>
      {promoBanners.length > 0 ? (
        <PromoCarousel
          banners={promoBanners}
          onOpen={(banner) => {
            router.navigate(bannerTarget(banner.ctaHref));
          }}
        />
      ) : null}
      {campaign ? <CategoryCampaignBar campaign={campaign} /> : null}
      {bannerUri !== null ? (
        <View style={styles.banner}>
          <Image
            testID={category?.banner ? 'category-banner' : 'category-cover'}
            source={{ uri: bannerUri }}
            style={styles.bannerImage}
            resizeMode="cover"
            accessible={false}
          />
          <PhotoShade />
          <View style={styles.bannerCaption}>
            {category ? (
              <Text style={styles.bannerCount}>
                {productCountLabel(branchProductCount(category))}
              </Text>
            ) : null}
          </View>
          {shareAction}
        </View>
      ) : (
        // No picture: the same compact banner in brand colours, so the shape never changes.
        <View style={[styles.banner, styles.bannerFallback]}>
          <View style={styles.bannerCaption}>
            {category ? (
              <Text style={styles.bannerCount}>
                {productCountLabel(branchProductCount(category))}
              </Text>
            ) : (
              <Skeleton width="40%" height={16} radius={theme.radii.sm} />
            )}
          </View>
          {shareAction}
        </View>
      )}
      {parent ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`All of ${parent.name}`}
          accessibilityHint="Opens the parent category"
          hitSlop={6}
          onPress={() => {
            router.push(categoryHref(parent.slug));
          }}
          style={styles.parentLink}
        >
          <ChevronLeft size={16} color={theme.colors.link} accessible={false} />
          <Text style={styles.parentText}>{parent.name}</Text>
        </Pressable>
      ) : null}
      {category?.description ? (
        <Text style={styles.description}>{category.description}</Text>
      ) : null}
      {category ? (
        <SubcategoryGrid
          parentName={category.name}
          // Deeper levels work the same: each screen lists only its own children.
          items={children}
          onSelect={(child) => {
            router.push(categoryHref(child.slug));
          }}
        />
      ) : null}
    </View>
  );

  return (
    <ScreenFrame edges={HEADERLESS_STACK_EDGES}>
      {/*
        The bar carries the back control, the category's own name and the cart; the banner
        below is a photograph with its product count, so the name is not printed twice on one
        screen. It stays put while the list scrolls. The frame pads the top and bottom safe
        areas once; the list inside pads neither.
      */}
      <View style={styles.bar}>
        <ScreenHeader title={category?.name ?? 'Category'} onBack={goBack} right={<CartButton />} />
      </View>
      <CatalogGrid
        testID="category-list"
        edges={NO_EDGES}
        filters={filters}
        sorts={BROWSE_SORTS}
        onSortChange={(sort) => {
          setFilters((current) => ({ ...current, sort }));
        }}
        onFiltersChange={setFilters}
        showCategoryFilter={false}
        header={hero}
      />
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: theme.spacing[5], paddingTop: theme.spacing[2] },
  header: { gap: theme.spacing[3] },
  banner: {
    width: '100%',
    // Compact and fixed, so the same banner reads the same on a small phone and a large one.
    height: 132,
    borderRadius: theme.radii.hero,
    backgroundColor: theme.colors.iconSurface,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    padding: theme.spacing[3],
  },
  bannerImage: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  /** The share control on the banner's top-right corner, clear of the count at the bottom. */
  bannerShare: { position: 'absolute', top: theme.spacing[1], right: theme.spacing[1] },
  bannerFallback: {
    backgroundColor: theme.brand.navy,
  },
  // The name sits straight on the picture, over the fade drawn above it: no panel, no shadow,
  // so the banner stays one clean photograph.
  bannerCaption: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    gap: 2,
  },
  bannerCount: {
    color: 'rgba(255, 255, 255, 0.9)',
    ...theme.text.caption,
  },
  parentLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 2,
    minHeight: theme.touchTarget,
  },
  parentText: { color: theme.colors.link, ...theme.text.bodyStrong },
  description: { color: theme.colors.body, ...theme.text.body, lineHeight: 21 },
});
