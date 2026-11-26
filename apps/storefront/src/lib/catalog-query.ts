import {
  MAX_CATALOG_OFFSET,
  MAX_PRICE_MINOR,
  slugSchema,
  type CatalogSort,
} from '@nilzora/contracts';
import type { Route } from 'next';
import { multiParam, singleParam, type SearchParams } from '@/lib/auth-params';

/*
 * Query parameters of the catalog listings (/products, /categories/[slug], /search).
 * They come straight from the address bar, so each one is checked here and anything
 * unexpected falls back to its default instead of reaching the API as a bad request.
 */

/** Products per listing page (the API's default page size). */
export const LISTING_PAGE_SIZE = 24;

/** Longest search the API accepts (the `q` of productListQuerySchema). */
export const MAX_SEARCH_LENGTH = 100;

/** Sorts offered while browsing; the first is the default. */
export const BROWSE_SORTS = [
  'featured',
  'newest',
  'price_asc',
  'price_desc',
] as const satisfies readonly CatalogSort[];

/** Sorts offered for search results, which default to the best match. */
export const SEARCH_SORTS = [
  'relevance',
  'newest',
  'price_asc',
  'price_desc',
] as const satisfies readonly CatalogSort[];

/**
 * Sorts for search results narrowed by filters. Ranking by relevance needs the plain search
 * (see productListQuerySchema), so a filtered search lists the newest matches first.
 */
export const FILTERED_SEARCH_SORTS = [
  'newest',
  'price_asc',
  'price_desc',
] as const satisfies readonly CatalogSort[];

export type BrowseSort = (typeof BROWSE_SORTS)[number];
export type SearchSort = (typeof SEARCH_SORTS)[number];

export const SORT_LABELS: Readonly<Record<CatalogSort, string>> = {
  featured: 'Featured',
  newest: 'Newest',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  relevance: 'Best match',
};

/** The deepest page the API serves: it refuses offsets beyond MAX_CATALOG_OFFSET. */
export function maxPage(pageSize: number = LISTING_PAGE_SIZE): number {
  return Math.floor(MAX_CATALOG_OFFSET / pageSize) + 1;
}

/** One of the allowed sorts; anything else is the first (the default). */
export function parseSort<S extends CatalogSort>(
  value: string | undefined,
  allowed: readonly [S, ...S[]],
): S {
  return allowed.find((sort) => sort === value) ?? allowed[0];
}

/** A page number from 1 to maxPage(); anything else is page 1. */
export function parsePage(value: string | undefined, pageSize: number = LISTING_PAGE_SIZE): number {
  if (value === undefined || !/^\d{1,6}$/.test(value)) return 1;
  return Math.min(Math.max(Number(value), 1), maxPage(pageSize));
}

/** Search text, trimmed and cut to the length the API accepts; '' when there is none. */
export function parseSearchText(value: string | undefined): string {
  let text = (value ?? '').trim().slice(0, MAX_SEARCH_LENGTH);
  // Never leave half of a surrogate pair (an emoji cut in two) at the end.
  if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  return text.trim();
}

/** A category filter, when it is a well-formed slug. */
export function parseCategorySlug(value: string | undefined): string | undefined {
  return value !== undefined && slugSchema.safeParse(value).success ? value : undefined;
}

/*
 * Filters
 * -------
 * In the address bar as `brand=<slug>`, `min=<taka>`, `max=<taka>` and `stock=in`: short,
 * readable, and shareable. Prices are whole taka here and poisha at the API. Anything that is
 * not a well-formed value is dropped, so a mistyped link shows the listing unfiltered rather
 * than an error.
 */

/** The highest price a filter can name, in whole taka. */
export const MAX_FILTER_TAKA = MAX_PRICE_MINOR / 100;

