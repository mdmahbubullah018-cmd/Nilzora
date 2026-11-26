import { ApiError } from '@nilzora/api-client';
import {
  MAX_CATALOG_OFFSET,
  MAX_LINE_QUANTITY,
  MAX_PRICE_MINOR,
  slugSchema,
  type CatalogSort,
  type Category,
  type ProductFacetsQuery,
  type ProductListQuery,
  type ProductListResponse,
  type ProductSummary,
} from '@nilzora/contracts';
import type { Href } from 'expo-router';
import { availabilityLabel } from '@/components/availability-badge';
import { formatMoney, savingPercent, spokenMoney } from '@/lib/money';

/*
 * Catalog browsing rules shared by Home, Shop and the product screen: which sorts exist,
 * what the address-bar style parameters (q, category, sort) may contain, where links go, and
 * how a product is read aloud. Wording and limits follow the storefront (apps/storefront
 * src/lib/catalog-query.ts) so the website and the app feel like one shop.
 *
 * Route parameters can be set by anything that opens the app (a deep link), so each one is
 * checked here and anything unexpected falls back to its default instead of reaching the API.
 */

/** Products per page of a listing (the API's default page size). */
export const LISTING_PAGE_SIZE = 24;

/** Products in a Home row. */
export const HOME_ROW_SIZE = 8;

/** Longest search the API accepts (the `q` of productListQuerySchema). */
export const MAX_SEARCH_LENGTH = 100;

/** Sorts offered while browsing; the first is the default. */
export const BROWSE_SORTS = [
  'featured',
  'newest',
  'price_asc',
  'price_desc',
] as const satisfies readonly CatalogSort[];

/** A sort a browsing screen offers. Narrower than CatalogSort: relevance is search-only. */
export type BrowseSort = (typeof BROWSE_SORTS)[number];

/** Sorts offered for search results, which default to the best match. */
export const SEARCH_SORTS = [
  'relevance',
  'newest',
  'price_asc',
  'price_desc',
] as const satisfies readonly CatalogSort[];

/** The storefront's labels for each sort. */
export const SORT_LABELS: Readonly<Record<CatalogSort, string>> = {
  featured: 'Featured',
  newest: 'Newest',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  relevance: 'Best match',
};

/** A route parameter as a single string; a repeated parameter is ambiguous and counts as absent. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
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

/**
 * Chosen size or colour slugs, as the API takes them: a repeated parameter (`size=m&size=l`)
 * or one comma list (`size=m,l`). Anything that is not a well-formed slug is dropped, and the
 * order is the order they were chosen in.
 */
export function parseSlugList(value: string | string[] | undefined): string[] {
  const entries = (Array.isArray(value) ? value : value === undefined ? [] : [value])
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '' && slugSchema.safeParse(entry).success);
  return [...new Set(entries)];
}

/** The sorts that make sense now: best match exists only while searching. */
export function sortsFor(q: string): readonly CatalogSort[] {
  return q === '' ? BROWSE_SORTS : SEARCH_SORTS;
}

/**
 * True when something other than the search text narrows the results in the way that costs a
 * relevance ranking. This mirrors the API's own rule (`hasListingFilters` plus a shopping zone):
 * a plain search keeps best match, and so does one scoped to a category, but the rest do not.
 */
export function hasNarrowing(filters: ShopFilters): boolean {
  return filters.zone !== undefined || hasRefinements(filters);
}

/**
 * The order a listing really uses. The API refuses to rank a narrowed search by relevance —
 * "relevance" only makes sense over the whole catalogue — so a narrowed listing falls back to
 * newest first instead of answering 400.
 */
export function sortForFilters(sort: CatalogSort, filters: ShopFilters): CatalogSort {
  return sort === 'relevance' && hasNarrowing(filters) ? 'newest' : sort;
}

/** The sorts worth offering for these filters: no best-match while anything narrows them. */
export function sortsForFilters(q: string, filters: ShopFilters): readonly CatalogSort[] {
  const all = sortsFor(q);
  return hasNarrowing(filters) ? all.filter((sort) => sort !== 'relevance') : all;
}

