import type { ProductListQuery, ProductListResponse, ProductSummary } from '@nilzora/contracts';
import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query';
import { useApi } from '@/api/api-context';
import { ApiNotConfiguredError } from '@/lib/errors';
import { queryKeys } from '@/query/query-keys';
import {
  feedQuery,
  nextPageNumber,
  parseSearchText,
  uniqueProducts,
  type ShopFilters,
} from '@/features/catalog/catalog-query';

/*
 * Search data
 * -----------
 * Everything here goes through the API the website uses, so a search means the same thing in
 * both places: the same endpoint, the same filters, the same relevance ordering and the same
 * visibility rules (the API only ever lists products a shopper may see).
 *
 * Two reads:
 *
 *   discovery    one request for what to show before anyone types;
 *   results      the endless listing for the settled query the customer typed.
 *
 * There is no separate suggestion service and no per-keystroke request: the screen debounces the
 * field, so typing a word costs ONE request for that word rather than one per letter. Nothing is
 * sent for a query shorter than MIN_SEARCH_LENGTH. Each query key carries its own text, so a
 * slow answer for "sho" can never land in the cache entry — or on the screen — for "shoes";
 * TanStack Query also aborts the older request through `signal`.
 */

/** Below this many characters, typing stays local: no suggestion or result request is made. */
export const MIN_SEARCH_LENGTH = 2;

/** How long the text must rest before the screen asks the API about it. */
export const SEARCH_DEBOUNCE_MS = 350;

/** True when the text is long enough to search for. */
export function isSearchable(text: string): boolean {
  return Array.from(parseSearchText(text)).length >= MIN_SEARCH_LENGTH;
}

/**
 * GET /catalog/discovery — the sections the store's own data supports (best selling, trending,
 * top rated, new). A section whose evidence is missing is simply absent from the answer, so
 * nothing on the screen claims to be popular without the orders or reviews behind it.
 */
export function useDiscovery() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.catalog.discovery(),
    queryFn: async ({ signal }) => {
      if (api === null) throw new ApiNotConfiguredError();
      return (await api.discovery({ signal })).sections;
    },
    // Retrying a discovery feed is not worth a spinner; the screen simply shows the field.
    retry: false,
  });
}

export interface SearchResults {
  query: ReturnType<typeof useInfiniteQuery<ProductListResponse, Error>>;
  items: ProductSummary[];
  total: number | null;
}

/**
 * The endless result list for one settled query.
 *
 * `filters.q` is the committed text, not what is in the field, so a request is only ever made
 * for a query the customer has stopped typing. Paging is the API's own (`page`/`pageSize`),
 * never a client-side slice of the whole catalogue.
 */
export function useSearchResults(
  filters: ShopFilters,
  options: { enabled: boolean },
): SearchResults {
  const api = useApi();
  // The same query the listings build, so every refinement the sheet offers — category, brand,
  // price, availability, size and colour — reaches the API instead of being silently dropped.
  const request: Omit<ProductListQuery, 'page'> = feedQuery(filters);

  const query = useInfiniteQuery<
    ProductListResponse,
    Error,
    InfiniteData<ProductListResponse, number>,
    ReturnType<typeof queryKeys.catalog.productFeed>,
    number
  >({
    queryKey: queryKeys.catalog.productFeed(request),
    queryFn: ({ pageParam, signal }) => {
      if (api === null) return Promise.reject(new ApiNotConfiguredError());
      return api.listProducts({ ...request, page: pageParam }, { signal });
    },
    initialPageParam: 1,
    getNextPageParam: (last) => nextPageNumber(last),
    enabled: options.enabled && isSearchable(filters.q),
    staleTime: 60_000,
  });

  const pages = query.data?.pages;
  return {
    query,
    items: uniqueProducts(pages ?? []),
    total: pages?.[pages.length - 1]?.total ?? null,
  };
}
