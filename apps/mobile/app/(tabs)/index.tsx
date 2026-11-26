import { useRouter } from 'expo-router';
import { PackageOpen } from 'lucide-react-native';
import { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Notice } from '@/components/notice';
import { QueryStateView } from '@/components/query-state';
import { Screen } from '@/components/screen';
import { TAB_BAR_SPACE } from '@/components/tab-bar';
import { describeApiError } from '@/lib/errors';
import { useManualRefresh } from '@/query/use-manual-refresh';
import { useCategories, useProductPage, useShoppingZones } from '@/features/catalog/catalog-hooks';
import { HeroBannerSkeleton } from '@/features/catalog/catalog-skeletons';
import { categoryHref, HOME_ROW_SIZE, shopHref } from '@/features/catalog/catalog-query';
import {
  CategorySection,
  HomeHeader,
  HomeHero,
  HomeTrustPanel,
  ProductRowSection,
} from '@/features/catalog/home-sections';
import { PromoCarousel, PromoRow } from '@/features/catalog/promo-carousel';
import { ZoneSection } from '@/features/catalog/zone-section';
import { startupMark } from '@/startup/startup-timing';
import { theme } from '@/theme';
import { bannerTarget, BrandRow, brandHref } from '@/features/brands/brand-components';
import { useBanners, useBrands } from '@/features/brands/brand-hooks';
import { CampaignStrip } from '@/features/campaigns/campaign-strip';
import { useCampaigns } from '@/features/campaigns/campaign-hooks';

const FEATURED_QUERY = { sort: 'featured', pageSize: HOME_ROW_SIZE } as const;
const NEWEST_QUERY = { sort: 'newest', pageSize: HOME_ROW_SIZE } as const;

