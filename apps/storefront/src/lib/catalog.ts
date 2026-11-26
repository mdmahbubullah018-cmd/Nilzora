import 'server-only';
import {
  brandSlugSchema,
  slugSchema,
  type Banner,
  type BannerPlacement,
  type Brand,
  type BrandLookupResponse,
  type BrandProductsResponse,
  type CampaignSummary,
  type CatalogSort,
  type Category,
  type DiscoveryResponse,
  type ProductDetail,
  type ProductFacets,
  type ProductListResponse,
  type ProductReviewsResponse,
  type ShoppingZone,
} from '@nilzora/contracts';
import { ApiError, type PublicApiClient } from '@nilzora/web-session';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { cache } from 'react';
import {
  apiFilters,
  LISTING_PAGE_SIZE,
  NO_FILTERS,
  REVIEW_PAGE_SIZE,
  type ListingFilters,
} from '@/lib/catalog-query';
import { session } from '@/lib/session';

/*
 * Catalog data for Server Components. Browsing is the same for every visitor, so those
 * reads use publicApi(), which sends nothing about the visitor, and Next.js keeps each
 * answer for a minute. The tags let a Server Action refresh them sooner, e.g. a product
 * after an order changes its stock. Searches go through api() instead, uncached, so the
 * API rate-limits each visitor on their own.
 *
 * Every read waits for a real request (connection()): pages render on demand, never at
 * build time, which has no API. Browsing reads touch no cookies or headers, so catalog
 * pages never set a cookie.
 */

export const CATALOG_REVALIDATE_SECONDS = 60;

/** Tag on every cached catalog read: revalidating it refreshes all of them. */
export const CATALOG_TAG = 'catalog';

/** Tag on the cached detail of one product, e.g. to refresh its stock after an order. */
export function productTag(slug: string): string {
  return `product:${slug}`;
}

/**
 * What a catalog page can show: the data, or a calm notice when the API is down or
 * busy (`unavailable`) or this visitor is searching too fast (`rate_limited`).
 */
export type CatalogRead<T> =
  { kind: 'ok'; value: T } | { kind: 'unavailable' } | { kind: 'rate_limited' };

export function cachedApi(tags: readonly string[]): PublicApiClient {
  return session.publicApi({
    fetch: (input, init) =>
      globalThis.fetch(input, {
        ...init,
        next: { revalidate: CATALOG_REVALIDATE_SECONDS, tags: [...tags] },
      }),
  });
}

interface AttemptOptions {
  /** A 404 means the thing asked for does not exist (a product), not a broken API. */
  missingIsNotFound?: boolean;
  /** A 429 is this visitor's own limit (searches), not the store server's shared one. */
  perVisitor?: boolean;
}

/**
 * Runs one API read for a page. Outages and unexpected answers become `unavailable`
 * rather than an error page; so does a 404 on a listing (a wrong API address) and a
 * 429 on a shared browsing read. Only a missing product is notFound(), and only a
 * search reports `rate_limited`. Anything else (a request the API refused) is a bug and
 * is rethrown to the route's error boundary.
 */
export async function attempt<T>(
  call: () => Promise<T>,
  { missingIsNotFound = false, perVisitor = false }: AttemptOptions = {},
): Promise<CatalogRead<T>> {
  await connection();
  try {
    return { kind: 'ok', value: await call() };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.status === 404 && missingIsNotFound) notFound();
    if (error.status === 429 && perVisitor) return { kind: 'rate_limited' };
    if (
      error.status === 0 ||
      error.status === 404 ||
      error.status === 429 ||
      error.status >= 500 ||
      error.code === 'service_unavailable' ||
      error.code === 'invalid_response'
    ) {
      return { kind: 'unavailable' };
    }
    throw error;
  }
}

/** Visible categories with their product counts. Shared by a page and its metadata. */
export const getCategories = cache((): Promise<CatalogRead<Category[]>> =>
  attempt(async () => (await cachedApi([CATALOG_TAG]).listCategories()).categories),
);

