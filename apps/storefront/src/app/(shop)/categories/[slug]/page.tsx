import { slugSchema, type Category } from '@nilzora/contracts';
import { buttonClasses, Card, EmptyState, ShareButton } from '@nilzora/ui';
import { PackageOpen } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumbs, type Crumb } from '@/components/catalog/breadcrumbs';
import { CatalogPage } from '@/components/catalog/catalog-page';
import { CatalogUnavailable } from '@/components/catalog/catalog-states';
import { ancestorsOf, childCategories, productCountLabel } from '@/components/catalog/categories';
import { CategoryCover } from '@/components/catalog/category-cover';
import { FilteredListing } from '@/components/catalog/filtered-listing';
import { CategoryCampaignStrip } from '@/components/marketing/campaign-highlights';
import { CategoryBanner } from '@/components/merchandising';
import {
  getBanners,
  getBrands,
  getCampaigns,
  getCategories,
  getCategory,
  getProductFacets,
  listProducts,
} from '@/lib/catalog';
import {
  BROWSE_SORTS,
  categoryHref,
  listingHref,
  parseBrowseQuery,
  type ListingFilters,
} from '@/lib/catalog-query';
import { pageMetadata } from '@/lib/seo';
import { categoryShareTarget } from '@/lib/share';
import { breadcrumbJsonLd, JsonLd } from '@/lib/structured-data';

export async function generateMetadata({
  params,
}: PageProps<'/categories/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategory(slug);
  if (category.kind !== 'ok') return { title: 'Category' };
  const { name, description, image } = category.value;
  const wide = category.value.banner ?? image;
  return pageMetadata('category', slug, {
    title: name,
    description: description ?? `Shop ${name} at Nilzora and pay in cash on delivery.`,
    path: categoryHref(slug),
    // The wide banner is the page's picture; the logo only when there is no banner.
    imageUrl: wide?.url ?? null,
  });
}

