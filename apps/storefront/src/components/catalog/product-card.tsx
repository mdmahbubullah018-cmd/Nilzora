import type { DiscoveryRating, ProductSummary } from '@nilzora/contracts';
import { Badge, cn, ShareButton } from '@nilzora/ui';
import { Star } from 'lucide-react';
import Link from 'next/link';
import { productHref } from '@/lib/catalog-query';
import { productShareTarget } from '@/lib/share';
import { CampaignLabel } from '@/components/marketing/campaign-highlights';
import { AvailabilityBadge } from './availability';
import { Price, savingPercent } from './price';
import { SoldCount, soldCountLabel } from './sold-count';
import { ProductImage } from './product-image';
import { ProductColors } from './product-colors';
import { QuickAdd } from './quick-add';
import { WishlistButton } from '@/components/wishlist/wishlist-button';

export interface ProductCardProps {
  product: ProductSummary;
  /** Heading level that fits the page outline: h2 under a page title, h3 under a section. */
  headingLevel?: 'h2' | 'h3';
  /** Approved-review evidence, when the card's context already knows it (discovery). */
  rating?: DiscoveryRating | null;
}

/**
 * A product in a grid. The name is the card's only link and its overlay covers the
 * whole card, so the card is one tab stop with a descriptive name and nothing
 * interactive is nested inside another link.
 */
export function ProductCard({
  product,
  headingLevel: Heading = 'h3',
  rating = null,
}: ProductCardProps) {
  const saving = savingPercent(product.priceMinor, product.compareAtPriceMinor);
  const soldOut = product.availability === 'out_of_stock';
  const share = productShareTarget(product);
  return (
    <article className="group relative flex h-full flex-col gap-3 rounded-2xl has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-4 has-[a:focus-visible]:outline-ring">
      <div className="relative overflow-hidden rounded-2xl bg-surface-muted transition-[translate,box-shadow] duration-300 ease-soft group-hover:-translate-y-0.5 group-hover:shadow-lg group-hover:shadow-brand-navy/10 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
        <ProductImage
          image={product.image}
          productName={product.name}
          categorySlug={product.category.slug}
          className={cn(
            'rounded-none ring-0 [&_img]:transition-transform [&_img]:duration-500 group-hover:[&_img]:scale-[1.03] motion-reduce:[&_img]:transition-none',
            soldOut && 'opacity-60',
          )}
        />
        {saving !== null ? (
          <Badge tone="offer" className="absolute top-3 left-3 shadow-sm">
            Save {saving}%
          </Badge>
        ) : null}
        {/* Above the card's link overlay, so saving never opens the product by accident. */}
        <WishlistButton
          product={{ id: product.id, slug: product.slug, name: product.name }}
          className="absolute top-2.5 right-2.5 max-sm:size-11 pointer-coarse:size-11"
        />
        {/*
          A grid of cards is where a shopper finds something worth passing on, so each card can
          be shared — but only on a pointer device, where it stays out of the way until the card
          is hovered or one of its controls is focused. A phone's cards keep their clean picture.
        */}
        {share ? (
          <span className="pointer-events-none absolute bottom-2.5 left-2.5 hidden opacity-0 transition-opacity duration-200 ease-soft group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 sm:block motion-reduce:transition-none">
            <ShareButton target={share} />
          </span>
        ) : null}
        {/* Only the states worth a shopper's attention; "in stock" is the norm. */}
        {product.availability !== 'in_stock' ? (
          <AvailabilityBadge
            availability={product.availability}
            className="absolute right-3 bottom-3 bg-surface/95 whitespace-normal shadow-sm backdrop-blur"
          />
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 px-0.5">
        {/* One line either way, so cards in a row keep the same height. */}
        <p className="truncate text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase">
          {product.brand ? (
            <>
              <span className="sr-only">Brand: </span>
              <span className="text-primary">{product.brand.name}</span>
              <span aria-hidden="true"> · </span>
              <span className="sr-only">, category: </span>
            </>
          ) : null}
          {product.category.name}
        </p>
        <Heading className="line-clamp-2 min-h-10 text-sm leading-5 font-medium text-foreground">
          <Link
            href={productHref(product.slug)}
            className="underline-offset-4 group-hover:underline after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-hidden"
          >
            {product.name}
          </Link>
        </Heading>
        <Price
          priceMinor={product.priceMinor}
          compareAtPriceMinor={product.compareAtPriceMinor}
          size="sm"
        />
        <ProductColors colors={product.colors} />
        {product.campaign ? <CampaignLabel campaign={product.campaign} /> : null}
        {(rating !== null && rating.reviewCount > 0) ||
        soldCountLabel(product.soldCount) !== null ? (
          <div className="flex items-center gap-x-2 text-xs text-muted-foreground">
            {rating !== null && rating.reviewCount > 0 ? (
              <p
                role="img"
                className="flex items-center gap-1 text-xs text-muted-foreground"
                aria-label={`Rated ${rating.averageRating.toFixed(1)} out of 5 from ${String(rating.reviewCount)} ${rating.reviewCount === 1 ? 'review' : 'reviews'}`}
              >
                <Star aria-hidden="true" className="size-3.5 fill-amber-500 text-amber-500" />
                <span className="font-semibold text-foreground">
                  {rating.averageRating.toFixed(1)}
                </span>
                <span aria-hidden="true">({rating.reviewCount})</span>
              </p>
            ) : null}
            <SoldCount count={product.soldCount} className="whitespace-nowrap" />
          </div>
        ) : null}
      </div>
      <QuickAdd
        productId={product.id}
        productSlug={product.slug}
        productName={product.name}
        maxOrderQuantity={product.maxOrderQuantity}
      />
    </article>
  );
}

/** `wide` fills the page; `sidebar` leaves room for the filter panel beside it. */
export type ProductGridColumns = 'wide' | 'sidebar';

const gridColumns: Record<ProductGridColumns, string> = {
  wide: 'md:grid-cols-3 lg:grid-cols-4 lg:gap-x-6 lg:gap-y-10',
  sidebar: 'md:grid-cols-3 xl:grid-cols-4 xl:gap-x-6 xl:gap-y-10',
};

export function ProductGrid({
  products,
  headingLevel,
  columns = 'wide',
}: {
  products: readonly ProductSummary[];
  headingLevel?: ProductCardProps['headingLevel'];
  columns?: ProductGridColumns;
}) {
  return (
    <ul
      role="list"
      className={cn('grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5', gridColumns[columns])}
    >
      {products.map((product) => (
        <li key={product.id}>
          <ProductCard product={product} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  );
}
