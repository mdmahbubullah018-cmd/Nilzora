import { buttonClasses, Card, EmptyState, ShareButton } from '@nilzora/ui';
import { PackageOpen } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { permanentRedirect } from 'next/navigation';
import { Breadcrumbs, type Crumb } from '@/components/catalog/breadcrumbs';
import { CatalogPage } from '@/components/catalog/catalog-page';
import { CatalogUnavailable } from '@/components/catalog/catalog-states';
import { productCountLabel } from '@/components/catalog/categories';
import { FilteredListing } from '@/components/catalog/filtered-listing';
import { BrandMark } from '@/components/merchandising';
import { getBrand, getProductFacets, listBrandProducts, listProducts } from '@/lib/catalog';
import { brandHref, BROWSE_SORTS, hasActiveFilters, parseBrowseQuery } from '@/lib/catalog-query';
import { siteUrl, twitterCard } from '@/lib/seo';
import { brandShareTarget } from '@/lib/share';
import { breadcrumbJsonLd, JsonLd } from '@/lib/structured-data';

/*
 * A brand's page at /<brand-slug>. Static store routes always win over this dynamic
 * one, and the API refuses brand slugs that equal a store path, so the two never meet.
 * A former slug redirects permanently to the brand's current address.
 */

export async function generateMetadata({ params }: PageProps<'/[brand]'>): Promise<Metadata> {
  const { brand: slug } = await params;
  const read = await getBrand(slug);
  if (read.kind !== 'ok' || !read.value.brand) return { title: 'Brand' };
  const { name, description, logo, banner } = read.value.brand;
  const text = description ?? `Shop ${name} at Nilzora and pay in cash on delivery.`;
  const canonical = new URL(brandHref(read.value.brand.slug), siteUrl()).toString();
  // The page's own artwork when the brand has one; the logo stands in otherwise.
  const picture = banner ?? logo;
  return {
    title: name,
    description: text,
    alternates: { canonical },
    openGraph: {
      title: name,
      description: text,
      url: canonical,
      type: 'website',
      ...(picture ? { images: [{ url: picture.url }] } : {}),
    },
    twitter: twitterCard(name, text, picture?.url ?? null),
  };
}

export default async function BrandPage({ params, searchParams }: PageProps<'/[brand]'>) {
  const [{ brand: slug }, query] = await Promise.all([params, searchParams]);
  const read = await getBrand(slug);
  const parsed = parseBrowseQuery(query);
  const { sort, page } = parsed;
  // The brand is the page itself, never a filter on it.
  const filters = { ...parsed.filters, brand: undefined };

  if (read.kind !== 'ok') {
    return (
      <CatalogPage>
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Brand' }]} />
        <CatalogUnavailable
          titleAs="h1"
          kind={read.kind}
          retryHref="/brands"
          subject="this brand"
        />
      </CatalogPage>
    );
  }
  if (read.value.redirectTo) permanentRedirect(brandHref(read.value.redirectTo));
  const brand = read.value.brand;
  if (!brand) permanentRedirect('/brands');

  const path = brandHref(brand.slug);
  const share = brandShareTarget({
    slug: brand.slug,
    name: brand.name,
    description: brand.description,
    logo: brand.logo,
  });
  // Unfiltered, the brand's own listing; narrowed by price, stock, size or colour, the filtered
  // catalog (which carries the brand as a filter and therefore supports every facet).
  const [result, facets] = await Promise.all([
    hasActiveFilters(filters)
      ? listProducts({ sort, page, filters: { ...filters, brand: brand.slug } })
      : listBrandProducts(brand.slug, { sort, page }),
    getProductFacets({ filters: { ...filters, brand: brand.slug } }),
  ]);
  const crumbs: Crumb[] = [
    { label: 'Home', href: '/' },
    { label: 'Brands', href: '/brands' },
    { label: brand.name },
  ];

  return (
    <CatalogPage>
      <JsonLd data={breadcrumbJsonLd(crumbs, path)} />
      <Breadcrumbs items={crumbs} />
      <header className="relative isolate overflow-hidden rounded-3xl border border-border bg-brand-navy">
        {/*
          The category page's banner: the picture edge to edge, a navy scrim for contrast, the
          share control in the corner, and the brand's product count on a small glass chip. The
          logo is deliberately NOT drawn over the artwork — it sits beside the brand's name in
          the heading below, with no plate, border or box around it.
        */}
        {brand.banner ? (
          /* eslint-disable-next-line @next/next/no-img-element -- already-resized WebP from the media service */
          <img
            src={brand.banner.url}
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
        {share ? (
          <ShareButton
            target={share}
            size="sm"
            tone="onMedia"
            className="absolute top-3 right-3 z-2 sm:top-4 sm:right-4"
          />
        ) : null}

        <div className="relative flex min-h-36 items-end p-3 sm:min-h-40 sm:p-4 lg:min-h-44">
          <span className="inline-flex items-center rounded-full bg-brand-navy/35 px-2.5 py-1 text-xs font-medium text-white ring-1 ring-white/20 backdrop-blur-md">
            {productCountLabel(brand.productCount)}
          </span>
        </div>
      </header>

      {/* The heading the Shop by Category page uses: a quiet eyebrow, the brand as the page's
          one title, and the mark beside it with nothing drawn around it. */}
      <div className="grid gap-1">
        <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Shop by brand
        </p>
        <div className="flex min-w-0 items-center gap-2.5">
          <BrandMark brand={brand} shape="band" className="size-7 shrink-0 sm:size-8" />
          <h1 className="line-clamp-2 min-w-0 font-display text-2xl font-semibold tracking-tight wrap-break-word text-foreground sm:text-3xl">
            {brand.name}
          </h1>
        </div>
      </div>

      {brand.description ? (
        // The count is on the banner and the name is the heading; this line carries only what
        // else the brand says about itself.
        <p className="text-sm leading-relaxed text-muted-foreground">{brand.description}</p>
      ) : null}

      <FilteredListing
        path={path}
        result={result}
        page={page}
        sort={sort}
        sorts={BROWSE_SORTS}
        filters={filters}
        defaultSortFor={() => 'featured'}
        facets={facets}
        subject="products"
        empty={
          <Card>
            <EmptyState
              icon={PackageOpen}
              title={`No ${brand.name} products yet`}
              description="Products from this brand are on their way. In the meantime, explore other brands."
              className="py-14"
              action={
                <Link href="/brands" className={buttonClasses({ variant: 'outline' })}>
                  See all brands
                </Link>
              }
            />
          </Card>
        }
      />
    </CatalogPage>
  );
}
