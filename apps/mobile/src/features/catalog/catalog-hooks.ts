import type {
  CatalogSort,
  Category,
  ProductDetail,
  ProductFacets,
  ProductFacetsQuery,
  ProductListQuery,
  ProductListResponse,
  ProductSummary,
  ShoppingZone,
} from '@nilzora/contracts';
import {
  useInfiniteQuery,
  useQuery,
  type UseInfiniteQueryResult,
  type UseQueryResult,
  type InfiniteData,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { useApi } from '@/api/api-context';
import { ApiNotConfiguredError } from '@/lib/errors';
import { queryKeys } from '@/query/query-keys';
import {
  nextPageNumber,
  resolveListing,
  uniqueProducts,
  type ResolvedListing,
  type ShopFilters,
} from './catalog-query';

/*
 * Catalog data. The catalog is public: no session, no access token. A build without an API
 * address fails the query with ApiNotConfiguredError (shown as "not set up"), never a spinner
 * that does not end.
 */

/** GET /catalog/categories. */
export function useCategories(): UseQueryResult<readonly Category[]> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.catalog.categories(),
    queryFn: async ({ signal }) => {
      if (api === null) throw new ApiNotConfiguredError();
      return (await api.listCategories({ signal })).categories;
    },
  });
}

/**
 * GET /catalog/shopping-zones: the store's active collections. A merchandising extra, so a
 * failure leaves the rail off the screen instead of showing an error in its place.
 */
export function useShoppingZones(): UseQueryResult<readonly ShoppingZone[]> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.catalog.shoppingZones(),
    queryFn: async ({ signal }) => {
      if (api === null) throw new ApiNotConfiguredError();
      return (await api.shoppingZones({ signal })).zones;
    },
    retry: false,
  });
}

export interface DepartmentListing extends ResolvedListing {
  /**
   * False only while a category is chosen and the category list has not arrived: whether it
   * is a department is not known yet, so the first request is held back instead of asking
   * for direct products and then again for the branch.
   */
  ready: boolean;
}

/**
 * The listing a screen really shows: its filters and sorts adjusted for a department (see
 * resolveListing). Every listing goes through this, so Shop, its filter sheet and a
 * department page mean the same thing. A category list that fails to load degrades to direct
 * products rather than holding the listing back.
 */
export function useDepartmentListing(
  filters: ShopFilters,
  sorts: readonly CatalogSort[],
): DepartmentListing {
  const categories = useCategories();
  const waiting = filters.category !== undefined && categories.isPending;
  const data = categories.data;
  return useMemo(
    () => ({ ...resolveListing(filters, sorts, data), ready: !waiting }),
    [filters, sorts, data, waiting],
  );
}

/**
 * One page of a listing, for Home's rows and a product's suggestions. `enabled: false` holds the
 * request back (the query then reads as loading), which is how a suggestion that is not needed
 * yet asks for nothing.
 */
export function useProductPage(
  query: Omit<ProductListQuery, 'page'>,
  options: { enabled?: boolean } = {},
): UseQueryResult<ProductListResponse> {
  const api = useApi();
  const request: ProductListQuery = { ...query, page: 1 };
  return useQuery({
    queryKey: queryKeys.catalog.products(request),
    queryFn: ({ signal }) => {
      if (api === null) return Promise.reject(new ApiNotConfiguredError());
      return api.listProducts(request, { signal });
    },
    enabled: options.enabled ?? true,
  });
}

/** How many products a product screen suggests. */
export const RELATED_PRODUCT_COUNT = 4;

export interface RelatedProducts {
  /** Suggestions in order, each once, never the product being read. */
  items: ProductSummary[];
  /** `pending` until there is an answer; `error` only when nothing could be read. */
  status: 'pending' | 'error' | 'success';
  error: unknown;
  isRefetching: boolean;
  refetch: () => void;
}

/** The first `limit` products that are not the one being read, each once. */
function pickRelated(
  items: readonly ProductSummary[] | undefined,
  product: ProductDetail | null,
  limit: number,
): ProductSummary[] {
  if (items === undefined || product === null) return [];
  const picked: ProductSummary[] = [];
  for (const item of items) {
    if (picked.length >= limit) break;
    if (item.id === product.id || picked.some((entry) => entry.id === item.id)) continue;
    picked.push(item);
  }
  return picked;
}

/**
 * "You may also like" on a product screen, following the website's rule: more from the same
 * category first, then — only if that leaves room — more from the same brand. Both reads are
 * the catalog's own listing, so no new endpoint is involved; a suggestion that cannot be read
 * simply leaves the others.
 */
