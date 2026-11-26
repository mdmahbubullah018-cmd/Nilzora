import type { ProductDetail } from '@nilzora/contracts';
import { useQueries } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useApi } from '@/api/api-context';
import { isProductNotFound } from '@/features/catalog/catalog-query';
import { ApiNotConfiguredError } from '@/lib/errors';
import { queryKeys } from '@/query/query-keys';

/** One saved product, with what the API currently says about it. */
export interface WishlistRow {
  slug: string;
  product: ProductDetail | undefined;
  /** The first load for this product is still running. */
  loading: boolean;
  /** The API says this product is gone (deleted or hidden): only removal makes sense. */
  missing: boolean;
  /** The product could not be loaded (network, server); retrying can help. */
  failed: boolean;
}

export interface WishlistProducts {
  rows: readonly WishlistRow[];
  /** True while any product is loading for the first time. */
  loading: boolean;
  /** True while a retry is running. */
  refreshing: boolean;
  /** Loads every saved product again. */
  refetch: () => Promise<void>;
}

/**
 * Reads the live product for each saved slug. The wishlist stores no snapshot of a product,
 * so price, stock and availability here are always what the API currently returns; a product
 * that has since been hidden is reported as missing instead of being shown from memory.
 */
export function useWishlistProducts(slugs: readonly string[]): WishlistProducts {
  const api = useApi();
  const results = useQueries({
    queries: slugs.map((slug) => ({
      queryKey: queryKeys.catalog.product(slug),
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        if (api === null) throw new ApiNotConfiguredError();
        return (await api.getProduct(slug, { signal })).product;
      },
      enabled: api !== null,
    })),
  });

  const rows: WishlistRow[] = slugs.map((slug, index) => {
    const result = results[index];
    const product: ProductDetail | undefined = result?.data;
    return {
      slug,
      product,
      loading: result !== undefined && result.isPending && api !== null,
      missing: result !== undefined && isProductNotFound(result.error),
      failed: result !== undefined && result.isError && !isProductNotFound(result.error),
    };
  });

  const refetch = useCallback(async () => {
    await Promise.all(results.map((result) => result.refetch()));
  }, [results]);

  return {
    rows,
    loading: rows.some((row) => row.loading),
    refreshing: results.some((result) => result.isFetching && !result.isPending),
    refetch,
  };
}