/** The subcategories as tiles: the quickest way down the tree, with their own counts. */
function SubcategoryLinks({
  subcategories,
  filters,
  sort,
}: {
  subcategories: readonly Category[];
  filters: ListingFilters;
  sort: (typeof BROWSE_SORTS)[number];
}) {
  return (
    <nav aria-label="Subcategories">
      <ul role="list" className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
        {subcategories.map((child) => (
          <li key={child.slug} className="shrink-0">
            <Link
              href={listingHref(categoryHref(child.slug), { sort, filters }, 'featured')}
              className="group flex h-full items-center gap-3 rounded-2xl border border-border/80 bg-surface py-2 pr-4 pl-2 shadow-xs transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-md motion-reduce:transition-none"
            >
              <CategoryCover
                image={child.image}
                name={child.name}
                alt=""
                categorySlug={child.slug}
                className="size-10 shrink-0 rounded-xl"
              />
              <span className="grid">
                <span className="text-sm font-semibold whitespace-nowrap text-foreground group-hover:underline group-hover:underline-offset-4">
                  {child.name}
                </span>
                <span className="sr-only">,</span>
                <span className="text-xs whitespace-nowrap text-muted-foreground">
                  {productCountLabel(child.totalProductCount ?? child.productCount)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default async function CategoryPage({
  params,
  searchParams,
}: PageProps<'/categories/[slug]'>) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  // Checked before anything is fetched, so a junk address never reaches the API.
  if (!slugSchema.safeParse(slug).success) notFound();
  const { sort, page, filters } = parseBrowseQuery(query);
  const path = categoryHref(slug);

  // The category comes first (from the cached list), so an unknown slug is not found
  // before any product listing is requested for it.
  const category = await getCategory(slug);

  if (category.kind !== 'ok') {
    return (
      <CatalogPage>
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Category' }]} />
        <CatalogUnavailable
          titleAs="h1"
          kind={category.kind}
          retryHref={listingHref(path, { sort, page, filters }, 'featured')}
          subject="this category"
        />
      </CatalogPage>
    );
  }

  const categories = await getCategories();
  const categoryList = categories.kind === 'ok' ? categories.value : [];
  const children = childCategories(categoryList, slug);
  // A department lists the products of its whole branch, as its "All …" menu link promises.
  const includeSubcategories = children.length > 0;
  const [result, brands, banners, campaigns, facets] = await Promise.all([
    listProducts({ category: slug, includeSubcategories, sort, page, filters }),
    getBrands(),
    getBanners('category', slug),
    getCampaigns(slug),
    getProductFacets({ category: slug, includeSubcategories, filters }),
  ]);
  const banner = banners[0];
  // The most valuable campaign reaching this category leads the strip; the rest of the
  // page keeps its normal order.
  const campaign = campaigns[0];
  const { name, description, image } = category.value;
  // The page header shows the wide banner; the square logo only stands in when no banner was set.
  const headerImage = category.value.banner ?? image;
  const total = category.value.totalProductCount ?? category.value.productCount;
  const share = categoryShareTarget({
    slug: category.value.slug,
    name,
    description,
    image,
  });
  // Only ancestors the API publishes are named, so a hidden parent never leaks.
  const ancestors = ancestorsOf(category.value, categoryList);
  const crumbs: Crumb[] = [
    { label: 'Home', href: '/' },
    { label: 'Categories', href: '/categories' },
    ...ancestors.map((ancestor) => ({ label: ancestor.name, href: categoryHref(ancestor.slug) })),
    { label: name },
  ];

  return (
    <CatalogPage>
      <JsonLd data={breadcrumbJsonLd(crumbs, path)} />
      <div className="grid gap-5">
        <Breadcrumbs items={crumbs} />
        {/*
          The banner carries the category's own name in a glass panel over the picture, so the
          section stays compact: a shorter picture, one heading, no repeat underneath. The navy
          scrim guarantees contrast wherever the photo is light.
        */}
        <header className="relative isolate overflow-hidden rounded-3xl border border-border bg-brand-navy">
          {headerImage ? (
            /* eslint-disable-next-line @next/next/no-img-element -- already-optimised WebP from the media service */
            <img
              src={headerImage.url}
              alt=""
              loading="eager"
              fetchPriority="high"
              decoding="async"
              draggable={false}
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-linear-to-br from-brand-navy via-brand-slate to-brand-navy"
            >
              <div className="absolute -top-16 -right-10 size-56 rounded-full bg-brand-sky/25 blur-3xl" />
            </div>
          )}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-linear-to-t from-brand-navy/85 via-brand-navy/40 to-brand-navy/10"
          />
          {/* The share control sits on the banner itself, in its top-right corner: it belongs to
              the category, and the words below keep the full width of the row. */}
          {share ? (
            <ShareButton
              target={share}
              size="sm"
              tone="onMedia"
              className="absolute top-3 right-3 z-2 sm:top-4 sm:right-4"
            />
          ) : null}
          {/*
            The name sits straight on the picture: no panel, no blur. The scrim above carries the
            contrast, and a soft text shadow keeps the words readable over a bright photograph.
          */}
          <div className="relative flex min-h-36 items-end p-3 sm:min-h-44 sm:p-5 lg:min-h-48">
            <div className="w-full max-w-2xl [text-shadow:0_1px_16px_rgba(15,23,42,0.65)] sm:w-auto">
              {ancestors.length > 0 ? (
                <p className="text-[11px] font-semibold tracking-wider text-white/85 uppercase">
                  {ancestors.map((ancestor) => ancestor.name).join(' · ')}
                </p>
              ) : null}
              <h1 className="font-display text-2xl font-semibold tracking-tight text-balance text-white sm:text-3xl">
                {name}
              </h1>
              <p className="mt-0.5 text-sm text-white/90">
                {productCountLabel(total)}
                {includeSubcategories
                  ? ` across ${children.length} ${children.length === 1 ? 'subcategory' : 'subcategories'}`
                  : ''}
              </p>
            </div>
          </div>
        </header>
        {/*
          The category's own words, with the one action that belongs to a department page: a
          link to it. The button is on this row rather than over the picture, so it never covers
          the banner's name or competes with the product grid.
        */}
        {/*
          The category's own words. The share control now lives on the banner's top-right corner,
          so this row is only the description — nothing competes with the product grid.
        */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          {description ? (
            <p className="max-w-3xl text-sm leading-relaxed text-pretty text-body sm:text-base">
              {description}
            </p>
          ) : null}
        </div>
        {children.length > 0 ? (
          <SubcategoryLinks subcategories={children} filters={filters} sort={sort} />
        ) : null}
        {campaign ? <CategoryCampaignStrip campaign={campaign} /> : null}
        {banner ? <CategoryBanner banner={banner} /> : null}
      </div>

      <FilteredListing
        path={path}
        result={result}
        page={page}
        sort={sort}
        sorts={BROWSE_SORTS}
        filters={filters}
        defaultSortFor={() => 'featured'}
        categoryLinks={{ categories: categoryList, current: slug }}
        brands={brands.kind === 'ok' ? brands.value : undefined}
        facets={facets}
        subject="products"
        empty={
          <Card>
            <EmptyState
              icon={PackageOpen}
              title={`Nothing in ${name} yet`}
              description="Products for this category are on their way. In the meantime, browse the rest of the catalog."
              className="py-14"
              action={
                <Link href="/products" className={buttonClasses({ variant: 'outline' })}>
                  Browse all products
                </Link>
              }
            />
          </Card>
        }
      />
    </CatalogPage>
  );
}
