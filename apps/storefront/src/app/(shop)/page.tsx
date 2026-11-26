import type { HomepageSection, HomepageSectionKey } from '@nilzora/contracts';
import { Card, EmptyState } from '@nilzora/ui';
import { ArrowRight, PackageOpen } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { ProductGrid } from '@/components/catalog/product-card';
import { CatalogUnavailable } from '@/components/catalog/catalog-states';
import { Container } from '@/components/layout/section';
import { AudienceCollections } from '@/components/marketing/audience-collections';
import { BrandShelf } from '@/components/marketing/brand-shelf';
import { CategoryShowcase } from '@/components/marketing/category-showcase';
import { ProductRail } from '@/components/marketing/featured-products';
import { HomeHero } from '@/components/marketing/home-hero';
import { HomeSection } from '@/components/marketing/home-section';
import { ServiceStrip } from '@/components/marketing/service-strip';
import { AppDownloadStrip } from '@/components/marketing/store-badges';
import { HomeCampaignSection } from '@/components/marketing/campaign-highlights';
import { shoppableZones, ZoneRail } from '@/components/marketing/zone-rail';
import { CampaignBanners } from '@/components/merchandising';
import { appDownloadLinks } from '@/lib/app-links';
import {
  getBanners,
  getBrands,
  getCampaigns,
  getCategories,
  getShoppingZones,
  listProducts,
} from '@/lib/catalog';
import { NO_FILTERS } from '@/lib/catalog-query';
import { devSampleSlides, heroSlides } from '@/lib/hero-slides';
import { brandsThenFeatured, saleBeforeCategories } from '@/lib/home-order';
import { audienceDepartment, NEW_ARRIVALS_HREF } from '@/lib/navigation';
import { storeProfile } from '@/lib/seo';
import { getHomepageSections } from '@/lib/site-content';

const FEATURED_COUNT = 10;
const NEW_ARRIVALS_COUNT = 4;

/**
 * The home page as it was before the store could arrange it: this order, every section on,
 * no custom titles and the built-in item counts. It is used whenever the store has set
 * nothing up or its settings cannot be read.
 */
const DEFAULT_ORDER: readonly HomepageSectionKey[] = [
  'hero',
  'services',
  'promotions',
  'categories',
  'new_arrivals',
  'featured',
  'brands',
];
const DEFAULT_SECTIONS: readonly HomepageSection[] = DEFAULT_ORDER.map((key) => ({
  key,
  title: null,
  itemLimit: null,
  config: {},
}));

/** "View all" style link beside a section title. */
function SectionLink({ href, children }: { href: Route; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-surface/80 px-4 text-sm font-semibold text-foreground backdrop-blur-sm transition-[background-color,border-color,scale] duration-200 hover:border-border-strong hover:bg-surface active:scale-[0.98] motion-reduce:transition-none"
    >
      {children}
      <ArrowRight
        aria-hidden="true"
        className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
      />
    </Link>
  );
}