export interface ListingFilters {
  brand?: string | undefined;
  /** Lowest and highest price in whole taka, both inclusive. */
  minTaka?: number | undefined;
  maxTaka?: number | undefined;
  /** Only products that can be ordered now. */
  inStock: boolean;
  /** Sizes the product must be sold in, by variant value slug. */
  sizes?: string[] | undefined;
  /** Colours the product must be sold in, by variant value slug. */
  colors?: string[] | undefined;
}

export const NO_FILTERS: ListingFilters = { inStock: false };

/**
 * A facet filter from the address: `size=m,l` or `?size=m&size=l`, de-duplicated. Anything that
 * is not a slug is dropped, so a mistyped link shows a wider listing rather than an error.
 */
export function parseSlugList(value: string | string[] | undefined): string[] {
  const entries = Array.isArray(value) ? value : (value ?? '').split(',');
  const slugs = entries
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '' && slugSchema.safeParse(entry).success);
  return [...new Set(slugs)].slice(0, MAX_FILTER_VALUES);
}

/** The most values one facet filter keeps: enough for any real size scale. */
export const MAX_FILTER_VALUES = 12;

/** A whole amount of taka from 0 to MAX_FILTER_TAKA; digit grouping (1,500) is allowed. */
export function parseTaka(value: string | undefined): number | undefined {
  const digits = (value ?? '').replace(/[\s,]/g, '');
  if (!/^\d{1,10}$/.test(digits)) return undefined;
  const taka = Number(digits);
  return taka <= MAX_FILTER_TAKA ? taka : undefined;
}

/** The filters of a listing address. A repeated parameter counts as absent. */
export function parseListingFilters(params: SearchParams): ListingFilters {
  const brand = parseCategorySlug(singleParam(params, 'brand'));
  let minTaka = parseTaka(singleParam(params, 'min'));
  let maxTaka = parseTaka(singleParam(params, 'max'));
  // A range typed the wrong way round is read the way it was meant.
  if (minTaka !== undefined && maxTaka !== undefined && minTaka > maxTaka) {
    [minTaka, maxTaka] = [maxTaka, minTaka];
  }
  const sizes = parseSlugList(multiParam(params, 'size'));
  const colors = parseSlugList(multiParam(params, 'color'));
  return {
    brand,
    minTaka,
    maxTaka,
    inStock: singleParam(params, 'stock') === 'in',
    // Kept out of the object entirely when nothing is chosen, so a plain listing's filters stay
    // the small, comparable object they always were.
    ...(sizes.length > 0 ? { sizes } : {}),
    ...(colors.length > 0 ? { colors } : {}),
  };
}

/** True when any filter narrows the listing. */
export function hasActiveFilters(filters: ListingFilters): boolean {
  return (
    filters.brand !== undefined ||
    filters.minTaka !== undefined ||
    filters.maxTaka !== undefined ||
    filters.inStock ||
    (filters.sizes?.length ?? 0) > 0 ||
    (filters.colors?.length ?? 0) > 0
  );
}

/** The filters as the API's query options (prices in poisha). */
export function apiFilters(filters: ListingFilters) {
  return {
    brand: filters.brand,
    minPriceMinor: filters.minTaka === undefined ? undefined : filters.minTaka * 100,
    maxPriceMinor: filters.maxTaka === undefined ? undefined : filters.maxTaka * 100,
    inStock: filters.inStock ? true : undefined,
    // Only present when a facet narrows the list, so an unfiltered request is unchanged.
    ...(filters.sizes !== undefined && filters.sizes.length > 0 ? { size: filters.sizes } : {}),
    ...(filters.colors !== undefined && filters.colors.length > 0 ? { color: filters.colors } : {}),
  };
}

export interface BrowseQuery {
  sort: BrowseSort;
  page: number;
  filters: ListingFilters;
  /** The collection being browsed, when the address names one. */
  zone: string | undefined;
}

/** Sort, page, collection and filters of a browsing listing. A repeated parameter counts as absent. */
export function parseBrowseQuery(params: SearchParams): BrowseQuery {
  return {
    sort: parseSort(singleParam(params, 'sort'), BROWSE_SORTS),
    page: parsePage(singleParam(params, 'page')),
    filters: parseListingFilters(params),
    zone: parseZoneSlug(singleParam(params, 'zone')),
  };
}

