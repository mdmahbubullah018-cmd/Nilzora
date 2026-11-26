import { Router, type RequestHandler } from 'express';
import type { Logger } from 'pino';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import type { MediaStorage } from '../media/routes';
import type { AvatarDirectory } from '../users/avatar-directory';
import type { AdminAccountStore } from './accounts-store';
import { adminAccountsRouter } from './accounts-routes';
import type { AdminCatalogStore } from './catalog-store';
import { adminCatalogRouter } from './catalog-routes';
import type { AdminCouponStore } from './coupons-store';
import { adminCouponsRouter } from './coupons-routes';
import type { AdminDiscountStore } from './discounts-store';
import { adminDiscountsRouter } from './discounts-routes';
import type { MediaLibraryStore } from './media-library-store';
import { adminExportsRouter, type ExportStores } from '../exports/routes';
import { adminMediaLibraryRouter } from './media-library-routes';
import type { SiteContentStore } from '../site/content-store';
import { adminContentRouter } from './content-routes';
import { adminReviewRoutes } from './reviews-routes';
import type { ModerationStore } from './moderation-store';
import { moderationRouter } from './moderation-routes';
import type { AdminOrderStore } from './orders-store';
import { adminOrdersRouter } from './orders-routes';
import type { AdminReportStore } from './reports-store';
import type { ReviewStore } from '../reviews/store';
import type { AfterSalesStore } from '../after-sales/store';
import { adminAfterSalesRouter } from './after-sales-routes';
import type { SavedCartStore } from '../carts/store';
import { adminCheckoutRouter } from './checkout-routes';
import { adminReportsRouter } from './reports-routes';

/** Admin and moderator data access (Supabase in production, fakes in unit tests). */
export interface AdminStores {
  catalog: AdminCatalogStore;
  orders: AdminOrderStore;
  accounts: AdminAccountStore;
  moderation: ModerationStore;
  reports: AdminReportStore;
  coupons: AdminCouponStore;
  /** Discount campaigns: promotional pricing across products, categories and brands. */
  discounts: AdminDiscountStore;
  reviews: ReviewStore;
  /** Returns and refunds. Absent when the feature is not configured. */
  afterSales?: AfterSalesStore;
  /** The incomplete-checkout queue. Reads only. Absent when persisted carts are off. */
  checkouts?: SavedCartStore;
  /** The media library (store-profile, SEO and onboarding pictures). Absent: not mounted. */
  mediaLibrary?: MediaLibraryStore;
  /** Reports, exports and order documents. Absent: not mounted. */
  exports?: ExportStores;
  /** Static pages, navigation links and homepage sections. Absent: not mounted. */
  content?: SiteContentStore;
}

export interface AdminRouteDependencies extends AuthDependencies {
  stores: AdminStores;
  /** Shared per-IP limit for every admin and moderator change. */
  limiter: RequestHandler;
  /** The authenticate middleware, created once for all admin routes. */
  requireUser: RequestHandler;
  /** Origin of the admin workspace; invitations link to its /accept-invite page. */
  adminAppOrigin: string;
  /** Media storage for category images; absent when R2 is not configured. */
  storage?: MediaStorage | undefined;
  logger?: Logger | undefined;
  /** The clock for generated documents (tests fix it). */
  now?: (() => Date) | undefined;
  /** Customer pictures for the customer pages; absent leaves them without one. */
  avatars?:
    | {
        directory: AvatarDirectory;
        mediaBaseUrl: string | undefined;
      }
    | undefined;
}

/**
 * Every /admin/* and /moderator/* route. Each one authenticates the caller, requires
 * the permission its database function checks again, validates its input, and calls
 * the database as the caller (never with the service-role key), so a missing check in
 * the API still cannot act with more authority than the account holds. Responses are
 * never cached, and changes share a per-IP rate limit.
 */
export function adminRouter(deps: Omit<AdminRouteDependencies, 'requireUser'>): Router {
  const routeDeps: AdminRouteDependencies = { ...deps, requireUser: authenticate(deps) };
  const router = Router();
  router.use(adminCatalogRouter(routeDeps));
  router.use(adminOrdersRouter(routeDeps));
  router.use(adminAccountsRouter(routeDeps));
  router.use(moderationRouter(routeDeps));
  router.use(adminReportsRouter(routeDeps));
  router.use(adminCouponsRouter(routeDeps));
  router.use(adminDiscountsRouter(routeDeps));
  router.use(adminReviewRoutes(routeDeps));
  router.use(adminAfterSalesRouter(routeDeps));
  router.use(adminCheckoutRouter(routeDeps));
  router.use(adminMediaLibraryRouter(routeDeps));
  router.use(adminExportsRouter(routeDeps));
  router.use(adminContentRouter(routeDeps));
  return router;
}
