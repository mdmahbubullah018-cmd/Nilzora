import type {
  Banner,
  BannerPlacement,
  Brand,
  BrandLookupResponse,
  BrandProductsQuery,
  BrandProductsResponse,
} from '@nilzora/contracts';
import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApi } from '@/api/api-context';
import { ApiNotConfiguredError } from '@/lib/errors';
import { nextPageNumber } from '@/features/catalog/catalog-query';

/* Brand and banner data: public, keyed under 'catalog' so a catalog refresh covers them. */

export function useBrands(): UseQueryResult<readonly Brand[]> {
  const api = useApi();
  return useQuery({
    queryKey: ['catalog', 'brands'],
    queryFn: async ({ signal }) => {
      if (api === null) throw new ApiNotConfiguredError();
      return (await api.listBrands({ signal })).brands;
    },
  });
}

export function useBrand(slug: string | null): UseQueryResult<BrandLookupResponse> {
  const api = useApi();
  return useQuery({
    queryKey: ['catalog', 'brand', slug],
    enabled: slug !== null,
    queryFn: ({ signal }) => {
      if (api === null || slug === null) return Promise.reject(new ApiNotConfiguredError());
      return api.getBrand(slug, { signal });
    },
  });
}

export function useBrandProducts(
  slug: string | null,
  sort: BrandProductsQuery['sort'] = 'featured',
) {
  const api = useApi();
  return useInfiniteQuery<
    BrandProductsResponse,
    Error,
    InfiniteData<BrandProductsResponse, number>,
    readonly unknown[],
    number
  >({
    queryKey: ['catalog', 'brand-products', slug, sort],
    enabled: slug !== null,
    queryFn: ({ pageParam, signal }) => {
      if (api === null || slug === null) return Promise.reject(new ApiNotConfiguredError());
      return api.listBrandProducts(slug, { page: pageParam, pageSize: 24, sort }, { signal });
    },
    initialPageParam: 1,
    getNextPageParam: (last) => nextPageNumber(last),
  });
}

/** Banners on show for a placement, optionally for one category. Promotions are optional:
 * callers treat errors as none. */
export function useBanners(
  placement: BannerPlacement,
  category?: string,
): UseQueryResult<readonly Banner[]> {
  const api = useApi();
  return useQuery({
    queryKey: ['catalog', 'banners', placement, category ?? null],
    queryFn: async ({ signal }) => {
      if (api === null) throw new ApiNotConfiguredError();
      return (await api.listBanners({ placement, category }, { signal })).banners;
    },
  });
}

/** A brand slug from a route parameter, or null when it cannot be one. */
export function parseBrandSlug(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value) && value.length <= 60
    ? value
    : null;
}
