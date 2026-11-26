import 'server-only';
import type {
  AccountRef,
  AdminCategory,
  AdminProductDetail,
  AdminProductListQuery,
  AdminProductListResponse,
  InventoryMovementListResponse,
} from '@nilzora/contracts';
import { adminRead, type AdminRead } from '@/components/admin-kit/read';
import {
  movementListQuery,
  productListQuery,
  type MovementListParams,
  type ProductListParams,
} from './catalog-query';

/*
 * The catalog pages' reads, in parallel where a page needs several. Each result is the
 * read's own outcome: the page shows a state for every failure and never made-up data.
 */

export function readCategories(): Promise<AdminRead<AdminCategory[]>> {
  return adminRead((api, token) =>
    api.adminListCategories(token).then((response) => response.categories),
  );
}

export interface ProductListData {
  products: AdminRead<AdminProductListResponse>;
  /** For the category filter; the list still shows when it fails. */
  categories: AdminRead<AdminCategory[]>;
}

export async function loadProductList(params: ProductListParams): Promise<ProductListData> {
  const [products, categories] = await Promise.all([
    adminRead((api, token) => api.adminListProducts(token, productListQuery(params))),
    readCategories(),
  ]);
  return { products, categories };
}

/** How many recent stock movements a product page shows. */
export const RECENT_MOVEMENTS = 6;

export interface ProductDetailData {
  product: AdminRead<AdminProductDetail>;
  categories: AdminRead<AdminCategory[]>;
  movements: AdminRead<InventoryMovementListResponse>;
  /**
   * Who reviews the latest content review, for accounts that may read reviews
   * (moderation.assign). Null when nobody is assigned, the account may not read it, or
   * the read failed: the page then says only whether someone is assigned.
   */
  reviewer: AccountRef | null;
}

export async function loadProductDetail(
  productId: string,
  { readReviewer = false }: { readReviewer?: boolean } = {},
): Promise<ProductDetailData> {
  const [product, categories, movements] = await Promise.all([
    adminRead((api, token) =>
      api.adminGetProduct(token, productId).then((response) => response.product),
    ),
    readCategories(),
    adminRead((api, token) =>
      api.adminListInventoryMovements(token, { productId, pageSize: RECENT_MOVEMENTS }),
    ),
  ]);
  const review = product.kind === 'ok' ? product.value.latestReview : null;
  let reviewer: AccountRef | null = null;
  if (readReviewer && review?.assigned) {
    const task = await adminRead((api, token) =>
      api.adminGetModerationTask(token, review.taskId).then((response) => response.task),
    );
    reviewer = task.kind === 'ok' ? task.value.assignedTo : null;
  }
  return { product, categories, movements, reviewer };
}

/** Every read of a page's data, for the "session lapsed" check. */
export function anySignedOut(reads: readonly (AdminRead<unknown> | null)[]): boolean {
  return reads.some((read) => read?.kind === 'signed_out');
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

/** The products a "needs attention" list holds at most (the API's largest page). */
export const ATTENTION_LIMIT = 100;

/**
 * Stock counts. The urgent ones (low, out) count products on sale only, with exactly the
 * filters of the lists they link to (`status=active&stock=low|out`).
 */
export interface StockCounts {
  /** Every product, in any status. */
  total: number;
  /** Products on sale. */
  active: number;
  /** On sale and at or below the low-stock threshold, sold out included. */
  low: number;
  /** On sale and sold out. */
  out: number;
}

/** The filter behind the "needs attention" list and the urgent counts' links. */
export const ATTENTION_FILTER = { status: 'active', stock: 'low' } as const;

export interface InventoryOverviewData {
  counts: AdminRead<StockCounts>;
  /** Products on sale that are low or sold out, lowest stock first (the API's order). */
  attention: AdminRead<AdminProductListResponse>;
  /** The filtered, paged list of every product's stock. */
  products: AdminRead<AdminProductListResponse>;
  categories: AdminRead<AdminCategory[]>;
}

function countOf(query: AdminProductListQuery): Promise<AdminRead<number>> {
  return adminRead((api, token) =>
    api.adminListProducts(token, { ...query, pageSize: 1 }).then((response) => response.total),
  );
}

export async function loadInventoryOverview(
  params: ProductListParams,
): Promise<InventoryOverviewData> {
  const [total, active, low, out, attention, products, categories] = await Promise.all([
    countOf({}),
    countOf({ status: 'active' }),
    countOf(ATTENTION_FILTER),
    countOf({ status: 'active', stock: 'out' }),
    adminRead((api, token) =>
      api
        // The lowest stock first, so a long list still shows the most urgent products.
        .adminListProducts(token, {
          ...ATTENTION_FILTER,
          sort: 'stock_asc',
          pageSize: ATTENTION_LIMIT,
        }),
    ),
    adminRead((api, token) => api.adminListProducts(token, productListQuery(params))),
    readCategories(),
  ]);
  const counts: AdminRead<StockCounts> =
    total.kind !== 'ok'
      ? total
      : active.kind !== 'ok'
        ? active
        : low.kind !== 'ok'
          ? low
          : out.kind !== 'ok'
            ? out
            : {
                kind: 'ok',
                value: { total: total.value, active: active.value, low: low.value, out: out.value },
              };
  return { counts, attention, products, categories };
}

export interface MovementLedgerData {
  movements: AdminRead<InventoryMovementListResponse>;
  /** Products for the product filter (the most recently changed ones). */
  products: AdminRead<AdminProductListResponse>;
}

/** How many products the ledger's product filter offers. */
export const PRODUCT_FILTER_LIMIT = 100;

export async function loadMovementLedger(params: MovementListParams): Promise<MovementLedgerData> {
  const [movements, products] = await Promise.all([
    adminRead((api, token) => api.adminListInventoryMovements(token, movementListQuery(params))),
    adminRead((api, token) => api.adminListProducts(token, { pageSize: PRODUCT_FILTER_LIMIT })),
  ]);
  return { movements, products };
}
