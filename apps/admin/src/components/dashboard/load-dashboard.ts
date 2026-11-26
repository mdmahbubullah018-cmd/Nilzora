import 'server-only';
import type {
  AdminOrderSummary,
  AdminReviewListResponse,
  AnalyticsOverview,
  AuditEntry,
  CheckoutRecoveryMetrics,
  DashboardResponse,
  Permission,
} from '@nilzora/contracts';
import { adminRead, type AdminRead } from '@/components/admin-kit/read';
import type { ReportRange } from '@/lib/date-range';

/**
 * How big the catalogue and the customer base are, read from the list endpoints' own
 * totals (the dashboard endpoint has no such figures). Each is null when the account
 * may not read that list, so a tile is simply absent rather than invented.
 */
export interface CatalogueCounts {
  products: number | null;
  activeProducts: number | null;
  outOfStock: number | null;
  customers: number | null;
}

/**
 * Everything the dashboard shows. A section is null when the account does not hold its
 * permission (it is then left out, never faked) and otherwise the outcome of its read.
 */
export interface DashboardData {
  range: ReportRange;
  /** The page's clock, for "5 min ago". */
  now: Date;
  /** Waiting work: orders by step, low stock, open content reviews (per permission). */
  summary: AdminRead<DashboardResponse>;
  /** The range's analytics (finance.read). */
  analytics: AdminRead<AnalyticsOverview> | null;
  recentOrders: AdminRead<AdminOrderSummary[]> | null;
  activity: AdminRead<AuditEntry[]> | null;
  /** Catalogue and customer totals; null when the account may read neither list. */
  catalogue: AdminRead<CatalogueCounts> | null;
  /** Customer reviews waiting for moderation (reviews.moderate). */
  pendingReviews: AdminRead<AdminReviewListResponse> | null;
  /**
   * Abandoned-checkout figures for the same range (orders.read). Read from
   * admin_checkout_recovery_metrics, so the journey panel never adds numbers up itself.
   */
  abandoned: AdminRead<CheckoutRecoveryMetrics> | null;
}

export const RECENT_ORDERS = 6;
export const RECENT_ACTIVITY = 8;
export const PENDING_REVIEWS = 4;

function holds(permissions: readonly Permission[], permission: Permission): boolean {
  return permissions.includes(permission);
}

/**
 * Reads the dashboard's data in parallel, asking only for what the account may see.
 * The permission list only decides what to ask for: the API authorises each read, and
 * a refusal is shown as such. Every figure comes from the API — nothing is estimated
 * here, and a section that cannot be read says so instead of showing zeros.
 */
export async function loadDashboard(
  permissions: readonly Permission[],
  range: ReportRange,
): Promise<DashboardData> {
  const readsProducts = holds(permissions, 'products.read');
  const readsCustomers = holds(permissions, 'customers.read');
  const readsCheckouts = holds(permissions, 'orders.read');
  const [summary, analytics, recentOrders, activity, catalogue, pendingReviews, abandoned] =
    await Promise.all([
      adminRead((api, token) => api.adminDashboard(token)),
      holds(permissions, 'finance.read')
        ? adminRead((api, token) =>
            api
              .adminAnalyticsOverview(token, {
                from: range.from,
                to: range.to,
                compare: range.compare ? 'true' : 'false',
              })
              .then((response) => response.overview),
          )
        : null,
      holds(permissions, 'orders.read')
        ? adminRead((api, token) =>
            api.adminListOrders(token, { pageSize: RECENT_ORDERS }).then((page) => page.orders),
          )
        : null,
      holds(permissions, 'audit_logs.read')
        ? adminRead((api, token) =>
            api.adminAuditLog(token, { pageSize: RECENT_ACTIVITY }).then((page) => page.entries),
          )
        : null,
      readsProducts || readsCustomers
        ? adminRead(async (api, token): Promise<CatalogueCounts> => {
            const [products, activeProducts, outOfStock, customers] = await Promise.all([
              readsProducts
                ? api.adminListProducts(token, { pageSize: 1 }).then((page) => page.total)
                : Promise.resolve(null),
              readsProducts
                ? api
                    .adminListProducts(token, { pageSize: 1, status: 'active' })
                    .then((page) => page.total)
                : Promise.resolve(null),
              readsProducts
                ? api
                    .adminListProducts(token, { pageSize: 1, stock: 'out' })
                    .then((page) => page.total)
                : Promise.resolve(null),
              readsCustomers
                ? api.adminListCustomers(token, { pageSize: 1 }).then((page) => page.total)
                : Promise.resolve(null),
            ]);
            return { products, activeProducts, outOfStock, customers };
          })
        : null,
      holds(permissions, 'reviews.moderate')
        ? adminRead((api, token) =>
            api.adminListReviews(token, { status: 'pending', pageSize: PENDING_REVIEWS }),
          )
        : null,
      // The same window as the funnel, so the two panels cannot disagree about the period.
      readsCheckouts
        ? adminRead((api, token) =>
            api
              .adminCheckoutMetrics(token, { from: range.from, to: range.to })
              .then((response) => response.metrics),
          )
        : null,
    ]);
  return {
    range,
    now: new Date(),
    summary,
    analytics,
    recentOrders,
    activity,
    catalogue,
    pendingReviews,
    abandoned,
  };
}

/** Whether any read found the session lapsed (the page then sends the visitor to sign in). */
export function signedOut(data: DashboardData): boolean {
  return [
    data.summary,
    data.analytics,
    data.recentOrders,
    data.activity,
    data.catalogue,
    data.pendingReviews,
    data.abandoned,
  ].some((read) => read?.kind === 'signed_out');
}
