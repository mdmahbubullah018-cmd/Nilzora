import type {
  Category,
  MyReview,
  ProductDetail,
  ProductReviewsResponse,
  ProductSummary,
  Voucher,
} from '@nilzora/contracts';
import { CSRF_FIELD } from '@nilzora/web-session';
import { Card, CardContent, ShareButton } from '@nilzora/ui';
import { Banknote, Camera, ShoppingBag, Truck, Undo2, type LucideIcon } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { WishlistButton } from '@/components/wishlist/wishlist-button';
import { ProductPurchase } from '@/components/catalog/product-purchase';
import { Breadcrumbs, type Crumb } from '@/components/catalog/breadcrumbs';
import { CatalogPage } from '@/components/catalog/catalog-page';
import { CatalogUnavailable } from '@/components/catalog/catalog-states';
import { ancestorsOf } from '@/components/catalog/categories';
import { SoldCount, soldCountLabel } from '@/components/catalog/sold-count';
import { ProductGrid } from '@/components/catalog/product-card';
import { ProductGallery } from '@/components/catalog/product-gallery';
import { VariantImageProvider } from '@/components/catalog/variant-image-context';
import { ProductReviews } from '@/components/product/product-reviews';
import {
  ProductReviewsDrawer,
  ReviewsSummaryButton,
} from '@/components/product/product-reviews-drawer';
import { ProductSpecs } from '@/components/product/product-specs';
import { shownSizeChart, SizeGuideSection } from '@/components/product/size-chart';
import { ProductOffers } from '@/components/vouchers/product-offers';
import { getProductVouchers } from '@/lib/product-vouchers';
import { AskSupportButton } from '@/components/support/ask-support-button';
import type { CsrfField } from '@/components/auth/form-kit';
import { readAccount } from '@/lib/account-read';
import { singleParam } from '@/lib/auth-params';
import { addToCartAction } from '@/lib/cart-actions';
import { pageMetadata } from '@/lib/seo';
import { productShareTarget } from '@/lib/share';
import { session } from '@/lib/session';
import {
  getCategories,
  getProduct,
  getProductReviews,
  listBrandProducts,
  listProducts,
} from '@/lib/catalog';
import {
  brandHref,
  categoryHref,
  productHref,
  REVIEW_PAGE_SIZE,
  reviewsShown,
} from '@/lib/catalog-query';
import { breadcrumbJsonLd, JsonLd, productJsonLd } from '@/lib/structured-data';

/** How many other products to suggest. */
const RELATED_COUNT = 4;

export async function generateMetadata({
  params,
}: PageProps<'/products/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (product.kind !== 'ok') return { title: 'Product' };
  const { name, summary, images } = product.value;
  return pageMetadata('product', slug, {
    title: name,
    description: summary ?? `Buy ${name} at Nilzora and pay in cash on delivery.`,
    path: productHref(slug),
    imageUrl: images[0]?.url ?? null,
  });
}

const assurances: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: Banknote,
    title: 'Cash on Delivery',
    description: 'Pay in cash when your parcel arrives. No card or online payment needed.',
  },
  {
    icon: Truck,
    title: 'Delivery charge shown at checkout',
    description: 'You see the charge for your address and the full total before you order.',
  },
  {
    icon: Undo2,
    title: 'Changed your mind?',
    description: 'You can cancel an order from your account while it is still pending.',
  },
];

/** Paragraphs as written; line breaks inside a paragraph are kept. */
function Description({ text }: { text: string }) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  return (
    <div className="grid max-w-3xl gap-4 text-sm leading-relaxed sm:text-base">
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="whitespace-pre-line">
          {paragraph}
        </p>
      ))}
    </div>
  );
}