/** One of the allowed sorts; anything else is the first (the default). */
export function parseSort(value: string | undefined, allowed: readonly CatalogSort[]): CatalogSort {
  return allowed.find((sort) => sort === value) ?? allowed[0] ?? 'featured';
}

/** The highest price a filter can name, in whole taka (the contract's own limit). */
export const MAX_FILTER_TAKA = MAX_PRICE_MINOR / 100;

/** A whole amount of taka; digit grouping (1,500) is allowed, anything else is dropped. */
export function parseTaka(value: string | undefined): number | undefined {
  const digits = (value ?? '').replace(/[\s,]/g, '');
  if (!/^\d{1,10}$/.test(digits)) return undefined;
  const taka = Number(digits);
  return taka <= MAX_FILTER_TAKA ? taka : undefined;
}

/**
 * A price range as the toolbar and the listing use it: whole taka, both bounds inclusive,
 * a range typed the wrong way round read the way it was meant.
 */
export function normalisePriceRange(
  minTaka: number | undefined,
  maxTaka: number | undefined,
): { minTaka: number | undefined; maxTaka: number | undefined } {
  if (minTaka !== undefined && maxTaka !== undefined && minTaka > maxTaka) {
    return { minTaka: maxTaka, maxTaka: minTaka };
  }
  return { minTaka, maxTaka };
}

export interface ShopFilters {
  q: string;
  category: string | undefined;
  /**
   * A shopping zone (collection) the listing is narrowed to. A collection is not a taxonomy:
   * the API decides membership, so the app only carries the choice.
   */
  zone: string | undefined;
  /** Always one of `sortsFor(q)`. */
  sort: CatalogSort;
  /** Only this brand's products (the API's own `brand` filter). */
  brand?: string | undefined;
  /** Lowest and highest selling price in whole taka, both inclusive. */
  minTaka?: number | undefined;
  maxTaka?: number | undefined;
  /** Only products that can be ordered now. */
  inStock?: boolean;
  /**
   * Size and colour slugs, from the store's own variant data. Several values widen the result
   * (any of them), one value of each narrows it (a product that has that size and that colour).
   */
  sizes?: readonly string[] | undefined;
  colors?: readonly string[] | undefined;
  /**
   * Also list the category's subcategories' products (a department). Never set by a screen:
   * resolveListing() derives it from the published category list, so Shop, a department page
   * and a product's category link all mean the same thing.
   */
  includeSubcategories?: boolean;
}

export type ShopParams = {
  q?: string | string[];
  category?: string | string[];
  zone?: string | string[];
  sort?: string | string[];
  brand?: string | string[];
  min?: string | string[];
  max?: string | string[];
  stock?: string | string[];
  size?: string | string[];
  color?: string | string[];
};

/** The listing the route parameters ask for, with every value checked. */
export function parseShopFilters(params: ShopParams): ShopFilters {
  const q = parseSearchText(firstParam(params.q));
  const price = normalisePriceRange(
    parseTaka(firstParam(params.min)),
    parseTaka(firstParam(params.max)),
  );
  const sizes = parseSlugList(params.size);
  const colors = parseSlugList(params.color);
  const parsed: ShopFilters = {
    q,
    category: parseCategorySlug(firstParam(params.category)),
    zone: parseCategorySlug(firstParam(params.zone)),
    sort: parseSort(firstParam(params.sort), sortsFor(q)),
    brand: parseCategorySlug(firstParam(params.brand)),
    minTaka: price.minTaka,
    maxTaka: price.maxTaka,
    inStock: firstParam(params.stock) === 'in',
    ...(sizes.length > 0 ? { sizes } : {}),
    ...(colors.length > 0 ? { colors } : {}),
  };
  // A narrowed search is never ranked by relevance (the API refuses it), so the filters always
  // carry an order the API will accept.
  return { ...parsed, sort: sortForFilters(parsed.sort, parsed) };
}

/** The chosen size or colour slugs, or none. */
export function chosenFacets(filters: ShopFilters): {
  sizes: readonly string[];
  colors: readonly string[];
} {
  return { sizes: filters.sizes ?? [], colors: filters.colors ?? [] };
}

/**
 * "S · M · L" for a chip: the store's own value for each chosen slug ("XL", not "xl"), with
 * the slug itself used when the facet list has not loaded. Null when nothing is chosen.
 */