export default async function HomePage() {
  // The store's arrangement of the page: the enabled sections in order, with their titles and
  // item counts. Null (nothing set up, or unreachable) shows the page as it always was.
  const arranged = await getHomepageSections();
  // Two presentation rules on top of the store's own arrangement: the promotional strip reads
  // before the categories, and Featured Products closes the page just above Shop by Brand.
  const sections = brandsThenFeatured(saleBeforeCategories(arranged ?? DEFAULT_SECTIONS));
  const section = (key: HomepageSectionKey) => sections.find((entry) => entry.key === key);
  const titleOf = (key: HomepageSectionKey, fallback: string) =>
    section(key)?.title?.trim() || fallback;
  const featuredConfig = section('featured')?.config ?? {};
  const newConfig = section('new_arrivals')?.config ?? {};
  const featuredCurated =
    featuredConfig.categorySlug !== undefined || featuredConfig.brandSlug !== undefined;

  // The profile is request-cached: the shop layout already read it, so this is no second call.
  const [
    featured,
    newest,
    categories,
    heroBanners,
    campaigns,
    brands,
    profile,
    discountCampaigns,
    zones,
  ] = await Promise.all([
    listProducts({
      sort: 'featured',
      page: 1,
      pageSize: section('featured')?.itemLimit ?? FEATURED_COUNT,
      ...(featuredConfig.categorySlug === undefined
        ? {}
        : { category: featuredConfig.categorySlug }),
      ...(featuredConfig.brandSlug === undefined
        ? {}
        : { filters: { ...NO_FILTERS, brand: featuredConfig.brandSlug } }),
    }),
    listProducts({
      sort: 'newest',
      page: 1,
      pageSize: section('new_arrivals')?.itemLimit ?? NEW_ARRIVALS_COUNT,
      ...(newConfig.categorySlug === undefined ? {} : { category: newConfig.categorySlug }),
      ...(newConfig.brandSlug === undefined
        ? {}
        : { filters: { ...NO_FILTERS, brand: newConfig.brandSlug } }),
    }),
    getCategories(),
    getBanners('home_hero'),
    getBanners('home_secondary'),
    getBrands(),
    storeProfile(),
    // Live promotions. Their prices are already in every product below.
    getCampaigns(),
    // The store's collections. Optional: an empty list simply leaves the section out.
    getShoppingZones(),
  ]);

  // Admin banners only; the labelled dev samples appear solely under `next dev` when enabled.
  const uploadedSlides = heroSlides(heroBanners);
  const slides = uploadedSlides.length > 0 ? uploadedSlides : devSampleSlides();

  const appLinks = appDownloadLinks(profile);
  const categoryList = categories.kind === 'ok' ? categories.value : [];
  const departments = categoryList
    .filter((category) => category.parentSlug === null)
    .slice(0, section('categories')?.itemLimit ?? undefined);
  const men = audienceDepartment(categoryList, 'men');
  const women = audienceDepartment(categoryList, 'women');
  // Only collections with something on the shelf: an empty tile is a dead end.
  const zoneList = shoppableZones(zones);

  // Only products the admin actually flagged as featured; the featured sort lists everything.
  // A row the store curated by category or brand shows what it asked for, flagged or not.
  const featuredItems =
    featured.kind === 'ok'
      ? featuredCurated
        ? featured.value.items
        : featured.value.items.filter((product) => product.isFeatured)
      : [];
  const newestItems = newest.kind === 'ok' ? newest.value.items : [];
  const productsUnavailable = featured.kind !== 'ok' && newest.kind !== 'ok';
  const catalogEmpty = newest.kind === 'ok' && newest.value.total === 0 && featured.kind === 'ok';

  // Shop the Collections sits between Featured Products and Shop by Brand, where a shopper who
  // has scrolled past the catalogue still meets the curated groups before the makers.
  const collections =
    zoneList.length > 0 ? (
      <HomeSection
        id="collections"
        title="Shop the Collections"
        eyebrow="Curated"
        description="Hand-picked groups of products: shop a whole look, a season or an occasion."
        joined
      >
        <ZoneRail zones={zoneList} />
      </HomeSection>
    ) : men !== null || women !== null ? (
      // No zone can be shopped yet: the departments named for them stand in.
      <HomeSection id="collections" title="Shop the Collections" joined>
        <AudienceCollections men={men} women={women} />
      </HomeSection>
    ) : null;

  /**
   * Collections read after Shop by Brand and before Featured Products. They are drawn by the
   * featured block (so both stay in that order), unless the store switched Featured Products
   * off: then the brands block draws them, so they are never lost.
   */
  const collectionsWithBrands = !sections.some((entry) => entry.key === 'featured');

  /**
   * The discount campaigns band. The store decides whether campaigns appear at all (the
   * promotions section); when it does, the band always reads straight after the categories,
   * so a shopper meets the catalogue before the sale that belongs to it.
   */
  const campaignBand =
    sections.some((entry) => entry.key === 'promotions') && discountCampaigns.length > 0 ? (
      <HomeCampaignSection campaigns={discountCampaigns} />
    ) : null;

  const render = (entry: HomepageSection, index: number): ReactNode => {
    switch (entry.key) {
      case 'hero':
        return <HomeHero slides={slides} />;

      case 'services':
        return (
          <>
            {/* A deliberate tuck into the banner's bottom edge, instead of a gap: the strip
                belongs to the banner's stage. With no stage padding below the banner, this
                small negative margin is the whole gap, so nothing on either side is clipped.
                On desktop the tuck is 16px (about 4% of the banner height at 1440px) rather
                than 32px, so the panel sits a little lower without opening a gap. */}
            <ServiceStrip
              profile={profile}
              className={sections[index - 1]?.key === 'hero' ? '-mt-2 sm:-mt-3 lg:-mt-4' : 'mt-6'}
            />
            {/*
              On phones and tablets the store options sit immediately under the trusted band, on
              one line: the heading, then a mark and its wording for each published store. No
              card of its own beyond a translucent sheet, and no words we invented.
            */}
            <AppDownloadStrip links={appLinks} className="mt-1 max-md:mt-1.5 lg:hidden" />
          </>
        );

      case 'categories':
        return (
          <>
            {categories.kind !== 'ok' ? (
              <HomeSection id="categories" title={titleOf('categories', 'Shop by Category')}>
                <CatalogUnavailable kind={categories.kind} retryHref="/" subject="categories" />
              </HomeSection>
            ) : departments.length > 0 ? (
              <HomeSection
                id="categories"
                title={titleOf('categories', 'Shop by Category')}
                action={<SectionLink href="/categories">View all</SectionLink>}
              >
                <CategoryShowcase categories={departments} />
              </HomeSection>
            ) : null}
            {campaignBand}
          </>
        );

      case 'new_arrivals':
        return productsUnavailable ? (
          <HomeSection id="products" title={titleOf('new_arrivals', 'New Arrivals')}>
            <CatalogUnavailable kind={featured.kind} retryHref="/" subject="products" />
          </HomeSection>
        ) : catalogEmpty ? (
          <section aria-label="Products" className="py-10 sm:py-14">
            <Container>
              <Card className="border-dashed bg-surface/80 shadow-none">
                <EmptyState
                  icon={PackageOpen}
                  title="Products are on their way"
                  description="New products are being added. Please check back soon."
                  className="py-16"
                />
              </Card>
            </Container>
          </section>
        ) : newestItems.length > 0 ? (
          <HomeSection
            id="new-arrivals"
            eyebrow="Just in"
            title={titleOf('new_arrivals', 'New Arrivals')}
            description="The latest additions to the store."
            action={<SectionLink href={NEW_ARRIVALS_HREF}>View all</SectionLink>}
          >
            <ProductGrid products={newestItems} headingLevel="h3" />
          </HomeSection>
        ) : null;

      case 'featured':
        return (
          <>
            {/* Collections read after Shop by Brand and before Featured Products. */}
            {collectionsWithBrands ? null : collections}
            {featuredItems.length > 0 ? (
              <HomeSection
                id="featured"
                eyebrow="Featured"
                title={titleOf('featured', 'Featured Products')}
                action={<SectionLink href="/products">Shop all</SectionLink>}
                muted
              >
                <ProductRail products={featuredItems} />
              </HomeSection>
            ) : null}
          </>
        );

      /*
       * The promotional strip belongs under the trusted band, above the categories: it is the
       * picture of what is on offer. The discount campaigns that follow it are a separate,
       * data-driven band and are drawn after the categories (see the categories case), so the
       * order reads: hero, trusted, promotional banners, categories, discount campaigns, new
       * arrivals, brands, collections, featured products.
       */
      case 'promotions':
        return (
          <>
            {campaigns.length > 0 ? <CampaignBanners banners={campaigns} /> : null}
            {/* Without a categories section there is nothing for the band to follow. */}
            {sections.some((entry) => entry.key === 'categories') ? null : campaignBand}
          </>
        );

      case 'brands':
        return (
          <>
            {brands.kind === 'ok' && brands.value.length > 0 ? (
              <HomeSection
                id="brands"
                title={titleOf('brands', 'Shop by Brand')}
                action={<SectionLink href="/brands">All brands</SectionLink>}
              >
                <BrandShelf
                  brands={brands.value.slice(0, section('brands')?.itemLimit ?? undefined)}
                />
              </HomeSection>
            ) : null}
            {/* A store without Featured Products still shows its collections, after Brands. */}
            {collectionsWithBrands ? collections : null}
          </>
        );
    }
  };

  return (
    <>
      <h1 className="sr-only">Nilzora online shop</h1>
      {sections.map((entry, index) => (
        <Fragment key={entry.key}>{render(entry, index)}</Fragment>
      ))}
    </>
  );
}