/** One visible category; a malformed, unknown or hidden slug is not found. */
export async function getCategory(slug: string): Promise<CatalogRead<Category>> {
  if (!slugSchema.safeParse(slug).success) notFound();
  const categories = await getCategories();
  if (categories.kind !== 'ok') return categories;
  const category = categories.value.find((entry) => entry.slug === slug);
  if (!category) notFound();
  return { kind: 'ok', value: category };
}

export interface ProductListing {
  category?: string | undefined;
  /** A shopping zone (collection) to browse; the listing is empty when it is unknown. */
  zone?: string | undefined;
  /** With a category: its subcategories' products too. */
  includeSubcategories?: boolean;
  sort: CatalogSort;
  page: number;
  pageSize?: number;
  filters?: ListingFilters;
}

/** One page of products on sale, optionally in one category (or its whole branch) and filtered. */
export function listProducts({
  category,
  zone,
  includeSubcategories = false,
  sort,
  page,
  pageSize = LISTING_PAGE_SIZE,
  filters = NO_FILTERS,
}: ProductListing): Promise<CatalogRead<ProductListResponse>> {
  return attempt(() =>
    cachedApi([CATALOG_TAG]).listProducts({
      category,
      zone,
      includeSubcategories: category !== undefined && includeSubcategories ? true : undefined,
      sort,
      page,
      pageSize,
      ...apiFilters(filters),
    }),
  );
}

/**
 * The sizes and colours the products of this listing context are actually sold in, read from
 * the variant system through the catalog's own short cache. A failure means "no options to
 * offer" — a listing must never break because a facet could not be read — so the toolbar
 * simply draws no size or colour control.
 */
export async function getProductFacets(
  listing: Omit<ProductListing, 'sort' | 'page'>,
): Promise<ProductFacets> {
  const read = await attempt(async () =>
    (
      await cachedApi([CATALOG_TAG]).productFacets({
        category: listing.category,
        zone: listing.zone,
        includeSubcategories:
          listing.category !== undefined && listing.includeSubcategories ? true : undefined,
        ...apiFilters(listing.filters ?? NO_FILTERS),
      })
    ).facets,
  ).catch(() => ({ kind: 'unavailable' }) as const);
  return read.kind === 'ok' ? read.value : EMPTY_FACETS;
}

/** Nothing to offer: no size or colour control is drawn. */
export const EMPTY_FACETS: ProductFacets = { sizes: [], colors: [] };

/** One product on sale; a malformed or unknown slug is not found. */
export const getProduct = cache(async (slug: string): Promise<CatalogRead<ProductDetail>> => {
  if (!slugSchema.safeParse(slug).success) notFound();
  return attempt(
    async () => (await cachedApi([productTag(slug), CATALOG_TAG]).getProduct(slug)).product,
    { missingIsNotFound: true },
  );
});

/**
 * A product's variants for the cart, read through the same 60 s cached detail as the product
 * page. Unlike getProduct it never calls notFound(): a route handler or a Server Action must
 * tell "no such product" from "cannot tell right now", and the cart treats both as "not
 * addable" because it must never guess that a product has no variants.
 */
export type CartProductRead =
  { kind: 'ok'; value: ProductDetail } | { kind: 'missing' } | { kind: 'unavailable' };

export async function readProductForCart(slug: string): Promise<CartProductRead> {
  if (!slugSchema.safeParse(slug).success) return { kind: 'missing' };
  try {
    const { product } = await cachedApi([productTag(slug), CATALOG_TAG]).getProduct(slug);
    return { kind: 'ok', value: product };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { kind: 'missing' };
    return { kind: 'unavailable' };
  }
}

/**
 * Approved reviews of a product and its rating summary. Deliberately not cached by
 * Next: a review a moderator publishes appears on the next visit, and the read carries
 * nothing about the visitor.
 */
export const getProductReviews = cache(
  async (
    slug: string,
    pageSize: number = REVIEW_PAGE_SIZE,
  ): Promise<CatalogRead<ProductReviewsResponse>> => {
    if (!slugSchema.safeParse(slug).success) notFound();
    return attempt(async () => (await session.api()).productReviews(slug, { page: 1, pageSize }), {
      missingIsNotFound: true,
    });
  },
);