export function facetChoiceLabel(
  slugs: readonly string[] | undefined,
  options: readonly { slug: string; value: string }[],
): string | null {
  if (slugs === undefined || slugs.length === 0) return null;
  return slugs
    .map((slug) => options.find((option) => option.slug === slug)?.value ?? slug.toUpperCase())
    .join(' · ');
}


/** "৳500 – ৳1,500", "From ৳500", "Up to ৳1,500" or null when no range is set. */
export function priceRangeLabel(filters: Pick<ShopFilters, 'minTaka' | 'maxTaka'>): string | null {
  const { minTaka, maxTaka } = filters;
  if (minTaka !== undefined && maxTaka !== undefined) {
    return `${formatMoney(minTaka * 100)} – ${formatMoney(maxTaka * 100)}`;
  }
  if (minTaka !== undefined) return `From ${formatMoney(minTaka * 100)}`;
  if (maxTaka !== undefined) return `Up to ${formatMoney(maxTaka * 100)}`;
  return null;
}

/** The part of a category the department rule needs. */
export type CategoryNode = Pick<Category, 'slug' | 'parentSlug'>;

/**
 * A department is a category that has published subcategories. Its listing is the whole
 * branch, as its product count says (totalProductCount) and as the website shows it.
 */
export function isDepartment(categories: readonly CategoryNode[], slug: string): boolean {
  return categories.some((category) => category.parentSlug === slug);
}

export interface ResolvedListing {
  /** The filters to query with: a department's branch flag set, the sort one the API accepts. */
  filters: ShopFilters;
  /** The sorts to offer for them. */
  sorts: readonly CatalogSort[];
}

/**
 * What a listing really asks the API for once the category list is known.
 *
 * - A department lists its subcategories' products too (includeSubcategories).
 * - The API cannot rank a branch by best match, so a search inside a department is listed
 *   newest first and "Best match" is not offered, as on the website.
 * - Anything else (no category, a leaf category, a list that is not known) is unchanged, so
 *   a failed category list degrades to direct products rather than breaking the listing.
 */
export function resolveListing(
  filters: ShopFilters,
  sorts: readonly CatalogSort[],
  categories: readonly CategoryNode[] | undefined,
): ResolvedListing {
  if (
    filters.category === undefined ||
    categories === undefined ||
    !isDepartment(categories, filters.category)
  ) {
    return { filters: { ...filters, includeSubcategories: false }, sorts };
  }
  const allowed = sorts.filter((sort) => sort !== 'relevance');
  const sort = filters.sort === 'relevance' ? (allowed[0] ?? 'newest') : filters.sort;
  return { filters: { ...filters, sort, includeSubcategories: true }, sorts: allowed };
}

export function hasActiveFilters(filters: ShopFilters): boolean {
  return (
    filters.q !== '' ||
    filters.category !== undefined ||
    filters.zone !== undefined ||
    hasRefinements(filters)
  );
}

/** True when the toolbar's refinements (price, brand, availability, size, colour) narrow it. */
export function hasRefinements(filters: ShopFilters): boolean {
  return (
    filters.brand !== undefined ||
    filters.minTaka !== undefined ||
    filters.maxTaka !== undefined ||
    filters.inStock === true ||
    (filters.sizes !== undefined && filters.sizes.length > 0) ||
    (filters.colors !== undefined && filters.colors.length > 0)
  );
}

/** The API query of an endless listing (everything except the page). */
export function feedQuery(filters: ShopFilters): Omit<ProductListQuery, 'page'> {
  return {
    ...(filters.q !== '' ? { q: filters.q } : {}),
    ...(filters.category !== undefined ? { category: filters.category } : {}),
    ...(filters.zone !== undefined ? { zone: filters.zone } : {}),
    // The API refuses best-match ranking over a branch, so the two are never sent together.
    ...(filters.category !== undefined &&
    filters.includeSubcategories === true &&
    filters.sort !== 'relevance'
      ? { includeSubcategories: true }
      : {}),
    ...(filters.brand !== undefined ? { brand: filters.brand } : {}),
    ...(filters.minTaka !== undefined ? { minPriceMinor: filters.minTaka * 100 } : {}),
    ...(filters.maxTaka !== undefined ? { maxPriceMinor: filters.maxTaka * 100 } : {}),
    ...(filters.inStock === true ? { inStock: true } : {}),
    ...(filters.sizes !== undefined && filters.sizes.length > 0 ? { size: [...filters.sizes] } : {}),
    ...(filters.colors !== undefined && filters.colors.length > 0
      ? { color: [...filters.colors] }
      : {}),
    // A narrowed search is listed newest first: the API refuses best-match ranking for it.
    sort: sortForFilters(filters.sort, filters),
    pageSize: LISTING_PAGE_SIZE,
  };
}