export function useRelatedProducts(product: ProductDetail | null): RelatedProducts {
  const brandSlug = product?.brand?.slug ?? null;
  const category = useProductPage(
    {
      category: product?.category.slug ?? '',
      sort: 'featured',
      pageSize: RELATED_PRODUCT_COUNT + 1,
    },
    { enabled: product !== null },
  );
  const fromCategory = useMemo(
    () => pickRelated(category.data?.items, product, RELATED_PRODUCT_COUNT),
    [category.data, product],
  );
  // The brand's products are only asked for when the category has not filled the row.
  const brand = useProductPage(
    { brand: brandSlug ?? '', sort: 'featured', pageSize: RELATED_PRODUCT_COUNT + 1 },
    {
      enabled:
        product !== null && brandSlug !== null && fromCategory.length < RELATED_PRODUCT_COUNT,
    },
  );
  const items = useMemo(() => {
    const picked = [...fromCategory];
    for (const item of brand.data?.items ?? []) {
      if (picked.length >= RELATED_PRODUCT_COUNT) break;
      if (item.id === product?.id || picked.some((entry) => entry.id === item.id)) continue;
      picked.push(item);
    }
    return picked;
  }, [fromCategory, brand.data, product?.id]);

  const waiting = brandSlug !== null && fromCategory.length < RELATED_PRODUCT_COUNT;
  const error = category.error ?? (waiting ? brand.error : undefined);
  const status: RelatedProducts['status'] =
    items.length > 0
      ? 'success'
      : category.isPending || (waiting && brand.isPending)
        ? 'pending'
        : error !== null && error !== undefined
          ? 'error'
          : 'success';

  return {
    items,
    status,
    error,
    isRefetching: category.isRefetching || (waiting && brand.isRefetching),
    refetch: () => {
      void category.refetch();
      if (waiting) void brand.refetch();
    },
  };
}

export interface ProductFeed {
  query: UseInfiniteQueryResult<InfiniteData<ProductListResponse, number>>;
  /** Every product loaded so far, in order, each once. */
  items: ProductSummary[];
  /** How many products match in all (from the latest page), or null before the first page. */
  total: number | null;
}

/**
 * An endless listing: page 1, then the next page whenever `query.fetchNextPage()` is called.
 * `enabled: false` holds the first request back (the listing then reads as loading).
 */
export function useProductFeed(
  query: Omit<ProductListQuery, 'page'>,
  options: { enabled?: boolean } = {},
): ProductFeed {
  const api = useApi();
  const feed = useInfiniteQuery<
    ProductListResponse,
    Error,
    InfiniteData<ProductListResponse, number>,
    ReturnType<typeof queryKeys.catalog.productFeed>,
    number
  >({
    queryKey: queryKeys.catalog.productFeed(query),
    queryFn: ({ pageParam, signal }) => {
      if (api === null) return Promise.reject(new ApiNotConfiguredError());
      return api.listProducts({ ...query, page: pageParam }, { signal });
    },
    initialPageParam: 1,
    getNextPageParam: (last) => nextPageNumber(last),
    enabled: options.enabled ?? true,
  });

  const pages = feed.data?.pages;
  const items = useMemo(() => uniqueProducts(pages ?? []), [pages]);
  const total = pages?.[pages.length - 1]?.total ?? null;
  return { query: feed, items, total };
}

/** GET /catalog/products/:slug. A product that is missing or hidden fails with a 404 ApiError. */
export function useProduct(slug: string | null): UseQueryResult<ProductDetail> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.catalog.product(slug ?? ''),
    queryFn: async ({ signal }) => {
      if (api === null) throw new ApiNotConfiguredError();
      return (await api.getProduct(slug ?? '', { signal })).product;
    },
    enabled: slug !== null,
  });
}

/** Nothing to choose: no size or colour chip is drawn. */
export const EMPTY_FACETS: ProductFacets = { sizes: [], colors: [] };

/**
 * GET /catalog/product-facets: the sizes and colours the current listing really offers, with
 * how many products each would leave. A merchandising extra like the zones: an API that does
 * not answer them (or has no variant data) leaves the chips off instead of showing an error.
 */
export function useProductFacets(query: ProductFacetsQuery): ProductFacets {
  const api = useApi();
  const facets = useQuery({
    queryKey: queryKeys.catalog.productFacets(query),
    queryFn: async ({ signal }) => {
      if (api === null) throw new ApiNotConfiguredError();
      return (await api.productFacets(query, { signal })).facets;
    },
    retry: false,
  });
  return facets.data ?? EMPTY_FACETS;
}