function ProductView({
  product,
  categoryPath,
  related,
  reviews,
  mine,
  viewer,
  csrf,
  moreReviewsHref,
  offers,
}: {
  product: ProductDetail;
  categoryPath: readonly Pick<Category, 'slug' | 'name'>[];
  related: readonly ProductSummary[];
  reviews: ProductReviewsResponse | undefined;
  mine: MyReview | undefined;
  viewer: 'signed_in' | 'signed_out' | 'unknown';
  csrf: CsrfField | undefined;
  moreReviewsHref: Route;
  offers: {
    vouchers: Voucher[];
    signedIn: boolean;
    csrf: CsrfField | undefined;
    /** A voucher chosen before signing in, to collect now that the customer is back. */
    collectVoucherId: string | undefined;
  };
}) {
  const category = product.category;
  const path = productHref(product.slug);
  const sizeChart = shownSizeChart(product.sizeChart);
  // One canonical public address for the page, built from the store's own origin: the button
  // never sees a raw id or a bucket address, and a product with no name shares nothing.
  const share = productShareTarget({
    slug: product.slug,
    name: product.name,
    summary: product.summary,
    image: product.images[0] ?? null,
  });
  const crumbs: Crumb[] = [
    { label: 'Home', href: '/' },
    ...categoryPath.map((entry) => ({ label: entry.name, href: categoryHref(entry.slug) })),
    { label: product.name },
  ];

  return (
    <ProductReviewsDrawer
      summary={reviews?.summary}
      panel={
        <ProductReviews
          productId={product.id}
          slug={product.slug}
          reviews={reviews}
          mine={mine}
          viewer={viewer}
          csrf={csrf}
          moreHref={moreReviewsHref}
        />
      }
    >
      <CatalogPage className="lg:pr-16">
        <JsonLd data={productJsonLd(product, path, reviews?.summary)} />
        <JsonLd data={breadcrumbJsonLd(crumbs, path)} />
        <Breadcrumbs items={crumbs} />

        <VariantImageProvider
          initial={
            product.variants.length === 1 && product.variants[0]?.imageUrl
              ? {
                  url: product.variants[0].imageUrl,
                  label: product.variants[0].options.map((option) => option.value).join(' / '),
                }
              : null
          }
        >
          <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
            <div className="grid gap-3 self-start">
              <ProductGallery
                images={product.images}
                videos={product.videos ?? []}
                productName={product.name}
                categorySlug={category.slug}
                className="mx-auto w-full max-w-md self-start lg:sticky lg:top-32 lg:max-w-none"
              />
              {/* The picture the store already holds seeds the search: no upload, no re-embedding. */}
              <Link
                href={{
                  pathname: '/search/image',
                  query: {
                    product: product.id,
                    ...(product.image === null ? {} : { thumb: product.image.thumbUrl }),
                    name: product.name,
                  },
                }}
                className="mx-auto flex items-center gap-2 rounded-full bg-surface-muted px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-border lg:mx-0"
              >
                <Camera aria-hidden="true" className="size-4" strokeWidth={1.75} />
                Find similar products
              </Link>
            </div>
            <div className="grid content-start gap-6 self-start">
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={categoryHref(category.slug)}
                    className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold tracking-wide text-primary uppercase underline-offset-4 hover:underline"
                  >
                    {category.name}
                  </Link>
                  {product.brand ? (
                    <Link
                      href={brandHref(product.brand.slug)}
                      className="rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      by <span className="font-semibold text-foreground">{product.brand.name}</span>
                    </Link>
                  ) : null}
                </div>
                <div className="flex items-start justify-between gap-3">
                  <h1 className="font-display text-2xl font-semibold tracking-tight text-balance text-foreground sm:text-3xl lg:text-4xl">
                    {product.name}
                  </h1>
                  <div className="mt-1 flex shrink-0 items-start gap-2">
                    {/* Beside the heart, and never in front of the price or the buy actions. */}
                    {share ? <ShareButton target={share} size="md" /> : null}
                    <WishlistButton
                      product={{ id: product.id, slug: product.slug, name: product.name }}
                      size="md"
                    />
                  </div>
                </div>
                {product.summary ? (
                  <p className="text-base leading-relaxed text-pretty">{product.summary}</p>
                ) : null}
                <ReviewsSummaryButton />
                {soldCountLabel(product.soldCount) !== null ? (
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <ShoppingBag aria-hidden="true" className="size-4" strokeWidth={1.75} />
                    <SoldCount count={product.soldCount} className="font-medium text-foreground" />
                  </p>
                ) : null}
              </div>

              <ProductPurchase
                product={product}
                action={addToCartAction}
                sizeChart={sizeChart ?? undefined}
              />

              <ProductOffers
                vouchers={offers.vouchers}
                csrf={offers.csrf ?? null}
                signedIn={offers.signedIn}
                returnTo={path}
                productSlug={product.slug}
                collectVoucherId={offers.collectVoucherId}
              />

              <div className="justify-self-start">
                <AskSupportButton
                  label="Ask about this product"
                  request={{ productId: product.id, subject: product.name }}
                />
              </div>

              <Card className="bg-surface-muted/60 shadow-none">
                <CardContent className="grid gap-4 p-4 sm:p-5">
                  <h2 className="sr-only">Payment and delivery</h2>
                  <ul role="list" className="grid gap-4">
                    {assurances.map(({ icon: Icon, title, description }) => (
                      <li key={title} className="flex gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface text-primary ring-1 ring-border">
                          <Icon aria-hidden="true" className="size-4.5" />
                        </span>
                        <div className="grid gap-0.5">
                          <p className="text-sm font-semibold text-foreground">{title}</p>
                          <p className="text-sm leading-relaxed text-muted-foreground">
                            {description}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </VariantImageProvider>

        <div className="grid gap-8 border-t border-border pt-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-12">
          {product.description ? (
            // On a phone the specifications answer "what is this?" first; the long description
            // follows. The source order stays description-first for the two-column layout and
            // for anyone reading linearly with a screen reader.
            <section
              aria-labelledby="product-details"
              className="order-2 grid content-start gap-4 lg:order-none"
            >
              <h2
                id="product-details"
                className="font-display text-xl font-semibold tracking-tight text-foreground"
              >
                Product details
              </h2>
              <Description text={product.description} />
            </section>
          ) : null}
          <section
            aria-labelledby="product-specs"
            className={
              product.description
                ? 'order-1 grid content-start gap-4 lg:order-none'
                : 'grid content-start gap-4 lg:col-span-2'
            }
          >
            <h2
              id="product-specs"
              className="font-display text-xl font-semibold tracking-tight text-foreground"
            >
              Specifications
            </h2>
            <ProductSpecs product={product} categoryPath={categoryPath} />
          </section>
        </div>

        {sizeChart ? <SizeGuideSection chart={sizeChart} productName={product.name} /> : null}

        {related.length > 0 ? (
          <section
            aria-labelledby="related-products"
            className="grid gap-5 border-t border-border pt-8"
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2
                id="related-products"
                className="font-display text-xl font-semibold tracking-tight text-foreground"
              >
                You may also like
              </h2>
              <Link
                href={categoryHref(category.slug)}
                className="rounded-sm text-sm font-semibold text-link underline-offset-4 hover:underline"
              >
                View all in {category.name}
              </Link>
            </div>
            <ProductGrid products={related} headingLevel="h3" />
          </section>
        ) : null}
      </CatalogPage>
    </ProductReviewsDrawer>
  );
}

/**
 * Other products to suggest: more from the same category, then — if that leaves room — more
 * from the same brand. Never the product itself, never the same product twice. Suggestions
 * are optional: anything that cannot be read is simply left out.
 */
async function relatedProducts(product: ProductDetail): Promise<ProductSummary[]> {
  const picked: ProductSummary[] = [];
  const add = (items: readonly ProductSummary[]) => {
    for (const item of items) {
      if (picked.length >= RELATED_COUNT) return;
      if (item.id === product.id || picked.some((entry) => entry.id === item.id)) continue;
      picked.push(item);
    }
  };
  const sameCategory = await listProducts({
    category: product.category.slug,
    sort: 'featured',
    page: 1,
    pageSize: RELATED_COUNT + 1,
  });
  if (sameCategory.kind === 'ok') add(sameCategory.value.items);
  if (picked.length < RELATED_COUNT && product.brand) {
    const sameBrand = await listBrandProducts(product.brand.slug, {
      sort: 'featured',
      page: 1,
      pageSize: RELATED_COUNT + 1 + picked.length,
    });
    if (sameBrand.kind === 'ok') add(sameBrand.value.items);
  }
  return picked;
}

export default async function ProductPage({ params, searchParams }: PageProps<'/products/[slug]'>) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const product = await getProduct(slug);

  if (product.kind !== 'ok') {
    return (
      <CatalogPage>
        <Breadcrumbs
          items={[
            { label: 'Home', href: '/' },
            { label: 'All products', href: '/products' },
            { label: 'Product' },
          ]}
        />
        <CatalogUnavailable
          titleAs="h1"
          kind={product.kind}
          retryHref={productHref(slug)}
          subject="this product"
        />
      </CatalogPage>
    );
  }

  const shown = reviewsShown(singleParam(query, 'reviews'));
  // Only a voucher id shape is carried through; anything else is ignored, never echoed.
  const chosenVoucher = singleParam(query, 'collect');
  const collectVoucherId =
    chosenVoucher !== undefined &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chosenVoucher)
      ? chosenVoucher
      : undefined;
  // Reviews, the category path and suggestions are optional: the page renders without them.
  const [related, reviews, mine, categories, offered] = await Promise.all([
    relatedProducts(product.value),
    getProductReviews(product.value.slug, shown),
    readAccount((api, accessToken) => api.myProductReview(accessToken, product.value.id)),
    getCategories(),
    getProductVouchers(product.value.slug),
  ]);
  const csrf =
    mine.kind === 'ok' ? { name: CSRF_FIELD, token: await session.csrfToken() } : undefined;
  // Who is asking, kept apart from whether their review could be read: "signed_out" is the
  // only state that may offer a sign-in link, and a failed read must never look like one.
  const viewer =
    mine.kind === 'ok'
      ? ('signed_in' as const)
      : mine.kind === 'signed_out'
        ? ('signed_out' as const)
        : ('unknown' as const);

  const own = product.value.category;
  const known =
    categories.kind === 'ok' ? categories.value.find((c) => c.slug === own.slug) : undefined;
  const categoryPath =
    known && categories.kind === 'ok'
      ? [...ancestorsOf(known, categories.value), known]
      : [{ slug: own.slug, name: own.name }];
  const nextBatch = Math.floor(shown / REVIEW_PAGE_SIZE) + 1;
  const moreReviewsHref =
    `${productHref(product.value.slug)}?reviews=${nextBatch}#reviews` as Route;

  return (
    <ProductView
      product={product.value}
      categoryPath={categoryPath}
      related={related}
      reviews={reviews.kind === 'ok' ? reviews.value : undefined}
      mine={mine.kind === 'ok' ? mine.value : undefined}
      viewer={viewer}
      csrf={csrf}
      moreReviewsHref={moreReviewsHref}
      offers={{
        vouchers: offered.vouchers,
        signedIn: offered.signedIn,
        csrf: offered.signedIn ? { name: CSRF_FIELD, token: await session.csrfToken() } : undefined,
        collectVoucherId,
      }}
    />
  );
}