/**
 * The filters the size and colour options are computed for: the listing's own, without the
 * sort or paging (an option is about the whole result, never one page of it). The choices are
 * sent too, so each list answers the other one — the colours a chosen size really comes in.
 */
export function facetsQuery(filters: ShopFilters): ProductFacetsQuery {
  return {
    ...(filters.q !== '' ? { q: filters.q } : {}),
    ...(filters.category !== undefined ? { category: filters.category } : {}),
    ...(filters.zone !== undefined ? { zone: filters.zone } : {}),
    ...(filters.category !== undefined &&
    filters.includeSubcategories === true &&
    filters.sort !== 'relevance'
      ? { includeSubcategories: true }
      : {}),
    ...(filters.brand !== undefined ? { brand: filters.brand } : {}),
    ...(filters.minTaka !== undefined ? { minPriceMinor: filters.minTaka * 100 } : {}),
    ...(filters.maxTaka !== undefined ? { maxPriceMinor: filters.maxTaka * 100 } : {}),
    ...(filters.inStock === true ? { inStock: true } : {}),
    ...(filters.sizes !== undefined && filters.sizes.length > 0 ? { size: [...filters.sizes] } : {}),
    ...(filters.colors !== undefined && filters.colors.length > 0
      ? { color: [...filters.colors] }
      : {}),
  };
}

/**
 * The page after `last`, or undefined at the end. The API refuses offsets beyond
 * MAX_CATALOG_OFFSET, so the listing stops there instead of asking for a page it would refuse.
 */export function nextPageNumber(last: ProductListResponse): number | undefined {
  if (last.page >= last.totalPages) return undefined;
  if (last.page * last.pageSize > MAX_CATALOG_OFFSET) return undefined;
  return last.page + 1;
}

/** Products of several pages in order, each once (a product can shift between pages). */
export function uniqueProducts(pages: readonly ProductListResponse[]): ProductSummary[] {
  const seen = new Set<string>();
  const products: ProductSummary[] = [];
  for (const page of pages) {
    for (const product of page.items) {
      if (seen.has(product.id)) continue;
      seen.add(product.id);
      products.push(product);
    }
  }
  return products;
}

/**
 * The Shop tab, optionally filtered. Only the given values are sent: navigating to a tab sets
 * its parameters afresh, so the filters of an earlier visit do not carry over.
 */
export function shopHref(
  filters: {
    q?: string;
    category?: string;
    zone?: string;
    sort?: CatalogSort;
    brand?: string;
    minTaka?: number;
    maxTaka?: number;
    inStock?: boolean;
    sizes?: readonly string[];
    colors?: readonly string[];
  } = {},
): Href {
  const params: Record<string, string> = {};
  if (filters.q) params.q = filters.q;
  if (filters.category) params.category = filters.category;
  if (filters.zone) params.zone = filters.zone;
  if (filters.sort) params.sort = filters.sort;
  if (filters.brand) params.brand = filters.brand;
  if (filters.minTaka !== undefined) params.min = String(filters.minTaka);
  if (filters.maxTaka !== undefined) params.max = String(filters.maxTaka);
  if (filters.inStock) params.stock = 'in';
  if (filters.sizes !== undefined && filters.sizes.length > 0) params.size = filters.sizes.join(',');
  if (filters.colors !== undefined && filters.colors.length > 0) {
    params.color = filters.colors.join(',');
  }
  return { pathname: '/shop', params };
}

