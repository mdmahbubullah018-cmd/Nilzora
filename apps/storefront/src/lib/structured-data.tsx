import type { Availability, ProductDetail, RatingSummary } from '@nilzora/contracts';
import { siteUrl } from '@/lib/seo';

/*
 * Structured data (schema.org JSON-LD)
 * ------------------------------------
 * Only what the page itself shows, from the API: the product's own name, pictures, price,
 * stock band and — when there are approved reviews — their real average and count. Nothing is
 * estimated, and a field the product does not have is left out rather than filled in.
 */

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const AVAILABILITY: Record<Availability, string> = {
  in_stock: 'https://schema.org/InStock',
  low_stock: 'https://schema.org/LimitedAvailability',
  out_of_stock: 'https://schema.org/OutOfStock',
};

/** Poisha as the decimal taka amount schema.org expects ("1250.00"). */
function amount(minor: number): string {
  return (minor / 100).toFixed(2);
}

function absolute(path: string): string {
  return new URL(path, siteUrl()).toString();
}

/** The best availability among a product's variants (any buyable one makes it buyable). */
function bestAvailability(values: readonly Availability[]): Availability {
  if (values.includes('in_stock')) return 'in_stock';
  if (values.includes('low_stock')) return 'low_stock';
  return 'out_of_stock';
}

export function productJsonLd(
  product: ProductDetail,
  path: string,
  rating: RatingSummary | undefined,
): Json {
  const url = absolute(path);
  const images = product.images.map((image) => image.url);
  const description = (product.summary ?? product.description ?? '').trim();

  const variants = product.variants;
  const offers: Json =
    variants.length === 0
      ? {
          '@type': 'Offer',
          url,
          priceCurrency: 'BDT',
          price: amount(product.priceMinor),
          availability: AVAILABILITY[product.availability],
        }
      : {
          '@type': 'AggregateOffer',
          url,
          priceCurrency: 'BDT',
          lowPrice: amount(Math.min(...variants.map((variant) => variant.priceMinor))),
          highPrice: amount(Math.max(...variants.map((variant) => variant.priceMinor))),
          offerCount: variants.length,
          availability:
            AVAILABILITY[bestAvailability(variants.map((variant) => variant.availability))],
        };

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    sku: product.sku,
    url,
    category: product.category.name,
    ...(description ? { description: description.slice(0, 5000) } : {}),
    ...(images.length > 0 ? { image: images } : {}),
    ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand.name } } : {}),
    offers,
    // Only approved reviews are counted by the API; with none, no rating is claimed.
    ...(rating !== undefined && rating.reviewCount > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: Number(rating.averageRating.toFixed(2)),
            reviewCount: rating.reviewCount,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };
}

/** The breadcrumb trail as a schema.org BreadcrumbList; the last crumb is this page. */
export function breadcrumbJsonLd(
  crumbs: readonly { label: string; href?: string }[],
  currentPath: string,
): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.label,
      item: absolute(crumb.href ?? currentPath),
    })),
  };
}

const BACKSLASH = String.fromCharCode(92);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/**
 * JSON for a <script> element: every "<" is escaped, so text from the catalog (a product
 * named "</script>…") can never end the element early; the two JavaScript line separators
 * are escaped too.
 */
export function serializeJsonLd(data: Json): string {
  return JSON.stringify(data)
    .replaceAll('<', `${BACKSLASH}u003c`)
    .replaceAll(LINE_SEPARATOR, `${BACKSLASH}u2028`)
    .replaceAll(PARAGRAPH_SEPARATOR, `${BACKSLASH}u2029`);
}

export function JsonLd({ data }: { data: Json }) {
  return (
    <script
      type="application/ld+json"
      // Escaped by serializeJsonLd: no catalog text can close the script element.
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