/** Active brands with their product counts. */
export const getBrands = cache((): Promise<CatalogRead<Brand[]>> =>
  attempt(async () => (await cachedApi([CATALOG_TAG]).listBrands()).brands),
);

/**
 * Ranked product discovery for the search page, when nothing has been typed yet. The API has
 * already decided which sections its real orders, wishlist saves and approved reviews support;
 * a store with no evidence returns only what it can honestly show.
 */
export const getDiscovery = cache((): Promise<CatalogRead<DiscoveryResponse>> =>
  attempt(() => cachedApi([CATALOG_TAG]).discovery()),
);

/**
 * An active brand, or where its former address now points. A slug that cannot be a
 * brand, or an unknown one, is not found (brands live at /<slug>).
 */
export const getBrand = cache(async (slug: string): Promise<CatalogRead<BrandLookupResponse>> => {
  if (!brandSlugSchema.safeParse(slug).success) notFound();
  return attempt(() => cachedApi([CATALOG_TAG]).getBrand(slug), { missingIsNotFound: true });
});

export function listBrandProducts(
  slug: string,
  {
    sort,
    page,
    pageSize = LISTING_PAGE_SIZE,
  }: { sort: BrandSort; page: number; pageSize?: number },
): Promise<CatalogRead<BrandProductsResponse>> {
  return attempt(() => cachedApi([CATALOG_TAG]).listBrandProducts(slug, { sort, page, pageSize }));
}

/** Banners on show for a placement. Promotions are optional: any failure shows none. */
export async function getBanners(placement: BannerPlacement, category?: string): Promise<Banner[]> {
  const read = await attempt(
    async () => (await cachedApi([CATALOG_TAG]).listBanners({ placement, category })).banners,
  ).catch(() => ({ kind: 'unavailable' }) as const);
  return read.kind === 'ok' ? read.value : [];
}

/**
 * Live discount campaigns: all of them, or the ones reaching one category. A promotion is
 * an optional extra, so any failure simply shows none — the products are already priced
 * correctly without a banner.
 */
export async function getCampaigns(category?: string): Promise<CampaignSummary[]> {
  const read = await attempt(
    async () => (await cachedApi([CATALOG_TAG]).listCampaigns({ category })).campaigns,
  ).catch(() => ({ kind: 'unavailable' }) as const);
  return read.kind === 'ok' ? read.value : [];
}

/**
 * Active collections with a product each shopper can see. A merchandising extra: any failure
 * (an unapplied migration, an outage) shows no rail at all rather than breaking the page.
 * Cached per request, so a page and its metadata share one read.
 */
export const getShoppingZones = cache((): Promise<ShoppingZone[]> =>
  attempt(async () => (await cachedApi([CATALOG_TAG]).shoppingZones()).zones)
    .catch(() => ({ kind: 'unavailable' }) as const)
    .then((read) => (read.kind === 'ok' ? read.value : [])),
);

/**
 * One active collection by address, for the filtered listing and its metadata. `null` when the
 * zone does not exist or is hidden, so the page can answer 404 instead of showing an empty shelf.
 */
export const findShoppingZone = cache(async (slug: string): Promise<ShoppingZone | null> => {
  const zones = await getShoppingZones();
  return zones.find((zone) => zone.slug === slug) ?? null;
});

export type BrandSort = 'featured' | 'newest' | 'price_asc' | 'price_desc';

export interface ProductSearch extends ProductListing {
  q: string;
}

/** Search results for this visitor, uncached. Blank text matches nothing. */
export async function searchProducts({
  q,
  category,
  includeSubcategories = false,
  sort,
  page,
  pageSize = LISTING_PAGE_SIZE,
  filters = NO_FILTERS,
}: ProductSearch): Promise<CatalogRead<ProductListResponse>> {
  await connection();
  if (!q.trim()) {
    return { kind: 'ok', value: { items: [], page: 1, pageSize, total: 0, totalPages: 0 } };
  }
  return attempt(
    async () =>
      (await session.api()).listProducts({
        q,
        category,
        includeSubcategories: category !== undefined && includeSubcategories ? true : undefined,
        sort,
        page,
        pageSize,
        ...apiFilters(filters),
      }),
    { perVisitor: true },
  );
}