/** A category's own product page. */
export function categoryHref(slug: string): Href {
  return { pathname: '/category/[slug]', params: { slug } };
}

/**
 * The two tints a collection tile falls back to when it has no picture, mirrored from the
 * storefront so the app and the website look like the same shop.
 */
const ZONE_TINTS = [
  ['#0284C7', '#8B5CF6'],
  ['#8B5CF6', '#0369A1'],
  ['#0369A1', '#0284C7'],
  ['#14B8A6', '#8B5CF6'],
] as const;

export function zoneTint(index: number): readonly [string, string] {
  return ZONE_TINTS[Math.abs(index) % ZONE_TINTS.length] ?? ZONE_TINTS[0];
}

/** Slugs are lower-case words and hyphens; encoding keeps any other value inert. */
export function productHref(slug: string): Href {
  return `/product/${encodeURIComponent(slug)}` as Href;
}

/** "1 product", "24 products". */
/** Products in a category and every published subcategory below it (older APIs: its own). */
export function branchProductCount(
  category: Pick<Category, 'productCount' | 'totalProductCount'>,
): number {
  return category.totalProductCount ?? category.productCount;
}

export function productCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'product' : 'products'}`;
}

/**
 * The most units of a product one order may hold right now: nothing when it is out of stock,
 * otherwise the API's per-order limit (already capped by stock) within the cart's line limit.
 */
export function orderableLimit(
  product: Pick<ProductSummary, 'availability' | 'maxOrderQuantity'>,
): number {
  if (product.availability === 'out_of_stock') return 0;
  return Math.max(0, Math.min(product.maxOrderQuantity, MAX_LINE_QUANTITY));
}

/** What a screen reader says for a product: "Name, Price 1,250 taka, was 1,500 taka, In stock". */
/**
 * "120 sold": units sold on delivered orders (less approved returns), as the API counts them.
 * Null until something has really sold (or when the API does not say), never an estimate. Large
 * figures are abbreviated ("1.2k") so the label stays one short line on a card.
 */
export function soldCountLabel(count: number | undefined): string | null {
  if (count === undefined || !Number.isFinite(count) || count < 1) return null;
  const whole = Math.trunc(count);
  if (whole < 1000) return `${String(whole)} sold`;
  const thousands = Math.round(whole / 100) / 10;
  return `${String(thousands)}k sold`;
}

export function productSpokenSummary(
  product: Pick<
    ProductSummary,
    'name' | 'priceMinor' | 'compareAtPriceMinor' | 'availability' | 'soldCount' | 'colors'
  >,
): string {
  const saving = savingPercent(product.priceMinor, product.compareAtPriceMinor);
  // The discs are drawn inside a view hidden from screen readers, so the count is said here
  // instead — the same fact, in words, once.
  const colours =
    product.colors !== undefined && product.colors.length > 1
      ? `${String(product.colors.length)} colours`
      : null;
  return [
    product.name,
    `Price ${spokenMoney(product.priceMinor)}`,
    saving !== null && product.compareAtPriceMinor !== null
      ? `was ${spokenMoney(product.compareAtPriceMinor)}, save ${saving} percent`
      : null,
    availabilityLabel(product.availability),
    soldCountLabel(product.soldCount),
    colours,
  ]
    .filter(Boolean)
    .join(', ');
}

/** The product screen's address parameter as a catalog slug, or null when it cannot be one. */
export function parseProductSlug(value: string | string[] | undefined): string | null {
  return parseCategorySlug(firstParam(value)) ?? null;
}

/** The API's answer for a product that does not exist or is not on sale. */
export function isProductNotFound(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.code === 'not_found');
}

/**
 * The categories the Categories tab lists: top-level ones, plus any whose parent is not
 * published (so a category is never lost). Subcategories are reached from their department.
 */
export function departmentsOf<T extends CategoryNode>(categories: readonly T[]): T[] {
  const known = new Set(categories.map((category) => category.slug));
  return categories.filter(
    (category) => category.parentSlug === null || !known.has(category.parentSlug),
  );
}

/** How many published subcategories sit directly under `slug`. */
export function subcategoryCount(categories: readonly CategoryNode[], slug: string): number {
  return categories.filter((category) => category.parentSlug === slug).length;
}
