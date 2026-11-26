import {
  adminCategoryRefSchema,
  INVENTORY_REASONS,
  MODERATION_STATUSES,
  PRODUCT_STATUSES,
  type AdminProductListQuery,
  type AdminProductSort,
  type InventoryMovementListQuery,
  type InventoryReason,
  type ModerationStatus,
  type ProductStatus,
} from '@nilzora/contracts';
import type { Route } from 'next';
import { parseSort, sortParam, type SortState } from '@/components/admin-kit/data-table';
import { oneOf, pageParam, single, withQuery } from '@/components/admin-kit/href';

/*
 * The catalog lists' URL parameters: read back from the address, checked against the
 * contract's values (anything else is dropped, never guessed), turned into API queries
 * and into links that keep the other filters. The API validates every query again.
 */

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

export const PRODUCTS_PAGE_SIZE = 25;
export const MOVEMENTS_PAGE_SIZE = 25;

export const STOCK_FILTERS = ['low', 'out'] as const;
export type StockFilter = (typeof STOCK_FILTERS)[number];

/** A record id: the contract's own uuid check. */
const uuid = adminCategoryRefSchema.shape.id;

function searchText(value: string | string[] | undefined): string | undefined {
  const text = single(value)?.trim().slice(0, 100);
  return text ? text : undefined;
}

function uuidParam(value: string | string[] | undefined): string | undefined {
  const text = single(value);
  return text !== undefined && uuid.safeParse(text).success ? text : undefined;
}

/**
 * Product list columns that sort, as `?sort=name` (ascending) or `?sort=-price`
 * (descending). Without a sort the API lists the most recently changed first, which is
 * the only order "updated" has.
 */
export const PRODUCT_SORT_COLUMNS = ['name', 'price', 'stock', 'updated'] as const;
export type ProductSortColumn = (typeof PRODUCT_SORT_COLUMNS)[number];
export type ProductSortState = SortState<ProductSortColumn>;
export const DEFAULT_PRODUCT_SORT: ProductSortState = { column: 'updated', direction: 'desc' };

/** The API's order for a sort state; "updated" is newest first whichever way it was asked. */
export function productSortOf(sort: ProductSortState): AdminProductSort {
  return sort.column === 'updated' ? 'updated_desc' : `${sort.column}_${sort.direction}`;
}

function isDefaultSort(sort: ProductSortState): boolean {
  return productSortOf(sort) === 'updated_desc';
}

/** The `sort` parameter of a sort state; empty for the default order. */
export function productSortParam(sort: ProductSortState | undefined): string | undefined {
  return sort === undefined || isDefaultSort(sort) ? undefined : sortParam(sort);
}

export interface ProductListParams {
  q?: string | undefined;
  status?: ProductStatus | undefined;
  moderation?: ModerationStatus | undefined;
  category?: string | undefined;
  stock?: StockFilter | undefined;
  /** Omitted: most recently changed first. */
  sort?: ProductSortState | undefined;
  page: number;
}

export function parseProductListParams(params: SearchParams): ProductListParams {
  return {
    q: searchText(params.q),
    status: oneOf(params.status, PRODUCT_STATUSES),
    moderation: oneOf(params.moderation, MODERATION_STATUSES),
    category: uuidParam(params.category),
    stock: oneOf(params.stock, STOCK_FILTERS),
    sort: parseSort(params.sort, PRODUCT_SORT_COLUMNS, DEFAULT_PRODUCT_SORT),
    page: pageParam(params.page),
  };
}

export function productListQuery(
  params: ProductListParams,
  pageSize = PRODUCTS_PAGE_SIZE,
): AdminProductListQuery {
  return {
    q: params.q,
    status: params.status,
    moderationStatus: params.moderation,
    categoryId: params.category,
    stock: params.stock,
    sort: productSortOf(params.sort ?? DEFAULT_PRODUCT_SORT),
    page: params.page,
    pageSize,
  };
}

/** Whether any filter (not the page) is in effect. */
export function hasProductFilters(params: ProductListParams): boolean {
  return Boolean(params.q || params.status || params.moderation || params.category || params.stock);
}

/** The product list with these filters; changing a filter starts again from page 1. */
export function productListHref(
  params: ProductListParams,
  changes: Partial<ProductListParams> = {},
  base: Route = '/admin/products',
): Route {
  const next = { ...params, page: 1, ...changes };
  return withQuery(base, {
    q: next.q,
    status: next.status,
    moderation: next.moderation,
    category: next.category,
    stock: next.stock,
    sort: productSortParam(next.sort),
    page: next.page > 1 ? next.page : undefined,
  });
}

export interface MovementListParams {
  product?: string | undefined;
  reason?: InventoryReason | undefined;
  page: number;
}

export function parseMovementListParams(params: SearchParams): MovementListParams {
  return {
    product: uuidParam(params.product),
    reason: oneOf(params.reason, INVENTORY_REASONS),
    page: pageParam(params.page),
  };
}

export function movementListQuery(
  params: MovementListParams,
  pageSize = MOVEMENTS_PAGE_SIZE,
): InventoryMovementListQuery {
  return { productId: params.product, reason: params.reason, page: params.page, pageSize };
}

/** The stock ledger view of /admin/inventory with these filters. */
export function movementListHref(
  params: MovementListParams,
  changes: Partial<MovementListParams> = {},
): Route {
  const next = { ...params, page: 1, ...changes };
  return withQuery('/admin/inventory', {
    view: 'movements',
    product: next.product,
    reason: next.reason,
    page: next.page > 1 ? next.page : undefined,
  });
}