export interface SearchQuery {
  q: string;
  category: string | undefined;
  sort: SearchSort;
  page: number;
  filters: ListingFilters;
}

/** The sorts a search can offer: all of them, or the unranked ones once it is filtered. */
export function searchSorts(filters: ListingFilters): readonly [SearchSort, ...SearchSort[]] {
  return hasActiveFilters(filters) ? FILTERED_SEARCH_SORTS : SEARCH_SORTS;
}

export function parseSearchQuery(params: SearchParams): SearchQuery {
  const filters = parseListingFilters(params);
  return {
    q: parseSearchText(singleParam(params, 'q')),
    category: parseCategorySlug(singleParam(params, 'category')),
    sort: parseSort(singleParam(params, 'sort'), searchSorts(filters)),
    page: parsePage(singleParam(params, 'page')),
    filters,
  };
}

export function categoryHref(slug: string): Route {
  // Slugs are lower-case words and hyphens; encoding keeps any other value inert.
  return `/categories/${encodeURIComponent(slug)}` as Route;
}

/** Brands live at the top level, /<brand-slug>; their slugs never take a store path. */
export function brandHref(slug: string): Route {
  return `/${encodeURIComponent(slug)}` as Route;
}

/** A shopping zone's listing: the products page narrowed to one collection. */
export function zoneHref(slug: string): Route {
  return `/products?zone=${encodeURIComponent(slug)}` as Route;
}

/** A zone's address from the listing address; anything malformed is dropped. */
export function parseZoneSlug(value: string | undefined): string | undefined {
  return parseCategorySlug(value);
}

export function productHref(slug: string): Route {
  return `/products/${encodeURIComponent(slug)}` as Route;
}

export interface ListingState {
  q?: string;
  category?: string | undefined;
  /** A shopping zone (collection) the listing is narrowed to. */
  zone?: string | undefined;
  sort?: CatalogSort;
  page?: number;
  filters?: ListingFilters;
}

/**
 * The address of a listing state, with defaults left out so links stay short:
 * listingHref('/products', { sort: 'newest', page: 2 }, 'featured') is
 * '/products?sort=newest&page=2'.
 */
export function listingHref(path: Route, state: ListingState, defaultSort: CatalogSort): Route {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.category) params.set('category', state.category);
  if (state.zone) params.set('zone', state.zone);
  const filters = state.filters ?? NO_FILTERS;
  if (filters.brand) params.set('brand', filters.brand);
  if (filters.sizes !== undefined && filters.sizes.length > 0)
    params.set('size', filters.sizes.join(','));
  if (filters.colors !== undefined && filters.colors.length > 0)
    params.set('color', filters.colors.join(','));
  if (filters.minTaka !== undefined) params.set('min', String(filters.minTaka));
  if (filters.maxTaka !== undefined) params.set('max', String(filters.maxTaka));
  if (filters.inStock) params.set('stock', 'in');
  if (state.sort && state.sort !== defaultSort) params.set('sort', state.sort);
  if (state.page !== undefined && state.page > 1) params.set('page', String(state.page));
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** Reviews shown at first on a product page; "Show more" adds this many each time. */
export const REVIEW_PAGE_SIZE = 6;

/** The most reviews one product page shows (the API's own page-size limit is 50). */
export const MAX_REVIEWS_SHOWN = 48;

/** How many reviews to show: `?reviews=2` shows two batches. From one batch to MAX_REVIEWS_SHOWN. */
export function reviewsShown(value: string | undefined): number {
  const batches = value !== undefined && /^\d{1,2}$/.test(value) ? Number(value) : 1;
  return Math.min(Math.max(batches, 1) * REVIEW_PAGE_SIZE, MAX_REVIEWS_SHOWN);
}