export default function HomeScreen() {
  const router = useRouter();
  // Home is mounted behind the splash, so this fires while the animation is still playing: it is
  // the moment the shop's first screen is drawable, not the moment the customer sees it.
  useEffect(() => {
    startupMark('home:first-render');
  }, []);
  const categories = useCategories();
  const featured = useProductPage(FEATURED_QUERY);
  const newest = useProductPage(NEWEST_QUERY);
  const heroBanners = useBanners('home_hero');
  const campaignBanners = useBanners('home_secondary');
  const brands = useBrands();
  // Live promotions. Their prices are already in every product the rows below show.
  const liveCampaigns = useCampaigns();
  // The store's collections. Optional: without any, the rail is left off entirely.
  const zones = useShoppingZones();

  const { refetch: refetchCategories } = categories;
  const { refetch: refetchFeatured } = featured;
  const { refetch: refetchNewest } = newest;
  const { refetch: refetchHeroBanners } = heroBanners;
  const { refetch: refetchCampaignBanners } = campaignBanners;
  const { refetch: refetchBrands } = brands;
  const { refetch: refetchLiveCampaigns } = liveCampaigns;
  const { refetch: refetchZones } = zones;
  const refetchAll = useCallback(
    () =>
      Promise.all([
        refetchCategories(),
        refetchFeatured(),
        refetchNewest(),
        refetchHeroBanners(),
        refetchCampaignBanners(),
        refetchBrands(),
        refetchLiveCampaigns(),
        refetchZones(),
      ]),
    [
      refetchCategories,
      refetchFeatured,
      refetchNewest,
      refetchHeroBanners,
      refetchCampaignBanners,
      refetchBrands,
      refetchLiveCampaigns,
      refetchZones,
    ],
  );
  const { onRefresh } = useManualRefresh(refetchAll);

  // Both listings include every product, so a total of 0 means the catalog itself is empty.
  const catalogEmpty = newest.data?.total === 0 || featured.data?.total === 0;
  // Nothing at all could be loaded (offline, server down): one message, not three.
  const nothingLoaded = [categories, featured, newest].every(
    (query) => query.status === 'error' && query.data === undefined,
  );

  // A refresh failed while earlier data is on screen: keep the data, say it may be out of date.
  const refreshFailure = [categories, featured, newest].find((query) => query.isRefetchError);

  // Promotions are optional: a placement the API answered with none (or could not answer) is
  // simply left out, and the hero card below stands in for a missing hero banner.
  const heroPromotions = heroBanners.data ?? [];
  const campaigns = campaignBanners.data ?? [];

  const openBanner = (href: string | null) => {
    router.navigate(bannerTarget(href));
  };

  const goToShop = (filters?: Parameters<typeof shopHref>[0]) => {
    router.navigate(shopHref(filters));
  };

  let sections;
  if (catalogEmpty) {
    sections = (
      <QueryStateView
        state="empty"
        empty={{
          icon: PackageOpen,
          title: 'Products are on their way',
          description: 'New products are being added. Please check back soon.',
        }}
      />
    );
  } else if (nothingLoaded) {
    sections = (
      <QueryStateView
        state="error"
        error={newest.error}
        onRetry={() => void refetchAll()}
        retrying={categories.isRefetching || featured.isRefetching || newest.isRefetching}
      />
    );
  } else {
    sections = (
      <View style={styles.sections}>
        {/* The website's order, top to bottom: the banner and its promises, the promotions
            strip, the departments, the live sale, the shop's own picks, its makers, its
            collections and finally the featured shelf. */}
        {campaigns.length > 0 ? (
          // No heading: the banners are the section. The gap above is short, so the strip
          // reads as the last thing the trust panel introduced rather than a new band.
          <View style={styles.promotions}>
            <PromoRow
              banners={campaigns}
              onOpen={(banner) => {
                openBanner(banner.ctaHref);
              }}
            />
          </View>
        ) : null}
        <CategorySection
          query={categories}
          onSeeAll={() => {
            router.navigate('/categories');
          }}
          onSelect={(slug) => {
            router.push(categoryHref(slug));
          }}
        />
        <CampaignStrip
          campaigns={liveCampaigns.data ?? []}
          onSelect={() => {
            goToShop();
          }}
        />
        <ProductRowSection
          title="New arrivals"
          subject="new arrivals"
          query={newest}
          select={(page) => page.items}
          onSeeAll={() => {
            goToShop({ sort: 'newest' });
          }}
        />
        <BrandRow
          brands={brands.data ?? []}
          onSelect={(slug) => {
            router.push(brandHref(slug));
          }}
          onSeeAll={() => {
            router.push('/brands');
          }}
        />
        <ZoneSection
          query={zones}
          onSelect={(slug) => {
            goToShop({ zone: slug });
          }}
        />
        <ProductRowSection
          title="Featured"
          subject="featured products"
          query={featured}
          select={(page) => page.items.filter((product) => product.isFeatured)}
          onSeeAll={() => {
            goToShop();
          }}
        />
      </View>
    );
  }

  return (
    <Screen
      testID="home-scroll"
      bottomSpace={TAB_BAR_SPACE}
      // The header and the banner start higher than on other tabs: this is the screen a shopper
      // lands on, and the extra step of air above the logo bought nothing.
      topGap={theme.spacing[2]}
      contentGap={theme.spacing[2]}
      header={
        <HomeHeader
          onSearch={() => {
            router.push('/search');
          }}
          onVoiceSearch={() => {
            router.push({ pathname: '/search', params: { voice: '1' } });
          }}
          onPhotoSearch={() => {
            router.push('/visual-search');
          }}
        />
      }
      onRefresh={onRefresh}
    >
      {/* The trust strip belongs to the banner, so the two share one stack; the strip sets
          its own short gap below it instead of the screen's usual 16dp. */}
      <View>
        {heroPromotions.length > 0 ? (
          <PromoCarousel
            banners={heroPromotions}
            onOpen={(banner) => {
              openBanner(banner.ctaHref);
            }}
          />
        ) : heroBanners.isPending ? (
          // The hero slot is the same height either way, so the page does not jump when the
          // banners arrive and turn out to be empty.
          <HeroBannerSkeleton />
        ) : (
          <HomeHero
            onShop={() => {
              goToShop();
            }}
          />
        )}
        <HomeTrustPanel />
      </View>
      {refreshFailure ? (
        <Notice tone="warning" title="Could not refresh">
          Showing what was loaded earlier. {describeApiError(refreshFailure.error).message}
        </Notice>
      ) : null}
      {sections}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // 16dp between home sections: the rows already carry their own headings, so the page reads as
  // connected blocks rather than bands separated by air.
  sections: { gap: theme.spacing[4] },
  // The promotions row sits directly under the trust panel: a short step, not a full section
  // gap, so the two read as one block without the banners crowding the panel above them.
  promotions: { marginTop: -theme.spacing[1] },
});
