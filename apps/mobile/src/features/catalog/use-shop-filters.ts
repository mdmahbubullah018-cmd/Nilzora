import type { CatalogSort } from '@nilzora/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  firstParam,
  normalisePriceRange,
  parseSearchText,
  parseShopFilters,
  sortsFor,
  sortsForFilters,
  type ShopFilters,
  type ShopParams,
} from './catalog-query';

/** How long the search text must rest before the listing follows it. */
export const SEARCH_DEBOUNCE_MS = 400;

export interface ShopFilterControls {
  /** What the address (route parameters) asks for. The listing follows this. */
  filters: ShopFilters;
  /** The sorts on offer for these filters. */
  sorts: readonly CatalogSort[];
  /** The text in the search field: ahead of `filters.q` while the customer is typing. */
  draft: string;
  setDraft: (text: string) => void;
  /** Applies the draft now (the keyboard's search key). */
  submitSearch: () => void;
  /** Runs a given term now, e.g. one chosen from the device-local recent searches. */
  search: (text: string) => void;
  clearSearch: () => void;
  setCategory: (slug: string | undefined) => void;
  /** Leaves the collection, keeping the search, category and sort. */
  setZone: (slug: string | undefined) => void;
  setSort: (sort: CatalogSort) => void;
  /** Applies a price range in whole taka (undefined for an open end); swapped if reversed. */
  setPrice: (range: { minTaka?: number | undefined; maxTaka?: number | undefined }) => void;
  setBrand: (slug: string | undefined) => void;
  setInStock: (only: boolean) => void;
  /**
   * Applies the advanced sheet in one address change: its category, sort, brand and
   * availability, keeping the search, collection and price already chosen.
   */
  applyFilters: (next: {
    category: string | undefined;
    sort: CatalogSort;
    brand: string | undefined;
    inStock: boolean;
  }) => void;
  /**
   * Writes a whole filter set to the address in one change: what the toolbar and the sheets
   * call when several values change together.
   */
  setFilters: (next: ShopFilters) => void;
  /** Drops the search, the collection, the category, the sort and every refinement. */
  clearAll: () => void;
}

/**
 * Shop state. The route parameters (q, category, sort) are the single source of truth, so a
 * link from Home, a deep link and the back button all land on the same listing. Only the text
 * being typed is local: it is written to `q` once the customer pauses (or presses search), and
 * a `q` that arrives from outside replaces the text in the field.
 */
export function useShopFilters(): ShopFilterControls {
  const router = useRouter();
  const params = useLocalSearchParams<ShopParams>();

  const rawQ = firstParam(params.q);
  const rawCategory = firstParam(params.category);
  const rawZone = firstParam(params.zone);
  const rawSort = firstParam(params.sort);
  const rawBrand = firstParam(params.brand);
  const rawMin = firstParam(params.min);
  const rawMax = firstParam(params.max);
  const rawStock = firstParam(params.stock);
  const rawSize = params.size;
  const rawColor = params.color;
  const filters = useMemo(
    () =>
      parseShopFilters({
        q: rawQ,
        category: rawCategory,
        zone: rawZone,
        sort: rawSort,
        brand: rawBrand,
        min: rawMin,
        max: rawMax,
        stock: rawStock,
        size: rawSize,
        color: rawColor,
      }),
    [rawQ, rawCategory, rawZone, rawSort, rawBrand, rawMin, rawMax, rawStock, rawSize, rawColor],
  );

  const [draft, setDraft] = useState(filters.q);
  /** The last `q` this screen wrote (or showed); a different `q` in the address came from outside. */
  const committed = useRef(filters.q);

  useEffect(() => {
    if (filters.q !== committed.current) {
      committed.current = filters.q;
      setDraft(filters.q);
    }
  }, [filters.q]);

  const commitSearch = useCallback(
    (text: string) => {
      const next = parseSearchText(text);
      if (next === committed.current) return;
      committed.current = next;
      router.setParams({ q: next === '' ? undefined : next });
    },
    [router],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      commitSearch(draft);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [draft, commitSearch]);

  const submitSearch = useCallback(() => {
    commitSearch(draft);
  }, [commitSearch, draft]);

  const search = useCallback(
    (text: string) => {
      setDraft(text);
      commitSearch(text);
    },
    [commitSearch],
  );

  const clearSearch = useCallback(() => {
    setDraft('');
    commitSearch('');
  }, [commitSearch]);

  const setCategory = useCallback(
    (slug: string | undefined) => {
      router.setParams({ category: slug });
    },
    [router],
  );

  const setZone = useCallback(
    (slug: string | undefined) => {
      router.setParams({ zone: slug });
    },
    [router],
  );

  const q = filters.q;
  const setSort = useCallback(
    (sort: CatalogSort) => {
      // The default sort is left out of the address, as on the website.
      router.setParams({ sort: sort === sortsFor(q)[0] ? undefined : sort });
    },
    [router, q],
  );

  const setPrice = useCallback(
    (range: { minTaka?: number | undefined; maxTaka?: number | undefined }) => {
      const price = normalisePriceRange(range.minTaka, range.maxTaka);
      router.setParams({
        min: price.minTaka === undefined ? undefined : String(price.minTaka),
        max: price.maxTaka === undefined ? undefined : String(price.maxTaka),
      });
    },
    [router],
  );

  const setBrand = useCallback(
    (slug: string | undefined) => {
      router.setParams({ brand: slug });
    },
    [router],
  );

  const setInStock = useCallback(
    (only: boolean) => {
      router.setParams({ stock: only ? 'in' : undefined });
    },
    [router],
  );

  const clearAll = useCallback(() => {
    setDraft('');
    committed.current = '';
    router.setParams({
      q: undefined,
      category: undefined,
      zone: undefined,
      sort: undefined,
      brand: undefined,
      min: undefined,
      max: undefined,
      stock: undefined,
      size: undefined,
      color: undefined,
    });
  }, [router]);

  const applyFilters = useCallback(
    (next: {
      category: string | undefined;
      sort: CatalogSort;
      brand: string | undefined;
      inStock: boolean;
    }) => {
      // One address change, so the listing never refetches twice for one Apply.
      router.setParams({
        category: next.category,
        sort: next.sort === sortsFor(q)[0] ? undefined : next.sort,
        brand: next.brand,
        stock: next.inStock ? 'in' : undefined,
      });
    },
    [router, q],
  );

  const setFilters = useCallback(
    (next: ShopFilters) => {
      setDraft(next.q);
      committed.current = next.q;
      // One address change, so the listing never refetches twice for one adjustment.
      router.setParams({
        q: next.q === '' ? undefined : next.q,
        category: next.category,
        zone: next.zone,
        sort: next.sort === sortsFor(next.q)[0] ? undefined : next.sort,
        brand: next.brand,
        min: next.minTaka === undefined ? undefined : String(next.minTaka),
        max: next.maxTaka === undefined ? undefined : String(next.maxTaka),
        stock: next.inStock === true ? 'in' : undefined,
        size: next.sizes !== undefined && next.sizes.length > 0 ? next.sizes.join(',') : undefined,
        color:
          next.colors !== undefined && next.colors.length > 0 ? next.colors.join(',') : undefined,
      });
    },
    [router],
  );

  return {
    filters,
    // Best match is not offered once anything narrows the results, because the API refuses it.
    sorts: sortsForFilters(filters.q, filters),
    draft,
    setDraft,
    submitSearch,
    search,
    clearSearch,
    setCategory,
    setZone,
    setSort,
    setPrice,
    setBrand,
    setInStock,
    applyFilters,
    setFilters,
    clearAll,
  };
}
